"use strict";
// Assigns : pour chaque compo, un onglet récap + un onglet par boss (presets du raid, créés en mode Config).
// Les noms se remplissent d'après des blocs de critères (rôles, classes, spés, index ou nombre) essayés dans l'ordre
// (« else » = bloc de secours) ; un clic sur un nom le remplace à la main.
// Coordonnées des éléments : repère de la carte 1000 x 625 (ratio 1,6), le même que dans l'addon.

const MAP_W = 1000, MAP_H = 625;
let aCfg = false;          // mode Config (éditeur)
let aTool = "select";
let aDraft = null;         // forme en cours de tracé { type, pts }
let aSels = [];            // éléments sélectionnés (mode Config ; Ctrl+clic = plusieurs)
let aPreview = null;       // nom survolé dans la liste « Exclude results of » (surligné, sa phase affichée)
let aSpellQ = "";
const emptyCrit = () => ({ roles: [], classes: [], specs: [], idx: 1, multi: false, amount: 2 });
const aTpl = { crits: [emptyCrit()], action: "", text: "", spell: null, boss: null, role: "Tank", mark: 8, color: "#ffffff", w: 4 };
const A_UNDO = [];
const IMG = {};            // images d'assigns chargées à la demande (id -> data URL)
let APRE = null;           // presets (seul l'exe les modifie : chargés une fois)
let curPh = null, curTab = null, curComp = null, curRes = {};

const spellIcon = icon => `https://wow.zamimg.com/images/wow/icons/medium/${icon}.jpg`;
const BUST_SVG = '<svg viewBox="0 0 24 24"><path d="M12 2.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9zM3.5 21c0-4.4 3.8-7.5 8.5-7.5s8.5 3.1 8.5 7.5z"/></svg>';
const DRAW_SVG = '<svg viewBox="0 0 24 24"><path d="M3 17.2V21h3.8L17.9 9.9l-3.8-3.8zM20.7 7a1 1 0 0 0 0-1.4l-2.3-2.3a1 1 0 0 0-1.4 0l-1.8 1.8 3.8 3.8z"/></svg>';
const TOOLS = [["select", "Select", "➤"], ["name", "Player name", BUST_SVG], ["text", "Text", "Aa"], ["draw", "Draw", DRAW_SVG],
               ["arrow", "Arrow", "→"], ["line", "Line", "╱"], ["circle", "Circle", "◯"], ["rect", "Rectangle", "▭"],
               ["spell", "Spell", `<img src="${spellIcon("inv_misc_questionmark")}" alt="">`], ["role", "Role icon", `<img src="${ROLE_ICON.Healer}" alt="">`],
               ["mark", "Raid marker", '<img src="icons/mark_1.png" alt="">'], ["boss", "Boss", "☠"]];
const SHAPES = ["arrow", "line", "circle", "rect"];
const PATHS = ["arrow", "line", "circle", "rect", "draw"];      // éléments faits de points
const ICONS = ["spell", "boss", "role", "mark"];                // icônes redimensionnables
const DEF_SIZE = { name: 16, text: 20, spell: 36, boss: 70, role: 36, mark: 36 };
const COLORS = ["#ffffff", "#ffd140", "#ff6b6b", "#5fd38d", "#6f9cff", "#c77dff"];
const MARKS = ["Star", "Circle", "Diamond", "Triangle", "Moon", "Square", "Cross", "Skull"];
const palette = () => COLORS.concat((UI.aColors || []).filter(c => !COLORS.includes(c)));

// ------------------------------------------------------------------ compos de toutes les semaines
function assignComps() {
  const out = [];
  for (const [k, w] of Object.entries(ST.weeks)) for (const c of w.comps) {
    if (!c.valid && !canEdit()) continue;        // compo cachée : officiers seulement
    const ev = c.event && eventById(c.event);
    out.push({ comp: c, ws: +k, ev, ts: ev && ev.start ? ev.start : +k });
  }
  // compos des events communautaires : visibles (œil), sinon pour leur créateur et les officiers
  for (const c of ccompList()) {
    const ev = eventById(c.event);
    if (!ev || !canSeeComp(c)) continue;
    out.push({ comp: c, ws: weekStart(ev.start), ev, ts: ev.start });
  }
  out.sort((a, b) => a.ts - b.ts);
  // libellé « jj/mm - Raid #n » : #n seulement si le même raid apparaît plusieurs fois pour l'event
  const groups = {}, gk = a => (a.comp.event || "w" + a.ws) + ":" + a.comp.raid;
  for (const a of out) (groups[gk(a)] = groups[gk(a)] || []).push(a);
  const p2 = n => String(n).padStart(2, "0");
  for (const a of out) {
    const g = groups[gk(a)], r = raidByKey(a.comp.raid), d = new Date(a.ts * 1000);
    a.label = `${p2(d.getDate())}/${p2(d.getMonth() + 1)} - ${r ? r.name : a.comp.raid}${g.length > 1 ? " #" + (g.indexOf(a) + 1) : ""}`;
  }
  return out;
}
// prochaine compo à partir d'aujourd'hui (minuit), sinon la dernière
function nextComp(list) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return list.find(x => x.ts >= today.getTime() / 1000) || list[list.length - 1];
}
function assignComp() {
  const list = assignComps();
  if (!list.length) return null;
  let a = list.find(x => x.comp.id === UI.aComp);
  if (!a) { a = nextComp(list); UI.aComp = a.comp.id; }
  return a;
}
function resetAssignView() { UI.aTab = 0; UI.aPhase = 0; aSels = []; aDraft = null; }
function openAssigns(id) { UI.aComp = id; resetAssignView(); UI.page = "assigns"; render(); }
function assignNav(dir) {
  const list = assignComps();
  if (!list.length) return;
  if (!dir) UI.aComp = nextComp(list).comp.id;
  else {
    const i = list.findIndex(x => x.comp.id === UI.aComp);
    UI.aComp = list[Math.max(0, Math.min(list.length - 1, i + dir))].comp.id;
  }
  resetAssignView();
}
// compo d'une autre année : l'année en petit à droite
const compYear = a => { const y = new Date(((a.ev && a.ev.start) || a.ws) * 1000).getFullYear(); return y !== new Date().getFullYear() ? `<small class="ply r">${y}</small>` : ""; };
// Clic sur le titre : liste des compos (même place que les sélecteurs de mois / lockout)
function showAssignCompList() {
  const all = assignComps(), cur = assignComp(), thisWeek = weekStart(now());
  // compos d'avant la semaine actuelle : cachées derrière « Show History », puis en gris
  const list = pickHistory ? all : all.filter(a => a.ws >= thisWeek);
  const hasOld = all.some(a => a.ws < thisWeek);
  const p = $("#picker"), t = $("#subTitle").getBoundingClientRect();
  p.innerHTML = `<div class="plist">${hasOld ? historyRow() : ""}${list.map(a => `<button class="pl al${cur && a.comp.id === cur.comp.id ? " sel" : ""}${a.ws < thisWeek ? " old" : ""}" data-pickcomp="${a.comp.id}"><span>${esc(a.label)}</span>${a.ev ? `<em>${esc(a.ev.title)}</em>` : ""}${compYear(a)}</button>`).join("")
    || `<div class="help">${L("No comp yet: create one in Raid Comps.")}</div>`}</div>`;
  // juste assez large pour la ligne la plus longue
  p.style.width = "max-content";
  p.hidden = false;
  p.style.left = Math.max(4, t.left + t.width / 2 - p.offsetWidth / 2) + "px";
  p.style.top = t.bottom + 4 + "px";
  const sel = p.querySelector(".pl.sel");
  if (sel) p.scrollTop += sel.getBoundingClientRect().top - p.getBoundingClientRect().top - 110;
}
// Sous-barre : « Edit Comp » (récap) ouvre la compo dans Raid Comps
$("#navEditComp").addEventListener("click", () => {
  const a = assignComp();
  if (!a) return;
  UI.page = "comps"; UI.week = a.ws; UI.selected = a.comp.id; addState = null;
  render();
});

// ------------------------------------------------------------------ presets (onglets) et annulation
function presetOf(raid) {
  if (!APRE) APRE = JSON.parse(JSON.stringify(ST.presets || {}));
  const p = APRE[raid] = APRE[raid] || { tabs: [], bosses: [] };
  p.tabs = p.tabs || []; p.bosses = p.bosses || [];
  return p;
}
const saveTimers = {};
function queueSave(raid) {
  clearTimeout(saveTimers[raid]);
  saveTimers[raid] = setTimeout(() => api().save_preset(raid, APRE[raid]), 400);
}
// Annuler (Ctrl+Z) / rétablir (Ctrl+Y) : une nouvelle modification vide la pile « rétablir »
const A_REDO = [];
function aPushUndo(entry) {
  A_UNDO.push(entry);
  if (A_UNDO.length > 200) A_UNDO.shift();
  A_REDO.length = 0;
}
function snapshot(raid) { aPushUndo({ raid, snap: JSON.stringify(presetOf(raid)) }); }
// fn modifie le preset ; état précédent empilé pour Undo ; enregistrement automatique
function editPreset(raid, fn, noRender) {
  snapshot(raid);
  fn(presetOf(raid));
  queueSave(raid);
  if (!noRender) render();
}
function assignUndo(redo) {
  const [from, to] = redo ? [A_REDO, A_UNDO] : [A_UNDO, A_REDO];
  const u = from.pop();
  if (!u) return;
  to.push({ raid: u.raid, snap: JSON.stringify(presetOf(u.raid)) });
  APRE[u.raid] = JSON.parse(u.snap);
  aSels = []; aDraft = null;
  queueSave(u.raid);
  render();
}
function imgUrl(id) {
  if (!id) return null;
  if (IMG[id] !== undefined) return IMG[id];
  IMG[id] = null;
  api().assign_image(id).then(u => { IMG[id] = u; if (UI.page === "assigns" || UI.page === "loots") render(); if (typeof bossEdRefresh === "function") bossEdRefresh(); });
  return null;
}
// Image de carte (ratio 1,6) ou icône de boss (carré, affichée ronde) : resolve(id) ou null
async function pickAssignImage(kind) {
  const res = await api().pick_image(kind === "map" ? ST.mapRatio : 1);
  if (!res) return null;
  return new Promise(resolve => {
    openCrop(res, kind === "map" ? "Assign map" : "Boss icon", kind === "map" ? "The frame has the shape of the map." : "Round icon.", async rect => {
      // fichier nommé « Phase1_MountHyjal_Map1 » / « …_Boss1 » d'après le raid de la compo
      const r = await api().save_assign_image(kind, rect, curComp.raid);
      if (!r.ok) { toast(r.error, true); return false; }
      IMG[r.id] = r.url;
      resolve(r.id);
      return true;
    }, kind !== "map");
    const obs = new MutationObserver(() => { if ($("#cropModal").hidden) { obs.disconnect(); resolve(null); } });
    obs.observe($("#cropModal"), { attributes: true, attributeFilter: ["hidden"] });
  });
}

// ------------------------------------------------------------------ noms : blocs de critères, exclusions, changements à la main
function compMembers(comp) {
  const r = raidByKey(comp.raid), size = r ? r.size : 40, out = [];
  // spé choisie dans la compo d'abord (comp.sp), sinon celle connue du perso
  for (let s = 1; s <= size; s++) if (comp.c[s]) out.push(compUnit(comp, comp.c[s]));
  return out;
}
const plainSpec = s => (s || "").replace(/\d+$/, "");
const normCrit = c => Object.assign(emptyCrit(), c || {});
// anciens éléments : un seul bloc « crit »
const critsOf = it => (it.crits && it.crits.length ? it.crits : [it.crit || emptyCrit()]).map(normCrit);
const hasCrit = c => c.roles.length + c.classes.length + c.specs.length > 0;
function critMatch(c, u) {
  return (!c.classes.length || c.classes.includes(u.class)) && (!c.roles.length || c.roles.includes(u.role))
    && (!c.specs.length || c.specs.includes(u.class + ":" + plainSpec(u.spec)));
}
function critLabel(c) {
  const parts = [...c.specs.map(s => s.split(":")[1]), ...c.classes.map(x => L(CLASS_NAME[x])), ...c.roles.map(r => L(r))];
  return parts.join("/") + (c.multi ? " ×" + c.amount : c.idx > 1 ? " #" + c.idx : "");
}
// Résout tous les noms d'un onglet de boss (toutes ses phases : on peut exclure un nom d'une autre phase) :
// blocs essayés dans l'ordre (le 1er qui trouve quelqu'un gagne), sans les persos retenus par les noms exclus ;
// un nom changé à la main remplace la place correspondante
function resolveTab(tab, members, ovr) {
  const res = {}, busy = new Set(), byId = {};
  const all = tab.phases.flatMap(ph => ph.items || []);
  // sorts : source et cible = noms virtuels « <id>:src » / « <id>:dst »
  for (const it of all.filter(x => x.type === "spell")) {
    for (const sub of ["src", "dst"]) if (it[sub]) all.push({ id: it.id + ":" + sub, type: "name", crits: it[sub].crits, exclude: it[sub].exclude });
  }
  all.forEach(it => { byId[it.id] = it; });
  const get = it => {
    if (res[it.id]) return res[it.id];
    if (busy.has(it.id)) return { units: [], entries: [] };
    busy.add(it.id);
    const excl = new Set();
    for (const xid of it.exclude || []) if (byId[xid] && byId[xid].type === "name") get(byId[xid]).units.forEach(u => excl.add(u.name));
    const crits = critsOf(it);
    let found = [];
    for (const c of crits) {
      if (!hasCrit(c)) continue;
      const list = members.filter(m => !excl.has(m.name) && critMatch(c, m));
      found = c.multi ? list.slice(0, Math.max(1, c.amount)) : (list[c.idx - 1] ? [list[c.idx - 1]] : []);
      if (found.length) break;
    }
    const entries = [];
    for (let k = 0; k < Math.max(1, found.length); k++) {
      const key = k ? `${it.id}#${k}` : it.id;
      if (ovr[key]) entries.push({ key, u: members.find(m => m.name === ovr[key]) || unitFor(ovr[key]), manual: true });
      else if (found[k]) entries.push({ key, u: found[k] });
      else entries.push({ key, text: crits.find(hasCrit) ? critLabel(crits.find(hasCrit)) : "?" });
    }
    return (res[it.id] = { entries, units: entries.filter(e => e.u).map(e => e.u) });
  };
  all.filter(it => it.type === "name").forEach(get);
  return res;
}
// Noms de l'onglet (toutes phases) : « P1 #2 »
function tabNameRefs(tab) {
  const out = [];
  tab.phases.forEach((ph, pi) => {
    let k = 0;
    (ph.items || []).forEach(it => { if (it.type === "name") out.push({ id: it.id, pi, label: `${ph.name} #${++k}` }); });
  });
  return out;
}
function setOverride(comp, key, name) {
  const cur = (ST.assigns[comp.id] || {}).n || {}, n = { ...cur };
  if (name) n[key] = name; else delete n[key];
  ST.assigns[comp.id] = { t: now(), n };
  api().save_assign(comp.id, n);
  render();
}
// Liste de tous les persos, filtrée par la frappe
let npCtx = null;
function openNamePick(el, comp, key) {
  npCtx = { comp, key };
  const np = $("#namePick"), r = el.getBoundingClientRect();
  np.hidden = false;
  $("#namePickQ").value = "";
  $("#namePickQ").placeholder = L("Type to filter");
  fillNamePick();
  np.style.left = Math.min(r.left, innerWidth - np.offsetWidth - 6) + "px";
  np.style.top = Math.min(r.bottom + 3, innerHeight - np.offsetHeight - 6) + "px";
  $("#namePickQ").focus();
}
function fillNamePick() {
  const q = $("#namePickQ").value.trim().toLowerCase(), seen = new Set(), list = [];
  const add = name => { if (!seen.has(name)) { seen.add(name); list.push(unitFor(name)); } };
  compMembers(npCtx.comp).forEach(u => add(u.name));
  Object.keys(ST.roster).filter(n => ST.roster[n] && ST.roster[n].c && !charGone(n)).sort().forEach(add);
  const shown = list.filter(u => !q || u.display.toLowerCase().includes(q)).slice(0, 150);
  $("#namePickList").innerHTML = (q ? "" : `<button class="mute" data-np="">${L("Auto (criteria)")}</button>`)
    + shown.map(u => `<button data-np="${esc(u.name)}" style="color:${CLASS_COLOR[u.class] || "#fff"}">${esc(u.display)}</button>`).join("");
}
$("#namePickQ").addEventListener("input", fillNamePick);
$("#namePickQ").addEventListener("keydown", e => {
  if (e.key === "Enter") { const b = $("#namePickList [data-np]:not([data-np=''])") || $("#namePickList [data-np]"); if (b) b.click(); }
});
$("#namePickList").addEventListener("click", e => {
  const b = e.target.closest("[data-np]");
  if (!b) return;
  $("#namePick").hidden = true;
  setOverride(npCtx.comp, npCtx.key, b.dataset.np);
});
document.addEventListener("pointerdown", e => {
  if (!$("#namePick").hidden && !e.target.closest("#namePick")) $("#namePick").hidden = true;
}, true);

// ------------------------------------------------------------------ rendu
// plein écran de la carte : quatre flèches vers l'extérieur (agrandir) / vers l'intérieur (réduire)
const AFULL_IN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square"><path d="M4 9V4h5M4 4l6 6M20 9V4h-5M20 4l-6 6M4 15v5h5M4 20l6-6M20 15v5h-5M20 20l-6-6"/></svg>';
const AFULL_OUT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square"><path d="M10 5v5H5M10 10L4 4M14 5v5h5M14 10l6-6M10 19v-5H5M10 14l-6 6M14 19v-5h5M14 14l6 6"/></svg>';
function setAssignFull(on) {
  UI.aFull = !!on;
  document.body.classList.toggle("afull", UI.aFull && UI.page === "assigns");
  render();
}
document.addEventListener("click", e => {
  if (e.target.closest && e.target.closest("[data-afull]")) setAssignFull(!UI.aFull);
});
document.addEventListener("keydown", e => { if (e.key === "Escape" && UI.aFull && UI.page === "assigns") setAssignFull(false); });
function renderAssigns() {
  document.body.classList.toggle("afull", !!UI.aFull && UI.page === "assigns" && UI.aTab > 0);
  const a = assignComp(), tabs = $("#aTabs"), body = $("#aBody");
  if (!a) { tabs.innerHTML = ""; body.className = "abody"; body.innerHTML = `<div class="empty-list">${L("No comp yet: create one in Raid Comps.")}</div>`; return; }
  const comp = curComp = a.comp, p = presetOf(comp.raid);
  layoutRaidImage(raidByKey(comp.raid));
  if (UI.aTab > p.tabs.length) UI.aTab = 0;
  let th = `<button class="atab${UI.aTab === 0 ? " on" : ""}" data-atab="0">${L("Recap")}</button>`;
  p.tabs.forEach((t, i) => { th += `<button class="atab${UI.aTab === i + 1 ? " on" : ""}" data-atab="${i + 1}">${esc(t.name)}</button>`; });
  // les onglets de boss ne se créent / suppriment qu'en mode Config
  if (aCfg) th += `<button class="atab plus" data-anewtab="1" data-help="New tab">+</button>`;
  th += '<span class="asp pywebview-drag-region"></span>';
  if (aCfg) th += `<button class="btn small" id="aUndo"${A_UNDO.length ? "" : " disabled"} data-help="Ctrl+Z">${L("Undo")}</button>`
    + `<button class="btn small" id="aRedo"${A_REDO.length ? "" : " disabled"} data-help="Ctrl+Y">${L("Redo")}</button>`;
  // mode Config : officiers seulement (sinon grisé)
  if (!canEdit()) aCfg = false;
  th += `<button class="btn small${aCfg ? " pri" : ""}" id="aCfgBtn"${canEdit() ? "" : " disabled"} data-help="${canEdit() ? "Developer mode: create tabs and place names, shapes, spells and boss icons. Saved automatically." : "Officers only."}">${L(aCfg ? "Done" : "Config")}</button>`;
  tabs.innerHTML = th;
  const tab = curTab = UI.aTab ? p.tabs[UI.aTab - 1] : null;
  body.className = "abody" + (aCfg && tab ? " cfg" : "");
  body.innerHTML = tab ? bossHtml(comp, p, tab) : recapHtml(comp);
  applyMapZoom();
}

// ------------------------------------------------------------------ zoom de la carte (Ctrl + molette, autour du curseur)
// Remis à 1 en changeant d'onglet ou de phase. Les positions des clics restent justes (mesurées sur la carte affichée).
let aZoom = { key: "", z: 1, x: 0, y: 0 };
function applyMapZoom() {
  const m = $("#aMap");
  if (!m) return;
  const key = UI.aTab + ":" + UI.aPhase;
  if (aZoom.key !== key) aZoom = { key, z: 1, x: 0, y: 0 };
  m.style.transformOrigin = "0 0";
  m.style.transform = aZoom.z > 1 ? `translate(${aZoom.x}px, ${aZoom.y}px) scale(${aZoom.z})` : "";
}
document.addEventListener("wheel", e => {
  if (!e.ctrlKey || UI.page !== "assigns") return;
  const m = e.target.closest && e.target.closest("#aMap");
  if (!m) return;
  e.preventDefault();
  const r = m.getBoundingClientRect(), z = aZoom.z;
  const baseL = r.left - aZoom.x, baseT = r.top - aZoom.y, w0 = r.width / z, h0 = r.height / z;
  const lx = (e.clientX - r.left) / z, ly = (e.clientY - r.top) / z;          // point visé, en coordonnées de la carte
  const nz = Math.max(1, Math.min(4, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
  let nx = e.clientX - baseL - nz * lx, ny = e.clientY - baseT - nz * ly;
  // la carte agrandie couvre toujours son cadre
  nx = Math.min(0, Math.max(w0 - nz * w0, nx));
  ny = Math.min(0, Math.max(h0 - nz * h0, ny));
  aZoom = { key: aZoom.key, z: nz, x: nz > 1 ? nx : 0, y: nz > 1 ? ny : 0 };
  applyMapZoom();
}, { passive: false });
// carte zoomée : glisser pour se déplacer (clic gauche hors Config ; clic droit / molette partout).
// Un vrai glisser n'ouvre pas le nom cliqué au départ.
let aPan = null, aPanSwallow = false;
document.addEventListener("mousedown", e => {
  if (UI.page !== "assigns" || aZoom.z <= 1) return;
  const m = e.target.closest && e.target.closest("#aMap");
  if (!m) return;
  const other = e.button === 1 || e.button === 2;
  if (!(other || (!aCfg && e.button === 0))) return;
  const r = m.getBoundingClientRect();
  aPan = { sx: e.clientX, sy: e.clientY, x0: aZoom.x, y0: aZoom.y, w0: r.width / aZoom.z, h0: r.height / aZoom.z, moved: false };
  if (other) { e.preventDefault(); e.stopPropagation(); }
}, true);
document.addEventListener("mousemove", e => {
  if (!aPan) return;
  const dx = e.clientX - aPan.sx, dy = e.clientY - aPan.sy;
  if (!aPan.moved && Math.hypot(dx, dy) < 4) return;
  aPan.moved = true;
  const z = aZoom.z;
  aZoom.x = Math.min(0, Math.max(aPan.w0 - z * aPan.w0, aPan.x0 + dx));
  aZoom.y = Math.min(0, Math.max(aPan.h0 - z * aPan.h0, aPan.y0 + dy));
  applyMapZoom();
});
document.addEventListener("mouseup", () => { if (aPan && aPan.moved) aPanSwallow = true; aPan = null; });
document.addEventListener("click", e => { if (aPanSwallow) { aPanSwallow = false; e.stopPropagation(); e.preventDefault(); } }, true);
document.addEventListener("contextmenu", e => { if (UI.page === "assigns" && aZoom.z > 1 && e.target.closest && e.target.closest("#aMap")) e.preventDefault(); });

// Fond thématique d'Assigns (option « Assign's Thematic Background ») : image entière du raid derrière toute la
// fenêtre, comme le fond général qu'elle remplace ; en proportions réelles (hauteur de la fenêtre, ancrée à gauche)
// ou la zone choisie dans Settings (Placement, cadre bleu). Fondu : la zone choisie, sinon sur sa droite.
function layoutRaidImage(r) {
  const el = $("#aRaidImg"), app = $("#app");
  if (!r || !r.fullUrl || UI.page !== "assigns" || !(ST.appearance || {}).assignNoBg) { el.hidden = true; return; }
  el.hidden = false;
  const W = app.clientWidth, H = app.clientHeight, ar = r.fullAspect || 1.5;
  el.style.backgroundImage = `url('${r.fullUrl}')`;
  let size = "100% 100%", pos = "0 0", w = H * ar;
  if (r.view && r.view.w > 0) {
    // zone choisie dans Placement : elle remplit la fenêtre (image et masque agrandis et décalés de la même façon)
    const bw = W / r.view.w, bh = bw / ar;
    w = W;
    size = `${bw}px ${bh}px`;
    pos = `${-r.view.x * bw}px ${-r.view.y * bh}px`;
  }
  el.style.width = w + "px";
  el.style.backgroundSize = el.style.webkitMaskSize = el.style.maskSize = size;
  el.style.backgroundPosition = el.style.webkitMaskPosition = el.style.maskPosition = pos;
  const mask = r.mask ? `url('${r.mask}')` : w < W - 1 ? "linear-gradient(to right, #000 65%, transparent 100%)" : "none";
  el.style.webkitMaskImage = el.style.maskImage = mask;
}
// Proportions de la fenêtre (le fond thématique la couvre entièrement) : format du cadre bleu de Placement
function assignPageRatio() {
  const p = $("#app");
  if (p.clientWidth && p.clientHeight) return p.clientWidth / p.clientHeight;
  return innerWidth / Math.max(1, innerHeight);
}
window.addEventListener("resize", () => { if (UI.page === "assigns" && curComp) layoutRaidImage(raidByKey(curComp.raid)); });

// Récap : grille « carrée » (même nombre de groupes par ligne : 2 pour 10 et 20, 4 pour 40)
function recapHtml(comp) {
  const r = raidByKey(comp.raid) || { size: 40 };
  const roles = { Tank: 0, Healer: 0, Melee: 0, Ranged: 0 };
  let html = "";
  for (let g = 0; g < r.size / 5; g++) {
    let rows = "";
    for (let k = 1; k <= 5; k++) {
      const name = comp.c[g * 5 + k];
      if (!name) { rows += `<div class="rc empty">${L("Empty")}</div>`; continue; }
      const u = compUnit(comp, name);
      if (roles[u.role] !== undefined) roles[u.role]++;
      // icône de spé à gauche du nom (plus de nom de spé : cadres de groupe plus étroits)
      rows += `<div class="rc" style="--c:${CLASS_COLOR[u.class] || "#9a9ea9"}"><span class="bar"></span><span class="spn" title="${esc(plainSpec(u.spec || ""))}">${specImg(u)}</span><span class="nm">${nameHtml(u.display)}</span>
        <span class="ro">${u.role ? `<img src="${ROLE_ICON[u.role]}" alt="" title="${esc(L(u.role))}">` : ""}</span></div>`;
    }
    html += `<div class="rgrp"><div class="grp-h"><span>${L("Group")} ${g + 1}</span></div>${rows}</div>`;
  }
  const tot = ROLE_ORDER.map(ro => `<span title="${esc(L(ro))}"><img src="${ROLE_ICON[ro]}" alt="">${roles[ro]}</span>`).join("");
  return `<div class="recap"><div class="rtot">${tot}</div><div class="rgrid" style="grid-template-columns:repeat(${r.size >= 40 ? 4 : 2}, minmax(0, 180px))">${html}</div></div>`;
}

function bossHtml(comp, p, tab) {
  if (!tab.phases || !tab.phases.length) tab.phases = [{ id: newId(), name: "P1", items: [] }];
  if (UI.aPhase >= tab.phases.length) UI.aPhase = 0;
  const ph = curPh = tab.phases[UI.aPhase];
  ph.items = ph.items || [];
  let sub = tab.phases.map((x, i) => `<button class="aph${i === UI.aPhase ? " on" : ""}" data-aph="${i}"${aCfg ? ' data-help="Double-click to rename"' : ""}>${esc(x.name)}</button>`).join("");
  if (aCfg) sub += `<button class="aph plus" data-aphadd="1" data-help="Add a phase to this boss">+</button>`;
  // bouton plein écran (en haut à droite de la carte) : seuls restent les onglets de boss, les phases et la carte
  const full = `<button class="afullbtn" data-afull="1" data-help="${UI.aFull ? "Exit full screen (Esc)" : "Full screen map"}">${UI.aFull ? AFULL_OUT : AFULL_IN}</button>`;
  const map = `<div class="amapwrap">${full}<div class="amap${aCfg ? " edit tool-" + aTool : ""}" id="aMap">${mapInner(comp, tab, ph)}</div></div>`;
  return `<div class="amain"><div class="aphases">${sub}</div>${map}</div>${aCfg ? toolsHtml(p, tab, ph) : ""}`;
}

const pctX = x => x / MAP_W * 100 + "%", pctY = y => y / MAP_H * 100 + "%";
const nameIndex = ph => { const m = {}; let k = 0; ph.items.forEach(it => { if (it.type === "name") m[it.id] = ++k; }); return m; };
function itemsHtml(comp, ph) {
  const members = compMembers(comp), ovr = (ST.assigns[comp.id] || {}).n || {};
  const res = curRes = resolveTab(curTab, members, ovr), idx = nameIndex(ph);
  let h = "";
  for (const it of ph.items) {
    if (PATHS.includes(it.type)) continue;
    const sel = aCfg && aSels.includes(it.id) ? " sel" : "", pos = `left:${pctX(it.x)};top:${pctY(it.y)}`;
    const size = it.size || DEF_SIZE[it.type];
    if (it.type === "name") {
      const r = res[it.id], picked = aPreview === it.id ? " picked" : "";
      const lines = r.entries.map(e => {
        const col = e.u ? (CLASS_COLOR[e.u.class] || "#fff") : "#9a9ea9";
        return `<div class="anl${e.manual ? " manual" : ""}${e.u ? "" : " none"}" data-anl="${esc(e.key)}" style="color:${col}"${aCfg ? "" : ` data-help="${e.manual ? "Changed by hand · click to change" : "Click to change"}"`}>${esc(e.u ? e.u.display : e.text)}</div>`;
      }).join("");
      const badge = aCfg ? `<span class="aidx">#${idx[it.id]}</span>` : "";
      h += `<div class="ai aname${sel}${picked}" data-ai="${it.id}" style="${pos};--s:${size}">${badge}${lines}${it.action ? `<div class="ana">${esc(it.action)}</div>` : ""}</div>`;
    } else if (it.type === "text") {
      h += `<div class="ai atext${sel}" data-ai="${it.id}" style="${pos};--s:${size};color:${it.color || "#ffffff"}">${esc(it.text || "Text")}</div>`;
    } else if (it.type === "spell") {
      const side = (sub, cls) => {
        const r = it[sub] && res[it.id + ":" + sub];
        if (!r) return "";
        return `<span class="asn ${cls}" style="--s:${Math.max(11, size * 0.42)}">${r.entries.map(e => `<span class="anl${e.manual ? " manual" : ""}${e.u ? "" : " none"}" data-anl="${esc(e.key)}" style="color:${e.u ? CLASS_COLOR[e.u.class] || "#fff" : "#9a9ea9"}"${aCfg ? "" : ' data-help="Click to change"'}>${esc(e.u ? e.u.display : e.text)}</span>`).join("")}</span>`;
      };
      h += `<div class="ai aspg${sel}" data-ai="${it.id}" style="${pos};--s:${size}">${side("src", "l")}<img class="aicon" src="${spellIcon(it.icon)}" data-help="${esc(it.name || "")}" alt="">${side("dst", "r")}</div>`;
    } else if (it.type === "role") {
      h += `<img class="ai aicon flat${sel}" data-ai="${it.id}" src="${ROLE_ICON[it.role] || ROLE_ICON.Tank}" style="${pos};--s:${size}" data-help="${esc(L(it.role || ""))}" alt="">`;
    } else if (it.type === "mark") {
      h += `<img class="ai aicon flat${sel}" data-ai="${it.id}" src="icons/mark_${it.mark || 8}.png" style="${pos};--s:${size}" data-help="${esc(L(MARKS[(it.mark || 8) - 1]))}" alt="">`;
    } else if (it.type === "boss") {
      const b = (presetOf(comp.raid).bosses || []).find(x => x.id === it.boss) || {}, u = imgUrl(b.img);
      h += `<div class="ai aboss${sel}" data-ai="${it.id}" style="${pos};--s:${size};${u ? `background-image:url('${u}')` : ""}" data-help="${esc(b.name || "")}"></div>`;
    }
  }
  // poignées (un seul élément sélectionné) : points des formes, coin de redimensionnement des icônes
  const it = aCfg && selItem();
  if (it && it.pts && it.type !== "draw") it.pts.forEach((pt, i) => { h += `<span class="ahandle" data-ahandle="${i}" style="left:${pctX(pt[0])};top:${pctY(pt[1])}"></span>`; });
  else if (it && ICONS.includes(it.type)) {
    // le repère 1000 x 625 a le ratio de la carte : une unité vaut autant en x qu'en y
    const s = (it.size || DEF_SIZE[it.type]) / 2;
    h += `<span class="ahandle size" data-ahandle="size" style="left:${pctX(it.x + s)};top:${pctY(it.y + s)}"></span>`;
  }
  return h;
}
function shapeGeom(it) {
  if (it.type === "draw") return ["polyline", `points="${it.pts.map(p => p.join(",")).join(" ")}" stroke-linecap="round" stroke-linejoin="round" fill="none"`];
  const [a, b] = it.pts;
  if (it.type === "line" || it.type === "arrow") return ["line", `x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke-linecap="round"`];
  if (it.type === "circle") return ["circle", `cx="${a[0]}" cy="${a[1]}" r="${Math.hypot(b[0] - a[0], b[1] - a[1])}"`];
  return ["rect", `x="${Math.min(a[0], b[0])}" y="${Math.min(a[1], b[1])}" width="${Math.abs(b[0] - a[0])}" height="${Math.abs(b[1] - a[1])}"`];
}
function shapeSvg(it, draft) {
  const w = it.w || 4, col = it.color || "#ffffff", [tag, geom] = shapeGeom(it);
  const cls = draft ? "ash draft" : `ash${aCfg && aSels.includes(it.id) ? " sel" : ""}`;
  const fill = tag === "circle" || tag === "rect" ? ` fill="${col}" fill-opacity=".12"` : "";
  const marker = it.type === "arrow" ? ` marker-end="url(#ah${col.slice(1)})"` : "";
  let s = `<${tag} class="${cls}"${draft ? "" : ` data-ai="${it.id}"`} stroke="${col}" stroke-width="${w}" ${geom}${fill}${marker}/>`;
  // trait large invisible pour attraper les formes fines à la souris
  if (aCfg && !draft) s += `<${tag} class="ahit" data-ai="${it.id}" stroke="transparent" stroke-width="${w + 14}" ${geom.replace(' fill="none"', "")} fill="none"/>`;
  return s;
}
function svgInner(ph) {
  const cols = new Set(palette());
  ph.items.forEach(it => { if (it.color) cols.add(it.color); });
  const defs = [...cols].map(c => `<marker id="ah${c.slice(1)}" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L10,5 L0,10 z" fill="${c}"/></marker>`).join("");
  let s = `<defs>${defs}</defs>`;
  for (const it of ph.items) if (PATHS.includes(it.type) && it.pts && it.pts.length > 1) s += shapeSvg(it);
  if (aDraft && aDraft.pts.length > 1) s += shapeSvg({ type: aDraft.type, pts: aDraft.pts, w: aTpl.w, color: aTpl.color }, true);
  return s;
}
function mapInner(comp, tab, ph) {
  const img = imgUrl(ph.img || tab.img);
  return `${img ? `<img class="amapimg" src="${img}" alt="">` : ""}<svg viewBox="0 0 ${MAP_W} ${MAP_H}" id="aSvg">${svgInner(ph)}</svg><div id="aItems">${itemsHtml(comp, ph)}</div>`;
}
// Survol d'un nom de la liste « Exclude results of » : surligné ; s'il est sur une autre phase, sa carte est montrée le temps du survol
function previewName(id) {
  if (aPreview === id || !curTab || !$("#aMap")) return;
  aPreview = id;
  const ref = id && tabNameRefs(curTab).find(r => r.id === id);
  $("#aMap").innerHTML = mapInner(curComp, curTab, ref ? curTab.phases[ref.pi] : curPh);
}
function redrawMap() {
  if (!curPh || !$("#aSvg")) return;
  $("#aSvg").innerHTML = svgInner(curPh);
  $("#aItems").innerHTML = itemsHtml(curComp, curPh);
}

// ---------- panneau d'outils (mode Config)
function chip(attr, val, on, label, extra) {
  return `<button class="achip${on ? " on" : ""}" ${attr}="${esc(val)}"${extra || ""}>${label}</button>`;
}
function colorsHtml(cur) {
  return `<div class="acolors">${palette().map(c => `<button class="acol${cur === c ? " on" : ""}" data-acolor="${c}" style="background:${c}"></button>`).join("")}
    <label class="acol add" data-help="Add a color to the palette">+<input type="color" data-acoladd value="${cur || "#ffffff"}"></label></div>`;
}
// Bloc de critères : rôles (icônes), classes, spés, index ou nombre (interrupteur)
function critBlockHtml(c, i, n) {
  const specs = (c.classes.length ? c.classes : CLASS_ORDER).flatMap(k => SPECS[k].map(([s]) => {
    const key = k + ":" + s, icon = ST.specIcons[key];
    return chip("data-afspec", key, c.specs.includes(key), icon ? `<img src="${icon}" alt="">` : esc(s.slice(0, 4)),
      ` data-ci="${i}" style="--c:${CLASS_COLOR[k]}" data-help="${esc(s + " " + L(CLASS_NAME[k]))}"`);
  })).join("");
  return `<div class="acrit">${n > 1 ? `<button class="acritdel" data-acritdel="${i}" data-help="Remove this block">×</button>` : ""}
    <div class="achips">${ROLE_ORDER.map(r => chip("data-afrole", r, c.roles.includes(r), `<img src="${ROLE_ICON[r]}" alt="">`, ` data-ci="${i}" data-help="${esc(L(r))}"`)).join("")}</div>
    <div class="achips">${CLASS_ORDER.map(k => chip("data-afclass", k, c.classes.includes(k), `<img src="icons/class_${k.toLowerCase()}.jpg" alt="">`, ` data-ci="${i}" style="--c:${CLASS_COLOR[k]}" data-help="${esc(L(CLASS_NAME[k]))}"`)).join("")}</div>
    <div class="achips">${specs}</div>
    <div class="acritrow"><label class="${c.multi ? "off" : ""}">${L("Index")}<input type="number" min="1" max="40" data-af="idx" data-ci="${i}" value="${c.idx}"${c.multi ? " disabled" : ""}></label>
      <button class="switch${c.multi ? " on" : ""}" data-afmulti="${i}" data-help="Off: one name (index). On: a list of names (amount)."><i></i></button>
      <label class="${c.multi ? "" : "off"}">${L("Amount")}<input type="number" min="1" max="40" data-af="amount" data-ci="${i}" value="${c.amount}"${c.multi ? "" : " disabled"}></label></div></div>`;
}
function toolsHtml(p, tab, ph) {
  const it = selItem(), multi = aSels.length > 1;
  let h = `<div class="atools">${TOOLS.map(([k, lab, icon]) => `<button class="atool${aTool === k ? " on" : ""}" data-atool="${k}" data-help="${lab}">${icon}</button>`).join("")}</div>`;
  const hint = aTool === "select" ? "Click an element to edit it, drag it or its points to move them. Shift+click: select from any tool. Ctrl+click: select several."
    : SHAPES.includes(aTool) ? "First click: start · second click: end · Esc: cancel."
    : aTool === "draw" ? "Hold the mouse button and draw on the map."
    : aTool === "boss" ? "Click a boss icon, then click on the map." : "Click on the map to place it.";
  h += `<div class="ahint">${L(hint)}</div>`;
  if (multi) {
    return `<div class="apanel">${h}<div class="asec">${L("{0} elements", aSels.length)}</div><button class="btn small danger" data-adel="1">${L("Delete element")}</button>${tabFoot(tab)}</div>`;
  }
  const type = it ? it.type : aTool, target = it || aTpl;
  if (type === "name") {
    const crits = critsOf(target);
    h += crits.map((c, i) => critBlockHtml(c, i, crits.length)).join(`<div class="aelse">${L("else")}</div>`);
    h += `<button class="aelse add" data-aelse="" data-help="Backup criteria, used when the blocks above find nobody">${L("else")} +</button>
      <label class="afield">${L("Action")}<input data-af="action" value="${esc(target.action || "")}" placeholder="${L("Optional note under the name")}"></label>`;
  }
  // sort placé : source (qui le lance) et cible (qui le reçoit), mêmes critères qu'un nom de joueur
  if (it && it.type === "spell") {
    for (const [sub, label, help] of [["src", "Source", "Optional: the player who casts it, found with the same criteria as a player name."],
                                      ["dst", "Target", "Optional: the player who receives it."]]) {
      if (it[sub]) {
        const crits = critsOf(it[sub]);
        h += `<div class="asec" data-help="${help}">${L(label)}<button class="ib" data-asubdel="${sub}" data-help="Remove">×</button></div>`
          + crits.map((c, i) => critBlockHtml(c, sub + ":" + i, crits.length)).join(`<div class="aelse">${L("else")}</div>`)
          + `<button class="aelse add" data-aelse="${sub}">${L("else")} +</button>`;
      } else {
        h += `<button class="btn small" data-asubadd="${sub}" data-help="${help}">${L(sub === "src" ? "Add a source" : "Add a target")}</button>`;
      }
    }
  }
  if (type === "text") h += `<label class="afield">${L("Text")}<input data-af="text" value="${esc(target.text || "")}"></label>`;
  if (!it && aTool === "spell") {
    const q = aSpellQ.toLowerCase();
    h += `<input class="aq" id="aSpellQ" placeholder="${L("Search a spell")}" value="${esc(aSpellQ)}">
      <div class="agrid">${SPELLS.map((s, i) => `<img class="asp-i${aTpl.spell === s ? " on" : ""}" src="${spellIcon(s.i)}" data-aspell="${i}" data-help="${esc(s.n)}" style="--c:${CLASS_COLOR[s.c]}"${q && !s.n.toLowerCase().includes(q) ? " hidden" : ""} alt="">`).join("")}</div>`;
  }
  if (type === "role") h += `<div class="achips big">${ROLE_ORDER.map(r => chip("data-arole", r, (target.role || "Tank") === r, `<img src="${ROLE_ICON[r]}" alt="">`, ` data-help="${esc(L(r))}"`)).join("")}</div>`;
  if (type === "mark") h += `<div class="achips big">${MARKS.map((m, i) => chip("data-amark", i + 1, (target.mark || 8) === i + 1, `<img src="icons/mark_${i + 1}.png" alt="">`, ` data-help="${esc(L(m))}"`)).join("")}</div>`;
  if (!it && aTool === "boss") {
    h += `<div class="abosses">${p.bosses.map(b => {
      const u = imgUrl(b.img);
      return `<button class="abosspick${aTpl.boss === b.id ? " on" : ""}" data-abosspick="${b.id}" data-help="${esc(b.name)}" style="${u ? `background-image:url('${u}')` : ""}"></button>`;
    }).join("")}<button class="abosspick add" data-abossnew="1" data-help="New boss icon">+</button></div>`;
  }
  if (it && it.type === "boss") {
    const b = p.bosses.find(x => x.id === it.boss);
    if (b) h += `<label class="afield">${L("Boss name")}<input data-abossname="${b.id}" value="${esc(b.name)}"></label>`;
  }
  // couleur : formes, dessin, texte (modèle de l'outil ou élément sélectionné)
  if (PATHS.includes(type) || type === "text") h += colorsHtml(target.color || "#ffffff");
  if (it && PATHS.includes(it.type)) h += `<label class="afield row">${L("Thickness")}<input type="range" min="1" max="20" data-anum="w" value="${it.w || 4}"></label>`;
  // épaisseur des prochains traits (dessin, flèches, lignes, formes)
  else if (!it && PATHS.includes(aTool)) h += `<label class="afield row">${L("Thickness")}<input type="range" min="1" max="20" data-atplw="1" value="${aTpl.w}"></label>`;
  if (it && !PATHS.includes(it.type)) {
    const max = it.type === "name" ? 60 : it.type === "text" ? 80 : 200;
    h += `<label class="afield row">${L("Size")}<input type="range" min="8" max="${max}" data-anum="size" value="${it.size || DEF_SIZE[it.type]}"></label>`;
  }
  // Exclude : les persos retenus par ces autres noms ne sont pas candidats pour celui-ci
  if (it && it.type === "name") {
    const refs = tabNameRefs(tab), lab = id => (refs.find(r => r.id === id) || {}).label;
    const fields = (it.exclude || []).filter(lab).map(id => `<button class="axfield" data-axfield="${id}">${esc(lab(id))}</button>`).join("");
    h += `<div class="asub" data-help="The players found by these names are not candidates for this one">${L("Exclude results of :")}</div>
      <div class="axrow">${fields}<button class="axfield empty" data-axfield="new">…</button></div>`;
  }
  if (it) h += `<button class="btn small danger" data-adel="1">${L("Delete element")}</button>`;
  return `<div class="apanel">${h}${tabFoot(tab)}</div>`;
}
function tabFoot(tab) {
  return `<div class="afoot"><button class="btn small" data-amap="1">${L("Change map")}</button>
    ${tab.phases.length > 1 ? `<button class="btn small danger" data-aphdel="1">${L("Delete phase")}</button>` : ""}
    <button class="btn small danger" data-atabdel="1">${L("Delete tab")}</button></div>`;
}

// ------------------------------------------------------------------ interactions
function mapPoint(e) {
  const r = $("#aMap").getBoundingClientRect();
  return [Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * MAP_W), Math.round(Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) * MAP_H)];
}
const itemById = id => curPh && curPh.items.find(x => x.id === id);
const selItem = () => aSels.length === 1 ? itemById(aSels[0]) : null;
// Modifie l'élément sélectionné (ou le modèle de l'outil quand rien n'est sélectionné)
function editTarget(fn) {
  const it = selItem();
  if (it) editPreset(curComp.raid, () => fn(it));
  else { fn(aTpl); render(); }
}
// bloc de critères « [sous-partie:]n° » de la cible (nom, ou source / cible d'un sort) ; convertit l'ancien format
const splitCi = ci => { const t = String(ci), k = t.indexOf(":"); return k < 0 ? ["", +t] : [t.slice(0, k), +t.slice(k + 1)]; };
function critOwner(x, sub) {
  if (!sub) return x;
  if (!x[sub]) x[sub] = { crits: [emptyCrit()] };
  return x[sub];
}
function editCrit(ci, fn) {
  const [sub, i] = splitCi(ci);
  editTarget(x => { const o = critOwner(x, sub); o.crits = critsOf(o); delete o.crit; fn(o.crits[i], o); });
}
function toggleIn(list, v) { const i = list.indexOf(v); if (i < 0) list.push(v); else list.splice(i, 1); }
function setTool(t) { aTool = t; aDraft = null; aSels = []; render(); }

$("#aTabs").addEventListener("click", async e => {
  let el;
  if ((el = e.target.closest("[data-atab]"))) { UI.aTab = +el.dataset.atab; UI.aPhase = 0; aSels = []; aDraft = null; render(); return; }
  if (e.target.closest("#aCfgBtn")) { aCfg = !aCfg; aSels = []; aDraft = null; render(); return; }
  if (e.target.closest("#aUndo")) { assignUndo(); return; }
  if (e.target.closest("#aRedo")) { assignUndo(true); return; }
  if (e.target.closest("[data-anewtab]")) {
    let img = null;
    const v = await ask("New tab", [{ key: "name", label: "Tab name" },
      { key: "img", label: "Map picture", type: "image", pick: async () => { img = await pickAssignImage("map") || img; return img; } }]);
    if (!v || !v.name) { render(); return; }
    editPreset(curComp.raid, p => p.tabs.push({ id: newId(), name: v.name, img, phases: [{ id: newId(), name: "P1", items: [] }] }), true);
    UI.aTab = presetOf(curComp.raid).tabs.length; UI.aPhase = 0; aSels = [];
    render();
  }
});

$("#aBody").addEventListener("click", async e => {
  let el;
  const t = e.target;
  if ((el = t.closest("[data-aph]"))) { UI.aPhase = +el.dataset.aph; aSels = []; aDraft = null; render(); return; }
  if (t.closest("[data-aphadd]")) {
    editPreset(curComp.raid, () => curTab.phases.push({ id: newId(), name: "P" + (curTab.phases.length + 1), items: [] }), true);
    UI.aPhase = curTab.phases.length - 1; render(); return;
  }
  // mode normal : clic sur un nom = choisir un autre perso
  // noms : officiers, ou créateur de l'event d'une compo communautaire (pas le mode Config)
  if (!aCfg && (el = t.closest("[data-anl]"))) { if (canEditComp(curComp)) openNamePick(el, curComp, el.dataset.anl); else denyEdit(); return; }
  if (!aCfg) return;
  if ((el = t.closest("[data-atool]"))) { setTool(el.dataset.atool); return; }
  if ((el = t.closest("[data-afrole]"))) { editCrit(el.dataset.ci, c => toggleIn(c.roles, el.dataset.afrole)); return; }
  if ((el = t.closest("[data-afclass]"))) {
    editCrit(el.dataset.ci, c => {
      toggleIn(c.classes, el.dataset.afclass);
      // spés d'une classe retirée : retirées aussi
      if (c.classes.length) c.specs = c.specs.filter(s => c.classes.includes(s.split(":")[0]));
    });
    return;
  }
  if ((el = t.closest("[data-afspec]"))) { editCrit(el.dataset.ci, c => toggleIn(c.specs, el.dataset.afspec)); return; }
  if ((el = t.closest("[data-afmulti]"))) { editCrit(el.dataset.afmulti, c => { c.multi = !c.multi; }); return; }
  if ((el = t.closest("[data-acritdel]"))) {
    const [sub, i] = splitCi(el.dataset.acritdel);
    editTarget(x => { const o = critOwner(x, sub); o.crits = critsOf(o); delete o.crit; o.crits.splice(i, 1); }); return;
  }
  if ((el = t.closest("[data-aelse]"))) { editTarget(x => { const o = critOwner(x, el.dataset.aelse); o.crits = critsOf(o); delete o.crit; o.crits.push(emptyCrit()); }); return; }
  if ((el = t.closest("[data-asubadd]"))) { editTarget(x => { critOwner(x, el.dataset.asubadd); }); return; }
  if ((el = t.closest("[data-asubdel]"))) { editTarget(x => { delete x[el.dataset.asubdel]; }); return; }
  if ((el = t.closest("[data-arole]"))) { editTarget(x => { x.role = el.dataset.arole; }); return; }
  if ((el = t.closest("[data-amark]"))) { editTarget(x => { x.mark = +el.dataset.amark; }); return; }
  if ((el = t.closest("[data-aspell]"))) { aTpl.spell = SPELLS[+el.dataset.aspell]; render(); return; }
  if ((el = t.closest("[data-abosspick]"))) { aTpl.boss = el.dataset.abosspick; render(); return; }
  if (t.closest("[data-abossnew]")) {
    let img = null;
    const v = await ask("New boss icon", [{ key: "name", label: "Boss name" },
      { key: "img", label: "Boss icon", type: "image", pick: async () => { img = await pickAssignImage("boss") || img; return img; } }]);
    if (!v || !v.name) return;
    const id = newId();
    editPreset(curComp.raid, p => p.bosses.push({ id, name: v.name, img }), true);
    aTpl.boss = id; render(); return;
  }
  if ((el = t.closest("[data-acolor]"))) { editTarget(x => { x.color = el.dataset.acolor; }); return; }
  if ((el = t.closest("[data-axfield]"))) { openExcludeDrop(el); return; }
  if (t.closest("[data-adel]")) { deleteSelected(); return; }
  if (t.closest("[data-amap]")) {
    const id = await pickAssignImage("map");
    if (id) editPreset(curComp.raid, () => { if (UI.aPhase === 0) curTab.img = id; else curPh.img = id; });
    return;
  }
  if (t.closest("[data-aphdel]")) {
    editPreset(curComp.raid, () => curTab.phases.splice(UI.aPhase, 1), true);
    UI.aPhase = Math.max(0, UI.aPhase - 1); aSels = []; render(); return;
  }
  if ((el = t.closest("[data-atabdel]"))) {
    if (!el.classList.contains("armed")) { el.classList.add("armed"); el.textContent = L("Confirm?"); setTimeout(() => { el.classList.remove("armed"); el.textContent = L("Delete tab"); }, 3000); return; }
    editPreset(curComp.raid, p => p.tabs.splice(UI.aTab - 1, 1), true);
    UI.aTab = 0; aSels = []; render();
  }
});
$("#aBody").addEventListener("dblclick", async e => {
  const el = e.target.closest("[data-aph]");
  if (!el || !aCfg) return;
  const ph = curTab.phases[+el.dataset.aph];
  const v = await ask("Rename", [{ key: "name", label: "Phase name", value: ph.name }]);
  if (v && v.name) editPreset(curComp.raid, () => { ph.name = v.name; });
});
$("#aBody").addEventListener("change", e => {
  const t = e.target;
  if (t.dataset.af === "action") editTarget(x => { x.action = t.value.trim(); });
  else if (t.dataset.af === "text") editTarget(x => { x.text = t.value; });
  else if (t.dataset.af === "idx") editCrit(t.dataset.ci, c => { c.idx = Math.max(1, +t.value || 1); });
  else if (t.dataset.af === "amount") editCrit(t.dataset.ci, c => { c.amount = Math.max(1, +t.value || 1); });
  else if (t.dataset.acoladd !== undefined) {
    // nouvelle couleur ajoutée à la palette (gardée entre deux lancements)
    UI.aColors = [...new Set([...(UI.aColors || []), t.value])];
    saveUI();
    editTarget(x => { x.color = t.value; });
  } else if (t.dataset.abossname) editPreset(curComp.raid, p => { const b = p.bosses.find(x => x.id === t.dataset.abossname); if (b) b.name = t.value.trim() || b.name; });
  else if (t.dataset.anum) {
    // le glissement a déjà modifié l'élément : on empile l'état d'avant le glissement
    if (selItem() && t._snap) { aPushUndo({ raid: curComp.raid, snap: t._snap }); t._snap = null; queueSave(curComp.raid); render(); }
  }
});
$("#aBody").addEventListener("input", e => {
  const t = e.target;
  if (t.id === "aSpellQ") {
    aSpellQ = t.value;
    const q = aSpellQ.toLowerCase();
    document.querySelectorAll("[data-aspell]").forEach(img => { img.hidden = !!q && !SPELLS[+img.dataset.aspell].n.toLowerCase().includes(q); });
    return;
  }
  if (t.dataset.atplw) { aTpl.w = +t.value; return; }
  if (t.dataset.anum) {
    const it = selItem();
    if (!it) return;
    if (!t._snap) t._snap = JSON.stringify(presetOf(curComp.raid));
    it[t.dataset.anum] = +t.value;
    redrawMap();
  }
});

// Carte : placement, tracé, dessin libre, sélection (Maj+clic depuis n'importe quel outil, Ctrl+clic = plusieurs),
// déplacement des éléments sélectionnés et de leurs points
function place(item) {
  item.id = newId();
  editPreset(curComp.raid, () => curPh.items.push(item), true);
  // un nom ou un texte se règle juste après : il est sélectionné (outil Sélection)
  if (item.type === "name" || item.type === "text") { aSels = [item.id]; aTool = "select"; }
  render();
}
$("#aBody").addEventListener("pointerdown", e => {
  if (!aCfg || e.button !== 0 || !e.target.closest("#aMap")) return;
  e.preventDefault();
  const p = mapPoint(e), raid = curComp.raid, hitEl = e.target.closest("[data-ai]");
  if (hitEl && (e.ctrlKey || e.shiftKey)) {
    if (e.ctrlKey) toggleIn(aSels, hitEl.dataset.ai); else aSels = [hitEl.dataset.ai];
    aTool = "select"; aDraft = null;
    render(); return;
  }
  if (SHAPES.includes(aTool)) {
    if (!aDraft) { aDraft = { type: aTool, pts: [p, p] }; redrawMap(); return; }
    const a = aDraft.pts[0];
    aDraft = null;
    if (Math.hypot(p[0] - a[0], p[1] - a[1]) < 3) { redrawMap(); return; }
    place({ type: aTool, pts: [a, p], w: aTpl.w, color: aTpl.color });
    return;
  }
  if (aTool === "draw") {
    aDraft = { type: "draw", pts: [p] };
    const move = ev => {
      const q = mapPoint(ev), last = aDraft.pts[aDraft.pts.length - 1];
      if (Math.hypot(q[0] - last[0], q[1] - last[1]) >= 3) { aDraft.pts.push(q); $("#aSvg").innerHTML = svgInner(curPh); }
    };
    const up = () => {
      document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up);
      const pts = aDraft.pts;
      aDraft = null;
      if (pts.length > 1) place({ type: "draw", pts, w: aTpl.w, color: aTpl.color }); else redrawMap();
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    return;
  }
  if (aTool === "name") return place({ type: "name", x: p[0], y: p[1], size: DEF_SIZE.name, crits: JSON.parse(JSON.stringify(critsOf(aTpl))), action: aTpl.action });
  if (aTool === "text") return place({ type: "text", x: p[0], y: p[1], size: DEF_SIZE.text, text: aTpl.text || L("Text"), color: aTpl.color });
  if (aTool === "role") return place({ type: "role", x: p[0], y: p[1], size: DEF_SIZE.role, role: aTpl.role });
  if (aTool === "mark") return place({ type: "mark", x: p[0], y: p[1], size: DEF_SIZE.mark, mark: aTpl.mark });
  if (aTool === "spell") {
    if (!aTpl.spell) { toast(L("Search a spell"), true); return; }
    return place({ type: "spell", x: p[0], y: p[1], size: DEF_SIZE.spell, icon: aTpl.spell.i, name: aTpl.spell.n });
  }
  if (aTool === "boss") {
    if (!aTpl.boss) { toast(L("Click a boss icon, then click on the map."), true); return; }
    return place({ type: "boss", x: p[0], y: p[1], size: DEF_SIZE.boss, boss: aTpl.boss });
  }
  // outil Sélection : un élément déjà sélectionné déplace toute la sélection
  const handle = e.target.closest("[data-ahandle]");
  if (!handle) {
    const id = hitEl ? hitEl.dataset.ai : null;
    if (!id) { aSels = []; render(); return; }
    if (!aSels.includes(id)) { aSels = [id]; render(); }
  }
  const items = aSels.map(itemById).filter(Boolean);
  if (!items.length) return;
  const orig = items.map(x => JSON.parse(JSON.stringify(x))), snap = JSON.stringify(presetOf(raid));
  let moved = false;
  const move = ev => {
    const q = mapPoint(ev), dx = q[0] - p[0], dy = q[1] - p[1];
    if (!moved && Math.hypot(dx, dy) < 2) return;
    moved = true;
    const it = items[0];
    if (handle && handle.dataset.ahandle === "size") it.size = Math.max(8, Math.round((orig[0].size || DEF_SIZE[it.type]) + Math.max(dx, dy) * 2));
    else if (handle) it.pts[+handle.dataset.ahandle] = q;
    else items.forEach((x, i) => {
      if (x.pts) x.pts = orig[i].pts.map(pt => [pt[0] + dx, pt[1] + dy]);
      else { x.x = orig[i].x + dx; x.y = orig[i].y + dy; }
    });
    redrawMap();
  };
  const up = () => {
    document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up);
    if (moved) { aPushUndo({ raid, snap }); queueSave(raid); render(); }
  };
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", up);
});
// la forme en cours suit la souris
$("#aBody").addEventListener("pointermove", e => {
  if (!aDraft || aDraft.type === "draw" || !e.target.closest("#aMap")) return;
  aDraft.pts[1] = mapPoint(e);
  $("#aSvg").innerHTML = svgInner(curPh);
});
function deleteSelected() {
  if (!aSels.length) return;
  const ids = new Set(aSels);
  editPreset(curComp.raid, () => { curPh.items = curPh.items.filter(x => !ids.has(x.id)); }, true);
  aSels = []; render();
}
document.addEventListener("keydown", e => {
  if (UI.page !== "assigns" || !aCfg || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  if (e.key === "Delete") deleteSelected();
  else if (e.key.toLowerCase() === "z" && e.ctrlKey && $("#settingsWin").hidden) { e.preventDefault(); assignUndo(); }
  else if (e.key.toLowerCase() === "y" && e.ctrlKey && $("#settingsWin").hidden) { e.preventDefault(); assignUndo(true); }
});
// Échap : abandonne l'exclusion ou la forme en cours, sinon désélectionne
function assignEscape() {
  if (!$("#axDrop").hidden) { closeExcludeDrop(); return true; }
  if (aDraft) { aDraft = null; redrawMap(); return true; }
  if (aCfg && aSels.length) { aSels = []; render(); return true; }
  return false;
}
function assignTip() { return false; }

// « Exclude results of » : liste déroulante des noms de l'onglet (toutes phases) ; survol = surlignage sur la carte
function openExcludeDrop(field) {
  const it = selItem();
  if (!it) return;
  const cur = field.dataset.axfield, taken = new Set(it.exclude || []);
  const refs = tabNameRefs(curTab).filter(r => r.id !== it.id && (r.id === cur || !taken.has(r.id)));
  const d = $("#axDrop");
  d.innerHTML = (cur !== "new" ? `<button class="mute" data-axopt="">${L("Remove")}</button>` : "")
    + refs.map(r => `<button data-axopt="${r.id}"${r.id === cur ? ' class="on"' : ""}>${esc(r.label)}</button>`).join("")
    || `<div class="help">${L("No other name on this tab.")}</div>`;
  d._ctx = { id: it.id, cur };
  d.hidden = false;
  const r = field.getBoundingClientRect();
  d.style.left = Math.min(r.left, innerWidth - d.offsetWidth - 6) + "px";
  d.style.top = Math.min(r.bottom + 2, innerHeight - d.offsetHeight - 6) + "px";
}
function closeExcludeDrop() {
  $("#axDrop").hidden = true;
  previewName(null);
}
$("#axDrop").addEventListener("mouseover", e => { const b = e.target.closest("[data-axopt]"); previewName(b && b.dataset.axopt || null); });
$("#axDrop").addEventListener("mouseleave", () => previewName(null));
$("#axDrop").addEventListener("click", e => {
  const b = e.target.closest("[data-axopt]");
  if (!b) return;
  const { id, cur } = $("#axDrop")._ctx, pick = b.dataset.axopt;
  $("#axDrop").hidden = true;
  aPreview = null;
  const it = itemById(id);
  if (!it) { render(); return; }
  editPreset(curComp.raid, () => {
    const list = (it.exclude || []).slice();
    const i = list.indexOf(cur);
    if (i >= 0) { if (pick) list[i] = pick; else list.splice(i, 1); }
    else if (pick) list.push(pick);
    it.exclude = list;
  });
});
document.addEventListener("pointerdown", e => {
  if (!$("#axDrop").hidden && !e.target.closest("#axDrop") && !e.target.closest("[data-axfield]")) closeExcludeDrop();
}, true);

// Maj / Ctrl enfoncé : les éléments de la carte deviennent cliquables quel que soit l'outil (sélection rapide)
const setMod = e => document.body.classList.toggle("amod", !!(e.shiftKey || e.ctrlKey));
document.addEventListener("keydown", setMod);
document.addEventListener("keyup", setMod);
window.addEventListener("blur", () => document.body.classList.remove("amod"));
document.addEventListener("click", e => {
  const b = e.target.closest("[data-pickcomp]");
  if (!b) return;
  UI.aComp = b.dataset.pickcomp; resetAssignView();
  $("#picker").hidden = true;
  render();
});
