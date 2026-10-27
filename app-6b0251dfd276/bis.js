"use strict";
// ---------------------------------------------------------------- Loots > Bislist
// Par spé (« CLASSE:Spé », + Shockadin chez le paladin) : poids des stats (EP, à la main ou import Pawn), talents par
// défaut, sets (Bis, Bis 2…) = un objet par emplacement (+ talents propres au set s'il le faut). Données de la guilde
// (officiers : modification ; tous : lecture), doc « bis_CLASSE_Spé » (exe : bis_save, ST.bis).
// Stats d'un objet : lues dans son infobulle Wowhead (lignes « +N Stat », « Equip: … »), sans les bonus de set.

// spés de la Bislist : celles de Raid-Helper + Shockadin (icône : Holy Shock)
const BIS_SPEC_ICON = {
  "WARRIOR:Protection": "ability_warrior_defensivestance", "WARRIOR:Arms": "ability_warrior_savageblow", "WARRIOR:Fury": "ability_warrior_innerrage",
  "PALADIN:Holy": "spell_holy_holybolt", "PALADIN:Protection": "spell_holy_devotionaura", "PALADIN:Retribution": "spell_holy_auraoflight",
  "PALADIN:Shockadin": "spell_holy_searinglight",
  "DRUID:Restoration": "spell_nature_healingtouch", "DRUID:Guardian": "ability_racial_bearform", "DRUID:Feral": "ability_druid_catform", "DRUID:Balance": "spell_nature_starfall",
  "PRIEST:Holy": "spell_holy_guardianspirit", "PRIEST:Discipline": "spell_holy_wordfortitude", "PRIEST:Shadow": "spell_shadow_shadowwordpain",
  "SHAMAN:Restoration": "spell_nature_magicimmunity", "SHAMAN:Enhancement": "spell_nature_lightningshield", "SHAMAN:Elemental": "spell_nature_lightning",
  "ROGUE:Combat": "ability_backstab", "ROGUE:Assassination": "ability_rogue_eviscerate", "ROGUE:Subtlety": "ability_stealth",
  "HUNTER:Marksmanship": "ability_marksmanship", "HUNTER:Survival": "ability_hunter_swiftstrike", "HUNTER:Beastmastery": "ability_hunter_beasttaming",
  "MAGE:Frost": "spell_frost_frostbolt02", "MAGE:Fire": "spell_fire_firebolt02", "MAGE:Arcane": "spell_holy_magicalsentry",
  "WARLOCK:Affliction": "spell_shadow_deathcoil", "WARLOCK:Destruction": "spell_shadow_rainoffire", "WARLOCK:Demonology": "spell_shadow_metamorphosis",
};
function bisSpecs() {
  const out = [];
  for (const cls of CLASS_ORDER) {
    const list = (SPECS[cls] || []).map(([s, role]) => ({ cls, spec: s, role }));
    if (cls === "PALADIN") list.push({ cls, spec: "Shockadin", role: "Healer" });
    for (const x of list) out.push({ ...x, key: cls + ":" + x.spec });
  }
  return out;
}
const bisSpecIcon = x => x.spec !== "Shockadin" && ST.specIcons[x.key] ? ST.specIcons[x.key] : ICON_URL(BIS_SPEC_ICON[x.key] || "inv_misc_questionmark", "medium");
// physique (mêlée, tank, chasseur) ou lanceur de sorts
const bisPhysical = x => x.cls === "HUNTER" || x.role === "Tank" || x.role === "Melee";

// poids des stats (noms de Pawn)
const BIS_EP_STATS = [["Strength", "Strength"], ["Agility", "Agility"], ["Stamina", "Stamina"], ["Intellect", "Intellect"], ["Spirit", "Spirit"],
  ["Ap", "Attack power"], ["Rap", "Ranged attack power"], ["HitRating", "Hit"], ["CritRating", "Crit"], ["HasteRating", "Haste"], ["ExpertiseRating", "Expertise"],
  ["SpellDamage", "Spell power"], ["Healing", "Heal power"], ["SpellHitRating", "Spell hit"], ["SpellCritRating", "Spell crit"], ["Mp5", "Mp5"],
  ["MeleeDps", "Melee DPS"], ["RangedDps", "Ranged DPS"], ["Armor", "Armor"],
  ["FireResistance", "Fire resistance"], ["NatureResistance", "Nature resistance"], ["FrostResistance", "Frost resistance"],
  ["ShadowResistance", "Shadow resistance"], ["ArcaneResistance", "Arcane resistance"]];
// emplacements de l'infobulle -> emplacements du perso
const BIS_SLOT_OF = { Head: [1], Neck: [2], Shoulder: [3], Back: [15], Chest: [5], Robe: [5], Wrist: [9], Hands: [10], Waist: [6], Legs: [7], Feet: [8],
  Finger: [11, 12], Trinket: [13, 14], "Main Hand": [16], "One-Hand": [16, 17], "Two-Hand": [16], "Off Hand": [17], "Held In Off-hand": [17],
  Ranged: [18], Thrown: [18], Relic: [18], Projectile: [] };

// Stats d'un objet (mises en cache tant que l'infobulle ne change pas) : { slot, stats: {Pawn: valeur} }
const bisStatCache = new Map();
function itemStats(id) {
  const it = ST.items[String(id)], tt = it && it.tt;
  if (!tt) return null;
  const c = bisStatCache.get(String(id));
  if (c && c.tt === tt) return c.v;
  const lines = tt.replace(/<!--[\s\S]*?-->/g, "").split(/<br\s*\/?>|<\/td>|<\/th>|<\/div>|<\/tr>|<table[^>]*>/i)
    .map(s => s.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
  const st = {}, add = (k, v) => { st[k] = (st[k] || 0) + v; };
  let slot = null, dps = 0, m;
  for (const raw of lines) {
    if (!slot && BIS_SLOT_OF[raw]) { slot = raw; continue; }
    if ((m = raw.match(/^\(([\d.]+) damage per second\)$/))) { dps = +m[1]; continue; }
    if ((m = raw.match(/^\+(\d+) (Strength|Agility|Stamina|Intellect|Spirit)\.?$/))) { add(m[2], +m[1]); continue; }
    if ((m = raw.match(/^\+(\d+) (Fire|Nature|Frost|Shadow|Arcane) Resistance\.?$/))) { add(m[2] + "Resistance", +m[1]); continue; }
    if ((m = raw.match(/^\+(\d+) (?:to )?All Resistances\.?$/))) { for (const r of ["Fire", "Nature", "Frost", "Shadow", "Arcane"]) add(r + "Resistance", +m[1]); continue; }
    if ((m = raw.match(/^(\d+) Armor$/))) { add("Armor", +m[1]); continue; }
    if (!/^Equip:/.test(raw)) continue;
    const l = raw.replace(/^Equip:\s*/, "");
    if ((m = l.match(/critical strike with spells by ([\d.]+)%/))) add("SpellCritRating", +m[1]);
    else if ((m = l.match(/chance to hit with spells by ([\d.]+)%/))) add("SpellHitRating", +m[1]);
    else if ((m = l.match(/chance to get a critical strike by ([\d.]+)%/))) add("CritRating", +m[1]);
    else if ((m = l.match(/chance to hit by ([\d.]+)%/))) add("HitRating", +m[1]);
    else if ((m = l.match(/damage and healing done by magical spells and effects by up to (\d+)/))) { add("SpellDamage", +m[1]); add("Healing", +m[1]); }
    else if ((m = l.match(/healing done by (?:magical spells and effects by )?up to (\d+)/))) add("Healing", +m[1]);
    else if ((m = l.match(/damage done by magical spells and effects by up to (\d+)/))) add("SpellDamage", +m[1]);
    else if ((m = l.match(/^\+(\d+) ranged Attack Power\.?$/i))) add("Rap", +m[1]);
    else if ((m = l.match(/^\+(\d+) Attack Power\.?$/))) add("Ap", +m[1]);
    else if ((m = l.match(/Restores (\d+) mana per 5 sec/))) add("Mp5", +m[1]);
    else if ((m = l.match(/attack speed by ([\d.]+)%/)) || (m = l.match(/haste[^\d]*([\d.]+)/i))) add("HasteRating", +m[1]);
    else if ((m = l.match(/dodged or parried by ([\d.]+)%/)) || (m = l.match(/expertise[^\d]*([\d.]+)/i))) add("ExpertiseRating", +m[1]);
  }
  if (dps) add(slot === "Ranged" || slot === "Thrown" ? "RangedDps" : "MeleeDps", dps);
  const v = { slot, stats: st };
  bisStatCache.set(String(id), { tt, v });
  return v;
}
// EP d'un objet pour des poids donnés
function itemEP(id, ep) {
  const s = itemStats(id);
  if (!s || !ep) return null;
  let t = 0;
  for (const [k, v] of Object.entries(s.stats)) t += (+ep[k] || 0) * v;
  return t;
}
const bisFmt = v => (Math.round(v * 10) / 10).toLocaleString(LOC(), { maximumFractionDigits: 1 });

// Buffs de raid (rangs max, améliorés) selon le rôle
function bisBuffs(x) {
  const phys = bisPhysical(x), mana = !["WARRIOR", "ROGUE"].includes(x.cls);
  const b = { flat: { Strength: 16, Agility: 16, Stamina: 16 + 70, Intellect: 16, Spirit: 16 }, kings: 0.1, ap: 0, crit: 0, scrit: 0, mp5: 0,
    names: ["Mark of the Wild", "Fortitude", "Blessing of Kings"] };
  if (mana) { b.flat.Intellect += 31; b.names.push("Arcane Intellect"); }
  if (phys) {
    b.flat.Strength += 77; b.flat.Agility += 77; b.ap += 222 + 290 + 100; b.crit += 3;
    b.names.push("Blessing of Might", "Battle Shout", "Strength of Earth", "Grace of Air", "Trueshot Aura", "Leader of the Pack");
  } else {
    b.flat.Spirit += 40; b.mp5 += 40; b.names.push("Divine Spirit", "Blessing of Wisdom");
    if (x.role === "Ranged") { b.scrit += 3; b.names.push("Moonkin Aura"); }
  }
  return b;
}
// Talents passifs qui changent les stats (par nom, effet par rang) ; p* = % de l'attribut
const BIS_TALENT_FX = {
  "Cruelty": { crit: 1 }, "Malice": { crit: 1 }, "Conviction": { crit: 1 }, "Thundering Strikes": { crit: 1 }, "Killer Instinct": { crit: 1 },
  "Lethal Shots": { crit: 1 }, "Sharpened Claws": { crit: 2 }, "Precision": { hit: 1 }, "Surefooted": { hit: 1 }, "Nature's Guidance": { hit: 1, shit: 1 },
  "Divine Strength": { pStrength: 2 }, "Divine Intellect": { pIntellect: 2 }, "Heart of the Wild": { pIntellect: 4 }, "HUNTER:Lightning Reflexes": { pAgility: 3 },
  "Demonic Embrace": { pStamina: 3 }, "Arcane Instability": { scrit: 1 }, "Tidal Mastery": { scrit: 1 }, "Elemental Precision": { shit: 2 },
  "Suppression": { shit: 2 }, "Shadow Focus": { shit: 2 }, "Devastation": { scrit: 1 }, "Force of Will": { scrit: 1 }, "Spiritual Guidance": { sg: 5 },
};
// talents d'un set : les siens s'il en a, sinon ceux de la spé
const bisTalentsOf = (d, set) => (set && set.own ? set.talents : d.talents) || {};
function bisTalentFx(cls, tals) {
  const fx = {};
  for (const [s, r] of Object.entries(tals || {})) {
    const n = ((ST.spells || {})[s] || {}).n;
    const e = n && (BIS_TALENT_FX[cls + ":" + n] || BIS_TALENT_FX[n]);
    if (!e || !r) continue;
    for (const [k, v] of Object.entries(e)) fx[k] = (fx[k] || 0) + v * r;
  }
  return fx;
}
// Récap des stats du set : objets + buffs de raid + talents passifs (+ conversions de la classe : force / agilité ->
// puissance d'attaque, agilité -> crit, intelligence -> crit des sorts ; sans les stats de base du perso)
const AGI_CRIT = { WARRIOR: 20, PALADIN: 20, SHAMAN: 20, DRUID: 20, ROGUE: 29, HUNTER: 53 };
const INT_SCRIT = { MAGE: 59.5, PRIEST: 59.5, WARLOCK: 60.6, DRUID: 60, SHAMAN: 59.5, PALADIN: 29.5 };
function bisRecap(x, set, tals) {
  const g = {};
  for (const id of Object.values((set && set.g) || {})) {
    const s = id && itemStats(id);
    if (s) for (const [k, v] of Object.entries(s.stats)) g[k] = (g[k] || 0) + v;
  }
  const b = bisBuffs(x), fx = bisTalentFx(x.cls, tals);
  const attr = k => ((g[k] || 0) + (b.flat[k] || 0)) * (1 + (fx["p" + k] || 0) / 100) * (1 + b.kings);
  const str = attr("Strength"), agi = attr("Agility"), int = attr("Intellect"), spi = attr("Spirit");
  const apStr = ["WARRIOR", "PALADIN", "SHAMAN", "DRUID"].includes(x.cls) ? 2 : 1, apAgi = ["ROGUE", "HUNTER", "DRUID"].includes(x.cls) ? (x.cls === "HUNTER" ? 2 : 1) : 0;
  const ap = (g.Ap || 0) + (x.cls === "HUNTER" ? (g.Rap || 0) : 0) + b.ap + (x.cls === "HUNTER" ? 0 : str * apStr) + agi * apAgi;
  const crit = (g.CritRating || 0) + (AGI_CRIT[x.cls] ? agi / AGI_CRIT[x.cls] : 0) + (fx.crit || 0) + b.crit;
  const scrit = (g.SpellCritRating || 0) + (INT_SCRIT[x.cls] ? int / INT_SCRIT[x.cls] : 0) + (fx.scrit || 0) + b.scrit;
  const hit = (g.HitRating || 0) + (fx.hit || 0), shit = (g.SpellHitRating || 0) + (fx.shit || 0);
  const sg = spi * (fx.sg || 0) / 100;
  const phys = bisPhysical(x);
  return { buffs: b.names, rows: [
    ["Stamina", attr("Stamina")], ["Strength", str], ["Agility", agi], ["Intellect", int], ["Spirit", spi],
    ["Crit", phys ? crit : scrit, "%", phys ? scrit : crit], ["Hit", phys ? hit : shit, "%", phys ? shit : hit],
    ["Haste", g.HasteRating || 0, "%"], ["Expertise", g.ExpertiseRating || 0, "%"],
    ["Attack power", ap], ["Spell power", (g.SpellDamage || 0) + sg], ["Heal power", (g.Healing || 0) + sg],
  ] };
}

// ---------------------------------------------------------------- données (guilde)
const bisData = key => { const d = (ST.bis || {})[key] || {}; return { ep: d.ep || {}, talents: d.talents || {}, sets: d.sets && d.sets.length ? d.sets : [{ n: "Bis", g: {} }],
  editors: Array.isArray(d.editors) ? d.editors.map(String) : [] }; };
let bisTimer = null;
function bisSave(key, d) {
  ST.bis = ST.bis || {};
  ST.bis[key] = { ...d, t: Math.floor(Date.now() / 1000) };
  clearTimeout(bisTimer);
  bisTimer = setTimeout(async () => { const r = await api().bis_save(key, ST.bis[key]); if (r && r.ok === false) toast(r.error, true); }, 400);
}
// officiers / admins : tout ; éditeurs choisis pour une spé (« Allow Edit ») : cette spé seulement
const bisIsOfficer = () => canEdit() && (!ST.cloud || !ST.cloud.logged || isOfficerUser());
const bisCanEdit = () => bisIsOfficer() || (!!myId() && bisCur().d.editors.includes(String(myId())));
let bisAllowOpen = false;
// « Allow Edit : » sous l'équipement : utilisateurs de Guild Tool de la guilde, case cochée = peut modifier cette spé
function bisAllowHtml(d) {
  const users = ST.guildUsers || [], name = id => (users.find(u => u.id === id) || {}).n || id;
  // deux noms au plus, au-delà : « X allowed »
  const label = !d.editors.length ? L("Officers only") : d.editors.length > 2 ? L("{0} allowed", d.editors.length) : d.editors.map(name).join(", ");
  if (!bisIsOfficer()) return d.editors.length ? `<div class="bisallow"><span>${L("Allow Edit :")}</span><span class="mute">${esc(label)}</span></div>` : "";
  const list = users.map(u => `<label><input type="checkbox" data-biseditor="${esc(u.id)}"${d.editors.includes(u.id) ? " checked" : ""}>${esc(u.n)}</label>`).join("")
    || `<div class="mute">${L("No Guild Tool user yet (log in and Sync).")}</div>`;
  return `<div class="bisallow"><span>${L("Allow Edit :")}</span><span class="bisallowdd"><button class="lootsel" data-bisallow="1" data-help="Officers and admins can always edit. Checked members can edit this spec too.">${esc(label)} ▾</button>
    <div class="bisallowlist"${bisAllowOpen ? "" : " hidden"}>${list}</div></span></div>`;
}
// spé et set affichés
function bisCur() {
  const specs = bisSpecs();
  const x = specs.find(s => s.key === UI.bisSpec) || specs[0];
  const d = bisData(x.key);
  const si = Math.max(0, Math.min(d.sets.length - 1, UI.bisSet || 0));
  return { x, d, si, set: d.sets[si] };
}

// ---------------------------------------------------------------- talents (calculateur)
function bisTrees(cls, tals) {
  const ref = (typeof TALENT_REF !== "undefined" && TALENT_REF[cls]) || null;
  if (!ref) return [];
  const trees = ref.trees.map(tr => ({ n: tr[0], icon: tr[1], cells: [], p: 0 }));
  for (const [s, pos] of Object.entries(ref.s)) {
    const r = +(tals[s] || 0);
    const sp = (ST.spells || {})[s];
    trees[pos[0] - 1].cells.push({ s: +s, r, m: pos[3] || 1, n: (sp && sp.n) || "", row: pos[1], col: pos[2], req: pos[4] ? [pos[4], pos[5]] : null });
  }
  // un talent par case (doublons d'anciens talents : le plus avancé, sinon le 1er)
  for (const t of trees) {
    const by = {};
    for (const c of t.cells) { const k = c.row + ":" + c.col; if (!by[k] || c.r > by[k].r) by[k] = c; }
    t.cells = Object.values(by);
    t.p = t.cells.reduce((a, c) => a + c.r, 0);
  }
  return trees;
}
// talents valides : rangée r -> (r - 1) x 5 points plus haut dans l'arbre, prérequis au max, 51 points au plus
function bisTalentsValid(cls, tals) {
  const trees = bisTrees(cls, tals);
  let total = 0;
  for (const t of trees) {
    total += t.p;
    for (const c of t.cells) {
      if (!c.r) continue;
      const above = t.cells.filter(o => o.row < c.row).reduce((a, o) => a + o.r, 0);
      if (above < (c.row - 1) * 5) return false;
      if (c.req) { const q = t.cells.find(o => o.row === c.req[0] && o.col === c.req[1]); if (q && q.r < q.m) return false; }
    }
  }
  return total <= 51;
}
function bisTalentsHtml(x, tals, editable) {
  const trees = bisTrees(x.cls, tals);
  ensureSpells(trees.flatMap(t => t.cells.map(c => c.s)));
  const sicon = s => { const sp = (ST.spells || {})[String(s)]; return sp && sp.icon; };
  const total = trees.reduce((a, t) => a + t.p, 0);
  const html = trees.map(t => {
    const rows = Math.max(7, ...t.cells.map(c => c.row));
    let grid = "";
    for (let r = 1; r <= rows; r++) for (let c = 1; c <= 4; c++) {
      const tal = t.cells.find(o => o.row === r && o.col === c), ic = tal && sicon(tal.s);
      grid += tal ? `<span class="tal${tal.r > 0 ? " on" : ""}${tal.r > 0 && tal.r === tal.m ? " max" : ""}${ic ? " ico" : ""}${editable ? " ed" : ""}" data-spell="${tal.s}" data-bistal="${tal.s}" data-tname="${esc(tal.n)}" data-trank="${tal.r}/${tal.m}"${ic ? ` style="background-image:url('${ICON_URL(ic)}')"` : ""}>${ic ? "" : `<em>${esc(String(tal.n).split(" ").map(w => w[0]).join("").slice(0, 3))}</em>`}<i>${tal.r}/${tal.m}</i></span>` : "<span></span>";
    }
    return `<div class="ttree"><b>${t.icon ? `<img class="tico" src="${ICON_URL(t.icon)}" alt="">` : ""}${esc(t.n)} <small>${t.p}</small></b>
      <div class="tgwrap">${talentArrows(t.cells, rows)}<div class="tgrid" style="grid-template-rows:repeat(${rows},28px)">${grid}</div></div></div>`;
  }).join("");
  return { html: `<div class="ttrees">${html}</div>`, total };
}

// ---------------------------------------------------------------- page
function renderLootBis() {
  const box = $("#page-loots"), { x, d, si, set } = bisCur(), ed = bisCanEdit();
  UI.bisSpec = x.key;
  // spés, rangées par classe
  const specs = bisSpecs();
  const specBar = CLASS_ORDER.map(cls => `<span class="bisclass">${specs.filter(s => s.cls === cls).map(s =>
    `<button class="bisspec${s.key === x.key ? " on" : ""}" data-bisspec="${esc(s.key)}" style="--c:${CLASS_COLOR[cls]}" data-help="${esc(L(s.spec) + " " + L(CLASS_NAME[cls]))}"><img src="${bisSpecIcon(s)}" alt=""></button>`).join("")}</span>`).join("");
  // poids des stats
  const ep = d.ep, extra = Object.keys(ep).filter(k => !BIS_EP_STATS.some(s => s[0] === k));
  const epRows = BIS_EP_STATS.concat(extra.map(k => [k, k])).map(([k, n]) =>
    `<label class="bisep${ep[k] ? " set" : ""}"><span>${esc(L(n))}</span><input type="number" step="0.01" data-bisep="${k}" value="${ep[k] ?? ""}"${ed ? "" : " disabled"}></label>`).join("");
  // équipement : colonne gauche, récap des stats au milieu, colonne droite, armes en bas
  const ids = [];
  const slotHtml = slot => {
    const id = set.g && set.g[slot];
    if (id) ids.push(id);
    const it = id ? itemInfo(id) : null, e = id ? itemEP(id, ep) : null;
    return `<div class="bslot${id ? "" : " empty"}" data-bislot="${slot}"${id ? ` data-item="${id}"` : ""} style="--q:${it ? QUALITY_COLOR[it.q] || "#383a43" : "#383a43"};${it && it.icon ? `background-image:url('${ICON_URL(it.icon, "medium")}')` : ""}" title="${id ? "" : esc(L(GEAR_NAMES[slot]))}">${e ? `<i>${bisFmt(e)}</i>` : ""}</div>`;
  };
  const tals = bisTalentsOf(d, set), rc = bisRecap(x, set, tals);
  const total = Object.values(set.g || {}).reduce((a, id) => a + (itemEP(id, ep) || 0), 0);
  const recap = `<div class="bisrecap" data-help="${esc(L("Gear, raid buffs ({0}) and passive talents; no base stats of the character, no set bonuses.", rc.buffs.map(L).join(", ")))}">${rc.rows.map(([n, v, u, v2]) =>
    `<div><span>${esc(L(n))}</span><b>${bisFmt(v)}${u || ""}${v2 ? ` <small>(${bisFmt(v2)}${u})</small>` : ""}</b></div>`).join("")}<div class="bistot"><span>EP</span><b>${bisFmt(total)}</b></div></div>`;
  const left = GEAR_LEFT.filter(s => s !== 4 && s !== 19), right = GEAR_RIGHT;
  const paper = `<div class="bispaper"><div class="pcol">${left.map(slotHtml).join("")}</div>${recap}<div class="pcol">${right.map(slotHtml).join("")}</div><div class="pbot">${GEAR_BOTTOM.map(slotHtml).join("")}</div></div>`;
  ensureItems(ids);
  // sets
  const sets = `<div class="bissets"><select class="lootsel" id="bisSetSel">${d.sets.map((s, i) => `<option value="${i}"${i === si ? " selected" : ""}>${esc(s.n || (i ? "Bis " + (i + 1) : "Bis"))}</option>`).join("")}</select>`
    + (ed ? `<button class="ib" data-bisset="add" data-help="Add a set">+</button>${d.sets.length > 1 ? `<button class="ib" data-bisset="del" data-help="Delete this set">×</button>` : ""}` : "") + `</div>`;
  // talents
  const t = bisTalentsHtml(x, tals, ed);
  const own = !!(set && set.own);
  const talHead = `<div class="bistalh"><b>${L("Talents")} <small>${t.total} / 51</small></b>${si > 0 || own ? `<label class="mchk" data-help="This set uses its own talents (the other sets keep the default talents)."><input type="checkbox" id="bisOwnTal"${own ? " checked" : ""}${ed ? "" : " disabled"}>${L("Own talents for this set")}</label>` : `<small class="mute">${L("Default talents of the spec")}</small>`}${ed ? `<button class="btn small" data-bistalclr="1">${L("Reset")}</button>` : ""}</div>`;
  box.innerHTML = `<div class="bis"><div class="bisspecs">${specBar}</div>
    <div class="bismain">
      <div class="biseps"><div class="bish">${L("Stat weights (EP)")}</div><div class="biseplist">${epRows}</div>
        ${ed ? `<textarea id="bisPawn" placeholder="${esc(L("Paste a Pawn string: ( Pawn: v1: \"Name\": Class=…, Strength=2.53, … )"))}" spellcheck="false"></textarea><button class="btn small" data-bispawn="1">${L("Import Pawn")}</button>` : ""}</div>
      <div class="biscenter">${sets}${paper}${bisAllowHtml(d)}${ed ? `<div class="mute bishelp">${L("Click a slot to choose its item · right-click: empty")}</div>` : ""}</div>
      <div class="bistal tpanel">${talHead}${t.html}${ed ? `<div class="mute bishelp">${L("Click: +1 · right-click: -1")}</div>` : ""}</div>
    </div></div>`;
  if (bisPick) bisFillPick();
}

// Pawn : « ( Pawn: v1: "Nom": Class=Paladin,Strength=2.530,… ) »
function parsePawn(txt) {
  const m = String(txt || "").match(/Pawn:\s*v\d+:\s*"[^"]*"\s*:\s*([^)]*)/i);
  const body = m ? m[1] : String(txt || "");
  const out = {};
  for (const part of body.split(",")) {
    const kv = part.split("=");
    if (kv.length !== 2) continue;
    const k = kv[0].trim(), v = parseFloat(kv[1]);
    if (!k || /^(Class|Spec)$/i.test(k) || isNaN(v)) continue;
    out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

// ---------------------------------------------------------------- sélecteur d'objet d'un emplacement
let bisPick = null;   // { slot }
function bisCandidates(slot, q) {
  const { d } = bisCur(), ids = new Set(Object.keys(ST.items || {}));
  for (const bosses of Object.values(ST.bossLoot || {})) for (const items of Object.values(bosses || {})) for (const id of Object.keys(items || {})) ids.add(String(id));
  const out = [];
  q = (q || "").trim().toLowerCase();
  const num = /^\d+$/.test(q) ? q : (q.match(/item=(\d+)/) || [])[1];
  for (const id of ids) {
    const it = ST.items[id];
    if (!it || !it.tt) continue;
    const s = itemStats(id);
    if (!s || !s.slot || !(BIS_SLOT_OF[s.slot] || []).includes(slot)) continue;
    if (q && !num && !String(it.n || "").toLowerCase().includes(q)) continue;
    if (num && id !== num) continue;
    out.push({ id, it, ep: itemEP(id, d.ep) || 0 });
  }
  out.sort((a, b) => b.ep - a.ep || (b.it.l || 0) - (a.it.l || 0));
  if (num && !out.length) ensureItems([num]);
  return out.slice(0, 80);
}
function bisFillPick() {
  const p = $("#bisPick");
  if (!p || !bisPick) return;
  const list = bisCandidates(bisPick.slot, $("#bisPickQ").value);
  $("#bisPickList").innerHTML = list.map(c => `<button data-bispickid="${c.id}" data-item="${c.id}"><em class="bpep">${c.ep ? bisFmt(c.ep) : ""}</em><span class="lcic" style="background-image:url('${ICON_URL(c.it.icon || "inv_misc_questionmark")}')"></span>`
    + `<span class="bpn" style="color:${QUALITY_COLOR[c.it.q] || "#fff"}">${esc(c.it.n || "?")}</span></button>`).join("")
    || `<div class="mute">${L("No known item for this slot (type its ID or a Wowhead link).")}</div>`;
}
function bisOpenPick(el) {
  const slot = +el.dataset.bislot;
  bisPick = { slot };
  let p = $("#bisPick");
  if (!p) { p = document.createElement("div"); p.id = "bisPick"; p.className = "bispick"; document.body.appendChild(p); }
  p.innerHTML = `<div class="bph"><b>${esc(L(GEAR_NAMES[slot]))}</b><button class="ib" data-bispickx="1">×</button></div><input id="bisPickQ" placeholder="${esc(L("Item: name, ID or Wowhead link"))}" autocomplete="off" spellcheck="false"><div class="bplist" id="bisPickList"></div>`;
  const r = el.getBoundingClientRect();
  p.hidden = false;
  p.style.left = Math.max(4, Math.min(innerWidth - 344, r.right + 6)) + "px";
  p.style.top = Math.max(4, Math.min(innerHeight - 420, r.top - 10)) + "px";
  // objets des raids : infobulles demandées par paquets
  const need = [];
  for (const bosses of Object.values(ST.bossLoot || {})) for (const items of Object.values(bosses || {})) for (const id of Object.keys(items || {})) if (!(ST.items[id] || {}).tt) need.push(id);
  ensureItems(need);
  bisFillPick();
  $("#bisPickQ").focus();
}
const bisClosePick = () => { bisPick = null; const p = $("#bisPick"); if (p) p.hidden = true; };

function bisUpdate(fn) {
  const { x, d, si } = bisCur();
  fn(d, si);
  bisSave(x.key, d);
  renderLoots();
}
document.addEventListener("click", e => {
  const t = e.target;
  if (t.closest && t.closest("#bisPick")) {
    if (t.closest("[data-bispickx]")) { bisClosePick(); return; }
    const b = t.closest("[data-bispickid]");
    if (b) { const slot = bisPick.slot, id = +b.dataset.bispickid; bisClosePick(); bisUpdate((d, si) => { d.sets[si].g = { ...(d.sets[si].g || {}), [slot]: id }; }); }
    return;
  }
  if (UI.page !== "loots" || UI.lootTab !== "bis") return;
  let el;
  if ((el = t.closest("[data-bisspec]"))) { UI.bisSpec = el.dataset.bisspec; UI.bisSet = 0; bisAllowOpen = false; bisClosePick(); renderLoots(); saveUI(); return; }
  if (t.closest("[data-bisallow]")) { bisAllowOpen = !bisAllowOpen; const l = $(".bisallowlist"); if (l) l.hidden = !bisAllowOpen; return; }
  if (bisAllowOpen && !t.closest(".bisallowlist")) { bisAllowOpen = false; const l = $(".bisallowlist"); if (l) l.hidden = true; }
  if (!bisCanEdit()) return;
  if ((el = t.closest("[data-bislot]"))) { bisOpenPick(el); return; }
  bisClosePick();
  if ((el = t.closest("[data-bisset]"))) {
    if (el.dataset.bisset === "add") bisUpdate(d => { d.sets.push({ n: "Bis " + (d.sets.length + 1), g: {} }); UI.bisSet = d.sets.length - 1; });
    else bisUpdate((d, si) => { d.sets.splice(si, 1); UI.bisSet = Math.max(0, si - 1); });
    return;
  }
  if (t.closest("[data-bispawn]")) {
    const w = parsePawn($("#bisPawn").value);
    if (!w) { toast(L("Not a Pawn string."), true); return; }
    bisUpdate(d => { d.ep = w; });
    toast(L("{0} stat weights imported.", Object.keys(w).length));
    return;
  }
  if (t.closest("[data-bistalclr]")) { bisUpdate((d, si) => { if (d.sets[si].own) d.sets[si].talents = {}; else d.talents = {}; }); return; }
  if ((el = t.closest("[data-bistal]"))) bisTalentStep(el.dataset.bistal, 1);
});
document.addEventListener("contextmenu", e => {
  if (UI.page !== "loots" || UI.lootTab !== "bis" || !bisCanEdit()) return;
  let el;
  if ((el = e.target.closest("[data-bislot]")) && el.dataset.item) { bisUpdate((d, si) => { const g = { ...(d.sets[si].g || {}) }; delete g[el.dataset.bislot]; d.sets[si].g = g; }); return; }
  if ((el = e.target.closest("[data-bistal]"))) bisTalentStep(el.dataset.bistal, -1);
});
function bisTalentStep(s, dir) {
  const { x, d, si } = bisCur(), set = d.sets[si];
  const cur = { ...bisTalentsOf(d, set) };
  const ref = TALENT_REF[x.cls].s[s], max = (ref && ref[3]) || 1;
  const r = Math.max(0, Math.min(max, (+cur[s] || 0) + dir));
  if (r === (+cur[s] || 0)) return;
  if (r) cur[s] = r; else delete cur[s];
  if (!bisTalentsValid(x.cls, cur)) { toast(L("Not possible: tier points, prerequisite or 51 points."), true); return; }
  if (set.own) set.talents = cur; else d.talents = cur;
  bisSave(x.key, d);
  renderLoots();
  hideTip();
}
document.addEventListener("change", e => {
  if (UI.page !== "loots" || UI.lootTab !== "bis") return;
  const t = e.target;
  if (t.id === "bisSetSel") { UI.bisSet = +t.value; renderLoots(); saveUI(); return; }
  // éditeurs de la spé (officiers / admins seulement)
  if (t.dataset.biseditor && bisIsOfficer()) {
    const id = t.dataset.biseditor;
    bisUpdate(d => { d.editors = t.checked ? [...new Set([...d.editors, id])] : d.editors.filter(x => x !== id); });
    return;
  }
  if (!bisCanEdit()) return;
  if (t.id === "bisOwnTal") { bisUpdate((d, si) => { const s = d.sets[si]; s.own = t.checked; if (t.checked && !s.talents) s.talents = { ...d.talents }; }); return; }
  if (t.dataset.bisep) {
    const v = parseFloat(t.value);
    bisUpdate(d => { const ep = { ...d.ep }; if (isNaN(v) || !v) delete ep[t.dataset.bisep]; else ep[t.dataset.bisep] = v; d.ep = ep; });
  }
});
document.addEventListener("input", e => { if (e.target.id === "bisPickQ") bisFillPick(); });
document.addEventListener("keydown", e => {
  // chaîne Pawn collée : Entrée = « Import Pawn » (Maj + Entrée : retour à la ligne)
  if (e.target.id === "bisPawn" && e.key === "Enter" && !e.shiftKey) { e.preventDefault(); const b = $("[data-bispawn]"); if (b) b.click(); return; }
  if (e.target.id !== "bisPickQ") return;
  if (e.key === "Escape") bisClosePick();
  if (e.key === "Enter") { const b = $("#bisPickList [data-bispickid]"); if (b) b.click(); }
});
