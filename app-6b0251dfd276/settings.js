"use strict";
// Fenêtre Settings flottante : déplaçable par sa barre, redimensionnable par son coin, toujours au premier plan.
// Pas de bouton Save : chaque changement est enregistré tout de suite et empilé pour « Undo » (annulation à rebours).

// ------------------------------------------------------------------ annulation
const UNDO = [], REDO = [];
// fn : remet l'état d'avant ; redo (facultatif) : refait le changement
function pushUndo(label, fn, redo) {
  UNDO.push({ label, fn, redo });
  if (UNDO.length > 100) UNDO.shift();
  REDO.length = 0;
  updateUndo();
}
function updateUndo() {
  const b = $("#setUndo"), last = UNDO[UNDO.length - 1];
  b.disabled = !last;
  $("#setRedo").disabled = !REDO.length;
  $("#tlUndo").disabled = !last;
  $("#tlRedo").disabled = !REDO.length;
  $("#undoInfo").textContent = last ? L("Undo: {0}", L(last.label)) : "";
}
async function settingsUndo(redo) {
  const e = redo ? REDO.pop() : UNDO.pop();
  if (!e) return;
  if (redo) { await e.redo(); UNDO.push(e); } else { await e.fn(); if (e.redo) REDO.push(e); }
  updateUndo();
  fillSettings();
}
$("#setUndo").addEventListener("click", () => settingsUndo(false));
$("#setRedo").addEventListener("click", () => settingsUndo(true));
// champ de saisie de texte (Ctrl+Z y annule la frappe) ; curseurs, couleurs, cases : l'annulation des Settings
const typingIn = el => el.tagName === "TEXTAREA" || el.tagName === "SELECT"
  || (el.tagName === "INPUT" && !["range", "color", "checkbox", "radio", "button"].includes(el.type));
document.addEventListener("keydown", e => {
  if (($("#settingsWin").hidden && $("#tabLookWin").hidden) || !e.ctrlKey || typingIn(e.target)) return;
  const k = e.key.toLowerCase();
  if (k === "z" || k === "y") { e.preventDefault(); settingsUndo(k === "y"); }
});

// ------------------------------------------------------------------ ouverture, déplacement, taille
function toggleSettings(show) {
  const w = $("#settingsWin");
  show = show ?? w.hidden;
  if (show) {
    const app = $("#app").getBoundingClientRect();
    const s = UI.setWin || { w: Math.round(app.width / 4), h: Math.round(app.height / 2), x: Math.round(app.width * 0.73), y: 56 };
    placeSettings(s);
    fillSettings();
  }
  w.hidden = !show;
  hideTip();
}
function placeSettings(s) {
  const W = innerWidth, H = innerHeight;
  s.w = Math.max(280, Math.min(s.w, W - 8));
  s.h = Math.max(240, Math.min(s.h, H - 8));
  s.x = Math.max(0, Math.min(s.x, W - s.w));
  s.y = Math.max(0, Math.min(s.y, H - s.h));
  Object.assign($("#settingsWin").style, { left: s.x + "px", top: s.y + "px", width: s.w + "px", height: s.h + "px" });
  UI.setWin = s;
}
function dragFrom(e, onMove) {
  e.preventDefault();
  const sx = e.clientX, sy = e.clientY, start = { ...UI.setWin };
  const move = ev => onMove(start, ev.clientX - sx, ev.clientY - sy);
  const up = () => { document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); saveUI(); };
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", up);
}
$("#setBar").addEventListener("pointerdown", e => {
  if (e.target.closest("button")) return;
  dragFrom(e, (s, dx, dy) => placeSettings({ ...s, x: s.x + dx, y: s.y + dy }));
});
$("#setGrip").addEventListener("pointerdown", e => dragFrom(e, (s, dx, dy) => placeSettings({ ...s, w: s.w + dx, h: s.h + dy })));
$("#setClose").addEventListener("click", () => toggleSettings(false));
window.addEventListener("resize", () => { if (!$("#settingsWin").hidden) placeSettings(UI.setWin); });

// ------------------------------------------------------------------ contenu
function fillSettings() {
  const c = ST.config, a = ST.appearance || {};
  const set = (id, v) => { const el = $(id); if (document.activeElement !== el) el.value = v; };
  set("#cfgApiKey", c.apiKey || "");
  set("#cfgServerId", c.serverId || "");
  set("#cfgBotToken", c.botToken || "");
  set("#cfgAuto", c.autoSyncMinutes ?? 10);
  showSetTab(UI.setTab || "appearance");
  renderGuildKey();
  renderGuildAdmin();
  renderGuildLook();
  if (!$("#hooks").contains(document.activeElement)) $("#hooks").innerHTML = (c.webhooks || []).map(hookRow).join("");
  $("#apBase").value = a.base || "#1e1f24";
  $("#apLockA").value = a.lockA || "#0e0f12";
  $("#apLockB").value = a.lockB || "#34363e";
  $("#apHl").value = a.hl || "#6f7cff";
  $("#apHl2").value = a.hl2 || "#3fc7eb";
  $("#apHl2").hidden = !a.hlGrad;
  $("#apHlGrad").classList.toggle("on", !!a.hlGrad);
  $("#apLang").classList.toggle("on", LANG === "fr");
  $("#apNoBg").classList.toggle("on", !!a.assignNoBg);
  $("#apCharImg").classList.toggle("on", !a.charImgOff);
  $("#bgRemove").disabled = false;
  document.querySelectorAll("#settingsWin .slider").forEach(updateSlider);
  renderPhaseEditor();
  if (!$("#fadeEd").hidden) renderFadeEd();
  updateUndo();
  if (!$("#tabLookWin").hidden) renderTabLook();
}

// ---------- onglets : Appearance, Phases & Raids, Social (social.js), Admin
// éditeur des phases remis à sa place (Settings > Phases & Raids)
function phaseEdHome() {
  const page = document.querySelector('[data-stabpage="phases"]'), ed = $("#phaseEd");
  if (ed && page && ed.parentElement !== page) page.appendChild(ed);
}
function showSetTab(tab) {
  UI.setTab = tab;
  if (tab === "phases") { phaseEdHome(); renderPhaseEditor(); }
  if (tab === "social") renderSocial();
  document.querySelectorAll("#setTabs [data-stab]").forEach(b => b.classList.toggle("on", b.dataset.stab === tab));
  document.querySelectorAll("#setBody [data-stabpage]").forEach(p => { p.hidden = p.dataset.stabpage !== tab; });
}
$("#setTabs").addEventListener("click", e => {
  const b = e.target.closest("[data-stab]");
  if (b) { showSetTab(b.dataset.stab); saveUI(); $("#setBody").scrollTop = 0; }
});

// ---------- Admin : guilde (nom affiché, rôle officier, officiers ajoutés à la main) et clé Raid-Helper
const inGuild = () => !!(ST.cloud && ST.cloud.logged && ST.cloud.guild);
// officier temporaire (droits donnés par un officier) : contenu de l'appli, pas les réglages de la guilde
const isOfficer = () => !!(ST.cloud && ST.cloud.member && ST.cloud.member.officer) && ST.canAdmin !== false;
let guildRoles = null, guildMembers = null, grantDraft = false;

function renderGuildAdmin() {
  const box = $("#guildAdmin");
  if (!inGuild()) { box.innerHTML = ""; return; }
  const c = ST.cloud, g = c.guild, m = { ...(c.member || {}), officer: isOfficer() };
  let h = `<div class="sec">${L("Guild")}</div>
    <label class="sfield" data-help="Name shown at the top left of the window (exe and addon).">${L("Displayed name")}
      <span class="bgrow"><input id="guildTitleIn" value="${esc(g.title || g.name || "")}"${m.officer ? "" : " disabled"}>${m.officer ? `<button class="btn small" id="guildTitleSave">${L("Save")}</button>` : ""}</span></label>`;
  // commande de l'addon en jeu, imposée à toute la guilde
  h += `<label class="sfield" data-help="Chat command that opens the addon in game, for the whole guild (sent at the next Sync, active after /reload). Also: &lt;command&gt; map, &lt;command&gt; me, &lt;command&gt; debug.">${L("Addon command")}
      <span class="bgrow"><input id="slashIn" value="${esc(ST.slash || "/gt")}"${m.admin ? "" : " disabled"}>${m.admin ? `<button class="btn small" id="slashSave">${L("Save")}</button>` : ""}</span></label>`;
  // rôle officier : choisi par un admin du serveur Discord
  if (m.admin) {
    const opts = guildRoles ? guildRoles.map(r => `<option value="${r.id}"${r.id === g.officer_role ? " selected" : ""}>${esc(r.name)}</option>`).join("") : "";
    h += `<label class="sfield" data-help="Members with this Discord role get the officer rights: comps, assigns, phases, raid images and maps.">${L("Officer role")}
      ${guildRoles ? `<select id="officerRole"><option value="">${L("None (admins only)")}</option>${opts}</select>` : `<button class="btn small" id="loadRoles">${L("Load the server roles")}</button>`}</label>`;
  }
  // officiers ajoutés à la main
  if (m.officer) {
    const granted = (guildMembers || []).filter(x => x.granted);
    h += `<div class="sfield" data-help="Give the officer rights to other members (they must have logged in to Guild Tool once).">${L("Extra officers")}</div>
      <div class="grants">${granted.map(x => `<div class="grant"><span>${esc(x.nick || x.name || x.username)}</span><button class="ib" data-ungrant="${x.discord_id}" data-help="Remove the officer rights">×</button></div>`).join("")}
      ${guildMembers === null ? `<button class="btn small" id="loadMembers">${L("Show")}</button>` : grantDraft || !granted.length
        ? `<div class="grant pick"><input id="grantQ" placeholder="${L("Type a name")}" autocomplete="off"><div class="grantlist" id="grantList" hidden></div></div>`
        : `<button class="ib" id="grantAdd" data-help="Add an officer">+</button>`}</div>`;
  }
  // Loots : vues cachées aux membres (les officiers les voient toujours)
  if (m.officer) {
    const f = ST.guildFlags || {};
    const sw = (key, label, h) => `<div class="srow" data-help="${h}"><span class="sl">${L(label)}</span><button class="switch${f[key] ? " on" : ""}" data-gflag="${key}"><i></i></button></div>`;
    h += `<div class="sec">${L("Loots")}</div>
      ${sw("lootHideCompare", "Hide the Compare view", "The members (not officers) no longer see the Compare view of Loots (exe and addon).")}
      ${sw("lootHideHistory", "Hide the History view", "The members (not officers) no longer see the History view of Loots (exe and addon).")}
      ${sw("lootHideOrder", "Hide the loot order", "The members (not officers) no longer see who received each item in the Tables view (exe and addon).")}`;
  }
  // events Raid-Helper créés depuis le calendrier (admin) : salons, template, mentions, events de référence
  if (m.admin) {
    const s = ST.rhSettings || {}, chans = { ...(ST.rhChannels || {}) };
    for (const ev of ST.events || []) if (ev.chId && !chans[ev.chId]) chans[ev.chId] = ev.channel || ev.chId;
    // salon : nom affiché (id pendant la saisie) ; id gardé dans data-id
    const chanField = (key, label, help, def) => {
      const id = s[key] || def;
      return `<label class="sfield" data-help="${help}">${L(label)}
        <input data-rh="${key}" data-chan="1" data-id="${esc(id)}" value="${esc(chans[id] || id)}" placeholder="${L("Channel id")}" autocomplete="off"></label>`;
    };
    const evSelect = (key, label, help) => `<label class="sfield" data-help="${help}">${L(label)}
        <select data-rh="${key}">${[...(ST.events || [])].sort((a, b) => b.start - a.start).map(ev => `<option value="${ev.id}"${ev.id === s[key] ? " selected" : ""}>${esc(ev.title)} · ${esc(ev.channel || "")}</option>`).join("")}
        ${(ST.events || []).some(ev => ev.id === s[key]) ? "" : `<option value="${esc(s[key] || "")}" selected>${esc(s[key] || "—")}</option>`}</select></label>`;
    // salons, titre et mention : choisis dans la fenêtre de création d'event
    h += `<div class="sec">${L("Raid-Helper events")}</div>
      <label class="sfield" data-help="Raid-Helper template of the created events (text id: wowforever = WoW: Forever).">${L("Template")}
        <select data-rh="rhTemplate">${[["wowforever", "WoW: Forever"], ["wowclassic", "WoW Classic"], ["wowtbc", "WoW TBC"], ["wowwotlk", "WoW WotLK"], ["standard", "Standard"]]
          .concat([["wowforever", "wowclassic", "wowtbc", "wowwotlk", "standard"].includes(s.rhTemplate || "wowforever") ? [] : [[s.rhTemplate, s.rhTemplate]]])
          .map(([id, n]) => `<option value="${esc(id)}"${id === (s.rhTemplate || "wowforever") ? " selected" : ""}>${esc(n)} · ${esc(id)}</option>`).join("")}</select></label>
      ${chanField("rhMainChannel", "Main raid channel", "Discord channel of the Main Raid events.", "1481727247223226449")}
      ${chanField("rhCommuChannel", "Raid commu channel", "Discord channel of the community raids: every community raid created in Guild Tool goes there.", "1558492094581051514")}
      ${chanField("rhMainArchive", "Main raid archive", "When a new lockout starts, the Main Raid events of the previous lockouts are moved to this channel.", "1559968092774342706")}
      ${chanField("rhCommuArchive", "Raid commu archive", "When a new lockout starts, the community raids of the previous lockouts are moved to this channel.", "1559968122457563166")}
      ${evSelect("rhCopyFrom", "Copy sign-ups from", "The sign-ups of this event are copied into each new Main Raid.")}
      ${evSelect("rhClassEvent", "Event Class", "Event where each player signed up their characters once: the 👍 reaction copies them into the chosen event.")}
      <label class="sfield" data-help="Discord channel where the bot tells the officers when a player in a comp is late, tentative or absent.">${L("Officer channel")}
        <input data-rh="rhOfficerChannel" value="${esc(s.rhOfficerChannel || "1481015325855187035")}" placeholder="${L("Channel id")}"></label>
      <button class="btn small" id="rhSave">${L("Save")}</button>` ;
  }
  // tout le bloc réécrit d'un coup (sinon les sections s'empilaient à chaque ouverture)
  box.innerHTML = h;
}
async function saveRhSettings(quiet) {
  const values = {};
  document.querySelectorAll("#guildAdmin [data-rh]").forEach(el => { values[el.dataset.rh] = (el.dataset.chan ? el.dataset.id : el.value).trim(); });
  const r = await api().set_rh_settings(values);
  if (!r.ok) { toast(r.error, true); return; }
  ST.rhSettings = { ...(ST.rhSettings || {}), ...values };
  if (!quiet) toast(L("Saved."));
}
$("#guildAdmin").addEventListener("click", e => { if (e.target.closest("#rhSave")) saveRhSettings(false); });
// enregistré aussi dès qu'un champ change (choix dans la liste, sortie du champ)
$("#guildAdmin").addEventListener("change", e => {
  const el = e.target.closest("[data-rh]");
  if (!el) return;
  // salon : un id collé remplace l'ancien (un nom tapé n'est pas un id : ignoré)
  if (el.dataset.chan) { const v = el.value.trim(); if (!/^\d{5,25}$/.test(v)) { el.value = el.dataset.id; return; } el.dataset.id = v; }
  saveRhSettings(true);
});
// salon : l'id pendant la saisie, le nom sinon
$("#guildAdmin").addEventListener("focusin", e => { const el = e.target; if (el.dataset && el.dataset.chan) { el.value = el.dataset.id; el.select(); } });
$("#guildAdmin").addEventListener("focusout", e => {
  const el = e.target;
  if (el.dataset && el.dataset.chan) setTimeout(() => { if (document.activeElement !== el) el.value = (ST.rhChannels || {})[el.dataset.id] || el.dataset.id; }, 0);
});
function fillGrantList() {
  const q = ($("#grantQ").value || "").toLowerCase(), list = $("#grantList");
  const cands = (guildMembers || []).filter(x => !x.officer && [x.nick, x.name, x.username].some(v => (v || "").toLowerCase().includes(q)));
  list.innerHTML = cands.slice(0, 40).map(x => `<button data-grant="${x.discord_id}">${esc(x.nick || x.name)} <small>@${esc(x.username || "")}</small></button>`).join("")
    || `<div class="help">${L("No member found (they must have logged in to Guild Tool once).")}</div>`;
  list.hidden = false;
}
async function loadMembers() {
  const r = await api().cloud_members();
  if (!r.ok) { toast(r.error, true); return; }
  guildMembers = r.members;
  renderGuildAdmin();
}
$("#guildAdmin").addEventListener("click", async e => {
  const t = e.target;
  let el;
  if (t.closest("#slashSave")) {
    const r = await api().set_slash($("#slashIn").value);
    if (!r.ok) { toast(r.error, true); return; }
    toast(L("Saved: {0} (sent to the guild at the next Sync)", r.slash)); await reload(); return;
  }
  if (t.closest("#guildTitleSave")) {
    const r = await api().cloud_title($("#guildTitleIn").value);
    if (!r.ok) { toast(r.error, true); return; }
    ST.cloud = r.cloud; await reload(); return;
  }
  if (t.closest("#loadRoles")) {
    const r = await api().cloud_roles();
    if (!r.ok) { toast(r.error, true); return; }
    guildRoles = r.roles; renderGuildAdmin(); return;
  }
  if (t.closest("#loadMembers")) { loadMembers(); return; }
  if ((el = t.closest("[data-gflag]"))) {
    const k = el.dataset.gflag, r = await api().set_guild_flags({ [k]: !(ST.guildFlags || {})[k] });
    if (!r.ok) { toast(r.error, true); return; }
    ST.guildFlags = r.flags; renderGuildAdmin(); render(); return;
  }
  if (t.closest("#grantAdd")) { grantDraft = true; renderGuildAdmin(); $("#grantQ").focus(); fillGrantList(); return; }
  if ((el = t.closest("[data-grant]")) || (el = t.closest("[data-ungrant]"))) {
    const on = !!el.dataset.grant;
    const r = await api().cloud_grant(el.dataset.grant || el.dataset.ungrant, on);
    if (!r.ok) { toast(r.error, true); return; }
    guildMembers = r.members; grantDraft = false;
    renderGuildAdmin();
  }
});
$("#guildAdmin").addEventListener("input", e => { if (e.target.id === "grantQ") fillGrantList(); });
$("#guildAdmin").addEventListener("focusin", e => { if (e.target.id === "grantQ") fillGrantList(); });
$("#guildAdmin").addEventListener("keydown", e => {
  if (e.target.id === "grantQ" && e.key === "Enter") { const b = $("#grantList [data-grant]"); if (b) b.click(); }
});
$("#guildAdmin").addEventListener("change", async e => {
  if (e.target.id !== "officerRole") return;
  const r = await api().cloud_officer_role(e.target.value);
  if (!r.ok) { toast(r.error, true); return; }
  ST.cloud = r.cloud; toast(L("Officer role saved.")); await reload();
});

function renderGuildKey() {
  const c = ST.cloud || {}, box = $("#guildKey");
  $("#serverIdRow").hidden = inGuild();
  if (!inGuild()) {
    box.innerHTML = `<p class="help">${L("Log in and choose your guild server (button at the top right) to share the Raid-Helper key with the whole guild.")}</p>`;
    return;
  }
  const g = c.guild, name = g.title || g.name;
  const state = g.raidHelper ? L("Saved on the server for {0}: members don't need a key.", name) : L("No key saved for {0} yet.", name);
  box.innerHTML = `<p class="help">${esc(state)}</p>` + (isOfficer()
    ? `<div class="bgrow"><input id="guildKeyIn" type="password" autocomplete="off" placeholder="${L("Raid-Helper API key")}"><button class="btn small" id="guildKeySave">${L("Save")}</button>${g.raidHelper ? `<button class="btn small danger" id="guildKeyDel">${L("Remove")}</button>` : ""}</div>`
    : `<p class="help">${L("Only the officers can set it.")}</p>`);
}
$("#guildKey").addEventListener("click", async e => {
  const save = e.target.closest("#guildKeySave"), del = e.target.closest("#guildKeyDel");
  if (!save && !del) return;
  const r = await api().cloud_rh_key(del ? "" : $("#guildKeyIn").value);
  if (!r.ok) { toast(r.error, true); return; }
  ST.cloud = r.cloud;
  toast(L(del ? "Raid-Helper key removed from the server." : "Raid-Helper key saved on the server for the guild."));
  renderGuildKey();
});

// ---------- apparence de la guilde : un officier publie la sienne ; chacun peut la reprendre
function renderGuildLook() {
  const box = $("#guildLook");
  if (!inGuild()) { box.innerHTML = ""; return; }
  const local = !!(ST.appearance || {}).local;
  box.innerHTML = `<div class="sec">${L("Guild appearance")}</div>
    <p class="help">${L(local ? "This PC uses its own appearance." : "This PC follows the guild appearance.")}</p>
    <div class="bgrow">${local ? `<button class="btn small" id="useGuildLook" data-help="Drop the settings of this PC and follow the guild appearance (background included).">${L("Use guild appearance")}</button>` : ""}
    ${isOfficer() ? `<button class="btn small" id="publishLook" data-help="Your current appearance and background (the settings of each tab included) become the default of every member who did not change theirs.">${L("Publish as guild appearance")}</button>` : ""}</div>`;
}
// publication : 1er clic -> « Confirm », cliquable après 1,5 s ; annulée au bout de 8 s
let publishArm = null;
$("#guildLook").addEventListener("click", async e => {
  if (e.target.closest("#useGuildLook")) { ST.appearance = await api().use_guild_appearance(); await reload(); return; }
  const pb = e.target.closest("#publishLook");
  if (pb) {
    if (!publishArm) {
      pb.textContent = L("Confirm");
      pb.disabled = true;
      pb.classList.add("confirm");
      publishArm = { ready: false, t1: setTimeout(() => { pb.disabled = false; publishArm.ready = true; }, 1500),
        t2: setTimeout(() => { publishArm = null; renderGuildLook(); }, 8000) };
      return;
    }
    if (!publishArm.ready) return;
    clearTimeout(publishArm.t2);
    publishArm = null;
    renderGuildLook();
    const r = await api().publish_appearance();
    toast(r.ok ? L("Guild appearance published.") : r.error, !r.ok);
  }
});

// ---------- Placement (Assign background) : image entière du raid, fond thématique de la fenêtre dans Assigns
// - zone de fondu (rectangle aux angles adoucis ou ovale) : la partie qui disparaît, avec une intensité réglable ;
// - rectangle de cadrage (angles droits, format de la fenêtre entière) : la partie de l'image qui sert de fond
let fadeRaid = null;
$("#fadeBtn").addEventListener("click", () => {
  $("#fadeEd").hidden = !$("#fadeEd").hidden;
  if (!$("#fadeEd").hidden) renderFadeEd();
});
// cadrage par défaut : toute la hauteur, à gauche (comme sans cadrage)
function defaultView(r) {
  const R = assignPageRatio(), ar = r.fullAspect || 1.5;
  let w = R / ar, h = 1;
  if (w > 1) { w = 1; h = ar / R; }
  return { x: 0, y: 0, w, h };
}
const fpct = v => v * 100 + "%";
const boxStyle = z => `left:${fpct(z.x)};top:${fpct(z.y)};width:${fpct(z.w)};height:${fpct(z.h)}`;
function renderFadeEd() {
  const raids = PHASES.flatMap(p => p.raids);
  if (!raids.length) { $("#fadeEd").innerHTML = ""; return; }
  if (!fadeRaid || !raids.some(r => r.key === fadeRaid)) fadeRaid = (UI.page === "assigns" && curComp && curComp.raid) || raids[0].key;
  const r = raidByKey(fadeRaid), f = r.fade, v = r.view || defaultView(r), ar = r.fullAspect || 1.5;
  $("#fadeEd").innerHTML = `<div class="frow"><select id="fadeRaidSel">${raids.map(x => `<option value="${x.key}"${x.key === fadeRaid ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select>
      <button class="ib${f && f.shape === "rect" ? " on" : ""}" data-fshape="rect" data-help="Rectangle">▭</button>
      <button class="ib${f && f.shape === "circle" ? " on" : ""}" data-fshape="circle" data-help="Circle">◯</button>
      <button class="ib" data-freset="1" data-help="No fade zone">↺</button></div>
    ${f ? `<label class="frow fk" data-help="Low: the image fades progressively from the edge to the center of the shape. High: it disappears right after the edge.">${L("Intensity")}<input type="range" min="0" max="100" data-fk="1" value="${Math.round((f.k ?? 1) * 100)}"></label>` : ""}
    <div class="fadebox" id="fadeBox" style="aspect-ratio:${ar};width:min(100%, ${Math.round(260 * ar)}px)"><img src="${r.fullUrl || ""}" alt="">
      ${f ? `<div class="fadezone ${f.shape}" id="fadeZone" style="${boxStyle(f)}"><span class="handle" id="fadeHandle"></span></div>` : ""}
      <div class="viewzone" id="viewZone" style="${boxStyle(v)}"><span class="vgrip" id="viewGrip">${L("Background")}</span><span class="handle" id="viewHandle"></span></div>
      ${f ? "" : `<div class="fadehint">${L("Choose a shape to place the fade zone.")}</div>`}</div>
    <div class="frow"><span class="help">${L("Blue frame: part of the image used as the window background in Assigns.")}</span><button class="ib" data-vreset="1" data-help="Default background zone">↺</button></div>`;
}
function setRaidField(key, field, value, label) {
  const next = phasesData();
  for (const ph of next) for (const r of ph.raids) if (r.key === key) { if (value) r[field] = value; else delete r[field]; }
  return savePhases(next, label);
}
const setFade = (key, fade) => setRaidField(key, "fade", fade, "Assigns image fade");
$("#fadeEd").addEventListener("change", e => {
  if (e.target.id === "fadeRaidSel") { fadeRaid = e.target.value; renderFadeEd(); }
  if (e.target.dataset.fk) setFade(fadeRaid, { ...raidByKey(fadeRaid).fade, k: +e.target.value / 100 });
});
$("#fadeEd").addEventListener("click", e => {
  const s = e.target.closest("[data-fshape]");
  // zone qui disparaît : par défaut le tiers droit de l'image
  if (s) { const cur = raidByKey(fadeRaid).fade; setFade(fadeRaid, Object.assign({ x: 0.62, y: 0, w: 0.38, h: 1, k: 1 }, cur, { shape: s.dataset.fshape })); return; }
  if (e.target.closest("[data-freset]")) setFade(fadeRaid, null);
  if (e.target.closest("[data-vreset]")) setRaidField(fadeRaid, "view", null, "Assigns background zone");
});
// glisser une zone pour la déplacer, son coin pour la redimensionner ; enregistrée au relâchement.
// Le cadrage garde le format de la page Assigns.
$("#fadeEd").addEventListener("pointerdown", e => {
  const isView = e.target.closest("#viewGrip") || e.target.id === "viewHandle";
  const zone = isView ? $("#viewZone") : e.target.closest("#fadeZone");
  if (!zone) return;
  e.preventDefault();
  const r = raidByKey(fadeRaid), ar = r.fullAspect || 1.5, R = assignPageRatio();
  const box = $("#fadeBox").getBoundingClientRect(), resize = e.target.id === "viewHandle" || e.target.id === "fadeHandle";
  const z = { ...(isView ? (r.view || defaultView(r)) : r.fade) }, start = { ...z }, sx = e.clientX, sy = e.clientY;
  const move = ev => {
    const dx = (ev.clientX - sx) / box.width, dy = (ev.clientY - sy) / box.height;
    if (resize && isView) {
      z.w = Math.max(0.08, Math.min(1 - start.x, start.w + dx, (1 - start.y) * R / ar));
      z.h = z.w * ar / R;
    } else if (resize) {
      z.w = Math.max(0.08, Math.min(1 - start.x, start.w + dx)); z.h = Math.max(0.08, Math.min(1 - start.y, start.h + dy));
    } else {
      z.x = Math.max(0, Math.min(1 - z.w, start.x + dx)); z.y = Math.max(0, Math.min(1 - z.h, start.y + dy));
    }
    zone.style.cssText = boxStyle(z);
  };
  const up = () => {
    document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up);
    if (JSON.stringify(z) === JSON.stringify(start)) return;
    if (isView) setRaidField(fadeRaid, "view", z, "Assigns background zone"); else setFade(fadeRaid, z);
  };
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", up);
});

// Apparence : enregistre et empile l'état précédent
function setAppearance(values, label, noUndo) {
  const prev = {};
  for (const k of Object.keys(values)) prev[k] = ST.appearance[k];
  Object.assign(ST.appearance, values);
  applyAppearance();
  if (!noUndo) pushUndo(label, () => setAppearance(prev, label, true), () => setAppearance(values, label, true));
  return api().save_appearance(values).then(a => { ST.appearance = a; if (values.lang) { setLang(a.lang); render(); } fillSettings(); });
}

// ---------- sliders compacts : « 30% » devant un petit curseur ; clic sur le nombre = saisie (Entrée valide, Échap annule)
const SLIDER = { detAlpha: ["Char details opac/blur", 0.22], detBlur: ["Char details opac/blur", 0], membersAlpha: ["Members Background opac/blur", 0.55],
                 membersBlur: ["Members Background opac/blur", 0.6], compAlpha: ["Comp images", 0.3], listGlass: ["List/Tab Blurred", 0], bgAlpha: ["Background opacity", 0.6],
                 assignAlpha: ["Assigns image", 0.5], tabsAlpha: ["List/Tab opacity", 1], talentBg: ["Talent background", 0.35],
                 charImgA: ["Custom Background opac/blur", 0.5], charImgBlur: ["Custom Background opac/blur", 0],
                 lootAlpha: ["List opac/blur", 0.85], lootBlur: ["List opac/blur", 0],
                 buffInt: ["Buff frame color", 1], buffIconInt: ["Buff icons color", 1] };
// réglages en pixels (champ numérique) : clé -> [libellé, défaut, min, max]
const PXSET = { buffSizeR: ["Raid buff icons size", 16, 10, 32], buffSizeG: ["Group buff icons size", 13, 8, 28], buffBorder: ["Buff frame thickness", 1, 1, 4] };
// réglage d'un onglet : clé « t.<onglet>.<clé> » (appearance.tabs[onglet][clé]) ; sans valeur propre, le réglage général
const tabKey = k => { const m = /^t\.([a-z]+)\.(\w+)$/.exec(k || ""); return m ? { page: m[1], key: m[2] } : null; };
const sliderMeta = k => SLIDER[(tabKey(k) || {}).key || k];
function aGet(k) {
  const t = tabKey(k), a = ST.appearance || {};
  if (t) { const v = ((a.tabs || {})[t.page] || {})[t.key]; return v ?? aGet(t.key); }
  return a[k] ?? (SLIDER[k] ? SLIDER[k][1] : undefined);
}
// valeurs à enregistrer pour une clé (réglage d'un onglet : tout l'objet « tabs », copié)
function aValues(k, v) {
  const t = tabKey(k);
  if (!t) return { [k]: v };
  const tabs = JSON.parse(JSON.stringify((ST.appearance || {}).tabs || {}));
  tabs[t.page] = { ...(tabs[t.page] || {}), [t.key]: v };
  return { tabs };
}
function updateSlider(el) {
  const k = el.dataset.key, meta = sliderMeta(k), v = Math.round((aGet(k) ?? meta[1]) * 100);
  if (!el.firstChild) {
    el.innerHTML = `<span class="pct" tabindex="0"></span><input type="range" min="0" max="100">`;
    const range = el.querySelector("input");
    // champ réellement enregistré (« tabs » pour un réglage d'onglet) : remis tel quel avant l'enregistrement annulable
    const field = tabKey(k) ? "tabs" : k;
    const snap = () => JSON.parse(JSON.stringify(ST.appearance[field] ?? null));
    range.addEventListener("pointerdown", () => { range._start = snap(); range._has = true; });
    range.addEventListener("input", () => {
      if (!range._has) { range._start = snap(); range._has = true; }
      Object.assign(ST.appearance, aValues(k, range.value / 100)); applyAppearance(); el.querySelector(".pct").textContent = range.value + "%";
    });
    range.addEventListener("change", () => {
      const start = range._start; range._has = false;
      if (start === null) delete ST.appearance[field]; else ST.appearance[field] = start;
      range.blur();   // les flèches du clavier ne bougent plus le curseur sans annulation
      setAppearance(aValues(k, range.value / 100), meta[0]);
    });
    el.querySelector(".pct").addEventListener("click", () => editPct(el));
  }
  el.querySelector(".pct").textContent = v + "%";
  el.querySelector("input").value = v;
}
function editPct(el) {
  const k = el.dataset.key, pct = el.querySelector(".pct");
  if (pct.querySelector("input")) return;
  const old = Math.round((aGet(k) ?? 0) * 100);
  pct.innerHTML = `<input value="${old}" maxlength="3">`;
  const inp = pct.querySelector("input");
  inp.focus(); inp.select();
  let done = false;
  const finish = ok => {
    if (done) return;
    done = true;
    const v = Math.max(0, Math.min(100, parseInt(inp.value, 10)));
    pct.textContent = old + "%";
    if (ok && !isNaN(v) && v !== old) setAppearance(aValues(k, v / 100), sliderMeta(k)[0]);
  };
  inp.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); finish(true); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); }
  });
  inp.addEventListener("blur", () => finish(false));
}

// ---------- couleurs
function colorInput(id, key, label) {
  const el = $(id);
  el.addEventListener("focus", () => { el._start = ST.appearance[key]; });
  el.addEventListener("input", () => { ST.appearance[key] = el.value; applyAppearance(); });
  el.addEventListener("change", () => {
    const start = el._start ?? ST.appearance[key];
    ST.appearance[key] = start;
    setAppearance({ [key]: el.value }, label);
    el._start = el.value;
  });
}
colorInput("#apBase", "base", "Base color");
colorInput("#apLockA", "lockA", "Lockout colors");
colorInput("#apLockB", "lockB", "Lockout colors");
colorInput("#apHl", "hl", "Highlight");
colorInput("#apHl2", "hl2", "Highlight");
$("#apHlReset").addEventListener("click", () => setAppearance({ hl: "#6f7cff", hl2: "#3fc7eb" }, "Highlight"));
$("#apHlGrad").addEventListener("click", () => setAppearance({ hlGrad: !ST.appearance.hlGrad }, "Gradient"));
$("#apBaseReset").addEventListener("click", () => setAppearance({ base: "#1e1f24" }, "Base color"));
$("#apLockReset").addEventListener("click", () => setAppearance({ lockA: "#0e0f12", lockB: "#34363e" }, "Lockout colors"));
$("#apLang").addEventListener("click", () => setAppearance({ lang: LANG === "fr" ? "en" : "fr" }, "Language"));

// ---------- apparence d'un onglet : engrenage de la barre indicateur -> fenêtre avec les réglages qui touchent cet
// onglet ; ceux qui touchent tous les onglets (fond, barre d'onglets) y sont propres à l'onglet (appearance.tabs)
const PAGE_NAME = { calendar: "Calendar", comps: "Compos", assigns: "Assigns", members: "Members", loots: "Loots", craft: "Craft" };
let tlPage = null;
function tabLookHtml(page) {
  const a = ST.appearance || {};
  const help = t => `data-help="${esc(L(t))}"`;
  const sl = (label, keys, h) => `<div class="srow${keys.length > 1 ? " two" : ""}" ${help(h)}><span class="sl">${L(label)}</span>${keys.map(k => `<span class="slider" data-key="${k}"></span>`).join("")}</div>`;
  const sw = (label, key, on, h) => `<div class="srow" ${help(h)}><span class="sl">${L(label)}</span><button class="switch${on ? " on" : ""}" data-tlsw="${key}"><i></i></button></div>`;
  const own = k => `t.${page}.${k}`;
  let h = sl("Background opacity", [own("bgAlpha")], "Opacity of the window background image in this tab only.")
    + sl("List/Tab opac/blur", [own("tabsAlpha"), own("listGlass")], "Opacity and blur of the tab bar (and of the list of this tab) in this tab only.");
  if (page === "calendar") h += `<div class="srow" ${help("Alternate lockout weeks in the calendar (Wednesday to Tuesday).")}><span class="sl">${L("Lockouts")}</span>
      <input type="color" data-tlcol="lockA" value="${esc(a.lockA || "#0e0f12")}"><input type="color" data-tlcol="lockB" value="${esc(a.lockB || "#34363e")}"></div>`;
  const px = (key, h) => { const [label, def, lo, hi] = PXSET[key];
    return `<div class="srow" ${help(h)}><span class="sl">${L(label)}</span><span class="tlpx"><input type="number" class="tlnum" data-tlnum="${key}" min="${lo}" max="${hi}" value="${esc(a[key] ?? def)}"> px</span></div>`; };
  if (page === "comps") h += sl("Comp images", ["compAlpha"], "Opacity of the raid image behind each comp.")
    + px("buffSizeR", "Size of the raid buff and debuff icons (pixels).") + px("buffSizeG", "Size of the buff icons of each group (pixels).")
    + px("buffBorder", "Thickness of the green / red frame around the buff icons (pixels).")
    + sl("Buff frame color", ["buffInt"], "Intensity of the green / red frame color: 100% = normal, 0% = black.")
    + sl("Buff icons color", ["buffIconInt"], "Intensity of the buff icon colors: 100% = normal, 0% = black.");
  if (page === "assigns") h += sw("Assign's Thematic Background", "assignNoBg", !!a.assignNoBg, "In the Assigns tab, the window background becomes the image of the raid instead of the general background.")
    + `<div class="srow" ${help("Place the raid image behind the whole window (blue frame) and the zone that fades out.")}><span class="sl">${L("Assign background")}</span><button class="btn small" data-tlplace="1">${L("Placement")}</button></div>`;
  if (page === "members") {
    h += sl("Members Background opac/blur", ["membersAlpha", "membersBlur"], "Members: opacity and blur of the background of the character list.")
      + sl("Char details opac/blur", ["detAlpha", "detBlur"], "Members, character details: opacity and blur of the frames of the talents and of the attendance.")
      + sl("Talent background", ["talentBg"], "Opacity of the talent tree backgrounds (Members, character details).")
      + sw("Members custom background", "charImgOn", !a.charImgOff, "Show the background pictures chosen by the players for their characters (Members, character details).");
    if (!a.charImgOff) h += sl("Custom Background opac/blur", ["charImgA", "charImgBlur"], "Opacity and blur of the background picture of a character, and opacity of the background of the character details.");
  }
  if (page === "loots") h += sl("List opac/blur", ["lootAlpha", "lootBlur"], "Opacity and blur of the item lines (History), of the raid and boss bars (Boss) and of the player frames (Player).")
    + `<div class="sec">${L("Phases & Raids")}</div><div id="tlPhaseSlot"></div>`;
  return h;
}
function renderTabLook() {
  const w = $("#tabLookWin");
  tlPage = UI.page;
  $("#tlTitle").textContent = L("Appearance") + " · " + L(PAGE_NAME[tlPage] || tlPage);
  if ($("#tlBody").contains(document.activeElement) && document.activeElement.type === "color") return;
  phaseEdHome();
  $("#tlBody").innerHTML = tabLookHtml(tlPage);
  // onglet Loots : éditeur des phases et raids (boss, bannières, barres) ici aussi
  if (tlPage === "loots") {
    const ro = ST.canEdit === false || ST.canAdmin === false;
    $("#tlPhaseSlot").innerHTML = ro ? `<p class="help">${L("Only officers can edit the phases and raids.")}</p>` : "";
    if (!ro) { $("#tlPhaseSlot").appendChild($("#phaseEd")); renderPhaseEditor(); }
  }
  w.querySelectorAll(".slider").forEach(updateSlider);
  updateUndo();
}
// onglet changé fenêtre ouverte : ses réglages à lui
function syncTabLook() { if (!$("#tabLookWin").hidden && tlPage !== UI.page) renderTabLook(); }
function toggleTabLook(show) {
  const w = $("#tabLookWin");
  show = show ?? w.hidden;
  if (show) {
    const p = UI.tlWin || { x: innerWidth - 430, y: 96 };
    Object.assign(w.style, { left: Math.max(0, Math.min(p.x, innerWidth - 410)) + "px", top: Math.max(0, Math.min(p.y, innerHeight - 120)) + "px" });
    w.hidden = false;
    renderTabLook();
  } else w.hidden = true;
  hideTip();
}
$("#tabLookBtn").addEventListener("click", () => toggleTabLook());
$("#tlClose").addEventListener("click", () => toggleTabLook(false));
$("#tlUndo").addEventListener("click", () => settingsUndo(false));
$("#tlRedo").addEventListener("click", () => settingsUndo(true));
$("#tlBar").addEventListener("pointerdown", e => {
  if (e.target.closest("button")) return;
  e.preventDefault();
  const w = $("#tabLookWin"), sx = e.clientX, sy = e.clientY, x0 = w.offsetLeft, y0 = w.offsetTop;
  const move = ev => { UI.tlWin = { x: x0 + ev.clientX - sx, y: y0 + ev.clientY - sy }; w.style.left = UI.tlWin.x + "px"; w.style.top = UI.tlWin.y + "px"; };
  const up = () => { document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); saveUI(); };
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", up);
});
$("#tlBody").addEventListener("click", e => {
  const s = e.target.closest("[data-tlsw]");
  if (s) {
    const k = s.dataset.tlsw;
    if (k === "charImgOn") setAppearance({ charImgOff: !ST.appearance.charImgOff }, "Members custom background");
    else setAppearance({ [k]: !ST.appearance[k] }, k === "assignNoBg" ? "Assign's Thematic Background" : k);
    return;
  }
  // placement de l'image du raid : éditeur des Settings (onglet Appearance)
  if (e.target.closest("[data-tlplace]")) {
    toggleSettings(true); showSetTab("appearance");
    $("#fadeEd").hidden = false; renderFadeEd();
    $("#fadeEd").scrollIntoView({ block: "nearest" });
  }
});
$("#tlBody").addEventListener("input", e => {
  const c = e.target.closest("[data-tlcol]");
  if (!c) return;
  if (c._start === undefined) c._start = ST.appearance[c.dataset.tlcol];
  ST.appearance[c.dataset.tlcol] = c.value; applyAppearance();
});
$("#tlBody").addEventListener("change", e => {
  const c = e.target.closest("[data-tlcol]");
  if (!c) return;
  const k = c.dataset.tlcol, start = c._start ?? ST.appearance[k];
  c._start = undefined;
  ST.appearance[k] = start;
  setAppearance({ [k]: c.value }, "Lockout colors");
});
// champs en pixels (Raid Comps) : Entrée / sortie du champ = enregistré, borné
$("#tlBody").addEventListener("change", e => {
  const c = e.target.closest("[data-tlnum]");
  if (!c) return;
  const [label, def, lo, hi] = PXSET[c.dataset.tlnum];
  const v = Math.max(lo, Math.min(hi, Math.round(+c.value || def)));
  c.value = v;
  setAppearance({ [c.dataset.tlnum]: v }, label);
});
$("#apNoBg").addEventListener("click", () => setAppearance({ assignNoBg: !ST.appearance.assignNoBg }, "Assign's Thematic Background"));
$("#apCharImg").addEventListener("click", () => setAppearance({ charImgOff: !ST.appearance.charImgOff }, "Members custom background"));

// ---------- image de fond
$("#bgPick").addEventListener("click", async () => {
  const res = await api().pick_background();
  if (!res) return;
  openCrop(res, "Window background", "The frame has the shape of the window.", async rect => {
    const r = await api().save_background(rect);
    if (!r.ok) { toast(r.error, true); return false; }
    pushUndo("Background image", async () => { await api().restore_background(r.undo); await reload(); });
    await reload();
    toast(L("Background saved. In game: /reload (restart the game the first time)."));
    return true;
  });
});
$("#bgRemove").addEventListener("click", async () => {
  const r = await api().default_background();
  pushUndo("Background image", async () => { await api().restore_background(r.undo); await reload(); });
  await reload();
});

// ---------- Raid-Helper, Discord : enregistrement à chaque changement
document.querySelectorAll("#settingsWin [data-cfg]").forEach(el => {
  el.addEventListener("change", () => {
    const k = el.dataset.cfg, v = k === "autoSyncMinutes" ? (+el.value || 0) : el.value.trim();
    saveCfg(k, v, true);
  });
});
async function saveCfg(k, v, undoable) {
  const prev = ST.config[k];
  if (prev === v) return;
  if (undoable) pushUndo(k === "webhooks" ? "Discord channels" : "Connection settings", () => saveCfg(k, prev, false));
  ST.config[k] = v;
  await api().save_config({ [k]: v });
  await reload();
}
function hookRow(h) {
  return `<div class="hook"><input class="hn" placeholder="${L("Name (#channel)")}" value="${esc(h.name || "")}"><input class="hu" placeholder="https://discord.com/api/webhooks/..." value="${esc(h.url || "")}">
    <button class="ib ht" data-help="Test">✓</button><button class="ib hd" data-help="Delete">×</button></div>`;
}
function readHooks() {
  return [...document.querySelectorAll("#hooks .hook")]
    .map(r => ({ name: r.querySelector(".hn").value.trim(), url: r.querySelector(".hu").value.trim() }))
    .filter(h => h.url);
}
$("#addHook").addEventListener("click", () => { $("#hooks").insertAdjacentHTML("beforeend", hookRow({})); $("#hooks .hook:last-child .hn").focus(); });
$("#hooks").addEventListener("change", () => saveCfg("webhooks", readHooks(), true));
$("#hooks").addEventListener("click", e => {
  const row = e.target.closest(".hook");
  if (e.target.closest(".hd")) { row.remove(); saveCfg("webhooks", readHooks(), true); }
  if (e.target.closest(".ht")) {
    api().check_webhook(row.querySelector(".hu").value.trim()).then(r => {
      if (r.ok) { toast(L('Webhook OK: "{0}"', r.name)); const n = row.querySelector(".hn"); if (!n.value) { n.value = r.name; saveCfg("webhooks", readHooks(), true); } }
      else toast(r.error, true);
    });
  }
});

// ------------------------------------------------------------------ recadrage (fond, raids, cartes et icônes d'assigns)
let crop = null, cropDone = null;
// fx : curseurs Opacity / Blurred (image d'une barre de raid, bannière d'un boss), valeurs de départ dans init (a, b)
function openCrop(res, title, help, onSave, round, init, fx) {
  $("#cropFx").hidden = !fx;
  $("#cropA").value = Math.round(((init && init.a) ?? 1) * 100);
  $("#cropB").value = Math.round(((init && init.b) ?? 0) * 100);
  cropFxPreview();
  $("#cropTitle").textContent = L(title);
  $("#cropHelp").textContent = L("Drag the frame to choose the visible part of the image, drag its corner or use the wheel to resize it.") + " " + L(help);
  $("#cropRect").classList.toggle("round", !!round);
  cropDone = onSave;
  const img = $("#cropImg");
  img.onload = () => {
    const W = img.clientWidth, H = img.clientHeight, R = res.ratio;
    let w = W, h = W / R;
    if (h > H) { h = H; w = H * R; }
    crop = { W, H, R, x: (W - w) / 2, y: (H - h) / 2, w, h };
    if (init && init.w) {
      w = Math.min(init.w * W, W, H * R); h = w / R;
      crop = { W, H, R, w, h, x: Math.min(Math.max(0, init.x * W), W - w), y: Math.min(Math.max(0, (init.y + init.h / 2) * H - h / 2), H - h) };
    }
    drawCrop();
  };
  img.src = res.url;
  $("#cropModal").hidden = false;
}
// aperçu de l'opacité et du flou sur l'image de l'outil
function cropFxPreview() {
  const on = !$("#cropFx").hidden, a = $("#cropA").value, b = $("#cropB").value;
  $("#cropAv").textContent = a + "%";
  $("#cropBv").textContent = b + "%";
  $("#cropImg").style.opacity = on ? a / 100 : "";
  $("#cropImg").style.filter = on && +b ? `blur(${(b / 10).toFixed(1)}px)` : "";
}
$("#cropA").addEventListener("input", cropFxPreview);
$("#cropB").addEventListener("input", cropFxPreview);
function drawCrop() {
  Object.assign($("#cropRect").style, { left: crop.x + "px", top: crop.y + "px", width: crop.w + "px", height: crop.h + "px" });
}
$("#cropRect").addEventListener("pointerdown", e => {
  e.stopPropagation(); e.preventDefault();
  const resize = e.target.id === "cropHandle", sx = e.clientX, sy = e.clientY, start = { ...crop };
  const move = ev => {
    const dx = ev.clientX - sx, dy = ev.clientY - sy;
    if (resize) {
      let w = Math.max(40, start.w + Math.max(dx, dy * crop.R));
      w = Math.min(w, crop.W - start.x, (crop.H - start.y) * crop.R);
      crop.w = w; crop.h = w / crop.R;
    } else {
      crop.x = Math.min(Math.max(0, start.x + dx), crop.W - crop.w);
      crop.y = Math.min(Math.max(0, start.y + dy), crop.H - crop.h);
    }
    drawCrop();
  };
  const up = () => { document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); };
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", up);
});
$("#cropBox").addEventListener("wheel", e => {
  if (!crop) return;
  e.preventDefault();
  const box = $("#cropBox").getBoundingClientRect();
  const mx = e.clientX - box.left, my = e.clientY - box.top;
  const w = Math.min(Math.max(40, crop.w * (e.deltaY < 0 ? 0.9 : 1.1)), crop.W, crop.H * crop.R), h = w / crop.R;
  const rx = (mx - crop.x) / crop.w, ry = (my - crop.y) / crop.h;
  crop.x = Math.min(Math.max(0, mx - rx * w), crop.W - w);
  crop.y = Math.min(Math.max(0, my - ry * h), crop.H - h);
  crop.w = w; crop.h = h;
  drawCrop();
}, { passive: false });
$("#cropSave").addEventListener("click", async () => {
  const rect = { x: crop.x / crop.W, y: crop.y / crop.H, w: crop.w / crop.W, h: crop.h / crop.H };
  if (!$("#cropFx").hidden) Object.assign(rect, { a: $("#cropA").value / 100, b: $("#cropB").value / 100 });
  const ok = await cropDone(rect);
  if (ok !== false) $("#cropModal").hidden = true;
});

// Petite fenêtre de saisie (champs texte / choix / bouton d'image) : resolve(valeurs) ou null
function ask(title, fields) {
  return new Promise(resolve => {
    $("#askTitle").textContent = L(title);
    const vals = {};
    $("#askForm").innerHTML = fields.map((f, i) => {
      vals[f.key] = f.value ?? "";
      if (f.type === "select") return `<label>${L(f.label)}<select data-k="${f.key}">${f.options.map(o => `<option${String(o) === String(f.value) ? " selected" : ""}>${o}</option>`).join("")}</select></label>`;
      if (f.type === "image") return `<label>${L(f.label)}<span class="bgrow"><button class="btn small" data-img="${i}">${L("Upload picture")}</button><span class="help" data-imgstate="${f.key}">${f.value ? L("Picture set") : L("No picture")}</span></span></label>`;
      return `<label>${L(f.label)}<input data-k="${f.key}" value="${esc(f.value || "")}" autocomplete="off"></label>`;
    }).join("");
    const close = v => { $("#askModal").hidden = true; $("#askOk").onclick = null; obs.disconnect(); resolve(v); };
    $("#askForm").onclick = async e => {
      const b = e.target.closest("[data-img]");
      if (!b) return;
      e.preventDefault();
      const f = fields[+b.dataset.img];
      const v = await f.pick(collect());
      if (v) { vals[f.key] = v; $(`[data-imgstate="${f.key}"]`).textContent = L("Picture set"); }
    };
    const collect = () => { $("#askForm").querySelectorAll("[data-k]").forEach(el => { vals[el.dataset.k] = el.value.trim(); }); return vals; };
    $("#askOk").onclick = () => close(collect());
    $("#askForm").onkeydown = e => { if (e.key === "Enter" && e.target.tagName === "INPUT") { e.preventDefault(); close(collect()); } };
    // fermeture par Annuler / Échap
    const obs = new MutationObserver(() => { if ($("#askModal").hidden) close(null); });
    $("#askModal").hidden = false;
    obs.observe($("#askModal"), { attributes: true, attributeFilter: ["hidden"] });
    const first = $("#askForm input");
    if (first) first.focus();
  });
}

// ------------------------------------------------------------------ éditeur de phases et de raids
let edPhase = null;   // phase affichée dans l'éditeur (la phase courante par défaut)
const phasesData = () => ST.phases.map(p => ({ name: p.name, raids: p.raids.map(r => ({ ...r, ...(r.bosses ? { bosses: r.bosses.map(b => ({ ...b })) } : {}) })) }));
let edBoss = null;   // raid dont on édite les boss (clé)
async function savePhases(next, label, noUndo) {
  const prev = phasesData();
  if (!noUndo) pushUndo(label, () => savePhases(prev, label, true), () => savePhases(next, label, true));
  ST.phases = await api().save_phases(next);
  await reload();
}
function renderPhaseEditor() {
  // phases et raids : officiers seulement quand on est connecté à une guilde
  const ro = ST.canEdit === false || ST.canAdmin === false;
  $("#phasesRO").hidden = !ro;
  $("#phaseEd").hidden = ro;
  $("#fadeBtn").disabled = ro;
  if (ro) { $("#fadeEd").hidden = true; return; }
  if (edPhase === null || edPhase >= ST.phases.length) edPhase = Math.min(UI.phase, ST.phases.length - 1);
  const ph = ST.phases[edPhase];
  const opts = ST.phases.map((p, i) => `<option value="${i}"${i === edPhase ? " selected" : ""}>${esc(p.name)}</option>`).join("");
  const rows = ph.raids.map((r, i) => {
    const img = r.custom ? (ST.raidImages[r.key] || {}).bg : `img/bg_${r.key}.jpg`;
    return `<div class="praid" data-ri="${i}"><span class="grip6" data-rgrip="${i}"></span>
      <span class="pthumb"${img ? ` style="background-image:url('${img}')"` : ""}></span><span class="pn">${esc(r.name)}</span><span class="ps">${r.size}</span>
      <button class="ibw${edBoss === r.key ? " on" : ""}" data-rboss="${i}" data-help="Bosses of this raid (Loots tab, Boss view): loots picked up on a known boss go to its list">${L("Bosses")} ${(r.bosses || []).length}</button>
      ${img ? `<button class="ib" data-rbar="${i}" data-help="Crop the picture on the raid bar (Loots tab, Tables)">⛶</button>` : ""}
      ${r.custom ? `<button class="ib" data-rimg="${i}" data-help="Change picture">▣</button>` : ""}<button class="ib" data-rdel="${i}" data-help="Remove from this phase">×</button></div>`
      + (edBoss === r.key ? bossEdHtml(r) : "");
  }).join("");
  // une phase vide (sans raid) peut être supprimée, s'il en reste au moins une
  const del = !ph.raids.length && ST.phases.length > 1 ? '<button class="ib" id="edPhaseDel" data-help="Delete this empty phase">×</button>' : "";
  $("#phaseEd").innerHTML = `<div class="phrow"><select id="edPhaseSel">${opts}</select><button class="ib" id="edPhaseAdd" data-help="Add a phase">+</button>${del}</div>
    <div class="praids" id="edRaids">${rows || `<div class="help">${L("No raid in this phase.")}</div>`}</div>
    <button class="btn small" id="edNewRaid">${L("New Raid")}</button>`;
  placeCrops($("#phaseEd"));
}
$("#phaseEd").addEventListener("change", e => {
  if (e.target.id === "edPhaseSel") { edPhase = +e.target.value; renderPhaseEditor(); }
  // nom d'un boss changé
  if (e.target.dataset.bname !== undefined) {
    const v = e.target.value.trim();
    if (v) editBosses(list => { list[+e.target.dataset.bname].name = v; }, "Boss name");
  }
});
// Boss d'un raid : nom + icône ronde (même image que les icônes de boss d'Assigns) ; « Trash » existe toujours
function bossEdHtml(r) {
  const rows = (r.bosses || []).map((b, j) => {
    const img = b.img && imgUrl(b.img);
    const ban = b.banner && imgUrl(b.banner);
    return `<div class="bossrow"><span class="bthumb"${img ? ` style="background-image:url('${img}')"` : ""}></span>
      <input data-bname="${j}" value="${esc(b.name)}" autocomplete="off"><button class="ib" data-bimg="${j}" data-help="Change picture">▣</button>
      <span class="bnr"${ban ? ` data-cimg="${esc(ban)}" data-crop="${cropAttr(b.bcrop)}"` : ""} data-help="Banner of the boss button (Loots tab, Tables)"></span>
      <button class="ib" data-bban="${j}" data-help="Choose the banner (Loots tab, Tables)">🖼</button>
      ${ban ? `<button class="ib" data-bbcrop="${j}" data-help="Crop the banner again">⛶</button>` : ""}
      <button class="ib" data-bup="${j}" data-help="Move up">↑</button><button class="ib" data-bdel="${j}" data-help="Remove this boss">×</button></div>`;
  }).join("");
  return `<div class="bossed">${rows}<div class="bossrow trash"><span class="bthumb"></span><span>${L("Trash")}</span><span class="help">${L("Epic soulbound loots without a known boss")}</span></div>
    <button class="btn small" id="bossAdd">${L("Add boss")}</button></div>`;
}
function bossEdRefresh() { if (edBoss && !$("#phaseEd").hidden) renderPhaseEditor(); }
function editBosses(fn, label) {
  const next = phasesData();
  const r = next[edPhase].raids.find(x => x.key === edBoss);
  if (!r) return;
  r.bosses = r.bosses || [];
  fn(r.bosses, r);
  r.bosses = r.bosses.filter(b => b && b.name);
  return savePhases(next, label);
}
// recadrage d'une image déjà là (url) au format demandé ; rect (fractions) ou null si annulé
function cropOn(url, ratio, title, help, init) {
  return new Promise(resolve => {
    let done = false;
    openCrop({ url, ratio }, title, help, rect => { done = true; resolve(rect); return true; }, false, init, true);
    const obs = new MutationObserver(() => { if ($("#cropModal").hidden) { obs.disconnect(); if (!done) resolve(null); } });
    obs.observe($("#cropModal"), { attributes: true, attributeFilter: ["hidden"] });
  });
}
const BANNER_HELP = "Frame = the closed boss button. Opened, the button shows more of the picture above and below this frame (narrower if the picture is not tall enough).";
// bannière d'un boss : image entière gardée par l'exe, cadrage au format du bouton fermé
async function pickBossBanner(raidKey) {
  const res = await api().pick_image(BOSS_BTN_SHUT_W / BOSS_BTN_H);
  if (!res) return null;
  const rect = await cropOn(res.url, res.ratio, "Boss banner", BANNER_HELP);
  if (!rect) return null;
  const r = await api().save_boss_banner(raidKey);
  if (!r.ok) { toast(r.error, true); return null; }
  IMG[r.id] = r.url;
  return { banner: r.id, bcrop: rect };
}
async function pickBossImage(raidKey) {
  const res = await api().pick_image(1);
  if (!res) return null;
  return new Promise(resolve => {
    openCrop(res, "Boss icon", "Round icon.", async rect => {
      const r = await api().save_assign_image("boss", rect, raidKey);
      if (!r.ok) { toast(r.error, true); return false; }
      IMG[r.id] = r.url;
      resolve(r.id);
      return true;
    }, true);
    const obs = new MutationObserver(() => { if ($("#cropModal").hidden) { obs.disconnect(); resolve(null); } });
    obs.observe($("#cropModal"), { attributes: true, attributeFilter: ["hidden"] });
  });
}
$("#phaseEd").addEventListener("click", async e => {
  let el;
  if (e.target.closest("#edPhaseAdd")) {
    const next = phasesData();
    next.push({ name: "Phase " + (next.length + 1), raids: [] });
    edPhase = next.length - 1;
    await savePhases(next, "Phases");
    return;
  }
  if (e.target.closest("#edPhaseDel")) {
    const next = phasesData();
    next.splice(edPhase, 1);
    // les phases suivantes sont renumérotées (« Phase N » par défaut)
    next.forEach((p, i) => { if (/^Phase \d+$/.test(p.name)) p.name = "Phase " + (i + 1); });
    if (UI.phase >= next.length) UI.phase = next.length - 1;
    edPhase = Math.min(edPhase, next.length - 1);
    await savePhases(next, "Phases");
    return;
  }
  if (e.target.closest("#edNewRaid")) return newRaid();
  if ((el = e.target.closest("[data-rboss]"))) {
    const key = ST.phases[edPhase].raids[+el.dataset.rboss].key;
    edBoss = edBoss === key ? null : key;
    renderPhaseEditor();
    return;
  }
  if (e.target.closest("#bossAdd")) {
    let img = null;
    const v = await ask("New boss", [
      { key: "name", label: "Boss name" },
      { key: "img", label: "Picture", type: "image", pick: async () => { img = await pickBossImage(edBoss) || img; return !!img; } },
    ]);
    if (v && v.name) await editBosses(list => { list.push(Object.assign({ name: v.name }, img ? { img } : {})); }, "New boss");
    return;
  }
  if ((el = e.target.closest("[data-bimg]"))) {
    const img = await pickBossImage(edBoss);
    if (img) await editBosses(list => { list[+el.dataset.bimg].img = img; }, "Boss picture");
    return;
  }
  if ((el = e.target.closest("[data-bban]"))) {
    const v = await pickBossBanner(edBoss);
    if (v) await editBosses(list => { Object.assign(list[+el.dataset.bban], v); }, "Boss banner");
    return;
  }
  if ((el = e.target.closest("[data-bbcrop]"))) {
    const r = ST.phases[edPhase].raids.find(x => x.key === edBoss), b = r && (r.bosses || [])[+el.dataset.bbcrop];
    const url = b && b.banner && (IMG[b.banner] || await api().assign_image(b.banner));
    const rect = url && await cropOn(url, BOSS_BTN_SHUT_W / BOSS_BTN_H, "Boss banner", BANNER_HELP, b.bcrop);
    if (rect) await editBosses(list => { list[+el.dataset.bbcrop].bcrop = rect; }, "Boss banner");
    return;
  }
  if ((el = e.target.closest("[data-rbar]"))) {
    const i = +el.dataset.rbar, r = ST.phases[edPhase].raids[i], url = raidBgUrl(r);
    // format de la barre d'un raid replié (4 fois la hauteur d'une barre dépliée) ; déplié : bande du milieu de ce cadrage
    const bar = document.querySelector(".lraidb"), ratio = bar && bar.clientWidth ? bar.clientWidth / RAID_BAR_H : RAID_BAR_RATIO;
    const rect = url && await cropOn(url, ratio, "Raid bar", "Part of the raid picture shown on its bar (Loots tab, Tables).", r.bar);
    if (rect) { const next = phasesData(); next[edPhase].raids[i].bar = rect; await savePhases(next, "Raid bar"); }
    return;
  }
  if ((el = e.target.closest("[data-bup]"))) {
    const j = +el.dataset.bup;
    if (j > 0) await editBosses(list => { list.splice(j - 1, 0, list.splice(j, 1)[0]); }, "Boss order");
    return;
  }
  if ((el = e.target.closest("[data-bdel]"))) { await editBosses(list => { list.splice(+el.dataset.bdel, 1); }, "Remove boss"); return; }
  if ((el = e.target.closest("[data-rdel]"))) {
    const next = phasesData();
    next[edPhase].raids.splice(+el.dataset.rdel, 1);
    await savePhases(next, "Phases");
    return;
  }
  if ((el = e.target.closest("[data-rimg]"))) {
    const r = ST.phases[edPhase].raids[+el.dataset.rimg];
    const pic = await raidPicture(r.key, r.size, r.name);
    if (pic) {
      const next = phasesData();
      Object.assign(next[edPhase].raids[+el.dataset.rimg], picFields(pic));
      await savePhases(next, "Raid picture");
    }
  }
});
const picFields = r => ({ img: true, tex: r.tex, full: true, fullAspect: r.fullAspect });
// Image d'un raid : l'image entière est gardée (fond d'Assigns) ; une copie recadrée au format du cadre de compo
// (10, 20 ou 40) sert aux compos ; texture de l'addon « Phase1_MountHyjal » → resolve(résultat) ou null
async function raidPicture(key, size, name) {
  const res = await api().pick_image(ST.raidRatio[size] || 1.25);
  if (!res) return null;
  return new Promise(resolve => {
    openCrop(res, "Raid picture", "The frame has the shape of the comp. The whole picture is kept for the Assigns page.", async rect => {
      const r = await api().save_raid_image(key, size, rect, edPhase + 1, name);
      if (!r.ok) { toast(r.error, true); return false; }
      resolve(r);
      return true;
    });
    // annulation du recadrage
    const obs = new MutationObserver(() => { if ($("#cropModal").hidden) { obs.disconnect(); resolve(null); } });
    obs.observe($("#cropModal"), { attributes: true, attributeFilter: ["hidden"] });
  });
}
async function newRaid() {
  const key = "r" + Date.now().toString(36);
  let pic = null;
  const v = await ask("New Raid", [
    { key: "name", label: "Raid Name" },
    { key: "size", label: "Max Players", type: "select", options: [10, 20, 40], value: 20 },
    { key: "img", label: "Picture", type: "image", pick: async cur => { pic = await raidPicture(key, +cur.size || 20, cur.name || "Raid") || pic; return !!pic; } },
  ]);
  if (!v || !v.name) return;
  const size = +v.size || 20;
  const next = phasesData();
  next[edPhase].raids.push(Object.assign({ key, name: v.name, short: v.name.split(/\s+/).pop(), size, aspect: ST.raidRatio[size], custom: true },
    pic ? picFields(pic) : {}));
  await savePhases(next, "New Raid");
}
// Glisser la poignée à six points : réordonne les raids de la phase (ordre de la tuile « + »)
$("#phaseEd").addEventListener("pointerdown", e => {
  const g = e.target.closest("[data-rgrip]");
  if (!g) return;
  e.preventDefault();
  const from = +g.dataset.rgrip, list = $("#edRaids"), rows = [...list.querySelectorAll(".praid")];
  rows[from].classList.add("drag");
  const line = document.createElement("div");
  line.className = "rinsert";
  list.appendChild(line);
  let to = from;
  const move = ev => {
    to = rows.length;
    for (let i = 0; i < rows.length; i++) { const r = rows[i].getBoundingClientRect(); if (ev.clientY < r.top + r.height / 2) { to = i; break; } }
    const lr = list.getBoundingClientRect();
    const y = to < rows.length ? rows[to].getBoundingClientRect().top : rows[rows.length - 1].getBoundingClientRect().bottom;
    line.style.top = y - lr.top + list.scrollTop - 1 + "px";
  };
  const up = async () => {
    document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up);
    line.remove(); rows[from].classList.remove("drag");
    const dest = to > from ? to - 1 : to;
    if (dest === from) return;
    const next = phasesData(), raids = next[edPhase].raids;
    raids.splice(dest, 0, raids.splice(from, 1)[0]);
    await savePhases(next, "Raid order");
  };
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", up);
});
