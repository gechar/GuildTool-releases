// Données statiques : copie de GuildTool/Data.lua (garder les deux synchronisées)
const MAX_LEVEL = 60;
const PHASES = [
  { name: "Phase 1", raids: [
    { key: "barrow", name: "Barrow Deeps", short: "Barrow", size: 10, bg: "img/bg_barrow.jpg", blur: "img/bg_barrow_blur.jpg", aspect: 0.5 },
    { key: "hyjal", name: "Mount Hyjal", short: "Hyjal", size: 20, bg: "img/bg_hyjal.jpg", blur: "img/bg_hyjal_blur.jpg", aspect: 1.5 },
    { key: "ony", name: "Onyxia's Lair", short: "Ony", size: 40, bg: "img/bg_ony.jpg", blur: "img/bg_ony_blur.jpg", aspect: 2.5 },
  ] },
];
// span = largeur en colonnes (grille de 4) ; gcols = colonnes de groupes dans la compo
const LAYOUT = { 10: { span: 1, gcols: 1 }, 20: { span: 2, gcols: 2 }, 40: { span: 4, gcols: 4 } };
const GEAR_SLOTS = [1, 2, 3, 15, 5, 4, 19, 9, 10, 6, 7, 8, 11, 12, 13, 14, 16, 17, 18];
// fenêtre de personnage : colonne gauche, colonne droite, armes
const GEAR_LEFT = [1, 2, 3, 15, 5, 4, 19, 9], GEAR_RIGHT = [10, 6, 7, 8, 11, 12, 13, 14], GEAR_BOTTOM = [16, 17, 18];
const GEAR_NAMES = { 1: "Head", 2: "Neck", 3: "Shoulder", 15: "Back", 5: "Chest", 4: "Shirt", 19: "Tabard", 9: "Wrist", 10: "Hands", 6: "Waist", 7: "Legs", 8: "Feet", 11: "Finger", 12: "Finger", 13: "Trinket", 14: "Trinket", 16: "Main Hand", 17: "Off Hand", 18: "Ranged" };
const QUALITY_COLOR = ["#9d9d9d", "#ffffff", "#1eff00", "#0070dd", "#a335ee", "#ff8000", "#e6cc80"];
const CLASS_ORDER = ["WARRIOR", "PALADIN", "DRUID", "PRIEST", "SHAMAN", "ROGUE", "HUNTER", "MAGE", "WARLOCK"];
const CLASS_NAME = { WARRIOR: "Warrior", PALADIN: "Paladin", DRUID: "Druid", PRIEST: "Priest", SHAMAN: "Shaman", ROGUE: "Rogue", HUNTER: "Hunter", MAGE: "Mage", WARLOCK: "Warlock" };
const CLASS_COLOR = { WARRIOR: "#C69B6D", PALADIN: "#F48CBA", HUNTER: "#AAD372", ROGUE: "#FFF468", PRIEST: "#F0F0F0", SHAMAN: "#0070DD", MAGE: "#3FC7EB", WARLOCK: "#8788EE", DRUID: "#FF7C0A" };
const ROLE_ORDER = ["Tank", "Healer", "Melee", "Ranged"];
const ROLE_ICON = { Tank: "icons/role_tank.png", Healer: "icons/role_healer.png", Melee: "icons/role_melee.png", Ranged: "icons/role_ranged.png" };
const SPECS = {
  WARRIOR: [["Protection", "Tank"], ["Arms", "Melee"], ["Fury", "Melee"]],
  PALADIN: [["Holy", "Healer"], ["Protection", "Tank"], ["Retribution", "Melee"]],
  DRUID: [["Restoration", "Healer"], ["Guardian", "Tank"], ["Feral", "Melee"], ["Balance", "Ranged"]],
  PRIEST: [["Holy", "Healer"], ["Discipline", "Healer"], ["Shadow", "Ranged"]],
  SHAMAN: [["Restoration", "Healer"], ["Enhancement", "Melee"], ["Elemental", "Ranged"]],
  ROGUE: [["Combat", "Melee"], ["Assassination", "Melee"], ["Subtlety", "Melee"]],
  HUNTER: [["Marksmanship", "Ranged"], ["Survival", "Ranged"], ["Beastmastery", "Ranged"]],
  MAGE: [["Frost", "Ranged"], ["Fire", "Ranged"], ["Arcane", "Ranged"]],
  WARLOCK: [["Affliction", "Ranged"], ["Destruction", "Ranged"], ["Demonology", "Ranged"]],
};
// arbres de talents dans l'ordre du jeu -> spé (= TALENT_SPECS d'app.py et ns.TALENT_SPECS de Data.lua)
const TALENT_SPECS = { WARRIOR: ["Arms", "Fury", "Protection"], PALADIN: ["Holy", "Protection", "Retribution"],
  DRUID: ["Balance", "Feral", "Restoration"], PRIEST: ["Discipline", "Holy", "Shadow"], SHAMAN: ["Elemental", "Enhancement", "Restoration"],
  ROGUE: ["Assassination", "Combat", "Subtlety"], HUNTER: ["Beastmastery", "Marksmanship", "Survival"], MAGE: ["Arcane", "Fire", "Frost"],
  WARLOCK: ["Affliction", "Demonology", "Destruction"] };
function roleOf(cls, spec) {
  const s = (SPECS[cls] || []).find(x => x[0] === spec);
  return s ? s[1] : null;
}

// Buffs (= Data.lua, GARDER SYNCHRONISÉS). test(m) reçoit un membre { class, spec, role }.
const isClass = c => m => m.class === c;
const isSpec = (c, ...s) => m => m.class === c && s.includes(m.spec);
// buffs de groupe (par groupe de 5)
const GROUP_BUFFS = [
  { key: "TA", icon: "spell_nature_brilliance", name: "Tranquil Air Totem", effect: "-20% threat", provider: "Shaman", test: isClass("SHAMAN") },
  { key: "MS", icon: "spell_nature_manaregentotem", name: "Mana Spring Totem", effect: "Restores mana every 2 sec", provider: "Shaman", test: isClass("SHAMAN") },
  { key: "MTT", icon: "spell_frost_summonwaterelemental", name: "Mana Tide Totem", effect: "Restores mana to the party", provider: "Restoration Shaman", test: isSpec("SHAMAN", "Restoration") },
  { key: "VE", icon: "spell_shadow_unsummonbuilding", name: "Vampiric Embrace", effect: "Heals the party from Shadow damage", provider: "Shadow Priest", test: isSpec("PRIEST", "Shadow") },
  { key: "DI", icon: "spell_warlock_demonsoul", name: "Dark Inspiration", effect: "+15% Spirit for the party (Mind Blast, Mind Flay)", provider: "Shadow Priest (talent)", test: isSpec("PRIEST", "Shadow") },
];
// buffs de raid (toute la compo). paladins = nombre de paladins requis : Salvation dès un paladin, puis une Greater
// Blessing par paladin dans cet ordre. hideOff = caché (pas grisé) quand absent.
const RAID_BUFFS = [
  { key: "AB", icon: "spell_holy_magicalsentry", name: "Arcane Brilliance", effect: "+Intellect", provider: "Mage", test: isClass("MAGE") },
  { key: "GOTW", icon: "spell_nature_giftofthewild", name: "Gift of the Wild", effect: "+All stats and resistances", provider: "Druid", test: isClass("DRUID") },
  { key: "POF", icon: "spell_holy_prayeroffortitude", name: "Prayer of Fortitude", effect: "+Stamina", provider: "Priest", test: isClass("PRIEST") },
  { key: "POS", icon: "spell_holy_prayerofspirit", name: "Prayer of Spirit", effect: "+Spirit", provider: "Priest", test: isClass("PRIEST") },
  { key: "BS", icon: "ability_warrior_battleshout", name: "Battle Shout", effect: "+Attack power", provider: "Warrior", test: isClass("WARRIOR") },
  { key: "TSA", icon: "ability_trueshot", name: "Trueshot Aura", effect: "+Attack power", provider: "Beastmastery or Survival Hunter", test: isSpec("HUNTER", "Beastmastery", "Survival"), hideOff: true },
  { key: "LOTP", icon: "spell_nature_unyeildingstamina", name: "Leader of the Pack", effect: "+3% melee and ranged crit", provider: "Feral or Guardian Druid", test: isSpec("DRUID", "Feral", "Guardian") },
  { key: "MK", icon: "spell_nature_moonglow", name: "Moonkin Aura", effect: "+3% spell crit", provider: "Balance Druid", test: isSpec("DRUID", "Balance") },
  { key: "WF", icon: "spell_nature_windfury", name: "Windfury Totem", effect: "Chance of an extra melee attack", provider: "Shaman", test: isClass("SHAMAN") },
  { key: "GOA", icon: "spell_nature_invisibilitytotem", name: "Grace of Air Totem", effect: "+Agility", provider: "Shaman", test: isClass("SHAMAN") },
  { key: "SOE", icon: "spell_nature_earthbindtotem", name: "Strength of Earth Totem", effect: "+Strength", provider: "Shaman", test: isClass("SHAMAN") },
  { key: "FT", icon: "spell_nature_guardianward", name: "Flametongue Totem", effect: "Fire damage on weapon hits", provider: "Shaman", test: isClass("SHAMAN") },
  { key: "SAL", icon: "spell_holy_greaterblessingofsalvation", name: "Salvation", effect: "-30% threat", provider: "Any Paladin", paladins: 1 },
  { key: "GBK", icon: "spell_magic_greaterblessingofkings", name: "Greater Blessing of Kings", effect: "+10% all stats", provider: "1st Paladin (talent)", paladins: 1 },
  { key: "GBM", icon: "spell_holy_greaterblessingofkings", name: "Greater Blessing of Might", effect: "+Attack power", provider: "2nd Paladin", paladins: 2 },
  { key: "GBW", icon: "spell_holy_greaterblessingofwisdom", name: "Greater Blessing of Wisdom", effect: "+Mana every 5 sec", provider: "3rd Paladin", paladins: 3 },
  { key: "GBL", icon: "spell_holy_greaterblessingoflight", name: "Greater Blessing of Light", effect: "+Healing received", provider: "4th Paladin", paladins: 4 },
];
// debuffs sur les boss ; vars = variantes selon la classe qui l'apporte (icône / nom remplacés)
const RAID_DEBUFFS = [
  { key: "COE", icon: "spell_shadow_chilltouch", name: "Curse of the Elements", effect: "+10% mage damage", provider: "Warlock" },
  { key: "SUN", icon: "ability_warrior_sunder", name: "Sunder Armor", effect: "Reduces armor", provider: "Warrior, or Rogue (Expose Armor)",
    vars: { expose: { icon: "ability_warrior_riposte", name: "Expose Armor" } } },
  { key: "FF", icon: "spell_nature_faeriefire", name: "Faerie Fire", effect: "Reduces armor (minor)", provider: "Druid, or a 2nd Warlock (Curse of Recklessness)",
    vars: { cor: { icon: "spell_shadow_unholystrength", name: "Curse of Recklessness" } } },
  { key: "PURGE", icon: "spell_nature_purge", name: "Purge", effect: "Removes 2 buffs", provider: "Shaman (Purge), Priest (Dispel Magic), or Warlock pet (Devour Magic, 1 buff)",
    vars: { priest: { icon: "spell_holy_dispelmagic", name: "Dispel Magic" }, lock: { icon: "spell_nature_purge", name: "Devour Magic" } } },
  { key: "TRQ", icon: "spell_nature_drowsy", name: "Tranquilizing Shot", effect: "Removes 1 frenzy effect", provider: "Hunter" },
];
// Mêlées (Autofill)
const isMeleeUnit = m => (m.role === "Melee" || m.role === "Tank") && m.class !== "SHAMAN" && m.class !== "HUNTER";
const classCount = members => members.reduce((n, m) => (m.class && (n[m.class] = (n[m.class] || 0) + 1), n), {});

function groupBuffs(members) {
  const on = {};
  for (const b of GROUP_BUFFS) if (members.some(b.test)) on[b.key] = true;
  return { on };
}

function raidBuffs(members) {
  const on = {}, paladins = classCount(members).PALADIN || 0;
  for (const b of RAID_BUFFS) on[b.key] = b.paladins ? paladins >= b.paladins : members.some(b.test);
  return on;
}

// -> clé -> { on, v (variante : clé de vars), effect (texte remplacé) } ; Purge : chaman > prêtre > familier du démoniste
function raidDebuffs(members) {
  const n = classCount(members), c = k => n[k] || 0;
  const wl = c("WARLOCK"), war = c("WARRIOR"), rog = c("ROGUE"), dru = c("DRUID"), pri = c("PRIEST"), sha = c("SHAMAN");
  return {
    COE: { on: wl > 0 },
    SUN: { on: war + rog > 0, v: !war && rog > 0 ? "expose" : null },
    FF: { on: dru > 0 || wl >= 2, v: !dru && wl >= 2 ? "cor" : null },
    PURGE: { on: pri + sha + wl > 0, v: sha ? null : pri ? "priest" : wl ? "lock" : null, effect: !pri && !sha && wl > 0 ? "Removes 1 buff" : null },
    TRQ: { on: c("HUNTER") > 0 },
  };
}
