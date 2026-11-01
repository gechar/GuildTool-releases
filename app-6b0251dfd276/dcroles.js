"use strict";
// ---------- Settings > Admin : rôles Discord donnés automatiquement d'après les persos partagés (fonction serveur,
// route « dcroles ») : classe, rôle de raid (spé des talents) et métiers. Chaque clé prend le rôle du serveur qui porte
// son nom (anglais / français), ou celui choisi ici ; le serveur les met à jour à chaque relecture des membres Discord.
const DC_GROUPS = [
  ["Classes", CLASS_ORDER.map(c => ["class:" + c, CLASS_NAME[c]])],
  ["Roles", [["role:Tank", "Tank"], ["role:Healer", "Healer"], ["role:Melee", "Melee"], ["role:Ranged", "Ranged"]]],
  ["Professions", [["prof:alchemy", "Alchemy"], ["prof:blacksmithing", "Blacksmithing"], ["prof:enchanting", "Enchanting"],
    ["prof:engineering", "Engineering"], ["prof:herbalism", "Herbalism"], ["prof:leatherworking", "Leatherworking"],
    ["prof:mining", "Mining"], ["prof:skinning", "Skinning"], ["prof:tailoring", "Tailoring"], ["prof:cooking", "Cooking"],
    ["prof:firstaid", "First Aid"], ["prof:fishing", "Fishing"]]],
];
let dcPlan = null, dcBusy = false;
const dcCfg = () => ST.dcRoles || { on: false, min: 60, map: {} };
const dcHex = c => c ? "#" + c.toString(16).padStart(6, "0") : "";

function renderDcRoles() {
  const box = $("#dcRoles");
  if (!box) return;
  const cfg = dcCfg(), rs = (ST.discordMembers || {}).roleSync;
  let h = `<div class="sec">${L("Discord roles")}</div>
    <p class="help">${L("Gives the Discord roles of the class, raid role (talents) and professions of the characters shared in Guild Tool. Only the roles of this list change, and only for members who shared a character.")}</p>
    <div class="srow" data-help="The server updates the roles each time it reads the Discord members again (Sync, at most every 10 min)."><span class="sl">${L("Assign automatically")}</span><button class="switch${cfg.on ? " on" : ""}" id="dcOn"><i></i></button></div>
    <label class="srow" data-help="Class and raid role: only characters of this level or more (professions: any level).">${L("Minimum level")}<input type="number" id="dcMin" min="1" max="60" value="${cfg.min || 60}" style="width:56px;margin-left:auto"></label>`;
  if (rs) h += `<p class="help">${L("Last update: {0} · {1} change(s)", new Date(rs.t).toLocaleString(LOC(), { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }), rs.done || 0)}${rs.left ? " · " + L("{0} left for the next time", rs.left) : ""}${rs.error ? `<br><span class="ko">${esc(rs.error)}</span>` : ""}</p>`;
  if (!dcPlan) {
    h += `<button class="btn small" id="dcLoad"${dcBusy ? " disabled" : ""}>${L(dcBusy ? "Reading…" : "Show the roles")}</button>`;
    box.innerHTML = h;
    return;
  }
  const p = dcPlan, keys = Object.fromEntries((p.keys || []).map(k => [k.key, k])), byId = Object.fromEntries((p.roles || []).map(r => [r.id, r]));
  if (!p.canManage) h += `<p class="ko">${L("The bot needs the « Manage Roles » permission on the Discord server.")}</p>`;
  for (const [title, list] of DC_GROUPS) {
    h += `<div class="dcgrp">${L(title)}</div>`;
    for (const [key, label] of list) {
      const k = keys[key] || {}, pick = (cfg.map || {})[key] || "", found = k.auto && byId[k.role];
      const opts = [`<option value="">${esc(found ? L("Auto: {0}", found.name) : L("Auto: no role found"))}</option>`,
        `<option value="-"${pick === "-" ? " selected" : ""}>${L("No role")}</option>`]
        .concat((p.roles || []).map(r => `<option value="${r.id}"${pick === r.id ? " selected" : ""}>${esc(r.name)}</option>`));
      const warn = k.bad === "above" ? L("This role is above the bot's role: move the bot's role higher (Discord > Server Settings > Roles).")
        : k.bad === "managed" ? L("This role is managed by an integration: it cannot be given.")
        : k.missing ? L("This role no longer exists on the server.") : "";
      const col = k.role && byId[k.role] ? dcHex(byId[k.role].color) : "";
      h += `<label class="srow dcrow"><span class="sl"${col ? ` style="color:${col}"` : ""}>${esc(L(label))}</span>
        ${warn ? `<span class="ko" data-help="${esc(warn)}">⚠</span>` : ""}<select data-dckey="${key}">${opts.join("")}</select></label>`;
    }
  }
  const missing = (p.keys || []).filter(k => !k.role && !k.off).length;
  h += `<div class="bgrow dcbtns">
      <button class="btn small" id="dcCreate"${missing && !dcBusy ? "" : " disabled"} data-help="Creates on the Discord server a role for each line without a role (except « No role »), under the bot's role.">${L("Create the missing roles ({0})", missing)}</button>
      <button class="btn small pri" id="dcApply"${p.changes.length && !dcBusy ? "" : " disabled"}>${L("Apply now ({0})", p.changes.length)}</button>
      <button class="ib" id="dcLoad" data-help="Read the roles again">↻</button></div>`;
  if (p.changes.length) {
    h += `<div class="dcchg">${p.changes.map(c => `<div><b>${esc(c.name)}</b> ${c.add.map(r => `<span class="ok">+${esc(r)}</span>`).join(" ")} ${c.del.map(r => `<span class="ko">−${esc(r)}</span>`).join(" ")}</div>`).join("")}</div>`;
  } else h += `<p class="help">${L("All the roles are up to date ({0} players with characters).", p.users || 0)}</p>`;
  if (p.result && p.result.error) h += `<p class="ko">${esc(p.result.error)}</p>`;
  box.innerHTML = h;
}

async function dcRun(op) {
  dcBusy = true; renderDcRoles();
  const names = {};
  if (op === "create") for (const [, list] of DC_GROUPS) for (const [key, label] of list) names[key] = L(label);
  const r = await api().dc_roles(op, names);
  dcBusy = false;
  if (!r.ok) { toast(r.error, true); renderDcRoles(); return; }
  dcPlan = r;
  if (op === "create") toast(L("{0} role(s) created.", r.created || 0));
  if (op === "apply" && r.result) toast(L("{0} change(s) made.", r.result.done || 0), !!r.result.error);
  renderDcRoles();
}
async function dcSave(patch) {
  const r = await api().set_dc_roles({ ...dcCfg(), ...patch });
  if (!r.ok) { toast(r.error, true); return false; }
  ST.dcRoles = r.dcRoles;
  return true;
}

$("#guildAdmin").addEventListener("click", async e => {
  const t = e.target;
  if (t.closest("#dcLoad")) { dcRun("plan"); return; }
  if (t.closest("#dcApply")) { dcRun("apply"); return; }
  if (t.closest("#dcCreate")) { dcRun("create"); return; }
  if (t.closest("#dcOn")) {
    if (await dcSave({ on: !dcCfg().on })) { toast(L(dcCfg().on ? "Discord roles: automatic." : "Discord roles: manual.")); renderDcRoles(); }
  }
});
$("#guildAdmin").addEventListener("change", async e => {
  const t = e.target;
  if (t.id === "dcMin") { if (await dcSave({ min: Math.max(1, Math.min(60, +t.value || 60)) })) dcRun("plan"); return; }
  if (!t.dataset || !t.dataset.dckey) return;
  const map = { ...(dcCfg().map || {}) };
  if (t.value) map[t.dataset.dckey] = t.value; else delete map[t.dataset.dckey];
  if (await dcSave({ map })) dcRun("plan");
});
