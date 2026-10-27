"use strict";
// Guild Tool, version web : Web Worker qui fait tourner l'appli Python de l'exe (Pyodide). Un seul appel à la fois,
// dans l'ordre d'arrivée (pywebview les faisait en parallèle, mais l'appli les sérialise déjà avec son verrou).
// Fichiers : /appdata = dossier de l'appli (%APPDATA%\GuildTool de l'exe), /wow = copie du dossier du jeu ; les deux
// sont gardés dans le stockage du site (IndexedDB). Du dossier du jeu, seul le nécessaire est copié : SavedVariables
// (GuildTool, RCLootCouncil), dossiers des comptes / serveurs / persos, et de l'addon le .toc (version) et la liste des
// images (fichiers vides : l'appli ne fait que tester leur présence). Ce que l'appli écrit dans le dossier de l'addon
// (Import.lua, images) est recopié dans le vrai dossier (dossier lié), sinon proposé au téléchargement (copie importée).
const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v0.27.7/full/";
importScripts(PYODIDE + "pyodide.js");

const ADDON_REL = "Interface/AddOns/GuildTool";
const ADDON = "/wow/" + ADDON_REL;
const SV_FILES = ["GuildTool.lua", "RCLootCouncil.lua", "RaidPlanner.lua"];
// appels qui relisent les SavedVariables : le jeu a pu les réécrire (dossier lié)
const REFRESH = new Set(["poll", "get_state", "save_config", "wow_account_tree", "addon_status"]);
const STATE = "/appdata/web_state.json";

let py, FS, rt;            // Pyodide, son système de fichiers, module webrt
let src = null;            // dossier du jeu de cette session : {mode, root (dossier lié), sv: [{rel, handle, t}]}
// mode « linked » | « import », nom du dossier, date de la copie ; known = {fichier de l'addon: date} ;
// pending = fichiers de l'addon changés par l'appli, pas encore recopiés dans le vrai dossier
let ws = { mode: "", label: "", t: 0, known: {}, pending: {} };
let queue = Promise.resolve();

const post = (m, transfer) => postMessage(m, transfer || []);
const progress = text => post({ type: "progress", text });
self.gtEffect = (kind, json) => post({ type: "effect", kind, data: JSON.parse(json) });

// ---------------------------------------------------------------- système de fichiers
const isDir = p => { try { return FS.isDir(FS.stat(p).mode); } catch (e) { return false; } };
const exists = p => { try { FS.stat(p); return true; } catch (e) { return false; } };
function rmTree(p, keepRoot) {
  if (!exists(p)) return;
  if (!isDir(p)) { FS.unlink(p); return; }
  for (const n of FS.readdir(p)) if (n !== "." && n !== "..") rmTree(p + "/" + n);
  if (!keepRoot) FS.rmdir(p);
}
function writeFile(p, data, t) {
  FS.mkdirTree(p.slice(0, p.lastIndexOf("/")));
  FS.writeFile(p, data);
  if (t) FS.utime(p, t, t);
}
function walk(dir, out, rel) {
  out = out || {};
  for (const n of FS.readdir(dir)) {
    if (n === "." || n === "..") continue;
    const p = dir + "/" + n, r = rel ? rel + "/" + n : n, st = FS.stat(p);
    if (FS.isDir(st.mode)) walk(p, out, r);
    else out[r] = +st.mtime;
  }
  return out;
}
const syncfs = populate => new Promise((res, rej) => FS.syncfs(populate, err => err ? rej(err) : res()));
let persisting = false, persistAgain = false;
async function persist() {
  if (persisting) { persistAgain = true; return; }
  persisting = true;
  try { FS.writeFile(STATE, JSON.stringify(ws)); await syncfs(false); }
  catch (e) { console.error("Guild Tool: storage", e); }
  persisting = false;
  if (persistAgain) { persistAgain = false; persist(); }
}

function status() {
  return { type: "files", mode: ws.mode, label: ws.label, t: ws.t, connected: !!(src && src.root),
           pending: Object.keys(ws.pending).filter(r => exists(ADDON + "/" + r)) };
}
const notify = () => post(status());

// ---------------------------------------------------------------- dossier du jeu : lecture
async function child(dir, name, kind) {
  try { return kind === "file" ? await dir.getFileHandle(name) : await dir.getDirectoryHandle(name); }
  catch (e) { return null; }
}
async function isGameDir(h) { return !!((await child(h, "WTF")) || (await child(h, "Interface"))); }
async function addonDir(h) {
  const i = await child(h, "Interface"), a = i && await child(i, "AddOns");
  return a && await child(a, "GuildTool");
}
// dossier de la version du jeu ; dossier parent choisi (World of Warcraft) : la version qui contient Guild Tool,
// sinon la seule version trouvée (même règle que pick_wow_folder de l'exe)
async function resolveRoot(h) {
  if (await isGameDir(h)) return h;
  const versions = [], withAddon = [];
  for await (const [n, c] of h.entries()) {
    if (c.kind === "directory" && n.startsWith("_") && await isGameDir(c)) {
      versions.push(c);
      if (await addonDir(c)) withAddon.push(c);
    }
  }
  const pick = withAddon.length === 1 ? withAddon[0] : versions.length === 1 ? versions[0] : null;
  if (!pick) throw new Error("This is not a game version folder (no WTF / Interface inside)."
    + (versions.length ? " Choose one of: " + versions.map(v => v.name).join(", ") : ""));
  return pick;
}
async function listMedia(dir, rel, out) {
  for await (const [n, c] of dir.entries()) {
    if (c.kind === "directory") await listMedia(c, rel + "/" + n, out);
    else out.push({ rel: rel + "/" + n });
  }
}
// dossier lié : ce qui sert à l'appli, lu dans le vrai dossier
async function listLinked(root, sv) {
  const out = [];
  const wtf = await child(root, "WTF"), acc = wtf && await child(wtf, "Account");
  if (acc) {
    out.push({ rel: "WTF/Account", dir: true });
    for await (const [a, ah] of acc.entries()) {
      if (ah.kind !== "directory") continue;
      out.push({ rel: "WTF/Account/" + a, dir: true });
      for await (const [r, rh] of ah.entries()) {
        if (rh.kind !== "directory") continue;
        if (r === "SavedVariables") {
          for (const f of SV_FILES) {
            const fh = await child(rh, f, "file");
            if (!fh) continue;
            const file = await fh.getFile(), rel = `WTF/Account/${a}/SavedVariables/${f}`;
            out.push({ rel, data: new Uint8Array(await file.arrayBuffer()), t: file.lastModified });
            sv.push({ rel, handle: fh, t: file.lastModified });
          }
        } else {
          for await (const [c, ch] of rh.entries()) if (ch.kind === "directory") out.push({ rel: `WTF/Account/${a}/${r}/${c}`, dir: true });
        }
      }
    }
  }
  if (await child(root, "Interface")) out.push({ rel: "Interface/AddOns", dir: true });
  const g = await addonDir(root);
  if (g) {
    out.push({ rel: ADDON_REL, dir: true });
    const toc = await child(g, "GuildTool.toc", "file");
    if (toc) { const f = await toc.getFile(); out.push({ rel: ADDON_REL + "/GuildTool.toc", data: new Uint8Array(await f.arrayBuffer()), t: f.lastModified }); }
    if (await child(g, "Import.lua", "file")) out.push({ rel: ADDON_REL + "/Import.lua" });
    // dossier de développement (.git, dossier ou fichier) : addon jamais remplacé
    if ((await child(g, ".git")) || (await child(g, ".git", "file"))) out.push({ rel: ADDON_REL + "/.git", dir: true });
    const media = await child(g, "media");
    if (media) { out.push({ rel: ADDON_REL + "/media", dir: true }); await listMedia(media, ADDON_REL + "/media", out); }
  }
  return out;
}
// copie importée : fichiers d'un dossier choisi avec <input webkitdirectory> ([{path, file}])
async function listImport(files) {
  const roots = {};
  for (const f of files) {
    const s = f.path.split("/");
    for (let i = 0; i < s.length - 1; i++) {
      const wtf = s[i] === "WTF" && s[i + 1] === "Account", itf = s[i] === "Interface" && s[i + 1] === "AddOns";
      if (!wtf && !itf) continue;
      const r = s.slice(0, i).join("/"), e = roots[r] || (roots[r] = { addon: false });
      if (itf && s[i + 2] === "GuildTool") e.addon = true;
      break;
    }
  }
  const all = Object.keys(roots), withAddon = all.filter(r => roots[r].addon);
  const root = withAddon.length === 1 ? withAddon[0] : all.length === 1 ? all[0] : null;
  if (root === null) throw new Error(all.length ? "Several game versions in this folder: choose one of: " + all.map(r => r.split("/").pop()).join(", ")
    : "This is not a game version folder (no WTF / Interface inside).");
  const out = [], dirs = new Set(), dir = rel => { if (!dirs.has(rel)) { dirs.add(rel); out.push({ rel, dir: true }); } };
  for (const f of files) {
    if (root && !f.path.startsWith(root + "/")) continue;
    const rel = root ? f.path.slice(root.length + 1) : f.path, s = rel.split("/");
    if (s[0] === "WTF" && s[1] === "Account" && s.length >= 4) {
      dir("WTF/Account/" + s[2]);
      if (s[3] === "SavedVariables") {
        if (s.length === 5 && SV_FILES.includes(s[4])) out.push({ rel, data: new Uint8Array(await f.file.arrayBuffer()), t: f.file.lastModified });
      } else if (s.length >= 6) dir(s.slice(0, 5).join("/"));
    } else if (rel.startsWith(ADDON_REL + "/")) {
      dir(ADDON_REL);
      const sub = rel.slice(ADDON_REL.length + 1);
      if (sub === "GuildTool.toc") out.push({ rel, data: new Uint8Array(await f.file.arrayBuffer()), t: f.file.lastModified });
      else if (sub === "Import.lua" || sub.startsWith("media/")) out.push({ rel });
      else if (sub === ".git" || sub.startsWith(".git/")) dir(ADDON_REL + "/.git");
    } else if (s[0] === "Interface") dir("Interface/AddOns");
  }
  return { out, label: (root || "").split("/").pop() || "WoW" };
}
// /wow refait d'après le dossier choisi ; les fichiers de l'addon pas encore recopiés restent ceux de l'appli
async function mount(m) {
  let entries, root = null, label;
  const sv = [];
  if (m.mode === "linked") {
    root = await resolveRoot(m.handle);
    label = root.name;
    progress("Reading the game folder…");
    entries = await listLinked(root, sv);
  } else {
    progress("Reading the game folder…");
    ({ out: entries, label } = await listImport(m.files));
  }
  const keep = {};
  for (const r of Object.keys(ws.pending)) {
    const p = ADDON + "/" + r;
    if (exists(p)) keep[r] = { data: FS.readFile(p), t: +FS.stat(p).mtime };
  }
  rmTree("/wow", true);
  for (const e of entries) {
    if (e.dir) FS.mkdirTree("/wow/" + e.rel);
    else writeFile("/wow/" + e.rel, e.data || new Uint8Array(0), e.t || 1000);   // image : fichier vide daté de 1970
  }
  for (const [r, k] of Object.entries(keep)) writeFile(ADDON + "/" + r, k.data, k.t);
  ws.known = isDir(ADDON) ? walk(ADDON) : {};
  ws.mode = m.mode; ws.label = label; ws.t = Date.now();
  src = { mode: m.mode, root, sv };
  if (rt) {
    rt.state.set("linked", m.mode === "linked");
    rt.call("web_remount", "[]");
    scan();
  }
  await flush();
  await persist();
  notify();
  return { root, label };
}
// dossier lié : SavedVariables réécrites par le jeu depuis la dernière lecture
async function refreshSV() {
  for (const s of src.sv) {
    try {
      const file = await s.handle.getFile();
      if (file.lastModified !== s.t) {
        writeFile("/wow/" + s.rel, new Uint8Array(await file.arrayBuffer()), file.lastModified);
        s.t = file.lastModified;
      }
    } catch (e) { /* fichier en cours d'écriture par le jeu ou accès retiré : relu au prochain appel */ }
  }
}

// ---------------------------------------------------------------- dossier de l'addon : écriture
// fichiers de l'addon écrits ou supprimés par l'appli depuis le dernier passage -> à recopier
function scan() {
  if (!isDir(ADDON)) return false;
  const now = walk(ADDON);
  let changed = false;
  for (const [r, t] of Object.entries(now)) {
    if (r.endsWith(".tmp") || r.endsWith(".gtnew") || r.startsWith(".git/")) continue;
    if (ws.known[r] !== t) { ws.known[r] = t; ws.pending[r] = 1; changed = true; }
  }
  for (const r of Object.keys(ws.known)) if (!(r in now)) { delete ws.known[r]; ws.pending[r] = 1; changed = true; }
  return changed;
}
async function flush() {
  if (!(src && src.root) || !Object.keys(ws.pending).length) return;
  for (const r of Object.keys(ws.pending)) {
    const parts = (ADDON_REL + "/" + r).split("/"), name = parts.pop(), p = ADDON + "/" + r;
    try {
      let d = src.root;
      if (exists(p)) {
        for (const s of parts) d = await d.getDirectoryHandle(s, { create: true });
        const w = await (await d.getFileHandle(name, { create: true })).createWritable();
        await w.write(FS.readFile(p));
        await w.close();
      } else {
        try { for (const s of parts) d = await d.getDirectoryHandle(s); await d.removeEntry(name); }
        catch (e) { if (e.name !== "NotFoundError") throw e; }
      }
      delete ws.pending[r];
    } catch (e) {
      console.warn("Guild Tool: could not write", r, e);
      if (e.name === "NotAllowedError" || e.name === "SecurityError") { src.root = null; break; }   // accès retiré
    }
  }
}
async function afterCall() {
  if (!rt) return;
  if (scan()) await flush();
  await persist();
  notify();
}

// ---------------------------------------------------------------- démarrage et appels
async function boot(m) {
  progress("Loading Python…");
  py = await loadPyodide({ indexURL: PYODIDE });
  FS = py.FS;
  progress("Loading image tools…");
  await py.loadPackage(["Pillow"]);
  progress("Loading your data…");
  for (const d of ["/appdata", "/wow"]) { FS.mkdirTree(d); FS.mount(FS.filesystems.IDBFS, {}, d); }
  await syncfs(true);
  try { ws = { ...ws, ...JSON.parse(FS.readFile(STATE, { encoding: "utf8" })) }; } catch (e) { /* première visite */ }
  progress("Loading Guild Tool…");
  await Promise.all(m.files.map(async f => {
    const r = await fetch(m.base + f.url + "?v=" + m.build);
    if (!r.ok) throw new Error("HTTP " + r.status + " on " + f.url);
    writeFile("/app/" + f.path, new Uint8Array(await r.arrayBuffer()));
  }));
  if (m.wow) { try { await mount(m.wow); } catch (e) { console.warn("Guild Tool: game folder", e); } }
  py.runPython("import sys; sys.path.insert(0, '/app')");
  rt = py.pyimport("webrt");
  rt.state.set("base", m.base);
  rt.state.set("linked", ws.mode === "linked");
  progress("Reading your game data…");
  rt.boot();
  await afterCall();
}
function pyError(e) {
  const lines = String((e && e.message) || e).trim().split("\n");
  return lines[lines.length - 1].replace(/^\w+(Error|Exception): /, "");
}
async function doCall(m) {
  if (src && src.root && REFRESH.has(m.name)) await refreshSV();
  if (m.file) {
    const p = "/tmp/pick/" + Date.now() + "_" + m.file.name.replace(/[^\w.-]+/g, "_");
    writeFile(p, new Uint8Array(m.file.data));
    rt.set_dialog(p);
  } else if (m.dialog) rt.set_dialog(m.dialog);
  let res;
  try { res = { ok: true, value: rt.call(m.name, JSON.stringify(m.args || [])) }; }
  catch (e) { console.error(e); res = { ok: false, error: pyError(e) }; }
  rt.set_dialog(null);
  post({ type: "result", id: m.id, ...res });
  await afterCall();
}
// copie importée : fichiers de l'addon à recopier, Import.lua seul ou un zip (racine = dossier GuildTool)
function exportFiles(m) {
  const paths = Object.keys(ws.pending).filter(r => exists(ADDON + "/" + r));
  let name, data;
  if (!paths.length) { post({ type: "export", id: m.id, empty: true }); return; }
  if (paths.length === 1) { name = paths[0].split("/").pop(); data = FS.readFile(ADDON + "/" + paths[0]); }
  else { name = "GuildTool.zip"; data = FS.readFile(rt.make_zip(JSON.stringify(paths), "/tmp/export.zip")); }
  ws.pending = {};
  post({ type: "export", id: m.id, name, single: paths.length === 1, data }, [data.buffer]);
  persist();
  notify();
}

async function handle(m) {
  if (m.type === "boot") {
    try { await boot(m); post({ type: "ready" }); notify(); }
    catch (e) { console.error(e); post({ type: "fatal", error: String((e && e.message) || e) }); }
  } else if (m.type === "call") {
    await doCall(m);
  } else if (m.type === "mount") {
    try { const r = await mount(m); post({ type: "mounted", id: m.id, ok: true, root: r.root, label: r.label }); }
    catch (e) { console.error(e); post({ type: "mounted", id: m.id, ok: false, error: String((e && e.message) || e) }); }
  } else if (m.type === "export") {
    exportFiles(m);
  } else if (m.type === "tick") {
    await afterCall();          // écritures faites en arrière-plan (minuteries de l'appli)
  }
}
onmessage = e => { const m = e.data; queue = queue.then(() => handle(m)).catch(err => console.error(err)); };
