"use strict";
// Fenêtres d'event du calendrier (même style que Settings, au milieu de l'écran) :
//  - création / modification : type (Main / Commu, officiers), salon, titre, description, heure, Ping (officiers),
//    copie des inscriptions (Main) ; Entrée passe au champ suivant (boutons compris) ;
//  - réaction à un event : perso + spé (events communautaires), note, Sign / Late / Tentative / Absence ;
//    officiers : Edit Event, Delete Event (confirmation possible après 1,5 s).

// salons par défaut des events créés : réglages Admin (Main raid / Raid commu)
const defChan = kind => kind === "main" ? mainChan() : commuChan();
const isOfficerUser = () => !!(ST.canEdit && ST.cloud && ST.cloud.member && ST.cloud.member.officer) || !!(ST.cloud && ST.cloud.member && ST.cloud.member.admin);
let evw = null;   // état de la fenêtre ouverte

// icônes des boutons (couleur du texte du bouton : currentColor)
const EV_ICO = {
  check: '<svg class="efi" viewBox="0 0 24 24"><path d="M4 12.8l5.2 5.2L20.5 6.5" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  pencil: '<svg class="efi" viewBox="0 0 24 24"><path fill="currentColor" fill-rule="evenodd" d="M17.2 1.9a1.6 1.6 0 0 1 2.3 0l2.6 2.6a1.6 1.6 0 0 1 0 2.3l-1.6 1.6-4.9-4.9zM14.4 4.7l4.9 4.9L8.6 20.3 2 22l1.7-6.6zM5.4 16.6l-.9 2.9 2.9-.9zM13.2 8.6l-6.7 6.7 1.3 1.3 6.7-6.7z"/></svg>',
  trash: '<svg class="efi" viewBox="0 0 24 24"><path fill="currentColor" fill-rule="evenodd" d="M9.2 2.5h5.6a1.6 1.6 0 0 1 1.6 1.6V5H21v2.3H3V5h4.6v-.9a1.6 1.6 0 0 1 1.6-1.6zm.3 1.7V5h5v-.8zM4.9 8.6h14.2l-1.1 11.9a1.7 1.7 0 0 1-1.7 1.5H7.7A1.7 1.7 0 0 1 6 20.5zm3.6 2.4v8h1.6v-8zm2.7 0v8h1.6v-8zm2.7 0v8h1.6v-8z"/></svg>',
  comps: '<svg class="efi" viewBox="0 0 24 24"><g fill="currentColor"><rect x="3" y="3.5" width="8" height="8" rx="1"/><rect x="13" y="3.5" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/></g></svg>',
};
const openEventComps = ev => { if (ev) openWeek(ev.start, ev.id); };
// boutons du bas d'un event déjà créé : Edit Event, Delete Event (officiers), Compos (tout le monde), côte à côte
const evActions = off => `<div class="efrow evacts">${off ? `<button class="efbtn wtxt" data-nav data-evedit="1">${EV_ICO.pencil}<span>${L("Edit Event")}</span></button>
      <button class="efbtn wtxt danger" data-nav data-evdel="1">${EV_ICO.trash}<span>${L("Delete Event")}</span></button>` : ""}
      <button class="efbtn wtxt" data-nav data-evcomps="1" data-help="Open the Raid Comps of this event.">${EV_ICO.comps}<span>${L("Compos")}</span></button></div>`;

// Compos qui utilisent l'event (visibles par moi) : raid 20 > 10 > 40, raids 10 côte à côte ; groupes simplifiés
function eventCompsHtml(ev) {
  const rank = { 20: 0, 10: 1, 40: 2 };
  const comps = Object.values(ST.weeks || {}).flatMap(w => w.comps || []).concat(ccompList())
    .filter(c => c.event === ev.id && !c.deleted && canSeeComp(c))
    .map((c, i) => [c, i]).sort((a, b) => (rank[+((raidByKey(a[0].raid) || {}).size)] ?? 3) - (rank[+((raidByKey(b[0].raid) || {}).size)] ?? 3) || a[1] - b[1])
    .map(x => x[0]);
  if (!comps.length) return "";
  return `<div class="evcomps">${comps.map(c => {
    const r = raidByKey(c.raid) || {}, size = +r.size || 20, groups = [];
    for (let g = 0; g < size / 5; g++) {
      let rows = "";
      for (let k = 1; k <= 5; k++) {
        const n = c.c[g * 5 + k], u = n && compUnit(c, n);
        rows += u ? `<div class="mgs" style="--c:${CLASS_COLOR[u.class] || "#fff"}">${specImg(u)}<span>${nameHtml(u.display, true)}</span></div>`
          : `<div class="mgs empty">${esc(L("Empty"))}</div>`;
      }
      groups.push(`<div class="mgrp"><div class="mgh">${esc(L("Group"))} ${g + 1}</div>${rows}</div>`);
    }
    // cadre avec l'image thématique du raid (comme dans Raid Comps)
    return `<div class="mcomp s${size}" style="--bg-img:${r.bg ? `url('${r.bg}')` : "none"}"><div class="mct"><span>${esc(r.name || "?")}</span><button class="mcasg" data-evassign="${c.id}" data-help="Open the assigns of this comp">${ASSIGN_SVG}<span>${esc(L("Assigns"))}</span></button></div><div class="mcg">${groups.join("")}</div></div>`;
  }).join("")}</div>`;
}
// bouton « Assigns » d'une compo de la fenêtre d'event : ferme la fenêtre et ouvre la page d'assigns de la compo
document.addEventListener("click", e => {
  const b = e.target.closest && e.target.closest("[data-evassign]");
  if (!b) return;
  e.stopPropagation();
  closeEvWin();
  openAssigns(b.dataset.evassign);
}, true);
function removeEvWin() { const w = $("#evWin"); if (w) w.remove(); }
function closeEvWin() { rememberEventWin(); evw = null; removeEvWin(); }
function evWinShell(title, body) {
  removeEvWin();          // l'état (evw) préparé par l'appelant est gardé
  const w = document.createElement("div");
  w.className = "fwin evwin";
  w.id = "evWin";
  w.innerHTML = `<div class="fwbar"><span class="evtitle">${esc(title)}</span><button class="fwx" data-evclose="1" data-help="Close (Esc)">×</button></div>
    <div class="fwbody evbody">${body}</div>`;
  document.body.appendChild(w);
  return w;
}
const dayTitle = (y, m, d) => { const t = new Date(y, m, d, 12); const s = t.toLocaleString(LOC(), { weekday: "long" }); return s.charAt(0).toUpperCase() + s.slice(1) + " " + String(d).padStart(2, "0") + "/" + String(m + 1).padStart(2, "0"); };
const lbl = text => `<div class="eflbl">${esc(L(text))}</div>`;
const chanName = id => (ST.rhChannels || {})[id] || id || "";

// ---------------------------------------------------------------- création / modification
function openEventWin(day, ev) {
  const y = Math.floor(+day / 10000), m = Math.floor(+day / 100) % 100 - 1, d = +day % 100;
  const off = isOfficerUser();
  const t0 = ev ? new Date(ev.start * 1000) : null;
  // création : paramètres de la dernière ouverture (type, salon, titre, description, heure, ping, copie)
  const last = (!ev && UI.evLast) || {};
  const main = ev ? !isCommuEvent(ev) && isMainEvent(ev) : off && (last.kind ? last.kind === "main" : true);
  const kind = main ? "main" : "commu";
  evw = {
    mode: ev ? "edit" : "create", ev, y, m, d, kind,
    channel: ev ? (ev.chId || "") : (kind === "main" && last.kind === "main" && last.channel) || defChan(kind),
    title: ev ? ev.title : (last.kind === kind && last.title != null ? last.title : main ? "Main Raid" : ""),
    desc: ev ? (ev.desc || "") : (last.desc || ""),
    min: t0 ? t0.getHours() * 60 + t0.getMinutes() : (last.min ?? 20 * 60 + 30),
    ping: ev ? "" : (off ? last.ping || "" : ""), copy: last.copy ?? true, off,
  };
  renderEventWin();
}
// fenêtre de création fermée (créée ou non) : ses paramètres sont gardés pour la prochaine fois
function rememberEventWin() {
  const s = evw, w = $("#evWin");
  if (!s || s.mode !== "create" || !w) return;
  const get = f => { const el = w.querySelector(`[data-f="${f}"]`); return el ? el.value.trim() : null; };
  const chEl = w.querySelector('[data-f="channel"]');
  UI.evLast = { kind: s.kind, title: get("title") ?? s.title, desc: get("desc") ?? s.desc, min: s.min,
                ping: get("ping") ?? s.ping, copy: s.copy, channel: chEl ? (/^\d+$/.test(chEl.value.trim()) ? chEl.value.trim() : chEl.dataset.id) : s.channel };
  saveUI();
}
function renderEventWin() {
  const s = evw;
  const kindBtns = s.off ? `${lbl("Event type")}<div class="efrow center">
      <button class="efbtn${s.kind === "main" ? " on" : ""}" data-nav data-kind="main">Main</button>
      <button class="efbtn${s.kind === "commu" ? " on" : ""}" data-nav data-kind="commu">Commu</button></div>` : "";
  // salon des events communautaires imposé (création d'un raid commu, officier compris ; membre : toujours)
  const lockChan = !s.off || (s.mode === "create" && s.kind === "commu");
  if (s.mode === "create" && s.kind === "commu") s.channel = commuChan();
  const body = `${s.mode === "create" ? kindBtns : ""}
    ${lbl("Channel")}<div class="efcombo"><input class="ef" data-nav data-f="channel" value="${esc(chanName(s.channel))}" data-id="${esc(s.channel)}"${lockChan ? " disabled" : ""} autocomplete="off"><div class="eflist" hidden></div></div>
    ${lbl("Title")}<input class="ef" data-nav data-f="title" value="${esc(s.title)}" autocomplete="off">
    ${lbl("Description")}<textarea class="ef" data-nav data-f="desc" rows="2">${esc(s.desc)}</textarea>
    ${s.mode === "edit" ? `<div class="efrow dtrow"><div>${lbl("Date")}<input class="ef date" data-nav data-f="date" value="${dateStr(s)}" data-help="Type the digits (day, month, year)" autocomplete="off"></div>
      <div>${lbl("Time")}<input class="ef time" data-nav data-f="time" value="${hhmm(s.min)}" data-help="Wheel or ↑ ↓: ±15 min · type the digits" autocomplete="off"></div></div>`
    : `${lbl("Time")}<input class="ef time" data-nav data-f="time" value="${hhmm(s.min)}" data-help="Wheel or ↑ ↓: ±15 min · type the digits" autocomplete="off">`}
    ${s.off ? `${lbl("Ping")}<input class="ef" data-nav data-f="ping" value="${esc(s.ping)}" placeholder="${esc(L("Role name, e.g. Titulaire"))}" autocomplete="off">` : ""}
    ${s.mode === "create" && s.kind === "main" ? `<div class="efrow sw"><span>${L("Copy sign-ups")}</span><button class="switch${s.copy ? " on" : ""}" data-nav data-f="copy"><i></i></button></div>` : ""}
    <button class="efbtn pri wide" data-nav data-evgo="1">${L(s.mode === "edit" ? "Save" : "Create")}</button>`;
  const w = evWinShell(dayTitle(s.y, s.m, s.d), body);
  const first = w.querySelector("[data-nav]:not([disabled])");
  if (first) first.focus();
}
function navNext(el) {
  const list = [...document.querySelectorAll("#evWin [data-nav]:not([disabled])")];
  const i = list.indexOf(el);
  if (i >= 0 && i < list.length - 1) list[i + 1].focus();
}
// heure : chiffres tapés (deux pour l'heure, deux pour les minutes, « : » fixe, valeurs bornées) ;
// 4 chiffres au plus (les suivants sont ignorés), Retour arrière / Suppr enlève le dernier
let timeBuf = "";
const timeDigits = min => hhmm(min).replace(":", "");
function showTimeBuf(el) { el.value = timeBuf.slice(0, 2).padEnd(2, "_") + ":" + timeBuf.slice(2, 4).padEnd(2, "_"); }
function timeType(el, digit) {
  if (timeBuf.length >= 4) return;
  let b = timeBuf + digit;
  if (b.length === 1 && +b > 2) b = "0" + b;                       // 3…9 : heure à un chiffre
  if (b.length === 2 && +b > 23) b = "23";
  if (b.length === 3 && +b[2] > 5) b = b.slice(0, 2) + "0" + b[2];  // minutes : 6…9 -> 06…09
  timeBuf = b;
  showTimeBuf(el);
  if (b.length === 4) evw.min = Math.min(23 * 60 + 59, (+b.slice(0, 2)) * 60 + Math.min(59, +b.slice(2)));
}
function timeBack(el) {
  timeBuf = timeBuf.slice(0, -1);
  showTimeBuf(el);
}
// date (modification d'un event) : jj/mm/aaaa tapés chiffre par chiffre, « / » fixes, jour et mois bornés,
// jour ramené au dernier du mois une fois l'année complète ; 8 chiffres au plus
let dateBuf = "";
const p2 = n => String(n).padStart(2, "0");
const dateStr = s => `${p2(s.d)}/${p2(s.m + 1)}/${s.y}`;
const dateDigits = s => dateStr(s).replace(/\//g, "");
function showDateBuf(el) { el.value = dateBuf.slice(0, 2).padEnd(2, "_") + "/" + dateBuf.slice(2, 4).padEnd(2, "_") + "/" + dateBuf.slice(4, 8).padEnd(4, "_"); }
// date complète : le chiffre tapé remplace celui sous le curseur (les « / » sont sautés), puis date remise d'aplomb
const DATE_POS = [0, 1, 3, 4, 6, 7, 8, 9];
function dateOverwrite(el, digit) {
  let pos = el.selectionStart ?? 0;
  if (pos === 2 || pos === 5) pos++;
  if (pos > 9) pos = 9;
  const chars = dateStr(evw).split("");
  chars[pos] = digit;
  const v = chars.join(""), y = +v.slice(6, 10), m = Math.min(12, Math.max(1, +v.slice(3, 5))) - 1;
  const d = Math.min(Math.max(1, +v.slice(0, 2)), new Date(y, m + 1, 0).getDate());
  setEvDate(el, new Date(Math.max(2000, Math.min(2099, y)), m, d));
  const next = DATE_POS.find(p => p > pos);
  el.selectionStart = el.selectionEnd = next ?? 10;
}
function setEvDate(el, dt) {
  evw.y = dt.getFullYear(); evw.m = dt.getMonth(); evw.d = dt.getDate();
  dateBuf = dateDigits(evw); el.value = dateStr(evw);
  const t = $("#evWin .evtitle"); if (t) t.textContent = dayTitle(evw.y, evw.m, evw.d);
}
// molette : jour suivant / précédent (le mois change au premier / dernier jour)
function dateStep(el, dir) {
  const pos = el.selectionStart;
  setEvDate(el, new Date(evw.y, evw.m, evw.d + dir, 12));
  if (pos !== null && document.activeElement === el) el.selectionStart = el.selectionEnd = pos;
}
function dateType(el, digit) {
  // date complète (pas vidée) : écrasement au curseur ; champ vidé : saisie de tous les chiffres d'un coup
  if (dateBuf.length >= 8) {
    const all = el.selectionStart === 0 && el.selectionEnd >= el.value.length;
    if (!all) { dateOverwrite(el, digit); return; }
    dateBuf = "";
  }
  let b = dateBuf + digit;
  if (b.length === 1 && +b > 3) b = "0" + b;                        // 4…9 : jour à un chiffre
  if (b.length === 2 && (+b > 31 || +b === 0)) b = +b === 0 ? "01" : "31";
  if (b.length === 3 && +b[2] > 1) b = b.slice(0, 2) + "0" + b[2];   // 2…9 : mois à un chiffre
  if (b.length === 4 && (+b.slice(2) > 12 || +b.slice(2) === 0)) b = b.slice(0, 2) + (+b.slice(2) === 0 ? "01" : "12");
  if (b.length === 5 && b[4] !== "2") b = b.slice(0, 4) + "2";       // années 2xxx
  dateBuf = b;
  if (b.length === 8) {
    const y = +b.slice(4), m = +b.slice(2, 4) - 1, last = new Date(y, m + 1, 0).getDate();
    const d = Math.min(+b.slice(0, 2), last);
    evw.y = y; evw.m = m; evw.d = d;
    dateBuf = dateDigits(evw);
    const t = $("#evWin .evtitle"); if (t) t.textContent = dayTitle(y, m, d);
  }
  showDateBuf(el);
}
function timeStep(el, dir) {
  evw.min = ((evw.min + dir * 15) % 1440 + 1440) % 1440;
  timeBuf = timeDigits(evw.min); el.value = hhmm(evw.min);
}
function fillChanList(el) {
  const list = el.parentElement.querySelector(".eflist"), q = el.value.trim().toLowerCase();
  const items = Object.entries(ST.rhChannels || {}).filter(([id, n]) => !q || n.toLowerCase().includes(q) || id.includes(q));
  list.innerHTML = items.map(([id, n]) => `<button data-pickchan="${id}"><span>${esc(n)}</span><small>${id}</small></button>`).join("")
    || `<div class="help">${L("Paste a channel id.")}</div>`;
  list.hidden = false;
}
async function submitEventWin() {
  const s = evw;
  const w = $("#evWin");
  const get = f => { const el = w.querySelector(`[data-f="${f}"]`); return el ? el.value.trim() : ""; };
  s.title = get("title"); s.desc = get("desc"); if (s.off) s.ping = get("ping");
  const chEl = w.querySelector('[data-f="channel"]');
  const typed = chEl.value.trim();
  s.channel = s.mode === "create" && s.kind === "commu" ? commuChan() : /^\d+$/.test(typed) ? typed : chEl.dataset.id;
  const start = Math.floor(new Date(s.y, s.m, s.d, Math.floor(s.min / 60), s.min % 60).getTime() / 1000);
  const btn = w.querySelector("[data-evgo]");
  btn.disabled = true; btn.textContent = L("Sending…");
  const r = s.mode === "edit"
    // modification : Raid-Helper veut la date « JJ-MM-AAAA » et l'heure « HH:MM » (heure du serveur, pas d'unix)
    ? await api().rh_edit(s.ev.id, start, s.title, s.desc, s.channel, s.ping, `${p2(s.d)}-${p2(s.m + 1)}-${s.y}`, hhmm(s.min))
    : await api().rh_create(s.kind, start, s.title, s.desc, s.channel, s.ping, s.kind === "main" && s.copy);
  if (!r || r.ok === false) { toast((r && r.error) || "Error", true); btn.disabled = false; btn.textContent = L(s.mode === "edit" ? "Save" : "Create"); return; }
  toast((s.mode === "edit" ? L("Event updated.") : s.kind === "main" && s.copy ? L("Main Raid created ({0} sign-ups copied).", r.copied || 0) : L("Event created."))
    + (r.absent ? " " + L("{0} player(s) marked absent (absence days).", r.absent) : ""));
  closeEvWin(); liveNow();
}

// ---------------------------------------------------------------- réaction à un event
function openReactWin(evId) {
  const ev = eventById(evId);
  if (!ev) return;
  const t = new Date(ev.start * 1000);
  const commu = isCommuEvent(ev);
  // déjà inscrit : Sign en surbrillance (re-clic = désinscription)
  const signed = myStatus(ev) === "sign";
  evw = { mode: "react", ev, commu, signed, char: "", cls: "", spec: "", note: "", off: isOfficerUser(), delArmed: 0 };
  // event communautaire : 1er perso de ma liste (ordre choisi dans le cadre Login) et sa spé de l'Event Class
  const firstChar = commu && orderedMyChars().find(c => !c.hidden);
  if (firstChar) { evw.char = firstChar.name; evw.cls = firstChar.class; evw.spec = classEventSpec(firstChar.class); }
  const icon = (k, e) => reactIcon(k, e);
  const st = myStatus(ev), on = k => st === k ? " on" : "";
  const body = `${commu ? `${lbl("Character")}<div class="efcombo"><input class="ef" data-nav data-f="char" value="${esc(evw.char)}" style="color:${CLASS_COLOR[evw.cls] || "#fff"}" placeholder="${esc(L("Type to find your character"))}" autocomplete="off"><div class="eflist" hidden></div></div>
      <div class="efcombo"><input class="ef" data-nav data-f="spec" readonly value="${esc(plainRhSpec(evw.spec))}" placeholder="${esc(L("spec"))}" autocomplete="off"><div class="eflist" hidden></div></div>` : ""}
    <textarea class="ef" data-nav data-f="note" rows="2" placeholder="${esc(L("note"))}"></textarea>
    <div class="efrow react4">
      <button class="efbtn signw wtxt${signed ? " on" : ""}" data-nav data-rk="sign"${signed ? ` data-help="${esc(L("You are signed up: click to remove your sign-up from the event."))}"` : ""}>${EV_ICO.check}<span>${L(signed ? "Signed" : "Sign")}</span></button>
      <button class="efbtn ico${on("late")}" data-nav data-rk="late" data-help="${esc(L("Late"))}">${icon("late", "🕐")}</button>
      <button class="efbtn ico${on("tentative")}" data-nav data-rk="tentative" data-help="${esc(L("Tentative"))}">${icon("tentative", "⚖️")}</button>
      <button class="efbtn ico${on("absence")}" data-nav data-rk="absence" data-help="${esc(L("Absence"))}">${icon("absence", "❌")}</button></div>
    ${evActions(evw.off)}${eventCompsHtml(ev)}`;
  const w = evWinShell(`${ev.title} · ${dayTitle(t.getFullYear(), t.getMonth(), t.getDate())} ${hhmm(t.getHours() * 60 + t.getMinutes())}`, body);
  // perso déjà choisi : focus sur Sign (la liste des persos reste fermée)
  const first = w.querySelector(evw.char ? '[data-rk="sign"]' : "[data-nav]");
  if (first) first.focus();
}
// Pris dans la compo visible de l'event : perso et spé de la compo (non modifiables), note, puis Late / Tentative /
// Absence : met à jour l'inscription et le bot prévient les officiers dans leur salon
function openPresenceWin(evId, spot) {
  const ev = eventById(evId);
  if (!ev) return;
  const t = new Date(ev.start * 1000), icon = (k, e) => reactIcon(k, e);
  // statut déjà choisi (late / tentative / absence) : bouton sélectionné, re-clic = réinscription
  const st = myStatus(ev), cur = st && st !== "sign" ? st : null;
  evw = { mode: "presence", ev, spot, cur, off: isOfficerUser(), delArmed: 0 };
  const col = CLASS_COLOR[spot.cls] || "#fff";
  const body = `${lbl("Character")}<input class="ef" value="${esc(spot.display)}" disabled style="color:${col};opacity:1">
    ${lbl("Spec")}<input class="ef" value="${esc(((spot.spec || "") + " " + L(CLASS_NAME[spot.cls] || "")).trim())}" disabled style="opacity:1">
    ${lbl("Note")}<textarea class="ef" data-nav data-f="note" rows="2" placeholder="${esc(L("Why? (sent to the officers)"))}"></textarea>
    <div class="efrow react3">${[["late", "🕐"], ["tentative", "⚖️"], ["absence", "❌"]].map(([k, e]) =>
      `<button class="efbtn ico wtxt${cur === k ? " on" : ""}" data-nav data-pk="${k}"${cur === k ? ` data-help="${esc(L("Click again to sign up again (back to the comp)."))}"` : ""}>${icon(k, e)}<span>${L(k === "late" ? "Late" : k === "tentative" ? "Tentative" : "Absence")}</span></button>`).join("")}</div>
    <div class="help center">${L(cur ? "Click the selected status again to sign up again." : "You are in the comp: the officers are pinged in their channel.")}</div>
    ${evActions(evw.off)}${eventCompsHtml(ev)}`;
  const w = evWinShell(`${ev.title} · ${dayTitle(t.getFullYear(), t.getMonth(), t.getDate())} ${hhmm(t.getHours() * 60 + t.getMinutes())}`, body);
  const first = w.querySelector("[data-nav]");
  if (first) first.focus();
}
async function sendPresence(kind, btn) {
  const s = evw, w = $("#evWin");
  const note = ((w.querySelector('[data-f="note"]') || {}).value || "").trim();
  w.querySelectorAll("[data-pk]").forEach(b => { b.disabled = true; });
  // statut déjà sélectionné : désélection = réinscription avec la classe / spé de la compo
  const back = s.cur === kind;
  btn.classList.toggle("on", !back);
  const rs = back ? rhSpecName(s.spot.cls, s.spot.spec) : "";
  const r = back ? await api().rh_sign(s.ev.id, "sign", rhClassName(s.spot.cls), rs, s.spot.display, note, true)
    : await api().rh_sign(s.ev.id, kind, "", "", s.spot.display, note, true);
  if (!r || r.ok === false) {
    toast((r && r.error) || "Error", true);
    w.querySelectorAll("[data-pk]").forEach(b => { b.disabled = false; });
    btn.classList.remove("on");
    return;
  }
  toast(back ? L("Signed up again.") : r.pinged === false ? L("Sign-up updated, but the officers could not be pinged: {0}", r.pingError || "") : L("Sign-up updated, the officers are notified."), !back && r.pinged === false);
  closeEvWin(); liveNow();
}
// mes inscriptions de l'Event Class : classe -> spé Raid-Helper (spé par défaut quand un perso est choisi)
function classEventSpec(cls) {
  const me = ST.cloud && ST.cloud.user && ST.cloud.user.id;
  const cev = eventById((ST.rhSettings || {}).rhClassEvent);
  const su = cev && me && cev.signups.find(s => s.uid === me && s.c === cls && s.rs);
  return su ? su.rs : ((ST.rhSpecs || {})[cls] || [])[0] || "";
}
const rhClassName = cls => cls ? cls.charAt(0) + cls.slice(1).toLowerCase() : "";
const plainRhSpec = s => String(s || "").replace(/\d+$/, "");
// spé WoW (« Restoration » du chaman) -> nom Raid-Helper (« Restoration1 »)
const rhSpecName = (cls, spec) => ((ST.rhSpecs || {})[cls] || []).find(n => plainRhSpec(n) === spec) || spec || "";
function fillCharList(el) {
  const list = el.parentElement.querySelector(".eflist"), q = el.value.trim().toLowerCase();
  const chars = (ST.myChars || []).filter(c => !q || c.name.toLowerCase().includes(q));
  list.innerHTML = chars.map(c => `<button data-pickchar="${esc(c.name)}" style="color:${CLASS_COLOR[c.class] || "#fff"}">${esc(c.name)} <small>${c.level || ""}</small></button>`).join("")
    || `<div class="help">${L("No character found.")}</div>`;
  list.hidden = false;
}
function fillSpecList(el) {
  const list = el.parentElement.querySelector(".eflist");
  list.innerHTML = ((ST.rhSpecs || {})[evw.cls] || []).map(sp => `<button data-pickspec="${esc(sp)}">${esc(plainRhSpec(sp))}</button>`).join("")
    || `<div class="help">${L("Choose a character first.")}</div>`;
  list.hidden = false;
}
async function sendReaction(kind) {
  const s = evw, w = $("#evWin");
  s.note = (w.querySelector('[data-f="note"]') || {}).value || "";
  // déjà inscrit (event pas encore validé) : re-clic sur Sign = désinscription complète
  if (kind === "sign" && s.signed) {
    const r = await api().rh_sign(s.ev.id, "unsign", "", "", "", "");
    if (!r || r.ok === false) { toast((r && r.error) || "Error", true); return; }
    toast(L("You are no longer signed up for this event."));
    closeEvWin(); liveNow(); return;
  }
  if (kind === "sign" && s.commu && !s.cls) { toast(L("Choose your character first."), true); return; }
  const r = await api().rh_sign(s.ev.id, kind, kind === "sign" && s.commu ? rhClassName(s.cls) : "", kind === "sign" && s.commu ? s.spec : "",
                                kind === "sign" && s.commu ? s.char : "", s.note.trim());
  if (!r || r.ok === false) { toast((r && r.error) || "Error", true); return; }
  toast(L("Done: {0} sign-up(s) sent to Raid-Helper.", r.added || 1));
  closeEvWin(); liveNow();
}

// ---------------------------------------------------------------- événements
document.addEventListener("click", async e => {
  const w = $("#evWin");
  if (!w) return;
  const t = e.target;
  let el;
  if (t.closest("[data-evclose]")) { closeEvWin(); return; }
  if (!t.closest("#evWin")) return;
  if ((el = t.closest("[data-kind]")) && evw.mode !== "react") {
    evw.kind = el.dataset.kind;
    evw.channel = defChan(evw.kind);
    if (evw.kind === "main" && !evw.title) evw.title = "Main Raid";
    if (evw.kind === "commu" && evw.title === "Main Raid") evw.title = "";
    renderEventWin();
    // ensuite : le titre (même déjà rempli), curseur à la fin
    const ti = $('#evWin [data-f="title"]');
    if (ti) { ti.focus(); ti.setSelectionRange(ti.value.length, ti.value.length); }
    return;
  }
  if ((el = t.closest("[data-pickchan]"))) {
    const inp = w.querySelector('[data-f="channel"]');
    inp.dataset.id = el.dataset.pickchan; inp.value = chanName(el.dataset.pickchan);
    el.parentElement.hidden = true; navNext(inp); return;
  }
  if ((el = t.closest("[data-pickchar]"))) {
    const c = (ST.myChars || []).find(x => x.name === el.dataset.pickchar);
    evw.char = c.name; evw.cls = c.class; evw.spec = classEventSpec(c.class);
    const inp = w.querySelector('[data-f="char"]'); inp.value = c.name;
    w.querySelector('[data-f="spec"]').value = plainRhSpec(evw.spec);
    el.parentElement.hidden = true; navNext(inp); return;
  }
  if ((el = t.closest("[data-pickspec]"))) {
    evw.spec = el.dataset.pickspec;
    const inp = w.querySelector('[data-f="spec"]'); inp.value = plainRhSpec(evw.spec);
    el.parentElement.hidden = true; navNext(inp); return;
  }
  if ((el = t.closest('[data-f="copy"]'))) { evw.copy = !evw.copy; el.classList.toggle("on", evw.copy); return; }
  if (t.closest("[data-evgo]")) { submitEventWin(); return; }
  if ((el = t.closest("[data-rk]"))) { sendReaction(el.dataset.rk); return; }
  if ((el = t.closest("[data-pk]"))) { sendPresence(el.dataset.pk, el); return; }
  // Compos : lockout de l'event dans Raid Comps, compo de l'event sélectionnée
  if (t.closest("[data-evcomps]")) { const ev = evw.ev; closeEvWin(); openEventComps(ev); return; }
  if (t.closest("[data-evedit]")) { const ev = evw.ev, d = new Date(ev.start * 1000); openEventWin(d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(), ev); return; }
  if ((el = t.closest("[data-evdel]"))) {
    // 1er clic : « Confirm », grisé 1,5 s ; 2e clic ensuite : suppression
    if (!el.classList.contains("armed")) {
      el.classList.add("armed", "wait"); el.innerHTML = EV_ICO.trash + `<span>${L("Confirm")}</span>`;
      setTimeout(() => el.classList.remove("wait"), 1500);
      return;
    }
    if (el.classList.contains("wait")) return;
    const r = await api().rh_delete(evw.ev.id);
    if (!r || r.ok === false) { toast((r && r.error) || "Error", true); return; }
    toast(L("Event deleted.")); closeEvWin(); liveNow();
    return;
  }
  // clic ailleurs dans la fenêtre : listes refermées
  w.querySelectorAll(".eflist").forEach(l => { if (!l.parentElement.contains(t)) l.hidden = true; });
});
document.addEventListener("focusin", e => {
  const el = e.target;
  if (!el.closest || !el.closest("#evWin")) return;
  if (el.dataset.f === "channel") { el.value = el.dataset.id || ""; el.select(); fillChanList(el); }
  if (el.dataset.f === "char") fillCharList(el);
  if (el.dataset.f === "spec") fillSpecList(el);
  if (el.dataset.f === "time") { timeBuf = timeDigits(evw.min); el.selectionStart = el.selectionEnd = el.value.length; }
  if (el.dataset.f === "date") { dateBuf = dateDigits(evw); setTimeout(() => { if (el.selectionStart === el.selectionEnd && el.selectionStart >= 10) el.selectionStart = el.selectionEnd = 0; }); }
});
document.addEventListener("focusout", e => {
  const el = e.target;
  if (!evw || !el.closest || !el.closest("#evWin")) return;
  if (el.dataset.f === "channel") {
    const v = el.value.trim();
    if (/^\d+$/.test(v)) el.dataset.id = v;
    el.value = chanName(el.dataset.id);
  }
  if (el.dataset.f === "time") { timeBuf = timeDigits(evw.min); el.value = hhmm(evw.min); }
  if (el.dataset.f === "date") { dateBuf = dateDigits(evw); el.value = dateStr(evw); }
});
document.addEventListener("input", e => {
  const el = e.target;
  if (!el.closest || !el.closest("#evWin")) return;
  if (el.dataset.f === "channel") fillChanList(el);
  if (el.dataset.f === "char") fillCharList(el);
});
document.addEventListener("keydown", e => {
  const w = $("#evWin");
  if (!w) return;
  if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeEvWin(); return; }
  const el = e.target;
  if (!el.closest || !el.closest("#evWin")) return;
  if (el.dataset.f === "time") {
    if (/^\d$/.test(e.key)) { e.preventDefault(); timeType(el, e.key); return; }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); timeStep(el, e.key === "ArrowUp" ? 1 : -1); return; }
    if (e.key === "Backspace" || e.key === "Delete") { e.preventDefault(); timeBack(el); return; }
    if (e.key.length === 1) { e.preventDefault(); return; }   // seulement des chiffres
  }
  if (el.dataset.f === "date") {
    if (/^\d$/.test(e.key)) { e.preventDefault(); dateType(el, e.key); return; }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); dateStep(el, e.key === "ArrowUp" ? 1 : -1); return; }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End" || e.key === "Tab") return;
    if (e.key === "Backspace" || e.key === "Delete") { e.preventDefault(); dateBuf = dateBuf.slice(0, -1); showDateBuf(el); return; }
    if (e.key.length === 1) { e.preventDefault(); return; }
  }
  if (el.dataset.f === "date" && e.key === "Enter") { dateBuf = dateDigits(evw); el.value = dateStr(evw); }
  if (e.key !== "Enter" || (el.tagName === "TEXTAREA" && e.shiftKey)) return;
  e.preventDefault();
  // listes ouvertes : Entrée choisit la 1re proposition
  const list = el.parentElement && el.parentElement.querySelector(".eflist:not([hidden]) button");
  if (list && (el.dataset.f === "char" || el.dataset.f === "channel" || el.dataset.f === "spec")) { list.click(); return; }
  if (el.dataset.f === "time") { timeBuf = timeDigits(evw.min); el.value = hhmm(evw.min); }
  // bouton : Entrée l'active ; création / envoi : action finale
  if (el.tagName === "BUTTON") {
    if (el.dataset.evgo || el.dataset.rk || el.dataset.pk || el.dataset.evedit || el.dataset.evdel || el.dataset.evcomps) { el.click(); return; }
    el.click();
    if (el.dataset.kind) return;   // le choix du type redessine la fenêtre et passe au suivant
  }
  navNext(el);
}, true);
document.addEventListener("wheel", e => {
  const el = e.target.closest && e.target.closest('#evWin [data-f="time"], #evWin [data-f="date"]');
  if (!el || !evw) return;
  e.preventDefault();
  if (el.dataset.f === "date") dateStep(el, e.deltaY < 0 ? 1 : -1);
  else timeStep(el, e.deltaY < 0 ? 1 : -1);
}, { passive: false });
