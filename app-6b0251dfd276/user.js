"use strict";
// Bouton du compte (à droite de Settings) : login Discord, choix du serveur de guilde (rôles), déconnexion,
// et comptes WoW lus (plusieurs comptes Battle.net, toutes les licences d'un compte). Menu fixe sous le bouton.

const avatarUrl = u => u && u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64` : null;
const guildIcon = g => g && g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64` : null;
const roleColor = r => r && r.color ? "#" + r.color.toString(16).padStart(6, "0") : null;
let pickingGuild = false, cloudBusy = false;

function renderUserBtn() {
  const c = ST.cloud || {}, u = c.logged && c.user;
  const name = u ? ((c.member && c.member.nick) || u.globalName || u.username) : L("Login");
  $("#userName").textContent = name;
  const img = $("#userAvatar"), url = avatarUrl(u);
  img.hidden = !url;
  if (url) img.src = url;
}

const EYE = '<svg viewBox="0 0 24 24"><path d="M12 5C6.5 5 2.7 9.4 1.5 12c1.2 2.6 5 7 10.5 7s9.3-4.4 10.5-7C21.3 9.4 17.5 5 12 5zm0 11.5A4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 0 1 0 9zm0-2.3a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4z"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24"><path d="M3.3 2 2 3.3l3.3 3.3C3.4 8 2.1 10.1 1.5 12c1.2 2.6 5 7 10.5 7 1.9 0 3.6-.5 5-1.3l3.7 3.7 1.3-1.3zM12 16.5A4.5 4.5 0 0 1 7.6 11l1.8 1.8a2.2 2.2 0 0 0 2.8 2.8l1.8 1.8c-.6.2-1.3.3-2 .3zM12 5c5.5 0 9.3 4.4 10.5 7-.6 1.3-1.6 2.9-3 4.2l-3.2-3.2a4.5 4.5 0 0 0-5.3-5.3L8.6 5.3C9.7 5.1 10.8 5 12 5z"/></svg>';
// icônes du menu (trait, couleur du texte) : déconnexion (porte + flèche), changement de serveur (base + synchro), dossier
const LOGOUT_SVG = '<svg viewBox="0 0 24 24"><path d="M4.5 4.6c0-.7.5-1.2 1.1-1.3L10.5 2.5v19l-4.9-.8c-.6-.1-1.1-.6-1.1-1.3z"/><path d="M8 11v2"/><path d="M13 3.5h4a1.5 1.5 0 0 1 1.5 1.5v3.5"/><path d="M18.5 15.5V19a1.5 1.5 0 0 1-1.5 1.5h-4"/><path d="M12 12h10"/><path d="M19 9l3 3-3 3"/></svg>';
const SERVER_SVG = '<svg viewBox="0 0 24 24"><ellipse cx="11" cy="5.5" rx="7.5" ry="2.8"/><path d="M3.5 5.5v13c0 1.5 3.4 2.8 7.5 2.8"/><path d="M18.5 5.5v4.5"/><path d="M3.5 12c0 1.5 3.4 2.8 7.5 2.8"/><path d="M14.6 16.4a3.6 3.6 0 0 1 6.4-.9"/><path d="M21.2 13.4v2.4h-2.4"/><path d="M21.4 19a3.6 3.6 0 0 1-6.4.9"/><path d="M14.8 22v-2.4h2.4"/></svg>';
const FOLDER_SVG = '<svg viewBox="0 0 24 24"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.2l2 2.2h8.8A1.5 1.5 0 0 1 21 8.7v9.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/></svg>';
// compte avec « All licences » : affiché sans son « #n » tant que la liste est fermée
const bnetOf = f => String(f || "").split("#")[0];

function wowAccRowsHtml() {
  const accs = (ST.wowAccounts && ST.wowAccounts.length) ? ST.wowAccounts : [{ folder: "", all: false }];
  return accs.map((a, i) => `<div class="uacc">
      <select data-uacc="${i}" data-all="${a.all ? 1 : 0}">${["", ...ST.accounts].map(f => `<option value="${esc(f)}" data-full="${esc(f || "—")}"${f === a.folder ? " selected" : ""}>${esc(f === a.folder && a.all ? bnetOf(f) : (f || "—"))}</option>`).join("")}</select>
      <button class="switch${a.all ? " on" : ""}" data-uall="${i}" data-help="Read every licence of this Battle.net account (folders 123456#1, 123456#2…)"><i></i></button>
      ${accs.length > 1 ? `<button class="ib" data-udel="${i}" data-help="Remove this account">×</button>` : ""}
      ${i === accs.length - 1 ? `<button class="ib" data-uadd="1" data-help="Add another Battle.net account">+</button>` : ""}</div>`).join("");
}
function wowAccountsHtml() {
  const rows = wowAccRowsHtml();
  const read = (ST.sv.folders || []).join(", ");
  return `<div class="usec">${L("World of Warcraft")}</div>
    <label class="sfield" data-help="The game version folder that contains WTF and Interface (for example _forever_), not just World of Warcraft.">${L("World of Warcraft folder")}
      <span class="bgrow"><input id="uWowPath" value="${esc(ST.config.wowPath || "")}" autocomplete="off"${window.GT_WEB ? " readonly" : ""}><button class="uico dir" data-ubrowse="1" data-help="Choose the folder">${FOLDER_SVG}</button></span></label>
    <div class="usec">${L("WoW accounts")}<span class="uall">${L("All licences")}</span></div>${rows}
    <div class="help">${read ? esc(L("Read: {0}", read)) : esc(L("No SavedVariables found for these accounts."))}</div>
    ${myCharsHtml()}`;
}

// Ordre de mes persos (choisi en les glissant, gardé sur ce PC seulement) : le 1er sert de perso par défaut
const GRIP_SVG = '<svg viewBox="0 0 10 16"><circle cx="3" cy="3" r="1.4"/><circle cx="7" cy="3" r="1.4"/><circle cx="3" cy="8" r="1.4"/><circle cx="7" cy="8" r="1.4"/><circle cx="3" cy="13" r="1.4"/><circle cx="7" cy="13" r="1.4"/></svg>';
function charOrder() { try { return JSON.parse(localStorage.getItem("gt-charorder") || "[]"); } catch (e) { return []; } }
function orderedMyChars() {
  const order = charOrder(), rank = n => { const i = order.indexOf(n); return i < 0 ? 1e6 : i; };
  return (ST.myChars || []).map((c, i) => [c, i]).sort((a, b) => rank(a[0].name) - rank(b[0].name) || a[1] - b[1]).map(x => x[0]);
}
// Mes persos : l'œil barré rouge = perso caché, jamais envoyé à la guilde (ni par l'exe, ni par l'addon en jeu)
function myCharsHtml() {
  const chars = orderedMyChars();
  return `<div class="usec">${L("My characters")}</div>
    <div class="urow" data-help="New characters are hidden until you show them.">${L("Hide by default")}<button class="switch${ST.hideByDefault ? " on" : ""}" data-uhidedef="1"><i></i></button></div>
    <div class="uchars" id="uChars">${chars.map(c => `<div class="uchar${c.hidden ? " hid" : ""}" data-uname="${esc(c.name)}" style="--c:${CLASS_COLOR[c.class] || "#9a9ea9"}"><span class="ugrip" data-help="Drag to change the order (the first one is your default character)">${GRIP_SVG}</span><b>${esc(c.name)}</b><small>${c.level || ""}</small>
      <button class="eye${c.hidden ? " off" : ""}" data-ueye="${esc(c.name)}" data-help="${c.hidden ? "Hidden: never sent to the guild. Click to share it." : "Shared with the guild (gear, sets, talents). Click to hide it."}">${c.hidden ? EYE_OFF : EYE}</button></div>`).join("")
      || `<div class="help">${L("Log in once in game with each character (addon up to date) to list it here.")}</div>`}</div>`;
}

function renderUserMenu() {
  const c = ST.cloud || {}, m = $("#userMenu");
  let h = "";
  if (!c.configured) {
    h += `<div class="help">${L("Discord login is not set up yet: the guild server must be configured (Cloud/SETUP.md).")}</div>`;
  } else if (!c.logged) {
    h += `<button class="btn pri" data-ulogin="1"${cloudBusy ? " disabled" : ""}>${L(cloudBusy ? "Waiting for Discord…" : "Log in with Discord")}</button>
      <div class="help">${L("Opens Discord in your browser: Guild Tool never sees your password.")}</div>`;
  } else {
    const u = c.user, g = c.guild, mem = c.member || {};
    const top = (mem.roles || []).find(r => r.name);
    h += `<div class="uhead">${avatarUrl(u) ? `<img src="${avatarUrl(u)}" alt="">` : ""}<div><b>${esc(mem.nick || u.globalName || u.username)}</b><small>@${esc(u.username)}</small></div>
      <button class="uico out" data-ulogout="1" data-help="Log out">${LOGOUT_SVG}</button></div>`;
    if (g && !pickingGuild) {
      h += `<div class="uguild">${guildIcon(g) ? `<img src="${guildIcon(g)}" alt="">` : ""}<div><b>${esc(g.name)}</b>
        <small>${top ? `<span style="color:${roleColor(top) || "inherit"}">${esc(top.name)}</span>` : ""}${mem.admin ? ` · ${L("Admin")}` : ""}</small></div>
        <button class="uico swap" data-upick="1" data-help="Change server">${SERVER_SVG}</button></div>
        ${(mem.roles || []).filter(r => r.name).length > 1 ? `<div class="uroles">${mem.roles.filter(r => r.name).map(r => `<span style="--rc:${roleColor(r) || "#9a9ea9"}">${esc(r.name)}</span>`).join("")}</div>` : ""}
`;
    } else {
      h += `<div class="usec">${L("Choose your guild server")}<button class="ib" data-urefresh="1" data-help="Refresh the list">↻</button></div>
        <div class="uguilds">${(c.guilds || []).map(x => `<button data-uguild="${x.id}"${cloudBusy ? " disabled" : ""}>${guildIcon(x) ? `<img src="${guildIcon(x)}" alt="">` : '<span class="gi"></span>'}<span>${esc(x.name)}</span>${x.admin ? `<em>${L("Admin")}</em>` : ""}</button>`).join("")}</div>
        ${g ? `<button class="btn small" data-upickno="1">${L("Cancel")}</button>` : ""}`;
    }
  }
  m.innerHTML = h + wowAccountsHtml();
}

function toggleUserMenu(show) {
  const m = $("#userMenu");
  show = show ?? m.hidden;
  if (show) {
    pickingGuild = !!(ST.cloud && ST.cloud.logged && !ST.cloud.guild);
    renderUserMenu();
    const r = $("#userBtn").getBoundingClientRect();
    m.hidden = false;
    m.style.top = r.bottom + 4 + "px";
    m.style.left = Math.max(6, Math.min(r.right - m.offsetWidth, innerWidth - m.offsetWidth - 6)) + "px";
  } else m.hidden = true;
}
$("#userBtn").addEventListener("click", () => toggleUserMenu());
document.addEventListener("pointerdown", e => {
  if (!$("#userMenu").hidden && !e.target.closest("#userMenu") && !e.target.closest("#userBtn")) toggleUserMenu(false);
}, true);
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#userMenu").hidden) { e.preventDefault(); toggleUserMenu(false); } }, true);

// Pas connecté : fenêtre obligatoire « Log in with Discord » (le serveur de la guilde, TWO - Forever, est choisi
// ensuite tout seul : cloud.json « defaultGuild ») ; sinon choix du serveur dans le menu du compte
// bande du haut des fenêtres obligatoires (login, premier réglage) : déplace la fenêtre comme la barre du haut, avec
// réduire / agrandir / fermer (relayés aux vrais boutons, cachés sous le voile)
function gateBar() {
  const btn = (id, cls) => `<button data-gwin="${id}"${cls ? ` class="${cls}"` : ""}>${($("#" + id) || {}).innerHTML || ""}</button>`;
  return `<div class="gatebar pywebview-drag-region"><span class="pywebview-drag-region">Guild Tool</span>
    <div class="winctl">${btn("wMin")}${btn("wMax")}${btn("wClose", "close")}</div></div>`;
}
document.addEventListener("click", e => { const b = e.target.closest && e.target.closest("[data-gwin]"); if (b) $("#" + b.dataset.gwin).click(); });

// Après le login Discord : fenêtre de premier réglage, serveur Discord de la guilde (obligatoire, TWO présélectionné),
// dossier de la version du jeu et comptes WoW (serveurs et persos de chaque compte listés pour reconnaître le bon)
const DEFAULT_GUILD = "1480977917092692131";
let setupOpen = false, setupTree = null, setupAfter = null, setupGuild = "", setupBusy = false;
async function openSetupGate(after) {
  setupOpen = true; setupAfter = after || null;
  const c = ST.cloud || {}, ids = (c.guilds || []).map(x => x.id);
  setupGuild = (c.guild && c.guild.id) || (ids.includes(DEFAULT_GUILD) ? DEFAULT_GUILD : "");
  setupTree = await api().wow_account_tree();
  renderSetupGate();
}
// ce qui manque encore pour valider : serveur, dossier du jeu, compte WoW (s'il y en a à choisir)
function setupMissing() {
  if (!setupGuild) return L("Choose your guild server.");
  if (!(ST.config.wowPath || "").trim()) return L("Choose the folder of your game version.");
  if ((ST.accounts || []).length && !(ST.wowAccounts || []).some(a => a.folder)) return L("Choose your WoW account.");
  return "";
}
function renderSetupGate() {
  let g = $("#setupGate");
  if (!setupOpen) { if (g) g.remove(); return; }
  if (!g) { g = document.createElement("div"); g.id = "setupGate"; g.className = "gate"; document.body.appendChild(g); }
  const tree = (setupTree || []).map(a => `<div class="stacc"><div class="stacch">${esc(a.folder)}</div>${a.realms.map(r =>
    `<div class="strealm"><b>${esc(r.name)}</b><div class="stchars">${r.chars.map(c => `<span>${esc(c)}</span>`).join("")}</div></div>`).join("")
    || `<div class="help">${L("No character in this account yet.")}</div>`}</div>`).join("");
  const scroll = (g.querySelector(".setupbox") || {}).scrollTop || 0;
  const guilds = (ST.cloud || {}).guilds || [], miss = setupMissing();
  g.innerHTML = gateBar() + `<div class="gatebox setupbox"><h2>${L("Discord server")}</h2>
    <label class="sfield">${L("Your guild server")}
      <span class="bgrow"><select id="setupGuild"${setupBusy ? " disabled" : ""}><option value="">—</option>${guilds.map(x => `<option value="${esc(x.id)}"${x.id === setupGuild ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select><button class="ib" data-setupref="1" data-help="Refresh the list">↻</button></span></label>
    <div class="help">${L("The Discord server of your guild: its events, comps and members are shared with you.")}</div>
    <h2>${L("World of Warcraft")}</h2>
    <label class="sfield">${L("Game version folder")}
      <span class="bgrow"><input id="uWowPath" value="${esc(ST.config.wowPath || "")}" autocomplete="off"${window.GT_WEB ? " readonly" : ""} placeholder="C:\\Program Files (x86)\\World of Warcraft\\_forever_"><button class="uico dir" data-ubrowse="1" data-help="Choose the folder">${FOLDER_SVG}</button></span></label>
    <div class="help">${L("Choose the folder of your game version: the one that contains the WTF and Interface folders (for example …\\World of Warcraft\\_forever_), not the World of Warcraft folder itself.")}</div>
    <div class="usec">${L("WoW accounts")}<span class="uall">${L("All licences")}</span></div>${wowAccRowsHtml()}
    <div class="help">${L("Choose your account folder: its servers and characters are listed below so you can recognize it. « All licences » reads every licence of this Battle.net account, + adds another Battle.net account.")}</div>
    ${tree ? `<div class="sttree">${tree}</div>` : ""}
    ${miss ? `<div class="help stmiss">${esc(miss)}</div>` : ""}
    <button class="btn pri" data-setupdone="1"${miss || setupBusy ? " disabled" : ""}>${L(setupBusy ? "Loading the guild…" : "Done")}</button></div>`;
  g.querySelector(".setupbox").scrollTop = scroll;
}
document.addEventListener("click", async e => {
  if (e.target.closest && e.target.closest("[data-setupref]")) {
    const r = await cloudCall("cloud_refresh_guilds");
    if (r) ST.cloud = r.cloud;
    renderSetupGate(); return;
  }
  const b = e.target.closest && e.target.closest("[data-setupdone]");
  if (!b || b.disabled || setupMissing() || setupBusy) return;
  // autre serveur que celui déjà choisi : rejoint (rôles, droits, première synchro) avant de fermer
  if (!ST.cloud.guild || ST.cloud.guild.id !== setupGuild) {
    setupBusy = true; renderSetupGate();
    let r = null;
    try { r = await cloudCall("cloud_guild", setupGuild); } finally { setupBusy = false; }
    if (!r) { renderSetupGate(); return; }
    toast(L("Guild server: {0}", r.cloud.guild.name));
    await reload(); renderUserBtn();
    doSync();
  }
  setupOpen = false; renderSetupGate();
  const f = setupAfter; setupAfter = null;
  if (f) f();
});
document.addEventListener("change", e => {
  if (e.target.id !== "setupGuild") return;
  setupGuild = e.target.value; renderSetupGate();
});
// menu du compte et fenêtre de premier réglage redessinés (et leurs listes relues) après un changement
async function rerenderWow() {
  renderUserMenu();
  if (setupOpen) { setupTree = await api().wow_account_tree(); renderSetupGate(); }
}

function checkLoginGate() {
  const c = ST.cloud || {};
  let g = $("#loginGate");
  if (!c.configured || c.logged) { if (g) g.remove(); return; }
  if (!g) {
    g = document.createElement("div");
    g.id = "loginGate";
    g.className = "gate";
    document.body.appendChild(g);
  }
  g.innerHTML = gateBar() + `<div class="gatebox"><h2>Guild Tool</h2>
    <p>${L("Log in with your Discord account to use Guild Tool with your guild.")}</p>
    <button class="btn pri" id="gateLogin"${cloudBusy ? " disabled" : ""}>${L(cloudBusy ? "Waiting for Discord…" : "Log in with Discord")}</button>
    <div class="help">${L("Opens Discord in your browser: Guild Tool never sees your password.")}</div></div>`;
}
document.addEventListener("click", async e => {
  if (!e.target.closest("#gateLogin") || cloudBusy) return;
  cloudBusy = true; checkLoginGate();
  let r = null;
  try { r = await api().cloud_login(); } finally { cloudBusy = false; }
  if (!r || r.ok === false) { toast((r && r.error) || "Error", true); checkLoginGate(); return; }
  ST.cloud = r.cloud;
  toast(L("Logged in with Discord."));
  await reload();
  checkLoginGate();
  // serveur choisi (obligatoire) dans la fenêtre de premier réglage ; serveur par défaut déjà rejoint : synchro tout de suite
  if (ST.cloud.guild) doSync();
  openSetupGate();
});
async function cloudCall(fn, ...args) {
  cloudBusy = true; renderUserMenu();
  try {
    const r = await api()[fn](...args);
    if (r && r.ok === false) { toast(r.error, true); return null; }
    return r;
  } finally { cloudBusy = false; }
}

document.addEventListener("click", async e => {
  const t = e.target;
  if (!(t.closest && t.closest("#userMenu, #setupGate"))) return;
  let el;
  if (t.closest("[data-ulogin]")) {
    const r = await cloudCall("cloud_login");
    if (r) { ST.cloud = r.cloud; pickingGuild = !r.cloud.guild; toast(L("Logged in with Discord.")); }
    renderUserBtn(); renderUserMenu();
    if (r && r.cloud.guild) { await reload(); doSync(); }
    if (r) { toggleUserMenu(false); openSetupGate(); }
    return;
  }
  if (t.closest("[data-ulogout]")) { ST.cloud = await api().cloud_logout(); renderUserBtn(); renderUserMenu(); return; }
  if (t.closest("[data-ubrowse]")) {
    const r = await api().pick_wow_folder();
    if (r && r.ok === false) { toast(r.error, true); return; }
    // nouveau dossier : l'addon y est installé / mis à jour s'il manque
    if (r && r.path) { await reload(); rerenderWow(); toast(L("World of Warcraft folder: {0}", r.path)); checkAddon(); }
    return;
  }
  if (t.closest("[data-upick]")) { pickingGuild = true; renderUserMenu(); return; }
  if (t.closest("[data-upickno]")) { pickingGuild = false; renderUserMenu(); return; }
  if (t.closest("[data-urefresh]")) { const r = await cloudCall("cloud_refresh_guilds"); if (r) ST.cloud = r.cloud; renderUserMenu(); return; }
  if ((el = t.closest("[data-uguild]"))) {
    const r = await cloudCall("cloud_guild", el.dataset.uguild);
    if (r) { pickingGuild = false; toast(L("Guild server: {0}", r.cloud.guild.name)); await reload(); }
    renderUserBtn(); renderUserMenu(); return;
  }
  // comptes WoW
  const accs = (ST.wowAccounts && ST.wowAccounts.length ? ST.wowAccounts : [{ folder: "", all: false }]).map(a => ({ ...a }));
  if (t.closest("[data-uadd]")) { accs.push({ folder: "", all: false }); ST.wowAccounts = accs; rerenderWow(); return; }
  if ((el = t.closest("[data-udel]"))) { accs.splice(+el.dataset.udel, 1); return saveWowAccounts(accs); }
  if ((el = t.closest("[data-uall]"))) { accs[+el.dataset.uall].all = !accs[+el.dataset.uall].all; return saveWowAccounts(accs); }
  // persos cachés / partagés
  if ((el = t.closest("[data-ueye]"))) {
    const c = (ST.myChars || []).find(x => x.name === el.dataset.ueye);
    ST.myChars = await api().set_char_hidden(el.dataset.ueye, !(c && c.hidden));
    renderUserMenu(); return;
  }
  if (t.closest("[data-uhidedef]")) { ST.hideByDefault = !ST.hideByDefault; await api().set_hide_default(ST.hideByDefault); renderUserMenu(); }
});
// glisser un perso par sa poignée : la ligne suit la souris, l'ordre est gardé en local au lâcher
$("#userMenu").addEventListener("pointerdown", e => {
  const grip = e.target.closest(".ugrip");
  if (!grip || e.button !== 0) return;
  e.preventDefault();
  const row = grip.closest(".uchar"), box = row.parentElement;
  row.classList.add("dragging");
  const move = ev => {
    const after = [...box.children].find(x => x !== row && ev.clientY < x.getBoundingClientRect().top + x.offsetHeight / 2);
    if (after) { if (row.nextElementSibling !== after) box.insertBefore(row, after); }
    else if (box.lastElementChild !== row) box.appendChild(row);
  };
  const up = () => {
    document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up);
    row.classList.remove("dragging");
    try { localStorage.setItem("gt-charorder", JSON.stringify([...box.children].map(x => x.dataset.uname))); } catch (err) { /* stockage indisponible */ }
  };
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", up);
});
// liste d'un compte « All licences » : numéros complets pendant le choix, sans « #n » une fois fermée
document.addEventListener("mousedown", e => {
  const sel = e.target.closest && e.target.closest("select[data-uacc]");
  if (sel) sel.querySelectorAll("option").forEach(o => { o.textContent = o.dataset.full; });
});
document.addEventListener("focusout", e => {
  const sel = e.target.closest && e.target.closest("select[data-uacc]");
  if (sel && sel.dataset.all === "1") { const o = sel.selectedOptions[0]; if (o && o.value) o.textContent = bnetOf(o.value); }
});
document.addEventListener("change", async e => {
  if (!(e.target.closest && e.target.closest("#userMenu, #setupGate"))) return;
  if (e.target.id === "uWowPath") {
    await api().save_config({ wowPath: e.target.value.trim() });
    await reload(); rerenderWow(); return;
  }
  const el = e.target.closest("[data-uacc]");
  if (!el) return;
  const accs = (ST.wowAccounts && ST.wowAccounts.length ? ST.wowAccounts : [{ folder: "", all: false }]).map(a => ({ ...a }));
  accs[+el.dataset.uacc].folder = el.value;
  saveWowAccounts(accs);
});
async function saveWowAccounts(accs) {
  ST.wowAccounts = accs;
  await api().save_config({ wowAccounts: accs.filter(a => a.folder) });
  await reload();
  ST.wowAccounts = accs;          // garde une ligne vide ajoutée avec « + »
  rerenderWow();
}
