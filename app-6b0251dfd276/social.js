"use strict";
// Settings > Social : Preference Score, note de 1 à 5 donnée à chaque joueur du serveur Discord (envie de jouer avec
// lui). Personnelle et cachée de tous, officiers compris : gardée sur le serveur, l'appli ne reçoit que ses propres
// notes ; les officiers reçoivent seulement, pour chaque paire de joueurs, la somme des poids des deux notes
// (ST.socialPairs) : score social de chaque compo (Raid Comps, officiers seulement) et autofill.
// Poids : 1 Hate -2, 2 Avoid -1, 3 Even ou pas de note 0, 4 Like +1, 5 BFF +2. Jauge vide tant que le joueur n'a pas noté.

const SOC_LABELS = ["", "Hate", "Avoid", "Even", "Like", "BFF"];
const SOC_STAR_SVG = '<svg viewBox="0 0 24 24"><path d="M12 2.6l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.5l-5.9 3.1 1.2-6.5-4.8-4.6 6.6-.9z"/></svg>';
let SOC = null, socLoading = false;
const socSeq = {};

// id Discord d'un perso (inscription, propriétaire du perso partagé, ou tag de la note de guilde)
let sidST = null, sidMap = null;
function tagToDiscordId() {
  if (sidST === ST && sidMap) return sidMap;
  const m = {};
  for (const ev of ST.events || []) for (const s of ev.signups || []) if (s.tag && s.uid) m[s.tag] = s.uid;
  for (const [uid, tag] of Object.entries(ST.links || {})) if (tag) m[tag] = m[tag] || uid;
  for (const g of ST.guildUsers || []) if (g.u) m[g.u] = m[g.u] || g.id;
  sidST = ST;
  return (sidMap = m);
}
const socialId = u => (u && (u.uid || ((ST.charOwners || {})[u.name] || {}).id || (u.tag && tagToDiscordId()[u.tag]))) || null;
// somme des poids des deux notes entre deux joueurs (0 si même joueur, inconnu ou pas noté)
function socialPair(a, b) {
  if (!a || !b || a === b) return 0;
  return (ST.socialPairs || {})[a < b ? `${a}|${b}` : `${b}|${a}`] || 0;
}
const socialW = (u, v) => socialPair(socialId(u), socialId(v));
// score social d'une compo : toutes les paires de joueurs différents (un joueur avec deux persos compte une fois)
function socialScoreOf(comp) {
  const ids = [...new Set(Object.values(comp.c || {}).filter(Boolean).map(n => socialId(unitFor(n))).filter(Boolean))];
  let t = 0;
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) t += socialPair(ids[i], ids[j]);
  return t;
}
// indicateur à gauche du bouton des assigns : officiers seulement, jamais dans les images ni les messages envoyés
function socialBadge(comp) {
  if (!isOfficerUser()) return "";
  const s = socialScoreOf(comp);
  return `<span class="csoc${s > 0 ? " pos" : s < 0 ? " neg" : ""}" data-help="Social score: how much the players of this comp like to play together (Preference Scores, Settings > Social). Officers only, never sent.">${s > 0 ? "+" + s : s}</span>`;
}

// joueurs : membres du serveur Discord (bot, gardés par l'exe : ST.discordMembers), utilisateurs de Guild Tool,
// inscrits Raid-Helper, propriétaires de persos ; withMe = moi compris
function socialPlayers(withMe) {
  const me = myId(), out = new Map();
  const add = (id, name, user) => {
    id = String(id || "");
    if (!/^\d{5,25}$/.test(id) || (id === me && !withMe)) return;
    const p = out.get(id) || { id, name: "", user: "" };
    if (name && !p.name) p.name = name;
    if (user && !p.user) p.user = user;
    out.set(id, p);
  };
  for (const p of (ST.discordMembers || {}).players || []) add(p.id, p.name, p.username);
  for (const g of ST.guildUsers || []) add(g.id, g.n, g.u);
  const evs = (ST.events || []).slice().sort((a, b) => (b.start || 0) - (a.start || 0));
  for (const ev of evs) for (const s of ev.signups || []) add(s.uid, s.n, s.tag);
  for (const o of Object.values(ST.charOwners || {})) if (o) add(o.id, o.name, null);
  for (const p of out.values()) if (!p.name) p.name = p.user || p.id;
  return [...out.values()];
}
// persos identifiés de chaque joueur (partagés via l'appli, ou du roster liés par le tag de la note de guilde)
function socialChars() {
  const n = {}, t = tagToDiscordId();
  const add = (id, name) => { if (id && !charGone(name)) (n[id] = n[id] || new Set()).add(name); };
  for (const [name, o] of Object.entries(ST.charOwners || {})) if (o) add(o.id, name);
  for (const [name, r] of Object.entries(ST.roster || {})) if (r && r.tag) add(t[r.tag], name);
  return n;
}

// Rôle Discord affiché (Members, colonne Role) : le premier de DISCORD_ROLES que le joueur a ; couronne = propriétaire
// du serveur. Rôles lus par le bot (ST.discordMembers), sinon ceux gardés pour les utilisateurs de Guild Tool
const DISCORD_ROLES = ["Officier", "Titulaire", "La Relève"];
const CROWN_SVG = '<svg class="crown" viewBox="0 0 24 24"><path d="M3 7.5l4.6 3.6L12 4.5l4.4 6.6L21 7.5l-1.8 10.5H4.8zM5 19.5h14v2H5z"/></svg>';
const roleKey = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
let drST = null, drMemo = null;
function discordRoles() {
  if (drST === ST && drMemo) return drMemo;
  const dm = ST.discordMembers || {}, byId = {}, of = {};
  for (const g of ST.guildUsers || []) { for (const r of g.rd || []) byId[r.id] = r; of[g.id] = g.r || []; }
  for (const r of dm.roles || []) byId[r.id] = r;
  for (const p of dm.players || []) of[p.id] = p.roles || [];
  drST = ST;
  return (drMemo = { byId, of, owner: dm.ownerId || null });
}
function discordRoleOf(id) {
  if (!id) return null;
  const d = discordRoles();
  let best = null, rank = 9;
  for (const rid of d.of[id] || []) {
    const r = d.byId[rid], i = r ? DISCORD_ROLES.findIndex(n => roleKey(n) === roleKey(r.name)) : -1;
    if (i >= 0 && i < rank) { rank = i; best = r; }
  }
  const owner = !!d.owner && d.owner === id;
  return best || owner ? { name: best ? best.name : "", color: best && best.color ? "#" + best.color.toString(16).padStart(6, "0") : null, rank, owner } : null;
}
// tri : propriétaire, puis Officier, Titulaire, La Relève, puis les autres
const discordRoleRank = id => { const r = discordRoleOf(id); return !r ? 9 : r.owner ? -1 : r.rank; };
function discordRoleHtml(id) {
  const r = discordRoleOf(id);
  if (!r) return "";
  return `${r.owner ? `<span class="dcrown" data-help="Owner of the Discord server">${CROWN_SVG}</span>` : ""}<span${r.color ? ` style="color:${r.color}"` : ""}>${esc(r.name)}</span>`;
}

const socLegend = () => `<b>${esc(L("Preference Score"))}</b>` + [5, 4, 3, 2, 1].map(i =>
  `<div class="soclg"><span class="stars on${i}">${SOC_STAR_SVG.repeat(5)}</span>${i} : ${esc(L(SOC_LABELS[i]))}</div>`).join("")
  + `<div class="p">${esc(L("Only you see your scores. No score counts as 3."))}</div>`;
function starsHtml(id, score) {
  return `<span class="stars" data-socid="${esc(id)}" data-tiphtml="${esc(socLegend())}">${[1, 2, 3, 4, 5].map(i =>
    `<button class="st${i <= score ? " on" : ""}" data-star="${i}">${SOC_STAR_SVG}</button>`).join("")}</span>`;
}

function renderSocial() {
  const box = $("#socialBox");
  if (!box) return;
  if (!(ST.cloud && ST.cloud.logged && ST.cloud.guild)) {
    box.innerHTML = `<p class="help">${L("Log in with Discord and choose your guild server to use this.")}</p>`; return;
  }
  if (!SOC && !socLoading) loadSocial();
  const open = UI.socialOpen !== false, sort = UI.socialSort || "alpha";
  if (!box.querySelector(".socsec")) {
    box.innerHTML = `<div class="socsec">
      <button class="sochead" data-socfold="1"><i class="tri"></i>${L("Preference Score")}</button>
      <div class="socbody">
        <p class="help">${L("How much you like to play with each player. Your scores are private: nobody sees them, not even the officers. Autofill uses them to put players who get along in the same comps.")}</p>
        <div class="soctop"><input id="socQ" placeholder="${esc(L("Search a Discord name"))}" autocomplete="off"><button class="ib" data-socref="1" data-help="Read the members of the Discord server again">↻</button></div>
        <div class="help socerr" id="socErr"></div>
        <div class="sochd"><span data-socsort="alpha" data-help="Sort by this column">${L("Discord")}</span><span data-socsort="chars" data-help="Identified characters of the player (sort by this column)">${L("Chars")}</span><span data-tiphtml="${esc(socLegend())}">${L("Score")}</span></div>
        <div class="soclist" id="socList"></div>
      </div></div>`;
  }
  box.querySelector(".socsec").classList.toggle("open", open);
  box.querySelectorAll("[data-socsort]").forEach(h => h.classList.toggle("on", h.dataset.socsort === sort));
  renderSocialList();
}
function renderSocialList() {
  const el = $("#socList");
  if (!el) return;
  if (!SOC) { el.innerHTML = `<div class="help">${L(socLoading ? "Loading…" : "Could not load the scores.")}</div>`; return; }
  const dm = ST.discordMembers || {}, err = $("#socErr");
  if (err) {
    err.hidden = !(dm.error || !dm.players);
    err.textContent = dm.error ? L("Discord member list unavailable: {0}", dm.error) : !dm.players ? L("Discord member list not read yet (Sync or ↻): only the known players are listed.") : "";
  }
  const q = (($("#socQ") || {}).value || "").trim().toLowerCase(), chars = socialChars(), sort = UI.socialSort || "alpha";
  const nOf = p => (chars[p.id] || new Set()).size;
  const list = socialPlayers().filter(p => !q || p.name.toLowerCase().includes(q) || (p.user || "").toLowerCase().includes(q));
  list.sort((a, b) => (sort === "chars" ? nOf(b) - nOf(a) : 0) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  const scroll = el.scrollTop;
  el.innerHTML = list.map(p => `<div class="socrow"><span class="socn"><b>${esc(p.name)}</b>${p.user && p.user !== p.name ? `<small>@${esc(p.user)}</small>` : ""}</span>
    <span class="socc${nOf(p) ? "" : " mute"}">${nOf(p) || "-"}</span>${starsHtml(p.id, +SOC.scores[p.id] || 0)}</div>`).join("")
    || `<div class="help">${L(q ? "No player matches." : "No player found yet: Sync first.")}</div>`;
  el.scrollTop = scroll;
}
async function loadSocial(force) {
  socLoading = true;
  if (force) SOC = null;
  renderSocialList();
  const r = await api().social_get();
  socLoading = false;
  if (r && r.ok !== false) SOC = { scores: r.scores || {} };
  else if (r && r.error) toast(r.error, true);
  renderSocial();
}

document.addEventListener("click", async e => {
  const t = e.target;
  if (!(t.closest && t.closest("#socialBox"))) return;
  if (t.closest("[data-socfold]")) { UI.socialOpen = UI.socialOpen === false; saveUI(); renderSocial(); return; }
  if (t.closest("[data-socref]")) {
    const b = t.closest("[data-socref]");
    b.disabled = true;
    const r = await api().discord_members_refresh();
    b.disabled = false;
    if (r && r.ok !== false) { ST.discordMembers = r.discordMembers || {}; drST = null; }
    else toast((r && r.error) || "Error", true);
    renderSocial(); if (UI.page === "members") render(); return;
  }
  const h = t.closest("[data-socsort]");
  if (h) { UI.socialSort = h.dataset.socsort; saveUI(); renderSocial(); return; }
  const st = t.closest("[data-star]");
  if (!st || !SOC) return;
  // clic sur la note déjà choisie : retirée (jauge vide, compte comme 3)
  // plusieurs clics d'affilée : chaque note garde son affichage immédiat ; seule la DERNIÈRE réponse d'un joueur est
  // prise en compte (les réponses d'avant, arrivées en retard, n'effacent rien)
  const id = st.closest("[data-socid]").dataset.socid, old = +SOC.scores[id] || 0;
  const score = +st.dataset.star === old ? 0 : +st.dataset.star;
  if (score) SOC.scores[id] = score; else delete SOC.scores[id];
  const seq = socSeq[id] = (socSeq[id] || 0) + 1;
  renderSocialList();
  const r = await api().social_set(id, score);
  if (socSeq[id] !== seq) return;
  if (!r || r.ok === false) {
    if (old) SOC.scores[id] = old; else delete SOC.scores[id];
    renderSocialList();
    toast((r && r.error) || "Error", true); return;
  }
  if (r.pairs) { ST.socialPairs = r.pairs; render(); }
});
document.addEventListener("input", e => { if (e.target.id === "socQ") renderSocialList(); });
