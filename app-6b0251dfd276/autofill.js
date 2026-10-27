// Autofill : répartit les inscrits entre les compos d'un event (miroir exact de Autofill.lua)
// 1. compos équilibrées : autant que les candidats (+ déjà placés) permettent d'en remplir à 80 % ; les autres
//    reçoivent le surplus, une à la fois (pas d'équilibrage sous 80 %)
// 2. buffs : les étapes de AF_STEPS dans l'ordre, chacune appliquée à toutes les compos équilibrées avant la suivante
//    (une compo qui l'a déjà est sautée) ; options « ou » : la 1re compo prend la 1re option, les suivantes les autres ;
//    parmi les persos possibles, tanks et heals d'abord, puis par statut ; « Autofill Buffs » s'arrête là
// 3. remplissage : tanks et heals requis, puis les dps (statut : Signed > Late > Tentative > Bench), puis les
//    tanks / heals en surplus, en équilibrant les classes entre les compos, puis les présences incertaines (Late,
//    Tentative, Bench : deux démonistes Late = un par compo), puis la compo la moins remplie ; le reste dans les
//    compos suivantes. Les joueurs déjà placés restent (Autofill complète, ne remplace pas)
// 4. groupes : préférence de l'étape qui a choisi le perso, sinon heals 4, Shadow / Balance 4 > 3, tanks 1,
//    mêlées et chasseurs 2 > 1, casters 3 > 4 (sans Shadow / Balance) > 1 > 2 ; chamans dans des groupes distincts
// 5. affinités (Preference Score, exe seulement : afSocial) : échanges de nouveaux venus entre compos qui augmentent
//    le score social, sans rien perdre (même rôle, aucune compo ne perd tank / heal / buff, classes toujours réparties)
const AF_TANKS = 2;
const AF_HEALS = { 10: 2, 20: 4, 40: 8 };
const AF_STATUS = { primary: 0, late: 1, tentative: 2, bench: 3 };
const AF_MIN_FILL = 0.8;

function afRoleKey(u) { return u.role === "Tank" ? "Tank" : u.role === "Healer" ? "Healer" : "Dps"; }
const afC = c => u => u.class === c;
const afS = (c, ...s) => u => u.class === c && s.includes(u.spec);
const afCount = (list, t) => list.filter(t).length;

// Étapes des buffs / debuffs de raid. need(compo) = l'étape manque ; opts = persos possibles (t) et groupes voulus (g :
// liste, fonction du perso, ou rien = groupe par défaut) ; split = options « ou » réparties entre les compos
const AF_STEPS = [
  { need: c => !c.some(afC("WARRIOR")), opts: [{ t: afC("WARRIOR") }] },                                   // Battle Shout (+ Sunder)
  { need: c => !c.some(afS("DRUID", "Feral", "Guardian")),                                                 // Leader of the Pack
    opts: [{ t: afS("DRUID", "Feral", "Guardian"), g: u => u.role === "Tank" ? [1] : [2] }] },
  { need: c => !c.some(afS("DRUID", "Balance")), opts: [{ t: afS("DRUID", "Balance"), g: [3, 4] }] },     // Moonkin Aura
  { need: c => !c.some(afS("SHAMAN", "Restoration")), opts: [{ t: afS("SHAMAN", "Restoration"), g: [4] }] }, // Mana Tide (+ Mana Spring)
  { need: c => afCount(c, afC("SHAMAN")) < 1, opts: [{ t: afC("SHAMAN"), g: [4, 1, 2, 3] }] },             // Strength of Earth, Flametongue, Windfury
  { need: c => afCount(c, afC("SHAMAN")) < 2, opts: [{ t: afC("SHAMAN"), g: [1, 4, 2, 3] }] },             // Grace of Air
  { need: c => afCount(c, afC("SHAMAN")) < 3, opts: [{ t: afC("SHAMAN"), g: [2] }] },                      // Tranquil Air + Mana Spring
  { need: c => afCount(c, afC("SHAMAN")) < 4, opts: [{ t: afC("SHAMAN"), g: [3] }] },                      // Tranquil Air + Mana Spring
  { need: c => !c.some(afC("PRIEST")), opts: [{ t: afC("PRIEST"), g: [4, 3] }] },                          // Fortitude + Spirit
  { need: c => !c.some(afS("PRIEST", "Shadow")), opts: [{ t: afS("PRIEST", "Shadow"), g: [4, 3] }] },      // Dark Inspiration + Vampiric Embrace (groupe)
  { need: c => !c.some(afC("DRUID")), opts: [{ t: afC("DRUID"), g: u => u.spec === "Restoration" ? [4, 3] : null }] }, // Gift of the Wild
  { need: c => !c.some(afC("MAGE")), opts: [{ t: afC("MAGE"), g: [3, 4, 2] }] },                           // Arcane Brilliance
  { need: c => !c.some(afC("WARLOCK")), opts: [{ t: afC("WARLOCK"), g: [3, 4, 2] }] },                     // Curse of the Elements
  { need: c => !c.some(afC("WARRIOR")) && !c.some(afC("ROGUE")), split: true,                             // Sunder / Expose Armor
    opts: [{ t: afC("WARRIOR") }, { t: afC("ROGUE") }] },
  { need: c => !c.some(afC("DRUID")),                                                                      // Faerie Fire
    opts: [{ t: afS("DRUID", "Balance"), g: [3, 4] }, { t: afS("DRUID", "Guardian") }, { t: afS("DRUID", "Feral") }, { t: afS("DRUID", "Restoration"), g: [4, 3] }] },
  { need: c => !c.some(afC("SHAMAN")) && !c.some(afC("PRIEST")), split: true,                             // Purge / Dispel Magic
    opts: [{ t: afC("SHAMAN") }, { t: afC("PRIEST"), g: [4, 3] }] },
  { need: c => !c.some(afC("HUNTER")), opts: [{ t: afC("HUNTER") }] },                                     // Tranquilizing Shot
  { need: c => afCount(c, afC("PALADIN")) < 1, opts: [{ t: afC("PALADIN") }] },                            // Kings + Salvation
  { need: c => afCount(c, afC("PALADIN")) < 2, opts: [{ t: afC("PALADIN") }] },                            // Might
  { need: c => afCount(c, afC("PALADIN")) < 3, opts: [{ t: afC("PALADIN") }] },                            // Wisdom
  { need: c => afCount(c, afC("PALADIN")) < 4, opts: [{ t: afC("PALADIN") }] },                            // Light
];

// présence incertaine (Late, Tentative, Bench) : répartie entre les compos
const afUnsure = u => u.status === "late" || u.status === "tentative" || u.status === "bench";
// comparaison lexicographique de deux listes de nombres
function afLess(a, b) { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i]; return false; }
// Résolution des conflits entre compos : priorités = 1 tank et 1 heal minimum, puis les étapes de buffs dans l'ordre.
// On cherche le déplacement (perso d'une compo vers une autre qui a de la place) ou l'échange (deux persos) qui améliore
// le plus le nombre de compos satisfaisant chaque priorité, comparé priorité par priorité (une compo qui gagne un tank
// vaut plus que tous les buffs perdus ailleurs) ; on recommence tant qu'un échange améliore.
const AF_ROLE_STEPS = [
  { need: c => !c.some(u => afRoleKey(u) === "Tank") },
  { need: c => !c.some(u => afRoleKey(u) === "Healer") },
];
function afRepair(bal, size) {
  const steps = AF_ROLE_STEPS.concat(AF_STEPS);
  const sat = c => steps.map(st => st.need(c) ? 0 : 1);
  const better = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i]; return false; };
  for (let guard = 0; guard < 60; guard++) {
    const base = bal.map(sat), zero = steps.map(() => 0);
    let best = null, bestD = zero;
    const consider = (ci, di, u, v, cNew, dNew) => {
      const a = sat(cNew), b = sat(dNew);
      const delta = steps.map((_, j) => a[j] + b[j] - base[ci][j] - base[di][j]);
      if (better(delta, bestD)) { best = { ci, di, u, v }; bestD = delta; }
    };
    bal.forEach((c, ci) => bal.forEach((d, di) => {
      if (ci === di) return;
      for (const u of d) {
        const dA = d.filter(x => x !== u);
        if (c.length < size) consider(ci, di, u, null, c.concat([u]), dA);
        for (const v of c) consider(ci, di, u, v, c.filter(x => x !== v).concat([u]), dA.concat([v]));
      }
    }));
    if (!best) return;
    const c = bal[best.ci], d = bal[best.di];
    d.splice(d.indexOf(best.u), 1); c.push(best.u);
    if (best.v) { c.splice(c.indexOf(best.v), 1); d.push(best.v); }
  }
}
// tri stable par clé numérique
const afSort = (list, key) => list.map((u, i) => [u, i]).sort((a, b) => key(a[0]) - key(b[0]) || a[1] - b[1]).map(x => x[0]);

// comps = membres déjà placés de chaque compo (dans l'ordre chronologique) ; buffsOnly = « Autofill Buffs »
// -> { comps : membres de chaque compo (déjà placés d'abord), prefs : Map perso -> groupes voulus }
function afPlan(candidates, size, comps, buffsOnly) {
  const hReq = AF_HEALS[size], roleCap = { Tank: AF_TANKS, Healer: hReq, Dps: size - AF_TANKS - hReq };
  let pool = afSort(candidates, u => AF_STATUS[u.status] ?? 0);
  const out = comps.map(c => c.slice()), prefs = new Map();
  // compos équilibrées : au moins 80 % de chacune remplissable
  const total = pool.length + out.reduce((t, c) => t + c.length, 0);
  let k = Math.max(1, out.length);
  while (k > 1 && total < Math.ceil(k * size * AF_MIN_FILL)) k--;
  const bal = out.slice(0, k);
  const roleCount = (c, rk) => c.filter(m => afRoleKey(m) === rk).length;
  const takeOut = u => { pool = pool.filter(x => x !== u); };

  // 2. buffs : étape par étape, toutes les compos (jamais sautée faute de place de rôle). Parmi les persos possibles :
  //    rôle encore nécessaire (tank / heal sous le minimum) > dps > tank / heal en surplus (heals jusqu'à 1,5 fois la
  //    normale) > n'importe lequel ; toujours une place laissée pour 1 tank et 1 heal minimum
  const buffCap = { Tank: AF_TANKS, Healer: Math.ceil(hReq * 1.5), Dps: size - AF_TANKS - hReq };
  const fits = (c, u) => {
    const rk = afRoleKey(u);
    const miss = (rk !== "Tank" && roleCount(c, "Tank") < 1 ? 1 : 0) + (rk !== "Healer" && roleCount(c, "Healer") < 1 ? 1 : 0);
    return size - c.length - 1 >= miss;
  };
  const tier = (c, u) => {
    const rk = afRoleKey(u), n = roleCount(c, rk);
    if (rk !== "Dps" && n < (rk === "Tank" ? AF_TANKS : hReq)) return 0;
    if (rk === "Dps" && n < roleCap.Dps) return 1;
    return n < buffCap[rk] ? 2 : 3;
  };
  const applySteps = () => { for (const step of AF_STEPS) {
    bal.forEach((c, ci) => {
      if (c.length >= size || !step.need(c)) return;
      const n = step.opts.length, first = step.split ? Math.min(ci, n - 1) : 0;
      const order = step.opts.slice(first).concat(step.opts.slice(0, first));
      for (const o of order) {
        let u = null, ut = 9;
        for (const x of pool) { if (!o.t(x) || !fits(c, x)) continue; const t = tier(c, x); if (t < ut) { u = x; ut = t; } }
        if (!u) continue;
        c.push(u); takeOut(u);
        const g = typeof o.g === "function" ? o.g(u) : o.g;
        if (g) prefs.set(u, g);
        break;
      }
    });
  } };
  applySteps();
  if (buffsOnly) { afRepair(bal, size); applySteps(); }
  if (!buffsOnly) {
    // 3a. tanks et heals requis, niveau par niveau : 1 tank puis 1 heal dans chaque compo, puis le 2e de chaque, etc.
    for (let lvl = 1; lvl <= Math.max(AF_TANKS, hReq); lvl++) {
      for (const [rk, req] of [["Tank", AF_TANKS], ["Healer", hReq]]) {
        if (lvl > req) continue;
        for (const c of bal) {
          if (c.length >= size || roleCount(c, rk) >= lvl) continue;
          const u = pool.find(x => afRoleKey(x) === rk);
          if (u) { c.push(u); takeOut(u); }
        }
      }
    }
    // conflits (tank / heal manquant, buff pris ailleurs) : échanges entre compos, puis étapes de nouveau (réserve)
    afRepair(bal, size);
    applySteps();
    // 3b. dps puis tanks / heals en surplus : rôle sous son plafond, puis le moins de persos de sa classe, puis (présence
    //     incertaine) le moins de persos de sa classe incertains, puis la compo la moins remplie
    const order = pool.filter(u => afRoleKey(u) === "Dps").concat(pool.filter(u => afRoleKey(u) !== "Dps"));
    for (const u of order) {
      let best = null, bestKey = null;
      for (const c of bal) {
        if (c.length >= size) continue;
        const rk = afRoleKey(u), same = c.filter(m => m.class === u.class);
        const key = [roleCount(c, rk) >= roleCap[rk] ? 1 : 0, same.length, afUnsure(u) ? same.filter(afUnsure).length : 0, c.length];
        if (!bestKey || afLess(key, bestKey)) { best = c; bestKey = key; }
      }
      if (best) { best.push(u); takeOut(u); }
    }
    // 3c. le reste dans les compos suivantes, une à la fois
    for (const c of out.slice(k)) {
      while (c.length < size && pool.length) c.push(pool.shift());
    }
  }
  return { comps: out, prefs };
}

const afShadowBal = u => (u.class === "PRIEST" && u.spec === "Shadow") || (u.class === "DRUID" && u.spec === "Balance");
// groupes voulus d'un perso (numéros 1..8), ramenés aux groupes de la compo : 10 joueurs 3 -> 1, 4 -> 2 ;
// 40 joueurs : les mêmes + 4 en secours
// chamans Enhancement / Elemental : groupes propres à leur spé, avant ceux de l'étape de buffs
const AF_SHAMAN_GROUPS = { Enhancement: [2, 1, 3, 4], Elemental: [3, 2, 4, 1] };
function afGroupPrefs(u, members, prefs, G) {
  // raid 10 : pas de règles de groupe des raids 20 (G1 puis G2 ; seuls les chamans sont dispersés)
  if (G <= 2) return [1, 2].slice(0, G);
  let p = (u.class === "SHAMAN" && AF_SHAMAN_GROUPS[u.spec]) || (prefs && prefs.get(u));
  if (!p) {
    if (u.role === "Healer") p = [4];
    else if (afShadowBal(u)) p = [4, 3];
    else if (u.role === "Tank") p = [1];
    else if (u.class === "HUNTER" || u.role === "Melee") p = [2, 1];
    else if (u.role === "Ranged") p = members.some(afShadowBal) ? [3, 1, 2] : [3, 4, 1, 2];
    else p = [1, 2, 3, 4];
  }
  const out = [];
  for (const g of p) { const m = G >= 4 ? g : ((g - 1) % G) + 1; if (!out.includes(m)) out.push(m); }
  if (G > 4) for (const g of out.slice()) if (g + 4 <= G && !out.includes(g + 4)) out.push(g + 4);
  return out;
}
// ordre de placement : persos choisis pour un buff (ordre des étapes), puis heals, tanks, Shadow / Balance, mêlées,
// chasseurs, casters
function afPlaceRank(u, prefs) {
  if ((prefs && prefs.get(u)) || (u.class === "SHAMAN" && AF_SHAMAN_GROUPS[u.spec])) return 0;
  if (u.role === "Healer") return 1;
  if (u.role === "Tank") return 2;
  if (afShadowBal(u)) return 3;
  if (u.role === "Melee") return 4;
  if (u.class === "HUNTER") return 5;
  return 6;
}

// Place les nouveaux venus (dans l'ordre afPlaceRank) dans les cases libres de leurs groupes voulus ; bySlot = occupants
// { case: unité }, complété ; retourne { case: unité } des nouveaux
function afPlaceNew(bySlot, newcomers, size, prefs) {
  const added = {};
  for (const u of afSort(newcomers, x => afPlaceRank(x, prefs))) {
    const s = afFreeSlot(bySlot, u, size, prefs);
    if (!s) continue;
    bySlot[s] = u; added[s] = u;
  }
  return added;
}
// compo vide : { case: unité }
const afGroups = (members, size, prefs) => afPlaceNew({}, members, size, prefs);
// case libre pour un perso ajouté à une compo déjà remplie en partie (Autofill Buffs) : dans un de ses groupes voulus
// (chaman : groupe sans chaman d'abord) ; bySlot = { case: unité } des occupants
function afFreeSlot(bySlot, u, size, prefs) {
  const G = size / 5, members = Object.values(bySlot);
  let list = afGroupPrefs(u, members, prefs, G);
  for (let g = 1; g <= G; g++) if (!list.includes(g)) list.push(g);
  // chamans dispersés au maximum : groupe avec le moins de chamans d'abord (à égalité, l'ordre voulu)
  const shams = g => { let n = 0; for (let s = (g - 1) * 5 + 1; s <= g * 5; s++) if (bySlot[s] && bySlot[s].class === "SHAMAN") n++; return n; };
  if (u.class === "SHAMAN") list = list.map((g, i) => [g, shams(g), i]).sort((a, b) => a[1] - b[1] || a[2] - b[2]).map(x => x[0]);
  for (const g of list) for (let s = (g - 1) * 5 + 1; s <= g * 5; s++) if (!bySlot[s]) return s;
  return null;
}

// Affinités : comps = membres de chaque compo (les fixed[i] premiers déjà placés ne bougent pas) ; w(u, v) = poids de la
// paire (somme des deux notes : +4 à -4). Échange de deux nouveaux venus de même rôle entre deux compos : le meilleur
// gain d'abord, tant qu'un échange améliore ; refusé si une compo perd une priorité (tank, heal, étape de buffs) ou si
// l'écart de nombre d'une classe entre les deux compos grandit (au-delà de 1)
function afSocial(comps, fixed, size, w) {
  const steps = AF_ROLE_STEPS.concat(AF_STEPS);
  const sat = c => steps.map(st => st.need(c.slice(0, size)) ? 0 : 1);
  const keeps = (a, b) => a.every((x, j) => b[j] >= x);
  const nCls = (c, cls) => c.filter(m => m.class === cls).length;
  const gainIn = (c, out, inn) => c.reduce((t, x) => x === out ? t : t + w(inn, x) - w(out, x), 0);
  for (let guard = 0; guard < 200; guard++) {
    const base = comps.map(sat);
    let best = null, bestG = 0;
    comps.forEach((c, ci) => comps.forEach((d, di) => {
      if (di <= ci) return;
      for (let i = fixed[ci] || 0; i < c.length; i++) for (let j = fixed[di] || 0; j < d.length; j++) {
        const u = c[i], v = d[j];
        if (afRoleKey(u) !== afRoleKey(v)) continue;
        const g = gainIn(c, u, v) + gainIn(d, v, u);
        if (g <= bestG) continue;
        const c2 = c.slice(), d2 = d.slice();
        c2[i] = v; d2[j] = u;
        if (!keeps(base[ci], sat(c2)) || !keeps(base[di], sat(d2))) continue;
        if (u.class !== v.class && [u.class, v.class].some(k =>
          Math.abs(nCls(c2, k) - nCls(d2, k)) > Math.max(1, Math.abs(nCls(c, k) - nCls(d, k))))) continue;
        best = { ci, di, i, j }; bestG = g;
      }
    }));
    if (!best) return;
    const c = comps[best.ci], d = comps[best.di], u = c[best.i];
    c[best.i] = d[best.j]; d[best.j] = u;
  }
}
