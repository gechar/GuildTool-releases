"use strict";
// Guild Tool, version web : remplace pywebview. window.pywebview.api.<fonction>() est envoyé au Web Worker qui fait
// tourner l'appli Python de l'exe (worker.js) ; ce qui demande la page (dialogues de fichiers, connexion Discord,
// presse-papier, liens) est fait ici. Le dossier du jeu est soit LIÉ (Chrome / Edge : lu et écrit directement, accès
// redemandé à chaque visite par le navigateur), soit IMPORTÉ (tous les navigateurs, et les dossiers que Chrome refuse
// comme C:\Program Files) : copie relue à la demande, fichiers de l'addon téléchargés pour être recopiés à la main.
window.GT_WEB = true;
(function () {
  const BASE = location.origin + location.pathname.replace(/[^/]*$/, "");
  const REDIRECT = location.origin + location.pathname;
  const FOLDER_ICO = '<svg viewBox="0 0 24 24"><path d="M3 6.5h6l2 2h10v10H3z"/></svg>';
  Object.assign(FR, {
    "Loading Guild Tool…": "Chargement de Guild Tool…", "Loading Python…": "Chargement de Python…",
    "Loading image tools…": "Chargement des outils d'image…", "Loading your data…": "Chargement de tes données…",
    "Reading your game data…": "Lecture des données du jeu…", "Reading the game folder…": "Lecture du dossier du jeu…",
    "First visit: about 15 MB to download, then kept by the browser.": "Première visite : environ 15 Mo à télécharger, ensuite gardés par le navigateur.",
    "Guild Tool could not start": "Guild Tool n'a pas pu démarrer", "Reload": "Recharger",
    "Guild Tool is already open in another tab.": "Guild Tool est déjà ouvert dans un autre onglet.",
    "World of Warcraft folder": "Dossier de World of Warcraft",
    "Choose your game version folder: the one that contains WTF and Interface (for example _forever_).":
      "Choisis le dossier de ta version du jeu : celui qui contient WTF et Interface (par exemple _forever_).",
    "Link the folder": "Lier le dossier",
    "Reads your game data and writes the file of the addon directly, like the app. Chrome and Edge only: the browser asks for access once per visit (or choose « Allow on every visit »).":
      "Lit les données du jeu et écrit directement le fichier de l'addon, comme l'appli. Chrome et Edge seulement : le navigateur demande l'accès à chaque visite (ou choisis « Autoriser à chaque visite »).",
    "Import a copy": "Importer une copie",
    "Every browser, and folders that Chrome and Edge refuse (inside C:\\Program Files). The game data is a copy: import again after playing. Changes for the addon are downloaded: copy them into Interface\\AddOns\\GuildTool, then /reload.":
      "Tous les navigateurs, et les dossiers que Chrome et Edge refusent (dans C:\\Program Files). Les données du jeu sont une copie : importe de nouveau après avoir joué. Les changements pour l'addon sont téléchargés : copie-les dans Interface\\AddOns\\GuildTool, puis /reload.",
    "Cancel": "Annuler", "Reading…": "Lecture…",
    "No folder linked. If the browser refused it (folder inside C:\\Program Files), use « Import a copy ».":
      "Aucun dossier lié. Si le navigateur l'a refusé (dossier dans C:\\Program Files), utilise « Importer une copie ».",
    "Allow access to {0}": "Autoriser l'accès à {0}", "Linked folder: read and written directly": "Dossier lié : lu et écrit directement",
    "writing…": "écriture…", "copy of {0}": "copie du {0}", "Import again": "Importer de nouveau",
    "Copy of your game folder: import it again after playing to read your new game data": "Copie du dossier du jeu : importe-le de nouveau après avoir joué pour lire tes nouvelles données",
    "Download {0}": "Télécharger {0}",
    "Changes for the addon: copy this file into Interface\\AddOns\\GuildTool, then /reload in game": "Changements pour l'addon : copie ce fichier dans Interface\\AddOns\\GuildTool, puis /reload en jeu",
    "Copy {0} into Interface\\AddOns\\GuildTool, then /reload in game.": "Copie {0} dans Interface\\AddOns\\GuildTool, puis /reload en jeu.",
    "Extract {0} into Interface\\AddOns (it holds the GuildTool folder), then /reload in game.": "Extrais {0} dans Interface\\AddOns (il contient le dossier GuildTool), puis /reload en jeu.",
    "Addon {0}": "Addon {0}", "Download the Guild Tool addon {0}: extract it into Interface\\AddOns, then restart the game": "Télécharge l'addon Guild Tool {0} : extrais-le dans Interface\\AddOns, puis relance le jeu",
    "Login expired: try again.": "Connexion expirée : recommence.",
  });
  const T = (s, ...a) => L(s, ...a);
  const escH = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  // ------------------------------------------------------------ petit stockage du site (dossier lié du jeu)
  function kv(mode, fn) {
    return new Promise((res, rej) => {
      const o = indexedDB.open("guildtool-web", 1);
      o.onupgradeneeded = () => o.result.createObjectStore("kv");
      o.onerror = () => rej(o.error);
      o.onsuccess = () => {
        const tx = o.result.transaction("kv", mode), r = fn(tx.objectStore("kv"));
        tx.oncomplete = () => { o.result.close(); res(r && r.result); };
        tx.onerror = () => rej(tx.error);
      };
    });
  }
  const kvGet = k => kv("readonly", s => s.get(k)).catch(() => null);
  const kvSet = (k, v) => kv("readwrite", s => s.put(v, k)).catch(() => null);
  const kvDel = k => kv("readwrite", s => s.delete(k)).catch(() => null);

  // ------------------------------------------------------------ Worker
  let worker, seq = 0, files = { mode: "", label: "", pending: [], connected: false, t: 0 }, addonNeed = null;
  const waiting = new Map();
  function send(msg, transfer) {
    return new Promise((res, rej) => {
      const id = ++seq;
      waiting.set(id, { res, rej });
      worker.postMessage({ ...msg, id }, transfer || []);
    });
  }
  const call = (name, args, extra) => send({ type: "call", name, args: args || [], ...(extra || {}) });
  function onMessage(e) {
    const m = e.data, w = waiting.get(m.id);
    if (m.type === "result" && w) {
      waiting.delete(m.id);
      if (m.ok) w.res(m.value == null ? null : JSON.parse(m.value));
      else w.rej(new Error(m.error));
    } else if ((m.type === "mounted" || m.type === "export") && w) {
      waiting.delete(m.id);
      w.res(m);
    } else if (m.type === "progress") bootText(T(m.text));
    else if (m.type === "files") { files = m; renderPill(); }
    else if (m.type === "effect") effect(m.kind, m.data);
    else if (m.type === "ready") booted.res();
    else if (m.type === "fatal") booted.rej(new Error(m.error));
  }
  function effect(kind, d) {
    if (kind === "open" && /^https:\/\//.test(d.url)) window.open(d.url, "_blank", "noopener");
    else if (kind === "clipboard") navigator.clipboard.writeText(d.text).catch(() => {});
  }

  // ------------------------------------------------------------ fonctions servies par la page
  function input(attrs) {
    return new Promise(res => {
      const i = document.createElement("input");
      i.type = "file";
      Object.assign(i, attrs);
      i.style.display = "none";
      document.body.appendChild(i);
      const end = v => { i.remove(); res(v); };
      i.addEventListener("change", () => end([...i.files]));
      i.addEventListener("cancel", () => end(null));
      i.click();
    });
  }
  async function pickImage(name, args) {
    const f = ((await input({ accept: "image/png,image/jpeg,image/webp,image/bmp" })) || [])[0];
    if (!f) return null;
    const data = await f.arrayBuffer();
    return send({ type: "call", name, args, file: { name: f.name, data } }, [data]);
  }
  const versionTuple = v => String(v || "0").split(".").map(x => parseInt(x, 10) || 0);
  const older = (a, b) => { const x = versionTuple(a), y = versionTuple(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0); } return false; };
  // copie importée : addon absent ou plus ancien que l'appli -> lien de téléchargement dans la pastille du dossier
  async function checkImportAddon() {
    addonNeed = null;
    if (files.mode === "import") {
      try {
        const st = await call("addon_status");
        if (!st.installed || older(st.version, st.app)) addonNeed = st.app;
      } catch (e) { /* rien */ }
    }
    renderPill();
  }
  // dossier du jeu : le choisir (lié ou importé) dans la fenêtre de la version web
  async function mountLinked(h) {
    const m = await send({ type: "mount", mode: "linked", handle: h });
    if (m.ok) await kvSet("wow", m.root);
    return m;
  }
  async function mountImport(list) {
    const keep = list.filter(f => /(^|\/)(WTF\/Account|Interface\/AddOns\/GuildTool)\//.test(f.webkitRelativePath))
      .map(f => ({ path: f.webkitRelativePath, file: f }));
    const m = await send({ type: "mount", mode: "import", files: keep });
    if (m.ok) await kvDel("wow");
    return m;
  }
  function chooseFolder() {
    return new Promise(resolve => {
      const g = document.createElement("div");
      g.id = "webFolder"; g.className = "gate";
      const canLink = "showDirectoryPicker" in window;
      g.innerHTML = `<div class="gatebox wfbox"><h2>${T("World of Warcraft folder")}</h2>
        <p>${T("Choose your game version folder: the one that contains WTF and Interface (for example _forever_).")}</p>
        ${canLink ? `<div class="wfopt"><button class="btn pri" data-wflink="1">${T("Link the folder")}</button>
          <div class="help">${escH(T("Reads your game data and writes the file of the addon directly, like the app. Chrome and Edge only: the browser asks for access once per visit (or choose « Allow on every visit »)."))}</div></div>` : ""}
        <div class="wfopt"><button class="btn${canLink ? "" : " pri"}" data-wfimport="1">${T("Import a copy")}</button>
          <div class="help">${escH(T("Every browser, and folders that Chrome and Edge refuse (inside C:\\Program Files). The game data is a copy: import again after playing. Changes for the addon are downloaded: copy them into Interface\\AddOns\\GuildTool, then /reload."))}</div></div>
        <p class="ko" id="wfErr" hidden></p>
        <button class="btn" data-wfcancel="1">${T("Cancel")}</button></div>`;
      document.body.appendChild(g);
      const box = g.querySelector(".wfbox"), err = g.querySelector("#wfErr");
      const fail = text => { box.classList.remove("busy"); err.textContent = text; err.hidden = false; };
      const done = r => { g.remove(); resolve(r); };
      g.addEventListener("click", async e => {
        if (box.classList.contains("busy")) return;
        if (e.target.closest("[data-wfcancel]")) { done({ ok: true, path: null }); return; }
        let m = null;
        if (e.target.closest("[data-wflink]")) {
          let h;
          try { h = await window.showDirectoryPicker({ id: "gtwow", mode: "readwrite" }); }
          catch (x) { fail(x.name === "AbortError" ? T("No folder linked. If the browser refused it (folder inside C:\\Program Files), use « Import a copy ».") : x.message); return; }
          box.classList.add("busy"); err.hidden = true;
          m = await mountLinked(h);
        } else if (e.target.closest("[data-wfimport]")) {
          const list = await input({ webkitdirectory: true, multiple: true });
          if (!list) return;
          box.classList.add("busy"); err.hidden = true;
          m = await mountImport(list);
        } else return;
        if (!m.ok) { fail(m.error); return; }
        if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
        const r = await call("pick_wow_folder", [], { dialog: "/wow" });
        if (r && r.path) r.path = files.label;
        checkImportAddon();
        done(r);
      });
    });
  }
  async function login() {
    const r = await call("web_login_start", [REDIRECT]);
    try { sessionStorage.setItem("gt-pkce", r.verifier); } catch (e) { /* stockage indisponible */ }
    location.href = r.url;
    return new Promise(() => {});      // la page part vers Discord
  }
  const special = {
    pick_wow_folder: () => chooseFolder(),
    pick_image: (...a) => pickImage("pick_image", a),
    pick_background: (...a) => pickImage("pick_background", a),
    cloud_login: () => login(),
    copy_text: async text => { try { await navigator.clipboard.writeText(String(text)); return true; } catch (e) { return String(e.message || e); } },
    open_url: async url => { if (/^https:\/\//.test(String(url))) window.open(url, "_blank", "noopener"); return true; },
    check_update: async () => null,
    get_state: async () => {
      const s = await call("get_state");
      if (s && s.config) s.config.wowPath = files.mode ? files.label : "";
      return s;
    },
    addon_status: async () => {
      const s = await call("addon_status");
      if (s) { s.path = files.label; if (!files.mode) s.wowOk = false; }
      return s;
    },
    save_config: cfg => { const c = { ...(cfg || {}) }; delete c.wowPath; return call("save_config", [c]); },
  };
  window.pywebview = { api: new Proxy({}, { get: (_, name) => typeof name !== "string" || name === "then" ? undefined
    : special[name] || ((...args) => call(name, args)) }) };

  // ------------------------------------------------------------ pastille du dossier du jeu (en bas à gauche)
  function renderPill() {
    let p = document.getElementById("webWow");
    if (!files.mode) { if (p) p.remove(); return; }
    if (!p) { p = document.createElement("div"); p.id = "webWow"; document.body.appendChild(p); }
    const label = `<span class="wwl">${FOLDER_ICO}${escH(files.label)}</span>`;
    if (files.mode === "linked") {
      p.className = files.connected ? "" : "warn";
      p.innerHTML = files.connected
        ? `<span class="wwl" data-help="${escH(T("Linked folder: read and written directly"))}">${FOLDER_ICO}${escH(files.label)}</span>${files.pending.length ? `<em>${T("writing…")}</em>` : ""}`
        : `<button class="hot" data-wwgrant="1">${T("Allow access to {0}", escH(files.label))}</button>`;
      return;
    }
    p.className = "";
    const when = files.t ? new Date(files.t).toLocaleString(LOC(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
    const one = files.pending.length === 1 ? files.pending[0].split("/").pop() : "GuildTool.zip";
    p.innerHTML = `${label}<span class="wwt" data-help="${escH(T("Copy of your game folder: import it again after playing to read your new game data"))}">${T("copy of {0}", when)}</span>
      <button data-wwre="1">${T("Import again")}</button>
      ${files.pending.length ? `<button class="hot" data-wwexp="1" data-help="${escH(T("Changes for the addon: copy this file into Interface\\AddOns\\GuildTool, then /reload in game"))}">${T("Download {0}", one)}</button>` : ""}
      ${addonNeed ? `<a class="wwbtn" href="${BASE}addon/GuildTool.zip?v=${encodeURIComponent(addonNeed)}" download="GuildTool.zip" data-help="${escH(T("Download the Guild Tool addon {0}: extract it into Interface\\AddOns, then restart the game", addonNeed))}">${T("Addon {0}", addonNeed)}</a>` : ""}`;
  }
  function download(name, data) {
    const url = URL.createObjectURL(new Blob([data]));
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  document.addEventListener("click", async e => {
    const t = e.target.closest && e.target.closest("#webWow [data-wwgrant], #webWow [data-wwre], #webWow [data-wwexp]");
    if (!t) return;
    if (t.dataset.wwgrant) {
      const h = await kvGet("wow");
      if (!h) { special.pick_wow_folder().then(r => { if (r && r.path) reload(); }); return; }
      if ((await h.requestPermission({ mode: "readwrite" })) !== "granted") return;
      const m = await mountLinked(h);
      if (!m.ok) { toast(m.error, true); return; }
      reload();
    } else if (t.dataset.wwre) {
      const list = await input({ webkitdirectory: true, multiple: true });
      if (!list) return;
      const m = await mountImport(list);
      if (!m.ok) { toast(m.error, true); return; }
      await checkImportAddon();
      reload();
    } else if (t.dataset.wwexp) {
      const m = await send({ type: "export" });
      if (m.empty) return;
      download(m.name, m.data);
      toast(T(m.single ? "Copy {0} into Interface\\AddOns\\GuildTool, then /reload in game." : "Extract {0} into Interface\\AddOns (it holds the GuildTool folder), then /reload in game.", m.name));
    }
  });

  // ------------------------------------------------------------ démarrage
  const booted = {};
  booted.p = new Promise((res, rej) => { booted.res = res; booted.rej = rej; });
  function bootText(text) {
    const el = document.getElementById("webBootMsg");
    if (el) el.textContent = text;
  }
  function bootScreen(html) {
    let g = document.getElementById("webBoot");
    if (!g) { g = document.createElement("div"); g.id = "webBoot"; g.className = "gate"; document.body.appendChild(g); }
    g.innerHTML = `<div class="gatebox"><h2>Guild Tool</h2>${html}</div>`;
  }
  async function start() {
    document.body.classList.add("gtweb");
    bootScreen(`<p id="webBootMsg">${T("Loading Guild Tool…")}</p><div class="webbar"><i></i></div>
      <div class="help">${T("First visit: about 15 MB to download, then kept by the browser.")}</div>`);
    const q = new URLSearchParams(location.search);
    const code = q.get("code"), loginErr = q.get("error_description") || q.get("error");
    if (code || loginErr) history.replaceState(null, "", REDIRECT);
    try {
      const build = await (await fetch(BASE + "webapp/build.json", { cache: "no-store" })).json();
      worker = new Worker(BASE + "webapp/worker.js?v=" + build.build);
      worker.onmessage = onMessage;
      worker.onerror = e => booted.rej(new Error(e.message || "Worker error"));
      // dossier lié déjà autorisé pour ce site (« Autoriser à chaque visite ») : relu tout de suite
      let wow = null;
      const h = await kvGet("wow");
      if (h && h.queryPermission && (await h.queryPermission({ mode: "readwrite" })) === "granted") wow = { mode: "linked", handle: h };
      worker.postMessage({ type: "boot", base: BASE, build: build.build, files: build.files, wow });
      await booted.p;
    } catch (e) {
      bootScreen(`<p class="ko">${T("Guild Tool could not start")}</p><p class="help">${escH(e.message)}</p>
        <button class="btn pri" onclick="location.reload()">${T("Reload")}</button>`);
      return;
    }
    let logged = null;
    if (code) {
      let v = null;
      try { v = sessionStorage.getItem("gt-pkce"); sessionStorage.removeItem("gt-pkce"); } catch (e) { /* rien */ }
      logged = v ? await call("web_login_finish", [code, v]) : { ok: false, error: T("Login expired: try again.") };
    } else if (loginErr) logged = { ok: false, error: loginErr };
    document.getElementById("webBoot").remove();
    window.dispatchEvent(new Event("pywebviewready"));
    checkImportAddon();
    setInterval(() => worker.postMessage({ type: "tick" }), 5000);
    if (logged) {
      // retour de Discord : même suite que le bouton de connexion de l'exe
      for (let i = 0; i < 300 && !ST; i++) await new Promise(r => setTimeout(r, 100));
      if (!logged.ok) { toast(logged.error, true); return; }
      toast(L("Logged in with Discord."));
      if (ST.cloud && ST.cloud.guild) doSync();
      openSetupGate();
    }
  }
  // un seul onglet à la fois (les deux écriraient les mêmes données du site)
  if (navigator.locks) {
    navigator.locks.request("guildtool-web", { ifAvailable: true }, lock => {
      if (!lock) { document.body.classList.add("gtweb"); bootScreen(`<p>${T("Guild Tool is already open in another tab.")}</p>`); return null; }
      start();
      return new Promise(() => {});
    });
  } else start();
})();
