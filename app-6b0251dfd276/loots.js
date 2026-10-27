"use strict";
// Onglet Loots : attributions de la base de la guilde (/tlc en jeu).
// Barre : lockout (jamais dans le futur, « All » = tous), vues History / Player / Items, phase (« All » = toutes),
// recherche (Player : pseudos séparés par des virgules ; Items : nom d'objet + types), filtre par date.
// History : « + » ajoute une attribution à la main ; icône, objet (infobulle), joueur, réaction (colonne), dés (mêmes
// intentions), date ; officiers : double-clic sur le joueur ou la réaction = changer, croix = supprimer.

const DICE_SVG = '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="4"/><circle class="pip" cx="8" cy="8" r="1.6"/><circle class="pip" cx="16" cy="8" r="1.6"/><circle class="pip" cx="12" cy="12" r="1.6"/><circle class="pip" cx="8" cy="16" r="1.6"/><circle class="pip" cx="16" cy="16" r="1.6"/></svg>';
const LOOT_KIND = { bis: "Bis", upp: "Up+", up: "Up", os: "Off Spec", pvp: "PvP", mog: "Mog", de: "Disenchant", vendor: "Vendor" };
let lootDay = "", lootEdit = null, lootKindEdit = null, lootNew = null;   // filtre (AAAAMMJJ) ; joueur / réaction en cours de changement ; ligne ajoutée
const lootYmd = t => { const d = new Date(t * 1000); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); };
const lootDayLabel = k => { const s = String(k); return `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}`; };
// p2 (deux chiffres) : events.js
const lootDateTxt = t => { const d = new Date(t * 1000); return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`; };

// raids de la phase choisie (onglet Loots) : null = toutes
function lootPhaseRaids() {
  const ph = UI.lootPhase === null || UI.lootPhase === undefined ? null : PHASES[UI.lootPhase];
  return ph ? ph.raids : null;
}
// loots gardés par les filtres : phase (zone du loot = un raid de la phase ; zone inconnue : gardé), lockout, date
function lootInPhase(r, raids) {
  if (!raids || !r.zone) return true;
  const z = String(r.zone).toLowerCase();
  return raids.some(x => [x.name, x.short].some(n => n && (z.includes(n.toLowerCase()) || n.toLowerCase().includes(z))));
}
function lootFiltered() {
  const raids = lootPhaseRaids();
  return (ST.lootDB || []).filter(r => (!lootDay || String(lootYmd(r.t)) === String(lootDay))
    && (!UI.lootWeek || weekStart(r.t || 0) === UI.lootWeek) && lootInPhase(r, raids));
}

// barre : plus de filtre par date (le lockout suffit)
function renderLootFilter() {
  $("#subInfo").innerHTML = "";
  renderLootSearch();
}

// ---------------------------------------------------------------- recherche (à droite de la phase)
// types d'objets : classe:sous-classe de l'infobulle Wowhead (<!--scstartC:S-->), capes = emplacement « Back »
const LOOT_TYPES = [
  ["cloth", "Cloth", "4:1"], ["leather", "Leather", "4:2"], ["mail", "Mail", "4:3"], ["plate", "Plate", "4:4"], ["cloak", "Cloak", "back"],
  ["shield", "Shield", "4:6"], ["axe1", "One-Handed Axes", "2:0"], ["axe2", "Two-Handed Axes", "2:1"], ["mace1", "One-Handed Maces", "2:4"],
  ["mace2", "Two-Handed Maces", "2:5"], ["sword1", "One-Handed Swords", "2:7"], ["sword2", "Two-Handed Swords", "2:8"], ["dagger", "Daggers", "2:15"],
  ["fist", "Fist Weapons", "2:13"], ["polearm", "Polearms", "2:6"], ["staff", "Staves", "2:10"], ["bow", "Bows", "2:2"], ["gun", "Guns", "2:3"],
  ["crossbow", "Crossbows", "2:18"], ["wand", "Wands", "2:19"], ["thrown", "Thrown", "2:16"],
];
function lootItemType(id) {
  const tt = (ST.items[String(id)] || {}).tt || "";
  if (!tt) return null;
  if (/<td>Back<\/td>/.test(tt)) return "cloak";
  const m = tt.match(/<!--scstart(\d+):(\d+)-->/);
  if (!m) return null;
  const t = LOOT_TYPES.find(x => x[2] === m[1] + ":" + m[2]);
  return t ? t[0] : null;
}
const lootQ = () => ((UI.lootQ || {})[UI.lootTab || "all"] || "").trim();
const lootTypesOn = () => LOOT_TYPES.map(t => t[0]).filter(k => (UI.lootTypes || {})[k]);
function renderLootSearch() {
  const tab = UI.lootTab || "all", box = $("#lootSearch");
  // Wishlist : recherche d'un joueur (nom Discord) pour les officiers seulement
  box.hidden = UI.page !== "loots" || tab === "bis" || (tab === "wish" && !isOfficerUser());
  document.body.classList.toggle("lnosearch", box.hidden);
  if (box.hidden) return;
  const inp = $("#lootQ");
  inp.placeholder = L(tab === "role" ? "Players: name, name, …" : tab === "wish" || tab === "all" ? "Discord name" : "Search an item");
  if (document.activeElement !== inp) inp.value = (UI.lootQ || {})[tab] || "";
  const on = lootTypesOn();
  $("#lootTypeBtn").hidden = tab !== "boss" && tab !== "all";
  $("#lootTypeBtn").innerHTML = `${L("Type")}${on.length ? ` <b>${on.length}</b>` : ""} ▾`;
  $("#lootTypeBtn").classList.toggle("on", on.length > 0);
  if (!$("#lootTypeList").hidden) fillLootTypes();
}
function fillLootTypes() {
  const sel = UI.lootTypes || {};
  $("#lootTypeList").innerHTML = LOOT_TYPES.map(([k, n]) => `<button class="${sel[k] ? "on" : ""}" data-ltype="${k}"><span class="ck"></span>${esc(L(n))}</button>`).join("")
    + `<button class="clr" data-ltype="">${L("Clear")}</button>`;
}
function setLootQ(v) {
  const tab = UI.lootTab || "all";
  UI.lootQ = UI.lootQ || {};
  UI.lootQ[tab] = v;
  if (!v.trim()) UI.lootSClosed = {};
  renderLoots();
}
$("#lootQ").addEventListener("input", e => { setLootQ(e.target.value); fillLootSug(); });
// Wishlist : propositions de noms Discord sous la recherche, affinées par le texte ; flèches haut / bas, la 1re en
// surbrillance, Entrée ou clic = choisie ; Échap (dans la recherche, tous les onglets) = texte effacé
let lootSug = { names: [], idx: 0 };
function fillLootSug() {
  const box = $("#lootSug"), inp = $("#lootQ");
  if ((UI.lootTab || "all") !== "wish" || document.activeElement !== inp) { box.hidden = true; return; }
  const q = inp.value.trim().toLowerCase(), seen = new Set(), names = [];
  for (const n of Object.values(tagNames())) {
    const l = String(n).toLowerCase();
    if (!seen.has(l) && (!q || l.includes(q))) { seen.add(l); names.push(n); }
  }
  names.sort((a, b) => (b.toLowerCase().startsWith(q) - a.toLowerCase().startsWith(q)) || a.localeCompare(b));
  lootSug = { names: names.slice(0, 12), idx: 0 };
  paintLootSug();
}
function paintLootSug() {
  const box = $("#lootSug");
  box.hidden = !lootSug.names.length;
  box.innerHTML = lootSug.names.map((n, i) => `<button data-lsug="${i}"${i === lootSug.idx ? ' class="on"' : ""}>${esc(n)}</button>`).join("");
}
function pickLootSug(i) {
  const n = lootSug.names[i];
  if (n == null) return;
  $("#lootQ").value = n;
  setLootQ(n);
  $("#lootSug").hidden = true;
}
$("#lootQ").addEventListener("focus", fillLootSug);
$("#lootQ").addEventListener("blur", () => setTimeout(() => { if (document.activeElement !== $("#lootQ")) $("#lootSug").hidden = true; }, 150));
$("#lootQ").addEventListener("keydown", e => {
  const open = !$("#lootSug").hidden && lootSug.names.length;
  if (e.key === "Escape") {
    e.preventDefault(); e.stopPropagation();
    if (e.target.value) { e.target.value = ""; setLootQ(""); }
    fillLootSug();
  } else if (open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
    e.preventDefault();
    const n = lootSug.names.length;
    lootSug.idx = (lootSug.idx + (e.key === "ArrowDown" ? 1 : -1) + n) % n;
    paintLootSug();
  } else if (open && e.key === "Enter") { e.preventDefault(); pickLootSug(lootSug.idx); }
});
$("#lootSug").addEventListener("mousedown", e => {
  const b = e.target.closest("[data-lsug]");
  if (b) { e.preventDefault(); pickLootSug(+b.dataset.lsug); }
});
$("#lootTypeBtn").addEventListener("click", () => {
  const l = $("#lootTypeList");
  l.hidden = !l.hidden;
  if (!l.hidden) fillLootTypes();
});
$("#lootTypeList").addEventListener("click", e => {
  e.stopPropagation();
  const b = e.target.closest("[data-ltype]");
  if (!b) return;
  UI.lootTypes = UI.lootTypes || {};
  if (!b.dataset.ltype) UI.lootTypes = {}; else UI.lootTypes[b.dataset.ltype] = !UI.lootTypes[b.dataset.ltype];
  fillLootTypes();
  renderLootSearch();
  renderLoots();
});
document.addEventListener("click", e => {
  if (!e.target.closest("#lootSearch")) $("#lootTypeList").hidden = true;
});

// lockouts (titre de la barre) : « All » en tête (le plus récent), puis tous les lockouts de l'actuel vers le passé
// (6 mois au moins, jusqu'au plus ancien loot), liste qui défile
function showLootWeekList() {
  const thisWeek = weekStart(now()), counts = {};
  let oldest = thisWeek - 26 * WEEK;
  for (const r of ST.lootDB || []) { const w = weekStart(r.t || 0); counts[w] = (counts[w] || 0) + 1; oldest = Math.min(oldest, w); }
  const weeks = [];
  for (let w = thisWeek; w >= oldest; w -= WEEK) weeks.push(w);
  // « All lockouts » centré sur les tirets des autres lignes
  let html = `<button class="pl pall${!UI.lootWeek ? " sel" : ""}" data-lootweek="">${L("All lockouts")}</button>`;
  for (const ws of weeks) {
    html += `<button class="pl${UI.lootWeek === ws ? " sel" : ""}${ws === thisWeek ? " now" : ""}" data-lootweek="${ws}">${weekLabelHtml(ws)}${counts[ws] ? `<em>${counts[ws]}</em>` : ""}</button>`;
  }
  const p = $("#picker"), t = $("#subTitle").getBoundingClientRect();
  p.style.width = "";
  p.innerHTML = `<div class="plist lscroll">${html}</div>`;
  // juste assez large (pas de place perdue à gauche)
  p.style.width = "max-content";
  p.hidden = false;
  p.style.left = Math.max(4, t.left + t.width / 2 - p.offsetWidth / 2) + "px";
  p.style.top = t.bottom + 4 + "px";
  const sel = p.querySelector(".pl.sel");
  if (sel) sel.scrollIntoView({ block: "nearest" });
}

function lootClass(name) {
  const r = ST.roster[name] || {}, o = (ST.charOwners || {})[name] || {};
  if (r.c || o.c) return r.c || o.c;
  const f = String(name || "").split(" ")[0];
  for (const [n, x] of Object.entries(ST.roster)) if (n.split(" ")[0] === f && x && x.c) return x.c;
  return null;
}
// réaction d'une attribution : couleur, icône de la spé Off Spec
function lootKindHtml(r) {
  if (!r.kind) return `<span class="mute">—</span>`;
  const col = LOOT_KIND_COL[r.kind] || "#999ead";
  const si = r.kind === "os" && r.spec && ST.specIcons[`${lootClass(r.to)}:${r.spec}`];
  return `${si ? `<img class="lkos" src="${si}" alt="" data-help="${esc(r.spec)}">` : ""}<b style="color:${col}">${esc(L(LOOT_KIND[r.kind] || r.kind))}</b>`;
}

// ---------------------------------------------------------------- History
function renderLoots() {
  renderLootSearch();
  if ((UI.lootTab || "all") === "role") return renderLootRoles();
  if (UI.lootTab === "boss") return renderLootBoss();
  if (UI.lootTab === "wish") return renderLootWish();
  if (UI.lootTab === "bis") return renderLootBis();
  const box = $("#page-loots");
  // History : recherche par joueur (nom Discord ou perso) et par type d'objet (comme Tables)
  const q = lootQ().toLowerCase(), types = lootTypesOn();
  const all = lootFiltered();
  ensureItems(all.map(r => r.id).filter(Boolean));
  const list = all.filter(r => (!q || [discordOf(r.to), r.to].some(v => String(v || "").toLowerCase().includes(q)))
    && (!types.length || (r.id && types.includes(lootItemType(r.id)))));
  const off = canEdit();
  const rows = list.map(r => {
    const it = r.id ? itemInfo(r.id) : { name: r.name };
    const cls = lootClass(r.to);
    const same = (r.same || []).length ? (r.same || []).join(", ") : L("Nobody else");
    const editing = lootEdit === r.k, kEditing = lootKindEdit === r.k;
    return `<div class="lootrow${editing || kEditing ? " editing" : ""}">
      <span class="lic"${it.icon ? ` style="background-image:url('${ICON_URL(it.icon, "medium")}')"` : ""} data-item="${r.id || ""}"></span>
      <span class="lnm" data-item="${r.id || ""}" style="color:${QUALITY_COLOR[it.q] || "#fff"}">${esc(it.name || r.name || "?")}</span>
      <span class="lto"${off ? ` data-lootto="${esc(r.k)}" data-help="Double-click to give it to another character"` : ""}>${editing
        ? `<span class="efcombo"><input class="ef" id="lootToIn" value="" placeholder="${esc(L("Type a name"))}" autocomplete="off"><span class="eflist" id="lootToList"></span></span>`
        : `<b style="color:${CLASS_COLOR[cls] || "#fff"}">${nameHtml(r.to || "?")}</b>`}</span>
      <span class="lkd"${off ? ` data-lootkind="${esc(r.k)}" data-help="Double-click to change the roll"` : ""}>${kEditing
        ? `<span class="efcombo"><span class="eflist kinds">${Object.entries(LOOT_KIND).map(([k, n]) => `<button data-lootkpick="${k}" style="color:${LOOT_KIND_COL[k] || "#ccc"}">${esc(L(n))}</button>`).join("")}</span></span>`
        : lootKindHtml(r)}</span>
      <span class="ldice" data-help="${esc(L("Same roll: {0}", same))}">${DICE_SVG}</span>
      <span class="ldate">${lootDateTxt(r.t || 0)}</span>
      ${off ? `<button class="ldel" data-lootdel="${esc(r.k)}" data-help="Remove this attribution from the database">×</button>` : ""}</div>`;
  }).join("");
  // « + » (officiers) : nouvelle ligne à remplir
  const add = off ? (lootNew ? lootNewRow() : `<button class="lootadd" data-lootadd="1" data-help="Add an attribution by hand">+</button>`) : "";
  box.innerHTML = `<div class="lootlist">${add}${rows || `<div class="empty-list">${L("No loot attributed yet: use /tlc in game during the raid.")}</div>`}</div>`;
  if (lootEdit) {
    const inp = $("#lootToIn");
    if (inp) { inp.focus(); fillLootTo(inp); }
  }
}

// Ligne ajoutée à la main : objet (nom, n° ou lien Wowhead), perso (liste filtrée), réaction, date et heure
// (saisie au clavier, calendrier : clic sur un jour, molette = jour suivant / précédent)
function lootNewRow() {
  const n = lootNew, it = n.id ? itemInfo(n.id) : null, cls = n.to && lootClass(n.to);
  return `<div class="lootrow lnew">
    <span class="lic"${it && it.icon ? ` style="background-image:url('${ICON_URL(it.icon, "medium")}')"` : ""}></span>
    <span class="efcombo"><input class="ef" id="lnItem" value="${esc(it ? it.name : n.itemTxt || "")}" placeholder="${esc(L("Item: name, ID or Wowhead link"))}" autocomplete="off"
      ${it ? ` style="color:${QUALITY_COLOR[it.q] || "#fff"}"` : ""}><span class="eflist" id="lnItemList" hidden></span></span>
    <span class="efcombo"><input class="ef" id="lnTo" value="${esc(n.to || "")}" placeholder="${esc(L("Character"))}" autocomplete="off"
      ${cls ? ` style="color:${CLASS_COLOR[cls]}"` : ""}><span class="eflist" id="lnToList" hidden></span></span>
    <select class="lootsel" id="lnKind"><option value="">${L("Roll")}</option>${Object.entries(LOOT_KIND).map(([k, v]) =>
      `<option value="${k}"${n.kind === k ? " selected" : ""}>${esc(L(v))}</option>`).join("")}</select>
    <span></span>
    <span class="efcombo"><input class="ef" id="lnDate" value="${lootDateTxt(n.t)}" autocomplete="off" data-help="Type the date and hour, or pick a day (wheel: next / previous day)">
      <span class="lncal" id="lnCal" hidden></span></span>
    <span class="lnbtns"><button class="lnok" data-lnsave="1" data-help="Save">✓</button><button class="ldel" data-lncancel="1" data-help="Cancel">×</button></span></div>`;
}
// objets connus (base, sacs relevés, cache Wowhead) filtrés par la frappe ; un n° ou un lien Wowhead est pris tel quel
function lootKnownItems() {
  const m = new Map();
  for (const r of ST.lootDB || []) if (r.id) m.set(String(r.id), r.name);
  for (const [k, v] of Object.entries(ST.svItems || {})) if (v && v.n) m.set(String(k), v.n);
  for (const [k, v] of Object.entries(ST.items || {})) if (v && v.n) m.set(String(k), v.n);
  for (const [raid, bosses] of Object.entries(ST.bossLoot || {})) for (const items of Object.values(bosses || {})) for (const id of Object.keys(items || {})) if (!m.has(id)) m.set(id, itemInfo(id).name);
  return m;
}
function fillLnItem() {
  const inp = $("#lnItem"), q = inp.value.trim(), list = $("#lnItemList");
  const idm = q.match(/item[=:](\d+)/i) || q.match(/^(\d+)$/);
  let html = "";
  if (idm) html = `<button data-lnitem="${idm[1]}">${L("Item #{0}", idm[1])}</button>`;
  else if (q.length >= 2) {
    const ql = q.toLowerCase(), out = [];
    for (const [id, name] of lootKnownItems()) if (name && String(name).toLowerCase().includes(ql)) out.push([id, name]);
    html = out.slice(0, 30).map(([id, name]) => `<button data-lnitem="${id}" style="color:${QUALITY_COLOR[itemInfo(id).q] || "#fff"}">${esc(name)}</button>`).join("");
  }
  list.innerHTML = html || `<div class="help">${L(q.length < 2 ? "Type at least 2 letters, an ID or a Wowhead link." : "No item found.")}</div>`;
  list.hidden = false;
}
function fillLnTo() {
  const q = $("#lnTo").value.trim().toLowerCase(), list = $("#lnToList");
  const names = memberUnits().filter(u => !String(u.name).startsWith("~") && (!q || u.display.toLowerCase().includes(q))).slice(0, 40);
  list.innerHTML = names.map(u => `<button data-lnto="${esc(u.name)}" style="color:${CLASS_COLOR[u.class] || "#fff"}">${nameHtml(u.display)}</button>`).join("")
    || `<div class="help">${L("No character found.")}</div>`;
  list.hidden = false;
}
// date : chiffres seuls, mis en forme « jj/mm/aaaa hh:mm » au fil de la frappe
function lnParseDate(txt) {
  const d = String(txt).replace(/\D/g, "");
  if (d.length < 8) return null;
  const day = +d.slice(0, 2), mon = +d.slice(2, 4), yr = +d.slice(4, 8), h = d.length >= 10 ? +d.slice(8, 10) : 20, mi = d.length >= 12 ? +d.slice(10, 12) : 0;
  const dt = new Date(yr, mon - 1, day, Math.min(23, h), Math.min(59, mi));
  return isNaN(dt) || dt.getDate() !== day ? null : Math.floor(dt.getTime() / 1000);
}
function lnFormat(inp) {
  const d = inp.value.replace(/\D/g, "").slice(0, 12);
  let s = d.slice(0, 2);
  if (d.length > 2) s += "/" + d.slice(2, 4);
  if (d.length > 4) s += "/" + d.slice(4, 8);
  if (d.length > 8) s += " " + d.slice(8, 10);
  if (d.length > 10) s += ":" + d.slice(10, 12);
  inp.value = s;
  const t = lnParseDate(s);
  if (t) { lootNew.t = t; fillLnCal(); }
}
function fillLnCal() {
  const cal = $("#lnCal");
  if (!cal) return;
  const cur = new Date(lootNew.t * 1000), y = cur.getFullYear(), m = cur.getMonth();
  const first = new Date(y, m, 1), lead = (first.getDay() + 6) % 7, days = new Date(y, m + 1, 0).getDate();
  let html = `<div class="lnch"><button data-lnmon="-1">◀</button><b>${first.toLocaleDateString(LOC(), { month: "long" })} ${y}</b><button data-lnmon="1">▶</button></div><div class="lngrid">`;
  for (let i = 0; i < lead; i++) html += "<span></span>";
  for (let d = 1; d <= days; d++) html += `<button class="${d === cur.getDate() ? "on" : ""}" data-lnday="${d}">${d}</button>`;
  cal.innerHTML = html + "</div>";
}
function lnSetT(t) {
  lootNew.t = t;
  const inp = $("#lnDate");
  if (inp) inp.value = lootDateTxt(t);
  fillLnCal();
}
document.addEventListener("focusin", e => {
  if (e.target.id === "lnDate") { $("#lnCal").hidden = false; fillLnCal(); }
  if (e.target.id === "lnTo") fillLnTo();
});
document.addEventListener("input", e => {
  if (e.target.id === "lnItem") { lootNew.itemTxt = e.target.value; lootNew.id = null; fillLnItem(); }
  if (e.target.id === "lnTo") { lootNew.to = ""; fillLnTo(); }
  if (e.target.id === "lnDate") lnFormat(e.target);
  if (e.target.id === "lnKind") lootNew.kind = e.target.value;
});
document.addEventListener("change", e => { if (e.target.id === "lnKind") lootNew.kind = e.target.value; });
document.addEventListener("wheel", e => {
  const el = e.target.closest && e.target.closest("#lnCal, #lnDate");
  if (!el || !lootNew) return;
  e.preventDefault();
  lnSetT(lootNew.t + (e.deltaY < 0 ? -86400 : 86400));
}, { passive: false });

// ---------------------------------------------------------------- Player (une colonne par perso)
// tri : raids faits (participation), loots, classe, A-Z (ordre réglable) ; recherche « pseudo, pseudo » : ces persos
// seulement (rôles et classes ignorés)
function raidsDone(name) {
  // compos visibles (Main et communautaires) où le perso est placé ; phase choisie : seulement ses raids
  const raids = lootPhaseRaids(), keys = raids && new Set(raids.map(r => r.key));
  let n = 0;
  const comps = Object.values(ST.weeks || {}).flatMap(w => w.comps || []).concat(ccompList());
  for (const c of comps) {
    if (!c.valid || c.deleted || (keys && !keys.has(c.raid))) continue;
    if (Object.values(c.c || {}).includes(name)) n++;
  }
  return n;
}
// réactions des attributions (Bis dans le cadre du perso, les autres dessous ; le reste : Other)
const LOOT_KIND_ORDER = ["bis", "upp", "up", "os", "pvp", "mog", "other"];
const LOOT_KIND_NAME = { bis: "Bis", upp: "Up+", up: "Up", os: "Off Spec", pvp: "PvP", mog: "Mog", other: "Other" };
const LOOT_KIND_COL = { bis: "#ff9e33", upp: "#4dd973", up: "#59a6ff", os: "#b880ff", pvp: "#ff6161", mog: "#ff80cc", other: "#999ead", de: "#999ead", vendor: "#999ead" };
// « check all » : trois cases et une coche (couleur du texte, Highlight quand tout est choisi)
const CHECKALL_SVG = '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 47V13a6 6 0 0 1 6-6h34"/><path d="M15 53V19a6 6 0 0 1 6-6h34"/><rect x="21" y="19" width="38" height="38" rx="6" fill="var(--bgfill, #1c1d22)"/><path d="M29 37l7 7 17-20" stroke-width="6.5"/></svg>';
function renderLootRoles() {
  const box = $("#page-loots");
  UI.lootRoles = UI.lootRoles || Object.fromEntries(ROLE_ORDER.map(r => [r, true]));
  UI.lootClasses = UI.lootClasses || {};
  UI.lootOrder = UI.lootOrder || ["raids", "loots", "class", "alpha", "discord"];
  if (!UI.lootOrder.includes("discord")) UI.lootOrder.push("discord");
  const list = lootFiltered(), byChar = {};
  for (const r of list) (byChar[r.to] = byChar[r.to] || []).push(r);
  ensureItems(list.map(r => r.id).filter(Boolean));
  // rôles choisis (plusieurs) ; classes choisies (aucune = toutes)
  const anyC = CLASS_ORDER.some(c => UI.lootClasses[c]), anyR = ROLE_ORDER.some(r => UI.lootRoles[r]);
  // filtre de rôle de cette vue seulement : les chasseurs comptent comme Melee
  const lootRole = u => u.class === "HUNTER" ? "Melee" : u.role;
  const tokens = lootQ().toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
  const units = memberUnits().filter(u => !String(u.name).startsWith("~") && (tokens.length
    ? tokens.some(t => u.display.toLowerCase().includes(t) || String(u.name).toLowerCase().includes(t))
    : (!anyR || UI.lootRoles[lootRole(u)]) && (!anyC || UI.lootClasses[u.class])));
  for (const u of units) { u.loots = (byChar[u.name] || []).length; u.raids = raidsDone(u.name); }
  sortUnits(units, UI.lootOrder);
  const allR = ROLE_ORDER.every(r => UI.lootRoles[r]), allC = CLASS_ORDER.every(c => UI.lootClasses[c]);
  const dim = tokens.length ? " ignored" : "";
  const roleBtns = `<button class="lcheck${allR ? " on" : ""}${dim}" data-lcheck="roles" data-help="All roles">${CHECKALL_SVG}</button>`
    + ROLE_ORDER.map(ro => `<button class="lrole${UI.lootRoles[ro] ? " on" : ""}${dim}" data-lrole="${ro}"><img src="${ROLE_ICON[ro]}" alt="">${esc(L(ro))}</button>`).join("")
    + `<button class="lcheck lcheck2${allC ? " on" : ""}${dim}" data-lcheck="classes" data-help="All classes">${CHECKALL_SVG}</button>`
    + CLASS_ORDER.map(c => `<button class="lclass${UI.lootClasses[c] ? " on" : ""}${anyC && !UI.lootClasses[c] ? " dim" : ""}${dim}" data-lclass="${c}" title="${esc(L(CLASS_NAME[c]))}"><img src="${ICON_URL("classicon_" + c.toLowerCase(), "medium")}" alt=""></button>`).join("");
  const line = r => {
    const it = r.id ? itemInfo(r.id) : { name: r.name }, d = new Date((r.t || 0) * 1000);
    return `<div class="lci"><span class="lcd">${p2(d.getDate())}/${p2(d.getMonth() + 1)}</span>`
      + `<span class="lcic"${it.icon ? ` style="background-image:url('${ICON_URL(it.icon)}')"` : ""} data-item="${r.id || ""}"></span>`
      + `<span class="lcn" data-item="${r.id || ""}" style="color:${QUALITY_COLOR[it.q] || "#fff"}">${esc(it.name || r.name || "?")}</span></div>`;
  };
  const kindLab = k => `<b class="lkind" style="color:${LOOT_KIND_COL[k]}">${L(LOOT_KIND_NAME[k])}</b>`;
  const cols = units.map(u => {
    const by = {};
    for (const r of (byChar[u.name] || []).slice().sort((a, b) => (b.t || 0) - (a.t || 0))) {
      const k = LOOT_KIND_NAME[r.kind] ? r.kind : "other";
      (by[k] = by[k] || []).push(r);
    }
    const subs = LOOT_KIND_ORDER.filter(k => k !== "bis" && by[k]).map(k =>
      `<div class="lcol lsub"><div class="lsubh">${kindLab(k)}</div>${by[k].map(line).join("")}</div>`).join("");
    return `<div class="lcolw"><div class="lcol"><div class="lch"><small>${esc(u.discord || "")}</small>
      <span class="lchn">${specImg(u, '<span class="ci"></span>')}<b style="color:${CLASS_COLOR[u.class] || "#fff"}">${nameHtml(u.display)}</b></span>
      <span class="lstat"><em>${L("{0} raids · {1} loots", u.raids, u.loots)}</em>${kindLab("bis")}</span></div>${(by.bis || []).map(line).join("") || `<div class="lcempty">—</div>`}</div>${subs}</div>`;
  }).join("");
  box.innerHTML = `<div class="lrbar"><span class="lroles">${roleBtns}</span><span class="mtop"><small>${L("Sort priority · drag to reorder")}</small>`
    + `<span class="chips" data-chipbar="lootOrder">${chipsHtml(UI.lootOrder)}</span></span></div>`
    + `<div class="lcols">${cols || `<div class="empty-list">${L(tokens.length ? "No character found." : "No character with this role.")}</div>`}</div>`;
}

// ---------------------------------------------------------------- Items (raid > boss > objets)
// une barre par raid (40 > 20 > 10) ; dépliée : ses boss (Settings > Phases, puis « Trash ») ; dépliés : les objets vus
// sur ce boss (icône, nom ≤ 25 caractères) et, à droite, les persos qui l'ont reçu (nom Discord + date au-dessus), du
// plus ancien au plus récent ; reçu plusieurs fois de suite par le même perso : une seule fois, « N x » devant (survol :
// les dates) ; recherche (nom, types) : barres dépliées tant qu'elle est remplie (repliables quand même)
const lootTrunc = (s, n) => { s = String(s || ""); return [...s].length > n ? [...s].slice(0, n - 1).join("") + "…" : s; };
function bossLootData(list) {
  const out = {};
  const add = (raid, boss, id) => { if (raid && boss && id) ((out[raid] = out[raid] || {})[boss] = out[raid][boss] || new Set()).add(+id); };
  for (const [raid, bosses] of Object.entries(ST.bossLoot || {})) for (const [b, items] of Object.entries(bosses || {})) for (const id of Object.keys(items || {})) add(raid, b, id);
  for (const r of list) add(r.raid || lootZoneRaid(r.zone), r.boss, r.id);
  // modifications à la main (officiers, en jeu) : supprimés / transférés retirés, ajoutés montrés
  for (const [key, e] of Object.entries(ST.bossLootEd || {})) {
    const [raid, boss, id] = key.split("|");
    if (e.op === "del") { if (out[raid] && out[raid][boss]) out[raid][boss].delete(+id); }
    else add(raid, boss, id);
  }
  return out;
}
function lootZoneRaid(zone) {
  if (!zone) return null;
  const z = String(zone).toLowerCase();
  for (const ph of PHASES) for (const r of ph.raids) if ([r.name, r.short].some(n => n && (z.includes(n.toLowerCase()) || n.toLowerCase().includes(z)))) return r.key;
  return null;
}
// attributions d'un objet : séries ininterrompues du même perso regroupées
function lootRuns(rs) {
  const out = [];
  for (const r of rs) {
    const last = out[out.length - 1];
    if (last && last.to === r.to) last.list.push(r); else out.push({ to: r.to, list: [r] });
  }
  return out;
}
function lootRunTip(list) {
  const byDay = new Map();
  for (const r of list) { const d = lootDateTxt(r.t || 0).slice(0, 10); byDay.set(d, (byDay.get(d) || 0) + 1); }
  return [...byDay].map(([d, n]) => `<div>${d}${n > 1 ? ` <b>×${n}</b>` : ""}</div>`).join("");
}
// Tables : même style que Craft. Barre du raid (image du raid recadrée, Settings > Phases & Raids) = métier ; boss =
// bouton dans la marge, aussi haut que sa liste de loots, avec sa bannière (cadrage du bouton fermé, agrandi en hauteur
// une fois déplié : placeCrop) ; clic droit sur un raid = tous ses boss dépliés / repliés
// boutons des boss 33 % plus petits (127 x 29,4 : même format que 190 x 44, donc mêmes cadrages)
const BOSS_BTN_W = 127, BOSS_BTN_H = 29.4, RAID_BAR_H = 136, RAID_BAR_RATIO = 8;
// boss replié : bouton 50 % plus large (format du recadrage de la bannière) ; déplié : 127 de large
const BOSS_BTN_SHUT_W = BOSS_BTN_W * 1.5;
let lootRaidBosses = {};
function renderLootBoss() {
  const box = $("#page-loots"), list = lootFiltered(), data = bossLootData(list), recv = {};
  UI.lootOpen = UI.lootOpen || {};
  UI.lootSClosed = UI.lootSClosed || {};
  for (const r of list) if (r.id) (recv[r.id] = recv[r.id] || []).push(r);
  for (const k in recv) recv[k].sort((a, b) => (a.t || 0) - (b.t || 0));
  const raids = (UI.lootPhase === null || UI.lootPhase === undefined ? PHASES : [PHASES[UI.lootPhase]].filter(Boolean)).flatMap(p => p.raids)
    .sort((a, b) => (b.size || 0) - (a.size || 0) || a.name.localeCompare(b.name));
  const q = lootQ().toLowerCase(), types = lootTypesOn(), searching = !!(q || types.length);
  const match = id => (!q || String(itemInfo(id).name || "").toLowerCase().includes(q)) && (!types.length || types.includes(lootItemType(id)));
  const isOpen = key => searching ? !UI.lootSClosed[key] : UI.lootOpen[key];
  const ids = [];
  let html = "";
  lootRaidBosses = {};
  // objets d'un boss : les plus reçus d'abord ; à droite les receveurs (Discord + date au-dessus)
  const itemsHtml = items => {
    const rows = items.map(id => ({ id, it: itemInfo(id), rs: recv[id] || [] }))
      .sort((a, b) => b.rs.length - a.rs.length || String(a.it.name || "").localeCompare(String(b.it.name || "")));
    // ordre de loot (persos qui l'ont reçu) caché aux membres si un officier l'a choisi
    const hideOrder = lootFlag("lootHideOrder");
    let h = "";
    for (const x of rows) {
      const cells = hideOrder ? "" : lootRuns(x.rs).map(run => {
        const r = run.list[run.list.length - 1], d = new Date((r.t || 0) * 1000), disc = discordOf(r.to), n = run.list.length;
        const cnt = n > 1 ? `<span class="lrn" data-tiphtml="${esc(lootRunTip(run.list))}">${n} x</span> ` : "";
        return `<span class="lrc"><small>${disc ? esc(disc) + " · " : ""}${p2(d.getDate())}/${p2(d.getMonth() + 1)}</small><b style="color:${CLASS_COLOR[lootClass(r.to)] || "#fff"}">${cnt}${nameHtml(r.to || "?")}</b></span>`;
      }).join("");
      h += `<div class="lbitem">${wishStar(x.id)}<span class="lcic"${x.it.icon ? ` style="background-image:url('${ICON_URL(x.it.icon)}')"` : ""} data-item="${x.id}"></span>`
        + `<span class="lbname" data-item="${x.id}" style="color:${QUALITY_COLOR[x.it.q] || "#fff"}">${esc(lootTrunc(x.it.name || "?", 25))}</span><span class="lrcs">${cells}</span></div>`;
    }
    return h || `<div class="lbempty">${L("No loot seen on this boss yet.")}</div>`;
  };
  for (const raid of raids) {
    const bosses = data[raid.key] || {};
    for (const s of Object.values(bosses)) ids.push(...s);
    const names = [], seen = new Set();
    for (const b of raid.bosses || []) if (b.name && !seen.has(b.name)) { seen.add(b.name); names.push(b); }
    for (const b of Object.keys(bosses).sort()) if (!seen.has(b) && b !== "Trash") { seen.add(b); names.push({ name: b }); }
    names.push({ name: "Trash" });
    const shown = names.map(b => ({ b, items: [...(bosses[b.name] || [])].filter(match) })).filter(x => !searching || x.items.length);
    if (searching && !shown.length) continue;
    lootRaidBosses[raid.key] = shown.map(x => raid.key + "|" + x.b.name);
    const total = shown.reduce((n, x) => n + x.items.length, 0);
    const open = isOpen(raid.key), bg = raidBgUrl(raid), blur = bg && raidBlurUrl(raid);
    // déplié : nom en grandes lettres « verre » (comme la tuile « New raid » des compos)
    // nom et taille en lettres « verre » (comme la tuile « New raid » des compos), deux fois plus grands replié
    const gl = blur ? " glass" : "";
    html += `<div class="cfprof lraidb${open ? " open" : ""}" data-lopen="${esc(raid.key)}" data-lraid="${esc(raid.key)}"${bg ? ` data-cimg="${esc(bg)}" data-crop="${cropAttr(raid.bar)}"` : ""}${blur ? ` data-cblur="${esc(blur)}"` : ""}
      data-help="Right-click: expand / collapse all its bosses"><span class="cimgbg"></span><span class="lcar${gl}">${open ? "▼" : "▶"}</span><span class="lrn2${gl}">${esc(raid.name)}</span><span class="lrs${gl}">${raid.size}</span><em>${L("{0} items", total)}</em></div>`;
    if (!open) continue;
    html += `<div class="lbcats">`;
    for (const { b, items } of shown) {
      const key = raid.key + "|" + b.name, bo = isOpen(key);
      const ban = b.banner && imgUrl(b.banner), ico = !ban && b.img && imgUrl(b.img);
      html += `<div class="lbblock${bo ? "" : " shut"}"><div class="lbgut"><button class="lbbtn${ban ? " ban" : ""}" data-lopen="${esc(key)}"${ban ? ` data-cimg="${esc(ban)}" data-crop="${cropAttr(b.bcrop)}"` : ""} data-help="${esc(L(b.name))} · ${items.length}"><span class="cimgbg"></span>`
        + `${ico ? `<span class="lbimg" style="background-image:url('${ico}')"></span>` : ""}<b>${esc(L(b.name))}</b><small>${items.length}</small></button></div>`
        + `<div class="lbrows">${bo ? itemsHtml(items) : `<div class="cfshut lbshut" data-lopen="${esc(key)}">${L("{0} items", items.length)}</div>`}</div></div>`;
    }
    html += `</div>`;
  }
  // types : l'infobulle Wowhead de chaque objet connu est nécessaire
  ensureItems(searching ? ids : ids.slice(0, 40));
  // défilement gardé quand un raid / boss est déplié ou replié ; hauteur des barres de raid d'avant (animation)
  const old = box.querySelector(".lbosses"), scroll = old ? old.scrollTop : 0, oldH = {}, oldB = {};
  if (old) old.querySelectorAll(".lraidb").forEach(b => { oldH[b.dataset.lraid] = b.offsetHeight; });
  // boss : état et tailles d'avant (animation du bloc et du bouton)
  if (old) old.querySelectorAll(".lbbtn").forEach(b => {
    const blk = b.closest(".lbblock");
    oldB[b.dataset.lopen] = { shut: blk.classList.contains("shut"), h: blk.offsetHeight, w: b.offsetWidth, bh: b.offsetHeight, cols: getComputedStyle(blk).gridTemplateColumns };
  });
  box.innerHTML = `<div class="lbosses">${html || `<div class="empty-list">${L(searching ? "No item found." : "No raid in this phase.")}</div>`}</div>`;
  box.querySelector(".lbosses").scrollTop = scroll;
  placeCrops(box);
  animateRaidBars(box, oldH);
  animateBossBlocks(box, oldB);
}
// raid déplié / replié : sa barre passe progressivement de l'ancienne hauteur à la nouvelle (image comprise : cadrage
// calculé aux deux tailles, la transition CSS fait le reste) ; boss d'un raid qui vient de s'ouvrir : en fondu
function animateRaidBars(box, oldH) {
  box.querySelectorAll(".lraidb").forEach(el => {
    // hauteur d'arrivée d'après l'état (un rendu en pleine animation mesurerait une hauteur intermédiaire)
    const from = oldH[el.dataset.lraid], to = el.classList.contains("open") ? 34 : RAID_BAR_H, w = el.clientWidth;
    if (!from || from === to) return;
    // transitions posées seulement le temps de l'animation (sinon chaque nouveau rendu ferait glisser l'image)
    const layers = [el, ...el.querySelectorAll(".cimgbg, .glass")];
    const TR = "height .28s ease, font-size .28s ease, background-size .28s ease, background-position .28s ease";
    el.style.height = from + "px";
    placeCrop(el, w, from);
    void el.offsetHeight;
    // lettres : taille de départ (l'autre état), puis celle de la classe (transition CSS)
    const big = to < from;
    el.querySelectorAll(".glass").forEach(g => { g.style.fontSize = parseFloat(getComputedStyle(g).fontSize) * (big ? 2 : 0.5) + "px"; });
    void el.offsetHeight;
    layers.forEach(x => { x.style.transition = TR; });
    el.style.height = to + "px";
    el.querySelectorAll(".glass").forEach(g => { g.style.fontSize = ""; });
    placeCrop(el, w, to);
    el.addEventListener("transitionend", function done(e) {
      if (e.target !== el || e.propertyName !== "height") return;
      el.style.height = "";
      layers.forEach(x => { x.style.transition = ""; });
      // fin de l'animation : lettres « verre » réalignées sur l'image (leur place a bougé avec leur taille)
      setTimeout(() => placeCrop(el), 40);
      el.removeEventListener("transitionend", done);
    });
    if (to > from) return;
    const cats = el.nextElementSibling;
    if (cats && cats.classList.contains("lbcats")) cats.classList.add("lbin");
  });
}
// phase choisie en grand en bas à droite de la fenêtre (onglet Loots), lettres « verre » remplies de l'image de fond
// de la fenêtre (alignée sur elle, en « cover ») : au-dessus du fond, sous le reste
function renderPhaseMark() {
  const m = $("#phaseMark");
  if (!m) return;
  const on = UI.page === "loots";
  m.hidden = !on;
  if (!on) return;
  const ph = UI.lootPhase === null || UI.lootPhase === undefined ? null : PHASES[UI.lootPhase];
  m.textContent = ph ? (ph.name || L("Phase {0}", UI.lootPhase + 1)) : L("All Raids");
  const url = ST.bgUrl, ar = url && IMG_AR[url];
  if (!url) { m.style.backgroundImage = "none"; m.style.color = "rgba(255,255,255,.35)"; return; }
  m.style.color = "";
  if (!ar) {
    if (ar === undefined) { IMG_AR[url] = 0; const im = new Image(); im.onload = () => { IMG_AR[url] = im.naturalWidth / im.naturalHeight || 1; renderPhaseMark(); }; im.src = url; }
    return;
  }
  const app = $("#app"), W = app.clientWidth, H = app.clientHeight;
  let bw = W, bh = W / ar;
  if (bh < H) { bh = H; bw = H * ar; }
  const bx = (W - bw) / 2, by = (H - bh) / 2;
  m.style.backgroundImage = `linear-gradient(rgba(255,255,255,.3), rgba(255,255,255,.3)), url('${url}')`;
  m.style.backgroundSize = `auto, ${bw}px ${bh}px`;
  m.style.backgroundPosition = `0 0, ${bx - m.offsetLeft}px ${by - m.offsetTop}px`;
}
window.addEventListener("resize", renderPhaseMark);
// boss déplié / replié : son bloc passe progressivement de l'ancienne hauteur à la nouvelle, la marge et le bouton de
// l'ancienne largeur à la nouvelle (replié : 50 % plus large), la bannière suit (cadrage aux deux tailles)
function animateBossBlocks(box, oldB) {
  const TR = ".28s ease";
  box.querySelectorAll(".lbbtn").forEach(btn => {
    const o = oldB[btn.dataset.lopen], blk = btn.closest(".lbblock");
    if (!o || o.shut === blk.classList.contains("shut")) return;
    const to = { h: blk.offsetHeight, w: btn.offsetWidth, cols: getComputedStyle(blk).gridTemplateColumns };
    const bg = btn.querySelector(".cimgbg");
    Object.assign(blk.style, { height: o.h + "px", overflow: "hidden", gridTemplateColumns: o.cols });
    btn.style.width = o.w + "px";
    placeCrop(btn, o.w, o.bh);
    void blk.offsetHeight;
    blk.style.transition = `height ${TR}, grid-template-columns ${TR}`;
    btn.style.transition = `width ${TR}`;
    if (bg) bg.style.transition = `background-size ${TR}, background-position ${TR}`;
    Object.assign(blk.style, { height: to.h + "px", gridTemplateColumns: to.cols });
    btn.style.width = to.w + "px";
    placeCrop(btn, to.w, to.h);
    blk.addEventListener("transitionend", function done(e) {
      if (e.target !== blk || e.propertyName !== "height") return;
      blk.removeEventListener("transitionend", done);
      Object.assign(blk.style, { height: "", overflow: "", gridTemplateColumns: "", transition: "" });
      Object.assign(btn.style, { width: "", transition: "" });
      if (bg) bg.style.transition = "";
      placeCrop(btn);
    });
  });
}
// clic droit sur la barre d'un raid : tous ses boss dépliés (s'il en reste un replié), sinon tous repliés
document.addEventListener("contextmenu", e => {
  const el = UI.page === "loots" && e.target.closest && e.target.closest("[data-lraid]");
  if (!el) return;
  e.preventDefault();
  const rk = el.dataset.lraid, keys = lootRaidBosses[rk] || [], searching = !!(lootQ() || lootTypesOn().length);
  const isOpen = k => searching ? !UI.lootSClosed[k] : !!UI.lootOpen[k];
  const openAll = !isOpen(rk) || keys.some(k => !isOpen(k));
  for (const k of [rk, ...keys]) {
    if (k !== rk || openAll) { if (searching) UI.lootSClosed[k] = !openAll; else UI.lootOpen[k] = openAll; }
  }
  saveUI();
  renderLoots();
});
// fenêtre redimensionnée, barre de défilement apparue : cadrages des barres et des bannières recalculés
window.addEventListener("resize", () => { if (UI.page === "loots") placeCrops($("#page-loots")); });
let lootListW = 0;
new ResizeObserver(() => {
  const l = UI.page === "loots" && document.querySelector("#page-loots .lbosses");
  if (!l || l.clientWidth === lootListW) return;
  lootListW = l.clientWidth;
  placeCrops(l);
}).observe($("#page-loots"));
document.addEventListener("click", e => {
  if (UI.page !== "loots") return;
  let el;
  if ((el = e.target.closest("[data-ltab]"))) { UI.lootTab = el.dataset.ltab; $("#lootTypeList").hidden = true; render(); return; }
  if ((el = e.target.closest("[data-lrole]"))) { UI.lootRoles[el.dataset.lrole] = !UI.lootRoles[el.dataset.lrole]; render(); return; }
  if ((el = e.target.closest("[data-lclass]"))) { UI.lootClasses[el.dataset.lclass] = !UI.lootClasses[el.dataset.lclass]; render(); return; }
  if ((el = e.target.closest("[data-lcheck]"))) {
    // tout choisi : tout retiré ; sinon tout choisi
    const roles = el.dataset.lcheck === "roles", keys = roles ? ROLE_ORDER : CLASS_ORDER, set = roles ? UI.lootRoles : UI.lootClasses;
    const all = keys.every(k => set[k]);
    for (const k of keys) set[k] = !all;
    render(); return;
  }
  if ((el = e.target.closest("[data-lopen]"))) {
    // recherche en cours : barres dépliées par défaut, repliables
    const k = el.dataset.lopen;
    if (lootQ() || lootTypesOn().length) UI.lootSClosed[k] = !UI.lootSClosed[k]; else UI.lootOpen[k] = !UI.lootOpen[k];
    render(); return;
  }
  if ((el = e.target.closest("[data-lootweek]"))) {
    UI.lootWeek = el.dataset.lootweek ? +el.dataset.lootweek : null;
    $("#picker").hidden = true;
    render();
  }
});

// noms des persos (Members) filtrés par la frappe
function fillLootTo(inp) {
  const q = inp.value.trim().toLowerCase();
  const names = memberUnits().map(u => u).filter(u => !q || u.display.toLowerCase().includes(q)).slice(0, 40);
  const list = $("#lootToList");
  list.innerHTML = names.map(u => `<button data-lootpick="${esc(u.name)}" style="color:${CLASS_COLOR[u.class] || "#fff"}">${nameHtml(u.display)}</button>`).join("")
    || `<div class="help">${L("No character found.")}</div>`;
  list.hidden = false;
}
document.addEventListener("input", e => { if (e.target.id === "lootToIn") fillLootTo(e.target); });
document.addEventListener("keydown", e => {
  if (e.target.id === "lootToIn") {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); lootEdit = null; renderLoots(); }
    else if (e.key === "Enter") { const b = $("#lootToList button.kbsel") || $("#lootToList button"); if (b) b.click(); }
  }
  // ligne ajoutée : Entrée = 1er choix de la liste, Échap = annuler
  if (["lnItem", "lnTo"].includes(e.target.id)) {
    if (e.key === "Enter") { const b = $(`#${e.target.id}List button.kbsel`) || $(`#${e.target.id}List button`); if (b) b.click(); e.preventDefault(); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); lootNew = null; renderLoots(); }
  }
}, true);
document.addEventListener("dblclick", e => {
  if (!canEdit() || !e.target.closest) return;
  const el = e.target.closest("[data-lootto]"), ek = e.target.closest("[data-lootkind]");
  if (el) { lootEdit = el.dataset.lootto; lootKindEdit = null; renderLoots(); }
  else if (ek) { lootKindEdit = ek.dataset.lootkind; lootEdit = null; renderLoots(); }
});
document.addEventListener("click", async e => {
  if (UI.page !== "loots") return;
  const t = e.target;
  let el;
  if ((el = t.closest("[data-lootpick]"))) {
    const k = lootEdit, name = el.dataset.lootpick;
    lootEdit = null;
    const r = await api().loot_edit(k, name, false);
    if (!r || r.ok === false) toast((r && r.error) || "Error", true);
    reload(); return;
  }
  if ((el = t.closest("[data-lootkpick]"))) {
    const k = lootKindEdit;
    lootKindEdit = null;
    const r = await api().loot_edit(k, null, false, el.dataset.lootkpick);
    if (!r || r.ok === false) toast((r && r.error) || "Error", true);
    reload(); return;
  }
  if ((el = t.closest("[data-lootdel]"))) {
    // 1er clic : « Confirm » ; 2e clic : supprimée de la base
    if (!el.classList.contains("armed")) {
      el.classList.add("armed"); el.textContent = L("Confirm");
      setTimeout(() => { if (el.isConnected) { el.classList.remove("armed"); el.textContent = "×"; } }, 4000);
      return;
    }
    const r = await api().loot_edit(el.dataset.lootdel, null, true);
    if (!r || r.ok === false) toast((r && r.error) || "Error", true);
    reload(); return;
  }
  // ligne ajoutée à la main
  if (t.closest("[data-lootadd]")) { lootNew = { id: null, to: "", kind: "", t: now() }; renderLoots(); $("#lnItem").focus(); return; }
  if ((el = t.closest("[data-lnitem]"))) {
    lootNew.id = +el.dataset.lnitem; lootNew.itemTxt = "";
    ensureItems([lootNew.id]);
    renderLoots(); $("#lnTo").focus(); return;
  }
  if ((el = t.closest("[data-lnto]"))) { lootNew.to = el.dataset.lnto; renderLoots(); return; }
  if ((el = t.closest("[data-lnmon]"))) {
    const d = new Date(lootNew.t * 1000);
    d.setMonth(d.getMonth() + +el.dataset.lnmon);
    lnSetT(Math.floor(d.getTime() / 1000)); return;
  }
  if ((el = t.closest("[data-lnday]"))) {
    const d = new Date(lootNew.t * 1000);
    d.setDate(+el.dataset.lnday);
    lnSetT(Math.floor(d.getTime() / 1000)); $("#lnCal").hidden = true; return;
  }
  if (t.closest("[data-lncancel]")) { lootNew = null; renderLoots(); return; }
  if (t.closest("[data-lnsave]")) {
    if (!lootNew.id || !lootNew.to) { toast(L("Choose an item and a character."), true); return; }
    const kind = $("#lnKind") ? $("#lnKind").value : lootNew.kind;
    const r = await api().loot_add({ id: lootNew.id, name: itemInfo(lootNew.id).name, to: lootNew.to, kind: kind || null, t: lootNew.t });
    if (!r || r.ok === false) { toast((r && r.error) || "Error", true); return; }
    lootNew = null;
    reload(); return;
  }
  if (lootNew) {
    if (!t.closest("#lnItem") && !t.closest("#lnItemList") && $("#lnItemList")) $("#lnItemList").hidden = true;
    if (!t.closest("#lnTo") && !t.closest("#lnToList") && $("#lnToList")) $("#lnToList").hidden = true;
    if (!t.closest("#lnDate") && !t.closest("#lnCal") && $("#lnCal")) $("#lnCal").hidden = true;
  }
  if (lootEdit && !t.closest(".lto")) { lootEdit = null; renderLoots(); }
  if (lootKindEdit && !t.closest(".lkd")) { lootKindEdit = null; renderLoots(); }
});

// ---------------------------------------------------------------- Wishlist (par perso, partagée avec le perso)
// Chacun ajoute des objets à la wishlist de ses persos (objet, perso, roll voulu : comme l'ajout de History) ; les
// officiers voient celle d'un autre joueur (son nom Discord dans la recherche de la barre). Un titre dépliable par perso ;
// objet obtenu (attribution à ce perso dans la base) : fond doré, en bas de la liste ; objet d'une phase passée : rangé
// sous une ligne « Phase X » en bas (un sous-titre par perso). Tables : étoile devant chaque loot (ajout / retrait).
const WISH_KINDS = ["bis", "upp", "up", "os", "pvp", "mog"];
const STAR_SVG = on => `<svg viewBox="0 0 24 24"><path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z" fill="${on ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
let wishNew = null;      // ligne d'ajout : { id, itemTxt, char, k }
const wishMine = () => (ST.myChars || []).filter(c => !c.hidden);
const wishOf = name => (ST.wishlists || {})[name] || [];
async function wishSave(char, items) {
  const r = await api().wishlist_set(char, items);
  if (r && r.ok === false) { toast(r.error, true); return; }
  ST.wishlists = r;
  render();
}
// phase d'un objet : celle du raid dont la table le contient (null = inconnue, jamais archivé)
function wishItemPhase(id) {
  for (const [raid, bosses] of Object.entries(ST.bossLoot || {})) {
    if (!Object.values(bosses || {}).some(items => items && items[String(id)] !== undefined)) continue;
    const pi = PHASES.findIndex(p => p.raids.some(r => r.key === raid));
    if (pi >= 0) return pi;
  }
  return null;
}
// le perso a reçu l'objet (base des attributions ; anciens noms sans le nom de famille acceptés)
function wishGot(char, id) {
  const f = String(char).split(" ")[0];
  return (ST.lootDB || []).some(r => +r.id === +id && (r.to === char || String(r.to || "").split(" ")[0] === f));
}
// persos montrés : les miens, ou (officier) ceux du joueur dont le nom Discord est cherché
function wishTargets() {
  const q = lootQ().toLowerCase();
  if (!q || !isOfficerUser()) return { own: true, chars: wishMine().map(c => ({ name: c.name, class: c.class })) };
  const units = memberUnits().filter(u => u.discord && !String(u.name).startsWith("~"));
  const exact = units.filter(u => String(u.discord).toLowerCase() === q);
  const disc = (exact[0] || units.find(u => String(u.discord).toLowerCase().includes(q)) || {}).discord;
  return { own: false, who: disc, chars: disc ? units.filter(u => u.discord === disc).map(u => ({ name: u.name, class: u.class })) : [] };
}
// options de roll : chacune de sa couleur (sinon elles prennent toutes celle du roll choisi)
const wishKindOpts = sel => WISH_KINDS.map(k => `<option value="${k}"${k === sel ? " selected" : ""} style="color:${LOOT_KIND_COL[k] || "#ccc"}">${esc(L(LOOT_KIND[k]))}</option>`).join("");
// arch : ligne d'archive (seul un officier peut la retirer, pour tout le monde)
function wishRow(char, x, own, arch) {
  const it = itemInfo(x.id), got = wishGot(char, x.id), col = LOOT_KIND_COL[x.k] || "#999ead";
  // obtenu ou archivé : roll figé
  const kind = own && !got && !arch
    ? `<select class="lootsel wkind" data-wkind="${esc(char)}|${x.id}" style="color:${col}">${wishKindOpts(x.k)}</select>`
    : `<b class="wkind" style="color:${col}">${esc(L(LOOT_KIND[x.k] || x.k))}</b>`;
  const del = arch ? (isOfficerUser() ? `<button class="ldel" data-warch="${esc(char)}|${x.id}" data-help="Remove this archive for everyone (officers)">×</button>` : "")
    : own ? `<button class="ldel" data-wdel="${esc(char)}|${x.id}" data-help="Remove from the wishlist">×</button>` : "";
  return `<div class="lbitem wrow${got ? " got" : ""}"><span class="lcic"${it.icon ? ` style="background-image:url('${ICON_URL(it.icon)}')"` : ""} data-item="${x.id}"></span>`
    + `<span class="lbname" data-item="${x.id}" style="color:${QUALITY_COLOR[it.q] || "#fff"}">${esc(lootTrunc(it.name || "?", 30))}</span>${kind}`
    + `<span class="wdate">${got ? `<b class="wgot">${esc(L("Obtained"))}</b>` : x.t ? lootDateTxt(x.t).slice(0, 10) : ""}</span>${del}</div>`;
}
function wishNewRow() {
  const n = wishNew, it = n.id ? itemInfo(n.id) : null, mine = wishMine();
  return `<div class="lootrow lnew wnew">
    <span class="lic"${it && it.icon ? ` style="background-image:url('${ICON_URL(it.icon, "medium")}')"` : ""}></span>
    <span class="efcombo"><input class="ef" id="wnItem" value="${esc(it ? it.name : n.itemTxt || "")}" placeholder="${esc(L("Item: name, ID or Wowhead link"))}" autocomplete="off"
      ${it ? ` style="color:${QUALITY_COLOR[it.q] || "#fff"}"` : ""}><span class="eflist" id="wnItemList" hidden></span></span>
    <select class="lootsel" id="wnChar">${mine.map(c => `<option value="${esc(c.name)}"${c.name === n.char ? " selected" : ""} style="color:${CLASS_COLOR[c.class] || "#fff"}">${esc(c.name)}</option>`).join("")}</select>
    <select class="lootsel" id="wnKind">${wishKindOpts(n.k)}</select>
    <span class="lnbtns"><button class="lnok" data-wnsave="1" data-help="Save">✓</button><button class="ldel" data-wncancel="1" data-help="Cancel">×</button></span></div>`;
}
function renderLootWish() {
  // archivé : objet qui ne vient pas d'un raid de la phase la plus récente ; archives retirées par un officier : cachées
  const box = $("#page-loots"), T = wishTargets(), latest = PHASES.length - 1, hidden = ST.wishArchHide || {};
  UI.wishOpen = UI.wishOpen || {};
  const ids = [], archived = {};
  let html = "";
  if (T.own) html += wishNew ? wishNewRow() : (wishMine().length ? `<button class="lootadd" data-wadd="1" data-help="Add an item to the wishlist of one of your characters">+</button>`
    : `<div class="empty-list">${L("No character of yours is known yet: log in with Discord and play them once with Guild Tool.")}</div>`);
  else if (!T.chars.length) html += `<div class="empty-list">${L("No player found with this Discord name.")}</div>`;
  for (const c of T.chars) {
    const all = wishOf(c.name).map(x => ({ ...x, ph: wishItemPhase(x.id) }));
    all.forEach(x => ids.push(x.id));
    // seuls les objets obtenus sont archivés (non obtenus : restent dans la liste du perso)
    const isArch = x => x.ph !== null && x.ph < latest && wishGot(c.name, x.id);
    const act = all.filter(x => !isArch(x));
    all.filter(x => isArch(x) && !hidden[c.name + "|" + x.id])
      .forEach(x => { ((archived[x.ph] = archived[x.ph] || {})[c.name] = archived[x.ph][c.name] || []).push(x); });
    // obtenus en bas de la liste
    act.sort((a, b) => wishGot(c.name, a.id) - wishGot(c.name, b.id) || (a.t || 0) - (b.t || 0));
    const key = "c:" + c.name, open = UI.wishOpen[key] !== false;
    html += `<div class="lbar lraid${open ? " open" : ""}" data-wopen="${esc(key)}"><span class="tri"></span><b style="color:${CLASS_COLOR[c.class] || "#fff"}">${nameHtml(c.name)}</b><span class="lbn">${L("{0} items", act.length)}</span></div>`;
    if (open) html += act.map(x => wishRow(c.name, x, T.own)).join("") || `<div class="lbempty">${L("Nothing wishlisted on this character.")}</div>`;
  }
  // Archives : grand titre, puis une ligne par phase (de la précédente à la première), une ligne par perso (décalée),
  // ses objets
  const phs = Object.keys(archived).map(Number).sort((a, b) => b - a);
  if (phs.length) {
    html += `<div class="warchtitle">${esc(L("Archives"))}</div>`;
    for (const pi of phs) {
      const key = "p:" + pi, open = !!UI.wishOpen[key];
      const n = Object.values(archived[pi]).reduce((t, l) => t + l.length, 0);
      html += `<div class="lbar lraid wphase${open ? " open" : ""}" data-wopen="${esc(key)}"><span class="tri"></span><b>${esc(L("Phase {0}", pi + 1))}</b><span class="lbn">${L("{0} items", n)}</span></div>`;
      if (!open) continue;
      for (const [char, list] of Object.entries(archived[pi])) {
        const k2 = key + ":" + char, o2 = !!UI.wishOpen[k2], cls = (T.chars.find(c => c.name === char) || {}).class;
        list.sort((a, b) => wishGot(char, b.id) - wishGot(char, a.id));
        html += `<div class="lbar lboss${o2 ? " open" : ""}" data-wopen="${esc(k2)}"><span class="tri"></span><b style="color:${CLASS_COLOR[cls] || "#fff"}">${nameHtml(char)}</b><span class="lbn">${L("{0} items", list.length)}</span></div>`;
        if (o2) html += list.map(x => `<div class="warchrow">${wishRow(char, x, T.own, true)}</div>`).join("");
      }
    }
  }
  ensureItems(ids);
  const head = T.own ? "" : `<div class="whead">${esc(L("Wishlist of {0}", T.who || "?"))}</div>`;
  box.innerHTML = `<div class="lbosses wishes">${head}${html}</div>`;
  if (wishNew && !wishNew.id) { const inp = $("#wnItem"); if (inp) inp.focus(); }
}
function fillWnItem() {
  const inp = $("#wnItem"), q = inp.value.trim(), list = $("#wnItemList");
  const idm = q.match(/item[=:](\d+)/i) || q.match(/^(\d+)$/);
  let html = "";
  if (idm) html = `<button data-wnitem="${idm[1]}">${L("Item #{0}", idm[1])}</button>`;
  else if (q.length >= 2) {
    const ql = q.toLowerCase(), out = [];
    for (const [id, name] of lootKnownItems()) if (name && String(name).toLowerCase().includes(ql)) out.push([id, name]);
    html = out.slice(0, 30).map(([id, name]) => `<button data-wnitem="${id}" style="color:${QUALITY_COLOR[itemInfo(id).q] || "#fff"}">${esc(name)}</button>`).join("");
  }
  list.innerHTML = html || `<div class="help">${L(q.length < 2 ? "Type at least 2 letters, an ID or a Wowhead link." : "No item found.")}</div>`;
  list.hidden = false;
}
document.addEventListener("input", e => {
  if (e.target.id === "wnItem" && wishNew) { wishNew.itemTxt = e.target.value; wishNew.id = null; fillWnItem(); }
});
document.addEventListener("change", async e => {
  if (e.target.id === "wnChar" && wishNew) wishNew.char = e.target.value;
  if (e.target.id === "wnKind" && wishNew) wishNew.k = e.target.value;
  const k = e.target.closest && e.target.closest("[data-wkind]");
  if (k) {
    const [char, id] = k.dataset.wkind.split("|");
    await wishSave(char, wishOf(char).map(x => +x.id === +id ? { ...x, k: k.value } : x));
  }
});
document.addEventListener("click", async e => {
  if (UI.page !== "loots") return;
  let el;
  if ((el = e.target.closest("[data-wopen]"))) {
    const k = el.dataset.wopen;
    UI.wishOpen = UI.wishOpen || {};
    UI.wishOpen[k] = k.startsWith("c:") ? UI.wishOpen[k] === false : !UI.wishOpen[k];
    renderLoots(); return;
  }
  if (e.target.closest("[data-wadd]")) { const m = wishMine(); wishNew = { id: null, itemTxt: "", char: m[0] && m[0].name, k: "bis" }; renderLoots(); return; }
  if (e.target.closest("[data-wncancel]")) { wishNew = null; renderLoots(); return; }
  if ((el = e.target.closest("[data-wnitem]"))) { wishNew.id = +el.dataset.wnitem; wishNew.itemTxt = ""; renderLoots(); return; }
  if (e.target.closest("[data-wnsave]")) {
    const n = wishNew;
    if (!n || !n.id || !n.char) { toast(L("Choose an item and a character."), true); return; }
    wishNew = null;
    await wishSave(n.char, wishOf(n.char).filter(x => +x.id !== +n.id).concat([{ id: n.id, k: n.k || "bis", t: now() }]));
    return;
  }
  if ((el = e.target.closest("[data-warch]"))) {
    const [char, id] = el.dataset.warch.split("|");
    const r = await api().wish_arch_hide(char, +id);
    if (r && r.ok === false) { toast(r.error, true); return; }
    ST.wishArchHide = r.hide;
    renderLoots();
    return;
  }
  if ((el = e.target.closest("[data-wdel]"))) {
    const [char, id] = el.dataset.wdel.split("|");
    await wishSave(char, wishOf(char).filter(x => +x.id !== +id));
    return;
  }
});

// Tables : étoile devant chaque loot (pleine si l'objet est dans la wishlist d'un de mes persos) ; clic = popup
// (perso, roll, Ajouter ; entrées existantes retirables)
const wishHasMine = id => wishMine().some(c => wishOf(c.name).some(x => +x.id === +id));
function wishStar(id) {
  return `<button class="wstar${wishHasMine(id) ? " on" : ""}" data-wstar="${id}" data-help="Wishlist">${STAR_SVG(wishHasMine(id))}</button>`;
}
function openWishPop(id, anchor) {
  const mine = wishMine();
  if (!mine.length) { toast(L("No character of yours is known yet: log in with Discord and play them once with Guild Tool."), true); return; }
  let p = $("#wishPop");
  if (!p) { p = document.createElement("div"); p.id = "wishPop"; p.className = "wpop"; document.body.appendChild(p); }
  const it = itemInfo(id), have = mine.flatMap(c => wishOf(c.name).filter(x => +x.id === +id).map(x => ({ c, x })));
  p.dataset.item = id;
  p.innerHTML = `<div class="wph" style="color:${QUALITY_COLOR[it.q] || "#fff"}">${esc(it.name || "?")}</div>
    ${have.map(h => `<div class="wpon"><b style="color:${CLASS_COLOR[h.c.class] || "#fff"}">${esc(h.c.name)}</b><span style="color:${LOOT_KIND_COL[h.x.k] || "#999"}">${esc(L(LOOT_KIND[h.x.k]))}</span><button class="ldel" data-wpdel="${esc(h.c.name)}">×</button></div>`).join("")}
    <select class="lootsel" id="wpChar">${mine.map(c => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join("")}</select>
    <select class="lootsel" id="wpKind">${wishKindOpts()}</select>
    <button class="btn pri" data-wpadd="1">${esc(L("Add to wishlist"))}</button>`;
  const r = anchor.getBoundingClientRect();
  p.hidden = false;
  p.style.left = Math.min(innerWidth - p.offsetWidth - 8, r.right + 6) + "px";
  p.style.top = Math.min(innerHeight - p.offsetHeight - 8, r.top - 4) + "px";
}
document.addEventListener("click", async e => {
  const p = $("#wishPop");
  let el;
  if ((el = e.target.closest && e.target.closest("[data-wstar]"))) { e.stopPropagation(); openWishPop(+el.dataset.wstar, el); return; }
  if (!p || p.hidden) return;
  if (!e.target.closest("#wishPop")) { p.hidden = true; return; }
  const id = +p.dataset.item;
  if (e.target.closest("[data-wpadd]")) {
    const char = $("#wpChar").value, k = $("#wpKind").value;
    p.hidden = true;
    await wishSave(char, wishOf(char).filter(x => +x.id !== id).concat([{ id, k, t: now() }]));
    toast(L("Added to the wishlist of {0}.", char));
    return;
  }
  if ((el = e.target.closest("[data-wpdel]"))) {
    const char = el.dataset.wpdel;
    p.hidden = true;
    await wishSave(char, wishOf(char).filter(x => +x.id !== id));
  }
}, true);
document.addEventListener("keydown", e => { const p = $("#wishPop"); if (e.key === "Escape" && p && !p.hidden) p.hidden = true; });

// Listes déroulantes des champs (objet, perso, wishlist...) : flèches haut / bas pour parcourir, Entrée pour choisir
document.addEventListener("keydown", e => {
  if (!["ArrowDown", "ArrowUp", "Enter"].includes(e.key)) return;
  const inp = e.target.closest && e.target.closest(".efcombo input");
  if (!inp) return;
  const list = inp.parentElement.querySelector(".eflist");
  if (!list || list.hidden) return;
  const btns = [...list.querySelectorAll("button")];
  if (!btns.length) return;
  let i = btns.findIndex(b => b.classList.contains("kbsel"));
  if (e.key === "Enter") {
    // champs déjà gérés plus haut (historique) : Entrée y prend aussi le choix sélectionné
    if (["lootToIn", "lnItem", "lnTo"].includes(inp.id)) return;
    e.preventDefault();
    (btns[i] || btns[0]).click();
    return;
  }
  e.preventDefault();
  i = e.key === "ArrowDown" ? Math.min(btns.length - 1, i + 1) : Math.max(0, i - 1);
  btns.forEach(b => b.classList.remove("kbsel"));
  btns[i].classList.add("kbsel");
  btns[i].scrollIntoView({ block: "nearest" });
});
