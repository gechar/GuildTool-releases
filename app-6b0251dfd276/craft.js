"use strict";
// Onglet Craft : toutes les recettes (export de ProfDB, web/crafts.json), rangées par métier puis catégorie,
// avec les 4 barres de recherche de ProfDB (voir ProfDB/RECHERCHE.md) :
//   Search craft : un bloc de texte dans le nom · Profession / Craft type : listes de suggestions ·
//   Tooltip contains : tous les mots, dans n'importe quel ordre, dans l'infobulle (objet fabriqué ou sort), 0,3 s après la frappe.
// Les barres s'additionnent ; pendant une recherche tout est déplié (on peut replier ensuite, jusqu'à la prochaine frappe).

let CRAFTS = null, craftLoading = false;
const CF = { name: "", prof: "", cat: "", tip: "", player: "" };
let craftCollapsed = new Set(), craftTipWords = [], craftTipTimer = null;
const tipText = {};   // « i<id> » / « s<id> » -> texte de l'infobulle en minuscules

async function loadCrafts() {
  if (CRAFTS || craftLoading) return;
  craftLoading = true;
  try { CRAFTS = await (await fetch("crafts.json")).json(); } catch (e) { CRAFTS = { profs: [] }; }
  craftLoading = false;
  // au départ : métiers repliés
  CRAFTS.profs.forEach(p => craftCollapsed.add("p:" + p.n));
  renderCraft();
}
const searching = () => !!(CF.name || CF.prof || CF.cat || CF.tip || CF.player);
// Player : un joueur (nom Discord) = les métiers de tous ses persos ; recettes relevées en jeu : seulement celles qu'ils
// connaissent, sinon tout le métier (noms des métiers du jeu en français ramenés à ceux de la liste)
const PROF_EN = { Alchimie: "Alchemy", Forge: "Blacksmithing", Enchantement: "Enchanting", "Ingénierie": "Engineering",
  "Travail du cuir": "Leatherworking", Couture: "Tailoring", Cuisine: "Cooking", Secourisme: "First Aid", Minage: "Mining",
  Herboristerie: "Herbalism", "Dépeçage": "Skinning", "Pêche": "Fishing" };
let craftScope = null;
function craftPlayerScope() {
  if (!CF.player) return null;
  const q = CF.player.toLowerCase();
  const units = memberUnits().filter(u => !String(u.name).startsWith("~"));
  const exact = units.filter(u => String(u.discord || "").toLowerCase() === q);
  const chars = exact.length ? exact : units.filter(u => String(u.discord || "").toLowerCase().includes(q));
  const scope = { names: new Set(chars.map(u => u.name)), profs: new Set(), withRecipes: new Set() };
  for (const u of chars) {
    for (const p of asList(u.info && u.info.profs)) scope.profs.add(String(PROF_EN[p.n] || p.n).toLowerCase());
    for (const p of Object.keys((u.info && u.info.recipes) || {})) {
      const en = String(PROF_EN[p] || p).toLowerCase();
      scope.profs.add(en);
      scope.withRecipes.add(en);
    }
  }
  return scope;
}
const has = (text, q) => String(text || "").toLowerCase().includes(q.toLowerCase());
const tipKey = r => r[4] ? "i" + r[4] : "s" + r[3];

// texte d'une infobulle Wowhead (objet ou sort), en cache
function tipOf(r) {
  const k = tipKey(r);
  if (tipText[k] !== undefined) return tipText[k];
  const src = r[4] ? (ST.items || {})[String(r[4])] : (ST.spells || {})[String(r[3])];
  if (!src || !src.tt) return tipTried.has(k) ? (tipText[k] = String((src && src.n) || "").toLowerCase()) : null;
  // DOMParser : rien n'est chargé ni exécuté (pas d'images / onerror)
  const txt = new DOMParser().parseFromString(src.tt, "text/html").body.textContent || "";
  return (tipText[k] = txt.toLowerCase() + " " + String(src.n || "").toLowerCase());
}
const tipTried = new Set();   // une seule demande par infobulle (sinon une erreur Wowhead bouclerait)
function rowMatches(p, c, r) {
  if (CF.name && !has(r[1], CF.name)) return false;
  if (CF.prof && !has(p.n, CF.prof)) return false;
  if (CF.cat && !has(c.n, CF.cat) && !has(c.g, CF.cat)) return false;
  // Player : seulement les recettes que ses persos connaissent (métier dont les recettes n'ont pas été relues en jeu :
  // rien, il est signalé à côté du compteur)
  if (craftScope) {
    const pn = String(p.n).toLowerCase();
    if (!craftScope.profs.has(pn)) return false;
    if (!knowersOf(r).some(n => craftScope.names.has(n))) return false;
  }
  return true;
}
// infobulles manquantes des recettes déjà filtrées : chargées par paquets, la liste se complète
let tipLoading = false;
async function loadTips(rows) {
  if (tipLoading) return;
  const items = [...new Set(rows.filter(r => r[4] && tipOf(r) === null).map(r => r[4]))];
  const spells = [...new Set(rows.filter(r => !r[4] && r[3] && tipOf(r) === null).map(r => r[3]))];
  if (!items.length && !spells.length) return;
  items.forEach(i => tipTried.add("i" + i)); spells.forEach(s => tipTried.add("s" + s));
  tipLoading = true;
  const total = items.length + spells.length;
  let done = 0;
  // barre Tooltip vidée : lecture arrêtée (les paquets pas encore lus pourront être redemandés)
  const stop = () => !CF.tip;
  const forget = list => list.forEach(k => tipTried.delete(k));
  for (let i = 0; i < items.length && !stop(); i += 40) {
    Object.assign(ST.items, await api().item_info(items.slice(i, i + 40)));
    done += Math.min(40, items.length - i); craftProgress(done, total);
  }
  ST.spells = ST.spells || {};
  for (let i = 0; i < spells.length && !stop(); i += 40) {
    Object.assign(ST.spells, await api().spell_info(spells.slice(i, i + 40)));
    done += Math.min(40, spells.length - i); craftProgress(done, total);
  }
  if (stop()) { forget(items.map(i => "i" + i)); forget(spells.map(s => "s" + s)); }
  tipLoading = false;
  craftProgress(0, 0);
  if (!stop()) renderCraftList();
}
function craftProgress(done, total) {
  const el = $("#craftInfo");
  if (el) el.textContent = total ? L("Reading the tooltips… {0} / {1}", done, total) : "";
}

// Qui connaît une recette : relevés des persos (jeu + partagés), par n° de sort, objet fabriqué ou nom
let knowIdx = null, knowST = null;
function knowersOf(r) {
  if (knowST !== ST) {
    knowST = ST; knowIdx = {};
    const add = (k, n) => { (knowIdx[k] = knowIdx[k] || new Set()).add(n); };
    for (const [name, info] of Object.entries(ST.chars || {})) {
      if (charGone(name)) continue;
      for (const list of Object.values((info && info.recipes) || {})) for (const x of asList(list)) {
        if (x.s) add("s" + x.s, name);
        if (x.id) add("i" + x.id, name);
        if (x.n) add("n" + String(x.n).toLowerCase(), name);
      }
    }
  }
  const out = new Set();
  for (const k of ["s" + r[3], r[4] ? "i" + r[4] : "", "n" + String(r[1]).toLowerCase()]) (knowIdx[k] || []).forEach(n => out.add(n));
  return [...out].sort();
}
const craftOpen = new Set();   // recettes dépliées (composants + persos qui la connaissent)
const rowKey = (p, r) => p.n + "|" + r[3] + "|" + r[1];

// Axe vertical = bord droit de la barre « Profession » : colonne du nombre de persos à sa gauche, infobulle à sa droite
function craftAxes() {
  const page = $("#page-craft"), list = $("#craftList"), prof = $("#cfProf"), tip = $("#cfTip");
  if (!list || !prof || !prof.offsetParent) return;
  const L0 = list.getBoundingClientRect().left;
  list.style.setProperty("--axis", prof.parentElement.getBoundingClientRect().right - L0 + "px");
  page.style.setProperty("--tipx", tip.parentElement.getBoundingClientRect().left - page.getBoundingClientRect().left + "px");
}
const craftAxisX = () => { const p = $("#cfProf"); return p ? p.parentElement.getBoundingClientRect().right : 0; };
window.addEventListener("resize", () => { if (UI.page === "craft") craftAxes(); });

function renderCraft() {
  const page = $("#page-craft");
  if (!CRAFTS) { page.innerHTML = `<div class="empty-list">${L("Loading…")}</div>`; loadCrafts(); return; }
  if (!$("#craftBar")) {
    const bar = (id, ph, w) => `<div class="cfbox" style="flex:${w}"><input id="${id}" class="cfin" placeholder="${esc(L(ph))}" autocomplete="off" spellcheck="false">
      <button class="cfx" data-cfclear="${id}" data-help="Clear">×</button><div class="eflist cfsug" hidden></div></div>`;
    page.innerHTML = `<div class="craftbar" id="craftBar">${bar("cfPlayer", "Player", 14)}${bar("cfName", "Search craft", 18)}${bar("cfProf", "Profession", 15)}${bar("cfCat", "Craft type", 15)}${bar("cfTip", "Tooltip contains", 38)}</div>
      <div class="craftinfo"><button class="cfall" data-cfall="1" data-help="Collapse / expand all professions"><span class="car"></span></button><span id="craftCount"></span><span id="craftInfo"></span></div><div class="craftlist" id="craftList"></div>`;
  }
  renderCraftList();
}
function craftDetail(r, kn) {
  const mats = r[5] || [];
  ensureItems(mats.map(m => m[0]));
  const lines = Math.max(mats.length, kn.length);
  let h = "";
  for (let i = 0; i < lines; i++) {
    const m = mats[i], k = kn[i];
    let mat = "", who = "", dc = "";
    if (m) {
      const it = itemInfo(m[0]);
      mat = `<span class="cfmat" data-item="${m[0]}"><span class="cfic sm"${it.icon ? ` style="background-image:url('${ICON_URL(it.icon)}')"` : ""}></span><b>${m[1]}</b> <span style="color:${QUALITY_COLOR[it.q] || "#fff"}">${esc(it.name)}</span></span>`;
    }
    if (k) {
      const cls = (ST.roster[k] || {}).c || ((ST.chars[k] || {}).c);
      who = `<span class="cfkn" style="color:${CLASS_COLOR[cls] || "#fff"}">${nameHtml(k)}</span>`;
      dc = `<span class="cfdc">${esc(discordOf(k))}</span>`;
    }
    h += `<div class="cfline"><div class="cfl">${mat}${who}</div>${dc}</div>`;
  }
  return `<div class="cfdet">${h || `<div class="cfline"><div class="cfl"><span class="mute">${L("No reagents known.")}</span></div></div>`}</div>`;
}
// clé de repli d'une catégorie (sous-catégorie : avec son groupe, « Plate » existe sous Helm, Legs…)
const catKey = (p, c) => "c:" + p.n + ":" + (c.g ? c.g + ":" : "") + c.n;
function renderCraftList() {
  const box = $("#craftList");
  if (!box || !CRAFTS) return;
  craftAxes();
  craftScope = craftPlayerScope();
  const tipRows = [];
  let html = "", count = 0;
  // une ligne de recette
  const rowHtml = (p, r) => {
    const it = r[4] ? itemInfo(r[4]) : null, sp = !r[4] && (ST.spells || {})[String(r[3])];
    const icon = it && it.icon ? it.icon : sp && sp.icon;
    const col = r[2] >= 0 ? (QUALITY_COLOR[r[2]] || "#fff") : "#ffd100";
    const key = rowKey(p, r), kn = knowersOf(r), ro = craftOpen.has(key);
    return `<div class="cfrow${ro ? " open" : ""}" data-cfrow="${esc(key)}" ${r[4] ? `data-item="${r[4]}"` : `data-spell="${r[3]}"`} data-cficon="${r[4] ? "i" + r[4] : "s" + r[3]}">
      <div class="cfmain"><span class="cfic"${icon ? ` style="background-image:url('${ICON_URL(icon)}')"` : ""}></span><span class="cfn" style="color:${col}">${esc(r[1])}</span><span class="cfk">${kn.length || ""}</span></div><span class="cflv">${r[0] || ""}</span></div>`
      + (ro ? craftDetail(r, kn) : "");
  };
  // catégorie : bouton dans la marge de sa liste (trait vertical le long de la liste) ; clic = liste repliée en une seule
  // ligne-bouton portant son nom et son nombre de recettes. sub = sous-catégorie (dans un groupe : 2H Weapons, Helm…)
  // grp = « métier|groupe » sur le bouton d'un groupe : clic droit = toutes ses sous-catégories ouvertes / fermées
  const block = (key, name, n, inner, sub, grp) => {
    const open = !craftCollapsed.has(key);
    return `<div class="cfblock${sub ? " cfsub" : ""}${open ? "" : " shut"}"><div class="cfgut"><button class="cfcatb" data-cfcoll="${esc(key)}"${grp ? ` data-cfgrp="${esc(grp)}"` : ""} data-help="${esc(name)} · ${n}${grp ? " · " + esc(L("Right-click: expand / collapse all its sub-categories")) : ""}">${esc(name)}</button></div>`
      + `<div class="cfrows">${open ? inner() : `<div class="cfshut" data-cfcoll="${esc(key)}">${esc(L("{0} crafts", n))}</div>`}</div></div>`;
  };
  for (const p of CRAFTS.profs) {
    let ph = "", pc = 0;
    // recettes visibles de chaque catégorie
    const cats = [];
    for (const c of p.cats) {
      const rows = c.r.filter(r => rowMatches(p, c, r));
      // infobulle : seulement sur les recettes qui passent déjà les trois autres barres
      let shown = rows;
      if (craftTipWords.length) {
        tipRows.push(...rows);
        shown = rows.filter(r => { const t = tipOf(r); return t !== null && craftTipWords.every(w => t.includes(w)); });
      }
      if (shown.length) cats.push({ c, shown });
    }
    // catégories d'un même groupe (à la suite) réunies sous un bloc parent
    for (let i = 0; i < cats.length; i++) {
      const { c, shown } = cats[i];
      if (!c.g) { pc += shown.length; ph += block(catKey(p, c), c.n, shown.length, () => shown.map(r => rowHtml(p, r)).join("")); continue; }
      const subs = [cats[i]];
      while (i + 1 < cats.length && cats[i + 1].c.g === c.g) subs.push(cats[++i]);
      const n = subs.reduce((t, x) => t + x.shown.length, 0);
      pc += n;
      ph += block("c:" + p.n + ":" + c.g, c.g, n, () => subs.map(x =>
        block(catKey(p, x.c), x.c.n, x.shown.length, () => x.shown.map(r => rowHtml(p, r)).join(""), true)).join(""), false, p.n + "|" + c.g);
    }
    if (!pc) continue;
    count += pc;
    const pk = "p:" + p.n, popen = !craftCollapsed.has(pk);
    html += `<div class="cfprof${popen ? " open" : ""}" data-cfcoll="${esc(pk)}" data-cfprof="${esc(p.n)}" data-help="Right-click: expand / collapse all its categories"><span class="car"></span>${PROF_ICON[p.n] ? `<img src="${ICON_URL(PROF_ICON[p.n])}" alt="">` : ""}${esc(p.n)}<em>${pc}</em></div>`;
    if (popen) html += `<div class="cfcats">${ph}</div>`;
  }
  const scroll = box.scrollTop;
  box.innerHTML = html || `<div class="empty-list">${L(craftTipWords.length && tipLoading ? "Reading the tooltips…" : "No craft matches these searches.")}</div>`;
  box.scrollTop = scroll;
  // métiers du joueur cherché dont les recettes n'ont jamais été relues en jeu (métier jamais ouvert)
  const unread = craftScope ? [...craftScope.profs].filter(pn => !craftScope.withRecipes.has(pn)
    && CRAFTS.profs.some(p => String(p.n).toLowerCase() === pn)) : [];
  const profName = pn => (CRAFTS.profs.find(p => String(p.n).toLowerCase() === pn) || {}).n || pn;
  $("#craftCount").textContent = L("{0} crafts", count) + (CRAFTS.date ? " · ProfDB " + CRAFTS.date : "")
    + (unread.length ? " · " + L("Recipes not read yet: {0} (the player must open these professions once in game)", unread.map(profName).join(", ")) : "");
  if (craftTipWords.length) loadTips(tipRows);
  watchCraftIcons();
}
// icônes : demandées quand la ligne devient visible
let craftObs = null;
function watchCraftIcons() {
  if (craftObs) craftObs.disconnect();
  const pending = new Set();
  let timer = null;
  craftObs = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting && !e.target.querySelector(".cfic").style.backgroundImage) pending.add(e.target.dataset.cficon);
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const items = [...pending].filter(k => k[0] === "i").map(k => +k.slice(1)), spells = [...pending].filter(k => k[0] === "s").map(k => +k.slice(1));
      pending.clear();
      if (items.length) Object.assign(ST.items, await api().item_info(items.slice(0, 40)));
      if (spells.length) { ST.spells = ST.spells || {}; Object.assign(ST.spells, await api().spell_info(spells.slice(0, 40))); }
      if (items.length || spells.length) document.querySelectorAll("#craftList .cfrow").forEach(row => {
        const k = row.dataset.cficon, src = k[0] === "i" ? (ST.items || {})[k.slice(1)] : (ST.spells || {})[k.slice(1)];
        if (src && src.icon) row.querySelector(".cfic").style.backgroundImage = `url('${ICON_URL(src.icon)}')`;
      });
    }, 150);
  }, { root: $("#craftList") });
  document.querySelectorAll("#craftList .cfrow").forEach(r => craftObs.observe(r));
}

// suggestions des barres Profession / Craft type
function craftSuggest(el) {
  const list = el.parentElement.querySelector(".cfsug"), q = el.value.trim().toLowerCase();
  let opts = [];
  if (el.id === "cfPlayer") {
    // joueurs : noms Discord des persos connus (un par joueur)
    opts = [...new Set(memberUnits().filter(u => u.discord && !String(u.name).startsWith("~")).map(u => u.discord))].sort((a, b) => a.localeCompare(b));
  } else if (el.id === "cfProf") opts = CRAFTS.profs.map(p => p.n);
  else if (el.id === "cfCat") {
    // ordre logique : celui des catégories de la liste (ProfDB)
    const set = new Set();
    CRAFTS.profs.filter(p => !CF.prof || has(p.n, CF.prof)).forEach(p => p.cats.forEach(c => { if (c.g) set.add(c.g); set.add(c.n); }));
    opts = [...set];
  } else { list.hidden = true; return; }
  opts = opts.filter(o => !q || o.toLowerCase().includes(q));
  list.innerHTML = opts.map(o => `<button data-cfpick="${esc(o)}">${esc(o)}</button>`).join("");
  list.hidden = !opts.length;
}
function craftChanged(el) {
  const key = { cfName: "name", cfProf: "prof", cfCat: "cat", cfTip: "tip", cfPlayer: "player" }[el.id];
  CF[key] = el.value.trim();
  // toute modification redéplie tout
  if (searching()) craftCollapsed = new Set();
  if (key === "tip") {
    clearTimeout(craftTipTimer);
    if (!CF.tip) craftProgress(0, 0);
    craftTipTimer = setTimeout(() => { craftTipWords = CF.tip.toLowerCase().split(/\s+/).filter(Boolean); renderCraftList(); }, 300);
    return;
  }
  renderCraftList();
}
document.addEventListener("input", e => {
  const el = e.target.closest && e.target.closest(".cfin");
  if (!el) return;
  craftChanged(el);
  craftSuggest(el);
});
document.addEventListener("focusin", e => { const el = e.target.closest && e.target.closest(".cfin"); if (el) { hideCraftSug(el.closest(".cfbox")); craftSuggest(el); } });
// Listes de suggestions : fermées par un clic n'importe où (sauf dans leur barre), par Échap, ou 1 s après que la
// souris a quitté leur barre (sauf pendant la frappe dans la barre)
let cfSugTimer = null;
function hideCraftSug(except) {
  document.querySelectorAll(".cfsug").forEach(l => { if (!except || !except.contains(l)) l.hidden = true; });
}
document.addEventListener("pointerdown", e => hideCraftSug(e.target.closest && e.target.closest(".cfbox")), true);
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  const open = [...document.querySelectorAll(".cfsug")].some(l => !l.hidden);
  if (!open) return;
  hideCraftSug();
  if (document.activeElement && document.activeElement.classList.contains("cfin")) document.activeElement.blur();
  e.stopPropagation();
}, true);
document.addEventListener("mouseover", e => {
  const open = [...document.querySelectorAll(".cfsug")].filter(l => !l.hidden);
  if (!open.length) { clearTimeout(cfSugTimer); cfSugTimer = null; return; }
  const box = e.target.closest && e.target.closest(".cfbox");
  if (box && open.some(l => box.contains(l))) { clearTimeout(cfSugTimer); cfSugTimer = null; return; }
  if (cfSugTimer) return;
  cfSugTimer = setTimeout(() => {
    cfSugTimer = null;
    const a = document.activeElement, typing = a && a.classList.contains("cfin") && a.value.trim();
    hideCraftSug(typing ? a.closest(".cfbox") : null);
  }, 1000);
});
// clic droit sur un métier : toutes ses catégories repliées (si l'une est ouverte), sinon toutes dépliées ;
// le métier lui-même s'ouvre pour les montrer
// clic droit sur une catégorie qui a des sous-catégories (2H Weapons, Helm…) : toutes ses sous-catégories fermées (si
// l'une est ouverte), sinon toutes ouvertes ; la catégorie elle-même s'ouvre pour les montrer
document.addEventListener("contextmenu", e => {
  const el = e.target.closest && e.target.closest("#craftList [data-cfgrp]");
  if (!el || !CRAFTS) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const [pn, g] = el.dataset.cfgrp.split("|");
  const prof = CRAFTS.profs.find(p => p.n === pn);
  const keys = (prof ? prof.cats : []).filter(c => c.g === g).map(c => catKey(prof, c));
  const anyOpen = keys.some(x => !craftCollapsed.has(x));
  keys.forEach(x => { if (anyOpen) craftCollapsed.add(x); else craftCollapsed.delete(x); });
  craftCollapsed.delete(el.dataset.cfcoll);
  renderCraftList();
}, true);
document.addEventListener("contextmenu", e => {
  const el = e.target.closest && e.target.closest("#craftList [data-cfprof]");
  if (!el || !CRAFTS) return;
  e.preventDefault();
  const prof = CRAFTS.profs.find(p => p.n === el.dataset.cfprof);
  const keys = [...new Set((prof ? prof.cats : []).flatMap(c => [catKey(prof, c), c.g && "c:" + prof.n + ":" + c.g].filter(Boolean)))];
  const anyOpen = keys.some(x => !craftCollapsed.has(x));
  keys.forEach(x => { if (anyOpen) craftCollapsed.add(x); else craftCollapsed.delete(x); });
  craftCollapsed.delete(el.dataset.cfcoll);
  renderCraftList();
});
document.addEventListener("click", e => {
  const t = e.target;
  let el;
  if ((el = t.closest("[data-cfpick]"))) {
    const inp = el.closest(".cfbox").querySelector(".cfin");
    inp.value = el.dataset.cfpick; el.parentElement.hidden = true; craftChanged(inp); return;
  }
  if ((el = t.closest("[data-cfclear]"))) { const inp = $("#" + el.dataset.cfclear); inp.value = ""; craftChanged(inp); inp.focus(); return; }
  if ((el = t.closest("[data-cfcoll]"))) {
    const k = el.dataset.cfcoll;
    if (craftCollapsed.has(k)) craftCollapsed.delete(k); else craftCollapsed.add(k);
    renderCraftList(); return;
  }
  if (t.closest("[data-cfall]")) {
    // un métier ouvert : tout replier ; sinon tout déplier
    const keys = CRAFTS.profs.map(p => "p:" + p.n);
    if (keys.some(k => !craftCollapsed.has(k))) keys.forEach(k => craftCollapsed.add(k)); else keys.forEach(k => craftCollapsed.delete(k));
    renderCraftList(); return;
  }
  if ((el = t.closest("[data-cfrow]"))) {
    const k = el.dataset.cfrow;
    if (craftOpen.has(k)) craftOpen.delete(k); else craftOpen.add(k);
    renderCraftList(); return;
  }
  if (!t.closest(".cfbox")) document.querySelectorAll(".cfsug").forEach(l => { l.hidden = true; });
});
