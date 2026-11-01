"use strict";
// ---------- Logs : reports Warcraft Logs de la guilde (lus par le serveur avec l'API de Warcraft Logs, doc « wcllogs »)
// Onglet Logs : liste (description, date de début, durée, visibilité), clic = page du report.
// Calendrier : events passés -> icône du report le plus proche (début du report / début de l'event, 12 h au plus) ;
// officiers : clic droit = reports à moins de 7 jours, le choix remplace le lien pour toute la guilde (doc « wcl_<event> »).
const WCL_NEAR = 12 * 3600, WCL_DAYS = 7 * 86400;
const LOG_SVG = '<svg viewBox="0 0 24 24"><path d="M4 20V10M9.3 20V4M14.6 20v-7M20 20V8"/></svg>';
const wcl = () => (ST && ST.wcl) || { reports: [], picks: {}, site: "sod.warcraftlogs.com" };
const wclUrl = r => `https://${wcl().site || "sod.warcraftlogs.com"}/reports/${r.code}`;

// « Lun. 29/06/25 » et « 22:28 » (alignés sur le « - » dans la liste)
function wclDate(t) {
  const d = new Date(t * 1000), p = n => String(n).padStart(2, "0");
  const wd = d.toLocaleString(LOC(), { weekday: "short" }).replace(/\.$/, "");
  return [`${wd.charAt(0).toUpperCase()}${wd.slice(1)}. ${p(d.getDate())}/${p(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}`,
          `${p(d.getHours())}:${p(d.getMinutes())}`];
}
const wclDur = r => { const m = Math.max(0, Math.round(((r.end || r.start) - r.start) / 60)); return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`; };
const WCL_VIS = { public: "Public", private: "Private", unlisted: "Unlisted" };

// report d'un event passé : choisi par un officier, sinon le plus proche (début), sinon null
function wclFor(ev) {
  if (!ev || ev.start > Date.now() / 1000) return null;
  const w = wcl(), pick = (w.picks || {})[ev.id];
  if (pick) return (w.reports || []).find(r => r.code === pick) || { code: pick, title: "", start: ev.start };
  let best = null;
  for (const r of w.reports || []) {
    const d = Math.abs(r.start - ev.start);
    if (d <= WCL_NEAR && (!best || d < Math.abs(best.start - ev.start))) best = r;
  }
  return best;
}
// icône dans la barre d'un event du calendrier (rien pour un event à venir ; officier : aussi sans report, pour en choisir un)
function wclIcon(ev, shift) {
  if (ev.start > Date.now() / 1000 || !(wcl().reports || []).length) return "";
  const r = wclFor(ev);
  if (!r && !isOfficerUser()) return "";
  const help = r ? L("Logs: {0} · {1}", r.title || r.code, wclDate(r.start).join(" - ")) : L("No logs found for this event");
  return `<span class="evlog${r ? "" : " none"}${shift ? " shift" : ""}" data-wcl="${ev.id}" data-help="${esc(help + (isOfficerUser() ? " · " + L("right click: choose the logs") : ""))}">${LOG_SVG}</span>`;
}
// officier : reports à moins de 7 jours de l'event, du plus proche au plus lointain
function wclMenu(anchor, ev) {
  const w = wcl(), cur = (w.picks || {})[ev.id] || "";
  const list = (w.reports || []).filter(r => Math.abs(r.start - ev.start) <= WCL_DAYS)
    .sort((a, b) => Math.abs(a.start - ev.start) - Math.abs(b.start - ev.start));
  const auto = wclFor({ ...ev, id: "" });
  const pick = code => api().wcl_pick(ev.id, code).then(r => { if (!r.ok) { toast(r.error, true); return; } ST.wcl = r.wcl; render(); });
  const items = [{ text: L("Automatic (nearest): {0}", auto ? auto.title || auto.code : L("none")), on: !cur, fn: () => pick("") }];
  for (const r of list) items.push({ text: `${wclDate(r.start).join(" - ")} · ${r.title || r.code} · ${wclDur(r)}`, on: cur === r.code, fn: () => pick(r.code) });
  if (!list.length) items.push({ text: L("No logs within 7 days"), mute: true });
  openMenu(anchor, items);
}

function renderLogs() {
  const w = wcl(), page = $("#page-logs");
  const rows = (w.reports || []).map(r => {
    const [d, t] = wclDate(r.start);
    return `<tr data-wclopen="${esc(r.code)}"><td class="lgd"><a>${esc(r.title || r.code)}</a>${r.zone ? `<small>${esc(r.zone)}</small>` : ""}</td>
      <td class="lgdate"><span class="lgday">${esc(d)}</span><span class="lgsep">-</span><span class="lgtime">${t}</span></td>
      <td>${wclDur(r)}</td><td>${esc(L(WCL_VIS[r.vis] || r.vis || ""))}</td></tr>`;
  }).join("");
  page.innerHTML = `<div class="logsbar"><button class="btn small" id="wclRefresh" data-help="Read the list again on Warcraft Logs">↻ ${L("Refresh")}</button>
      ${w.error ? `<span class="ko">${esc(w.error)}</span>` : ""}
      <span class="lgsrc">${w.source ? `<a data-wclsrc="1">${esc(w.source)}</a>` : ""}${w.checked ? " · " + L("read at {0}", new Date(w.checked).toLocaleTimeString(LOC(), { hour: "2-digit", minute: "2-digit" })) : ""}</span></div>
    <div class="logswrap">${rows ? `<table class="logs"><thead><tr><th>${L("Description")}</th><th>${L("Date")}</th><th>${L("Duration")}</th><th>${L("Visibility")}</th></tr></thead><tbody>${rows}</tbody></table>`
      : `<div class="empty-list">${L(w.error ? "No logs." : "No logs yet: they are read by the guild server (log in, then Sync).")}</div>`}</div>`;
}

document.addEventListener("click", e => {
  const t = e.target.closest && e.target.closest("[data-wcl], [data-wclopen], #wclRefresh, [data-wclsrc]");
  if (!t) return;
  e.stopPropagation();
  if (t.dataset.wcl) {
    const r = wclFor(eventById(t.dataset.wcl));
    if (r) api().open_url(wclUrl(r));
    else if (isOfficerUser()) wclMenu(t, eventById(t.dataset.wcl));
  } else if (t.dataset.wclopen) api().open_url(wclUrl({ code: t.dataset.wclopen }));
  else if (t.dataset.wclsrc) api().open_url(wcl().source);
  else {
    t.disabled = true;
    api().wcl_refresh(true).then(v => { ST.wcl = v; render(); }).finally(() => { t.disabled = false; });
  }
}, true);
document.addEventListener("contextmenu", e => {
  const t = e.target.closest && e.target.closest("[data-wcl]");
  if (!t || !isOfficerUser()) return;
  e.preventDefault();
  e.stopPropagation();
  wclMenu(t, eventById(t.dataset.wcl));
}, true);
