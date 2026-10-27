"use strict";
// Guild Tool : interface (même logique que Core.lua / UI_*.lua de l'addon)

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const api = () => window.pywebview.api;
const now = () => Math.floor(Date.now() / 1000);
const ic = n => `icons/${n}.jpg`;
const STATUS_TEXT = { primary: "Signed", tentative: "Tentative", late: "Late", bench: "Bench" };
const SORT_LABEL = { spec: "Spec", class: "Class", player: "Player", alpha: "A-Z", level: "Level", raids: "Raids", loots: "Loots", discord: "Discord", attendance: "Attendance", drole: "Role" };
const ASSIGN_SVG = '<svg viewBox="0 0 24 24"><path d="M5 2h10l4 4v6.5l-2 2V7h-3V4H5v16h6l-.4 2H3V2zm2 6h8v1.6H7zm0 3.5h8v1.6H7zm0 3.5h5v1.6H7zm13.3-2.6 1.8 1.8-6.9 6.9-2.5.7.7-2.5z"/></svg>';
const LOCK_SVG = '<svg viewBox="0 0 24 24"><path d="M17 9V7a5 5 0 0 0-10 0v2H5v13h14V9h-2zm-8 0V7a3 3 0 0 1 6 0v2H9z"/></svg>';
const POST_SVG = '<svg viewBox="0 0 24 24"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>';
const RESET_SVG = '<svg viewBox="0 0 24 24"><path d="M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.75 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4z"/></svg>';
const WARN_SVG = '<svg viewBox="0 0 24 24"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>';
const CHECK_SVG = '<svg viewBox="0 0 24 24"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>';
const WEEK = 7 * 86400, DAY = 86400;
const FALLBACK_ANCHOR = new Date(2026, 0, 7, 5, 0, 0).getTime() / 1000;
const MON_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MON_FR = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const MON = new Proxy([], { get: (_, k) => (LANG === "fr" ? MON_FR : MON_EN)[k] });

let ST = null;          // état renvoyé par Python
// droits : hors ligne ou officier = modifications permises ; membre connecté sans droits = lecture seule
const canEdit = () => !ST || ST.canEdit !== false;
const denyEdit = () => toast(L("Only the officers can change the comps, assigns and raids of the guild."), true);
let absMode = false, absSel = new Set();   // calendrier : mode sélection des absences
const absences = () => new Set((ST && ST.absences) || []);
let U = null;           // unités de la semaine affichée
let flash = null;
let addState = null;    // tuile « + » : { raid } une fois le raid choisi
let expanded = null;    // Members : perso dont le volet est ouvert
const UI = loadUI();

function loadUI() {
  const d = { page: "comps", phase: PHASES.length - 1, tab: "signed", order: null, membersOrder: ["spec", "discord", "alpha", "level", "attendance"], week: null, selected: null, month: null,
              aComp: null, aTab: 0, aPhase: 0, setWin: null };
  let ui = d;
  try { ui = Object.assign(d, JSON.parse(localStorage.getItem("rp-ui2") || "{}")); } catch (e) { /* stockage indisponible */ }
  // nouveaux critères de tri ajoutés en fin de liste
  if (!ui.membersOrder.includes("level")) ui.membersOrder.push("level");
  if (!ui.membersOrder.includes("discord")) ui.membersOrder.push("discord");
  // Members : « Player » = « Discord », « Class » compris dans « Spec » (classe puis spé) ; « Attendance » ajouté
  ui.membersOrder = ui.membersOrder.filter(k => k !== "player" && k !== "class");
  if (!ui.membersOrder.includes("spec")) ui.membersOrder.unshift("spec");
  if (!ui.membersOrder.includes("attendance")) ui.membersOrder.push("attendance");
  if (!ui.membersOrder.includes("drole")) ui.membersOrder.push("drole");
  return ui;
}
function saveUI() { try { localStorage.setItem("rp-ui2", JSON.stringify(UI)); } catch (e) { /* stockage indisponible */ } }

// ------------------------------------------------------------------ semaines de lockout
const anchor = () => ST.resetAnchor || FALLBACK_ANCHOR;
const weekOf = ts => Math.floor((ts - anchor()) / WEEK);
const weekStart = ts => anchor() + weekOf(ts) * WEEK;
const dm = ts => { const d = new Date(ts * 1000); return `${d.getDate()} ${MON[d.getMonth()]}`; };
// un lockout finit la veille du suivant (mercredi -> mardi)
const weekLabel = ws => `${dm(ws)} - ${dm(ws + WEEK - DAY)}`;
// même libellé découpé autour du tiret (pour aligner les tirets du titre et de la liste des lockouts)
const weekLabelHtml = ws => `<span class="wl">${dm(ws)}</span><span class="wd">-</span><span class="wr">${dm(ws + WEEK - DAY)}</span>`;
const currentWeek = () => UI.week ? weekStart(UI.week + 3 * DAY) : weekStart(now());
const phase = () => PHASES[UI.phase] || PHASES[PHASES.length - 1];
const raidByKey = k => { for (const p of PHASES) for (const r of p.raids) if (r.key === k) return r; return null; };

const sortedEvents = () => [...ST.events].filter(e => e.start).sort((a, b) => a.start - b.start);
const eventsInWeek = ws => sortedEvents().filter(e => e.start >= ws && e.start < ws + WEEK);
const eventById = id => ST.events.find(e => e.id === id);
const eventLabel = ev => {
  if (!ev) return L("No event");
  if (!ev.start) return ev.title;
  return new Date(ev.start * 1000).toLocaleString(LOC(), { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) + "  ·  " + ev.title;
};
const eventTitle = id => { const ev = id && eventById(id); return ev ? ev.title : L("No event"); };
const newId = () => Date.now().toString(16) + Math.floor(Math.random() * 0xffff).toString(16);
const newComp = (raid, event) => ({ id: newId(), raid, event: event || null, valid: false, c: {} });

// Semaine (vide au départ : les compos s'ajoutent avec la tuile « + »)
function getWeek(ws) {
  ws = ws || currentWeek();
  const key = String(ws);
  if (!ST.weeks[key]) ST.weeks[key] = { t: 0, comps: [] };
  return ST.weeks[key];
}
// Compos des events communautaires (ST.ccomps, docs « ccomp_<id> ») : à part des compos Main Raid des officiers,
// modifiables par le créateur de l'event et les officiers, visibles de tous une fois l'œil coché
const myId = () => (ST.cloud && ST.cloud.logged && ST.cloud.user && ST.cloud.user.id) || null;
const mainChan = () => (ST.rhSettings || {}).rhMainChannel || "1481727247223226449";
// event communautaire = event du salon raid-commu (réglage Admin) ; tous les autres sont des events Main
const commuChan = () => (ST.rhSettings || {}).rhCommuChannel || "1558492094581051514";
// salons d'archive (events des lockouts passés, déplacés par le serveur) : même type que leur salon d'origine
const mainArchive = () => (ST.rhSettings || {}).rhMainArchive || "1559968092774342706";
const commuArchive = () => (ST.rhSettings || {}).rhCommuArchive || "1559968122457563166";
const isCommuEvent = ev => !!(ev && ev.chId && (ev.chId === commuChan() || ev.chId === commuArchive()));
const isMainEvent = ev => !!(ev && ev.chId && (ev.chId === mainChan() || ev.chId === mainArchive()));
const ccompList = () => Object.values(ST.ccomps || {}).filter(c => c && c.id && !c.deleted);
const weekOfComp = c => { const ev = eventById(c.event); return ev ? weekStart(ev.start) : null; };
// compos d'une semaine : celles des officiers, puis les communautaires de ses events
function weekComps(ws) {
  ws = ws || currentWeek();
  const w = ST.weeks[String(ws)];
  return ((w && w.comps) || []).concat(ccompList().filter(c => weekOfComp(c) === ws));
}
const canEditComp = comp => !!comp && (comp.commu ? (isOfficerUser() || (!!myId() && comp.owner === myId())) : canEdit());
const canSeeComp = comp => comp.valid || canEditComp(comp);
// events communautaires de la semaine pour lesquels je peux faire une compo (les miens ; officier : tous)
const myCommuEvents = ws => eventsInWeek(ws || currentWeek()).filter(ev => isCommuEvent(ev) && (isOfficerUser() || (myId() && ev.lid === myId())));
const canAddComp = () => canEdit() || myCommuEvents().length > 0;
// signature d'une compo : seules celles qui ont changé sont enregistrées
const compSig = c => JSON.stringify([c.raid, c.event, !!c.valid, c.c, c.sp || {}, c.ph || {}, !!c.deleted]);
let weekSig = {}, ccSig = {};
function commit() {
  const ws = currentWeek(), w = getWeek();
  const sig = JSON.stringify(w.comps.map(compSig));
  if (canEdit() && weekSig[ws] !== sig) {
    weekSig[ws] = sig;
    w.t = now();
    api().save_week(String(ws), w).then(res => { if (!res.ok) toast(res.error, true); });
  }
  for (const c of Object.values(ST.ccomps || {})) {
    const s = compSig(c);
    if (ccSig[c.id] === s || !canEditComp(c)) continue;
    ccSig[c.id] = s;
    api().save_ccomp(c).then(res => { if (!res.ok) toast(res.error, true); });
  }
}
// état rechargé : signatures de référence
function resetSigs() {
  weekSig = {}; ccSig = {};
  for (const [k, w] of Object.entries(ST.weeks || {})) weekSig[k] = JSON.stringify((w.comps || []).map(compSig));
  for (const c of Object.values(ST.ccomps || {})) ccSig[c.id] = compSig(c);
}
const compById = id => weekComps().find(c => c.id === id);
const selected = () => UI.selected && compById(UI.selected);
const compIndex = comp => weekComps().indexOf(comp) + 1;
const compLabel = comp => `${(raidByKey(comp.raid) || {}).short || comp.raid} #${compIndex(comp)}`;
// compos visibles de tous liées à un event (event vert dans le calendrier)
const visibleCompsFor = ev => weekComps(weekStart(ev.start)).filter(c => c.event === ev.id && c.valid);
const eventDone = ev => visibleCompsFor(ev).length > 0;
// Ma place dans les compos visibles d'un event : { cls, spec } si un de mes persos y est, false sinon (banc), null sans compo
function myCompSpot(ev) {
  const spots = myCompSpots(ev);
  return spots ? spots[0] || false : null;
}
// toutes mes places dans les compos visibles d'un event (ordre des compos), [] : banc, null sans compo
function myCompSpots(ev) {
  const comps = visibleCompsFor(ev), me = myId();
  if (!comps.length || !me) return null;
  const mine = new Set((ST.myChars || []).map(c => c.name)), out = [];
  for (const comp of comps) for (const name of Object.values(comp.c || {})) {
    let su = null, ok = mine.has(name);
    if (name.startsWith("~")) {
      const m = name.match(/^~(.*)#([A-Z]*)$/);
      su = m && ev.signups.find(s => s.uid === me && s.n === m[1] && (s.c || "") === m[2]);
      ok = ok || !!su;
    } else {
      su = ev.signups.find(s => s.ch === name && s.uid === me);
      ok = ok || !!su;
    }
    if (!ok) continue;
    const r = ST.roster[name] || {};
    const cls = r.c || (su && su.c) || (name.match(/#([A-Z]+)$/) || [])[1];
    const spec = (comp.sp || {})[name] || (su && su.s) || charSpec(name);
    out.push({ name, display: name.startsWith("~") ? name.replace(/^~/, "").replace(/#.*$/, "") : name, cls, spec });
  }
  return out;
}

// ------------------------------------------------------------------ unités de la semaine
function buildUnits() {
  const roster = ST.roster, sel = selected(), signed = [], rest = [], byName = {};
  const events = new Set();
  if (sel) { if (sel.event) events.add(sel.event); } else weekComps().forEach(c => c.event && events.add(c.event));
  // inscrits pas présents (absence, incertain) : dans Rest avec leur icône ; par perso, et par compte Discord (une
  // absence n'est pas toujours liée à un perso)
  const away = {}, awayTag = {}, awayUnl = [];
  const worse = (a, b) => (a === "absence" || b === "absence") ? "absence" : a || b;
  for (const ev of eventsInWeek(currentWeek())) {
    if (!events.has(ev.id)) continue;
    for (const s of ev.signups) {
      // perso supprimé de Members : son inscription reste, mais sans lien vers lui
      const ch = s.ch && roster[s.ch] && !charGone(s.ch) ? s.ch : null;
      // inscription non liée : clé unique par classe (un joueur peut inscrire 2 persos sous le même nom)
      const name = ch || "~" + s.n + "#" + (s.c || "");
      if (s.st === "absence" || s.st === "tentative") {
        if (ch) away[ch] = worse(away[ch], s.st);
        if (s.tag) awayTag[s.tag] = worse(awayTag[s.tag], s.st);
        if (!ch && s.st === "tentative" && s.c) awayUnl.push({ s, name });
        continue;
      }
      let u = byName[name];
      if (!u) {
        u = { name, display: ch || s.n, class: s.c, spec: s.s, role: s.r, tag: s.tag || (ch && roster[ch].tag) || null,
              uid: s.uid, status: s.st, signed: true, unlinked: !ch, rhName: s.n, events: new Set(), pres: s.st === "late" ? "late" : null };
        signed.push(u); byName[name] = u;
      }
      if (s.st === "late") u.pres = "late";
      u.events.add(ev.id);
    }
  }
  // incertains sans perso lié : un perso au nom Discord du joueur dans Rest
  for (const { s, name } of awayUnl) {
    if (byName[name]) continue;
    const u = { name, display: s.n, class: s.c, spec: s.s || null, role: s.r || roleOf(s.c, s.s), tag: s.tag || null, uid: s.uid,
                unlinked: true, rhName: s.n, pres: "tentative" };
    rest.push(u); byName[name] = u;
  }
  // « Rest » : spé par défaut = celle de l'inscription à l'Event Class (réglage Admin), sinon spé choisie / relevée
  const cls = classEventEntries();
  for (const [name, r] of Object.entries(roster)) {
    // perso inscrit à l'Event Class : montré même sous le niveau minimum
    if (byName[name] || !r || !r.c || charGone(name) || ((r.l || 0) < ST.minLevel && !cls.byChar[name])) continue;
    const spec = charSpec(name);
    const u = { name, display: name, class: r.c, spec, role: roleOf(r.c, spec), tag: r.tag || null,
                pres: away[name] || (r.tag && awayTag[r.tag]) || null };
    rest.push(u); byName[name] = u;
  }
  // inscriptions à l'Event Class sans perso connu (joueur absent de la base, ou classe sans perso du roster) :
  // un perso au nom Discord du joueur, avec la classe / spé de chaque inscription
  for (const s of cls.unlinked) {
    const name = "~" + s.n + "#" + (s.c || "");
    if (byName[name] || charGone(name)) continue;
    const u = { name, display: s.n, class: s.c, spec: s.s || null, role: s.r || roleOf(s.c, s.s), tag: s.tag || null, uid: s.uid,
                unlinked: true, classEvent: true, rhName: s.n };
    rest.push(u); byName[name] = u;
  }
  return { signed, rest, byName };
}
// Inscriptions de l'Event Class : spé par perso lié, et inscriptions sans perso du roster
//   (un joueur qui a déjà un perso de cette classe, même sous le niveau mini, n'a pas de perso « Nom Discord Classe »)
let ceST = null, ceMemo = null;
function classEventEntries() {
  if (ceST === ST && ceMemo) return ceMemo;
  const ev = eventById((ST.rhSettings || {}).rhClassEvent), byChar = {}, unlinked = [];
  const owners = ST.charOwners || {};
  const ownChar = s => {
    // perso du roster du même joueur (tag) et de la même classe, sinon perso partagé par son compte Discord
    for (const [n, r] of Object.entries(ST.roster || {})) if (r && s.tag && r.tag === s.tag && r.c === s.c) return n;
    for (const [n, o] of Object.entries(owners)) if (o && s.uid && o.id === s.uid && o.c === s.c) return n;
    return null;
  };
  for (const s of (ev && ev.signups) || []) {
    if (!s.c || s.st === "absence" || !CLASS_NAME[s.c]) continue;
    const ch = s.ch && (ST.roster[s.ch] || owners[s.ch]) ? s.ch : ownChar(s);
    // perso supprimé de Members : pas de perso « Nom Discord Classe » à sa place
    if (ch && charGone(ch)) continue;
    if (ch) { if (!byChar[ch]) byChar[ch] = s; }
    else unlinked.push(s);
  }
  ceST = ST;
  return (ceMemo = { byChar, unlinked });
}
// inscription Raid-Helper d'un perso sans lien (« ~nom#CLASSE ») dans n'importe quel event (spé, rôle, tag)
let suST = null, suMemo = {};
function signupFor(name) {
  if (suST !== ST) {
    suST = ST; suMemo = {};
    for (const ev of sortedEvents()) for (const s of ev.signups) if (s.c) suMemo["~" + s.n + "#" + s.c] = s;
  }
  return suMemo[name];
}
// Spé principale d'un perso : choisie à la main, sinon Event Class / arbre de talents le plus rempli (exe), sinon relevée
function charSpec(name) {
  return ST.specs[name] || (ST.mainSpecs || {})[name] || (classEventEntries().byChar[name] || {}).s || ST.svSpecs[name] || ST.derivedSpecs[name] || null;
}
function unitFor(name) {
  const u = U.byName[name];
  if (u) return u;
  const r = ST.roster[name], m = name.match(/#([A-Z]+)$/), o = (ST.charOwners || {})[name], su = name.startsWith("~") ? signupFor(name) : null;
  const cls = (r && r.c) || (o && o.c) || (m && m[1]);
  const spec = ST.specs[name] || (ST.mainSpecs || {})[name] || (classEventEntries().byChar[name] || {}).s || (su && su.s) || ST.svSpecs[name] || ST.derivedSpecs[name] || null;
  return { name, display: name.replace(/^~/, "").replace(/#.*$/, ""), class: cls, spec, role: roleOf(cls, spec) || (su && su.r) || null,
           tag: (r && r.tag) || (su && su.tag), uid: su && su.uid, missing: !r && !o && !su };
}
// perso dans une compo : avec la spé choisie pour cette compo (comp.sp)
function compUnit(comp, name) {
  const base = unitFor(name), osp = comp && comp.sp && comp.sp[name];
  return osp ? Object.assign({}, base, { spec: osp, role: roleOf(base.class, osp) }) : base;
}

// ------------------------------------------------------------------ placements
const findInComp = (comp, name) => { for (const [s, n] of Object.entries(comp.c)) if (n === name) return +s; return null; };
const rerollIn = (comp, tag, except) => { if (!tag) return null; for (const n of Object.values(comp.c)) if (n !== except && unitFor(n).tag === tag) return n; return null; };
const isPlaced = name => weekComps().some(c => findInComp(c, name));
function lockoutOf(name, raidKey, except) {
  if (!name || name.startsWith("~")) return null;
  for (const comp of weekComps()) {
    if (comp === except || comp.raid !== raidKey) continue;
    const slot = findInComp(comp, name);
    if (slot) return { comp, slot };
  }
  return null;
}
// « already in » : un autre perso du joueur est dans une compo du même raid et du même event
function alreadyIn(u) {
  if (!u.tag) return null;
  const sel = selected();
  for (const comp of weekComps()) {
    const match = sel ? comp.raid === sel.raid && comp.event === sel.event : (u.events && comp.event && u.events.has(comp.event));
    if (!match) continue;
    const n = rerollIn(comp, u.tag, u.name);
    if (n) return { comp, name: n };
  }
  return null;
}
// Clic : compo sélectionnée, sinon première compo d'un event où le joueur est inscrit
function autoPlace(u) {
  const sel = selected();
  for (const comp of (sel ? [sel] : weekComps()).filter(canEditComp)) {
    let ok = !findInComp(comp, u.name) && !rerollIn(comp, u.tag, u.name);
    if (ok && !sel) {
      if (u.signed) ok = comp.event && u.events.has(comp.event);
      ok = ok && !lockoutOf(u.name, comp.raid, comp);
    }
    if (!ok) continue;
    const size = (raidByKey(comp.raid) || { size: 40 }).size;
    // les cases réservées (placeholders) restent libres pour un placement à la main
    for (let s = 1; s <= size; s++) {
      if (!comp.c[s] && !(comp.ph && comp.ph[s])) { comp.c[s] = u.name; flash = comp.id + ":" + s; commit(); return true; }
    }
  }
  return false;
}
// spé choisie pour un perso dans une compo (comp.sp) : suit le perso d'une compo à l'autre
function moveSpec(name, a, b) {
  if (!name || a === b || !a.sp || !a.sp[name]) return;
  (b.sp = b.sp || {})[name] = a.sp[name];
  delete a.sp[name];
}
// Présence d'un joueur à un event : absent / incertain / en retard (inscription du perso, ou de son compte Discord)
const PRES_SVG = {
  late: '<path d="M8 4.6V8l2.4 1.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  tentative: '<path d="M6.2 6.3a1.9 1.9 0 1 1 2.6 1.8c-.6.3-.8.6-.8 1.3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="11.6" r="1" fill="currentColor"/>',
  absence: '<path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
};
const PRES_LABEL = { late: "Late", tentative: "Tentative", absence: "Absence" };
const presIcon = k => `<svg class="pres ${k}" viewBox="0 0 16 16" data-help="${esc(L(PRES_LABEL[k]))}"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.8"/>${PRES_SVG[k]}</svg>`;
function presOf(evId, name, tag) {
  const ev = eventById(evId);
  if (!ev) return null;
  let st = null;
  for (const s of ev.signups || []) {
    if (!PRES_SVG[s.st]) continue;
    if (s.ch === name || (tag && s.tag === tag) || "~" + s.n + "#" + (s.c || "") === name) {
      st = st === "absence" || s.st === "absence" ? "absence" : st === "tentative" || s.st === "tentative" ? "tentative" : "late";
    }
  }
  return st;
}
function dropOnSlot(name, from, comp, slot) {
  if (!canEditComp(comp) || (from && !canEditComp(from.comp))) { denyEdit(); return; }
  const displaced = comp.c[slot];
  if (from) delete from.comp.c[from.slot];
  comp.c[slot] = name;
  if (comp.ph) delete comp.ph[slot];      // un perso posé sur une case réservée la remplace
  if (from) moveSpec(name, from.comp, comp);
  if (displaced && displaced !== name && from) { from.comp.c[from.slot] = displaced; moveSpec(displaced, comp, from.comp); }
  else if (displaced && displaced !== name) {
    // venu de la liste : l'occupant n'est pas écrasé, il passe dans la 1re case libre de la compo (sinon il en sort)
    const size = (raidByKey(comp.raid) || {}).size || 40;
    for (let k = 1; k <= size; k++) if (!comp.c[k] && !(comp.ph || {})[k]) { comp.c[k] = displaced; break; }
  }
  commit();
}
// Compo liée à un autre event : reste dans sa liste, ou passe de celle des officiers aux communautaires (et inversement)
function relinkComp(comp, ev) {
  const toCommu = isCommuEvent(ev);
  if (!!comp.commu === toCommu) { comp.event = ev ? ev.id : null; commit(); return; }
  const copy = { id: newId(), raid: comp.raid, event: ev ? ev.id : null, valid: comp.valid, c: { ...comp.c }, sp: { ...(comp.sp || {}) }, ph: { ...(comp.ph || {}) } };
  if (toCommu) {
    Object.assign(copy, { commu: true, owner: ev.lid || myId() });
    (ST.ccomps = ST.ccomps || {})[copy.id] = copy;
    const w = getWeek(); w.comps = w.comps.filter(c => c !== comp);
  } else {
    comp.deleted = true;
    getWeek().comps.push(copy);
  }
  if (UI.selected === comp.id) UI.selected = copy.id;
  commit();
}
function removeFromComp(comp, slot) {
  const name = comp.c[slot];
  delete comp.c[slot];
  if (comp.sp && name) delete comp.sp[name];
  commit();
}
function mentions(comp) {
  const map = {}, out = [], uids = [];
  for (const ev of ST.events) for (const s of ev.signups) if (s.tag && s.uid) map[s.tag] = s.uid;
  for (const [uid, tag] of Object.entries(ST.links)) map[tag] = map[tag] || uid;
  for (let s = 1; s <= 40; s++) {
    if (!comp.c[s]) continue;
    const u = unitFor(comp.c[s]);
    const uid = u.uid || (u.tag && map[u.tag]);
    const m = uid ? `<@${uid}>` : (u.tag ? "@" + u.tag : null);
    if (m && !out.includes(m)) { out.push(m); if (uid) uids.push(uid); }
  }
  return { text: out.join(" "), uids };
}

// bouton Clear : balai (texte « Confirm? » le temps de la confirmation)
const CLEAR_HTML = '<img class="broom" src="icons/broom.png" alt="Clear">';
// Addon du même numéro que l'exe : installé / mis à jour par l'exe s'il est absent ou plus ancien ; dossier du jeu
// introuvable (nouvel utilisateur qui n'a téléchargé que l'exe) : fenêtre pour le choisir, puis installation
async function checkAddon() {
  let st;
  try { st = await api().addon_status(); } catch (e) { return; }
  if (!st.wowOk) { addonGate(); return; }
  const r = await api().update_addon();
  if (r && r.updated) toast(L(r.from ? "Guild Tool addon updated to {0}: type /reload in game (restart the game if new files were added)."
    : "Guild Tool addon {0} installed: restart the game (or /reload if it is running).", r.updated));
  else if (r && r.ok === false) toast(r.error, true);
}
function addonGate(error) {
  let g = $("#addonGate");
  if (!g) { g = document.createElement("div"); g.id = "addonGate"; g.className = "gate"; document.body.appendChild(g); }
  g.innerHTML = `<div class="gatebox"><h2>${esc(L("Install the Guild Tool addon"))}</h2>
    <p>${esc(L("Guild Tool works with its World of Warcraft addon. Choose your WoW Forever game folder (the one that contains Interface and WTF, for example _forever_): Guild Tool installs the addon there and keeps it up to date."))}</p>
    ${error ? `<p class="ko">${esc(error)}</p>` : ""}
    <button class="btn pri" id="addonPick">${esc(L("Choose the game folder"))}</button>
    <button class="btn" id="addonLater">${esc(L("Later"))}</button>
    <div class="help">${esc(L("You can change this folder later in the account menu (top right)."))}</div></div>`;
}
document.addEventListener("click", async e => {
  if (e.target.closest("#addonLater")) { const g = $("#addonGate"); if (g) g.remove(); return; }
  if (!e.target.closest("#addonPick")) return;
  const r = await api().pick_wow_folder();
  if (!r || (r.ok && !r.path)) return;
  if (r.ok === false) { addonGate(r.error); return; }
  const g = $("#addonGate");
  if (g) g.remove();
  await reload();
  checkAddon();
});

// Autofill (miroir de ns:Autofill) : compos de la semaine (ou celles de l'event + raid de la compo sélectionnée), par groupe
// (event, raid) dans l'ordre chronologique ; raids 10 et 40 seulement s'ils sont Main (pas communautaires), un raid 40
// rempli comme un raid 20 pour l'instant (20 places, groupes 1 à 4). Un perso n'est jamais dans deux compos du même
// raid ; un joueur jamais deux persos dans le même raid d'un même event (même horaire), mais il peut faire le raid 20
// puis le raid 10 du même event.
// Les joueurs déjà placés restent ; buffsOnly (« Autofill Buffs ») : ajoute seulement ceux qui apportent des buffs / debuffs.
function autofill(buffsOnly) {
  const all = weekComps(), sel = selected(), groups = new Map();
  for (const comp of all) {
    if (!comp.event || !canEditComp(comp) || (sel && !(comp.event === sel.event && comp.raid === sel.raid))) continue;
    if (comp.commu && +((raidByKey(comp.raid) || {}).size) !== 20) continue;
    const k = comp.event + ":" + comp.raid;
    if (!groups.has(k)) groups.set(k, { event: comp.event, raid: comp.raid, comps: [] });
    groups.get(k).comps.push(comp);
  }
  const list = [...groups.values()].map((g, i) => [g, i])
    .sort((a, b) => ((eventById(a[0].event) || {}).start || 0) - ((eventById(b[0].event) || {}).start || 0) || a[1] - b[1]).map(x => x[0]);
  const filling = new Set(list.flatMap(g => g.comps)), used = {}, busy = {};
  const pkOf = u => u.tag || u.uid || u.name;
  const mark = (comp, name) => {
    (used[comp.raid] = used[comp.raid] || new Set()).add(name);
    if (comp.event) { const bk = comp.event + ":" + comp.raid; (busy[bk] = busy[bk] || new Set()).add(pkOf(unitFor(name))); }
  };
  // déjà pris : tous les joueurs déjà placés (Autofill et Autofill Buffs complètent, ne remplacent pas)
  for (const comp of all) Object.values(comp.c).forEach(n => n && mark(comp, n));
  let placed = 0, total = 0;
  for (const g of list) {
    const raid = raidByKey(g.raid), seen = new Set(), cands = [];
    for (const u of U.signed) {
      const pk = pkOf(u);
      if (u.events.has(g.event) && !(used[g.raid] || new Set()).has(u.name) && !(busy[g.event + ":" + g.raid] || new Set()).has(pk) && !seen.has(pk)) {
        seen.add(pk); cands.push(u);
      }
    }
    total += cands.length;
    // raid 40 : rempli comme un raid 20 pour l'instant (20 premières places)
    const size = +raid.size === 40 ? 20 : +raid.size;
    const current = g.comps.map(comp => Object.entries(comp.c).filter(([s, n]) => n && +s <= size).map(([, n]) => compUnit(comp, n)));
    const plan = afPlan(cands, size, current, buffsOnly);
    // affinités (Preference Score, officiers) : échanges entre compos qui rapprochent les joueurs qui s'apprécient
    if (Object.keys(ST.socialPairs || {}).length) afSocial(plan.comps, current.map(c => c.length), size, socialW);
    g.comps.forEach((comp, i) => {
      // nouveaux venus dans une case libre de leur groupe voulu, les autres ne bougent pas
      const bySlot = {};
      for (const [s, n] of Object.entries(comp.c)) if (n) bySlot[s] = compUnit(comp, n);
      const added = afPlaceNew(bySlot, (plan.comps[i] || []).slice(current[i].length), size, plan.prefs);
      for (const [s, u] of Object.entries(added)) {
        comp.c[s] = u.name; mark(comp, u.name); placed++;
        if (comp.ph) delete comp.ph[s];
      }
    });
  }
  commit();
  toast(L(buffsOnly ? "Autofill Buffs: {0} placed in {1} comp(s), {2} left on the bench." : "Autofill: {0} placed in {1} comp(s), {2} left on the bench.",
    placed, filling.size, total - placed));
}

// ------------------------------------------------------------------ rendu
function render() {
  if (!ST) return;
  // phase choisie en grand en bas à droite (onglet Loots)
  if (typeof renderPhaseMark === "function") setTimeout(renderPhaseMark, 0);
  U = buildUnits();
  LOCKS = [];
  SIGNED = {};
  applyAppearance();
  if (typeof syncTabLook === "function") syncTabLook();
  // le sélecteur (mois / lockouts) ne survit pas à un changement de page
  if (render.page !== UI.page) { $("#picker").hidden = true; render.page = UI.page; }
  renderTop();
  document.querySelectorAll(".page").forEach(p => p.classList.toggle("on", p.id === "page-" + UI.page));
  if (UI.page === "calendar") renderCalendar();
  else if (UI.page === "comps") { renderComps(); renderList(); }
  else if (UI.page === "assigns") renderAssigns();
  else if (UI.page === "craft") renderCraft();
  else if (UI.page === "loots") renderLoots();
  else renderMembers();
  saveUI();
}

// Phases éditées dans les Settings (exe) : remplacent celles de data.js ; images des raids ajoutés
function loadPhases() {
  const list = ST.phases && ST.phases.length ? ST.phases : null;
  if (!list) return;
  PHASES.length = 0;
  for (const ph of list) {
    PHASES.push({ name: ph.name, raids: ph.raids.map(r => {
      const img = ST.raidImages[r.key] || {};
      const base = r.custom ? {} : { bg: `img/bg_${r.key}.jpg`, blur: `img/bg_${r.key}_blur.jpg` };
      const out = Object.assign({ short: r.name }, r, base, img.bg ? { bg: img.bg, blur: img.blur } : {});
      // image entière (fond d'Assigns ; sinon l'image du raid) et masque de la zone de fondu
      out.fullUrl = img.full || out.bg;
      out.fullBlur = img.fullBlur || out.blur;
      out.fullAspect = img.full ? r.fullAspect : (r.fullAspect || r.aspect);
      out.mask = img.mask || null;
      return out;
    }) });
  }
  // phase de la guilde (choisie par un admin) imposée à tous
  if (ST.guildPhase !== null && ST.guildPhase !== undefined) UI.phase = ST.guildPhase;
  if (UI.phase >= PHASES.length) UI.phase = PHASES.length - 1;
}

// Sélecteur de phase : jusqu'à 5 numéros, celui du milieu est la phase choisie (perspective : les voisins rétrécissent)
// onglet Loots : même sélecteur, propre à l'onglet, « All » après la dernière phase (toutes) ; ne change pas la phase de la guilde
const lootPhaseIdx = () => UI.lootPhase === null || UI.lootPhase === undefined || UI.lootPhase >= PHASES.length ? PHASES.length : UI.lootPhase;
function renderPhaseWheel() {
  const loots = UI.page === "loots", cur = loots ? lootPhaseIdx() : UI.phase, max = loots ? PHASES.length : PHASES.length - 1;
  let html = "";
  for (let d = -2; d <= 2; d++) {
    const i = cur + d;
    html += i >= 0 && i <= max ? `<button class="phn d${Math.abs(d)}${i === PHASES.length ? " all" : ""}" data-phase="${i}">${i === PHASES.length ? L("All") : i + 1}</button>` : '<span class="phn d9"></span>';
  }
  $("#phaseNums").innerHTML = html;
}
function setPhase(i) {
  if (UI.page === "loots") {
    i = Math.max(0, Math.min(PHASES.length, i));
    UI.lootPhase = i >= PHASES.length ? null : i;
    render(); return;
  }
  i = Math.max(0, Math.min(PHASES.length - 1, i));
  if (i === UI.phase) return;
  if (!ST.isAdmin) { toast(L("Only the admins can change the phase of the guild."), true); return; }
  UI.phase = i; ST.guildPhase = i; addState = null;
  api().set_phase(i);
  render();
}
// onglet Loots : vues affichées comme des onglets (même surbrillance que les onglets généraux)
// History en dernier (comme dans l'addon)
const LOOT_VIEWS = [["role", "Compare"], ["boss", "Tables"], ["all", "History"], ["wish", "Wishlist"], ["bis", "Bislist"]];
// réglage de la guilde (officiers) : caché aux membres
const lootFlag = k => !isOfficerUser() && !!(ST.guildFlags || {})[k];
const LOOT_VIEW_FLAG = { role: "lootHideCompare", all: "lootHideHistory" };
const lootViews = () => LOOT_VIEWS.filter(([k]) => !LOOT_VIEW_FLAG[k] || !lootFlag(LOOT_VIEW_FLAG[k]));
function renderViewBtns() {
  const tab = UI.lootTab || "all";
  $("#viewBtns").innerHTML = lootViews().map(([k, l]) => `<button class="ltab${tab === k ? " on" : ""}" data-ltab="${k}">${L(l)}</button>`).join("");
}
// Loots : boutons de phase (comme l'assiduité du détail des persos) : jusqu'à 2 de chaque côté, « All » après la dernière
function renderLootPhSel() {
  const cur = lootPhaseIdx();
  let ph = `<span>${L("Phase")}</span>`;
  for (let d = -2; d <= 2; d++) {
    const i = cur + d;
    ph += i >= 0 && i <= PHASES.length ? `<button class="aphb${i === cur ? " on" : ""}" data-lootph="${i}">${i === PHASES.length ? L("All") : i + 1}</button>` : '<span class="aphb ph0"></span>';
  }
  $("#lootPhSel").innerHTML = ph;
}
$("#lootPhSel").addEventListener("click", e => { const b = e.target.closest("[data-lootph]"); if (b) setPhase(+b.dataset.lootph); });
$("#lootPhSel").addEventListener("wheel", e => { e.preventDefault(); setPhase(lootPhaseIdx() + (e.deltaY < 0 ? -1 : 1)); }, { passive: false });
$("#phaseWheel").addEventListener("wheel", e => { e.preventDefault(); setPhase((UI.page === "loots" ? lootPhaseIdx() : UI.phase) + (e.deltaY < 0 ? -1 : 1)); }, { passive: false });

const HL = { a: "#6f7cff", b: "#3fc7eb", grad: false, timer: null };
const rgbOf = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const mixHex = (x, y, k) => { const a = rgbOf(x), b = rgbOf(y); return "#" + a.map((v, i) => Math.round(v + (b[i] - v) * k).toString(16).padStart(2, "0")).join(""); };
function setHighlight(h) {
  const root = document.documentElement.style, rgb = rgbOf(h).join(",");
  root.setProperty("--hl", h);
  root.setProperty("--hl-rgb", rgb);
  root.setProperty("--sel", `linear-gradient(180deg, rgba(${rgb},0) 0%, rgba(${rgb},.22) 100%)`);
}

// Apparence : opacité des images de compo, image de fond de la fenêtre
function applyAppearance() {
  const a = ST.appearance || {}, root = document.documentElement.style;
  root.setProperty("--comp-alpha", a.compAlpha ?? 0.3);
  // icônes de buffs des compos : épaisseur du cadre, tailles raid / groupe, intensités (cadre, icône)
  root.setProperty("--bf-th", (a.buffBorder ?? 1) + "px");
  root.setProperty("--bf-r", (a.buffSizeR ?? 16) + "px");
  root.setProperty("--bf-g", (a.buffSizeG ?? 13) + "px");
  root.setProperty("--bf-int", a.buffInt ?? 1);
  root.setProperty("--bfi-int", a.buffIconInt ?? 1);
  // réglage propre à l'onglet affiché (fenêtre d'apparence de l'onglet), sinon réglage général
  const eff = k => ((a.tabs || {})[UI.page] || {})[k] ?? a[k];
  // Assigns : fond thématique (image du raid) à la place de l'image de fond générale
  const noBg = UI.page === "assigns" && a.assignNoBg;
  root.setProperty("--bg-alpha", a.bg && ST.bgUrl && !noBg ? (eff("bgAlpha") ?? 0.6) : 0);
  // couleurs d'alternance des lockouts (opacité 60 %)
  root.setProperty("--lock-a", (a.lockA || "#0e0f12") + "99");
  root.setProperty("--lock-b", (a.lockB || "#34363e") + "99");
  root.setProperty("--list-glass", eff("listGlass") ?? 0);
  // fond thématique d'Assigns : même opacité que le fond général qu'il remplace
  root.setProperty("--assign-alpha", eff("bgAlpha") ?? 0.6);
  root.setProperty("--tabs-alpha", eff("tabsAlpha") ?? 1);
  // Loots : fond des lignes et cadres ; Members : flou de l'image de fond des persos
  root.setProperty("--loot-alpha", a.lootAlpha ?? 0.85);
  root.setProperty("--loot-blur", a.lootBlur ?? 0);
  root.setProperty("--char-blur", a.charImgBlur ?? 0);
  // Members : fond des arbres de talents, image de fond des persos
  root.setProperty("--tal-bg", a.talentBg ?? 0.35);
  root.setProperty("--char-img", a.charImgA ?? 0.5);
  root.setProperty("--det-alpha", a.detAlpha ?? 0.22);
  root.setProperty("--det-blur", a.detBlur ?? 0);
  root.setProperty("--mem-alpha", a.membersAlpha ?? 0.55);
  root.setProperty("--mem-blur", a.membersBlur ?? 0.6);
  if (UI.page !== "assigns" || !a.assignNoBg) $("#aRaidImg").hidden = true;
  else if (typeof curComp !== "undefined" && curComp) layoutRaidImage(raidByKey(curComp.raid));
  // couleur de surbrillance (sélections, survols, onglets) ; dégradé : alterne doucement entre deux couleurs
  const hex = (v, d) => /^#[0-9a-f]{6}$/i.test(v || "") ? v : d;
  HL.a = hex(a.hl, "#6f7cff"); HL.b = hex(a.hl2, "#3fc7eb"); HL.grad = !!a.hlGrad;
  setHighlight(HL.a);
  clearInterval(HL.timer);
  if (HL.grad) HL.timer = setInterval(() => {
    const k = (1 - Math.cos(Date.now() / 6000 * 2 * Math.PI)) / 2;
    setHighlight(mixHex(HL.a, HL.b, k));
  }, 60);
  applyPalette(a.base || "#1e1f24");
  $("#winBg").style.backgroundImage = ST.bgUrl ? `url('${ST.bgUrl}')` : "none";
}

function renderTop() {
  // vue de Loots cachée aux membres : Tables à la place
  if (!lootViews().some(([k]) => k === (UI.lootTab || "all"))) UI.lootTab = "boss";
  renderPhaseWheel();
  // sélecteur de phase : barre de Raid Comps seulement ; modifiable par les admins
  $("#phaseWheel").hidden = UI.page !== "comps";
  // Loots : sélecteur de phase comme le détail des persos (Members), à droite du lockout
  $("#lootPhSel").hidden = UI.page !== "loots";
  if (UI.page === "loots") renderLootPhSel();
  $("#viewBtns").hidden = UI.page !== "loots";
  // Assigns : plein écran de la carte seulement sur sa page (onglet de boss)
  document.body.classList.toggle("afull", !!UI.aFull && UI.page === "assigns" && UI.aTab > 0);
  // recherche : onglet Loots seulement (vues Player et Items)
  $("#lootSearch").hidden = UI.page !== "loots";
  if (UI.page !== "loots") $("#lootTypeList").hidden = true;
  if (UI.page === "loots") renderViewBtns();
  document.body.classList.toggle("pg-loots", UI.page === "loots");
  $("#phaseWheel").classList.toggle("ro", UI.page === "comps" && !ST.isAdmin);
  document.querySelectorAll(".ptab").forEach(b => b.classList.toggle("on", b.dataset.page === UI.page));
  // nom de la guilde (serveur Discord choisi, renommable par un officier)
  $("#appTitle").textContent = ST.title || "Guild Tool";
  document.body.classList.toggle("readonly", ST.canEdit === false);
  // dernière synchro qui a vraiment changé quelque chose
  const s = $("#syncStatus"), p2 = n => String(n).padStart(2, "0");
  if (ST.lastError) { s.className = "st-line err"; s.innerHTML = `<i></i>${esc(ST.lastError.slice(0, 70))}`; s.title = ST.lastError; }
  else if (ST.lastChange) {
    const d = new Date(ST.lastChange * 1000);
    s.className = "st-line"; s.title = "";
    s.innerHTML = `<i></i><span class="ls">${esc(L("Last Sync"))}<br>${p2(d.getDate())}/${p2(d.getMonth() + 1)} - ${p2(d.getHours())}:${p2(d.getMinutes())}</span>`;
  } else { s.className = "st-line warn"; s.innerHTML = `<i></i>${L("Not synced yet")}`; }
  // sous-barre
  const nav = UI.page !== "members" && UI.page !== "craft";
  ["#navPrev", "#navNext", "#navToday"].forEach(id => { $(id).hidden = !nav; });
  // Loots : pas de « Today » (le lockout se choisit par les flèches ou la liste)
  if (UI.page === "loots") $("#navToday").hidden = true;
  $("#navAbsence").hidden = UI.page !== "calendar";
  $("#navEditComp").hidden = !(UI.page === "assigns" && assignComp());  $("#navAbsence").textContent = L(absMode ? "Confirm" : "Absence");
  $("#navAbsence").classList.toggle("confirm", absMode);
  if (UI.page === "comps") {
    const n = eventsInWeek(currentWeek()).length;
    $("#subTitle").innerHTML = weekLabelHtml(currentWeek());
    $("#subInfo").textContent = n ? L("{0} event(s) this lockout week · click a comp's background to select it", n) : L("No event this lockout week");
  } else if (UI.page === "calendar") {
    const [y, m] = calMonth();
    $("#subTitle").textContent = new Date(y, m, 1).toLocaleString(LOC(), { month: "long", year: "numeric" });
    $("#subInfo").textContent = "";
  } else if (UI.page === "assigns") {
    const a = assignComp();
    $("#subTitle").textContent = a ? a.label : L("No comp");
    $("#subInfo").textContent = L("Click the title to choose a comp (wheel: next / previous) · click a name to change it");
  } else if (UI.page === "loots") {
    // lockout du tri des loots (jamais dans le futur ; « All » = pas de filtre)
    if (UI.lootWeek) $("#subTitle").innerHTML = weekLabelHtml(UI.lootWeek); else $("#subTitle").textContent = L("All lockouts");
    renderLootFilter();
  } else if (UI.page === "craft") {
    $("#subTitle").textContent = L("Crafts");
    $("#subInfo").textContent = L("All the recipes of the game (ProfDB export) · the four searches add up · hover a craft for its tooltip");
  } else {
    $("#subTitle").textContent = L("Guild members");
    $("#subInfo").textContent = L("Professions and gear come from members who use Guild Tool · loot from RCLootCouncil");
  }
}

// ---------- Raid Comps
// icône toujours en couleur, cadre vert (présent) / rouge (absent) ; d (debuffs) = { v : variante, effect : texte remplacé }
const buffVar = (b, v) => (v && b.vars && b.vars[v]) || b;
const buffImg = (b, on, kind, i, d) => `<img class="bf${on ? " on" : ""}" src="${ic(buffVar(b, d && d.v).icon)}" alt="" data-tip="${kind}:${i}:${on ? 1 : 0}:${(d && d.v) || ""}:${d && d.effect ? 1 : 0}">`;
const specImg = (u, fallback, spec) => {
  spec = spec || u.spec;
  const src = spec && ST.specIcons[`${u.class}:${spec}`];
  return src ? `<img class="si" src="${src}" alt="">` : (fallback || "");
};
let LOCKS = [];
const lockAttr = lock => { LOCKS.push(lock); return LOCKS.length - 1; };
const lockTip = l => `<b style="color:#ff6b6b">${L("Locked")}</b><div>${esc(L("Already in {0} ({1}), same lockout week.", compLabel(l.comp), eventTitle(l.comp.event)))}</div><div class="p">${L("Click to go there.")}</div>`;

function goToLock(l) {
  UI.page = "comps";
  render();
  const el = document.querySelector(`.slot[data-slot="${l.comp.id}:${l.slot}"]`);
  if (el) {
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.add("glow");
    setTimeout(() => el.classList.remove("glow"), 2000);
  }
}

// Date / heure d'un event sous son titre : « 28/10 - 20:00 »
function eventDate(id) {
  const ev = id && eventById(id);
  if (!ev || !ev.start) return "";
  const d = new Date(ev.start * 1000), p2 = n => String(n).padStart(2, "0");
  // jour en 3 lettres devant la date (« Wed 03/10 - 20:00 »)
  const day = d.toLocaleDateString(LOC(), { weekday: "short" }).replace(".", "");
  return `${day.charAt(0).toUpperCase() + day.slice(1, 3)} ${p2(d.getDate())}/${p2(d.getMonth() + 1)} - ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}
// Le perso (ou son joueur) est-il inscrit à l'event ?
let SIGNED = {};
function signedFor(eventId, name, tag) {
  let s = SIGNED[eventId];
  if (!s) {
    s = SIGNED[eventId] = { names: new Set(), tags: new Set() };
    const ev = eventById(eventId);
    for (const su of (ev ? ev.signups : [])) {
      if (su.st === "absence") continue;
      s.names.add(su.ch && ST.roster[su.ch] ? su.ch : "~" + su.n + "#" + (su.c || ""));
      if (su.tag) s.tags.add(su.tag);
    }
  }
  return s.names.has(name) || (tag && s.tags.has(tag));
}

// Case réservée (placeholder) : rôle (nom dans sa couleur + icône) ou classe (nom dans sa couleur + icône), puis spé
const ROLE_COLOR = { Tank: "#4f8ff7", Melee: "#ff5a5a", Ranged: "#b27cf2", Healer: "#45d483" };
function phSlotHtml(comp, s, ph) {
  const col = ph.k ? CLASS_COLOR[ph.k] : ROLE_COLOR[ph.r] || "#9a9ea9";
  const sicon = ph.s && ph.k && ST.specIcons[`${ph.k}:${ph.s}`];
  const icon = sicon ? `<img class="si" src="${sicon}" alt="">` : ph.k ? `<img class="si" src="icons/class_${ph.k.toLowerCase()}.jpg" alt="">`
    : ph.r ? `<img class="si" src="${ROLE_ICON[ph.r]}" alt="">` : "";
  const label = ph.s ? `${L(ph.s)}${ph.k ? " " + L(CLASS_NAME[ph.k] || "") : ""}` : ph.k ? L(CLASS_NAME[ph.k] || ph.k) : L(ph.r || "");
  return `<div class="slot ph" data-slot="${comp.id}:${s}" data-ph="1" style="--c:${col}"><span class="bar"></span>${icon}<span class="nm">${esc(label)}</span></div>`;
}
function compHtml(comp) {
  const r = raidByKey(comp.raid) || phase().raids[0], LAY = LAYOUT[r.size];
  const all = [], roles = { Tank: 0, Healer: 0, Melee: 0, Ranged: 0 };
  let groups = "";
  for (let g = 0; g < r.size / 5; g++) {
    const members = [];
    let slots = "";
    for (let k = 1; k <= 5; k++) {
      const s = g * 5 + k, name = comp.c[s];
      const ph = !name && comp.ph && comp.ph[s];
      if (ph) { slots += phSlotHtml(comp, s, ph); continue; }
      if (!name) { slots += `<div class="slot empty" data-slot="${comp.id}:${s}">${L("Empty")}</div>`; continue; }
      // spé choisie dans cette compo seulement
      const u = compUnit(comp, name);
      members.push(u); all.push(u);
      if (u.role && roles[u.role] !== undefined) roles[u.role]++;
      const lock = lockoutOf(name, comp.raid, comp);
      u.lock = lock;
      const lockBtn = lock ? `<button class="lockbtn" data-lock="${lockAttr(lock)}">${LOCK_SVG}</button>` : "";
      // joueur non inscrit à l'event de la compo : avertissement rouge
      const warn = comp.event && !signedFor(comp.event, name, u.tag) ? `<span class="warnsig" data-warn="1">${WARN_SVG}</span>` : "";
      const pres = comp.event ? presOf(comp.event, name, u.tag) : null;
      slots += `<div class="slot${u.missing ? " missing" : ""}${flash === comp.id + ":" + s ? " flash" : ""}" data-slot="${comp.id}:${s}" data-name="${esc(name)}" style="--c:${CLASS_COLOR[u.class] || "#9a9ea9"}"><span class="bar"></span>${specImg(u)}<span class="nm">${nameHtml(u.display, true)}</span>${pres ? presIcon(pres) : ""}${warn}${lockBtn}</div>`;
    }
    const gb = groupBuffs(members);
    // titre à gauche, buffs du groupe à droite sur la même ligne (plus de « x/5 »)
    groups += `<div class="grp"><div class="grp-h"><span>${L("Group")} ${g + 1}</span><span class="buffs">${GROUP_BUFFS.map((b, i) => gb.on[b.key] ? "" : buffImg(b, false, "g", i)).join("")}</span></div>${slots}</div>`;
  }
  // buffs de raid (Trueshot Aura cachée sans chasseur Beastmastery / Survival), puis debuffs : à la suite s'ils tiennent
  // sur la même ligne, sinon en dessous (flex-wrap, bloc de debuffs insécable)
  const rb = raidBuffs(all), db = raidDebuffs(all);
  // buffs : chaque icône dans son fond (lignes continues) ; debuffs serrés à droite de la dernière ligne s'ils tiennent
  // absents d'abord (serrés à gauche), puis présents, dans chaque bloc
  const absentFirst = list => list.filter(x => !x.on).concat(list.filter(x => x.on));
  // seulement les buffs / debuffs MANQUANTS (un buff obtenu disparaît)
  const rbHtml = absentFirst(RAID_BUFFS.map((b, i) => ({ b, i, on: !!rb[b.key] })).filter(x => !x.on && !x.b.hideOff))
    .map(x => buffImg(x.b, x.on, "r", x.i)).join("");
  const dbHtml = absentFirst(RAID_DEBUFFS.map((b, i) => ({ b, i, d: db[b.key] || {} })).map(x => ({ ...x, on: !!x.d.on })).filter(x => !x.on))
    .map(x => buffImg(x.b, x.on, "d", x.i, x.d)).join("");
  const roleHtml = ROLE_ORDER.map(ro => `<span title="${L(ro)}"><img src="${ROLE_ICON[ro]}" alt="${ro}">${roles[ro]}</span>`).join("");
  const narrow = LAY.span === 1;
  return `<div class="comp${UI.selected === comp.id ? " selected" : ""}${narrow ? " narrow" : ""}${canEditComp(comp) ? " mine" : ""}" data-comp="${comp.id}" data-span="${LAY.span}" style="grid-column:span ${LAY.span};--bg-img:${r.bg ? `url('${r.bg}')` : "none"}">
    <div class="comp-h">
      <div class="evwrap${comp.event ? "" : " none"}"><span class="evtitle"><i class="tri"></i><b>${esc(eventTitle(comp.event))}</b></span><button class="evhit" data-evmenu="${comp.id}" title="${L("Link this comp to another event of the week")}"></button></div>
      ${comp.commu ? `<span class="cbadge" data-help="Community event comp: made by the creator of the event (or an officer).">${L("Commu")}</span>` : ""}${socialBadge(comp)}<button class="ib" data-assign="${comp.id}" data-help="${L("Assigns of this comp")}">${ASSIGN_SVG}</button>
      <button class="ib valid${comp.valid ? " on" : ""}" data-valid="${comp.id}" data-help="${comp.valid ? "Validated: visible to everyone, the event is green in the calendar. Click to hide it again." : comp.commu ? "Hidden: only the creator of the event and the officers see this comp. Click to validate it and show it to everyone." : "Hidden: only the officers see this comp. Click to validate it and show it to everyone."}">${comp.valid ? EYE : EYE_OFF}</button>
      <button class="ib" data-post="${comp.id}" title="${L("Post to Discord")}">${POST_SVG}</button>
      <button class="ib del" data-del="${comp.id}" title="${L("Remove this comp")}"><span>×</span></button>
    </div>
    <div class="comp-l2"><span class="evdate">${esc(eventDate(comp.event))}</span><span class="roles">${roleHtml}</span></div>
    <div class="rbuffs"><span class="rbicons">${rbHtml}</span><span class="rbicons rdeb">${dbHtml}</span></div>
    <div class="groups" style="grid-template-columns:repeat(${LAY.gcols},minmax(0,1fr))">${groups}</div></div>`;
}

function tileHtml() {
  if (addState && addState.raid) {
    const r = raidByKey(addState.raid);
    // officiers : tous les events (Main ou communautaires) ; créateur d'un event communautaire : ses events seulement
    // tous les events du lockout ; membre : seuls ses events communautaires sont choisissables (les autres : interdit)
    const mine = new Set(myCommuEvents().map(ev => ev.id));
    const evs = eventsInWeek(currentWeek()).map(ev => {
      const ok = canEdit() || mine.has(ev.id);
      return `<button ${ok ? `data-addev="${ev.id}"` : `class="deny" data-help="Only the creator of a community event (or an officer) can make its comp."`}>${esc(eventLabel(ev))}${isCommuEvent(ev) ? ` <small class="mute">· ${L("community")}</small>` : ""}</button>`;
    }).join("");
    return `<div class="addtile picking mine" data-span="${LAYOUT[r.size].span}" style="grid-column:span ${LAYOUT[r.size].span}"><div class="choices">
      <div class="pickhead">${esc(r.name)} ${r.size} · ${L("link to an event")}</div>${evs}
      ${canEdit() ? `<button class="mute" data-addev="">${L("No event")}</button>` : ""}<button class="mute" data-addcancel="1">${L("Cancel")}</button></div></div>`;
  }
  if (!canAddComp()) return "";
  const raids = phase().raids.map(r => `<button class="raidpart" data-addraid="${r.key}"><span class="rp-num">${r.size}</span><span class="rp-name">${esc(r.name)}</span></button>`).join("");
  return `<div class="addtile mine" data-span="1"><div class="plus"><i>+</i>${L("New comp")}</div><div class="choices">${raids}</div></div>`;
}

// Image recadrée qui suit la taille de son cadre (bannières des boss, barres des raids : onglet Loots, Tables).
// data-cimg = image, data-crop = « x,y,w,h » (fractions de l'image) choisi au format du cadre fermé. Le cadrage garde sa
// largeur et son centre : cadre plus haut = plus d'image en haut et en bas (autant que possible), image pas assez haute
// = largeur resserrée ; cadre plus large que l'image = image entière en largeur, bande centrée sur le cadrage.
const IMG_AR = {};
// w, h : taille imposée (animation : taille de départ, puis d'arrivée) ; sinon celle du cadre
function placeCrop(el, W, H) {
  const url = el.dataset.cimg;
  if (!url) return;
  const ar = IMG_AR[url];
  if (!ar) {
    if (ar === undefined) {
      IMG_AR[url] = 0;
      const im = new Image();
      im.onload = () => { IMG_AR[url] = im.naturalWidth / im.naturalHeight || 1; document.querySelectorAll("[data-cimg]").forEach(x => { if (x.dataset.cimg === url) placeCrop(x); }); };
      im.src = url;
    }
    return;
  }
  const bw = W || el.clientWidth, bh = H || el.clientHeight;
  if (!bw || !bh) return;
  // « x,y,w,h[,a,b] » : a = opacité, b = flou (outil de recadrage)
  const [x, y, w, h, a, b] = (el.dataset.crop || "0,0.4,1,0.2").split(",").map(Number);
  const iw = 1000, ih = 1000 / ar, cx = (x + w / 2) * iw, cy = (y + h / 2) * ih;
  let sw = w * iw, sh = sw * bh / bw, sx = x * iw, sy;
  if (sh > ih) { sh = ih; sw = ih * bw / bh; sx = cx - sw / 2; }
  if (sw > iw) { sw = iw; sh = iw * bh / bw; sx = 0; }
  sx = Math.min(Math.max(0, sx), iw - sw);
  sy = Math.min(Math.max(0, cy - sh / 2), ih - sh);
  const k = bw / sw, size = `${iw * k}px ${ih * k}px`, pos = [-sx * k, -sy * k];
  // image dans un calque (.cimgbg) : opacité et flou sans toucher au texte
  const t = el.querySelector(":scope > .cimgbg") || el;
  // flou : le calque déborde (bords flous transparents sinon : le fond de la barre apparaissait au survol)
  const n = t !== el && b > 0 ? Math.ceil(b * 10 * 2) : 0;
  t.style.backgroundImage = `url('${url}')`;
  t.style.backgroundSize = size;
  t.style.backgroundPosition = `${pos[0] + n}px ${pos[1] + n}px`;
  if (t !== el) {
    t.style.inset = n ? `-${n}px` : "";
    t.style.opacity = isNaN(a) ? 1 : a;
    t.style.filter = b > 0 ? `blur(${(b * 10).toFixed(1)}px)` : "";
  }
  // lettres « verre » (nom et taille d'un raid) : image floutée alignée sur celle du fond
  const blur = el.dataset.cblur;
  if (blur) el.querySelectorAll(".glass").forEach(g => {
    g.style.backgroundImage = `linear-gradient(rgba(255,255,255,.3), rgba(255,255,255,.3)), url('${blur}')`;
    g.style.backgroundSize = `auto, ${size}`;
    g.style.backgroundPosition = `0 0, ${pos[0] - g.offsetLeft}px ${pos[1] - g.offsetTop}px`;
  });
}
// (pas forEach(placeCrop) : l'index et la liste passeraient pour la largeur et la hauteur)
const placeCrops = root => (root || document).querySelectorAll("[data-cimg]").forEach(el => placeCrop(el));
const cropAttr = r => r ? [r.x, r.y, r.w, r.h, r.a ?? 1, r.b ?? 0].join(",") : "";
// image de fond d'un raid (la même que dans Settings > Phases & Raids)
const raidBgUrl = r => r.custom ? (ST.raidImages[r.key] || {}).bg : `img/bg_${r.key}.jpg`;
const raidBlurUrl = r => r.custom ? (ST.raidImages[r.key] || {}).blur : `img/bg_${r.key}_blur.jpg`;

// Ordre d'affichage des compos : Main avant communautaires, puis raid 20 > 40 > 10, puis date de l'event (sans event : à la fin)
const SIZE_RANK = { 20: 0, 40: 1, 10: 2 };
function sortedComps(list) {
  const key = c => {
    const r = raidByKey(c.raid) || {}, ev = c.event && eventById(c.event);
    return [c.commu ? 1 : 0, SIZE_RANK[+r.size] ?? 3, ev && ev.start ? ev.start : Infinity];
  };
  return list.map((c, i) => [c, key(c), i]).sort((a, b) => {
    for (let k = 0; k < 3; k++) if (a[1][k] !== b[1][k]) return a[1][k] < b[1][k] ? -1 : 1;
    return a[2] - b[2];
  }).map(x => x[0]);
}
// Grille des compos : autant de colonnes (234 px max, 10 px d'écart, 4 au minimum) que la largeur le permet (plein écran :
// 3 raids 20 par ligne...). Série = compos qui se suivent de la même taille (même largeur) : elle commence à la ligne,
// sauf si mettre ses premières compos dans la place libre de la ligne d'avant lui économise une ligne (alors juste le
// nombre qu'il faut : 6 raids 10, 5 par ligne, après 2 raids 20 -> 1 remonte, les 5 autres sur la ligne suivante).
// Jamais reculée. La tuile « New comp » en fin de la première ligne où elle tient. Recalculé à chaque rendu
const COMP_COL = 234, COMP_GAP = 10;
function layoutComps(box) {
  const cs = getComputedStyle(box);
  const W = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const N = Math.max(4, Math.floor((W + COMP_GAP) / (COMP_COL + COMP_GAP)));
  box.style.gridTemplateColumns = `repeat(${N}, minmax(0, ${COMP_COL}px))`;
  const used = [];                       // colonnes occupées par ligne
  let row = 0;
  const items = [...box.children], comps = items.filter(x => x.classList.contains("comp"));
  const place = el => {
    const span = Math.min(N, +el.dataset.span || 1);
    if (used[row] === undefined) used[row] = 0;
    if (used[row] + span > N) { row++; used[row] = 0; }
    el.style.gridRow = String(row + 1);
    el.style.gridColumn = `${used[row] + 1} / span ${span}`;
    used[row] += span;
  };
  for (let i = 0; i < comps.length;) {
    const span = Math.min(N, +comps[i].dataset.span || 1);
    let j = i;
    while (j < comps.length && Math.min(N, +comps[j].dataset.span || 1) === span) j++;
    const k = j - i, perRow = Math.floor(N / span), free = used[row] === undefined ? N : N - used[row];
    if (free < N) {
      // compos à remonter pour économiser une ligne (0 : la série commence à la ligne)
      const up = k - (Math.ceil(k / perRow) - 1) * perRow;
      if (up > Math.floor(free / span)) { row++; used[row] = 0; }
      else { for (let n = 0; n < up; n++) place(comps[i + n]); i += up; if (i < j) { row++; used[row] = 0; } }
    }
    for (; i < j; i++) place(comps[i]);
  }
  const tile = items.find(x => x.classList.contains("addtile"));
  if (tile) {
    const span = Math.min(N, +tile.dataset.span || 1);
    let r = used.findIndex(u => N - u >= span);
    if (r < 0) r = used.length;
    tile.style.gridRow = String(r + 1);
    tile.style.gridColumn = `${(used[r] || 0) + 1} / span ${span}`;
  }
}

function renderComps() {
  const box = $("#comps"), scroll = box.scrollTop;
  // compos cachées (œil barré) : visibles des officiers (et du créateur de l'event, compo communautaire) seulement
  box.innerHTML = sortedComps(weekComps().filter(canSeeComp)).map(compHtml).join("") + tileHtml();
  layoutComps(box);
  flowRaidBuffs(box);
  document.body.classList.toggle("cc-mine", weekComps().some(canEditComp));
  box.scrollTop = scroll;
  flash = null;
}

// Buffs de raid en lignes (comme l'addon) : chaque ligne a son fond, ajusté à ses icônes (3 px de marge de chaque
// côté) ; debuffs serrés à droite de la dernière ligne s'ils y tiennent avec 10 px d'écart, sinon sur une ligne dessous
function flowRaidBuffs(root) {
  for (const el of root.querySelectorAll(".rbuffs:not(.flowed)")) {
    const [bsrc, dsrc] = el.querySelectorAll(".rbicons");
    const bufs = [...bsrc.children], debs = [...dsrc.children];
    const W = el.clientWidth, size = (bufs[0] || debs[0]) ? (bufs[0] || debs[0]).getBoundingClientRect().width : 16;
    const step = size + 2, pad = 3, perRow = Math.max(1, Math.floor((W - 2 * pad + 2) / step));
    const rows = [];
    for (let i = 0; i < bufs.length; i += perRow) rows.push(bufs.slice(i, i + perRow));
    const w = n => n * step - 2 + 2 * pad, last = rows.length ? rows[rows.length - 1].length : 0;
    const same = rows.length && w(last) + 10 + w(Math.min(debs.length, perRow)) <= W;
    el.innerHTML = "";
    const block = (imgs, cls) => { const s = document.createElement("span"); s.className = cls; imgs.forEach(i => s.appendChild(i)); return s; };
    rows.forEach((r, i) => {
      const row = document.createElement("div");
      row.className = "rbrow";
      row.appendChild(block(r, "rbbg"));
      if (same && i === rows.length - 1) row.appendChild(block(debs, "rbbg rdeb"));
      el.appendChild(row);
    });
    if (!same) { const row = document.createElement("div"); row.className = "rbrow"; row.appendChild(block(debs, "rbbg rdeb")); el.appendChild(row); }
    el.classList.add("flowed");
  }
}
let flowTimer = null;
window.addEventListener("resize", () => { clearTimeout(flowTimer); flowTimer = setTimeout(() => { if (UI.page === "comps") renderComps(); else if (UI.page === "calendar") fitDayNotes(); }, 150); });

// ---------- liste de droite
const CMP = {
  raids: u => -(u.raids || 0),
  // nom Discord (A-Z), sans nom à la fin
  discord: u => u.discord ? String(u.discord).toLowerCase() : "\uffff",
  loots: u => -(u.loots || 0),
  spec: u => { const i = ROLE_ORDER.indexOf(u.role); return i < 0 ? 99 : i; },
  class: u => { const i = CLASS_ORDER.indexOf(u.class); return i < 0 ? 99 : i; },
  player: u => u.tag || "~",
  alpha: u => u.display.toLowerCase(),
  level: u => -(u.level ?? (ST.roster[u.name] || {}).l ?? 0),
};
const HEAD = {
  spec: u => u.role || "Unknown spec",
  class: u => CLASS_NAME[u.class] || "Unknown",
  player: u => u.tag ? "@" + u.tag : L("No Discord tag"),
  alpha: u => u.display.charAt(0).toUpperCase(),
  level: u => L("Level") + " " + (u.level ?? (ST.roster[u.name] || {}).l ?? "?"),
  discord: u => u.discord || L("No Discord name"),
};
// Members : Spec = classe puis spé dans l'ordre de la classe (Holy, Protection, Retribution à la suite) ;
// Attendance = raids faits (toutes phases, comme la colonne), du plus au moins
const MCMP = Object.assign({}, CMP, {
  spec: u => { const ci = CLASS_ORDER.indexOf(u.class), si = (SPECS[u.class] || []).findIndex(s => s[0] === u.spec);
               return (ci < 0 ? 99 : ci) * 100 + (si < 0 ? 99 : si); },
  attendance: u => -attendanceOf(u).n,
  // rôle Discord du joueur (social.js) : propriétaire, Officier, Titulaire, La Relève, autres
  drole: u => discordRoleRank(socialId(u)),
});
function sortUnits(list, order, cmp = CMP) {
  list.sort((a, b) => {
    for (const k of order) { if (!cmp[k]) continue; const x = cmp[k](a), y = cmp[k](b); if (x !== y) return x < y ? -1 : 1; }
    return a.name < b.name ? -1 : 1;
  });
}
function headerHtml(primary, h, n) {
  const role = primary === "spec" && ROLE_ICON[h];
  const icon = role ? `<img src="${ROLE_ICON[h]}" alt="">` : "";
  return `<div class="lh${primary === "player" ? " lower" : ""}${role ? " role" : ""}">${icon}<span>${esc(L(h))}</span><span class="n">${n ?? ""}</span></div>`;
}
function chipsHtml(order) {
  return order.map((k, i) => (i ? '<span class="gt">›</span>' : "") + `<span class="chip" data-chip="${k}"><span class="gr">:::</span>${L(SORT_LABEL[k])}</span>`).join("");
}

function renderList() {
  const sel = selected(), counts = { signed: 0, rest: 0 }, visible = [];
  for (const key of ["signed", "rest"]) for (const u of U[key]) {
    const hidden = sel ? findInComp(sel, u.name) : isPlaced(u.name);
    if (hidden) continue;
    counts[key]++;
    if (key !== UI.tab) continue;
    visible.push(u);
    u.lock = sel ? lockoutOf(u.name, sel.raid, sel) : null;
    const a = alreadyIn(u);
    u.already = a ? L("Already in {0} with {1}", compLabel(a.comp), unitFor(a.name).display) : null;
    u.alreadyShort = a ? L("already in {0}", compLabel(a.comp)) : null;
  }
  document.querySelectorAll(".stab").forEach(b => {
    b.classList.toggle("on", b.dataset.tab === UI.tab);
    b.querySelector("span").textContent = counts[b.dataset.tab];
  });
  const st = $("#selText");
  st.textContent = sel ? L("Selected: {0} · {1}", compLabel(sel), eventTitle(sel.event)) : L("All events of the week");
  st.classList.toggle("on", !!sel);
  document.querySelector('[data-chipbar="order"]').innerHTML = chipsHtml(UI.order);
  sortUnits(visible, UI.order);
  const primary = UI.order[0], groupCount = {};
  visible.forEach(u => { const h = HEAD[primary](u); groupCount[h] = (groupCount[h] || 0) + 1; });
  // groupes : en-tête + persos ; tri par rôle : ligne verticale de la couleur du rôle, de son icône au dernier perso
  let html = "", last = null;
  visible.forEach((u, i) => {
    const h = HEAD[primary](u);
    if (h !== last) {
      const role = primary === "spec" && ROLE_ICON[h];
      html += (last !== null ? "</div>" : "") + `<div class="lgrp${role ? " rline" : ""}"${role ? ` style="--rc:${ROLE_COLOR[h] || "#9a9ea9"}"` : ""}>`
        + headerHtml(primary, h, groupCount[h]);
      last = h;
    }
    let rt = "";
    if (u.lock) rt = `<span class="rt locked" data-lock="${lockAttr(u.lock)}">${L("locked")}</span>`;
    else if (u.already) rt = `<span class="rt already">${esc(u.alreadyShort)}</span>`;
    else if (u.unlinked) rt = `<span class="rt unlinked">${L("Unlinked")}</span>`;
    else if (u.status && u.status !== "primary" && !PRES_SVG[u.status]) rt = `<span class="rt ${u.status}">${L(STATUS_TEXT[u.status] || u.status)}</span>`;
    // présence : absent / incertain (Rest), en retard (Signed)
    if (u.pres) rt = presIcon(u.pres) + rt;
    else if (!u.signed && !u.spec) rt = `<span class="rt nospec">${L("no spec")}</span>`;
    html += `<div class="row" data-row="${i}" data-name="${esc(u.name)}" style="--c:${CLASS_COLOR[u.class] || "#9a9ea9"}">${specImg(u, '<span class="ci"></span>')}<span class="nm">${nameHtml(u.display, true)}</span><span class="dt">${esc(discordName(u))}</span>${rt}</div>`;
  });
  if (last !== null) html += "</div>";
  if (!visible.length) {
    const msg = UI.tab === "rest" ? L("No other level {0}+ in the guild roster.", ST.minLevel)
      : !eventsInWeek(currentWeek()).length ? L("No Raid-Helper event this lockout week.")
      : L("No sign-ups left. Link a comp to an event (arrow next to its title) to see its sign-ups.");
    html = `<div class="empty-list">${msg}</div>`;
  }
  const list = $("#list"), scroll = list.scrollTop;
  list.innerHTML = html;
  // pseudos Discord alignés à gauche, juste après le nom de perso le plus long
  const nms = [...list.querySelectorAll(".row .nm")];
  const right = Math.max(0, ...nms.map(n => n.offsetLeft + n.offsetWidth));
  nms.forEach(n => { n.style.minWidth = (right - n.offsetLeft) + "px"; });
  list.scrollTop = scroll;
  list._visible = visible;
}

// ---------- Calendar : défilement continu, d'octobre 2026 (pas avant) à 12 mois après le mois actuel
const CAL_MIN = 2026 * 100 + 9;                      // octobre 2026 (mois 0-11)
const calMax = () => { const d = new Date(); d.setMonth(d.getMonth() + 12); return d.getFullYear() * 100 + d.getMonth(); };
const calClamp = v => Math.max(CAL_MIN, Math.min(calMax(), v));
// mois affiché (ligne du haut de la zone visible), sinon le mois actuel
function calMonth() {
  const v = UI.calVisible || calClamp(new Date().getFullYear() * 100 + new Date().getMonth());
  return [Math.floor(v / 100), v % 100];
}
const ymd = ts => { const d = new Date(ts * 1000); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); };

// Semaines du lundi au dimanche, à la suite ; teinte et survol par lockout (mercredi -> mardi).
// Limite entre deux mois : ligne Highlight au-dessus des 7 premiers jours et à gauche du 1er (escalier),
// nom du mois au-dessus de son premier jour. 5 semaines visibles à la fois.
// Note du jour trop longue pour sa ligne : police 1 px plus petite, puis défilement aller-retour (bandeau)
function fitDayNotes() {
  for (const el of document.querySelectorAll("#cal .dnote")) {
    el.classList.remove("small", "scroll");
    if (el.scrollWidth <= el.clientWidth) continue;
    el.classList.add("small");
    if (el.scrollWidth <= el.clientWidth) continue;
    const shift = el.scrollWidth - el.clientWidth;
    el.classList.add("scroll");
    el.style.setProperty("--shift", -shift + "px");
    el.style.setProperty("--dur", Math.max(3, shift / 25) + "s");
  }
}
function renderCalendar() {
  const minY = Math.floor(CAL_MIN / 100), minM = CAL_MIN % 100, max = calMax();
  const first = new Date(minY, minM, 1, 12), start = new Date(minY, minM, 1 - (first.getDay() + 6) % 7, 12);
  const end = new Date(Math.floor(max / 100), max % 100 + 1, 0, 12);
  const today = ymd(now()), byDay = {}, absDay = absentsByDay();
  for (const ev of sortedEvents()) (byDay[ymd(ev.start)] = byDay[ymd(ev.start)] || []).push(ev);
  let head = '<div class="cal-head">';
  for (let d = 0; d < 7; d++) head += `<span>${new Date(2026, 0, 5 + d).toLocaleString(LOC(), { weekday: "long" })}</span>`;
  head += "</div>";
  let html = "", rows = 0;
  for (let w0 = new Date(start); w0 <= end; w0.setDate(w0.getDate() + 7)) {
    const thu = new Date(w0.getFullYear(), w0.getMonth(), w0.getDate() + 3, 12);
    html += `<div class="week" data-wm="${thu.getFullYear() * 100 + thu.getMonth()}">`;
    for (let d = 0; d < 7; d++) {
      const date = new Date(w0.getFullYear(), w0.getMonth(), w0.getDate() + d, 12), ts = date.getTime() / 1000, key = ymd(ts);
      const lock = weekOf(ts), evs = byDay[key] || [], dm = date.getDate();
      const cls = (lock % 2 ? " dark" : " light") + (key === today ? " today" : "")
        + (dm <= 7 && rows > 0 ? " m-top" : "") + (dm === 1 && d > 0 ? " m-left" : "") + (d === 3 && dm <= 7 && rows > 0 ? " m-thu" : "")
        + (absences().has(String(key)) ? " absent" : "") + (absMode && absSel.has(String(key)) ? " picked" : "");
      // nom du mois : au-dessus de la ligne, sur le jeudi (colonne du milieu) de la ligne de séparation
      const thuLine = d === 3 && dm <= 7 && rows > 0;
      const prevM = new Date(date.getFullYear(), date.getMonth() - 1, 1);
      const mname = thuLine ? `<span class="mname">${esc(prevM.toLocaleString(LOC(), { month: "long", year: prevM.getMonth() === 11 ? "numeric" : undefined }))}</span>`
        + `<span class="mname next">${esc(date.toLocaleString(LOC(), { month: "long", year: date.getMonth() === 0 ? "numeric" : undefined }))}</span>` : "";
      // commu : orangé ; archivés (salon d'archive, ou lockout passé sans attendre le déplacement par le serveur) :
      // Main bleuté (compo visible ou non), commu sans fond (classes march / carch)
      const lockNow = weekStart(Math.floor(Date.now() / 1000));
      const archived = ev => ev.chId === mainArchive() || ev.chId === commuArchive() || ev.start < lockNow;
      const evCls = ev => (isCommuEvent(ev) ? " commu" : "") + (archived(ev) ? (isCommuEvent(ev) ? " carch" : " march") : "");
      const lines = evs.slice(0, 4).map(ev => `<div class="ev${evCls(ev)}${eventDone(ev) ? " done" : ""}${eventDone(ev) && myStatus(ev) && myStatus(ev) !== "absence" && myCompSpot(ev) === false ? " benched" : ""}" data-evopen="${ev.id}" title="${esc(eventLabel(ev))}">${new Date(ev.start * 1000).toLocaleTimeString(LOC(), { hour: "2-digit", minute: "2-digit" })}  ${esc(ev.title)}${myStatusIcon(ev)}</div>`).join("");
      const note = ((ST.notes || {})[String(key)] || {}).text;
      const acting = calAct && calAct.day === String(key) ? " acting" : "";
      // note du jour : à droite du numéro, sur une ligne (police réduite, puis défilement si trop longue : fitDayNotes)
      html += `<div class="day${cls}${acting}" data-day="${ts}" data-key="${key}" data-lockout="${lock}">${mname}<span class="dn"><b>${dm}</b>`
        + `${note ? `<span class="dnote"><span>${esc(note.replace(/\s+/g, " "))}</span></span>` : ""}</span>${lines}${evs.length > 4 ? `<span class="more">${L("+{0} more", evs.length - 4)}</span>` : ""}`
        + (absDay[key] ? `<div class="dabs">${absDay[key].map(esc).join(", ")}</div>` : "")
        + (absMode ? "" : `<div class="dmenu">${dayMenu(String(key), ts, evs)}${absDay[key] ? `<div class="dabslist"><b>${L("Absent")}</b>${absDay[key].map(n => `<span>${esc(n)}</span>`).join("")}</div>` : ""}</div>`) + `</div>`;
    }
    html += "</div>";
    rows++;
  }
  const old = $("#calWeeks"), keep = old ? old.scrollTop : null;
  $("#cal").innerHTML = head + `<div class="calweeks" id="calWeeks">${html}</div>`;
  $("#cal").classList.toggle("selecting", absMode);
  fitDayNotes();
  const box = $("#calWeeks");
  box.style.setProperty("--rowh", Math.max(70, box.clientHeight / 5) + "px");
  if (UI.calJump) { calScrollTo(UI.calJump); UI.calJump = null; }
  else if (keep !== null) box.scrollTop = keep;
  else calScrollTo(calClamp(new Date().getFullYear() * 100 + new Date().getMonth()));
  box.addEventListener("scroll", calScrolled, { passive: true });
  calScrolled();
}
// ---------- Menu d'un jour (survol) : boutons d'1/4 de case, empilés, défilants
//   Note (tous, partagée avec la guilde) · +Event Main Raid (officiers) · event communautaire (tous) ·
//   un cadre par event du jour (Main Raid d'abord) : s'inscrire (classes de l'Event Class), late, tentative, absence
let calAct = null;   // action en cours : { day, mode: note|main|commu, step: text|title|desc|time, text, title, desc, min }
const TIMES = [...Array(48).keys()].map(i => i * 30).concat([1439]).filter(m => m !== 1440);   // 00:00 … 23:30, 23:59
const hhmm = m => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
const REACT = [["sign", "👍", "Sign up (your classes of the Event Class)"], ["late", "🕐", "Late"], ["tentative", "⚖️", "Tentative"], ["absence", "❌", "Absence"]];
function reactIcon(k, emoji) {
  const u = (ST.statusIcons || {})[k];
  return u ? `<img src="${u}" alt="">` : `<span class="emo">${emoji}</span>`;
}
// Mon inscription à un event (compte Discord connecté) : sign / late / tentative / absence, sinon null
function myStatus(ev) {
  const me = ST.cloud && ST.cloud.logged && ST.cloud.user && ST.cloud.user.id;
  if (!me) return null;
  const mine = (ev.signups || []).filter(s => s.uid === me);
  if (!mine.length) return null;
  for (const k of ["absence", "tentative", "late"]) if (mine.some(s => s.st === k)) return k;
  return "sign";
}
const myStatusIcon = ev => {
  const k = myStatus(ev);
  if (!k) return "";
  // compo visible de tous : ma spé dans la compo, sinon « Bench » (pas pour une absence)
  const spots = k === "absence" ? null : myCompSpots(ev), spot = spots ? spots[0] || false : null;
  if (spot) {
    // plusieurs persos comptés (plusieurs compos) : leurs icônes de spé ; plus de trois : la 1re et « +X »
    const icon = x => { const src = x.spec && ST.specIcons[`${x.cls}:${x.spec}`]; return src ? `<img src="${src}" alt="">` : `<span class="signed">${L("In")}</span>`; };
    const what = spots.map(x => ((x.spec || "") + " " + L(CLASS_NAME[x.cls] || "")).trim()).join(", ");
    const inner = spots.length > 3 ? icon(spots[0]) + `<span class="evmore">+${spots.length - 1}</span>` : spots.map(icon).join("");
    return `<span class="evme${spots.length > 1 ? " multi" : ""}" data-help="${esc(L("You are in the comp: {0}", what))}">${inner}</span>`;
  }
  // pas dans la compo visible : icône du banc (rouge) à la place du texte « Bench »
  if (spot === false) return `<span class="evme" data-help="${esc(L("Not in the comp of this event."))}"><span class="benchi"></span></span>`;
  // inscrit : le « V » de la fenêtre d'event (vert) à la place du texte « Signed »
  const inner = k === "sign" ? `<span class="signed">${EV_ICO.check}</span>` : reactIcon(k, REACT.find(r => r[0] === k)[1]);
  return `<span class="evme" data-help="${esc(L("Your sign-up: {0}", L(REACT.find(r => r[0] === k)[2])))}">${inner}</span>`;
};
// classes de couleur d'une barre d'event (case et menu) : commu orangé ; archivé (salon d'archive ou lockout passé) :
// Main bleuté, commu sans fond
function evBarCls(ev) {
  const archived = ev.chId === mainArchive() || ev.chId === commuArchive() || ev.start < weekStart(Math.floor(Date.now() / 1000));
  return (isCommuEvent(ev) ? " commu" : "") + (archived ? (isCommuEvent(ev) ? " carch" : " march") : "");
}
function dayMenu(day, ts, evs) {
  const a = calAct && calAct.day === day ? calAct : null;
  const field = (step, ph, val) => `<div class="dbtn form"><input class="dinput" data-dstep="${step}" placeholder="${esc(L(ph))}" value="${esc(val || "")}" spellcheck="false"></div>`;
  let h = "";
  // 1. note
  // 2. Event : fenêtre de création (Main pour les officiers, communautaire pour tous), à côté de Note
  const evBtn = `<button class="dbtn" data-evnew="${day}" data-help="Create an event on Discord (Raid-Helper).">${PLUS_SVG}<span>${L("Event")}</span></button>`;
  if (a && a.mode === "note") h += `<div class="dbtn form tall"><textarea class="dinput" data-dstep="text" placeholder="${esc(L("Note for this day · Enter to save, Esc to cancel"))}">${esc(a.text || "")}</textarea></div>`;
  // 3. Raid Comps de ce lockout ; les trois sur une ligne, icônes seules (le survolé s'élargit et montre son nom)
  else h += `<div class="dpair dtrio">${isOfficerUser() ? `<button class="dbtn" data-dact="note">${NOTE_SVG}<span>${L("Note")}</span></button>` : ""}${evBtn}`
    + `<button class="dbtn" data-dcomps="${ts}" data-help="Open the Raid Comps of this lockout.">${COMPS_SVG}<span>${L("Raid Comps")}</span></button></div>`;
  // 4+. events du jour : Main Raid d'abord, puis à l'heure
  const list = evs.slice().sort((x, y) => (isMainEvent(y) - isMainEvent(x)) || x.start - y.start);
  for (const ev of list) {
    const tm = new Date(ev.start * 1000).toLocaleTimeString(LOC(), { hour: "2-digit", minute: "2-digit" });
    // clic : fenêtre de réaction (inscription, absence…) ; officiers : modifier / supprimer
    // compo visible : vert comme dans la case (plus léger si je suis sur le banc)
    const done = eventDone(ev), bench = done && myStatus(ev) && myStatus(ev) !== "absence" && myCompSpot(ev) === false;
    h += `<button class="dbtn devt${evBarCls(ev)}${done ? " done" : ""}${bench ? " benched" : ""}" data-evreact="${ev.id}" data-help="${esc(eventLabel(ev))}"><span class="dt">${tm}</span><span class="dl">${esc(ev.title)}</span>${myStatusIcon(ev)}</button>`;
  }
  return h;
}
function timeBtn(a) {
  return `<button class="dbtn time" data-dtime="1" data-help="Wheel: +/- 30 min · click: create the event">${CLOCK_SVG}<b>${hhmm(a.min)}</b><span>${L(a.mode === "main" ? "Create Main Raid" : "Create")}</span></button>`;
}
const NOTE_SVG = '<svg viewBox="0 0 24 24"><path d="M5 4h10l4 4v12H5z"/><path d="M15 4v4h4"/><path d="M8 12h8M8 15.5h6"/></svg>';
const PLUS_SVG = '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>';
const COMPS_SVG = '<svg viewBox="0 0 24 24"><rect x="3.5" y="4" width="7" height="7"/><rect x="13.5" y="4" width="7" height="7"/><rect x="3.5" y="13" width="7" height="7"/><rect x="13.5" y="13" width="7" height="7"/></svg>';
const CLOCK_SVG = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>';
function startCalAct(day, mode) {
  calAct = { day, mode, step: mode === "note" ? "text" : mode === "main" ? "desc" : "title", min: 20 * 60 + 30,
             text: mode === "note" ? (((ST.notes || {})[day] || {}).text || "") : "" };
  renderCalendar(); focusCalAct();
}
function focusCalAct() {
  const el = calAct && document.querySelector(`.day[data-key="${calAct.day}"] .dinput`);
  if (el) { el.focus(); el.selectionStart = el.selectionEnd = el.value.length; }
}
async function calEnter(el) {
  const a = calAct;
  if (!a) return;
  const v = el.value.trim();
  if (a.mode === "note") {
    const r = await api().set_note(a.day, v);
    if (r && r.ok === false) toast(r.error, true);
    (ST.notes = ST.notes || {})[a.day] = { text: v };
    calAct = null; renderCalendar(); return;
  }
  if (a.step === "title") { if (!v) return; a.title = v; a.step = "desc"; }
  else if (a.step === "desc") { a.desc = v; a.step = "time"; }
  renderCalendar(); focusCalAct();
}
async function calCreate() {
  const a = calAct;
  const y = Math.floor(+a.day / 10000), m = Math.floor(+a.day / 100) % 100 - 1, d = +a.day % 100;
  const start = Math.floor(new Date(y, m, d, Math.floor(a.min / 60), a.min % 60).getTime() / 1000);
  calAct = null; renderCalendar();
  toast(L("Creating the event on Discord…"));
  const r = await api().rh_create(a.mode, start, a.title || "", a.desc || "");
  if (!r || r.ok === false) { toast((r && r.error) || "Error", true); return; }
  toast(a.mode === "main" ? L("Main Raid created ({0} sign-ups copied).", r.copied || 0) : L("Community event created."));
  doSync();
}
// Joueurs absents par jour (« AAAAMMJJ » -> noms) : jours déclarés par chacun (docs de la guilde) + les miens
function absentsByDay() {
  const out = {}, me = myId(), add = (d, n) => { const k = +d; (out[k] = out[k] || []).includes(n) || out[k].push(n); };
  for (const [uid, a] of Object.entries(ST.guildAbs || {})) {
    if (uid === me) continue;
    for (const d of (a && a.days) || []) add(d, a.name || "?");
  }
  const myName = (ST.cloud && ST.cloud.user && ((ST.cloud.member && ST.cloud.member.nick) || ST.cloud.user.globalName || ST.cloud.user.username)) || L("Me");
  for (const d of ST.absences || []) add(d, myName);
  Object.values(out).forEach(l => l.sort((x, y) => x.localeCompare(y)));
  return out;
}
// Fait défiler jusqu'à la semaine qui contient le 1er du mois
function calScrollTo(v) {
  v = calClamp(v);
  const box = $("#calWeeks"), d1 = new Date(Math.floor(v / 100), v % 100, 1, 12);
  const cell = box && box.querySelector(`.day[data-day="${d1.getTime() / 1000}"]`);
  if (cell) box.scrollTop = cell.parentElement.offsetTop - box.offsetTop;
}
// Mois de la ligne du haut : titre de la sous-barre
function calScrolled() {
  const box = $("#calWeeks");
  if (!box || UI.page !== "calendar") return;
  const rows = box.children, top = box.scrollTop + 4;
  let row = rows[0];
  for (const r of rows) { if (r.offsetTop - box.offsetTop <= top) row = r; else break; }
  if (!row) return;
  // le mois qui occupe le plus la ligne du haut et la suivante (celui du jeudi de la 2e ligne visible)
  const next = row.nextElementSibling || row;
  UI.calVisible = +next.dataset.wm;
  const [y, m] = calMonth();
  $("#subTitle").textContent = new Date(y, m, 1).toLocaleString(LOC(), { month: "long", year: "numeric" });
}

// Sélecteur de mois : années empilées (en-tête + 3 x 4 mois), défilement vertical
let pickerTimer = null;
const MONTHS2_EN = ["Ja", "Fe", "Ma", "Ap", "Ma", "Ju", "Ju", "Au", "Se", "Oc", "No", "De"];
const MONTHS2_FR = ["Ja", "Fé", "Ma", "Av", "Ma", "Jn", "Jl", "Ao", "Se", "Oc", "No", "Dé"];
const MONTHS2 = new Proxy([], { get: (_, k) => (LANG === "fr" ? MONTHS2_FR : MONTHS2_EN)[k] });
function showPicker() {
  if (UI.page === "members" || UI.page === "craft") return;
  if (UI.page === "loots") return showLootWeekList();
  if (UI.page === "comps") return showLockoutList();
  if (UI.page === "assigns") return showAssignCompList();
  let y, m;
  if (UI.page === "comps") { const d = new Date((currentWeek() + 3 * DAY) * 1000); y = d.getFullYear(); m = d.getMonth(); }
  else [y, m] = calMonth();
  // années à partir de 2026 ; mois hors calendrier (avant octobre 2026, après 12 mois) grisés
  const nowD = new Date(), y0 = Math.floor(CAL_MIN / 100), y1 = Math.floor(calMax() / 100);
  let html = "";
  for (let yy = y0; yy <= y1; yy++) {
    html += `<div class="pyear" data-year="${yy}"><b>${yy}</b><div class="pgrid">`;
    for (let mm = 0; mm < 12; mm++) {
      const v = yy * 100 + mm, off = v < CAL_MIN || v > calMax();
      const cls = (yy === y && mm === m ? " sel" : "") + (yy === nowD.getFullYear() && mm === nowD.getMonth() ? " now" : "") + (off ? " off" : "");
      html += `<button class="pm${cls}" data-pick="${v}"${off ? " disabled" : ""}>${MONTHS2[mm]}</button>`;
    }
    html += "</div></div>";
  }
  const p = $("#picker"), t = $("#subTitle").getBoundingClientRect();
  p.style.width = "";
  p.innerHTML = html;
  p.hidden = false;
  p.style.left = t.left + t.width / 2 - p.offsetWidth / 2 + "px";
  p.style.top = t.bottom + 4 + "px";
  const target = p.querySelector(`[data-year="${y}"]`);
  if (target) p.scrollTop += target.getBoundingClientRect().top - p.getBoundingClientRect().top - 6;
}
// Mois / lockout / compo précédent (-1), suivant (1) ou actuel (0) ; sélecteur ouvert : il suit
function navStep(dir) {
  if (UI.page === "loots") {
    // lockouts du passé jusqu'à l'actuel ; après l'actuel : « All »
    const thisWeek = weekStart(now());
    if (dir === 0) UI.lootWeek = thisWeek;
    else if (dir < 0) UI.lootWeek = UI.lootWeek ? UI.lootWeek - WEEK : thisWeek;
    else if (UI.lootWeek) UI.lootWeek = UI.lootWeek + WEEK > thisWeek ? null : UI.lootWeek + WEEK;
    const open = !$("#picker").hidden;
    render();
    if (open) showPicker();
    return;
  }
  if (UI.page === "assigns") assignNav(dir);
  else if (UI.page === "calendar") {
    // calendrier continu : défile jusqu'au mois précédent / suivant / actuel
    const [y, m] = dir ? calMonth() : [new Date().getFullYear(), new Date().getMonth()], d = new Date(y, m + dir, 1);
    UI.calJump = calClamp(d.getFullYear() * 100 + d.getMonth());
  } else if (UI.page === "comps") { UI.week = dir ? currentWeek() + dir * WEEK : weekStart(now()); UI.selected = null; addState = null; }
  else return;
  const open = !$("#picker").hidden;
  render();
  if (open) showPicker();
}
// menu du jour : Entrée = étape suivante / enregistrer, Échap = annuler ; saisie gardée si le calendrier est redessiné
document.addEventListener("keydown", e => {
  const el = e.target.closest && e.target.closest(".dinput");
  if (!el || !calAct) return;
  if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); calAct = null; renderCalendar(); }
  else if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); calEnter(el); }
}, true);
document.addEventListener("input", e => {
  const el = e.target.closest && e.target.closest(".dinput");
  if (el && calAct) calAct[el.dataset.dstep] = el.value;
});
// heure de l'event : molette = +/- 30 min (00:00 … 23:59)
document.addEventListener("wheel", e => {
  const b = e.target.closest && e.target.closest("[data-dtime]");
  if (!b || !calAct) return;
  e.preventDefault();
  let i = TIMES.indexOf(calAct.min);
  if (i < 0) i = TIMES.indexOf(1230);
  i = Math.max(0, Math.min(TIMES.length - 1, i + (e.deltaY < 0 ? 1 : -1)));
  calAct.min = TIMES[i];
  b.querySelector("b").textContent = hhmm(calAct.min);
}, { passive: false });
// molette sur le titre : élément précédent / suivant, jamais avant la semaine actuelle (Raid Comps, Assigns)
$("#subTitle").addEventListener("wheel", e => {
  e.preventDefault();
  const dir = e.deltaY < 0 ? -1 : 1, thisWeek = weekStart(now());
  if (dir < 0 && UI.page === "comps" && currentWeek() - WEEK < thisWeek) return;
  // Compos et Loots : la molette saute les lockouts sans event (sans loot)
  if (UI.page === "comps" || UI.page === "loots") return wheelWeek(dir, thisWeek);
  if (dir < 0 && UI.page === "assigns") {
    const list = assignComps(), i = list.findIndex(x => x.comp.id === UI.aComp);
    if (i <= 0 || list[i - 1].ws < thisWeek) return;
  }
  navStep(dir);
}, { passive: false });
function wheelWeek(dir, thisWeek) {
  const open = !$("#picker").hidden;
  if (UI.page === "comps") {
    const evs = sortedEvents(), last = Math.max(thisWeek, evs.length ? weekStart(evs[evs.length - 1].start) : thisWeek);
    let ws = currentWeek() + dir * WEEK;
    while (ws >= thisWeek && ws <= last && !eventsInWeek(ws).length) ws += dir * WEEK;
    if (ws < thisWeek || ws > last) return;
    UI.week = ws; UI.selected = null; addState = null;
  } else {
    // jamais dans le futur ; « All » après le lockout actuel
    const has = new Set((ST.lootDB || []).map(r => weekStart(r.t || 0)).filter(w => w <= thisWeek));
    const oldest = Math.min(thisWeek, ...has);
    let w = UI.lootWeek;
    if (dir < 0) {
      w = w ? w - WEEK : thisWeek;
      while (w >= oldest && !has.has(w)) w -= WEEK;
      if (w < oldest) return;
      UI.lootWeek = w;
    } else if (w) {
      w += WEEK;
      while (w <= thisWeek && !has.has(w)) w += WEEK;
      UI.lootWeek = w <= thisWeek ? w : null;
    }
  }
  render();
  if (open) showPicker();
}
function pickMonth(v) {
  const y = Math.floor(v / 100), m = v % 100;
  if (UI.page === "comps") { UI.week = weekStart(new Date(y, m, 1, 12).getTime() / 1000); UI.selected = null; addState = null; }
  else UI.calJump = calClamp(v);
  $("#picker").hidden = true;
  render();
}
function openWeek(ts, eventId) {
  UI.week = weekStart(ts + 3600);
  UI.selected = null;
  addState = null;
  if (eventId) {
    const c = weekComps().filter(canSeeComp).find(x => x.event === eventId);
    if (c) UI.selected = c.id;
  }
  UI.page = "comps";
  render();
}

// ---------- Members
// nom Discord affiché d'un joueur (tag) : celui de sa dernière inscription Raid-Helper
let tagNamesST = null, tagNamesMap = {};
function tagNames() {
  if (tagNamesST === ST) return tagNamesMap;
  const names = {}, when = {};
  for (const ev of ST.events) for (const s of ev.signups) {
    if (s.tag && s.n && (ev.start || 0) >= (when[s.tag] || 0)) { names[s.tag] = s.n; when[s.tag] = ev.start || 0; }
  }
  tagNamesST = ST; tagNamesMap = names;
  return names;
}
const discordName = u => (u.tag && tagNames()[u.tag]) || (u.tag ? "@" + u.tag : "");
const discordOf = name => { const tag = (ST.roster[name] || {}).tag; return tag ? (tagNames()[tag] || "@" + tag) : ""; };
// perso retiré de la base partagée (caché par son joueur ou supprimé par un officier) : plus montré
const charGone = name => !!(ST.charGone || {})[name];
function memberUnits() {
  // joueurs pas liés par l'appli : un perso « Nom Discord Classe » par inscription à l'Event Class (réglage Admin)
  const extra = [], seen = new Set();
  for (const s of classEventEntries().unlinked) {
    const key = "~" + s.n + "#" + s.c;
    if (seen.has(key) || charGone(key)) continue;
    seen.add(key);
    extra.push({ name: key, display: `${s.n} ${L(CLASS_NAME[s.c] || s.c)}`, class: s.c, level: 0, tag: s.tag || null, uid: s.uid || null, discord: s.n,
                 specs: s.s ? [s.s] : [], spec: s.s || null, role: roleOf(s.c, s.s), info: null, notLinked: true });
  }
  return memberRoster().concat(extra);
}
function memberRoster() {
  const names = tagNames(), owners = ST.charOwners || {};
  // roster scanné en jeu + persos partagés via l'appli qui n'y sont pas encore (nouveau membre, roster pas rescanné)
  const rows = Object.entries(ST.roster).filter(([name, r]) => r && r.c);
  for (const [name, o] of Object.entries(owners)) if (!ST.roster[name] && o && o.c) rows.push([name, { c: o.c, l: o.l, owner: o }]);
  return rows.filter(([name]) => !charGone(name)).map(([name, r]) => {
    // spé de référence (tri, loot...) : Event Class (exe), sinon charSpec ; spés affichées : celles relevées dans les talents
    const info = ST.chars[name], detected = talentSpecs(r.c, info);
    const spec = (ST.mainSpecs || {})[name] || charSpec(name) || detected[0] || null;
    const o = owners[name];
    return { name, display: name, class: r.c, level: r.l || 0, tag: r.tag || null, discord: (r.tag && names[r.tag]) || (o && o.name) || null,
             specs: detected.length ? detected : spec ? [spec] : [], spec, role: roleOf(r.c, spec), info };
  });
}
// Spés relevées dans les talents du perso (arbre le plus rempli de chaque spé de talents, l'active d'abord, sans doublon)
function talentSpecs(cls, info) {
  const names = TALENT_SPECS[cls], out = [];
  if (!names) return out;
  const specs = asList(info && info.talents).slice().sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0));
  for (const sp of specs) {
    const pts = asList(sp.tabs).map(t => +(t && t.p) || 0), m = Math.max(0, ...pts);
    const s = m > 0 && names[pts.indexOf(m)];
    if (s && !out.includes(s) && out.length < 2) out.push(s);
  }
  return out;
}
// Nom Forever « Prénom Nom » : le nom de famille plus discret (gris, normal, plus petit)
// short (compos, liste) : seulement l'initiale du nom de famille (« Sundance P. »)
function nameHtml(display, short) {
  const s = String(display || ""), k = s.indexOf(" ");
  if (k < 0) return esc(s);
  const sur = s.slice(k + 1);
  return `${esc(s.slice(0, k))} <span class="sur">${esc(short ? [...sur][0] + "." : sur)}</span>`;
}
function itemInfo(id) {
  const k = String(id), sv = ST.svItems[k] || ST.svItems[id], wh = ST.items[k];
  return { name: (sv && sv.n) || (wh && wh.n) || `Item ${id}`, q: (sv && sv.q) ?? (wh && wh.q), icon: wh && wh.icon,
           ilvl: (sv && sv.l) || (wh && wh.l), tt: wh && wh.tt };
}
// Charge depuis Wowhead (Forever, sinon Classic) les objets / sorts inconnus ou de l'ancien cache sans infobulle,
// une seule tentative par session, puis réaffiche
const whTried = new Set(), whLoading = {};
function ensureWowhead(kind, ids, fetch) {
  const store = ST[kind] = ST[kind] || {};
  const missing = [...new Set(ids.map(String))].filter(k => !whTried.has(kind + k) && (!store[k] || !("tt" in store[k])));
  if (!missing.length || whLoading[kind]) return;
  whLoading[kind] = true;
  missing.slice(0, 40).forEach(k => whTried.add(kind + k));
  fetch(missing.slice(0, 40)).then(res => { Object.assign(store, res); whLoading[kind] = false; render(); });
}
const ensureItems = ids => ensureWowhead("items", ids, x => api().item_info(x));
const ensureSpells = ids => ensureWowhead("spells", ids, x => api().spell_info(x));
// Infobulle Wowhead nettoyée : texte et mise en forme seulement (pas de liens, scripts ni images)
function whTipHtml(html) {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  doc.querySelectorAll("script,style,iframe,img,.whtt-sellprice,.whtt-extra").forEach(n => n.remove());
  doc.querySelectorAll("a").forEach(a => a.replaceWith(...a.childNodes));
  doc.querySelectorAll("*").forEach(n => [...n.attributes].forEach(at => { if (at.name !== "class" && at.name !== "width") n.removeAttribute(at.name); }));
  return `<div class="wtt">${doc.body.firstChild.innerHTML}</div>`;
}
// Icônes des métiers par nom (anglais / français)
const PROF_ICON = { Alchemy: "trade_alchemy", Blacksmithing: "trade_blacksmithing", Enchanting: "trade_engraving", Engineering: "trade_engineering",
  Herbalism: "trade_herbalism", Leatherworking: "trade_leatherworking", Mining: "trade_mining", Skinning: "inv_misc_pelt_wolf_01",
  Tailoring: "trade_tailoring", Cooking: "inv_misc_food_15", "First Aid": "spell_holy_sealofsacrifice", Fishing: "trade_fishing",
  Alchimie: "trade_alchemy", Forge: "trade_blacksmithing", Enchantement: "trade_engraving", "Ingénierie": "trade_engineering",
  Herboristerie: "trade_herbalism", "Travail du cuir": "trade_leatherworking", Minage: "trade_mining", "Dépeçage": "inv_misc_pelt_wolf_01",
  Couture: "trade_tailoring", Cuisine: "inv_misc_food_15", Secourisme: "spell_holy_sealofsacrifice", "Pêche": "trade_fishing" };
const ICON_URL = (name, size) => `https://wow.zamimg.com/images/wow/icons/${size || "small"}/${name}.jpg`;
// Objet d'un emplacement : un tableau Lua qui commence au slot 1 est écrit sans clés ({nil, nil, nil, 45, …})
// et arrive ici en liste indexée à partir de 0 ; sinon objet {slot: id}
const slotItem = (g, slot) => !g ? null : Array.isArray(g) ? g[slot - 1] : (g[slot] || g[String(slot)]);
function detailHtml(u) {
  const gear = u.info && u.info.gear, ids = [];
  // disposition de la fenêtre de personnage : colonne gauche, colonne droite, armes en bas
  const icon = slot => {
    const id = slotItem(gear, slot);
    if (!id) return `<div class="it empty" title="${GEAR_NAMES[slot] || ""}"></div>`;
    ids.push(id);
    const it = itemInfo(id);
    return `<div class="it" data-item="${id}" data-gc="${esc(u.name)}" data-gs="${slot}" style="--q:${QUALITY_COLOR[it.q] || "#383a43"};${it.icon ? `background-image:url('https://wow.zamimg.com/images/wow/icons/medium/${it.icon}.jpg')` : ""}"></div>`;
  };
  const g = `<div class="pcol">${GEAR_LEFT.map(icon).join("")}</div><div class="pmid"></div><div class="pcol">${GEAR_RIGHT.map(icon).join("")}</div><div class="pbot">${GEAR_BOTTOM.map(icon).join("")}</div>`;
  const note = gear ? L("Updated {0}", new Date((u.info.gearT || 0) * 1000).toLocaleString(LOC(), { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })) : L("No gear data yet: this player has not logged in with Guild Tool.");
  const loot = ST.loot ? (ST.loot[u.name] || []) : null;
  let l = "";
  for (const e of loot || []) {
    if (e.itemID) ids.push(e.itemID);
    const it = e.itemID ? itemInfo(e.itemID) : { name: e.name };
    l += `<div class="lrow"><span class="mute">${esc(e.date || "")}</span><span class="it" data-item="${e.itemID || ""}" style="color:${QUALITY_COLOR[it.q] || "#fff"}">${it.icon ? `<img src="https://wow.zamimg.com/images/wow/icons/small/${it.icon}.jpg" alt="">` : ""}${esc(e.name || it.name)}</span><span>${esc(e.response || "")}</span><span class="mute">${esc((e.boss || "") + (e.instance ? " · " + e.instance : ""))}</span></div>`;
  }
  if (!l) l = `<div class="mute">${L(loot ? "No loot recorded for this character." : "RCLootCouncil is not installed or has no history yet.")}</div>`;
  // sets du gestionnaire d'équipement
  const sets = asList(u.info && u.info.sets);
  const smallIcon = id => {
    ids.push(id);
    const it = itemInfo(id);
    return `<span class="sit" data-item="${id}" style="--q:${QUALITY_COLOR[it.q] || "#383a43"};${it.icon ? `background-image:url('https://wow.zamimg.com/images/wow/icons/small/${it.icon}.jpg')` : ""}"></span>`;
  };
  const setsHtml = sets.length ? sets.map(s => {
    const line = slots => slots.map(slot => slotItem(s.g, slot)).filter(Boolean).map(smallIcon).join("");
    const l2 = [[2], [11, 12], [13, 14], [16, 17, 18]].map(line).filter(Boolean).join('<span class="sgap"></span>');
    return `<div class="mset"><b>${esc(s.n)}</b><div>${line(SET_LINE1)}</div>${l2 ? `<div>${l2}</div>` : ""}</div>`;
  }).join("") : `<div class="mute">${L(u.info ? "No equipment set saved (character frame, equipment manager)." : "No data yet: this player has not logged in with Guild Tool.")}</div>`;
  ensureItems(ids);
  // seulement les talents (plus d'historique RCLootCouncil ni de recettes), spé 1 / spé 2 au choix
  const right = talentsHtml(u);
  // image de fond choisie par le joueur (ses persos) ; les autres peuvent la cacher (case à cocher, ce perso seulement)
  const mine = (ST.myChars || []).some(c => c.name === u.name), img = !(ST.appearance || {}).charImgOff && (ST.charImages || {})[u.name];
  const hidden = (UI.hideCharImg || {})[u.name];
  const ctl = mine
    ? `<button class="btn small" data-charpic="${esc(u.name)}" data-help="Choose a background picture for this character (shared with the guild)">${L("Picture")}</button>${img ? `<button class="ib" data-charpicdel="${esc(u.name)}" data-help="Remove the picture">×</button>` : ""}`
    : img ? `<label class="mchk" data-help="Hide the picture chosen by this player for this character"><input type="checkbox" data-charpichide="${esc(u.name)}"${hidden ? " checked" : ""}>${L("Hide picture")}</label>` : "";
  return `<div class="mdetail" style="--c:${TREE_TINT[u.class] || CLASS_COLOR[u.class] || "#9a9ea9"}">${img && !hidden ? `<div class="mdbg" style="background-image:url('${img}')"></div>` : ""}
    <div class="mdctl">${ctl}</div>
    <div><h4>${L("Last known gear")}</h4><div class="paper">${g}</div><div class="gnote">${note}</div></div>
    <div><h4>${L("Equipment sets")} · ${sets.length}</h4><div class="msets">${setsHtml}</div></div>
    <div class="tpanel">${right}</div>${attendanceHtml(u)}</div>`;
}
// Recettes connues, par métier (lues en jeu à l'ouverture de la fenêtre du métier)
function recipesHtml(u) {
  const rec = (u.info && u.info.recipes) || {};
  const profs = Object.keys(rec).sort();
  if (!profs.length) return `<div class="mute">${L("No recipes yet: the player must open each profession window once in game.")}</div>`;
  const ids = [];
  const html = profs.map(p => {
    const list = asList(rec[p]).slice().sort((a, b) => (a.n || "").localeCompare(b.n || ""));
    return `<div class="mrec"><h4>${PROF_ICON[p] ? `<img class="pfh" src="${ICON_URL(PROF_ICON[p])}" alt="">` : ""}${esc(p)} · ${list.length}</h4><div>${list.map(r => {
      if (r.id) ids.push(r.id);
      const it = r.id ? itemInfo(r.id) : {};
      return `<span class="rcp"${r.id ? ` data-item="${r.id}" style="color:${QUALITY_COLOR[it.q] || "#fff"}"` : ""}>${it.icon ? `<img src="https://wow.zamimg.com/images/wow/icons/small/${it.icon}.jpg" alt="">` : ""}${esc(r.n)}</span>`;
    }).join("")}</div></div>`;
  }).join("");
  ensureItems(ids.slice(0, 40));
  return `<div class="mrecs">${html}</div>`;
}
let memberSpec = null;   // spé affichée dans le détail (null = l'active)

// Présence : raids 20 joueurs des compos visibles (Main et communautaires) où le perso est placé, au jour de leur event ;
// total = tous les persos du même joueur (même tag Discord)
function attendanceIndex() {
  const out = {};
  const comps = Object.values(ST.weeks || {}).flatMap(w => w.comps || []).concat(ccompList());
  for (const c of comps) {
    if (!c.valid || c.deleted) continue;
    const raid = raidByKey(c.raid);
    if (!raid || +raid.size !== 20) continue;
    const ev = c.event && eventById(c.event);
    const t = ev ? ev.start : null;
    if (!t) continue;
    for (const n of new Set(Object.values(c.c || {}))) if (n) (out[n] = out[n] || []).push({ t, id: c.id });
  }
  return out;
}
let ATT = null;
// Phases (présence) : une phase commence le vendredi du lockout de son premier raid enregistré ; la précédente
// s'arrête ce jour-là (exclu)
function attPhaseRange(i) {
  const first = PHASES.map(() => null);
  const comps = Object.values(ST.weeks || {}).flatMap(w => w.comps || []).concat(ccompList());
  for (const c of comps) {
    if (!c.valid || c.deleted) continue;
    const pi = PHASES.findIndex(p => p.raids.some(r => r.key === c.raid)), ev = c.event && eventById(c.event);
    if (pi >= 0 && ev && ev.start && (first[pi] === null || ev.start < first[pi])) first[pi] = ev.start;
  }
  const start = first.map((t, k) => k === 0 ? -Infinity : t === null ? null : weekStart(t) + 2 * 86400);
  if (start[i] === null) return null;
  const next = start.slice(i + 1).find(t => t !== null);
  return [start[i], next === undefined ? Infinity : next];
}
// phase = null / undefined : toutes (colonne Attendance, tri) ; le sélecteur de phase du détail ne vaut que pour le détail
const attInPhase = (t, phase) => {
  if (phase === null || phase === undefined) return true;
  const r = attPhaseRange(phase);
  return !!r && t >= r[0] && t < r[1];
};
function attendanceOf(u, phase) {
  ATT = ATT || attendanceIndex();
  const mine = (ATT[u.name] || []).filter(x => attInPhase(x.t, phase));
  const alts = u.tag ? memberUnits().filter(x => x.tag === u.tag).map(x => x.name) : [u.name];
  const ids = new Set();
  for (const n of alts) for (const x of ATT[n] || []) if (attInPhase(x.t, phase)) ids.add(x.id);
  return { list: mine, n: mine.length, total: Math.max(ids.size, mine.length) };
}
function attendanceHtml(u) {
  const a = attendanceOf(u, UI.attPhase), all = (ATT[u.name] || []), days = new Set(a.list.map(x => lootYmd(x.t)));
  const nowD = new Date(), first = all.length ? new Date(Math.min(...all.map(x => x.t)) * 1000) : nowD;
  let html = "", y = first.getFullYear(), m = first.getMonth(), k = 0;
  // un mois par bloc, du mois du premier raid au mois actuel (défile, le mois actuel en bas)
  while (y < nowD.getFullYear() || (y === nowD.getFullYear() && m <= nowD.getMonth())) {
    const d0 = new Date(y, m, 1), lead = (d0.getDay() + 6) % 7, nd = new Date(y, m + 1, 0).getDate();
    let cells = "";
    for (let i = 0; i < lead; i++) cells += "<span></span>";
    for (let d = 1; d <= nd; d++) {
      const k = y * 10000 + (m + 1) * 100 + d;
      cells += `<span class="${days.has(k) ? "on" : ""}">${d}</span>`;
    }
    html += `<div class="attm ${k++ % 2 ? "mb" : "ma"}"><b>${d0.toLocaleDateString(LOC(), { month: "long", year: "numeric" })}</b><div class="attg">${cells}</div></div>`;
    if (++m > 11) { m = 0; y++; }
  }
  // phase des compteurs : un bouton par phase puis « All », le choisi en blanc ; seulement pour ces compteurs
  const cur = UI.attPhase === null || UI.attPhase === undefined ? PHASES.length : UI.attPhase;
  let ph = "";
  for (let d = -2; d <= 2; d++) {
    const i = cur + d;
    ph += i >= 0 && i <= PHASES.length ? `<button class="aphb${i === cur ? " on" : ""}" data-attph="${i}">${i === PHASES.length ? L("All") : i + 1}</button>` : '<span class="aphb ph0"></span>';
  }
  return `<div class="matt"><h4 data-help="20-player raids: this character (all his characters)">${L("Attendance")} · <b>${a.n}</b> <span class="mute">(${a.total})</span></h4>
    <div class="attph" data-help="Phase of the attendance counts (only this tab)"><span>${L("Phase")}</span>${ph}</div><div class="attcal">${html}</div></div>`;
}
// teinte des arbres de talents (couleur de classe ; prêtre : blanc cassé, moins lumineux)
const TREE_TINT = { PRIEST: "#b9b4a7" };
// rôle de chaque arbre de talents (ordre de la fenêtre de talents)
const TREE_ROLE = { WARRIOR: ["Melee", "Melee", "Tank"], PALADIN: ["Healer", "Tank", "Melee"], HUNTER: ["Ranged", "Ranged", "Ranged"],
  ROGUE: ["Melee", "Melee", "Melee"], PRIEST: ["Healer", "Healer", "Ranged"], SHAMAN: ["Ranged", "Melee", "Healer"],
  MAGE: ["Ranged", "Ranged", "Ranged"], WARLOCK: ["Ranged", "Ranged", "Ranged"], DRUID: ["Ranged", "Tank", "Healer"] };
const SET_LINE1 = [1, 3, 15, 5, 9, 10, 6, 7, 8];
function setAttPhase(i) {
  i = Math.max(0, Math.min(PHASES.length, i));
  UI.attPhase = i >= PHASES.length ? null : i;
  render();
}
document.addEventListener("click", e => { const b = e.target.closest && e.target.closest("[data-attph]"); if (b) { e.stopPropagation(); setAttPhase(+b.dataset.attph); } });
// Members : clic sur le titre d'une colonne = ce critère passe en tête de la priorité de tri
document.addEventListener("click", e => {
  const h = e.target.closest && e.target.closest("#page-members .mhead [data-msort]");
  if (!h) return;
  UI.membersOrder = [h.dataset.msort, ...UI.membersOrder.filter(k => k !== h.dataset.msort)];
  saveUI(); render();
});
document.addEventListener("wheel", e => {
  const w = e.target.closest && e.target.closest(".attph");
  if (!w) return;
  e.preventDefault();
  setAttPhase((UI.attPhase === null || UI.attPhase === undefined ? PHASES.length : UI.attPhase) + (e.deltaY < 0 ? -1 : 1));
}, { passive: false });

// listes venues du Lua : tableau ou objet {1: …, 2: …}
const asList = v => Array.isArray(v) ? v.filter(Boolean) : v && typeof v === "object" ? Object.keys(v).sort((a, b) => a - b).map(k => v[k]) : [];

// Place des talents relevés : référence de Wowhead (web/talentref.js, par n° de sort : arbre, rangée, colonne,
// prérequis) ; le jeu garde des nœuds fantômes hors de la grille (doublons d'anciens talents) : un seul talent par
// case (le plus avancé), talents inconnus de la référence à leur place relevée (au-delà de maxRow : ignorés).
// -> [{ n, icon, p, cells: [{ ...talent, row, col, req: [rangée, colonne] }] }] x3
function placeTalents(cls, tabs, maxRow) {
  const ref = (typeof TALENT_REF !== "undefined" && TALENT_REF[cls]) || null;
  const out = (ref ? ref.trees : tabs.map(t => [t.n, null])).map((tr, i) => ({ n: tr[0] || (tabs[i] || {}).n || "?", icon: tr[1], p: 0, byCell: {} }));
  tabs.forEach((tab, ti) => {
    for (const t of asList(tab.t)) {
      const pos = ref && t.s ? ref.s[String(t.s)] : null;
      const tree = pos ? pos[0] - 1 : ti, row = pos ? pos[1] : t.row, col = pos ? pos[2] : t.col;
      if (!out[tree] || !row || row > maxRow) continue;
      const k = row + ":" + col, cur = out[tree].byCell[k];
      if (cur && (cur.r || 0) >= (t.r || 0)) continue;
      out[tree].byCell[k] = { ...t, row, col, req: pos && pos[4] ? [pos[4], pos[5]] : null };
    }
  });
  return out.map(t => { const cells = Object.values(t.byCell); return { n: t.n, icon: t.icon, p: cells.reduce((a, c) => a + (c.r || 0), 0), cells }; });
}
// Flèches des prérequis (comme la fenêtre de talents) : de la case du prérequis vers le talent, d'abord à
// l'horizontale puis à la verticale ; dorées une fois le talent pris
function talentArrows(cells, rows) {
  const S = 32, H = 14, w = 4 * S - 4, h = rows * S - 4;
  const at = (r, c) => cells.find(x => x.row === r && x.col === c);
  let p = "";
  for (const c of cells) {
    if (!c.req) continue;
    const [rr, rc] = c.req;
    if (!at(rr, rc)) continue;
    const x1 = (rc - 1) * S + H, y1 = (rr - 1) * S + H, x2 = (c.col - 1) * S + H, y2 = (c.row - 1) * S + H;
    const on = (c.r || 0) > 0 ? " on" : "";
    let d;
    if (rr === c.row) d = `M${x1 + (x2 > x1 ? H : -H)} ${y1}H${x2 + (x2 > x1 ? -H - 3 : H + 3)}`;
    else if (rc === c.col) d = `M${x1} ${y1 + H}V${y2 - H - 3}`;
    else d = `M${x1 + (x2 > x1 ? H : -H)} ${y1}H${x2}V${y2 - H - 3}`;
    p += `<path class="tarr${on}" d="${d}" marker-end="url(#${on ? "tahOn" : "tah"})"/>`;
  }
  if (!p) return "";
  const mk = (id, cls) => `<marker id="${id}" viewBox="0 0 6 6" refX="3" refY="3" markerWidth="3.2" markerHeight="3.2" orient="auto"><path class="${cls}" d="M0 0L6 3L0 6z"/></marker>`;
  return `<svg class="tarrows" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>${mk("tah", "tahd")}${mk("tahOn", "tahd on")}</defs>${p}</svg>`;
}

// Talents des deux spés : 3 arbres par spé (grille de 4 colonnes sur 7 rangs), rang / max dans chaque case
// arbres vides de la classe (tous les talents à 0) : perso dont les talents n'ont pas encore été relevés
function emptyTalents(cls) {
  const ref = (typeof TALENT_REF !== "undefined" && TALENT_REF[cls]) || null;
  if (!ref) return [];
  const tabs = ref.trees.map(tr => ({ n: tr[0], t: [] }));
  for (const [s, pos] of Object.entries(ref.s)) {
    const sp = (ST.spells || {})[s];
    tabs[pos[0] - 1].t.push({ s: +s, r: 0, m: pos[3] || 1, n: (sp && sp.n) || "", row: pos[1], col: pos[2] });
  }
  return [{ active: true, empty: true, tabs }];
}
function talentsHtml(u) {
  let specs = asList(u.info && u.info.talents);
  // pas encore relevés (perso vu par les autres, joueur sans Guild Tool) : arbres vides de sa classe
  const none = !specs.length;
  if (none) specs = emptyTalents(u.class);
  if (!specs.length) return `<div class="mute">${L("No talents yet: this player has not logged in with Guild Tool.")}</div>`;
  // icônes et infobulles des talents : sorts Wowhead (relevés Forever : n° de sort « s »)
  const sids = specs.flatMap(sp => asList(sp.tabs).flatMap(t => asList(t.t).map(x => x.s).filter(Boolean)));
  ensureSpells(sids);
  const sicon = s => { const sp = s && (ST.spells || {})[String(s)]; return sp && sp.icon; };
  // une spé à la fois : boutons Spec 1 / Spec 2 (Spec 2 grisé si aucune 2e spé relevée)
  let cur = memberSpec !== null && memberSpec < specs.length ? memberSpec : specs.findIndex(s => s.active);
  if (cur < 0) cur = 0;
  const roleIco = sp => {
    const pts = asList(sp.tabs).map(t => t.p || 0), m = Math.max(0, ...pts);
    const ro = m > 0 && (TREE_ROLE[u.class] || [])[pts.indexOf(m)];
    return ro ? `<img class="msrole" src="${ROLE_ICON[ro]}" alt="" title="${esc(L(ro))}">` : "";
  };
  const TALENT_MAX_ROW = 9;   // arbres de Forever : 7 rangées
  const btns = [0, 1].map(i => i < specs.length
    ? `<button data-mspec="${i}" class="${i === cur ? "on" : ""}">${roleIco(specs[i])}${L("Spec {0}", i + 1)}${specs[i].empty ? ` <small>(${L("not read yet")})</small>` : specs[i].active ? ` <small>(${L("active")})</small>` : ""}</button>`
    : `<button class="off" disabled>${L("Spec {0}", i + 1)} <small>(${L("none")})</small></button>`).join("");
  const note = "";
  return `<div class="mtabs">${btns}${note}</div><div class="mspecs">${[specs[cur]].map((spec, k) => { const si = cur;
    const tabs = placeTalents(u.class, asList(spec.tabs), TALENT_MAX_ROW);
    const trees = tabs.map(t => {
      const cells = t.cells;
      const rows = Math.max(7, ...cells.map(c => c.row || 0));
      let grid = "";
      for (let r = 1; r <= rows; r++) for (let c = 1; c <= 4; c++) {
        const tal = cells.find(x => x.row === r && x.col === c);
        const ic = tal && sicon(tal.s);
        grid += tal ? `<span class="tal${tal.r > 0 ? " on" : ""}${tal.r > 0 && tal.r === tal.m ? " max" : ""}${ic ? " ico" : ""}"${tal.s ? ` data-spell="${tal.s}"` : ""} data-tname="${esc(tal.n)}" data-trank="${tal.r}/${tal.m}"${ic ? ` style="background-image:url('${ICON_URL(ic)}')"` : ""}>${ic ? "" : `<em>${esc(String(tal.n).split(" ").map(w => w[0]).join("").slice(0, 3))}</em>`}<i>${tal.r}/${tal.m}</i></span>` : "<span></span>";
      }
      return `<div class="ttree"><b>${t.icon ? `<img class="tico" src="${ICON_URL(t.icon)}" alt="">` : ""}${esc(t.n)} <small>${t.p || 0}</small></b>
        <div class="tgwrap">${talentArrows(cells, rows)}<div class="tgrid" style="grid-template-rows:repeat(${rows},28px)">${grid}</div></div></div>`;
    }).join("");
    return `<div class="mspec"><div class="ttrees">${trees}</div></div>`;
  }).join("")}</div>`;
}
// corbeille (officiers) : persos retirés depuis moins de 7 jours, remis par Restore
let memberTrash = false;
function renderTrash(trash) {
  $("#mCount").textContent = L("{0} characters in the trash · removed for good after 7 days", trash.length);
  let html = "";
  for (const [name, e] of trash) {
    const m = name.match(/^~(.*)#([A-Z]*)$/), cls = e.c || (m && m[2]) || (ST.roster[name] || {}).c || "";
    const days = Math.max(1, Math.ceil(e.left / 86400));
    html += `<div class="mrow trow" style="--c:${CLASS_COLOR[cls] || "#9a9ea9"}">
      <span class="cn">${cls ? `<img src="icons/class_${cls.toLowerCase()}.jpg" alt="">` : ""}<b>${nameHtml(m ? m[1] : name)}</b></span>
      <span class="dc mute">${esc(e.by ? L("Removed by {0}", e.by) : "")}</span>
      <span class="tl mute">${L(days > 1 ? "{0} days left" : "{0} day left", days)}</span>
      <span class="mx"><button class="mrestore" data-mrestore="${esc(name)}">${L("Restore")}</button></span></div>`;
  }
  $("#mList").innerHTML = html || `<div class="mute tempty">${L("The trash is empty.")}</div>`;
}
// Membres du serveur Discord sans perso identifié : en bas, sous un titre dépliable ; une ligne par joueur (nom
// Discord et rôle seulement, pas de détail). Liste du bot si elle est lue, sinon les joueurs connus de l'appli
function noCharHtml(list) {
  const withChars = new Set(list.map(socialId).filter(Boolean)), dm = ST.discordMembers || {};
  const players = (dm.players ? dm.players.map(p => ({ id: p.id, name: p.name || p.username })) : socialPlayers(true))
    .filter(p => !withChars.has(p.id));
  if (!players.length) return "";
  const byRole = UI.membersOrder.indexOf("drole") < UI.membersOrder.indexOf("discord");
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  players.sort((a, b) => (byRole ? discordRoleRank(a.id) - discordRoleRank(b.id) : 0) || byName(a, b) || discordRoleRank(a.id) - discordRoleRank(b.id));
  const open = !!UI.mNoCharOpen;
  let h = `<div class="mnoch${open ? " open" : ""}" data-mnochar="1"><i class="tri"></i>${L("Discord members without character")}<span class="n">${players.length}</span></div>`;
  if (open) for (const p of players) h += `<div class="mrow nochar"><span class="cn"></span><span class="dc">${esc(p.name)}</span><span class="lv"></span><span class="sp"></span><span class="at"></span><span class="pf"></span><span class="dr">${discordRoleHtml(p.id)}</span><span class="mx"></span></div>`;
  return h;
}
document.addEventListener("click", e => {
  if (!(e.target.closest && e.target.closest("[data-mnochar]"))) return;
  UI.mNoCharOpen = !UI.mNoCharOpen; saveUI(); renderMembers();
});
function renderMembers() {
  ATT = null;
  const trash = isOfficerUser() ? Object.entries(ST.charTrash || {}).sort((a, b) => b[1].t - a[1].t) : [];
  if (!trash.length) memberTrash = false;
  const tb = $("#mTrash");
  tb.hidden = !trash.length;
  tb.classList.toggle("on", memberTrash);
  tb.textContent = memberTrash ? L("Back to members") : L("Trash ({0})", trash.length);
  $("#page-members").classList.toggle("trash", memberTrash);
  if (memberTrash) { renderTrash(trash); return; }
  const list = memberUnits();
  sortUnits(list, UI.membersOrder, MCMP);
  document.querySelector('[data-chipbar="membersOrder"]').innerHTML = chipsHtml(UI.membersOrder);
  // titres de colonne : critère de tri en tête marqué
  document.querySelectorAll("#page-members .mhead [data-msort]").forEach(h => h.classList.toggle("on", h.dataset.msort === UI.membersOrder[0]));
  $("#mCount").textContent = L("{0} characters · {1} with Guild Tool data", list.length, list.filter(u => u.info).length);
  // pas de ligne d'en-tête par critère : l'ordre de la liste suffit ; officiers : croix pour retirer un perso de la base
  const off = isOfficerUser();
  document.body.classList.toggle("mdel-on", off);
  let html = "";
  for (const u of list) {
    const profs = u.info && u.info.profs && u.info.profs.length
      ? asList(u.info.profs).map(p => {
          const ic = PROF_ICON[p.n];
          return `<span class="pfi" data-prof="${esc(p.n)}" data-lvl="${p.r || 0} / ${p.m || "?"}">${ic ? `<img src="${ICON_URL(ic)}" alt="">` : esc(p.n)}<em>${p.r || 0}</em></span>`;
        }).join("") : '<span class="mute">-</span>';
    const cls = (u.class || "").toLowerCase();
    html += `<div class="mrow${expanded === u.name ? " open" : ""}" data-detail="${esc(u.name)}" style="--c:${CLASS_COLOR[u.class] || "#9a9ea9"}">
      <span class="cn">${cls ? `<img src="icons/class_${cls}.jpg" alt="">` : ""}<b>${nameHtml(u.display)}</b></span>
      <span class="dc${u.discord ? "" : " mute"}">${esc(u.discord || (u.tag ? "@" + u.tag : ""))}</span>
      <span class="lv">${u.level || ""}</span>
      <span class="sp">${u.specs.map(s => specImg(u, "", s)).join("")}</span>
      <span class="at">${(() => { const a = attendanceOf(u); return a.total ? `${a.n} <em>(${a.total})</em>` : '<span class="mute">-</span>'; })()}</span>
      <span class="pf">${profs}</span><span class="dr">${discordRoleHtml(socialId(u))}</span><span class="mx">${u.notLinked ? `<em class="nl" data-help="Signed up in the Event Class but no character linked through Guild Tool yet.">${L("Not linked")}</em>` : ""}${off ? `<button class="mdel" data-mdel="${esc(u.name)}" data-help="Remove this character from the shared database (everyone stops seeing it).">×</button>` : ""}</span></div>`;
    if (expanded === u.name) html += detailHtml(u);
  }
  html += noCharHtml(list);
  const box = $("#mList"), scroll = box.scrollTop;
  box.innerHTML = html;
  box.scrollTop = scroll;
  // présence : mois actuel visible (en bas)
  box.querySelectorAll(".attcal").forEach(e => { e.scrollTop = e.scrollHeight; });
  const tp = box.querySelector(".tpanel"), mt = box.querySelector(".matt");
  if (tp && mt) mt.style.height = tp.offsetHeight + "px";
}

// ------------------------------------------------------------------ tooltips, menus, toasts
function toast(text, err) {
  const t = $("#toast");
  t.textContent = text;
  t.onclick = null;
  t.className = "toast on" + (err ? " err" : "");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove("on"), err ? 5000 : 2400);
}
// Infobulles : toujours en bas à droite de la fenêtre ; élément survolé surtout dans la moitié droite : en bas à gauche
function showTip(html, el) {
  const tip = $("#tip"), r = el.getBoundingClientRect();
  tip.innerHTML = html;
  tip.hidden = false;
  const right = r.left + r.width / 2 > innerWidth / 2;
  const x = right ? 12 : innerWidth - tip.offsetWidth - 12, y = innerHeight - tip.offsetHeight - 12;
  tip.style.left = Math.max(8, x) + "px"; tip.style.top = Math.max(8, y) + "px";
}
const hideTip = () => { $("#tip").hidden = true; };
function unitTip(u) {
  let h = `<b style="color:${CLASS_COLOR[u.class] || "#fff"}">${esc(u.display)}</b>`;
  h += `<div class="p">${esc(((u.spec || "").replace(/\d+$/, "") + " " + L(CLASS_NAME[u.class] || "Unknown class")).trim())}</div>`;
  h += u.tag ? `<div style="color:#8f99ff">@${esc(u.tag)}</div>` : `<div class="ko">${L("No Discord tag in guild note")}</div>`;
  if (u.signed) h += `<div class="ok">Raid-Helper: ${L(STATUS_TEXT[u.status] || "Signed")} (${[...u.events].map(eventTitle).map(esc).join(", ")})</div>`;
  if (u.unlinked && u.tag) h += `<div class="ko">${esc(L("No level {0}+ {1} with @{2} in the guild roster.", ST.minLevel, L(CLASS_NAME[u.class] || ""), u.tag))}</div><div class="p">${L("Lower Min lvl in game, or check the guild note ({0} roster).", ST.slash || "/gt")}</div>`;
  else if (u.unlinked) h += `<div class="ko">${esc(L('Sign-up "{0}" not linked to a player. Right-click to link.', u.rhName))}</div>`;
  if (u.missing) h += `<div class="ko">${L("Not in the guild roster anymore")}</div>`;
  if (u.lock) h += `<div class="ko">${esc(L("Locked: already in {0} this lockout week.", compLabel(u.lock.comp)))}</div>`;
  if (u.already) h += `<div class="ko">${esc(u.already)}</div>`;
  return h;
}
function buffTip(el) {
  const [k, i, on, vk, one] = el.dataset.tip.split(":");
  const b = (k === "g" ? GROUP_BUFFS : k === "d" ? RAID_DEBUFFS : RAID_BUFFS)[+i];
  const v = buffVar(b, vk);
  const h = `<b>${esc(v.name)}</b><div class="e">${esc(L(one === "1" ? "Removes 1 buff" : b.effect))}</div>`;
  return h + (on === "1" ? `<div class="ok">${L("Active")}</div><div class="p">${L("Provided by:")} ${esc(L(b.provider))}</div>`
    : `<div class="ko">${L("Missing - brought by:")} ${esc(L(b.provider))}</div>`);
}
function itemTip(id) {
  const it = itemInfo(id);
  if (it.tt) return whTipHtml(it.tt);
  return `<b style="color:${QUALITY_COLOR[it.q] || "#fff"}">${esc(it.name)}</b>${it.ilvl ? `<div class="wq">${L("Item Level")} ${it.ilvl}</div>` : ""}<div class="p">${L("Item")} ${id}</div>`;
}
// Infobulle relevée en jeu sur l'objet porté (suffixe aléatoire, stats exactes, enchantements), sinon Wowhead
function gearTipHtml(el) {
  const c = ST.chars[el.dataset.gc];
  const lines = asList(slotItem(c && c.gearTip, +el.dataset.gs));
  if (!lines.length) return null;
  return `<div class="wtt gtt">${lines.map((x, i) => {
    const l = x.l ? `<span style="color:#${esc(x.c || "ffffff")}">${esc(x.l)}</span>` : "<span></span>";
    const r = x.r ? `<span style="color:#${esc(x.rc || "ffffff")}">${esc(x.r)}</span>` : "";
    return `<div class="gl${i === 0 ? " gn" : ""}">${l}${r}</div>`;
  }).join("")}</div>`;
}
function spellTip(id, el) {
  const sp = (ST.spells || {})[String(id)];
  const head = el && el.dataset.trank ? `<div class="wq">${L("Rank")} ${esc(el.dataset.trank)}</div>` : "";
  if (sp && sp.tt) return whTipHtml(sp.tt) + head;
  return `<b>${esc((el && el.dataset.tname) || (sp && sp.n) || "")}</b>${head}`;
}

function openMenu(anchor, items) {
  const m = $("#menu");
  m.innerHTML = items.map((it, i) => `<button data-mi="${i}" class="${it.on ? "on" : ""}${it.mute ? " mute" : ""}">${esc(it.text)}</button>`).join("");
  m.hidden = false;
  const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: anchor.x, bottom: anchor.y, width: 0 };
  m.style.minWidth = Math.max(170, r.width) + "px";
  let x = r.left, y = r.bottom + 2;
  if (x + m.offsetWidth > innerWidth - 4) x = innerWidth - m.offsetWidth - 4;
  if (y + m.offsetHeight > innerHeight - 4) y = Math.max(4, innerHeight - m.offsetHeight - 4);
  m.style.left = x + "px"; m.style.top = y + "px";
  m._items = items;
}
const closeMenu = () => { $("#menu").hidden = true; };

// Menu à colonnes (cases réservées : rôles | classes) ; clic = item, comme openMenu
function openColsMenu(anchor, cols) {
  const m = $("#menu"), items = [];
  m.innerHTML = `<div class="mcols">${cols.map(col => `<div class="mcol"><div class="mchead">${esc(col.title)}</div>${col.items.map(it => {
    items.push(it);
    return `<button data-mi="${items.length - 1}" class="micon${it.on ? " on" : ""}${it.mute ? " mute" : ""}"${it.color && !it.mute ? ` style="color:${it.color}"` : ""}>${it.icon ? `<img src="${it.icon}" alt="">` : ""}${esc(it.text)}</button>`;
  }).join("")}</div>`).join("")}</div>`;
  m.hidden = false;
  const r = anchor.getBoundingClientRect();
  m.style.minWidth = "0";
  let x = r.left, y = r.bottom + 2;
  if (x + m.offsetWidth > innerWidth - 4) x = innerWidth - m.offsetWidth - 4;
  if (y + m.offsetHeight > innerHeight - 4) y = Math.max(4, r.top - m.offsetHeight - 2);
  m.style.left = x + "px"; m.style.top = y + "px";
  m._items = items;
}
// Spé d'un perso dans CETTE compo seulement (comp.sp), parmi celles de sa classe
function compSpecMenu(el, comp, name) {
  const u = unitFor(name), cur = comp.sp && comp.sp[name];
  if (!SPECS[u.class]) return;
  // icône de la spé devant son nom
  const items = SPECS[u.class].map(([s]) => ({ text: L(s), icon: ST.specIcons[`${u.class}:${s}`], color: CLASS_COLOR[u.class],
    on: (cur || u.spec) === s, fn: () => { (comp.sp = comp.sp || {})[name] = s; commit(); } }));
  if (cur) items.push({ text: L("Usual spec"), mute: true, fn: () => { delete comp.sp[name]; commit(); } });
  openColsMenu(el, [{ title: L(CLASS_NAME[u.class] || ""), items }]);
}
// Case vide : la réserver pour un rôle ou une classe (pas compté comme un perso)
function phMenu(el, comp, slot) {
  const set = ph => () => { (comp.ph = comp.ph || {})[slot] = ph; commit(); };
  openColsMenu(el, [
    { title: L("Role"), items: ROLE_ORDER.map(r => ({ text: L(r), color: ROLE_COLOR[r], icon: ROLE_ICON[r], fn: set({ r }) })) },
    { title: L("Class"), items: CLASS_ORDER.map(k => ({ text: L(CLASS_NAME[k]), color: CLASS_COLOR[k], icon: `icons/class_${k.toLowerCase()}.jpg`, fn: set({ k }) })) },
  ]);
}
// Case réservée : spés de son rôle (toutes classes) ou de sa classe
function phSpecMenu(el, comp, slot) {
  const ph = comp.ph[slot], items = [];
  const add = (k, s) => items.push({ text: ph.r ? `${L(s)} ${L(CLASS_NAME[k])}` : L(s), color: CLASS_COLOR[k], icon: ST.specIcons[`${k}:${s}`],
    fn: () => { comp.ph[slot] = Object.assign({}, ph, { k, s }); commit(); } });
  for (const k of CLASS_ORDER) for (const [s, role] of SPECS[k] || []) {
    if (ph.r ? role === ph.r : k === ph.k) add(k, s);
  }
  if (ph.r && ph.k) items.push({ text: L("Any {0}", L(ph.r)), mute: true, fn: () => { comp.ph[slot] = { r: ph.r }; commit(); } });
  openColsMenu(el, [{ title: ph.r ? L(ph.r) : L(CLASS_NAME[ph.k] || ""), items }]);
}
function specMenu(at, u) {
  if (!SPECS[u.class]) return;
  const items = SPECS[u.class].map(([s, role]) => ({ text: `${s}  (${L(role)})`, on: u.spec === s, fn: () => api().set_spec(u.name, s).then(reload) }));
  items.push({ text: L("Clear spec"), mute: true, fn: () => api().set_spec(u.name, null).then(reload) });
  openMenu(at, items);
}

// ------------------------------------------------------------------ glisser-déposer (persos et critères de tri)
let pending = null, dragging = null, lastDrag = 0;
function chipInsertIndex(bar, key, x) {
  const chips = [...bar.querySelectorAll(".chip")].filter(c => c.dataset.chip !== key);
  let idx = 0;
  chips.forEach((c, i) => { const r = c.getBoundingClientRect(); if (x > r.left + r.width / 2) idx = i + 1; });
  return { idx, chips };
}
document.addEventListener("pointerdown", e => {
  if (e.button !== 0 || !$("#menu").hidden) return;
  const chip = e.target.closest("[data-chip]");
  const src = e.target.closest(".row[data-name], .slot[data-name]");
  if (chip) pending = { chip: chip.dataset.chip, bar: chip.closest("[data-chipbar]"), x: e.clientX, y: e.clientY, el: chip };
  else if (src && !e.target.closest(".lockbtn")) {
    let from = null;
    if (src.dataset.slot) { const [cid, s] = src.dataset.slot.split(":"); from = { comp: compById(cid), slot: +s }; }
    // compo modifiable (officier, ou créateur de l'event communautaire)
    if (from ? canEditComp(from.comp) : weekComps().some(canEditComp)) pending = { name: src.dataset.name, from, x: e.clientX, y: e.clientY };
  }
});
document.addEventListener("pointermove", e => {
  if (pending && !dragging && Math.hypot(e.clientX - pending.x, e.clientY - pending.y) > 4) {
    dragging = pending;
    hideTip();
    document.body.classList.add("dragging");
    if (dragging.chip) {
      dragging.el.classList.add("drag");
      const g = $("#chipGhost");
      g.textContent = L(SORT_LABEL[dragging.chip]);
      g.hidden = false;
      const line = document.createElement("span");
      line.className = "insert";
      dragging.bar.appendChild(line);
      dragging.line = line;
    } else {
      const u = unitFor(dragging.name), g = $("#ghost");
      g.innerHTML = `<span class="bar" style="background:${CLASS_COLOR[u.class] || "#9a9ea9"}"></span><span style="color:${CLASS_COLOR[u.class] || "#fff"}">${esc(u.display)}</span>`;
      g.hidden = false;
    }
  }
  if (!dragging) return;
  if (dragging.chip) {
    // le critère suit la souris ; la ligne lumineuse montre où il ira
    const g = $("#chipGhost");
    g.style.left = e.clientX - g.offsetWidth / 2 + "px"; g.style.top = e.clientY - 12 + "px";
    const { idx, chips } = chipInsertIndex(dragging.bar, dragging.chip, e.clientX);
    const barR = dragging.bar.getBoundingClientRect();
    const ref = chips[idx] ? chips[idx].getBoundingClientRect().left - 3 : chips[chips.length - 1].getBoundingClientRect().right + 2;
    dragging.line.style.left = ref - barR.left + "px";
    return;
  }
  const g = $("#ghost");
  g.style.left = e.clientX + 12 + "px"; g.style.top = e.clientY - 11 + "px";
  document.querySelectorAll(".target").forEach(x => x.classList.remove("target"));
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const s = el && el.closest("[data-slot]");
  if (s) s.classList.add("target");
});
document.addEventListener("pointerup", e => {
  const d = dragging;
  pending = null; dragging = null;
  if (!d) return;
  lastDrag = Date.now();
  document.body.classList.remove("dragging");
  $("#ghost").hidden = true;
  if (d.chip) {
    $("#chipGhost").hidden = true;
    const key = d.bar.dataset.chipbar;
    const { idx } = chipInsertIndex(d.bar, d.chip, e.clientX);
    const order = UI[key].filter(k => k !== d.chip);
    order.splice(idx, 0, d.chip);
    UI[key] = order;
    render();
    return;
  }
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const slot = el && el.closest("[data-slot]");
  if (slot) { const [cid, s] = slot.dataset.slot.split(":"); dropOnSlot(d.name, d.from, compById(cid), +s); }
  else if (d.from && el && el.closest("#side")) removeFromComp(d.from.comp, d.from.slot);
  render();
});

// ------------------------------------------------------------------ clics
document.addEventListener("click", async e => {
  const t = e.target;
  const menu = $("#menu");
  if (!menu.hidden) {
    const mi = t.closest("[data-mi]");
    closeMenu();
    if (mi) { const it = menu._items[+mi.dataset.mi]; if (it.fn) it.fn(); render(); }
    if (mi || !t.closest("#menu")) return;
  }
  if (Date.now() - lastDrag < 200) return;
  if (t.closest("[data-close]")) { t.closest(".modal").hidden = true; return; }
  let el;
  // droits par compo : officiers ; compos communautaires : aussi le créateur de l'event
  if (t.closest("[data-evmenu],[data-valid],[data-del],[data-reset],.slot") && !t.closest(".lockbtn,[data-lock]")) {
    const ce = t.closest("[data-comp]");
    if (ce && !canEditComp(compById(ce.dataset.comp))) { if (!t.closest(".slot.empty")) denyEdit(); return; }
  }
  if ((t.closest("[data-addraid],[data-addev]") && !canAddComp())
      || (t.closest("#list .row,#autofillBtn,#afBuffBtn,#clearBtn") && !weekComps().some(canEditComp))) { denyEdit(); return; }
  if ((el = t.closest("[data-lock]"))) { goToLock(LOCKS[+el.dataset.lock]); return; }
  if ((el = t.closest(".ptab"))) { UI.page = el.dataset.page; render(); return; }
  if ((el = t.closest("[data-phase]"))) { setPhase(+el.dataset.phase); return; }
  if ((el = t.closest("[data-assign]"))) { openAssigns(el.dataset.assign); return; }
  if (t.closest("#navPrev") || t.closest("#navNext") || t.closest("#navToday")) {
    navStep(t.closest("#navPrev") ? -1 : t.closest("#navNext") ? 1 : 0); return;
  }
  // clic sur le titre (mois / lockout / compo) : ouvre ou ferme son sélecteur (le passé de nouveau caché)
  if (t.closest("#subTitle")) {
    if ($("#picker").hidden) { pickHistory = false; showPicker(); } else $("#picker").hidden = true;
    return;
  }
  if (t.closest("[data-phist]")) { pickHistory = true; showPicker(); return; }
  if (t.closest("#syncBtn")) { doSync(); return; }
  if (t.closest("#settingsBtn")) { toggleSettings(); return; }
  if ((el = t.closest("[data-pick]"))) { pickMonth(+el.dataset.pick); return; }
  // calendrier
  // mode absence : un clic sur un jour (ou un event du jour) le sélectionne / désélectionne
  if (absMode && (el = t.closest("[data-day]"))) {
    const k = String(ymd(+el.dataset.day));
    if (absSel.has(k)) absSel.delete(k); else absSel.add(k);
    render(); return;
  }
  if (t.closest("#navAbsence")) {
    if (!absMode) { absMode = true; absSel = new Set(absences()); render(); }
    else {
      absMode = false;
      api().save_absences([...absSel]).then(list => { ST.absences = list; render(); toast(L("{0} absence day(s) saved.", list.length)); });
    }
    return;
  }
  if ((el = t.closest("[data-evopen]"))) { const ev = eventById(el.dataset.evopen); openWeek(ev.start, ev.id); return; }
  if ((el = t.closest("[data-evnew]"))) { calAct = null; openEventWin(el.dataset.evnew); return; }
  if ((el = t.closest("[data-evreact]"))) {
    calAct = null;
    // pris dans la compo visible : fenêtre de présence (retard / incertain / absence, les officiers sont prévenus)
    // (même absent / en retard : la fenêtre permet de revenir en désélectionnant le statut)
    const ev = eventById(el.dataset.evreact), spot = ev && myCompSpot(ev);
    if (spot) openPresenceWin(ev.id, spot); else openReactWin(el.dataset.evreact);
    return;
  }
  if ((el = t.closest("[data-dcomps]"))) { calAct = null; openWeek(+el.dataset.dcomps); return; }
  if ((el = t.closest("[data-dact]"))) { startCalAct(el.closest(".day").dataset.key, el.dataset.dact); return; }
  if (t.closest("[data-dtime]")) { calCreate(); return; }
  if ((el = t.closest("[data-react]"))) {
    const r = await api().rh_sign(el.dataset.ev, el.dataset.react);
    toast(r && r.ok ? L("Done: {0} sign-up(s) sent to Raid-Helper.", r.added || 1) : (r && r.error) || "Error", !(r && r.ok));
    if (r && r.ok) doSync();
    return;
  }
  if (calAct && !t.closest(".day.acting") && !t.closest("#evWin")) { calAct = null; renderCalendar(); }
  // members
  if ((el = t.closest("[data-mspec]"))) { memberSpec = +el.dataset.mspec; render(); return; }
  if ((el = t.closest("[data-mdel]"))) {
    // 1er clic : « Confirm » ; 2e clic : retiré de la base partagée
    if (!el.classList.contains("armed")) {
      el.classList.add("armed"); el.textContent = L("Confirm");
      setTimeout(() => { if (el.isConnected) { el.classList.remove("armed"); el.textContent = "×"; } }, 4000);
      return;
    }
    const name = el.dataset.mdel, u = memberUnits().find(x => x.name === name);
    const r = await api().delete_char(name, (u && u.class) || null);
    if (!r || r.ok === false) { toast((r && r.error) || "Error", true); return; }
    toast(L("{0} moved to the trash (restorable for 7 days).", (u && u.display) || name));
    if (expanded === name) expanded = null;
    reload(); return;
  }
  if (t.closest("[data-mtrash]")) { memberTrash = !memberTrash; render(); return; }
  if ((el = t.closest("[data-mrestore]"))) {
    el.disabled = true;
    const r = await api().restore_char(el.dataset.mrestore);
    if (!r || r.ok === false) { el.disabled = false; toast((r && r.error) || "Error", true); return; }
    toast(L("{0} restored.", el.dataset.mrestore.replace(/^~/, "").replace(/#.*$/, "")));
    reload(); return;
  }
  if ((el = t.closest("[data-detail]"))) { expanded = expanded === el.dataset.detail ? null : el.dataset.detail; render(); return; }
  // tuile « + »
  if ((el = t.closest("[data-addraid]"))) { addState = { raid: el.dataset.addraid }; render(); return; }
  if (t.closest("[data-addcancel]")) { addState = null; render(); return; }
  if ((el = t.closest("[data-addev]"))) {
    const comp = newComp(addState.raid, el.dataset.addev || null), ev = eventById(comp.event);
    // event communautaire : compo à part (créateur de l'event + officiers), sinon compo des officiers
    if (isCommuEvent(ev)) { Object.assign(comp, { commu: true, owner: ev.lid || myId() }); (ST.ccomps = ST.ccomps || {})[comp.id] = comp; }
    else getWeek().comps.push(comp);
    addState = null; commit(); render();
    // défilement jusqu'à la nouvelle compo seulement (pas jusqu'à la tuile « New comp » repoussée dessous) :
    // rien ne bouge si elle est déjà visible
    const box = $("#comps"), ne = box.querySelector(`.comp[data-comp="${comp.id}"]`);
    if (ne) {
      const b = box.getBoundingClientRect(), r = ne.getBoundingClientRect();
      if (r.bottom > b.bottom) box.scrollTop += Math.min(r.bottom - b.bottom + 8, r.top - b.top);
      else if (r.top < b.top) box.scrollTop -= b.top - r.top;
    }
    return;
  }
  // compos
  if ((el = t.closest("[data-evmenu]"))) {
    const comp = compById(el.dataset.evmenu);
    // officier : tous les events du lockout (la compo passe dans la bonne liste : officiers / communautaire) ;
    // créateur d'un event communautaire : ses events seulement
    const evs = canEdit() ? eventsInWeek(currentWeek()) : myCommuEvents();
    const items = evs.map(ev => ({ text: eventLabel(ev) + (isCommuEvent(ev) ? "  · " + L("community") : ""), on: comp.event === ev.id,
                                   fn: () => relinkComp(comp, ev) }));
    if (canEdit()) items.push({ text: L("No event"), mute: true, on: !comp.event, fn: () => relinkComp(comp, null) });
    openMenu(el.closest(".evwrap") || el, items); return;
  }
  if ((el = t.closest("[data-reset]"))) {
    if (el.classList.contains("armed")) { compById(el.dataset.reset).c = {}; commit(); render(); }
    else { el.classList.add("armed"); el.title = L("Click again to empty this comp"); setTimeout(() => el.classList.remove("armed"), 3000); }
    return;
  }
  if ((el = t.closest("[data-valid]"))) { const c = compById(el.dataset.valid); c.valid = !c.valid; commit(); render(); return; }
  if ((el = t.closest("[data-del]"))) {
    // compo avec des joueurs : la croix grossit et demande un 2e clic
    const comp = compById(el.dataset.del);
    if (comp && Object.values(comp.c).some(Boolean) && !el.classList.contains("armed")) {
      el.classList.add("armed"); el.title = L("Click again to delete this comp");
      setTimeout(() => el.classList.remove("armed"), 3000);
      return;
    }
    if (comp && comp.commu) comp.deleted = true;     // supprimée aussi sur le serveur
    else { const w = getWeek(); w.comps = w.comps.filter(c => c.id !== el.dataset.del); }
    if (UI.selected === el.dataset.del) UI.selected = null;
    commit(); render(); return;
  }
  if ((el = t.closest("[data-post]"))) { openPost(el.dataset.post); return; }
  // case de compo : perso = choix de sa spé dans cette compo ; case réservée = choix de la spé ; case vide = réserver
  if ((el = t.closest(".slot[data-slot]"))) {
    const [cid, s] = el.dataset.slot.split(":"), comp = compById(cid);
    if (el.dataset.name) compSpecMenu(el, comp, el.dataset.name);
    else if (el.dataset.ph) phSpecMenu(el, comp, +s);
    else phMenu(el, comp, +s);
    return;
  }
  if ((el = t.closest(".comp")) && !t.closest("button, .slot, img")) {
    UI.selected = UI.selected === el.dataset.comp ? null : el.dataset.comp; render(); return;
  }
  // clic dans le vide de la zone des compos (fond) : désélectionne
  if (UI.selected && t.closest("#comps") && !t.closest(".comp, .addtile, button, input, select")) {
    UI.selected = null; render(); return;
  }
  // liste
  if ((el = t.closest(".stab"))) { UI.tab = el.dataset.tab; render(); $("#list").scrollTop = 0; return; }
  if ((el = t.closest(".row"))) {
    const u = $("#list")._visible[+el.dataset.row];
    if (!autoPlace(u)) toast(L(selected() ? "This comp is full or already has one of this player's characters."
      : u.signed ? "No comp with a free slot for an event this player signed up for." : "No free slot: add a comp with +."), true);
    render(); return;
  }
  if ((el = t.closest("#afBuffBtn"))) { autofill(true); render(); return; }
  // Autofill complète les compos (ne remplace plus) : pas de confirmation ; Clear pour repartir de zéro
  if ((el = t.closest("#autofillBtn"))) { autofill(false); render(); return; }
  if ((el = t.closest("#clearBtn"))) {
    if (el.dataset.armed) {
      delete el.dataset.armed; el.innerHTML = CLEAR_HTML;
      const sel = selected();
      (sel ? [sel] : weekComps()).filter(canEditComp).forEach(c => { c.c = {}; c.sp = {}; });
      commit(); render();
    } else { el.dataset.armed = "1"; el.textContent = L("Confirm?"); setTimeout(() => { delete el.dataset.armed; el.innerHTML = CLEAR_HTML; }, 3000); }
  }
});

document.addEventListener("contextmenu", e => {
  e.preventDefault();
  // clic droit sur une case de compo : retire le perso ou la case réservée
  const cs = e.target.closest(".slot[data-name], .slot[data-ph]");
  if (cs) {
    const [cid, s] = cs.dataset.slot.split(":"), comp = compById(cid);
    if (!canEditComp(comp)) { denyEdit(); return; }
    if (cs.dataset.name) removeFromComp(comp, +s);
    else { delete comp.ph[s]; commit(); }
    hideTip(); render(); return;
  }
  const row = e.target.closest(".row");
  const u = row ? $("#list")._visible[+row.dataset.row] : null;
  if (!u) return;
  const at = { x: e.clientX, y: e.clientY };
  if (u.signed) openMenu(at, [{ text: L(u.unlinked ? "Link to a Discord tag…" : "Change Discord link…"), fn: () => openLink(u) }]);
  else specMenu(at, u);
});

document.addEventListener("mouseover", e => {
  if (dragging) return;
  // sélecteur (ouvert au clic sur le titre) : fermé 0,5 s après que la souris a quitté le titre et le cadre
  if (e.target.closest("#subTitle") || e.target.closest("#picker")) {
    clearTimeout(pickerTimer); pickerTimer = null;
  } else if (!$("#picker").hidden && !pickerTimer) {
    pickerTimer = setTimeout(() => { $("#picker").hidden = true; pickerTimer = null; }, 500);
  }
  // calendrier : survol d'un jour = tout son lockout légèrement éclairé
  const day = e.target.closest("[data-lockout]");
  document.querySelectorAll(".day.lockhl").forEach(x => { if (!day || x.dataset.lockout !== day.dataset.lockout) x.classList.remove("lockhl"); });
  if (day) document.querySelectorAll(`.day[data-lockout="${day.dataset.lockout}"]`).forEach(x => x.classList.add("lockhl"));
  // infobulle déjà en HTML (attribut échappé à la construction)
  const th = e.target.closest("[data-tiphtml]");
  if (th) return showTip(th.dataset.tiphtml, th);
  const hp = e.target.closest("[data-help]");
  if (hp) return showTip(`<div>${esc(L(hp.dataset.help))}</div>`, hp);
  const wn = e.target.closest("[data-warn]");
  if (wn) return showTip(`<b style="color:#ff6b6b">${L("Not signed for that event")}</b><div class="p">${L("This player has no Raid-Helper sign-up for the event of this comp.")}</div>`, wn);
  const lk = e.target.closest("[data-lock]");
  if (lk) return showTip(lockTip(LOCKS[+lk.dataset.lock]), lk);
  const b = e.target.closest("[data-tip]");
  if (b) return showTip(buffTip(b), b);
  const it = e.target.closest("[data-item]");
  if (it && it.dataset.item) return showTip((it.dataset.gs && gearTipHtml(it)) || itemTip(it.dataset.item), it);
  const sp = e.target.closest("[data-spell]");
  if (sp) return showTip(spellTip(sp.dataset.spell, sp), sp);
  const pf = e.target.closest("[data-prof]");
  if (pf) return showTip(`<b>${esc(pf.dataset.prof)}</b><div class="p">${esc(pf.dataset.lvl)}</div>`, pf);
  const r = e.target.closest(".row");
  if (r) {
    const u = $("#list")._visible[+r.dataset.row];
    return showTip(unitTip(u) + `<div class="p">${L(u.signed ? "Click: place (selected comp, or first comp of an event signed) · Drag: place · Right-click: link"
      : "Click: place (selected comp, or first comp of an event signed) · Drag: place · Right-click: spec")}</div>`, r);
  }
  const s = e.target.closest(".slot[data-name]");
  if (s) return showTip(unitTip(unitFor(s.dataset.name)) + `<div class="p">${L("Click: spec in this comp · Right-click: remove · Drag: move or swap")}</div>`, s);
  const phs = e.target.closest(".slot[data-ph]");
  if (phs) return showTip(`<b>${L("Reserved slot")}</b><div class="p">${L("Not counted as a player · Click: choose the spec · Right-click: remove")}</div>`, phs);
  if (UI.page === "assigns" && assignTip(e)) return;
  hideTip();
});

// ------------------------------------------------------------------ Discord : publication
let postComp = null;
const inGuildPost = () => !!(ST.cloud && ST.cloud.logged && ST.cloud.guild);
function openPost(id) {
  const hooks = ST.config.webhooks || [];
  // salons du serveur Discord de la guilde (relevés à la synchro, publiés par le bot du serveur), puis webhooks
  const chans = inGuildPost() ? Object.entries(ST.rhChannels || {}).sort((a, b) => String(a[1]).localeCompare(String(b[1]))) : [];
  if (!hooks.length && !chans.length) { toast(L("Add a Discord channel (webhook) in Settings first."), true); toggleSettings(true); return; }
  postComp = compById(id);
  const r = raidByKey(postComp.raid), ev = eventById(postComp.event);
  const opts = (chans.length ? `<optgroup label="${esc(L("Discord server"))}">${chans.map(([cid, n]) => `<option value="c:${cid}">#${esc(String(n).replace(/^#/, ""))}</option>`).join("")}</optgroup>` : "")
    + (hooks.length ? `<optgroup label="${esc(L("Webhooks"))}">${hooks.map((h, i) => `<option value="h:${i}">${esc(h.name || L("Channel") + " " + (i + 1))}</option>`).join("")}</optgroup>` : "");
  $("#postHook").innerHTML = opts;
  // dernier salon choisi
  if (UI.postTarget && [...$("#postHook").options].some(o => o.value === UI.postTarget)) $("#postHook").value = UI.postTarget;
  $("#postText").value = `**${r ? r.name : ""}** · ${ev ? eventLabel(ev) : ""}\n${mentions(postComp).text}`;
  $("#postModal").hidden = false;
}
$("#postSend").addEventListener("click", async () => {
  const btn = $("#postSend");
  btn.disabled = true; btn.textContent = L("Posting…");
  try {
    let image = null;
    if ($("#postImage").checked) {
      const el = document.querySelector(`.comp[data-comp="${postComp.id}"]`);
      const canvas = await html2canvas(el, { backgroundColor: "#1e1f24", scale: 2, logging: false, ignoreElements: x => x.classList && (x.classList.contains("ib") || x.classList.contains("csoc")) });
      image = canvas.toDataURL("image/png");
    }
    const target = $("#postHook").value;
    UI.postTarget = target; saveUI();
    const res = target.startsWith("c:")
      ? await api().post_discord(-1, $("#postText").value, mentions(postComp).uids, image, target.slice(2), postComp.id)
      : await api().post_discord(+target.slice(2), $("#postText").value, mentions(postComp).uids, image);
    if (res.ok) { $("#postModal").hidden = true; toast(L("Posted to Discord.")); } else toast(res.error, true);
  } catch (err) { toast(String(err), true); }
  btn.disabled = false; btn.textContent = L("Post");
});

// ------------------------------------------------------------------ liaison manuelle
let linkUid = null;
function openLink(u) {
  linkUid = u.uid;
  $("#linkInfo").textContent = L('Raid-Helper sign-up "{0}" ({1}). Type the Discord tag this player wrote in the guild notes.', u.rhName, L(CLASS_NAME[u.class] || "?"));
  const tags = [...new Set(Object.values(ST.roster).map(r => r && r.tag).filter(Boolean))].sort();
  $("#tagList").innerHTML = tags.map(t => `<option value="${esc(t)}">`).join("");
  $("#linkTag").value = ST.links[u.uid] || u.tag || "";
  $("#linkModal").hidden = false;
  $("#linkTag").focus();
}
$("#linkSave").addEventListener("click", () => { api().link(linkUid, $("#linkTag").value.trim()).then(() => { $("#linkModal").hidden = true; reload(); }); });
$("#linkClear").addEventListener("click", () => { api().link(linkUid, "").then(() => { $("#linkModal").hidden = true; reload(); }); });

// ------------------------------------------------------------------ synchro
// « X Online » : utilisateurs de l'appli connectés (signal toutes les minutes, départ à la fermeture)
function renderOnline() {
  const list = (ST && ST.online) || [], b = $("#onlineBtn");
  b.hidden = !(ST && ST.cloud && ST.cloud.logged && ST.cloud.guild);
  $("#onlineN").textContent = list.length;
}
async function refreshOnline() {
  try { ST.online = await api().online(); } catch (e) { return; }
  renderOnline();
}
$("#onlineBtn").addEventListener("click", e => {
  e.stopPropagation();
  const list = (ST && ST.online) || [];
  openMenu($("#onlineBtn"), list.length ? list.map(n => ({ text: n })) : [{ text: L("Nobody"), mute: true }]);
});
// Nouvelle version de l'exe : fenêtre « Update now » (téléchargement, remplacement et relance automatiques)
let updateShown = null;
async function checkUpdate(up) {
  if (!up) { try { up = await api().check_update(); } catch (e) { return; } }
  if (!up || updateShown === up.version) return;
  updateShown = up.version;
  const g = document.createElement("div");
  g.className = "gate"; g.id = "updateGate";
  g.innerHTML = `<div class="gatebox"><h2>${esc(L("Update available"))}</h2>
    <p>${esc(L("Guild Tool {0} is ready (you have {1}).", up.version, ST.version || "?"))}</p>
    <button class="btn pri" id="updNow">${L("Update now")}</button>
    <button class="btn" id="updLater">${L("Later")}</button>
    <div class="help">${L("Guild Tool closes, installs the new version and restarts by itself.")}</div></div>`;
  document.body.appendChild(g);
  $("#updLater").onclick = () => g.remove();
  $("#updNow").onclick = async () => {
    const b = $("#updNow");
    b.disabled = true; b.textContent = L("Downloading…");
    const r = await api().self_update();
    if (r && r.manual) { g.remove(); toast(L("Download page opened: replace GuildTool.exe with the new file."), !!r.error); }
    else if (!r || r.ok === false) { b.disabled = false; b.textContent = L("Update now"); toast((r && r.error) || "Error", true); }
  };
}
let syncing = false;
// après une action sur un event (inscription, statut, création…) : la fonction serveur a rangé l'event à jour
// dans la base ; on le reçoit tout de suite sans relire tout Raid-Helper
async function liveNow() {
  try { await api().live(); } catch (e) { /* hors ligne */ }
  reload();
}
async function doSync() {
  if (syncing) return;
  syncing = true;
  $("#syncBtn").classList.add("busy");
  const res = await api().sync();
  $("#syncBtn").classList.remove("busy");
  syncing = false;
  await reload();
  if (!res.ok) { toast(res.error, true); return; }
  const parts = [];
  if (res.count != null) parts.push(L("{0} events", res.count));
  // quota Raid-Helper atteint : les events pas encore relus le seront au prochain Sync
  if (res.pending) parts.push(L("{0} to refresh at next Sync (Raid-Helper limit)", res.pending));
  if (res.cloud) parts.push(L("guild: {0} received, {1} sent", res.cloud.received, res.cloud.sent));
  toast(L("Synced: {0}. Type /reload in game to load them.", parts.join(" · ")));
  // nouvelle version de l'exe : fenêtre de mise à jour automatique
  if (res.update) checkUpdate(res.update);
}
async function reload() {
  ST = await api().get_state();
  resetSigs();
  if (!UI.order) UI.order = ST.order.slice();
  loadPhases();
  setLang((ST.appearance || {}).lang);
  render();
  renderUserBtn();
  renderOnline();
  checkLoginGate();
  if (!$("#settingsWin").hidden) fillSettings();
}

window.addEventListener("pywebviewready", async () => {
  await reload();
  if (now() - (ST.lastSync || 0) > 120 && ST.config.apiKey) doSync();
  setInterval(async () => { if (!dragging && await api().poll()) reload(); }, 3000);
  // direct : changements de la guilde (compos, assigns, notes, persos…) toutes les 8 s quand la fenêtre est active,
  // toutes les 30 s sinon, sans attendre un Sync (une petite requête quand rien n'a changé)
  // Raid Comps / Assigns ouverts (fenêtre active) : toutes les secondes ; absences, persos et présence : 30 s
  let lastLive = 0, lastFull = 0, liveBusy = false;
  setInterval(async () => {
    if (liveBusy || dragging || syncing || !(ST && ST.cloud && ST.cloud.logged)) return;
    const focus = document.hasFocus(), hot = focus && (UI.page === "comps" || UI.page === "assigns");
    const gap = hot ? 1000 : focus ? 8000 : 30000, full = Date.now() - lastFull >= 30000;
    if (!full && Date.now() - lastLive < gap) return;
    lastLive = Date.now();
    if (full) lastFull = lastLive;
    liveBusy = true;
    try { if (await api().live(full)) reload(); else if (full) refreshOnline(); } finally { liveBusy = false; }
  }, 1000);
  checkUpdate();
  checkAddon();
  setInterval(() => {
    const m = ST.config.autoSyncMinutes || 0;
    if (m > 0 && now() - (ST.lastSync || 0) > m * 60) doSync();
  }, 30000);
});
// Échap : ferme d'abord ce qui est au premier plan (liste de noms, forme en cours, fenêtre modale, Settings)
document.addEventListener("keydown", e => {
  if (e.key !== "Escape" || e.defaultPrevented) return;
  if (!$("#namePick").hidden) { $("#namePick").hidden = true; return; }
  if (!$("#menu").hidden) { closeMenu(); return; }
  const modals = [...document.querySelectorAll(".modal")].filter(m => !m.hidden);
  if (modals.length) { modals.forEach(m => { m.hidden = true; }); return; }
  if (UI.page === "assigns" && assignEscape()) return;
  if (!$("#settingsWin").hidden) { toggleSettings(false); return; }
  if (!$("#tabLookWin").hidden) { toggleTabLook(false); return; }
  addState = null; absMode = false;
  if (ST) render();
});

// Raid Comps : survol du titre = liste verticale des lockouts (même format que le titre)
// Listes du titre : le passé (lockouts avant la semaine actuelle, compos d'avant) est caché derrière « Show History »
let pickHistory = false;
const HISTORY_SVG = '<svg viewBox="0 0 24 24"><path d="M6.2 4h8.3a1.8 1.8 0 0 1 1.8 1.8v3"/><path d="M6.2 4a1.8 1.8 0 0 0-1.8 1.8V9h3.6"/><path d="M8 5.8V18.4c0 1 .8 1.6 1.7 1.6"/><path d="M9.7 20h8.4a2.3 2.3 0 0 0 2.2-2.3v-.4h-8.6v.4A2.3 2.3 0 0 1 9.7 20"/><path d="M16.3 17.3v-3"/><path d="M10.3 8h3.5M10.3 10.6h3M10.3 13.2h2.2M10.3 15.8h2.6"/><path d="M15.2 15.8l4.8-7.6"/><path d="M16.1 14.4c-1.2-2.5.4-6.6 4.9-8.6.3 4.2-1.8 7.6-4.9 8.6z"/></svg>';
const historyRow = () => pickHistory ? "" : `<button class="pl phist" data-phist="1">${HISTORY_SVG}<span>${L("Show History")}</span></button>`;
function showLockoutList() {
  const cur = currentWeek(), thisWeek = weekStart(now());
  let html = "";
  // de la semaine actuelle jusqu'au dernier event connu (le passé : 12 lockouts avec « Show History »)
  const evs = sortedEvents(), lastEv = evs.length ? weekStart(evs[evs.length - 1].start) : thisWeek;
  const from = pickHistory ? Math.min(thisWeek, cur) - 12 * WEEK : thisWeek, to = Math.max(thisWeek, cur, lastEv);
  for (let ws = from; ws <= to; ws += WEEK) {
    const n = eventsInWeek(ws).length;
    // seulement les lockouts qui ont des events (et celui affiché)
    if (!n && ws !== cur) continue;
    const cls = (ws === cur ? " sel" : "") + (ws === thisWeek ? " now" : "") + (ws < thisWeek ? " old" : "");
    // lockout d'une autre année : l'année en petit à gauche (alignement inchangé)
    const yr = new Date(ws * 1000).getFullYear();
    html += `<button class="pl${cls}" data-pickweek="${ws}">${yr !== new Date().getFullYear() ? `<small class="ply">${yr}</small>` : ""}${weekLabelHtml(ws)}${n ? `<em>${n} ev.</em>` : ""}</button>`;
  }
  html = historyRow() + html;
  const p = $("#picker"), t = $("#subTitle").getBoundingClientRect();
  p.style.width = "";
  p.innerHTML = `<div class="plist">${html}</div>`;
  p.hidden = false;
  // le tiret de chaque ligne s'aligne sur celui du titre
  const dash = $("#subTitle .wd").getBoundingClientRect(), row = p.querySelector(".pl .wd").getBoundingClientRect();
  p.style.left = "0px";
  const rowNow = p.querySelector(".pl .wd").getBoundingClientRect();
  p.style.left = (dash.left + dash.width / 2) - (rowNow.left + rowNow.width / 2) + "px";
  p.style.top = t.bottom + 4 + "px";
  // « Show History » commence où commence la date la plus à gauche des lignes
  const hist = p.querySelector(".pl.phist");
  if (hist) {
    let min = Infinity;
    p.querySelectorAll(".pl .wl").forEach(s => {
      const r = document.createRange();
      r.selectNodeContents(s);
      const b = r.getBoundingClientRect();
      if (b.width) min = Math.min(min, b.left);
    });
    if (isFinite(min)) hist.style.paddingLeft = Math.max(0, min - hist.getBoundingClientRect().left - 1) + "px";   // - 1 : bordure
  }
  const sel = p.querySelector(".pl.sel") || p.querySelector(".pl.now");
  if (sel) p.scrollTop += sel.getBoundingClientRect().top - p.getBoundingClientRect().top - 110;
}
document.addEventListener("click", e => {
  const b = e.target.closest("[data-pickweek]");
  if (!b) return;
  UI.week = +b.dataset.pickweek; UI.selected = null; addState = null;
  $("#picker").hidden = true;
  render();
});

// ------------------------------------------------------------------ fenêtre sans cadre : boutons, double-clic, poignée de redimensionnement
$("#wMin").addEventListener("click", () => api().win_minimize());
$("#wMax").addEventListener("click", () => api().win_toggle_max());
$("#wClose").addEventListener("click", () => api().win_close());
document.querySelector(".top").addEventListener("dblclick", e => {
  if (e.target.classList.contains("pywebview-drag-region")) api().win_toggle_max();
});
$("#grip").addEventListener("pointerdown", e => {
  e.preventDefault(); e.stopPropagation();
  const sx = e.screenX, sy = e.screenY, sw = window.outerWidth, sh = window.outerHeight;
  let pending = null, busy = false;
  const send = () => {
    if (!pending || busy) return;
    const [w, h] = pending; pending = null; busy = true;
    api().win_resize(w, h).finally(() => { busy = false; send(); });
  };
  const move = ev => { pending = [sw + ev.screenX - sx, sh + ev.screenY - sy]; send(); };
  const up = () => { document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); };
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", up);
});
// ------------------------------------------------------------------ palette dérivée de la couleur de base (gris « Discord » par défaut)
const PALETTE = { head: 0.022, side: 0.03, panel: 0.055, input: 0.075, slot: 0.085, border: 0.115, hover: 0.125 };
function applyPalette(hex) {
  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const base = rgb(hex), def = rgb("#1e1f24");
  const root = document.documentElement.style;
  const set = (name, c) => {
    root.setProperty(`--${name}`, "#" + c.map(v => v.toString(16).padStart(2, "0")).join(""));
    root.setProperty(`--${name}-rgb`, c.join(","));
  };
  const lift = (c, f) => c.map(v => Math.round(v + (255 - v) * f));
  // couleur de base : barres (onglets, barre indicateur de chaque onglet) et boutons (fond, survol) ; le fond de la
  // fenêtre, les panneaux, cases et bordures gardent les teintes de la couleur par défaut
  const FROM_BASE = { head: 1, input: 1, hover: 1 };
  set("bg", def);
  for (const [name, f] of Object.entries(PALETTE)) set(name, lift(FROM_BASE[name] ? base : def, f));
}

// Tuile « + » : grandes lettres « verre » (remplies de l'image floutée, alignée sur celle du morceau)
function layoutRaidParts(tile) {
  for (const part of tile.querySelectorAll(".raidpart")) {
    const r = raidByKey(part.dataset.addraid), W = part.clientWidth, H = part.clientHeight;
    if (!W || !H) continue;
    const name = part.querySelector(".rp-name"), num = part.querySelector(".rp-num");
    // nom : toute la largeur, ancré en bas
    name.style.fontSize = "100px";
    const fs = Math.min(100 * (W - 24) / name.scrollWidth, H * 0.42);
    name.style.fontSize = fs + "px";
    // nombre : le plus grand possible entre le haut du cadre et le haut du nom, ancré à droite
    const free = H - name.offsetHeight - 12;
    num.style.fontSize = Math.max(14, free / 0.74) + "px";
    // ne dépasse pas le milieu horizontal du morceau
    if (num.scrollWidth > W / 2 - 12) num.style.fontSize = parseFloat(num.style.fontSize) * (W / 2 - 12) / num.scrollWidth + "px";
    // image entière du raid (cover) et la même image floutée dans les lettres
    const a = r.fullAspect || r.aspect || 1.5;
    let bw = W, bh = W / a;
    if (bh < H) { bh = H; bw = H * a; }
    const bx = (W - bw) / 2, by = (H - bh) / 2;
    if (!r.fullUrl) { for (const s of [name, num]) { s.style.backgroundImage = "none"; s.style.color = "rgba(255,255,255,.55)"; } continue; }
    part.style.backgroundImage = `linear-gradient(rgba(var(--bg-rgb),.42), rgba(var(--bg-rgb),.42)), url('${r.fullUrl}')`;
    part.style.backgroundSize = `auto, ${bw}px ${bh}px`;
    part.style.backgroundPosition = `0 0, ${bx}px ${by}px`;
    for (const s of [name, num]) {
      s.style.backgroundImage = `linear-gradient(rgba(255,255,255,.16), rgba(255,255,255,.16)), url('${r.fullBlur}')`;
      s.style.backgroundSize = `auto, ${bw}px ${bh}px`;
      s.style.backgroundPosition = `0 0, ${bx - s.offsetLeft}px ${by - s.offsetTop}px`;
    }
  }
}
document.addEventListener("mouseover", e => {
  const tile = e.target.closest(".addtile:not(.picking)");
  if (tile && !tile._laid) { tile._laid = true; requestAnimationFrame(() => layoutRaidParts(tile)); }
});
// Members : image de fond d'un de mes persos (recadrée au format du détail, partagée avec la guilde) ; les autres
// joueurs peuvent la cacher (case à cocher, ce perso seulement)
document.addEventListener("click", async e => {
  const el = e.target.closest && e.target.closest("[data-charpic], [data-charpicdel]");
  if (!el) return;
  e.stopPropagation();
  if (el.dataset.charpicdel !== undefined) {
    const r = await api().remove_char_image(el.dataset.charpicdel);
    if (!r || r.ok === false) { toast((r && r.error) || "Error", true); return; }
    delete (ST.charImages || {})[el.dataset.charpicdel];
    render(); return;
  }
  const name = el.dataset.charpic, res = await api().pick_image(3.6);
  if (!res) return;
  openCrop(res, "Character picture", "The frame has the shape of the character details.", async rect => {
    const r = await api().save_char_image(name, rect);
    if (!r || !r.ok) { toast((r && r.error) || "Error", true); return false; }
    (ST.charImages = ST.charImages || {})[name] = r.url;
    if (r.error) toast(L("Picture saved here, not shared: {0}", r.error), true);
    render();
    return true;
  });
});
document.addEventListener("change", e => {
  const n = e.target.dataset && e.target.dataset.charpichide;
  if (n === undefined) return;
  UI.hideCharImg = UI.hideCharImg || {};
  UI.hideCharImg[n] = e.target.checked;
  saveUI();
  render();
});
