"""Guild Tool : pont entre Raid-Helper (Discord) et l'addon WoW GuildTool.

- lit les SavedVariables de l'addon (roster de guilde, tags Discord, compos faites en jeu)
- récupère les events et inscriptions Raid-Helper
- écrit Interface/AddOns/GuildTool/Import.lua (chargé par l'addon au /reload)
- affiche la même fenêtre que l'addon et poste les compos sur Discord via webhook
"""
import base64
import ctypes
import io
import json
import os
import re
import shutil
import sys
import threading
import time
import traceback
import unicodedata
import urllib.request
import webbrowser
import zipfile

import webview

import cloud
import luaio
import remote

APP_VERSION = "2.33.0"
# addon du même numéro, joint à chaque release GitHub (package_addon.py) : installé par l'exe (update_addon)
ADDON_ZIP_URL = "https://github.com/gechar/GuildTool-releases/releases/download/v%s/GuildTool.zip"

APP_DIR = os.environ.get("GUILDTOOL_HOME") or os.path.join(os.environ.get("APPDATA", os.path.expanduser("~")), "GuildTool")
# Ancien nom du projet (Raid Planner) : dossier de l'exe et SavedVariables repris au premier lancement
OLD_APP_DIR = os.path.join(os.environ.get("APPDATA", os.path.expanduser("~")), "RaidPlanner" + "Bridge")
OLD_ADDON, OLD_DB = "RaidPlanner", "RaidPlanner" + "DB"
if not os.environ.get("GUILDTOOL_HOME") and not os.path.exists(APP_DIR) and os.path.isdir(OLD_APP_DIR):
    try:
        shutil.copytree(OLD_APP_DIR, APP_DIR)   # session Discord, réglages, cache ; l'ancien dossier reste en sauvegarde
    except OSError:
        pass
CONFIG_PATH = os.path.join(APP_DIR, "config.json")
DATA_PATH = os.path.join(APP_DIR, "data.json")
BASE_DIR = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
DEFAULT_WOW = r"C:\Program Files (x86)\World of Warcraft\_classic_beta_"
MAX_LEVEL = 60
DEFAULT_SLASH = "/gt"
# commandes du jeu qu'une commande d'addon ne doit pas masquer
RESERVED_SLASH = {"/g", "/gm", "/guild", "/gq", "/gr", "/go", "/o", "/officer", "/r", "/raid", "/rw", "/p", "/party",
                  "/s", "/say", "/y", "/yell", "/w", "/whisper", "/t", "/tell", "/e", "/emote", "/me", "/who", "/help",
                  "/reload", "/console", "/script", "/run", "/dump", "/inv", "/invite", "/kick", "/ready", "/roll",
                  "/random", "/join", "/leave", "/macro", "/target", "/cast", "/use", "/afk", "/dnd", "/logout",
                  "/quit", "/camp", "/played", "/time", "/follow", "/assist", "/focus", "/bg", "/i", "/instance"}
USERNAME_TTL = 7 * 86400
DISCORD_MEMBERS_TTL = 30 * 60

DEFAULT_CONFIG = {
    "apiKey": "", "serverId": "", "botToken": "", "wowPath": "", "account": "",
    # comptes WoW lus : [{"folder": "123456789#1", "all": False}] (all = toutes les licences du compte Battle.net)
    "wowAccounts": [],
    # persos cachés : jamais envoyés à la guilde (ni par l'exe ni par l'addon) ; les nouveaux sont cachés si hideByDefault
    "hiddenChars": [], "knownChars": [], "hideByDefault": False,
    "webhooks": [], "autoSyncMinutes": 10,
    # apparence partagée avec l'addon (la plus récente gagne) ; bg = image de fond de fenêtre définie
    "appearance": {"compAlpha": 0.3, "bgAlpha": 0.6, "bg": False, "lockA": "#0e0f12", "lockB": "#34363e",
                   # Members : fond des arbres de talents, image de fond des persos
                   "talentBg": 0.35, "charImgA": 0.5, "detAlpha": 0.22, "detBlur": 0.0, "membersAlpha": 0.55, "membersBlur": 0.6,
                   "charImgOff": False, "charImgBlur": 0.0,
                   # Loots : fond des lignes et cadres ; réglages propres à un onglet {onglet: {bgAlpha, tabsAlpha, listGlass}}
                   "lootAlpha": 0.85, "lootBlur": 0.0, "tabs": {},
                   "listGlass": 0.0, "base": "#1e1f24", "lang": "en",
                   # Assigns : opacité de l'image du raid et du fond de la barre des sous-onglets ; couleur du surlignage des onglets
                   "assignAlpha": 0.5, "tabsAlpha": 1.0, "hl": "#6f7cff", "hl2": "#3fc7eb", "hlGrad": False,
                   "assignNoBg": False,   # Assigns : pas d'image de fond générale, l'image du raid la remplace
                   "t": 0},
}
WIN_W, WIN_H = 1400, 820   # fenêtre de l'addon : ratio du recadrage de l'image de fond
DEFAULT_DATA = {
    "events": [], "weeks": {}, "links": {}, "usernames": {}, "specs": {}, "specEmotes": {}, "charSpecs": {},
    "items": {}, "absences": [], "absT": 0, "lastSync": 0, "lastError": "",
    # phases éditées dans l'exe (None = phases d'origine), presets d'assigns par raid, assigns par compo
    "phases": None, "presets": {}, "assigns": {},
}
# phases d'origine (miroir de Data.lua / data.js)
DEFAULT_PHASES = [{"name": "Phase 1", "raids": [
    {"key": "barrow", "name": "Barrow Deeps", "short": "Barrow", "size": 10, "aspect": 0.5},
    {"key": "hyjal", "name": "Mount Hyjal", "short": "Hyjal", "size": 20, "aspect": 1.5},
    {"key": "ony", "name": "Onyxia's Lair", "short": "Ony", "size": 40, "aspect": 2.5},
]}]
# proportions (largeur / hauteur) du cadre d'une compo selon la taille du raid : recadrage des images de raid
RAID_RATIO = {10: 0.6, 20: 1.25, 40: 2.5}
MAP_RATIO = 1.6   # images des onglets d'assigns
WEEK = 7 * 86400
# reset hebdo de secours (mercredi 7 janvier 2026, 5h heure locale) tant que le jeu n'a pas donné le sien
FALLBACK_ANCHOR = int(time.mktime((2026, 1, 7, 5, 0, 0, 0, 0, -1)))


def _load(path, default):
    try:
        with open(path, encoding="utf-8-sig") as f:
            data = json.load(f)
    except (OSError, ValueError):
        data = {}
    out = json.loads(json.dumps(default))
    out.update(data)
    return out


# Boss et loots FACTICES de Mount Hyjal (tests de l'onglet Loots > Tables et de la wishlist) : ajoutés à la vue des tables
# (appli et Import.lua), jamais enregistrés ni envoyés à la guilde. À retirer quand les vraies tables seront remplies.
TEST_BOSS_LOOT = {"hyjal": {
    "Rage Winterchill (test)": [16800, 18203, 17063, 16808],
    "Anetheron (test)": [16834, 16866, 16921, 18821],
    "Kaz'rogal (test)": [17076, 18814, 17103, 19137],
    "Azgalor (test)": [18815, 17102, 16901, 16915],
    "Archimonde (test)": [19019, 17082, 17104, 18816],
}}
# rolls possibles d'un objet de wishlist (= LOOT_KIND de loots.js, sans DE / Vendor)
WISH_KINDS = ("bis", "upp", "up", "os", "pvp", "mog")

# icônes de buffs des compos (apparence) : épaisseur du cadre, taille raid / groupe, en pixels (clé, min, max)
BUFF_PX = (("buffBorder", 1, 4), ("buffSizeR", 10, 32), ("buffSizeG", 8, 28))


def _save(path, data):
    os.makedirs(APP_DIR, exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def _guess_wow_path():
    # l'exe peut être lancé depuis Interface/AddOns/GuildTool/Bridge/(dist/)
    here = os.path.dirname(os.path.abspath(sys.executable if getattr(sys, "frozen", False) else __file__))
    p = here
    for _ in range(6):
        if os.path.isdir(os.path.join(p, "WTF")) and os.path.isdir(os.path.join(p, "Interface")):
            return p
        p = os.path.dirname(p)
    return DEFAULT_WOW


def _norm(s):
    s = unicodedata.normalize("NFKD", s or "")
    return "".join(c for c in s if not unicodedata.combining(c)).lower()


def _squash(s):
    """Forme compacte (miroir de ns.Squash) : minuscules, sans ponctuation ni espaces."""
    return re.sub(r"[\W_]+", "", (s or "").lower())


def _comp_from_lua(comp):
    """Compo lue en Lua (liste ou dict) -> dict {"slot": nom}."""
    if isinstance(comp, list):
        return {str(i + 1): v for i, v in enumerate(comp) if v}
    if isinstance(comp, dict):
        return {str(k): v for k, v in comp.items() if v}
    return {}


def _entry_from_lua(entry):
    if not isinstance(entry, dict):
        return None
    comps = entry.get("c") or []
    if isinstance(comps, dict):
        comps = [comps[k] for k in sorted(comps)]
    return {"t": int(entry.get("t") or 0), "c": [_comp_from_lua(c) for c in comps]}


def _as_list(v):
    if isinstance(v, dict):
        return [v[k] for k in sorted(v)]
    return v if isinstance(v, list) else []


def _week_from_lua(week):
    """Semaine lue en Lua -> {"t", "comps": [{"id", "raid", "event", "valid", "c": {"slot": nom}}]}."""
    if not isinstance(week, dict):
        return None
    comps = []
    for c in _as_list(week.get("comps")):
        # compo communautaire (copie envoyée au jeu) : gardée à part par l'exe, pas dans la semaine des officiers
        if isinstance(c, dict) and c.get("raid") and not c.get("commu"):
            comp = {"id": str(c.get("id") or ""), "raid": c["raid"], "event": c.get("event"),
                    "valid": bool(c.get("valid")), "c": _comp_from_lua(c.get("c")), **_comp_extras(c)}
            comps.append(comp)
    return {"t": int(week.get("t") or 0), "comps": comps}


def _comp_extras(c):
    """Spé par compo {nom: spé} et places réservées {case: {r, k, s}} de l'exe, gardées par le jeu."""
    out = {}
    if isinstance(c.get("sp"), dict) and c["sp"]:
        out["sp"] = {str(k): v for k, v in c["sp"].items()}
    ph = c.get("ph")
    if isinstance(ph, list):
        ph = {str(i + 1): v for i, v in enumerate(ph) if v}
    if isinstance(ph, dict) and ph:
        out["ph"] = {str(k): v for k, v in ph.items() if isinstance(v, dict)}
    return out


def _merge_svs(dbs):
    """Fusionne les GuildToolDB de plusieurs comptes / licences ; dbs = [(mtime, db)].
    Fichier le plus récent prioritaire, sauf les données horodatées (semaines, apparence, absences, assigns)
    qui gardent la version au « t » le plus récent, et le roster qui garde celui scanné le plus récemment."""
    if len(dbs) == 1:
        return dbs[0][1]
    dbs = sorted(dbs, key=lambda x: x[0])
    out = {}
    for _, db in dbs:                       # du plus ancien au plus récent
        for k, v in db.items():
            if k in ("roster", "weeks", "assigns", "appearance", "absences", "absT", "rosterT", "guild"):
                continue
            if isinstance(v, dict) and isinstance(out.get(k), dict):
                out[k] = {**out[k], **v}
            else:
                out[k] = v
    # roster : union, le scan le plus récent gagne pour un même perso
    for _, db in sorted(dbs, key=lambda x: int(x[1].get("rosterT") or 0)):
        if isinstance(db.get("roster"), dict):
            out.setdefault("roster", {}).update(db["roster"])
            out["rosterT"], out["guild"] = db.get("rosterT"), db.get("guild") or out.get("guild")
    # semaines et assigns : par clé, le « t » le plus récent gagne
    for key in ("weeks", "assigns"):
        merged = {}
        for _, db in dbs:
            for k, v in (db.get(key) or {}).items() if isinstance(db.get(key), dict) else []:
                if isinstance(v, dict) and int(v.get("t") or 0) >= int((merged.get(k) or {}).get("t") or 0):
                    merged[k] = v
        if merged:
            out[key] = merged
    best = max((db for _, db in dbs), key=lambda d: int((d.get("appearance") or {}).get("t") or 0) if isinstance(d.get("appearance"), dict) else 0)
    if isinstance(best.get("appearance"), dict):
        out["appearance"] = best["appearance"]
    best = max((db for _, db in dbs), key=lambda d: int(d.get("absT") or 0))
    if "absences" in best:
        out["absences"], out["absT"] = best["absences"], best.get("absT")
    return out


def _signature(value):
    """Empreinte d'une valeur (détecte un vrai changement sans tout comparer)."""
    import hashlib
    return hashlib.sha1(json.dumps(value, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()


TAB_PAGES = ("calendar", "comps", "assigns", "members", "loots", "craft")
TAB_KEYS = ("bgAlpha", "tabsAlpha", "listGlass")


# ---------------------------------------------------------------- Bislist : stats des objets (infobulle Wowhead)
BIS_SLOTS = {"Head", "Neck", "Shoulder", "Back", "Chest", "Robe", "Wrist", "Hands", "Waist", "Legs", "Feet", "Finger", "Trinket",
             "Main Hand", "One-Hand", "Two-Hand", "Off Hand", "Held In Off-hand", "Ranged", "Thrown", "Relic", "Projectile"}
_BIS_EQUIP = [
    (r"critical strike with spells by ([\d.]+)%", ("SpellCritRating",)),
    (r"chance to hit with spells by ([\d.]+)%", ("SpellHitRating",)),
    (r"chance to get a critical strike by ([\d.]+)%", ("CritRating",)),
    (r"chance to hit by ([\d.]+)%", ("HitRating",)),
    (r"damage and healing done by magical spells and effects by up to (\d+)", ("SpellDamage", "Healing")),
    (r"healing done by (?:magical spells and effects by )?up to (\d+)", ("Healing",)),
    (r"damage done by magical spells and effects by up to (\d+)", ("SpellDamage",)),
    (r"(?i)^\+(\d+) ranged Attack Power\.?$", ("Rap",)),
    (r"^\+(\d+) Attack Power\.?$", ("Ap",)),
    (r"Restores (\d+) mana per 5 sec", ("Mp5",)),
    (r"attack speed by ([\d.]+)%", ("HasteRating",)),
    (r"(?i)haste[^\d]*([\d.]+)", ("HasteRating",)),
    (r"dodged or parried by ([\d.]+)%", ("ExpertiseRating",)),
    (r"(?i)expertise[^\d]*([\d.]+)", ("ExpertiseRating",)),
]


def bis_item_stats(tt):
    """Stats d'un objet lues dans son infobulle : {Pawn: valeur} (sans les bonus de set)."""
    if not tt:
        return {}
    txt = re.sub(r"<!--.*?-->", "", tt, flags=re.S)
    lines = [re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", x).replace("&nbsp;", " ")).strip()
             for x in re.split(r"(?i)<br\s*/?>|</td>|</th>|</div>|</tr>|<table[^>]*>", txt)]
    st, slot, dps = {}, None, 0.0

    def add(k, v):
        st[k] = st.get(k, 0) + v
    for raw in lines:
        if not raw:
            continue
        if not slot and raw in BIS_SLOTS:
            slot = raw
            continue
        m = re.match(r"^\(([\d.]+) damage per second\)$", raw)
        if m:
            dps = float(m.group(1))
            continue
        m = re.match(r"^\+(\d+) (Strength|Agility|Stamina|Intellect|Spirit)\.?$", raw)
        if m:
            add(m.group(2), int(m.group(1)))
            continue
        m = re.match(r"^\+(\d+) (Fire|Nature|Frost|Shadow|Arcane) Resistance\.?$", raw)
        if m:
            add(m.group(2) + "Resistance", int(m.group(1)))
            continue
        m = re.match(r"^\+(\d+) (?:to )?All Resistances\.?$", raw)
        if m:
            for r in ("Fire", "Nature", "Frost", "Shadow", "Arcane"):
                add(r + "Resistance", int(m.group(1)))
            continue
        m = re.match(r"^(\d+) Armor$", raw)
        if m:
            add("Armor", int(m.group(1)))
            continue
        if not raw.startswith("Equip:"):
            continue
        line = re.sub(r"^Equip:\s*", "", raw)
        for pat, keys in _BIS_EQUIP:
            m = re.search(pat, line)
            if m:
                for k in keys:
                    add(k, float(m.group(1)))
                break
    if dps:
        add("RangedDps" if slot in ("Ranged", "Thrown") else "MeleeDps", dps)
    return st


def _crop_rect(v):
    """Cadrage {x, y, w, h} en fractions de l'image (0-1), sinon None."""
    if not isinstance(v, dict):
        return None
    try:
        r = {k: max(0.0, min(1.0, round(float(v[k]), 5))) for k in ("x", "y", "w", "h")}
        # opacité (a) et flou (b) de l'image, réglés dans l'outil de recadrage (0-1)
        for k in ("a", "b"):
            if v.get(k) is not None:
                r[k] = max(0.0, min(1.0, round(float(v[k]), 3)))
    except (KeyError, TypeError, ValueError):
        return None
    return r if r["w"] > 0 and r["h"] > 0 else None


def _clean_tabs(tabs):
    """Réglages d'apparence propres à un onglet : {onglet: {bgAlpha, tabsAlpha, listGlass}} (0 à 1)."""
    out = {}
    for page, vals in (tabs or {}).items():
        if page in TAB_PAGES and isinstance(vals, dict):
            v = {k: max(0.0, min(1.0, float(vals[k]))) for k in TAB_KEYS if isinstance(vals.get(k), (int, float))}
            if v:
                out[page] = v
    return out


def _version_tuple(v):
    try:
        return tuple(int(x) for x in str(v or "0").split("."))
    except ValueError:
        return (0,)


def _set_clipboard(text):
    CF_UNICODETEXT, GMEM_MOVEABLE = 13, 0x0002
    k32, u32 = ctypes.windll.kernel32, ctypes.windll.user32
    k32.GlobalAlloc.restype = ctypes.c_void_p
    k32.GlobalLock.restype = ctypes.c_void_p
    k32.GlobalLock.argtypes = [ctypes.c_void_p]
    k32.GlobalUnlock.argtypes = [ctypes.c_void_p]
    u32.SetClipboardData.argtypes = [ctypes.c_uint, ctypes.c_void_p]
    data = text.encode("utf-16-le") + b"\0\0"
    h = k32.GlobalAlloc(GMEM_MOVEABLE, len(data))
    ptr = k32.GlobalLock(h)
    ctypes.memmove(ptr, data, len(data))
    k32.GlobalUnlock(h)
    if not u32.OpenClipboard(None):
        raise RuntimeError("Clipboard busy")
    try:
        u32.EmptyClipboard()
        u32.SetClipboardData(CF_UNICODETEXT, h)
    finally:
        u32.CloseClipboard()


class Bridge:
    """Méthodes appelées depuis le JavaScript (window.pywebview.api.*)."""

    def __init__(self):
        self._lock = threading.RLock()
        self._config = _load(CONFIG_PATH, DEFAULT_CONFIG)
        if not self._config["wowPath"]:
            self._config["wowPath"] = _guess_wow_path()
        self._migrate_saved_variables()
        self._data = _load(DATA_PATH, DEFAULT_DATA)
        self._sv = {}
        self._sv_queue = []        # réactions aux events faites en jeu (GuildToolDB.rhQueue)
        self._sv_grants = []       # droits d'officier temporaires changés en jeu (GuildToolDB.grantQueue)
        self._sv_mtime = 0
        self._sv_error = ""
        if not self._config["account"]:
            self._config["account"] = self._guess_account()
        self._rclc, self._rclc_mtime = {}, 0
        self._cloud = cloud.Cloud(APP_DIR, BASE_DIR)
        # Preference Score : sommes par paire (officiers, autofill), en mémoire seulement
        self._social_pairs = {}
        self._read_sv()
        self._migrate_comps()
        self._normalize_weeks()
        self._drop_empty_comps()
        try:
            self._rename_media()
            self._ensure_blur_textures()
            self._write_fade_masks()
        except Exception:
            traceback.print_exc()

    def _ensure_blur_textures(self):
        """Versions floutées des images de raid pour l'addon (<texture>_blur.tga : fond flouté de la barre d'onglets d'Assigns),
        et fond de fenêtre du jeu refait s'il a été effacé (addon réinstallé / mis à jour)."""
        from PIL import Image
        if not os.path.isdir(self._media()):
            return
        bg = self._bg_path()
        if bg and os.path.exists(bg) and not os.path.exists(self._media("bg_window.tga")):
            try:
                self._bg_textures(Image.open(bg).convert("RGB"))
            except Exception:
                traceback.print_exc()
        for ph in self._phases():
            for r in ph["raids"]:
                if r.get("tex") and r.get("img"):
                    name, src = r["tex"], self._raid_img(r["key"], True)
                elif not r.get("custom"):
                    name, src = "bg_" + r["key"], os.path.join(BASE_DIR, "web", "img", "bg_%s_blur.jpg" % r["key"])
                else:
                    continue
                dst = self._media(name + "_blur.tga")
                if os.path.exists(src) and not os.path.exists(dst):
                    Image.open(src).convert("RGB").resize((512, 512), Image.LANCZOS).save(dst)
        # images de fond des persos d'avant la version floutée
        from PIL import ImageFilter
        cdir = self._media("chars")
        for f in os.listdir(cdir) if os.path.isdir(cdir) else []:
            if f.endswith(".tga") and not f.endswith("_blur.tga") and not os.path.exists(os.path.join(cdir, f[:-4] + "_blur.tga")):
                try:
                    Image.open(os.path.join(cdir, f)).convert("RGB").filter(ImageFilter.GaussianBlur(6)).resize((512, 128), Image.LANCZOS) \
                        .save(os.path.join(cdir, f[:-4] + "_blur.tga"))
                except Exception:
                    traceback.print_exc()

    def _drop_empty_comps(self):
        """Une fois : supprime les compos sans aucun joueur (avant, chaque semaine en créait 2 par défaut)."""
        if self._data.get("emptyCompsDropped"):
            return
        for week in self._data["weeks"].values():
            kept = [c for c in week.get("comps", []) if any(c.get("c", {}).values())]
            if len(kept) != len(week.get("comps", [])):
                week["comps"] = kept
                week["t"] = remote.now()
        self._data["emptyCompsDropped"] = True
        _save(DATA_PATH, self._data)

    # ------------------------------------------------------------ chemins
    def _accounts(self):
        root = os.path.join(self._config["wowPath"], "WTF", "Account")
        try:
            return sorted(d for d in os.listdir(root) if d != "SavedVariables" and os.path.isdir(os.path.join(root, d)))
        except OSError:
            return []

    def _migrate_saved_variables(self):
        """Ancien addon RaidPlanner : RaidPlanner.lua de chaque compte copié en GuildTool.lua (variable renommée),
        tant que le nouveau fichier n'existe pas (à faire jeu fermé : WoW réécrit ses fichiers à la déconnexion)."""
        root = os.path.join(self._config["wowPath"], "WTF", "Account")
        for acc in (os.listdir(root) if os.path.isdir(root) else []):
            sv = os.path.join(root, acc, "SavedVariables")
            old, new = os.path.join(sv, OLD_ADDON + ".lua"), os.path.join(sv, "GuildTool.lua")
            if os.path.isfile(old) and not os.path.exists(new):
                try:
                    with open(old, encoding="utf-8") as fh:
                        text = fh.read()
                    with open(new, "w", encoding="utf-8") as fh:
                        fh.write(re.sub(r"^%s\s*=" % OLD_DB, "GuildToolDB =", text, flags=re.M))
                except OSError:
                    pass

    def _sv_path(self, account=None, addon="GuildTool"):
        return os.path.join(self._config["wowPath"], "WTF", "Account", account or self._config["account"],
                            "SavedVariables", addon + ".lua")

    def _wow_accounts(self):
        """Comptes choisis : [{folder, all}] ; un même compte Battle.net peut avoir plusieurs licences
        (dossiers « 123456789#1 », « 123456789#2 »…) ; all = toutes les licences de ce compte."""
        accs = [a for a in (self._config.get("wowAccounts") or []) if isinstance(a, dict) and a.get("folder")]
        if not accs and self._config.get("account"):
            accs = [{"folder": self._config["account"], "all": False}]
        return accs

    def _account_folders(self):
        """Dossiers de WTF/Account à lire, d'après les comptes choisis."""
        existing, out = self._accounts(), []
        for a in self._wow_accounts():
            if a.get("all"):
                bnet = a["folder"].split("#")[0]
                found = [d for d in existing if d.split("#")[0] == bnet]
            else:
                found = [a["folder"]] if a["folder"] in existing else []
            for d in found:
                if d not in out:
                    out.append(d)
        return out

    def _import_path(self):
        return os.path.join(self._config["wowPath"], "Interface", "AddOns", "GuildTool", "Import.lua")

    def _guess_account(self):
        best, best_t = "", -1
        for acc in self._accounts():
            p = self._sv_path(acc)
            t = os.path.getmtime(p) if os.path.exists(p) else 0
            if t > best_t:
                best, best_t = acc, t
        return best

    # ------------------------------------------------------------ SavedVariables
    def _read_sv(self):
        """SavedVariables de tous les comptes / licences choisis, fusionnés (le plus récent gagne)."""
        paths = [p for p in (self._sv_path(d) for d in self._account_folders()) if os.path.exists(p)]
        if not paths:
            self._sv, self._sv_mtime = {}, 0
            self._sv_error = "SavedVariables not found yet: open the addon in game once, then /reload."
            return False
        stamp = tuple(sorted((p, os.path.getmtime(p)) for p in paths))
        if stamp == self._sv_mtime:
            return False
        dbs = []
        try:
            for p, mtime in stamp:
                with open(p, encoding="utf-8", errors="replace") as f:
                    db = luaio.parse_savedvariables(f.read()).get("GuildToolDB") or {}
                if isinstance(db, dict):
                    dbs.append((mtime, db))
            self._sv_error = ""
        except Exception as e:  # fichier en cours d'écriture par le jeu, on retentera
            self._sv_error = "Could not read SavedVariables: %s" % e
            return False
        self._sv = _merge_svs(dbs)
        self._sv_mtime = stamp
        # réactions aux events faites en jeu (tous les comptes) : exécutées par l'exe
        self._sv_queue = [q for _, d in dbs for q in (d.get("rhQueue") or []) if isinstance(q, dict)]
        # droits d'officier temporaires donnés / retirés en jeu (officiers)
        self._sv_grants = [q for _, d in dbs for q in _as_list(d.get("grantQueue")) if isinstance(q, dict)]
        # attributions de loot rangées en jeu par les officiers (/tlc), tous les comptes : doublons retirés
        edits = {}
        for _, d in dbs:
            for k, e in (d.get("lootEdits") or {}).items() if isinstance(d.get("lootEdits"), dict) else []:
                if isinstance(e, dict) and int(e.get("t") or 0) > int((edits.get(k) or {}).get("t") or 0):
                    edits[k] = e
        self._merge_loot([r for _, d in dbs for r in _as_list(d.get("lootHistory")) if isinstance(r, dict)], edits)
        self._merge_boss_ed([d.get("bossLootEdits") for _, d in dbs])
        self._merge_boss_loot([d.get("bossLoot") for _, d in dbs])
        self._game_publish(dbs)
        self._merge_sv_comps()
        self._resolve_all()
        return True

    # ------------------------------------------------------------ semaines de lockout
    def _anchor(self):
        # reset de la guilde : mercredi 5h heure locale (le reset donné par le jeu est un mardi sur ce serveur)
        return FALLBACK_ANCHOR

    def week_start(self, ts):
        a = self._anchor()
        return a + ((int(ts) - a) // WEEK) * WEEK

    def _normalize_weeks(self):
        """Semaines créées avec un autre jour de reset : leurs compos rejoignent la semaine de leur event."""
        weeks = self._data["weeks"]
        bad = [k for k in weeks if not k.isdigit() or self.week_start(int(k) + 1) != int(k)]
        if not bad:
            return
        starts = {e["id"]: e.get("start") for e in self._data["events"]}
        for key in bad:
            week = weeks.pop(key)
            base = int(key) if key.isdigit() else int(time.time())
            for comp in week.get("comps", []):
                target_key = str(self.week_start(starts.get(comp.get("event")) or base + 3 * 86400))
                target = weeks.setdefault(target_key, {"t": 0, "comps": []})
                target["comps"].append(comp)
                target["t"] = max(target.get("t", 0), week.get("t", 0), 1)
        _save(DATA_PATH, self._data)

    def _migrate_comps(self):
        """v1 : compos par event puis par raid -> v2 : par semaine de lockout."""
        old = self._data.pop("comps", None)
        if not old:
            return
        starts = {e["id"]: e.get("start") for e in self._data["events"]}
        for event_id, raids in old.items():
            if not starts.get(event_id):
                continue
            key = str(self.week_start(starts[event_id]))
            week = self._data["weeks"].setdefault(key, {"t": 1, "comps": []})
            for raid_key, entry in raids.items():
                for i, slots in enumerate(entry.get("c", [])):
                    if slots:
                        week["comps"].append({"id": "m%s%s%d" % (event_id[-6:], raid_key, i), "raid": raid_key,
                                              "event": event_id, "valid": False, "c": slots})
        _save(DATA_PATH, self._data)

    @staticmethod
    def _loot_key(r):
        return "%s|%s|%d" % (r.get("id") or r.get("name") or "?", r.get("to") or "?", int(r.get("t") or 0) // 120)

    def _merge_loot(self, records, edits=None):
        """Base des attributions de loot : une entrée par objet attribué (GUID de l'objet, sinon objet + joueur +
        moment), quelle que soit la source ; une version plus récente (changement de joueur, suppression) remplace."""
        store, changed = self._data.setdefault("lootDB", {}), False
        for r in records:
            k = str(r.get("k") or ("g:" + str(r["key"]) if r.get("key") else self._loot_key(r)))
            cur = store.get(k)
            at = int(r.get("at") or 0)
            if cur is None or (at and at > int(cur.get("at") or 0)):
                rec = {x: r.get(x) for x in ("id", "name", "link", "tt", "t", "to", "by", "kind", "same", "deleted", "zone", "boss", "raid", "spec")}
                if cur and not rec.get("tt"):
                    rec["tt"] = cur.get("tt")
                rec["k"], rec["at"] = k, at or remote.now()     # date de la version : envoi à la guilde
                store[k] = rec
                changed = True
        # modifications faites en jeu (onglet Loots) : joueur changé, attribution supprimée
        for k, e in (edits or {}).items():
            cur = store.get(str(k))
            if isinstance(e, dict) and cur and int(e.get("t") or 0) > int(cur.get("at") or 0):
                if e.get("deleted"):
                    cur["deleted"] = True
                if e.get("to"):
                    cur["to"] = e["to"]
                if e.get("kind"):
                    cur["kind"] = e["kind"]
                cur["at"] = int(e["t"])
                changed = True
        if changed:
            _save(DATA_PATH, self._data)
            if self._cloud.officer:
                self._kick_live()
        return changed

    def loot_add(self, rec):
        """(officier) Onglet Loots, « + » : attribution ajoutée à la main (objet, perso, réaction, date)."""
        if not isinstance(rec, dict) or not rec.get("id") or not rec.get("to"):
            return {"ok": False, "error": "Item and character are required."}
        k = "m:%d:%d" % (int(time.time() * 1000), int(rec["id"]))
        r = {"k": k, "id": int(rec["id"]), "name": rec.get("name"), "to": str(rec["to"]), "kind": rec.get("kind") or None,
             "t": int(rec.get("t") or time.time()), "by": "manual", "same": [], "zone": rec.get("zone"), "boss": rec.get("boss"),
             "raid": rec.get("raid"), "spec": rec.get("spec"), "at": remote.now()}
        with self._lock:
            self._merge_loot([r])
            self._safe_write()
        if self._cloud.officer:
            self._kick_live()
        return {"ok": True, "k": k}

    def loot_edit(self, k, to=None, delete=False, kind=None):
        """(officier) Onglet Loots : attribution changée de joueur, de réaction, ou supprimée de la base."""
        with self._lock:
            cur = (self._data.get("lootDB") or {}).get(str(k))
            if not cur:
                return {"ok": False, "error": "Unknown loot."}
            if delete:
                cur["deleted"] = True
            if to:
                cur["to"] = str(to)
            if kind:
                cur["kind"] = str(kind)
            cur["at"] = remote.now()
            _save(DATA_PATH, self._data)
            self._safe_write()
        if self._cloud.officer:
            self._kick_live()
        return {"ok": True}

    def _loot_list(self):
        """Attributions (sans les supprimées), la plus récente en tête, sans les infobulles (exe : survol Wowhead)."""
        out = [{x: r.get(x) for x in ("k", "id", "name", "link", "t", "to", "by", "kind", "same", "zone", "boss", "raid", "spec")}
               for r in (self._data.get("lootDB") or {}).values() if not r.get("deleted")]
        return sorted(out, key=lambda r: -int(r.get("t") or 0))

    def _boss_loot_view(self):
        """Tables de loot montrées (appli, jeu) : celles de la guilde + les boss / loots factices de test (TEST_BOSS_LOOT)."""
        view = {r: {b: dict(its) for b, its in bs.items()} for r, bs in (self._data.get("bossLoot") or {}).items()}
        for raid, bosses in TEST_BOSS_LOOT.items():
            for boss, ids in bosses.items():
                cur = view.setdefault(raid, {}).setdefault(boss, {})
                for i in ids:
                    cur.setdefault(str(i), 0)
        return view

    # ------------------------------------------------------------ wishlist (par perso, partagée avec le perso)
    @staticmethod
    def _clean_wish(items):
        out, seen = [], set()
        for it in _as_list(items):
            if not isinstance(it, dict):
                continue
            try:
                iid = int(it.get("id"))
            except (TypeError, ValueError):
                continue
            k = it.get("k") if it.get("k") in WISH_KINDS else "bis"
            if iid > 0 and iid not in seen:
                seen.add(iid)
                out.append({"id": iid, "k": k, "t": int(it.get("t") or 0)})
        return out

    def _wishlist(self):
        """Mes wishlists {perso: {t, items}} : celles de l'appli et du jeu (GuildToolDB.wishlist), la plus récente gagne."""
        local = self._data.setdefault("wishlist", {})
        sv = self._sv.get("wishlist") if isinstance(self._sv.get("wishlist"), dict) else {}
        changed = False
        for n, w in sv.items():
            if isinstance(w, dict) and int(w.get("t") or 0) > int((local.get(n) or {}).get("t") or 0):
                local[str(n)] = {"t": int(w.get("t") or 0), "items": self._clean_wish(w.get("items"))}
                changed = True
        if changed:
            _save(DATA_PATH, self._data)
        return local

    def _wishlists_view(self):
        """Wishlists connues {perso: [objets]} : celles partagées par la guilde (persos des autres), les miennes à jour."""
        out = {}
        for n, c in (self._data.get("cloudChars") or {}).items():
            wl = (c.get("data") or {}).get("wl")
            if wl:
                out[n] = self._clean_wish(wl)
        for n, w in self._wishlist().items():
            out[n] = list(w.get("items") or [])
        return out

    # réglages de la guilde (officiers) : vues de Loots cachées aux membres
    LOOT_FLAGS = ("lootHideCompare", "lootHideHistory", "lootHideOrder")

    def _guild_flags(self):
        gs = self._data.get("guildSettings") or {}
        return {k: bool(gs.get(k)) for k in self.LOOT_FLAGS}

    def set_guild_flags(self, values):
        """(officier) Vues de Loots cachées aux membres : Compare, History, ordre de loot des Tables."""
        if not self.can_admin():
            return {"ok": False, "error": "Officers only."}
        with self._lock:
            gs = dict(self._data.get("guildSettings") or {})
            for k in self.LOOT_FLAGS:
                if k in (values or {}):
                    gs[k] = bool(values[k])
            gs["t"] = remote.now()
            self._data["guildSettings"] = gs
            _save(DATA_PATH, self._data)
            self._safe_write()
        return {"ok": True, "flags": self._guild_flags()}

    def _wish_arch_hide(self):
        """Archives de wishlist retirées par un officier {« perso|objet »: 1} (réglages de la guilde) ; les retraits faits
        en jeu par un officier (GuildToolDB.wishArchHide) y sont ajoutés."""
        gs = self._data.get("guildSettings") or {}
        hide = dict(gs.get("wishArchHide") or {})
        sv = self._sv.get("wishArchHide") if isinstance(self._sv.get("wishArchHide"), dict) else {}
        new = [k for k in sv if k not in hide]
        if new and self.can_edit():
            for k in new:
                hide[str(k)] = 1
            self._data["guildSettings"] = {**gs, "wishArchHide": hide, "t": remote.now()}
            _save(DATA_PATH, self._data)
        return hide

    def wish_arch_hide(self, char, item_id):
        """(officier) Retire une archive de wishlist pour tout le monde."""
        if not self.can_edit():
            return {"ok": False, "error": "Officers only."}
        with self._lock:
            gs = dict(self._data.get("guildSettings") or {})
            hide = dict(gs.get("wishArchHide") or {})
            hide["%s|%s" % (char, int(item_id))] = 1
            gs["wishArchHide"], gs["t"] = hide, remote.now()
            self._data["guildSettings"] = gs
            _save(DATA_PATH, self._data)
            self._safe_write()
        return {"ok": True, "hide": hide}

    # ------------------------------------------------------------ Bislist (Loots) : données de la guilde
    def _bis_editor(self, key):
        """Ce compte est-il éditeur de la Bislist de cette spé (liste « editors » choisie par les officiers) ?"""
        me = self._my_discord()
        return bool(me) and str(me) in [str(x) for x in ((self._data.get("bis") or {}).get(key) or {}).get("editors") or []]

    def bis_save(self, key, value):
        """Bislist d'une spé « CLASSE:Spé » : {ep: {stat: poids}, talents: {sort: rang},
        sets: [{n, g: {emplacement: objet}, own, talents}], editors: [ids Discord]}. Officiers (envoi avec les autres
        docs) ; éditeurs de la spé : envoi tout de suite par la route serveur « bis » (la liste des éditeurs, elle, ne
        change que par un officier)."""
        editor = not self.can_edit() and self._bis_editor(key)
        if not self.can_edit() and not editor:
            return {"ok": False, "error": "Officers only (or the editors of this spec)."}
        m = re.match(r"^([A-Z]+):([A-Za-z]+)$", str(key or ""))
        if not m or not isinstance(value, dict):
            return {"ok": False, "error": "Bad spec."}

        def num_map(d, cast):
            out = {}
            for k, v in (d or {}).items() if isinstance(d, dict) else []:
                try:
                    out[str(k)[:40]] = cast(v)
                except (TypeError, ValueError):
                    pass
            return out
        sets = []
        for st in (value.get("sets") or [])[:12]:
            if not isinstance(st, dict):
                continue
            sets.append({"n": str(st.get("n") or "Bis")[:30], "g": {k: v for k, v in num_map(st.get("g"), int).items() if v > 0},
                         **({"own": True, "talents": num_map(st.get("talents"), int)} if st.get("own") else {})})
        old_editors = ((self._data.get("bis") or {}).get(key) or {}).get("editors") or []
        editors = [str(x) for x in (value.get("editors") or []) if str(x).isdigit()][:50] if not editor else old_editors
        clean = {"ep": num_map(value.get("ep"), float), "talents": num_map(value.get("talents"), int), "sets": sets,
                 "editors": editors, "t": remote.now()}
        if editor:
            r = self._rh_call("bis", key=key, value={k: v for k, v in clean.items() if k != "t"})
            if not r.get("ok"):
                return r
            clean["t"] = int(r.get("t") or clean["t"])
        with self._lock:
            self._data.setdefault("bis", {})[key] = clean
            _save(DATA_PATH, self._data)
            self._safe_write()
        return {"ok": True}

    def _bis_tip(self):
        """Infobulle des objets de raid en jeu : {objet: {CLASSE: [{s: spé, e: EP, b: meilleur set}]}} ; objets des
        tables de loot et des sets ; spés avec des poids, ou dont un set contient l'objet."""
        bis = self._data.get("bis") or {}
        if not bis:
            return {}
        ids = set()
        for bosses in (self._boss_loot_view() or {}).values():
            for items in (bosses or {}).values():
                ids.update(str(i) for i in (items or {}))
        for d in bis.values():
            for st in d.get("sets") or []:
                ids.update(str(i) for i in (st.get("g") or {}).values())
        cache, out = self._data.get("items") or {}, {}
        for i in ids:
            stats = bis_item_stats((cache.get(i) or {}).get("tt"))
            for key, d in bis.items():
                cls, spec = key.split(":", 1)
                ep = d.get("ep") or {}
                e = sum(float(ep.get(k) or 0) * v for k, v in stats.items()) if ep else 0
                best = next((st.get("n") or "Bis" for st in d.get("sets") or [] if int(i) in [int(x) for x in (st.get("g") or {}).values()]), None)
                if not e and not best:
                    continue
                out.setdefault(i, {}).setdefault(cls, []).append({k: v for k, v in (("s", spec), ("e", round(e, 1) if e else None), ("b", best)) if v})
        return out

    def wishlist_set(self, char, items):
        """Remplace la wishlist d'un de mes persos (appli) ; partagée au prochain envoi des persos, exportée au jeu."""
        with self._lock:
            self._wishlist()[str(char)] = {"t": int(time.time()), "items": self._clean_wish(items)}
            _save(DATA_PATH, self._data)
            self._safe_write()
            return self._wishlists_view()

    def _merge_boss_loot(self, sources, t=None):
        """Loots vus sur chaque boss (/tlc en jeu, et la guilde) : {raid: {boss: {itemId: date}}}, réunis (jamais
        effacés). True si quelque chose de nouveau est arrivé ; bossLootT = date de la version (envoi à la guilde)."""
        store, changed = self._data.setdefault("bossLoot", {}), False
        ed = self._data.get("bossLootEd") or {}
        for src in sources:
            if not isinstance(src, dict):
                continue
            for raid, bosses in src.items():
                if not isinstance(bosses, dict):
                    continue
                for boss, items in bosses.items():
                    if not isinstance(items, dict):
                        continue
                    cur = store.setdefault(str(raid), {}).setdefault(str(boss)[:60], {})
                    for iid, when in items.items():
                        if (ed.get("%s|%s|%s" % (raid, str(boss)[:60], iid)) or {}).get("op") == "del":
                            continue
                        if str(iid).isdigit() and str(iid) not in cur:
                            cur[str(iid)] = int(when or 0)
                            changed = True
        if changed:
            self._data["bossLootT"] = max(int(t or 0), remote.now()) if t is None else int(t)
            _save(DATA_PATH, self._data)
        return changed

    def _merge_boss_ed(self, sources, t=None):
        """Modifications des tables de loot (officiers, en jeu : ajout / suppression, transfert = les deux) :
        {"raid|boss|objet": {op: add|del, t}}, la plus récente gagne par clé ; appliquées à la table de la guilde (un
        objet supprimé n'y revient plus par la fusion). True si quelque chose a changé."""
        ed, changed = self._data.setdefault("bossLootEd", {}), False
        for src in sources:
            for key, e in (src or {}).items() if isinstance(src, dict) else []:
                parts = str(key).split("|")
                if len(parts) != 3 or not parts[2].isdigit() or not isinstance(e, dict) or e.get("op") not in ("add", "del"):
                    continue
                if int(e.get("t") or 0) > int((ed.get(key) or {}).get("t") or 0):
                    ed[key] = {"op": e["op"], "t": int(e.get("t") or 0)}
                    changed = True
        store = self._data.setdefault("bossLoot", {})
        for key, e in ed.items():
            raid, boss, iid = key.split("|")
            cur = store.setdefault(raid, {}).setdefault(boss, {}) if e["op"] == "add" else (store.get(raid) or {}).get(boss) or {}
            if e["op"] == "del" and iid in cur:
                del cur[iid]
                changed = True
            elif e["op"] == "add" and iid not in cur:
                cur[iid] = int(e["t"])
                changed = True
        if changed:
            self._data["bossLootT"] = remote.now() if t is None else max(int(t), int(self._data.get("bossLootT") or 0))
            _save(DATA_PATH, self._data)
        return changed

    def _game_publish(self, dbs):
        """Réglages publiés en jeu par un officier (Settings > Publish guild settings, écrits au /reload) : l'apparence
        de /two (doc « appearance ») ou de /tlc (doc « tlcap ») devient celle de la guilde, envoyée à la synchro."""
        done, kick = self._data.setdefault("publishDone", {}), False
        allowed = self._cloud.officer or not (self._cloud.logged and self._cloud.guild_id)
        for _, d in dbs:
            req = d.get("publishReq") if isinstance(d.get("publishReq"), dict) else {}
            for key in ("two", "tlc"):
                t = int(req.get(key) or 0)
                if t <= int(done.get(key) or 0):
                    continue
                done[key] = t
                if not allowed:
                    continue
                if key == "tlc":
                    ap = (d.get("ui") or {}).get("lootAp") if isinstance(d.get("ui"), dict) else None
                    if isinstance(ap, dict):
                        self._data["guildLootAp"] = {**{k: v for k, v in ap.items() if k != "t"}, "t": remote.now()}
                        kick = True
                else:
                    a = d.get("appearance")
                    if isinstance(a, dict):
                        keep = {k: v for k, v in a.items() if k not in ("t", "local", "lang", "bg")}
                        keep["bg"] = bool((self._data.get("guildAppearance") or {}).get("bg"))
                        self._data["guildAppearance"] = {**keep, "t": remote.now()}
                        kick = True
        if done:
            _save(DATA_PATH, self._data)
        if kick and self._cloud.officer:
            self._kick_live()

    def _loot_counts(self):
        out = {}
        for r in (self._data.get("lootDB") or {}).values():
            if r.get("id") and not r.get("deleted"):
                out[int(r["id"])] = out.get(int(r["id"]), 0) + 1
        return out

    def _is_commu(self, ev):
        """Event du salon raid-commu (réglage Admin, 1558492094581051514 par défaut) : compos communautaires.
        Tous les autres events sont des events Main."""
        s = self._rh_settings()
        # salon d'archive des events communautaires (lockouts passés) : toujours communautaires
        return bool(ev) and str(ev.get("chId") or "") in (str(s.get("rhCommuChannel") or "1558492094581051514"),
                                                           str(s.get("rhCommuArchive") or "1559968122457563166"))

    def _my_discord(self):
        return (self._cloud.session.get("user") or {}).get("id") if self._cloud.logged else None

    def _merge_sv_comps(self):
        """Semaines modifiées en jeu : la plus récente gagne, semaine par semaine. Les compos communautaires faites ou
        modifiées en jeu (créateur de l'event, officier) partent dans les compos communautaires de l'exe."""
        changed = False
        seen = self._data.setdefault("svCommuT", {})
        events = {e["id"]: e for e in self._data["events"]}
        me, officer = self._my_discord(), self._cloud.officer
        store = self._data.setdefault("ccomps", {})
        for key, raw in (self._sv.get("weeks") or {}).items():
            week = _week_from_lua(raw)
            cur = self._data["weeks"].get(str(key))
            if week and (not cur or week["t"] > cur.get("t", 0)):
                self._data["weeks"][str(key)] = week
                changed = True
            t = int(raw.get("t") or 0) if isinstance(raw, dict) else 0
            if not t or t <= int(seen.get(str(key)) or 0):
                continue
            seen[str(key)] = t
            changed = True
            for c in _as_list(raw.get("comps")):
                if not (isinstance(c, dict) and c.get("commu") and c.get("id")):
                    continue
                ev = events.get(str(c.get("event") or ""))
                owner = c.get("owner") or (ev or {}).get("lid")
                if not (officer or (me and owner == me)):
                    continue
                new = {"id": str(c["id"]), "raid": c.get("raid"), "event": c.get("event"), "valid": bool(c.get("valid")),
                       "c": _comp_from_lua(c.get("c")), **_comp_extras(c), "owner": owner}
                old = store.get(new["id"]) or {}
                keys = ("raid", "event", "valid", "c", "sp", "ph")
                if old.get("deleted") or _signature({k: old.get(k) or None for k in keys}) != _signature({k: new.get(k) or None for k in keys}):
                    self.save_ccomp(new)
        # compos communautaires supprimées en jeu
        for cid in list((self._sv.get("deletedCommu") or {}) if isinstance(self._sv.get("deletedCommu"), dict) else []):
            cc = store.get(str(cid))
            if cc and not cc.get("deleted") and (officer or (me and cc.get("owner") == me)):
                self.save_ccomp({**cc, "deleted": True})
        if self._split_commu_weeks():
            changed = True
        if changed:
            _save(DATA_PATH, self._data)
            self._normalize_weeks()

    def _split_commu_weeks(self):
        """Compo des officiers liée à un event du salon raid-commu : déplacée dans les compos communautaires."""
        events = {e["id"]: e for e in self._data["events"]}
        me, officer, moved = self._my_discord(), self._cloud.officer, False
        store = self._data.setdefault("ccomps", {})
        for key, week in self._data["weeks"].items():
            keep = []
            for c in week.get("comps") or []:
                ev = events.get(str(c.get("event") or ""))
                if not self._is_commu(ev):
                    keep.append(c)
                    continue
                moved = True
                if str(c.get("id")) not in store:
                    cc = {**c, "commu": True, "owner": ev.get("lid") or None}
                    if officer or (me and cc["owner"] == me):
                        self.save_ccomp(cc)
                    else:
                        store[str(c["id"])] = {**cc, "t": remote.now()}
            if len(keep) != len(week.get("comps") or []):
                week["comps"] = keep
                week["t"] = remote.now()
        return moved

    # ------------------------------------------------------------ RCLootCouncil
    def _read_rclc(self):
        """Historique RCLootCouncil de tous les comptes choisis : {nom du perso: [entrées du plus récent au plus ancien]}."""
        paths = [p for p in (self._sv_path(d, "RCLootCouncil") for d in self._account_folders()) if os.path.exists(p)]
        if not paths:
            self._rclc, self._rclc_mtime = {}, 0
            return False
        mtime = tuple(sorted((p, os.path.getmtime(p)) for p in paths))
        if mtime == self._rclc_mtime:
            return True
        realms = []
        try:
            for p, _ in mtime:
                with open(p, encoding="utf-8", errors="replace") as f:
                    db = luaio.parse_savedvariables(f.read()).get("RCLootCouncilLootDB") or {}
                realms.extend((db.get("factionrealm") or {}).values())
        except Exception:
            traceback.print_exc()
            return False
        out, seen = {}, set()
        for players in realms:
            for key, entries in (players or {}).items():
                name = str(key).split("-")[0]
                for e in _as_list(entries):
                    if not isinstance(e, dict):
                        continue
                    link = e.get("lootWon") or ""
                    m = re.search(r"item:(\d+)", link)
                    n = re.search(r"\[([^\]]+)\]", link)
                    t = re.match(r"(\d+)", str(e.get("id") or ""))
                    # la même entrée peut figurer dans plusieurs comptes
                    uid = (name, e.get("id"), link)
                    if uid in seen:
                        continue
                    seen.add(uid)
                    out.setdefault(name, []).append({
                        "t": int(t.group(1)) if t else 0, "date": e.get("date"), "itemID": int(m.group(1)) if m else None,
                        "name": n.group(1) if n else link, "response": e.get("response"), "boss": e.get("boss"),
                        "instance": e.get("instance"),
                    })
        for lst in out.values():
            lst.sort(key=lambda x: -x["t"])
        self._rclc, self._rclc_mtime = out, mtime
        return True

    def roster(self):
        """Roster de guilde ; les persos partagés par un joueur connecté portent automatiquement son pseudo Discord
        (prioritaire sur le tag écrit en note de guilde, qui reste possible)."""
        r = self._sv.get("roster") or {}
        if not isinstance(r, dict):
            return {}
        auto = self._auto_tags()
        if auto:
            r = {n: ({**e, "tag": auto[n]} if n in auto and isinstance(e, dict) else e) for n, e in r.items()}
        return r

    # ------------------------------------------------------------ liaison inscription -> joueur -> perso
    def min_level(self):
        """Niveau minimum choisi dans l'addon (Min lvl), 60 par défaut."""
        ui = self._sv.get("ui") or {}
        return int(ui.get("minLevel") or MAX_LEVEL)

    def _links(self):
        """Liens manuels : ceux faits en jeu, puis ceux de l'exe (prioritaires)."""
        links = {str(k): v for k, v in (self._sv.get("links") or {}).items()} if isinstance(self._sv.get("links"), dict) else {}
        links.update(self._data["links"])
        return links

    def _resolve_all(self):
        roster = self.roster()
        tags, names = {}, {}
        for name, r in roster.items():
            if isinstance(r, dict) and r.get("tag"):
                tags[_squash(r["tag"])] = r["tag"]
                names.setdefault(_squash(name), name)
                names.setdefault(_squash(name.split(" ")[0]), name)  # prénom (noms Forever en 2 mots)
        links = self._links()
        derived = {}
        for ev in sorted(self._data["events"], key=lambda e: e.get("start", 0)):
            for s in ev["signups"]:
                s["tag"] = self._tag_for(s, roster, tags, names, links)
                s["ch"] = self._char_for(s, roster) if s["tag"] else None
                if s["ch"] and s.get("s"):
                    derived[s["ch"]] = s["s"]
                    # historique des spés jouées par perso (la plus récente en tête), gardé entre les synchros
                    known = self._data["charSpecs"].setdefault(s["ch"], [])
                    if s["s"] in known:
                        known.remove(s["s"])
                    known.insert(0, s["s"])
                    del known[4:]
        self._derived_specs = derived

    def _tag_for(self, s, roster, tags, names, links):
        uid = s.get("uid")
        if uid and links.get(uid):
            return links[uid].lower()
        # liaison automatique : l'inscrit s'est connecté à Guild Tool (même compte Discord)
        for m in self._data.get("cloudMembers") or []:
            if m.get("discord_id") == uid and m.get("username"):
                return m["username"].lower()
        cached = self._data["usernames"].get(uid)
        if cached and cached[0]:
            return cached[0].lower()
        # nom affiché proche d'un tag ("Badboi" ~ "badboi.") ou du nom d'un perso taggé de la guilde
        display = s.get("n") or ""
        tokens = [_squash(display)] + [_squash(t) for t in re.split(r"[\W_]+", display) if t]
        for t in tokens:
            if t in tags:
                return tags[t]
        for t in tokens:
            name = names.get(t)
            if name and (not s.get("c") or roster[name].get("c") == s.get("c")):
                return roster[name]["tag"]
        for t in tokens:
            name = names.get(t)
            if name:
                return roster[name]["tag"]
        return None

    def _char_for(self, s, roster):
        best, best_level = None, -1
        hint = _squash(s.get("n"))
        for name, r in sorted(roster.items()):
            if isinstance(r, dict) and r.get("tag") == s["tag"] and r.get("c") == s.get("c") and (r.get("l") or 0) >= self.min_level():
                first = _squash(name.split(" ")[0])
                if first and first in hint:
                    return name
                if (r.get("l") or 0) > best_level:
                    best, best_level = name, r.get("l") or 0
        return best

    def _lookup_usernames(self):
        token = (self._config.get("botToken") or "").strip()
        if not token:
            return
        now = time.time()
        uids = {s["uid"] for ev in self._data["events"] for s in ev["signups"] if s.get("uid")}
        for uid in uids:
            cached = self._data["usernames"].get(uid)
            if cached and now - cached[1] < USERNAME_TTL:
                continue
            try:
                self._data["usernames"][uid] = [remote.discord_username(token, uid), int(now)]
            except remote.RemoteError as e:
                self._data["lastError"] = "Discord bot: %s" % e
                return

    # ------------------------------------------------------------ icônes de spé (emojis Raid-Helper)
    def _emote_path(self, emote_id):
        return os.path.join(APP_DIR, "emotes", "%s.png" % emote_id)

    def _tga_path(self, key):
        cls, spec = key.split(":", 1)
        return os.path.join(self._config["wowPath"], "Interface", "AddOns", "GuildTool", "media", "specs",
                            "%s_%s.tga" % (cls, spec))

    def _update_spec_icons(self):
        """Télécharge les emojis manquants et écrit les TGA lus par l'addon (32x32)."""
        from PIL import Image
        os.makedirs(os.path.join(APP_DIR, "emotes"), exist_ok=True)
        for key, emote_id in self._data["specEmotes"].items():
            png = self._emote_path(emote_id)
            try:
                if not os.path.exists(png):
                    data = remote.fetch_emoji(emote_id)
                    with open(png, "wb") as f:
                        f.write(data)
                tga = self._tga_path(key)
                if os.path.isdir(os.path.dirname(os.path.dirname(tga))) and not os.path.exists(tga):
                    os.makedirs(os.path.dirname(tga), exist_ok=True)
                    Image.open(png).convert("RGBA").resize((32, 32), Image.LANCZOS).save(tga)
            except Exception:
                traceback.print_exc()

    def _spec_icon_urls(self):
        out = {}
        for key, emote_id in self._data["specEmotes"].items():
            png = self._emote_path(emote_id)
            if os.path.exists(png):
                with open(png, "rb") as f:
                    out[key] = "data:image/png;base64," + base64.b64encode(f.read()).decode()
        return out

    # ------------------------------------------------------------ Import.lua
    def _write_import(self):
        events = []
        for ev in self._data["events"]:
            events.append({
                "id": ev["id"], "title": ev["title"], "start": ev["start"], "chId": ev.get("chId") or None,
                # créateur (compte Discord) et event du salon raid-commu : compos communautaires en jeu
                "lid": ev.get("lid") or None, "commu": self._is_commu(ev) or None,
                "signups": [{k: v for k, v in (("uid", s.get("uid")), ("n", s.get("n")), ("c", s.get("c")),
                                                  ("s", s.get("s")), ("r", s.get("r")), ("st", s.get("st")),
                                                  ("tag", s.get("tag")), ("ch", s.get("ch"))) if v}
                            for s in ev["signups"]],
            })
        weeks = {}
        for key, week in self._data["weeks"].items():
            weeks[key] = {"t": week.get("t", 0), "comps": [
                {k: v for k, v in (("id", c.get("id")), ("raid", c.get("raid")), ("event", c.get("event")),
                                   ("valid", c.get("valid") or None),
                                   ("c", {int(s): n for s, n in (c.get("c") or {}).items()}),
                                   # spé par compo et places réservées (exe) : gardées telles quelles par le jeu
                                   ("sp", c.get("sp") or None), ("ph", c.get("ph") or None)) if v is not None}
                for c in week.get("comps", [])]}
        # compos des events communautaires : visibles (œil), ou les miennes / toutes pour un officier ; marquées
        # « commu » (le jeu les montre, ses modifications de la semaine ne les reprennent pas)
        starts = {e["id"]: e.get("start") for e in self._data["events"]}
        me = (self._cloud.session.get("user") or {}).get("id") if self._cloud.logged else None
        for c in (self._data.get("ccomps") or {}).values():
            st = starts.get(str(c.get("event") or ""))
            if c.get("deleted") or not st or not (c.get("valid") or self._cloud.officer or (me and c.get("owner") == me)):
                continue
            wk = weeks.setdefault(str(self.week_start(st)), {"t": 0, "comps": []})
            wk["comps"].append({k: v for k, v in (("id", c.get("id")), ("raid", c.get("raid")), ("event", c.get("event")),
                                                  ("valid", c.get("valid") or None), ("commu", True), ("owner", c.get("owner")),
                                                  ("c", {int(s): n for s, n in (c.get("c") or {}).items()}),
                                                  ("sp", c.get("sp") or None), ("ph", c.get("ph") or None)) if v is not None})
        specs = dict(getattr(self, "_derived_specs", {}))
        specs.update(self._main_specs())
        specs.update(self._data["specs"])
        icons = {k: True for k in self._data["specEmotes"] if os.path.exists(self._tga_path(k))}
        payload = {"t": remote.now(), "events": events, "weeks": weeks, "specs": specs, "specIcons": icons,
                   "charSpecs": {k: v[:2] for k, v in self._data["charSpecs"].items()},
                   "appearance": dict(self._appearance()),
                   "absences": self._absences(), "absT": self._data.get("absT", 0),
                   "phases": self._lua_phases(), "presets": self._data.get("presets") or {},
                   "assigns": self._assigns(),
                   # nom de la guilde, lecture seule (membre sans droits d'officier), persos cachés (jamais envoyés)
                   "guildTitle": self._title(), "readOnly": not self.can_edit(),
                   # commande de l'addon choisie par un admin ; tags Discord trouvés par l'exe (liaison auto) ;
                   # persos des officiers (droits temporaires compris) : seuls à pouvoir modifier en jeu
                   "slash": self._slash(), "charTags": self._auto_tags(), "officers": self._officer_chars(),
                   # calendrier : notes de la guilde, salon Main Raid (ses events en premier), icônes des réactions
                   "notes": {d: n.get("text") for d, n in (self._data.get("notes") or {}).items() if n.get("text")},
                   "mainChannel": self._rh_settings().get("rhMainChannel") or "",
                   "mainArchive": self._rh_settings().get("rhMainArchive") or "",
                   "commuArchive": self._rh_settings().get("rhCommuArchive") or "",
                   # compte Discord connecté : l'addon montre ton inscription sur chaque event
                   "myDiscord": (self._cloud.session.get("user") or {}).get("id") if self._cloud.logged else None,
                   "statusIcons": {k: True for k in ("sign", "late", "tentative", "absence") if os.path.exists(self._status_icon_path(k))},
                   # phase de la guilde (choisie par un admin, imposée à tous) ; persos des admins ; ce compte est-il admin
                   "admins": self._officer_chars(admins=True), "isAdmin": self.is_admin(),
                   # membres Discord de la guilde (droits d'officier temporaires modifiables en jeu par un officier)
                   # et demandes faites en jeu déjà envoyées (retirées de la file du jeu)
                   "guildMembers": self._game_members(), "grantDone": {k: True for k in self._data.get("grantDone") or {}},
                   **({"phase": int(self._guild_phase()) + 1, "phaseT": int((self._data.get("guildSettings") or {}).get("phaseT") or 0)}
                      if self._guild_phase() is not None else {}),
                   "hidden": {n: True for n in self._config.get("hiddenChars") or []},
                   # loot (/tlc) : nombre d'attributions par objet dans la base de la guilde
                   "lootCounts": self._loot_counts(), "lootT": remote.now(),
                   # onglet Loots du jeu : attributions de la base (sans infobulles)
                   "lootDB": self._loot_list(), "bossLoot": self._boss_loot_view(), "wishlists": self._wishlists_view(),
                   "bossLootEd": self._data.get("bossLootEd") or {},
                   # date de mes wishlists (le jeu garde ses propres modifications si elles sont plus récentes)
                   "wishlistT": {n: int(w.get("t") or 0) for n, w in self._wishlist().items()},
                   # vues de Loots cachées aux membres, archives de wishlist retirées par un officier
                   "guildFlags": self._guild_flags(), "wishArchHide": self._wish_arch_hide(),
                   # Bislist : EP des objets de raid pour chaque spé, meilleur set qui les contient (infobulle)
                   "bisTip": self._bis_tip(),
                   # poids EP de chaque spé (Bislist) : différence d'EP des réactions de /tlc
                   "bisEP": {k: d["ep"] for k, d in (self._data.get("bis") or {}).items() if isinstance(d, dict) and d.get("ep")},
                   # images de fond des persos (détail de Members) : textures media/chars
                   "charImages": self._char_images(game=True),
                   # spé principale de chaque perso (inscription à l'Event Class Raid-Helper, sinon talents)
                   "mainSpecs": self._main_specs(),
                   # réglages par défaut publiés par la guilde (bouton « Default settings » de /two et /tlc)
                   "guildAppearance": {k: v for k, v in (self._data.get("guildAppearance") or {}).items() if k not in ("t", "bg")} or None,
                   "guildLootAp": {k: v for k, v in (self._data.get("guildLootAp") or {}).items() if k != "t"} or None}
        text = ("-- Generated by Guild Tool on %s. Do not edit.\nGuildToolImport = %s\n"
                % (time.strftime("%Y-%m-%d %H:%M:%S"), luaio.to_lua(payload)))
        path = self._import_path()
        if not os.path.isdir(os.path.dirname(path)):
            raise RuntimeError("Addon folder not found: %s" % os.path.dirname(path))
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(text)
        os.replace(tmp, path)

    # ------------------------------------------------------------ API JavaScript
    def get_state(self):
        with self._lock:
            self._read_sv()
            ui = self._sv.get("ui") or {}
            return {
                "config": self._config,
                "accounts": self._accounts(),
                "events": self._data["events"],
                "weeks": self._data["weeks"],
                "chars": self._all_chars(),
                "myChars": self._my_chars(),
                "hideByDefault": bool(self._config.get("hideByDefault")),
                "canEdit": self.can_edit(), "canAdmin": self.can_admin(),
                "title": self._title(),
                "slash": self._slash(),
                "guildPhase": self._guild_phase(), "isAdmin": self.is_admin(),
                "notes": self._data.get("notes") or {}, "rhSettings": self._rh_settings(), "statusIcons": self._status_icon_urls(),
                "ccomps": self._data.get("ccomps") or {}, "charGone": self._char_gone(), "charTrash": self._char_trash(),
                "guildAbs": self._data.get("guildAbs") or {}, "charOwners": self._char_owners(),
                "mainSpecs": self._main_specs(), "online": self._online(), "lootDB": self._loot_list(),
                "bossLoot": self._boss_loot_view(), "bossLootEd": self._data.get("bossLootEd") or {},
                "wishlists": self._wishlists_view(), "charImages": self._char_images(),
                "guildFlags": self._guild_flags(), "wishArchHide": self._wish_arch_hide(), "bis": self._data.get("bis") or {},
                # utilisateurs de Guild Tool de la guilde (Bislist : « Allow Edit », choisis par les officiers)
                "guildUsers": sorted(({"id": str(m.get("discord_id")), "n": m.get("nick") or m.get("name") or m.get("username") or "?",
                                       "u": m.get("username") or "", "r": [r.get("id") for r in m.get("roles") or [] if isinstance(r, dict)],
                                       "rd": [r for r in m.get("roles") or [] if isinstance(r, dict) and r.get("name")]}
                                      for m in self._data.get("cloudMembers") or [] if m.get("discord_id")), key=lambda u: u["n"].lower()),
                "rhSpecs": remote.rh_specs_by_class(), "rhChannels": self._rh_channels(),
                "lastChange": self._data.get("lastChange") or 0,
                "svItems": self._sv.get("items") or {},
                "items": self._data["items"],
                "spells": self._data.get("spells") or {},
                "loot": self._rclc if self._read_rclc() else None,
                "charSpecs": self._data["charSpecs"],
                "svUi": {k: ui.get(k) for k in ("phase",)},
                "roster": self.roster(),
                "svSpecs": self._sv.get("specs") or {},
                "specs": self._data["specs"],
                "derivedSpecs": getattr(self, "_derived_specs", {}),
                "lastSync": self._data["lastSync"],
                "lastError": self._data["lastError"],
                "sv": {"folders": self._account_folders(), "ok": bool(self._sv),
                       "error": self._sv_error, "guild": self._sv.get("guild"), "rosterT": self._sv.get("rosterT")},
                "wowAccounts": self._wow_accounts(),
                "order": ui.get("order") or ["spec", "class", "player", "alpha"],
                "specIcons": self._spec_icon_urls(),
                "appearance": self._appearance(),
                "absences": self._absences(),
                "bgUrl": self._bg_url(),
                "winRatio": WIN_W / WIN_H,
                "minLevel": self.min_level(),
                "resetAnchor": FALLBACK_ANCHOR,
                "links": self._links(),
                "phases": self._phases(),
                "raidImages": self._raid_image_urls(),
                "raidRatio": RAID_RATIO, "mapRatio": MAP_RATIO,
                "presets": self._data.get("presets") or {},
                "assigns": self._assigns(),
                "cloud": self._cloud.public_state(),
                # Preference Score : jamais les notes des autres, seulement (officiers) les sommes par paire
                "socialPairs": self._social_pairs if self._cloud.officer else {},
                # membres du serveur Discord (bot) : Members (sans perso, colonne Role), Settings > Social
                "discordMembers": self._data.get("discordMembers") or {},
                "version": APP_VERSION,
            }

    def _title(self):
        g = self._cloud.session.get("guild") if self._cloud.logged else None
        return (g or {}).get("title") or (g or {}).get("name") or "Guild Tool"

    def _all_chars(self):
        """Infos des persos (équipement, sets, talents, métiers) : celles reçues en jeu, complétées par celles partagées
        sur le serveur de guilde (la plus récente gagne)."""
        out = dict(self._sv.get("chars") or {}) if isinstance(self._sv.get("chars"), dict) else {}
        for n, c in (self._data.get("cloudChars") or {}).items():
            d = c.get("data") or {}
            cur = out.get(n) or {}
            if int(d.get("gearT") or 0) >= int(cur.get("gearT") or 0):
                out[n] = {**cur, **d}
        # anciennes versions de l'addon : perso rangé sous son prénom seul (« Sundance » pour « Sundance Pal » du roster)
        roster = set(self._sv.get("roster") or {})
        mine = self._sv.get("myChars") if isinstance(self._sv.get("myChars"), dict) else {}
        roster |= set(mine) | {k for k in out if " " in k}
        for n in [k for k in out if k not in roster and " " not in k]:
            full = [r for r in roster if r.split(" ")[0] == n]
            if len(full) == 1:
                # les deux existent : une seule fiche (l'ancienne complète seulement ce qui manque)
                old = out.pop(n)
                out[full[0]] = {**old, **(out.get(full[0]) or {})}
        return out

    def poll(self):
        """Appelé toutes les quelques secondes : True si le jeu a réécrit les SavedVariables."""
        with self._lock:
            changed = self._read_sv()
        if changed and self._sv_queue and self._cloud.logged and self._cloud.guild_id:
            threading.Thread(target=self._process_queue, daemon=True).start()
        if changed and self._sv_grants and self._cloud.logged and self._cloud.guild_id:
            threading.Thread(target=self._grants_locked, daemon=True).start()
        return changed

    def sync(self):
        """Bouton Sync : events Raid-Helper (clé gardée par le serveur de la guilde, sinon clé locale), puis échange
        incrémental avec la guilde (données, persos partagés, images) et vérification de mise à jour de l'exe.
        « Last Sync » = dernière synchro qui a vraiment changé quelque chose."""
        with self._lock:
            cfg, cl = self._config, self._cloud
            in_guild = cl.logged and cl.guild_id
            result = {"ok": True, "count": None, "cloud": None}
            try:
                if in_guild:
                    cl.rejoin()                              # rôles et droits d'officier à jour
                # events déjà reçus : {id: lastUpdated} -> seuls les events changés sont relus (quota Raid-Helper)
                known = {e["id"]: e.get("lu") or "" for e in self._data["events"]}
                lst = None
                if in_guild and (cl.session.get("guild") or {}).get("raidHelper"):
                    r = cl.api("rhevents", guildId=cl.guild_id, known=known, timeout=150)
                    raws, lst, result["pending"] = r["events"], r.get("list"), len(r.get("pending") or [])
                elif cfg["apiKey"] and (cfg["serverId"] or in_guild):
                    server = cl.guild_id if in_guild else cfg["serverId"]
                    raws, lst, result["pending"] = self._rh_events_local(cfg["apiKey"], server, known)
                else:
                    raws = None
                changed = False
                if raws is not None:
                    fresh = {}
                    for raw in raws:
                        self._data["specEmotes"].update(remote.spec_emotes(raw))
                        self._data.setdefault("statusEmotes", {}).update(remote.status_emotes(raw))
                        fresh[str(raw.get("id"))] = remote.normalize_event(raw)
                    if lst is None:                      # serveur pas encore à jour : liste complète, comme avant
                        events = list(fresh.values())
                    else:
                        events = self._merge_events(lst, fresh)
                    changed = _signature(events) != _signature(self._data["events"])
                    self._data["events"] = events
                    self._update_spec_icons()
                    self._update_status_icons()
                    self._lookup_usernames()
                    result["count"] = len(events)
                if in_guild:
                    result["cloud"] = self._cloud_sync()
                    changed = changed or any(result["cloud"].values())
                    self._sync_channel_names()
                if raws is None and not in_guild:
                    return {"ok": False, "error": "Log in and choose your guild server, or set the Raid-Helper API key in Settings > Admin."}
                self._data["lastError"] = ""
                self._data["lastSync"] = remote.now()
                if changed or not self._data.get("lastChange"):
                    self._data["lastChange"] = remote.now()
                self._resolve_all()
                _save(DATA_PATH, self._data)
                self._write_import()
            except Exception as e:
                traceback.print_exc()
                self._data["lastError"] = str(e)
                _save(DATA_PATH, self._data)
                return {"ok": False, "error": str(e)}
            latest = cl.latest_version()
            if latest and _version_tuple(latest.get("version")) > _version_tuple(APP_VERSION):
                result["update"] = {"version": latest["version"], "url": latest["_url"]}
            return result

    ARCHIVE_AGE = 7 * 86400

    def _rh_events_local(self, api_key, server, known):
        """Clé Raid-Helper locale : mêmes règles que la route serveur « rhevents » -> (events relus, liste, en attente)."""
        posted = sorted(remote.rh_events(api_key, server), key=lambda p: -int(p.get("startTime") or 0))
        rs = self._rh_settings()
        refs = {str(rs.get("rhClassEvent") or ""), str(rs.get("rhCopyFrom") or "")}
        old = remote.now() - self.ARCHIVE_AGE
        need = []
        for p in posted:
            pid = str(p.get("id"))
            if pid not in known:
                need.append(pid)
            elif int(p.get("startTime") or 0) < old and pid not in refs:
                continue                                   # archive déjà reçue : plus relue
            elif str(known[pid] or "") != str(p.get("lastUpdated") or ""):
                need.append(pid)
        raws, pending = remote.rh_events_paced(api_key, need)
        lst = [{"id": str(p.get("id")), "lu": p.get("lastUpdated"), "start": int(p.get("startTime") or 0)} for p in posted]
        return raws, lst, len(pending)

    def _merge_events(self, lst, fresh):
        """Liste Raid-Helper + events relus -> events de l'appli. Pas relu : version en cache (archives jamais
        actualisées). Plus dans la liste : retiré s'il est récent (supprimé), gardé s'il a plus de 7 jours (archive)."""
        cache = {e["id"]: e for e in self._data["events"]}
        listed, events = set(), []
        for p in lst:
            pid = str(p["id"])
            listed.add(pid)
            if pid in fresh:
                events.append({**fresh[pid], "lu": p.get("lu")})
            elif pid in cache:
                events.append(cache[pid])
        old = remote.now() - self.ARCHIVE_AGE
        events += [e for pid, e in cache.items() if pid not in listed and int(e.get("start") or 0) < old]
        events.sort(key=lambda e: int(e.get("start") or 0))
        return events

    # ------------------------------------------------------------ compte Discord et guilde (Supabase)
    def _cloud_call(self, fn, *args):
        try:
            with self._lock:
                out = fn(*args)
            return {"ok": True, "cloud": self._cloud.public_state(), **(out if isinstance(out, dict) and "guild" not in out else {})}
        except Exception as e:
            traceback.print_exc()
            return {"ok": False, "error": str(e)}

    def cloud_login(self):
        try:
            # connexion seule (serveur par défaut choisi d'office) : la réponse revient tout de suite, la première
            # synchro (longue : images, données de la guilde) est lancée ensuite par l'interface avec son indicateur
            self._cloud.login()
            return {"ok": True, "cloud": self._cloud.public_state()}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def cloud_logout(self):
        self._social_pairs = {}
        self._cloud.logout()
        self._safe_write()
        return self._cloud.public_state()

    def cloud_refresh_guilds(self):
        return self._cloud_call(self._cloud.refresh_guilds)

    def cloud_guild(self, guild_id):
        """Choix du serveur de guilde (rôles, droits), puis première synchro (tout ce qui manque est téléchargé)."""
        def go():
            self._social_pairs = {}
            self._data.pop("discordMembers", None)
            self._cloud.select_guild(guild_id)
            self._cloud_sync()
            self._data["lastChange"] = remote.now()
            self._resolve_all()
            _save(DATA_PATH, self._data)
            self._safe_write()
        return self._cloud_call(go)

    def cloud_rh_key(self, key):
        if not self.can_admin():
            return {"ok": False, "error": "Officers only."}
        return self._cloud_call(lambda: self._cloud.guild_update(self._cloud.api("rhkey", guildId=self._cloud.guild_id, apiKey=key.strip())))

    def cloud_title(self, title):
        if not self.can_admin():
            return {"ok": False, "error": "Officers only."}

        def go():
            self._cloud.guild_update(self._cloud.api("settings", guildId=self._cloud.guild_id, title=title.strip()))
            self._safe_write()
        return self._cloud_call(go)

    def cloud_officer_role(self, role_id):
        def go():
            self._cloud.guild_update(self._cloud.api("settings", guildId=self._cloud.guild_id, officerRole=role_id or ""))
            self._cloud.rejoin()
        return self._cloud_call(go)

    # ------------------------------------------------------------ Preference Score (Settings > Social)
    def _fetch_social_pairs(self):
        """Officiers : {"idA|idB": somme des poids des deux notes} (jamais qui a noté quoi) ; serveur sans la route : vide."""
        if not (self._cloud.officer and self._cloud.guild_id):
            return {}
        try:
            return self._cloud.api("social", guildId=self._cloud.guild_id, op="pairs").get("pairs") or {}
        except Exception as e:
            print("social pairs: %s" % e)
            return self._social_pairs

    def _fetch_discord_members(self, force=False):
        """Membres du serveur Discord (bot), leurs rôles et le propriétaire : gardés dans les données (relus au Sync au plus
        toutes les DISCORD_MEMBERS_TTL secondes) ; échec : liste précédente gardée, erreur notée."""
        gid = self._cloud.guild_id
        cur = self._data.get("discordMembers") or {}
        if not gid or (not force and cur.get("guild") == gid and time.time() - (cur.get("t") or 0) < DISCORD_MEMBERS_TTL):
            return cur
        try:
            r = self._cloud.api("social", guildId=gid, op="players", timeout=90)
        except Exception as e:
            r = {"players": None, "error": str(e)}
        same = cur.get("guild") == gid
        self._data["discordMembers"] = {
            "guild": gid, "t": int(time.time()), "error": r.get("error"),
            "players": r.get("players") if r.get("players") is not None else (cur.get("players") if same else None),
            "roles": r.get("roles") or (cur.get("roles") if same else []) or [],
            "ownerId": r.get("ownerId") or (cur.get("ownerId") if same else None),
        }
        _save(DATA_PATH, self._data)
        return self._data["discordMembers"]

    def discord_members_refresh(self):
        """Relit tout de suite les membres du serveur Discord (bouton ↻ de Settings > Social)."""
        return self._cloud_call(lambda: {"discordMembers": self._fetch_discord_members(force=True)})

    def social_get(self):
        """Mes notes (personnelles, gardées sur le serveur)."""
        def go():
            gid = self._cloud.guild_id
            if not gid:
                raise Exception("Choose your guild server first.")
            return {"scores": self._cloud.api("social", guildId=gid, op="get").get("scores") or {}}
        return self._cloud_call(go)

    def social_set(self, target, score):
        """Note 1..5 donnée à un joueur (0 = retirée, compte comme 3) ; officier : sommes par paire relues."""
        def go():
            r = self._cloud.api("social", guildId=self._cloud.guild_id, op="set", target=str(target), score=int(score or 0))
            self._social_pairs = self._fetch_social_pairs()
            return {"scores": r.get("scores") or {}, "pairs": self._social_pairs if self._cloud.officer else {}}
        return self._cloud_call(go)

    def cloud_roles(self):
        return self._cloud_call(lambda: self._cloud.api("roles", guildId=self._cloud.guild_id))

    def cloud_members(self):
        return self._cloud_call(lambda: {"members": self._cloud.members()})

    def cloud_grant(self, discord_id, on):
        """Droits d'officier temporaires (appli) : demande datée, le serveur garde la plus récente."""
        if not self.can_admin():
            return {"ok": False, "error": "Officers only."}

        def go():
            self._cloud.api("grant", guildId=self._cloud.guild_id, discordId=str(discord_id), on=bool(on),
                            t=int(time.time() * 1000))
            self._data["cloudMembers"] = members = self._cloud.members()
            _save(DATA_PATH, self._data)
            self._safe_write()
            return {"members": members}
        return self._cloud_call(go)

    def _grants_locked(self):
        try:
            with self._lock:
                self._process_grants()
        except Exception:
            traceback.print_exc()

    def _process_grants(self):
        """Droits d'officier temporaires donnés / retirés en jeu (GuildToolDB.grantQueue) : chaque demande envoyée
        une seule fois, avec sa date ; le serveur ignore celles plus anciennes que le dernier changement (appli ou
        autre officier entre-temps). Liste des membres relue ensuite, exportée au jeu au prochain /reload."""
        cl = self._cloud
        if not (cl.logged and cl.guild_id and cl.full_officer) or not self._sv_grants:
            return
        done = self._data.setdefault("grantDone", {})
        sent = False
        for q in sorted(self._sv_grants, key=lambda q: int(q.get("t") or 0)):
            key = "%s:%d:%d" % (q.get("id"), 1 if q.get("on") else 0, int(q.get("t") or 0))
            if key in done or not str(q.get("id") or "").isdigit():
                continue
            try:
                cl.api("grant", guildId=cl.guild_id, discordId=str(q["id"]), on=bool(q.get("on")), t=int(q.get("t") or 0) * 1000)
            except Exception as e:
                self._data["lastError"] = "In-game officer rights: %s" % e
                continue
            done[key] = remote.now()
            sent = True
        cutoff = remote.now() - 30 * 86400
        for k in [k for k, t in done.items() if t < cutoff]:
            done.pop(k, None)
        if sent:
            self._data["cloudMembers"] = cl.members()
            _save(DATA_PATH, self._data)
            self._safe_write()

    def open_url(self, url):
        import webbrowser
        if str(url).startswith("https://"):
            webbrowser.open(url)
        return True

    def _slash(self):
        return (self._data.get("guildSettings") or {}).get("slash") or DEFAULT_SLASH

    def set_slash(self, cmd):
        """(admin) Commande de l'addon pour toute la guilde, envoyée au prochain Sync."""
        cmd = "/" + (cmd or "").strip().lstrip("/").lower()
        if not re.match(r"^/[a-z][a-z0-9]{1,15}$", cmd):
            return {"ok": False, "error": "2 to 16 letters or digits, starting with a letter."}
        if cmd in RESERVED_SLASH:
            return {"ok": False, "error": "%s is already a game command." % cmd}
        with self._lock:
            self._data["guildSettings"] = {**(self._data.get("guildSettings") or {}), "slash": cmd, "t": remote.now()}
            _save(DATA_PATH, self._data)
            self._safe_write()
        return {"ok": True, "slash": cmd}

    def _game_members(self):
        """Membres de la guilde pour le jeu : id Discord, nom, admin / officier par rôle (o), droits temporaires
        (g, date gt) et persos partagés ; vide pour un membre sans droits ou un officier temporaire (réglages de la
        guilde : il ne peut rien y changer)."""
        if not (self._cloud.logged and self._cloud.full_officer):
            return []
        chars = {}
        for n, c in (self._data.get("cloudChars") or {}).items():
            chars.setdefault(c.get("discord_id"), []).append(n)
        out = []
        for m in self._data.get("cloudMembers") or []:
            out.append({k: v for k, v in (("id", m.get("discord_id")), ("n", m.get("nick") or m.get("name") or m.get("username")),
                                          ("a", m.get("admin") or None),
                                          ("o", (m.get("officer") and not m.get("granted")) or None),
                                          ("g", m.get("granted") or None), ("gt", m.get("grantT") or None),
                                          ("chars", sorted(chars.get(m.get("discord_id")) or []) or None)) if v})
        return sorted(out, key=lambda m: (m.get("n") or "").lower())

    def _officer_chars(self, admins=False):
        """Persos (partagés sur le serveur) des membres admin, officiers ou avec droits temporaires (admins : admins seuls)."""
        boss = {m["discord_id"] for m in self._data.get("cloudMembers") or []
                if m.get("admin") or (not admins and (m.get("officer") or m.get("granted")))}
        out = {n: True for n, c in (self._data.get("cloudChars") or {}).items() if c.get("discord_id") in boss}
        if self._cloud.logged and (self.is_admin() if admins else self._cloud.officer):
            for c in self._my_chars():
                out[c["name"]] = True
        return out

    def is_admin(self):
        """Admin du serveur Discord de la guilde (ou hors ligne / sans guilde : tout est local)."""
        cl = self._cloud
        if not (cl.logged and cl.guild_id):
            return True
        return bool((cl.session.get("member") or {}).get("admin"))

    def _guild_phase(self):
        return (self._data.get("guildSettings") or {}).get("phase")

    def set_phase(self, index):
        """(admin) Phase de la guilde (index 0…), imposée à tous au prochain Sync."""
        if not self.is_admin():
            return {"ok": False, "error": "Only the admins can change the phase."}
        with self._lock:
            gs = dict(self._data.get("guildSettings") or {})
            gs.update({"phase": int(index), "phaseT": remote.now(), "t": remote.now()})
            self._data["guildSettings"] = gs
            _save(DATA_PATH, self._data)
            self._safe_write()
        return {"ok": True}

    def _adopt_game_phase(self):
        """Phase changée en jeu par un admin (GuildToolDB.guildPhase / guildPhaseT) : reprise si plus récente."""
        gp, gt = self._sv.get("guildPhase"), int(self._sv.get("guildPhaseT") or 0)
        gs = self._data.get("guildSettings") or {}
        if isinstance(gp, (int, float)) and gt > int(gs.get("phaseT") or 0) and self.is_admin():
            self._data["guildSettings"] = {**gs, "phase": int(gp) - 1, "phaseT": gt, "t": max(gt, int(gs.get("t") or 0))}
            return True
        return False

    # ------------------------------------------------------------ calendrier : notes, events Raid-Helper, inscriptions
    RH_FIELDS = ("rhMainChannel", "rhCommuChannel", "rhTemplate", "rhCopyFrom", "rhClassEvent", "rhOfficerChannel",
                 "rhMainArchive", "rhCommuArchive")
    RH_DEFAULTS = {"rhTemplate": "wowforever", "rhMainChannel": "1481727247223226449", "rhCommuChannel": "1558492094581051514",
                   "rhMainArchive": "1559968092774342706", "rhCommuArchive": "1559968122457563166",
                   "rhCopyFrom": "1481759652965257367", "rhClassEvent": "1481777223366086809",
                   "rhOfficerChannel": "1481015325855187035"}

    def _rh_settings(self):
        gs = self._data.get("guildSettings") or {}
        return {k: gs.get(k) or self.RH_DEFAULTS.get(k) or "" for k in self.RH_FIELDS}

    def set_rh_settings(self, values):
        """(admin) Salons, template, mentions et events de référence pour créer / rejoindre les events."""
        if not self.is_admin():
            return {"ok": False, "error": "Admins only."}
        with self._lock:
            gs = dict(self._data.get("guildSettings") or {})
            for k in self.RH_FIELDS:
                if k in (values or {}):
                    gs[k] = str(values[k] or "").strip()
            gs["t"] = remote.now()
            self._data["guildSettings"] = gs
            _save(DATA_PATH, self._data)
            cl = self._cloud
            try:
                if cl.logged and cl.guild_id and cl.officer:   # tout de suite sur le serveur (la fonction les lit)
                    cl.push_docs({"settings": (gs["t"], {k: v for k, v in gs.items() if k != "t"})})
            except Exception as e:
                return {"ok": False, "error": str(e)}
        return {"ok": True}

    def set_note(self, day, text):
        """Note d'un jour (AAAAMMJJ), partagée avec la guilde ; tout le monde peut l'écrire."""
        day, text = str(day), str(text or "").strip()[:500]
        cl = self._cloud
        with self._lock:
            self._data.setdefault("notes", {})[day] = {"text": text, "t": remote.now()}
            _save(DATA_PATH, self._data)
        try:
            if cl.logged and cl.guild_id:
                cl.api("note", guildId=cl.guild_id, day=day, text=text)
        except Exception as e:
            return {"ok": False, "error": str(e)}
        with self._lock:
            self._safe_write()
        return {"ok": True}

    def _rh_channels(self):
        """Salons connus : {id: nom} (salons du serveur lus par le bot, events lus, salons par défaut)."""
        out = {"1481727247223226449": "⚔️┃main-raid", "1558492094581051514": "⚔️┃raid-commu"}
        out.update(self._data.get("channelNames") or {})
        for ev in self._data.get("events") or []:
            if ev.get("chId"):
                out[ev["chId"]] = ev.get("channel") or ev["chId"]
        return out

    def _sync_channel_names(self):
        """Noms des salons du serveur Discord (réglages Admin : nom affiché à la place de l'id) ; sans bot : ignoré."""
        try:
            r = self._cloud.api("channels", guildId=self._cloud.guild_id)
            if isinstance(r, dict) and isinstance(r.get("channels"), dict) and r["channels"]:
                self._data["channelNames"] = r["channels"]
                return
        except Exception:
            traceback.print_exc()
        # repli : token de bot de cet exe (Settings > Admin), lecture directe des salons du serveur
        token = (self._config.get("botToken") or "").strip()
        if token:
            try:
                chans = remote._request("%s/guilds/%s/channels" % (remote.DISCORD_API, self._cloud.guild_id),
                                        {"Authorization": "Bot " + token}) or []
                names = {str(c["id"]): c.get("name") or str(c["id"]) for c in chans if c.get("type") in (0, 5, 15)}
                if names:
                    self._data["channelNames"] = names
            except Exception:
                traceback.print_exc()

    def _rh_call(self, route, **body):
        cl = self._cloud
        if not (cl.logged and cl.guild_id):
            return {"ok": False, "error": "Log in and choose your guild server first."}
        try:
            r = cl.api(route, timeout=120, guildId=cl.guild_id, **body)
            return {"ok": True, **(r if isinstance(r, dict) else {})}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    LABEL_RE = re.compile(r"^\s*\[(Main|Commu)\]\s*", re.I)

    def _labeled(self, label, desc):
        """Description avec « [Main] » / « [Commu] » en tête (l'ancienne étiquette remplacée)."""
        return ("[%s] %s" % (label, self.LABEL_RE.sub("", desc or ""))).strip()[:1500]

    def _chan_label(self, channel):
        """Étiquette d'un salon : Main (salon Main raid ou son archive), Commu (raid commu ou son archive), sinon None."""
        s, c = self._rh_settings(), str(channel or "")
        if c and c in (str(s.get("rhMainChannel")), str(s.get("rhMainArchive"))):
            return "Main"
        if c and c in (str(s.get("rhCommuChannel")), str(s.get("rhCommuArchive"))):
            return "Commu"
        return None

    def rh_create(self, kind, start, title="", description="", channel="", mentions="", copy=False):
        """Event Raid-Helper créé par le serveur de la guilde (Main Raid : officiers ; communautaire : tous).
        La description part avec son étiquette « [Main] » / « [Commu] » en tête."""
        description = self._labeled("Main" if kind == "main" else "Commu", description)
        return self._rh_call("rhcreate", kind=kind, start=int(start), title=title or "", description=description or "",
                             channel=str(channel or ""), mentions=mentions or "", copy=bool(copy))

    def rh_edit(self, event_id, start, title="", description="", channel="", mentions="", date_str="", time_str=""):
        """(officier) Modifie un event Raid-Helper ; date « JJ-MM-AAAA » et heure « HH:MM » (format du serveur).
        Event d'un salon Main / Commu : son étiquette reste en tête de la description."""
        label = self._chan_label(channel)
        if label:
            description = self._labeled(label, description)
        return self._rh_call("rhedit", eventId=str(event_id), start=int(start), title=title or "",
                             description=description or "", channel=str(channel or ""), mentions=mentions or "",
                             dateStr=date_str or "", timeStr=time_str or "")

    def rh_delete(self, event_id):
        """(officier) Supprime un event Raid-Helper."""
        return self._rh_call("rhdelete", eventId=str(event_id))

    def rh_sign(self, event_id, kind, class_name="", spec_name="", name="", note="", notify=False):
        """S'inscrire soi-même : sign (perso / spé choisis, sinon ses classes de l'Event Class), late, tentative, absence.
        notify : joueur pris dans la compo -> le bot prévient les officiers (salon officier des réglages Admin)."""
        ev = next((e for e in self._data.get("events") or [] if e.get("id") == str(event_id)), {})
        return self._rh_call("rhsign", eventId=str(event_id), kind=kind, className=class_name or "",
                             specName=spec_name or "", name=name or "", note=note or "",
                             **({"notify": True, "evTitle": ev.get("title") or "", "evStart": ev.get("start") or 0} if notify else {}))

    # ------------------------------------------------------------ compos des events communautaires
    def save_ccomp(self, comp):
        """Compo d'un event communautaire (créateur de l'event ou officier) : gardée ici tout de suite, envoyée au
        serveur 1 s après la dernière modification (doc « ccomp_<id> », écrit par la fonction serveur)."""
        if not isinstance(comp, dict) or not comp.get("id"):
            return {"ok": False, "error": "Bad comp."}
        cid = str(comp["id"])
        with self._lock:
            store = self._data.setdefault("ccomps", {})
            store[cid] = {**comp, "commu": True, "t": remote.now()}
            _save(DATA_PATH, self._data)
        timers = self.__dict__.setdefault("_cc_timers", {})
        if timers.get(cid):
            timers[cid].cancel()
        timers[cid] = threading.Timer(1.0, self._push_ccomp, (cid,))
        timers[cid].daemon = True
        timers[cid].start()
        return {"ok": True}

    def _push_ccomp(self, cid):
        cl = self._cloud
        with self._lock:
            comp = dict((self._data.get("ccomps") or {}).get(cid) or {})
        if not comp or not (cl.logged and cl.guild_id):
            return
        try:
            r = cl.api("ccomp", guildId=cl.guild_id, comp={k: comp.get(k) for k in ("id", "event", "raid", "valid", "c", "sp", "ph")},
                       **({"del": True} if comp.get("deleted") else {}))
            with self._lock:
                cur = (self._data.get("ccomps") or {}).get(cid)
                if cur is not None:
                    cur["owner"], cur["t"] = r.get("owner") or cur.get("owner"), int(r.get("t") or cur.get("t") or 0)
                    _save(DATA_PATH, self._data)
        except Exception as e:
            with self._lock:
                self._data["lastError"] = "Community comp: %s" % e

    # ------------------------------------------------------------ persos retirés de la base partagée
    TRASH_DAYS = 7

    def delete_char(self, name, cls=None):
        """(officier) Retire un perso de la base partagée : il disparaît chez tout le monde (son joueur le voit caché).
        Il passe TRASH_DAYS jours dans la corbeille (doc « chartrash »), d'où un officier peut le remettre."""
        r = self._rh_call("delchar", names=[str(name)])
        if r.get("ok"):
            t = int(r.get("t") or remote.now())
            with self._lock:
                for n in r.get("deleted") or []:
                    self._data.setdefault("charDel", {})[n] = t
                    (self._data.get("cloudChars") or {}).pop(n, None)
            try:
                self._edit_trash(lambda trash: trash.update({n: {"t": t, "by": self._my_display(), "c": cls}
                                                             for n in r.get("deleted") or []}))
            except Exception as e:      # le perso est retiré ; seule la corbeille n'a pas suivi
                with self._lock:
                    self._data["lastError"] = "Trash: %s" % e
            with self._lock:
                _save(DATA_PATH, self._data)
        return r

    def restore_char(self, name):
        """(officier) Sort un perso de la corbeille : retiré de la liste « chardel », il réapparaît chez tout le monde
        (si son joueur l'avait vu caché par ce retrait, son appli le repartage)."""
        cl = self._cloud
        if not (cl.logged and cl.guild_id and cl.officer):
            return {"ok": False, "error": "Officers only."}
        name = str(name)
        try:
            t, dels = cl.get_doc("chardel")
            dels = {n: v for n, v in (dels or {}).items() if n != name}
            t = max(remote.now(), t + 1)
            cl.push_docs({"chardel": (t, dels)})
            self._edit_trash(lambda trash: trash.pop(name, None))
        except Exception as e:
            return {"ok": False, "error": str(e)}
        with self._lock:
            self._data["charDel"] = {n: int(v or 0) for n, v in dels.items()}
            _save(DATA_PATH, self._data)
        return {"ok": True}

    def _edit_trash(self, fn):
        """Corbeille relue sur le serveur, changée par fn, purgée de ce qui a plus de TRASH_DAYS jours, renvoyée."""
        cl = self._cloud
        t, trash = cl.get_doc("chartrash")
        trash = dict(trash or {})
        fn(trash)
        limit = remote.now() - self.TRASH_DAYS * 86400
        trash = {n: e for n, e in trash.items() if isinstance(e, dict) and int(e.get("t") or 0) > limit}
        cl.push_docs({"chartrash": (max(remote.now(), t + 1), trash)})
        with self._lock:
            self._data["charTrash"] = trash

    def _char_trash(self):
        """(officiers) Persos de la corbeille encore retirés de moins de TRASH_DAYS jours : {nom: {t, by, c, left}}."""
        if not self._cloud.officer:
            return {}
        now, dels = remote.now(), self._data.get("charDel") or {}
        out = {}
        for n, e in (self._data.get("charTrash") or {}).items():
            left = int((e or {}).get("t") or 0) + self.TRASH_DAYS * 86400 - now
            if n in dels and left > 0:
                out[n] = {**e, "left": left}
        return out

    def _my_display(self):
        u = self._cloud.session.get("user") or {}
        m = self._cloud.session.get("member") or {}
        return m.get("nick") or u.get("globalName") or u.get("username") or ""

    # arbres de talents dans l'ordre du jeu -> spé
    TALENT_SPECS = {"WARRIOR": ["Arms", "Fury", "Protection"], "PALADIN": ["Holy", "Protection", "Retribution"],
                    "DRUID": ["Balance", "Feral", "Restoration"], "PRIEST": ["Discipline", "Holy", "Shadow"],
                    "SHAMAN": ["Elemental", "Enhancement", "Restoration"], "ROGUE": ["Assassination", "Combat", "Subtlety"],
                    "HUNTER": ["Beastmastery", "Marksmanship", "Survival"], "MAGE": ["Arcane", "Fire", "Frost"],
                    "WARLOCK": ["Affliction", "Demonology", "Destruction"]}

    def _main_specs(self):
        """Spé principale de chaque perso : son inscription (même classe) à l'Event Class, sinon l'arbre qui a le plus
        de points dans sa spé de talents active."""
        roster, chars, out = self.roster(), self._all_chars(), {}
        for n, c in chars.items():
            cls = (roster.get(n) or {}).get("c") or (c or {}).get("c")
            names = self.TALENT_SPECS.get(cls)
            specs = _as_list((c or {}).get("talents"))
            if not names or not specs:
                continue
            spec = next((s for s in specs if isinstance(s, dict) and s.get("active")), specs[0])
            pts = [int((t or {}).get("p") or 0) for t in _as_list((spec or {}).get("tabs"))]
            if pts and max(pts) > 0 and pts.index(max(pts)) < len(names):
                out[n] = names[pts.index(max(pts))]
        cid = str(self._rh_settings().get("rhClassEvent") or "")
        ev = next((e for e in self._data.get("events") or [] if e.get("id") == cid), None)
        cc = self._data.get("cloudChars") or {}
        for s in (ev or {}).get("signups") or []:
            if not s.get("c") or not s.get("s") or s.get("st") == "absence":
                continue
            ch = s.get("ch") if s.get("ch") in roster else None
            if not ch and s.get("tag"):
                ch = next((n for n, r in roster.items() if isinstance(r, dict) and r.get("tag") == s["tag"] and r.get("c") == s["c"]), None)
            if not ch and s.get("uid"):
                ch = next((n for n, r in cc.items() if r.get("discord_id") == s["uid"] and (r.get("data") or {}).get("c") == s["c"]), None)
            if ch:
                out[ch] = s["s"]
        return out

    def _char_owners(self):
        """Persos partagés via l'appli : {perso: {id Discord, nom Discord, classe, niveau}} (Members les montre même
        s'ils ne sont pas encore dans le roster scanné en jeu)."""
        names = {m.get("discord_id"): m.get("nick") or m.get("name") or m.get("username") or ""
                 for m in self._data.get("cloudMembers") or []}
        out = {}
        for n, c in (self._data.get("cloudChars") or {}).items():
            d = c.get("data") or {}
            out[n] = {"id": c.get("discord_id"), "name": names.get(c.get("discord_id"), ""), "c": d.get("c"), "l": d.get("l")}
        me = (self._cloud.session.get("user") or {}) if self._cloud.logged else {}
        for c in self._my_chars():
            if not c.get("hidden"):
                out[c["name"]] = {"id": me.get("id"), "name": me.get("globalName") or me.get("username") or "",
                                  "c": c.get("class"), "l": c.get("level")}
        # anciennes versions de l'addon : perso rangé sous son prénom seul (« Buiz » pour « Buiz Zar ») -> une seule ligne
        full = set(self.roster()) | set(out)
        for n in [k for k in out if " " not in k]:
            match = [f for f in full if f != n and f.split(" ")[0] == n]
            if len(match) == 1:
                o = out.pop(n)
                out.setdefault(match[0], o)
        return out

    def _char_gone(self):
        """Persos retirés (liste « chardel ») et pas repartagés depuis ; jamais les miens (je les vois toujours)."""
        mine = {c["name"] for c in self._my_chars()}
        cc = self._data.get("cloudChars") or {}
        return {n: True for n, t in (self._data.get("charDel") or {}).items()
                if n not in mine and int(t or 0) >= int((cc.get(n) or {}).get("t") or 0)}

    def _process_queue(self):
        """Réactions faites en jeu (GuildToolDB.rhQueue) : chacune exécutée une seule fois."""
        done = self._data.setdefault("rhDone", {})
        for q in list(self._sv_queue):
            key = "%s:%s:%s" % (q.get("e"), q.get("k"), q.get("t"))
            if key in done or q.get("k") not in ("sign", "late", "tentative", "absence"):
                continue
            r = self.rh_sign(q.get("e"), q.get("k"))
            done[key] = remote.now()
            if not r.get("ok"):
                self._data["lastError"] = "In-game sign-up: %s" % r.get("error")
        cutoff = remote.now() - 30 * 86400
        for k in [k for k, t in done.items() if t < cutoff]:
            done.pop(k, None)
        with self._lock:
            _save(DATA_PATH, self._data)

    def _status_icon_path(self, name):
        return os.path.join(self._config["wowPath"], "Interface", "AddOns", "GuildTool", "media", "status_%s.tga" % name)

    def _update_status_icons(self):
        """Icônes des réactions (comme sur Discord) : emojis Late / Tentative / Absence du template + pouce levé."""
        from PIL import Image
        os.makedirs(os.path.join(APP_DIR, "emotes"), exist_ok=True)
        srcs = dict(self._data.get("statusEmotes") or {})
        srcs["sign"] = "thumbsup"
        for name, emote in srcs.items():
            png = os.path.join(APP_DIR, "emotes", "%s.png" % emote)
            try:
                if not os.path.exists(png):
                    data = remote.fetch_url(remote.THUMBSUP_URL) if emote == "thumbsup" else remote.fetch_emoji(emote)
                    with open(png, "wb") as f:
                        f.write(data)
                tga = self._status_icon_path(name)
                if os.path.isdir(os.path.dirname(tga)) and not os.path.exists(tga):
                    Image.open(png).convert("RGBA").resize((32, 32), Image.LANCZOS).save(tga)
            except Exception:
                traceback.print_exc()

    def _status_icon_urls(self):
        out = {}
        srcs = dict(self._data.get("statusEmotes") or {})
        srcs["sign"] = "thumbsup"
        for name, emote in srcs.items():
            png = os.path.join(APP_DIR, "emotes", "%s.png" % emote)
            if os.path.exists(png):
                with open(png, "rb") as f:
                    out[name] = "data:image/png;base64," + base64.b64encode(f.read()).decode()
        return out

    def can_edit(self):
        """Hors ligne ou officier : modifications permises ; membre connecté sans droits : lecture seule."""
        cl = self._cloud
        return not (cl.logged and cl.guild_id) or cl.officer

    def can_admin(self):
        """Réglages de la guilde : hors ligne, admin ou officier par le rôle (pas les officiers temporaires)."""
        cl = self._cloud
        return not (cl.logged and cl.guild_id) or cl.full_officer

    # ------------------------------------------------------------ persos : confidentialité, liaison automatique
    def _my_chars(self):
        """Persos joués sur les comptes WoW choisis (enregistrés par l'addon) ; les nouveaux sont cachés si « Hide by default »."""
        mine = self._sv.get("myChars") if isinstance(self._sv.get("myChars"), dict) else {}
        known, hidden = set(self._config.get("knownChars") or []), set(self._config.get("hiddenChars") or [])
        new = [n for n in mine if n not in known]
        if new:
            if self._config.get("hideByDefault"):
                hidden.update(new)
            self._config["knownChars"] = sorted(known | set(new))
            self._config["hiddenChars"] = sorted(hidden)
            _save(CONFIG_PATH, self._config)
        roster = self._sv.get("roster") or {}
        out = []
        for n in sorted(mine):
            info = mine[n] if isinstance(mine[n], dict) else {}
            r = roster.get(n) or {}
            out.append({"name": n, "class": info.get("c") or r.get("c"), "level": info.get("l") or r.get("l"),
                        "hidden": n in hidden})
        return out

    def set_char_hidden(self, name, hidden):
        with self._lock:
            h = set(self._config.get("hiddenChars") or [])
            if hidden:
                h.add(name)
            else:
                h.discard(name)
                # remontré : repartagé au prochain Sync (plus récent que son retrait de la base)
                gid = self._cloud.guild_id
                if gid:
                    marks = self._data.setdefault("cloudMarks", {}).setdefault(gid, {})
                    marks.setdefault("charPushT", {})[name] = int(time.time())
                    marks.setdefault("hiddenSent", {}).pop(name, None)
                    _save(DATA_PATH, self._data)
            self._config["hiddenChars"] = sorted(h)
            _save(CONFIG_PATH, self._config)
            self._safe_write()
            return self._my_chars()

    def set_hide_default(self, on):
        with self._lock:
            self._config["hideByDefault"] = bool(on)
            _save(CONFIG_PATH, self._config)
            return True

    def _auto_tags(self):
        """Liaison automatique : perso partagé par un joueur connecté -> son pseudo Discord."""
        users = {m["discord_id"]: (m.get("username") or "").lower() for m in self._data.get("cloudMembers") or []}
        return {n: users[c["discord_id"]] for n, c in (self._data.get("cloudChars") or {}).items()
                if c.get("discord_id") in users and users[c["discord_id"]]}

    # ------------------------------------------------------------ synchro de la guilde
    def _cloud_docs(self):
        """Données partagées locales : {id: (t, valeur)}."""
        docs = {}
        for key, w in self._data["weeks"].items():
            docs["week_" + key] = (int(w.get("t") or 0), w)
        for cid, a in self._assigns().items():
            docs["assign_" + cid] = (int(a.get("t") or 0), a)
        for raid, p in (self._data.get("presets") or {}).items():
            docs["preset_" + raid] = (int(p.get("t") or 0), p)
        # attributions de loot (/tlc), une par doc
        for k, r in (self._data.get("lootDB") or {}).items():
            docs["loot_" + k] = (int(r.get("at") or r.get("t") or 0), {x: v for x, v in r.items() if x != "at"})
        if self._data.get("phases") and self._data.get("phasesT"):
            docs["phases"] = (int(self._data["phasesT"]), self._data["phases"])
        # réglages par défaut de la guilde : apparence de /two (publiée dans l'appli ou en jeu), de /tlc
        ga = self._data.get("guildAppearance")
        if ga and ga.get("t"):
            docs["appearance"] = (int(ga["t"]), {k: v for k, v in ga.items() if k != "t"})
        gl = self._data.get("guildLootAp")
        if gl and gl.get("t"):
            docs["tlcap"] = (int(gl["t"]), {k: v for k, v in gl.items() if k != "t"})
        if self._data.get("bossLoot") and self._data.get("bossLootT"):
            docs["bossloot"] = (int(self._data["bossLootT"]), {**self._data["bossLoot"], "~ed": self._data.get("bossLootEd") or {}})
        # Bislist : un doc par spé
        for key, d in (self._data.get("bis") or {}).items():
            docs["bis_" + key.replace(":", "_", 1)] = (int(d.get("t") or 0), {k: v for k, v in d.items() if k != "t"})
        gs = self._data.get("guildSettings") or {}
        if gs.get("t"):
            docs["settings"] = (int(gs["t"]), {k: v for k, v in gs.items() if k != "t"})
        return docs

    def _cloud_sync(self):
        """Échange incrémental : on ne reçoit que ce qui a changé depuis la dernière synchro (date de chaque élément),
        on n'envoie (officiers) que ce qui a changé ici depuis le dernier envoi."""
        cl = self._cloud
        gid = cl.guild_id
        marks = self._data.setdefault("cloudMarks", {}).setdefault(gid, {})
        for k, v in (("docs", 0), ("pushed", 0), ("chars", 0), ("files", {}), ("uploaded", {}), ("charSig", {})):
            marks.setdefault(k, v)
        stats = {"received": 0, "sent": 0, "files": 0}
        self._adopt_game_phase()
        # 1. données (compos, assigns, onglets d'assigns, phases, apparence de guilde)
        self._sync_docs(marks, stats)
        self._split_commu_weeks()
        self._push_absences(marks)
        # 2. images : seulement celles dont la date a changé
        stats["files"] += self._sync_files(marks)
        # 3. persos : les miens (sauf cachés) partagés, ceux des autres reçus
        self._sync_chars(marks)
        # demandes de droits d'officier faites en jeu pas encore envoyées (exe fermé ou hors ligne à leur écriture)
        self._process_grants()
        self._data["cloudMembers"] = cl.members()
        self._social_pairs = self._fetch_social_pairs()
        self._fetch_discord_members()
        if stats["received"] or stats["files"]:
            self._write_fade_masks()
            self._ensure_blur_textures()
        return stats

    def live(self, full=True):
        """Direct (connecté) : docs de la guilde changés (compos, assigns, notes, compos communautaires, persos
        retirés…) reçus, les miens envoyés (officier) ; une seule petite requête quand rien n'a changé.
        full : aussi absences, persos partagés et présence (« X Online »). True si quelque chose est arrivé."""
        cl = self._cloud
        if not (cl.logged and cl.guild_id) or not self._lock.acquire(blocking=False):
            return False
        try:
            marks = self._data.setdefault("cloudMarks", {}).setdefault(cl.guild_id, {})
            for k, v in (("docs", 0), ("pushed", 0), ("chars", 0), ("files", {}), ("uploaded", {}), ("charSig", {})):
                marks.setdefault(k, v)
            stats = {"received": 0, "sent": 0}
            self._sync_docs(marks, stats)
            if stats["received"]:
                self._split_commu_weeks()
            got = 0
            if full:
                self._push_absences(marks)
                got = self._sync_chars(marks)
            self._presence(force=stats.pop("pingBack", False))
            if stats["received"] or stats["sent"] or got:
                _save(DATA_PATH, self._data)
                self._safe_write()
            return bool(stats["received"] or got)
        except Exception:
            return False
        finally:
            self._lock.release()

    # ------------------------------------------------------------ présence (« X Online »)
    def _presence(self, force=False, out=False):
        """Appli ouverte : signal envoyé toutes les minutes (tout de suite quand un autre joueur arrive, pour qu'il
        me voie) ; fermée : signal de départ."""
        cl = self._cloud
        if not (cl.logged and cl.guild_id):
            return
        now = time.time()
        if not (force or out) and now - self.__dict__.get("_last_ping", 0) < 55:
            return
        self.__dict__["_last_ping"] = now
        try:
            cl.api("presence", guildId=cl.guild_id, timeout=8, out=bool(out))
        except Exception:
            pass

    def _online(self):
        """Utilisateurs de l'appli en ligne (signal de moins de 2 min 30), moi compris : [noms Discord]."""
        now, me = time.time(), self._my_discord()
        out = []
        for uid, o in (self._data.get("online") or {}).items():
            if o.get("on") and now - int(o.get("t") or 0) < 150 and uid != me:
                out.append(o.get("name") or "?")
        if me:
            u = self._cloud.session.get("user") or {}
            mem = self._cloud.session.get("member") or {}
            out.append(mem.get("nick") or u.get("globalName") or u.get("username") or "?")
        return sorted(set(out), key=str.lower)

    def _apply_live_event(self, event_id, value):
        """Remplace (ou ajoute / retire) un event de la liste avec sa version envoyée par la fonction serveur."""
        events = self._data["events"]
        idx = next((i for i, e in enumerate(events) if e.get("id") == str(event_id)), None)
        if value.get("deleted"):
            if idx is None:
                return False
            events.pop(idx)
            return True
        try:
            ev = remote.normalize_event(value)
        except Exception:
            return False
        if not ev.get("start"):
            return False
        if idx is None:
            events.append(ev)
        else:
            events[idx] = ev
        return True

    def _sync_docs(self, marks, stats):
        cl = self._cloud
        seen = marks.setdefault("seen", {})
        remote_docs = cl.pull_docs(max(0, marks["docs"] - 120))
        local = self._cloud_docs()
        for doc_id, (t, value) in sorted(remote_docs.items(), key=lambda kv: kv[0] != "phases"):
            # déjà reçu (la fenêtre de 2 min relit les derniers docs)
            if int(seen.get(doc_id) or 0) >= t:
                continue
            seen[doc_id] = t
            if doc_id == "appearance":
                if t > int((self._data.get("guildAppearance") or {}).get("t") or 0):
                    self._data["guildAppearance"] = {**value, "t": t}
                    self._apply_guild_appearance()
                    stats["received"] += 1
                continue
            if t <= local.get(doc_id, (0, None))[0]:
                continue
            stats["received"] += 1
            if doc_id.startswith("week_"):
                self._data["weeks"][doc_id[5:]] = value
            elif doc_id.startswith("assign_"):
                self._assigns()[doc_id[7:]] = value
            elif doc_id.startswith("preset_"):
                self._data.setdefault("presets", {})[doc_id[7:]] = value
            elif doc_id == "phases":
                self._data["phases"], self._data["phasesT"] = value, t
            elif doc_id == "settings":
                self._data["guildSettings"] = {**value, "t": t}
            elif doc_id.startswith("note_"):
                self._data.setdefault("notes", {})[doc_id[5:]] = {**(value or {}), "t": t}
            elif doc_id.startswith("ccomp_"):
                cur = (self._data.get("ccomps") or {}).get(doc_id[6:]) or {}
                if t >= int(cur.get("t") or 0):          # pas une modification d'ici plus récente, pas encore envoyée
                    self._data.setdefault("ccomps", {})[doc_id[6:]] = {**(value or {}), "commu": True, "t": t}
            elif doc_id == "chardel":
                # liste complète : un perso sorti de la corbeille n'y est plus (remplacée, pas fusionnée)
                self._data["charDel"] = {n: int(dt or 0) for n, dt in (value or {}).items()}
            elif doc_id == "chartrash":
                self._data["charTrash"] = dict(value or {})
            elif doc_id.startswith("online_"):
                # un autre joueur ouvre l'appli : je renvoie mon signal pour qu'il me compte aussi
                uid, online = doc_id[7:], self._data.setdefault("online", {})
                prev = online.get(uid) or {}
                online[uid] = {**(value or {}), "t": t}
                if (value or {}).get("on") and uid != self._my_discord() and (not prev.get("on") or t - int(prev.get("t") or 0) > 150):
                    stats["pingBack"] = True
            elif doc_id.startswith("loot_"):
                self._merge_loot([{**(value or {}), "k": doc_id[5:], "at": t}])
            elif doc_id == "tlcap":
                self._data["guildLootAp"] = {**(value or {}), "t": t}
            elif doc_id == "bossloot":
                # réunion : ce qui manquait ici est ajouté ; ce que j'ai en plus repart avec une date plus récente ;
                # modifications à la main (« ~ed ») : la plus récente gagne, appliquées avant la réunion
                value = dict(value or {})
                red = value.pop("~ed", None) or {}
                led = self._data.get("bossLootEd") or {}
                ed_only = any(int(e.get("t") or 0) > int((red.get(k) or {}).get("t") or 0) for k, e in led.items())
                self._merge_boss_ed([red], t)
                local_only = any(str(i) not in (value.get(r) or {}).get(b, {})
                                 for r, bs in (self._data.get("bossLoot") or {}).items() for b, its in bs.items() for i in its)
                self._merge_boss_loot([value], t)
                if local_only or ed_only:
                    self._data["bossLootT"] = remote.now()
            elif doc_id.startswith("bis_") and "_" in doc_id[4:]:
                cls, spec = doc_id[4:].split("_", 1)
                self._data.setdefault("bis", {})[cls + ":" + spec] = {**(value or {}), "t": t}
            elif doc_id.startswith("abs_"):
                # jours d'absence d'un joueur (calendrier : absents sous les events du jour)
                self._data.setdefault("guildAbs", {})[doc_id[4:]] = {**(value or {}), "t": t}
            elif doc_id.startswith("rhev_"):
                # event Raid-Helper changé par Guild Tool (inscription, statut, création, modification, suppression)
                if t >= int(self._data.get("lastSync") or 0) - 5 and self._apply_live_event(doc_id[5:], value or {}):
                    stats["events"] = stats.get("events", 0) + 1
        if stats.get("events"):
            self._resolve_all()
        if remote_docs:
            marks["docs"] = max(marks["docs"], max(t for t, _ in remote_docs.values()))
        if cl.officer:
            out = {k: v for k, v in local.items() if v[0] > marks["pushed"] and v[0] > remote_docs.get(k, (0, None))[0]}
            if out:
                cl.push_docs(out)
                stats["sent"] += len(out)
                marks["pushed"] = max([marks["pushed"]] + [t for t, _ in out.values()])
                for k, (t, _) in out.items():
                    seen[k] = max(int(seen.get(k) or 0), int(t))

    def _sync_files(self, marks):
        cl, got = self._cloud, 0
        remote_files = cl.list_files()
        for rel, stamp in remote_files.items():
            if marks["files"].get(rel) == stamp:
                # déjà reçue, mais textures du jeu effacées (addon réinstallé / mis à jour) : refaites depuis le .jpg
                path = self._local_file(rel)
                if path and os.path.exists(path) and self._game_textures_missing(rel):
                    try:
                        self._file_received(rel, path)
                        got += 1
                    except Exception:
                        traceback.print_exc()
                if not (path and os.path.exists(path)):
                    marks["files"].pop(rel, None)      # .jpg perdu : retéléchargé ci-dessous
                else:
                    continue
            data = cl.download(rel)
            path = self._local_file(rel)
            if path:
                os.makedirs(os.path.dirname(path), exist_ok=True)
                with open(path, "wb") as fh:
                    fh.write(data)
                marks["uploaded"][rel] = os.path.getmtime(path)
                self._file_received(rel, path)
                got += 1
            marks["files"][rel] = stamp
        # images de fond des persos : celles retirées par leur joueur sont effacées ici aussi
        cdir = os.path.join(APP_DIR, "chars")
        for f in (os.listdir(cdir) if os.path.isdir(cdir) else []):
            if f.endswith(".jpg") and ("chars/" + f) not in remote_files and not f.startswith((cl.auth_uid() or "-") + "_"):
                for p in (os.path.join(cdir, f), self._media("chars", f[:-4] + ".tga")):
                    try:
                        os.remove(p)
                    except OSError:
                        pass
                marks["files"].pop("chars/" + f, None)
        if cl.officer:
            for sub in ("assign", "raids"):
                d = os.path.join(APP_DIR, sub)
                for f in (os.listdir(d) if os.path.isdir(d) else []):
                    if not f.endswith(".jpg") or f.endswith("_blur.jpg"):
                        continue
                    rel, path = sub + "/" + f, os.path.join(d, f)
                    if os.path.getmtime(path) > marks["uploaded"].get(rel, 0):
                        with open(path, "rb") as fh:
                            cl.upload(rel, fh.read())
                        marks["uploaded"][rel] = os.path.getmtime(path)
                        marks["files"].pop(rel, None)       # sa nouvelle date sera relue au prochain Sync
        return got

    # ------------------------------------------------------------ images de fond des persos (détail de Members)
    CHAR_IMG_RATIO = 3.6

    def _char_tex(self, img, stem):
        """Texture de l'addon (media/chars/<stem>.tga) d'une image de fond de perso."""
        from PIL import Image
        if os.path.isdir(self._media()):
            os.makedirs(self._media("chars"), exist_ok=True)
            small = img.convert("RGB").resize((1024, 256), Image.LANCZOS)
            small.save(self._media("chars", stem + ".tga"))
            # version floutée (Members, « Custom Background opac/blur » en jeu : mélange des deux textures)
            from PIL import ImageFilter
            small.filter(ImageFilter.GaussianBlur(6)).resize((512, 128), Image.LANCZOS).save(self._media("chars", stem + "_blur.tga"))

    def _char_images(self, game=False):
        """{perso: url (appli) ou texture (addon)} des images de fond ; nom du fichier = <compte>_<nom en hexa>.jpg."""
        out, d = {}, os.path.join(APP_DIR, "chars")
        files = sorted(os.listdir(d), key=lambda f: os.path.getmtime(os.path.join(d, f))) if os.path.isdir(d) else []
        for f in files:
            m = re.match(r"^([0-9a-f]+)_([0-9a-f]+)\.jpg$", f)
            if not m:
                continue
            try:
                name = bytes.fromhex(m.group(2)).decode("utf-8")
            except ValueError:
                continue
            if game:
                if os.path.exists(self._media("chars", f[:-4] + ".tga")):
                    out[name] = "chars\\" + f[:-4]
            else:
                out[name] = self._cached_url(os.path.join(d, f))
        return out

    def save_char_image(self, char, rect):
        """Image de fond d'un de MES persos (détail de Members), partagée avec la guilde."""
        from PIL import Image
        if char not in {c["name"] for c in self._my_chars()}:
            return {"ok": False, "error": "Only the owner of this character can change its picture."}
        try:
            crop = self._crop(rect)
        except Exception as e:
            return {"ok": False, "error": str(e)}
        uid = (self._cloud.auth_uid() if self._cloud.logged else None) or "local"
        stem = "%s_%s" % (uid, char.encode("utf-8").hex())
        d = os.path.join(APP_DIR, "chars")
        os.makedirs(d, exist_ok=True)
        img = crop.resize((1440, int(1440 / self.CHAR_IMG_RATIO)), Image.LANCZOS)
        path = os.path.join(d, stem + ".jpg")
        img.save(path, quality=82)
        self._char_tex(img, stem)
        shared = False
        if self._cloud.logged and self._cloud.guild_id and uid != "local":
            try:
                with open(path, "rb") as fh:
                    self._cloud.upload("chars/" + stem + ".jpg", fh.read())
                shared = True
            except Exception as e:
                return {"ok": True, "url": self._cached_url(path), "shared": False, "error": str(e)}
        self._safe_write()
        return {"ok": True, "url": self._cached_url(path), "shared": shared}

    def remove_char_image(self, char):
        """Retire l'image de fond d'un de mes persos (ici et sur le serveur)."""
        if char not in {c["name"] for c in self._my_chars()}:
            return {"ok": False, "error": "Only the owner of this character can change its picture."}
        hexname, d = char.encode("utf-8").hex(), os.path.join(APP_DIR, "chars")
        for f in (os.listdir(d) if os.path.isdir(d) else []):
            if f.endswith("_" + hexname + ".jpg"):
                for p in (os.path.join(d, f), self._media("chars", f[:-4] + ".tga")):
                    try:
                        os.remove(p)
                    except OSError:
                        pass
                if self._cloud.logged and self._cloud.guild_id:
                    try:
                        self._cloud.delete_file("chars/" + f)
                    except Exception:
                        pass
        self._safe_write()
        return {"ok": True}

    def _game_textures_missing(self, rel):
        """Textures du jeu (.tga dans media) faites à partir d'une image reçue : absentes ?"""
        if not os.path.isdir(self._media()):
            return False
        sub, _, name = rel.partition("/")
        stem = name[:-4]
        if sub == "assign":
            return not os.path.exists(os.path.join(self._media("assign"), stem + ".tga"))
        if sub == "app":
            return not os.path.exists(self._media("bg_window.tga"))
        if sub == "chars":
            return not os.path.exists(self._media("chars", stem + ".tga"))
        if sub == "raids":
            full = stem.endswith("_full")
            key = stem[:-5] if full else stem
            tex = next((r.get("tex") for ph in self._phases() for r in ph["raids"] if r["key"] == key and r.get("tex")), None)
            return bool(tex) and not os.path.exists(self._media(tex + ("_full.tga" if full else ".tga")))
        return False

    @staticmethod
    def _local_file(rel):
        sub, _, name = rel.partition("/")
        if not re.match(r"^[A-Za-z0-9_]+\.jpg$", name):
            return None
        if sub in ("assign", "raids", "chars"):
            return os.path.join(APP_DIR, sub, name)
        if sub == "app" and name == "bg_window.jpg":
            return os.path.join(APP_DIR, "guild_bg.jpg")
        return None

    def _file_received(self, rel, path):
        """Image reçue de la guilde : versions floutées et textures de l'addon refaites ici."""
        from PIL import Image, ImageDraw, ImageFilter
        sub, _, name = rel.partition("/")
        stem = name[:-4]
        img = Image.open(path).convert("RGB")
        blur = lambda im: im.filter(ImageFilter.GaussianBlur(max(im.size) // 160))
        if sub == "chars":
            self._char_tex(img, stem)
        elif sub == "app":
            if not self._appearance().get("local"):
                self._use_guild_bg()
        elif sub == "raids":
            full = stem.endswith("_full")
            key = stem[:-5] if full else stem
            blur(img).save(path[:-4] + "_blur.jpg", quality=86)
            tex = next((r.get("tex") for ph in self._phases() for r in ph["raids"] if r["key"] == key and r.get("tex")), None)
            if tex and os.path.isdir(self._media()):
                if full:
                    img.resize((1024, 512), Image.LANCZOS).save(self._media(tex + "_full.tga"))
                    blur(img).resize((512, 256), Image.LANCZOS).save(self._media(tex + "_full_blur.tga"))
                else:
                    img.resize((512, 512), Image.LANCZOS).save(self._media(tex + ".tga"))
                    blur(img).resize((512, 512), Image.LANCZOS).save(self._media(tex + "_blur.tga"))
        elif "_Banner" in stem:
            self._banner_tex(img, stem)
        elif os.path.isdir(self._media()):
            media = self._media("assign")
            os.makedirs(media, exist_ok=True)
            if "_Boss" in stem:
                mask = Image.new("L", (512, 512), 0)
                ImageDraw.Draw(mask).ellipse((4, 4, 508, 508), fill=255)
                tex = img.resize((128, 128), Image.LANCZOS).convert("RGBA")
                tex.putalpha(mask.resize((128, 128), Image.LANCZOS))
                tex.save(os.path.join(media, stem + ".tga"))
            else:
                img.resize((1024, 512), Image.LANCZOS).save(os.path.join(media, stem + ".tga"))

    def _sync_chars(self, marks):
        cl = self._cloud
        hidden = set(self._config.get("hiddenChars") or [])
        sv_chars = self._sv.get("chars") if isinstance(self._sv.get("chars"), dict) else {}
        roster = self._sv.get("roster") or {}
        push_t, sent = marks.setdefault("charPushT", {}), marks.setdefault("hiddenSent", {})
        dels = self._data.get("charDel") or {}
        # perso retiré de la base par un officier depuis mon dernier envoi : caché ici aussi (« Show » le repartage)
        auto = [c["name"] for c in self._my_chars() if c["name"] not in hidden and c["name"] in push_t
                and int(dels.get(c["name"]) or 0) > int(push_t[c["name"]])]
        auto_hid = marks.setdefault("autoHid", {})
        # caché par ce retrait puis sorti de la corbeille par un officier : remontré et repartagé
        back = [n for n in auto_hid if n not in dels and n in hidden]
        for n in list(auto_hid):
            if n in back or n not in hidden:
                auto_hid.pop(n, None)
        for n in back:
            hidden.discard(n)
            sent.pop(n, None)
            marks["charSig"].pop(n, None)
        for n in auto:
            auto_hid[n] = int(time.time())
        if auto or back:
            hidden.update(auto)
            self._config["hiddenChars"] = sorted(hidden)
            _save(CONFIG_PATH, self._config)
        mine, gone = {}, []
        for c in self._my_chars():
            n = c["name"]
            if n in hidden:
                marks["charSig"].pop(n, None)
                if n not in sent:
                    gone.append(n)
                continue
            sent.pop(n, None)
            data = dict(sv_chars.get(n) or {})
            # wishlist du perso : partagée avec lui (les officiers la voient)
            data["wl"] = list((self._wishlist().get(n) or {}).get("items") or [])
            data.update({"c": c.get("class"), "l": c.get("level") or (roster.get(n) or {}).get("l")})
            sig = _signature(data)
            if marks["charSig"].get(n) != sig:
                mine[n] = data
                marks["charSig"][n] = sig
                push_t[n] = int(time.time())
        if mine:
            cl.push_chars(mine, [])
        if gone:
            # cachés : retirés du serveur et de la liste de chacun (fonction serveur) ; sinon ancien envoi direct
            try:
                r = cl.api("delchar", guildId=cl.guild_id, names=gone)
                for n in r.get("deleted") or []:
                    self._data.setdefault("charDel", {})[n] = int(r.get("t") or time.time())
            except cloud.CloudError:
                cl.push_chars({}, gone)
            for n in gone:
                sent[n] = int(time.time())
        store = self._data.setdefault("cloudChars", {})
        got = 0
        for row in cl.pull_chars(max(0, marks["chars"] - 120)):
            if int((store.get(row["name"]) or {}).get("t") or 0) < int(row["t"]):
                got += 1
            store[row["name"]] = {"discord_id": row["discord_id"], "data": row["data"], "t": row["t"]}
            marks["chars"] = max(marks["chars"], int(row["t"]))
        for n in gone:
            store.pop(n, None)
        return got + len(auto)

    # ------------------------------------------------------------ apparence de guilde (publiée par un officier)
    def publish_appearance(self):
        """(officier) L'apparence actuelle (et l'image de fond) devient celle de la guilde, réglages propres à chaque
        onglet compris (« tabs », opacités / flous des onglets)."""
        if not self.can_admin():
            return {"ok": False, "error": "Officers only."}

        def go():
            a = {k: (json.loads(json.dumps(v)) if isinstance(v, (dict, list)) else v)
                 for k, v in self._appearance().items() if k not in ("t", "local", "lang")}
            if a.get("bg") and os.path.exists(self._bg_path()):
                with open(self._bg_path(), "rb") as fh:
                    self._cloud.upload("app/bg_window.jpg", fh.read())
            t = remote.now()
            self._cloud.push_docs({"appearance": (t, a)})
            self._data["guildAppearance"] = {**a, "t": t}
            _save(DATA_PATH, self._data)
        return self._cloud_call(go)

    def use_guild_appearance(self):
        """Abandonne les réglages d'apparence de ce PC et reprend ceux de la guilde."""
        with self._lock:
            self._appearance()["local"] = False
            self._apply_guild_appearance()
            self._safe_write()
            return self._appearance()

    def _apply_guild_appearance(self):
        g = self._data.get("guildAppearance")
        a = self._appearance()
        if not g or a.get("local"):
            return
        for k, v in g.items():
            if k not in ("t", "local", "lang"):
                a[k] = v
        a["t"] = remote.now()
        if g.get("bg"):
            self._use_guild_bg()
        _save(CONFIG_PATH, self._config)

    def _use_guild_bg(self):
        import shutil
        from PIL import Image
        src = os.path.join(APP_DIR, "guild_bg.jpg")
        if os.path.exists(src):
            shutil.copyfile(src, self._bg_path())
            self._bg_textures(Image.open(src).convert("RGB"))
            self._appearance()["bg"] = True

    def _kick_live(self):
        """Modification locale (compo, assigns…) : envoyée à la guilde ~1 s après la dernière, sans attendre le direct."""
        t = self.__dict__.get("_kick_timer")
        if t:
            t.cancel()
        t = threading.Timer(1.2, self.live)
        t.daemon = True
        self.__dict__["_kick_timer"] = t
        t.start()

    def save_week(self, key, week):
        with self._lock:
            week = _week_from_lua(week) or {"t": 0, "comps": []}
            week["t"] = week["t"] or remote.now()
            self._data["weeks"][str(key)] = week
            _save(DATA_PATH, self._data)
            if self._cloud.officer:
                self._kick_live()
            try:
                self._write_import()
                return {"ok": True}
            except Exception as e:
                return {"ok": False, "error": str(e)}

    def item_info(self, ids):
        """Nom / qualité / icône / niveau / infobulle d'objets (Wowhead Forever, sinon Classic), en cache dans data.json.
        Les entrées de l'ancien cache (sans infobulle) ou en échec sont redemandées."""
        return self._wowhead_cache("items", ids, remote.wowhead_item)

    def spell_info(self, ids):
        """Nom / icône / infobulle de sorts (talents), en cache dans data.json."""
        return self._wowhead_cache("spells", ids, remote.wowhead_spell)

    def _wowhead_cache(self, kind, ids, fetch):
        cache = self._data.setdefault(kind, {})
        out, changed = {}, False
        for i in ids[:40]:
            key = str(i)
            cur = cache.get(key)
            if not cur or "tt" not in cur:
                try:
                    cache[key] = fetch(i)
                except Exception:
                    cache[key] = None
                changed = True
            out[key] = cache[key]
        if changed:
            with self._lock:
                _save(DATA_PATH, self._data)
        return out

    def set_spec(self, name, spec):
        with self._lock:
            if spec:
                self._data["specs"][name] = spec
            else:
                self._data["specs"].pop(name, None)
            _save(DATA_PATH, self._data)
            self._safe_write()
            return True

    def link(self, uid, tag):
        with self._lock:
            if tag:
                self._data["links"][uid] = tag.lower().lstrip("@")
            else:
                self._data["links"].pop(uid, None)
            _save(DATA_PATH, self._data)
            self._resolve_all()
            self._safe_write()
            return True

    def _safe_write(self):
        try:
            self._write_import()
        except Exception:
            traceback.print_exc()

    # ------------------------------------------------------------ apparence
    def _appearance(self):
        """Réglages d'apparence ; ceux modifiés en jeu (SavedVariables) gagnent s'ils sont plus récents."""
        a = self._config.setdefault("appearance", dict(DEFAULT_CONFIG["appearance"]))
        for k, v in DEFAULT_CONFIG["appearance"].items():
            a.setdefault(k, v)
        sv = self._sv.get("appearance") if isinstance(self._sv.get("appearance"), dict) else None
        if sv and int(sv.get("t") or 0) > int(a.get("t") or 0):
            for k in ("compAlpha", "bgAlpha", "listGlass", "assignAlpha", "tabsAlpha", "talentBg", "charImgA", "detAlpha", "detBlur", "membersAlpha", "membersBlur",
                      "charImgBlur", "lootAlpha", "lootBlur", "buffInt", "buffIconInt"):
                if sv.get(k) is not None:
                    a[k] = float(sv[k])
            for k, lo, hi in BUFF_PX:
                if sv.get(k) is not None:
                    a[k] = max(lo, min(hi, int(sv[k])))
            for k in ("lockA", "lockB", "base", "lang", "hl", "hl2"):
                if isinstance(sv.get(k), str):
                    a[k] = sv[k]
            if sv.get("hlGrad") is not None:
                a["hlGrad"] = bool(sv["hlGrad"])
            if sv.get("assignNoBg") is not None:
                a["assignNoBg"] = bool(sv["assignNoBg"])
            if sv.get("charImgOff") is not None:
                a["charImgOff"] = bool(sv["charImgOff"])
            if isinstance(sv.get("tabs"), dict):
                a["tabs"] = _clean_tabs(sv["tabs"])
            # changé en jeu : ce PC garde son apparence (une apparence publiée par la guilde ne l'écrase plus)
            a["local"] = True
            a["t"] = int(sv["t"])
            _save(CONFIG_PATH, self._config)
        return a

    def _bg_path(self):
        return os.path.join(APP_DIR, "bg_window.jpg")

    def _bg_url(self):
        p = self._bg_path()
        if not (self._appearance().get("bg") and os.path.exists(p)):
            return None
        with open(p, "rb") as f:
            return "data:image/jpeg;base64," + base64.b64encode(f.read()).decode()

    def save_appearance(self, values):
        with self._lock:
            a = self._appearance()
            for k in ("compAlpha", "bgAlpha", "listGlass", "assignAlpha", "tabsAlpha", "talentBg", "charImgA", "detAlpha", "detBlur", "membersAlpha", "membersBlur",
                      "charImgBlur", "lootAlpha", "lootBlur", "buffInt", "buffIconInt"):
                if k in values:
                    a[k] = max(0.0, min(1.0, float(values[k])))
            for k, lo, hi in BUFF_PX:
                if k in values:
                    a[k] = max(lo, min(hi, int(values[k])))
            for k in ("lockA", "lockB", "base", "hl", "hl2"):
                if isinstance(values.get(k), str) and re.match(r"^#[0-9a-fA-F]{6}$", values[k]):
                    a[k] = values[k].lower()
            if values.get("lang") in ("en", "fr"):
                a["lang"] = values["lang"]
            if "assignNoBg" in values:
                a["assignNoBg"] = bool(values["assignNoBg"])
            if "hlGrad" in values:
                a["hlGrad"] = bool(values["hlGrad"])
            if "charImgOff" in values:
                a["charImgOff"] = bool(values["charImgOff"])
            if isinstance(values.get("tabs"), dict):
                a["tabs"] = _clean_tabs(values["tabs"])
            # un réglage changé ici : ce PC garde son apparence (celle de la guilde ne l'écrase plus)
            if any(k != "lang" for k in values):
                a["local"] = True
            a["t"] = remote.now()
            _save(CONFIG_PATH, self._config)
            self._safe_write()
            return a

    def _absences(self):
        """Jours d'absence (« AAAAMMJJ ») ; ceux saisis en jeu gagnent s'ils sont plus récents."""
        sv = self._sv.get("absences")
        if isinstance(sv, dict) and int(self._sv.get("absT") or 0) > int(self._data.get("absT") or 0):
            self._data["absences"] = sorted(str(k) for k, v in sv.items() if v)
            self._data["absT"] = int(self._sv["absT"])
            _save(DATA_PATH, self._data)
        return self._data.get("absences", [])

    def save_absences(self, days):
        with self._lock:
            before = set(self._data.get("absences") or [])
            self._data["absences"] = sorted({str(d) for d in days if re.match(r"^\d{8}$", str(d))})
            self._data["absT"] = remote.now()
            _save(DATA_PATH, self._data)
            self._safe_write()
            added = set(self._data["absences"]) - before
        threading.Thread(target=self._push_absences, daemon=True).start()
        if added:
            threading.Thread(target=self._absent_on_existing, args=(added,), daemon=True).start()
        return self._data["absences"]

    def _absent_on_existing(self, days):
        """Jours d'absence ajoutés : « Absence » envoyée sur les events déjà créés ces jours-là (à venir, pas déjà absent)."""
        cl = self._cloud
        if not (cl.logged and cl.guild_id):
            return
        me, now = self._my_discord(), time.time()
        for ev in list(self._data.get("events") or []):
            st = int(ev.get("start") or 0)
            if st < now or time.strftime("%Y%m%d", time.localtime(st)) not in days:
                continue
            if any(s.get("uid") == me and s.get("st") == "absence" for s in ev.get("signups") or []):
                continue
            r = self.rh_sign(ev["id"], "absence")
            if not r.get("ok"):
                with self._lock:
                    self._data["lastError"] = "Absence: %s" % r.get("error")

    def _push_absences(self, marks=None):
        """Mes jours d'absence (exe ou jeu) envoyés à la guilde quand ils changent : doc « abs_<id Discord> » écrit par
        la fonction serveur ; à la création d'un event ces jours-là, je suis inscrit « Absence »."""
        cl = self._cloud
        if not (cl.logged and cl.guild_id):
            return
        with self._lock:
            days = list(self._absences())
            if marks is None:
                marks = self._data.setdefault("cloudMarks", {}).setdefault(cl.guild_id, {})
            sig = _signature(days)
            if marks.get("absSig") == sig:
                return
        try:
            cl.api("absences", guildId=cl.guild_id, days=days)
            with self._lock:
                marks["absSig"] = sig
                _save(DATA_PATH, self._data)
        except Exception as e:
            with self._lock:
                self._data["lastError"] = "Absences: %s" % e

    # ------------------------------------------------------------ images (fond de fenêtre, raids, assigns)
    def _media(self, *parts):
        return os.path.join(self._config["wowPath"], "Interface", "AddOns", "GuildTool", "media", *parts)

    @staticmethod
    def _is_wow_dir(p):
        """Dossier d'une version du jeu : Interface ou WTF dedans, ou l'exe du jeu (installation jamais lancée)."""
        if not p or not os.path.isdir(p):
            return False
        if os.path.isdir(os.path.join(p, "Interface")) or os.path.isdir(os.path.join(p, "WTF")):
            return True
        return any(f.lower().endswith(".exe") and "wow" in f.lower() for f in os.listdir(p))

    def addon_status(self):
        """Pour la fenêtre d'installation : dossier du jeu trouvé ? addon installé (version) ?"""
        p = self._config.get("wowPath") or ""
        toc = os.path.join(p, "Interface", "AddOns", "GuildTool", "GuildTool.toc")
        return {"wowOk": self._is_wow_dir(p), "path": p, "installed": os.path.exists(toc),
                "version": self._addon_version(os.path.dirname(toc)), "app": APP_VERSION}

    def wow_account_tree(self):
        """Fenêtre de premier réglage : pour chaque dossier de compte lu (licences comprises), ses serveurs et les
        persos de chacun (dossiers WTF/Account/<compte>/<serveur>/<perso>), pour reconnaître le bon compte."""
        root, out = os.path.join(self._config.get("wowPath") or "", "WTF", "Account"), []
        for acc in self._account_folders():
            realms = []
            try:
                for realm in sorted(os.listdir(os.path.join(root, acc))):
                    rp = os.path.join(root, acc, realm)
                    if realm == "SavedVariables" or not os.path.isdir(rp):
                        continue
                    chars = sorted(c for c in os.listdir(rp) if os.path.isdir(os.path.join(rp, c)))
                    if chars:
                        realms.append({"name": realm, "chars": chars})
            except OSError:
                pass
            out.append({"folder": acc, "realms": realms})
        return out

    def pick_wow_folder(self):
        """Choix du dossier de la version du jeu (celui qui contient WTF et Interface, ex. _classic_beta_). Dossier
        parent choisi (World of Warcraft) : la version qui contient déjà Guild Tool, sinon la seule version trouvée."""
        mode = webview.FileDialog.FOLDER if hasattr(webview, "FileDialog") else webview.FOLDER_DIALOG
        paths = webview.windows[0].create_file_dialog(mode, directory=self._config.get("wowPath") or "")
        if not paths:
            return {"ok": True, "path": None}
        p = paths[0] if isinstance(paths, (list, tuple)) else paths
        if not self._is_wow_dir(p):
            versions = [d for d in (os.listdir(p) if os.path.isdir(p) else [])
                        if self._is_wow_dir(os.path.join(p, d)) and d.startswith("_")]
            with_addon = [d for d in versions if os.path.isdir(os.path.join(p, d, "Interface", "AddOns", "GuildTool"))]
            if len(with_addon) == 1 or len(versions) == 1:
                p = os.path.join(p, (with_addon or versions)[0])
            else:
                hint = (" Choose one of: " + ", ".join(versions)) if versions else ""
                return {"ok": False, "error": "This is not a game version folder (no WTF / Interface inside)." + hint}
        with self._lock:
            self._config["wowPath"] = p
            _save(CONFIG_PATH, self._config)
            self._sv_mtime = 0
        return {"ok": True, "path": p}

    def pick_image(self, ratio=None):
        """Choix d'une image : renvoie un aperçu (data URL) pour le recadrage au ratio demandé."""
        from PIL import Image
        import io
        mode = webview.FileDialog.OPEN if hasattr(webview, "FileDialog") else webview.OPEN_DIALOG
        paths = webview.windows[0].create_file_dialog(
            mode, file_types=("Images (*.png;*.jpg;*.jpeg;*.webp;*.bmp)",))
        if not paths:
            return None
        self._img_src = paths[0] if isinstance(paths, (list, tuple)) else paths
        im = Image.open(self._img_src).convert("RGB")
        im.thumbnail((1600, 1600))
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=85)
        return {"url": "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode(),
                "w": im.size[0], "h": im.size[1], "ratio": float(ratio or WIN_W / WIN_H)}

    def pick_background(self):
        return self.pick_image(WIN_W / WIN_H)

    def _crop(self, rect):
        """Partie choisie (rect en fractions 0-1) de la dernière image ouverte."""
        from PIL import Image
        src = getattr(self, "_img_src", None)
        if not src:
            raise RuntimeError("Choose an image first.")
        im = Image.open(src).convert("RGB")
        W, H = im.size
        return im.crop((int(rect["x"] * W), int(rect["y"] * H),
                        int((rect["x"] + rect["w"]) * W), int((rect["y"] + rect["h"]) * H)))

    @staticmethod
    def _data_url(path):
        with open(path, "rb") as f:
            return "data:image/jpeg;base64," + base64.b64encode(f.read()).decode()

    def _bg_textures(self, img):
        from PIL import Image, ImageFilter
        if os.path.isdir(self._media()):
            # texture 1024x512 étirée : l'addon l'affiche sur toute la fenêtre, ce qui rétablit les proportions
            tex = img.resize((1024, 512), Image.LANCZOS)
            tex.save(self._media("bg_window.tga"))
            tex.filter(ImageFilter.GaussianBlur(7)).save(self._media("bg_window_blur.tga"))

    def _backup_bg(self):
        """Copie l'image de fond actuelle pour pouvoir l'annuler (Undo) ; "" = pas d'image."""
        import shutil
        p = self._bg_path()
        if not (self._appearance().get("bg") and os.path.exists(p)):
            return ""
        d = os.path.join(APP_DIR, "bg_undo")
        os.makedirs(d, exist_ok=True)
        token = str(int(time.time() * 1000))
        shutil.copyfile(p, os.path.join(d, token + ".jpg"))
        return token

    def save_background(self, rect):
        """Recadre l'image choisie : JPG pour l'exe, TGA nette + floutée pour l'addon."""
        from PIL import Image
        with self._lock:
            try:
                crop = self._crop(rect).resize((WIN_W, WIN_H), Image.LANCZOS)
            except Exception as e:
                return {"ok": False, "error": str(e)}
            token = self._backup_bg()
            os.makedirs(APP_DIR, exist_ok=True)
            crop.save(self._bg_path(), quality=88)
            self._bg_textures(crop)
            a = self._appearance()
            a["bg"] = True
            a["local"] = True   # fond choisi sur ce PC
            a["t"] = remote.now()
            _save(CONFIG_PATH, self._config)
            self._safe_write()
            return {"ok": True, "undo": token}

    def remove_background(self):
        with self._lock:
            token = self._backup_bg()
            a = self._appearance()
            a["bg"] = False
            a["local"] = True   # fond choisi sur ce PC
            a["t"] = remote.now()
            _save(CONFIG_PATH, self._config)
            self._safe_write()
            return {"ok": True, "undo": token}

    def default_background(self):
        """Settings > Default : le fond de la guilde (publié par l'admin) remplace celui de ce PC (sinon aucun fond)."""
        import shutil
        from PIL import Image
        with self._lock:
            token = self._backup_bg()
            a = self._appearance()
            src = os.path.join(APP_DIR, "guild_bg.jpg")
            if os.path.exists(src):
                shutil.copyfile(src, self._bg_path())
                self._bg_textures(Image.open(src).convert("RGB"))
                a["bg"] = True
            else:
                a["bg"] = False
            a["local"] = False   # suit de nouveau la guilde
            a["t"] = remote.now()
            _save(CONFIG_PATH, self._config)
            self._safe_write()
            return {"ok": True, "undo": token}

    def restore_background(self, token):
        """Undo : remet l'image de fond sauvegardée (token "" = pas d'image)."""
        import shutil
        from PIL import Image
        with self._lock:
            src = os.path.join(APP_DIR, "bg_undo", token + ".jpg") if token else ""
            a = self._appearance()
            if src and os.path.exists(src):
                shutil.copyfile(src, self._bg_path())
                self._bg_textures(Image.open(src).convert("RGB"))
                a["bg"] = True
            else:
                a["bg"] = False
            a["t"] = remote.now()
            _save(CONFIG_PATH, self._config)
            self._safe_write()
            return True

    # ------------------------------------------------------------ phases et raids (éditeur des Settings)
    def _phases(self):
        p = self._data.get("phases")
        return p if isinstance(p, list) and p else json.loads(json.dumps(DEFAULT_PHASES))

    def _lua_phases(self):
        """Phases pour l'addon (None = celles de Data.lua) ; bg = texture du dossier media."""
        if not self._data.get("phases"):
            return None
        out = []
        for ph in self._phases():
            raids = []
            for r in ph["raids"]:
                bg = r.get("tex") or ("raid_" + r["key"] if r.get("img") else (None if r.get("custom") else "bg_" + r["key"]))
                # image entière (fond d'Assigns) : <tex>_full, sinon l'image d'origine ; floutée = <full>_blur ; zone de fondu
                full = (r["tex"] + "_full") if r.get("full") and r.get("tex") else bg
                raids.append({k: v for k, v in (("key", r["key"]), ("name", r["name"]), ("short", r.get("short") or r["name"]),
                                                 ("size", r["size"]), ("aspect", r.get("aspect")), ("bg", bg), ("full", full),
                                                 ("fullAspect", r.get("fullAspect") or r.get("aspect")),
                                                 ("fade", self._media_base(r) + "_fade" if r.get("fade") else None),
                                                 ("view", r.get("view")),
                                                 ("bar", r.get("bar")), ("bgAspect", self._img_aspect(self._raid_bg_path(r))),
                                                 ("bosses", [{"name": b["name"], **({"img": "assign\\" + b["img"]} if b.get("img") else {}),
                                                              **self._lua_banner(b)}
                                                             for b in r.get("bosses") or []] or None)) if v is not None})
            out.append({"name": ph["name"], "raids": raids})
        return out

    def save_phases(self, phases):
        if not self.can_admin():
            return {"ok": False, "error": "Officers only."}
        with self._lock:
            clean = []
            for ph in phases or []:
                raids = []
                for r in ph.get("raids") or []:
                    if not re.match(r"^[a-z0-9_]+$", str(r.get("key") or "")) or int(r.get("size") or 0) not in RAID_RATIO:
                        continue
                    keep = {k: r[k] for k in ("key", "name", "short", "size", "aspect", "custom", "img", "tex", "full", "fullAspect")
                            if r.get(k) is not None}
                    # boss du raid (onglet Loots, vue Boss) : nom + image ronde (comme les icônes de boss d'Assigns)
                    # bannière (onglet Loots, Tables) : image entière + cadrage du bouton fermé (fractions 0-1)
                    bosses = [{"name": str(b.get("name") or "").strip()[:40],
                               **({"img": b["img"]} if re.match(r"^[A-Za-z0-9_]+$", str(b.get("img") or "")) else {}),
                               **({"banner": b["banner"]} if re.match(r"^[A-Za-z0-9_]+$", str(b.get("banner") or "")) else {}),
                               **({"bcrop": _crop_rect(b["bcrop"])} if _crop_rect(b.get("bcrop")) else {})}
                              for b in (r.get("bosses") or []) if isinstance(b, dict) and str(b.get("name") or "").strip()]
                    if bosses:
                        keep["bosses"] = bosses
                    # cadrage de l'image du raid sur sa barre (onglet Loots, Tables)
                    if _crop_rect(r.get("bar")):
                        keep["bar"] = _crop_rect(r.get("bar"))
                    f = r.get("fade")
                    if isinstance(f, dict) and f.get("shape") in ("rect", "circle"):
                        keep["fade"] = {"shape": f["shape"], **{k: max(0.0, min(1.0, float(f.get(k) or 0))) for k in ("x", "y", "w", "h")},
                                        "k": max(0.0, min(1.0, float(f["k"] if f.get("k") is not None else 1)))}
                    # partie de l'image entière qui sert de fond à la page Assigns (rectangle au format de la page)
                    v = r.get("view")
                    if isinstance(v, dict):
                        keep["view"] = {k: max(0.0, min(1.0, float(v.get(k) or 0))) for k in ("x", "y", "w", "h")}
                    raids.append(keep)
                clean.append({"name": str(ph.get("name") or "Phase %d" % (len(clean) + 1)), "raids": raids})
            self._data["phases"] = clean or None
            self._data["phasesT"] = remote.now()
            self._write_fade_masks()
            _save(DATA_PATH, self._data)
            self._safe_write()
            return self._phases()

    def _raid_bg_path(self, r):
        """Image de fond d'un raid (celle de l'appli : copie du raid ajouté, sinon l'image d'origine)."""
        return self._raid_img(r["key"]) if r.get("custom") else os.path.join(BASE_DIR, "web", "img", "bg_%s.jpg" % r["key"])

    _aspects = {}

    def _img_aspect(self, path):
        """Rapport largeur / hauteur d'une image (gardé tant que le fichier ne change pas), None si absente."""
        from PIL import Image
        try:
            mt = os.path.getmtime(path)
        except OSError:
            return None
        hit = self._aspects.get(path)
        if not hit or hit[0] != mt:
            try:
                with Image.open(path) as im:
                    hit = (mt, round(im.size[0] / im.size[1], 4))
            except Exception:
                return None
            self._aspects[path] = hit
        return hit[1]

    def _lua_banner(self, b):
        """Bannière d'un boss pour l'addon : texture (media/assign), rapport de l'image d'origine, cadrage."""
        if not b.get("banner") or not os.path.exists(self._media("assign", b["banner"] + ".tga")):
            return {}
        out = {"banner": "assign\\" + b["banner"], "bAspect": self._img_aspect(self._assign_img(b["banner"]))}
        if b.get("bcrop"):
            out["bcrop"] = b["bcrop"]
        return out

    def _banner_tex(self, img, img_id):
        """Textures de jeu d'une bannière : image entière étirée en 1024 x 512 (le cadrage se fait en fractions) et
        version floutée (le jeu ne floute pas : « Blurred » de l'outil de recadrage = mélange des deux)."""
        from PIL import Image, ImageFilter
        media = self._media("assign")
        if os.path.isdir(self._media()):
            os.makedirs(media, exist_ok=True)
            tex = img.convert("RGB").resize((1024, 512), Image.LANCZOS)
            tex.save(os.path.join(media, img_id + ".tga"))
            tex.filter(ImageFilter.GaussianBlur(8)).resize((512, 256), Image.LANCZOS).save(os.path.join(media, img_id + "_blur.tga"))

    def _raid_img(self, key, blur=False):
        return os.path.join(APP_DIR, "raids", "%s%s.jpg" % (key, "_blur" if blur else ""))

    def _raid_full(self, key, blur=False):
        """Image entière envoyée pour le raid (fond de la page Assigns) ; _raid_img = copie recadrée pour les compos."""
        return os.path.join(APP_DIR, "raids", "%s_full%s.jpg" % (key, "_blur" if blur else ""))

    @staticmethod
    def _media_base(r):
        """Nom de base des textures du raid dans media (Phase1_MountHyjal, ou bg_<clé> pour les raids d'origine)."""
        return r["tex"] if r.get("tex") else "bg_" + r["key"]

    def _fade_png(self, key):
        return os.path.join(APP_DIR, "raids", "%s_fade.png" % key)

    def _write_fade_masks(self):
        """Zone de fondu de l'image du raid (Settings > Locate Fade) : la forme (rectangle aux angles arrondis ou ovale) est la
        partie qui DISPARAÎT ; le reste de l'image est gardé. Intensité k : 1 = bord court et net (disparition presque dès le
        bord), 0 = progression régulière du bord jusqu'au centre de la forme. PNG pour l'exe, TGA (alpha) pour l'addon."""
        from PIL import Image, ImageDraw, ImageFilter
        os.makedirs(os.path.join(APP_DIR, "raids"), exist_ok=True)
        for ph in self._phases():
            for r in ph["raids"]:
                f = r.get("fade")
                if not f:
                    continue
                # dessiné sur une marge : une forme qui touche un bord de l'image se prolonge au-delà (pas d'angle arrondi au bord)
                S, P = 512, 128
                x0, y0, x1, y1 = f["x"] * S, f["y"] * S, (f["x"] + f["w"]) * S, (f["y"] + f["h"]) * S
                feather = max(4, 0.22 * min(x1 - x0, y1 - y0))
                ext = lambda v, edge: v + (P if edge > 0 else -P) if abs(v - (S if edge > 0 else 0)) < 0.02 * S else v
                x0, y0, x1, y1 = ext(x0, -1), ext(y0, -1), ext(x1, 1), ext(y1, 1)
                m = Image.new("L", (S + 2 * P, S + 2 * P), 0)
                d = ImageDraw.Draw(m)
                if x1 - x0 < 2 or y1 - y0 < 2:
                    continue
                # formes concentriques du bord (profondeur 0) au centre (1) : opacité du fondu = profondeur / t
                k = max(0.0, min(1.0, float(f.get("k", 1.0))))
                t = 1 - 0.85 * k
                cx, cy, hw, hh = (x0 + x1) / 2 + P, (y0 + y1) / 2 + P, (x1 - x0) / 2, (y1 - y0) / 2
                N = 96
                for i in range(N):
                    depth = i / N
                    sw, sh = hw * (1 - depth), hh * (1 - depth)
                    if sw < 0.5 or sh < 0.5:
                        break
                    v = int(255 * min(1.0, (depth + 1 / N) / t))
                    box = (cx - sw, cy - sh, cx + sw, cy + sh)
                    if f["shape"] == "circle":
                        d.ellipse(box, fill=v)
                    else:
                        d.rounded_rectangle(box, radius=min(feather * (1 - depth), sw, sh), fill=v)
                m = m.filter(ImageFilter.GaussianBlur(max(2.0, feather / 4 * k))).crop((P, P, P + S, P + S))
                m = m.point(lambda v: 255 - v)   # la forme disparaît, le reste est gardé
                png = Image.new("RGBA", (S, S), (255, 255, 255, 0))
                png.putalpha(m)
                png.save(self._fade_png(r["key"]))
                if os.path.isdir(self._media()):
                    png.resize((256, 256), Image.LANCZOS).save(self._media(self._media_base(r) + "_fade.tga"))

    def _raid_image_urls(self):
        out = {}
        for ph in self._phases():
            for r in ph["raids"]:
                e = {}
                if r.get("img") and os.path.exists(self._raid_img(r["key"])):
                    e["bg"] = self._cached_url(self._raid_img(r["key"]))
                    e["blur"] = self._cached_url(self._raid_img(r["key"], True))
                if r.get("full") and os.path.exists(self._raid_full(r["key"])):
                    e["full"] = self._cached_url(self._raid_full(r["key"]))
                    e["fullBlur"] = self._cached_url(self._raid_full(r["key"], True))
                if r.get("fade") and os.path.exists(self._fade_png(r["key"])):
                    e["mask"] = self._cached_url(self._fade_png(r["key"])).replace("image/jpeg", "image/png", 1)
                if e:
                    out[r["key"]] = e
        return out

    def _cached_url(self, path):
        cache = self.__dict__.setdefault("_url_cache", {})
        try:
            mtime = os.path.getmtime(path)
        except OSError:
            return None
        hit = cache.get(path)
        if not hit or hit[0] != mtime:
            hit = cache[path] = (mtime, self._data_url(path))
        return hit[1]

    # ------------------------------------------------------------ noms des images du dossier media
    @staticmethod
    def _clean_name(s):
        s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode()
        s = re.sub(r"['`]", "", s)   # « Onyxia's Lair » -> OnyxiasLair
        return re.sub(r"[^A-Za-z0-9]+", "", s.title()) or "Raid"

    def _raid_place(self, key):
        """(n° de phase, nom) du raid."""
        for i, ph in enumerate(self._phases()):
            for r in ph["raids"]:
                if r["key"] == key:
                    return i + 1, r["name"]
        return 0, key

    def _media_prefix(self, phase_no, name):
        """« Phase1_MountHyjal » : nom de base des images d'un raid dans media."""
        return "Phase%d_%s" % (phase_no, self._clean_name(name))

    def _next_index(self, prefix):
        """Prochain numéro libre pour « <prefix>1, 2, … » dans APP_DIR/assign."""
        n = 0
        try:
            for f in os.listdir(os.path.join(APP_DIR, "assign")):
                m = re.match(re.escape(prefix) + r"(\d+)\.jpg$", f)
                if m:
                    n = max(n, int(m.group(1)))
        except OSError:
            pass
        return n + 1

    def _rename_media(self):
        """Une fois : anciens noms (raid_<clé>, m<hex>, b<hex>) -> Phase1_MountHyjal(_Map1 / _Boss1)."""
        if self._data.get("mediaNamesV1"):
            return
        for i, ph in enumerate(self._data.get("phases") or []):
            for r in ph.get("raids", []):
                if r.get("img") and not r.get("tex"):
                    r["tex"] = self._media_prefix(i + 1, r["name"])
                    old = self._media("raid_%s.tga" % r["key"])
                    if os.path.exists(old):
                        os.replace(old, self._media(r["tex"] + ".tga"))
        for raid, preset in (self._data.get("presets") or {}).items():
            prefix = self._media_prefix(*self._raid_place(raid))
            renames = {}

            def rename(old, kind):
                if not old or not re.match(r"^[mb][0-9a-f]+$", old):
                    return old
                if old not in renames:
                    new = "%s_%s" % (prefix, kind)
                    new += str(self._next_index(new))
                    for src, dst in ((self._assign_img(old), self._assign_img(new)),
                                     (self._media("assign", old + ".tga"), self._media("assign", new + ".tga"))):
                        if os.path.exists(src):
                            os.replace(src, dst)
                    renames[old] = new
                return renames[old]
            for tab in preset.get("tabs", []):
                tab["img"] = rename(tab.get("img"), "Map")
                for p in tab.get("phases", []):
                    p["img"] = rename(p.get("img"), "Map")
            for b in preset.get("bosses", []):
                b["img"] = rename(b.get("img"), "Boss")
        self._data["mediaNamesV1"] = True
        _save(DATA_PATH, self._data)
        self._safe_write()

    def save_raid_image(self, key, size, rect, phase_no=None, name=None):
        """Image d'un raid : recadrée au format de son cadre de compo (JPG nette + floutée,
        TGA « Phase1_MountHyjal » pour l'addon)."""
        from PIL import Image, ImageFilter
        with self._lock:
            if not re.match(r"^[a-z0-9_]+$", str(key)):
                return {"ok": False, "error": "Bad raid key."}
            p, n = self._raid_place(key)
            tex = self._media_prefix(phase_no or p, name or n)
            ratio = RAID_RATIO.get(int(size), 1.25)
            try:
                crop = self._crop(rect)
            except Exception as e:
                return {"ok": False, "error": str(e)}
            w, h = (int(1000 * ratio), 1000) if ratio < 1 else (1000, int(1000 / ratio))
            img = crop.resize((w, h), Image.LANCZOS)
            os.makedirs(os.path.join(APP_DIR, "raids"), exist_ok=True)
            img.save(self._raid_img(key), quality=86)
            img.filter(ImageFilter.GaussianBlur(max(w, h) // 160)).save(self._raid_img(key, True), quality=86)
            # image entière (fond de la page Assigns) : gardée telle quelle, réduite à 2000 px au plus
            full = Image.open(self._img_src).convert("RGB")
            full.thumbnail((1600, 1600), Image.LANCZOS)   # reste sous la limite d'un document partagé (1 Mo)
            full.save(self._raid_full(key), quality=86)
            full_blur = full.filter(ImageFilter.GaussianBlur(max(full.size) // 160))
            full_blur.save(self._raid_full(key, True), quality=86)
            if os.path.isdir(self._media()):
                img.resize((512, 512), Image.LANCZOS).save(self._media(tex + ".tga"))
                Image.open(self._raid_img(key, True)).resize((512, 512), Image.LANCZOS).save(self._media(tex + "_blur.tga"))
                full.resize((1024, 512), Image.LANCZOS).save(self._media(tex + "_full.tga"))
                full_blur.resize((512, 256), Image.LANCZOS).save(self._media(tex + "_full_blur.tga"))
            return {"ok": True, "aspect": ratio, "tex": tex, "full": True, "fullAspect": full.size[0] / full.size[1],
                    "fullUrl": self._cached_url(self._raid_full(key)), "bg": self._cached_url(self._raid_img(key)),
                    "blur": self._cached_url(self._raid_img(key, True))}

    # ------------------------------------------------------------ assigns
    def _assign_img(self, img_id):
        return os.path.join(APP_DIR, "assign", "%s.jpg" % img_id)

    def save_assign_image(self, kind, rect, raid=None):
        """Image d'onglet (carte, ratio MAP_RATIO) ou icône de boss (carré, rond dans l'addon),
        nommée « Phase1_MountHyjal_Map1 » / « Phase1_MountHyjal_Boss1 » (n° = index pour ce raid)."""
        from PIL import Image, ImageDraw
        with self._lock:
            try:
                crop = self._crop(rect)
            except Exception as e:
                return {"ok": False, "error": str(e)}
            base = "%s_%s" % (self._media_prefix(*self._raid_place(raid)), "Map" if kind == "map" else "Boss")
            img_id = base + str(self._next_index(base))
            os.makedirs(os.path.join(APP_DIR, "assign"), exist_ok=True)
            media = self._media("assign")
            if os.path.isdir(self._media()):
                os.makedirs(media, exist_ok=True)
            if kind == "map":
                img = crop.resize((1600, 1000), Image.LANCZOS)
                img.save(self._assign_img(img_id), quality=86)
                if os.path.isdir(media):
                    img.resize((1024, 512), Image.LANCZOS).save(os.path.join(media, img_id + ".tga"))
            else:
                img = crop.resize((256, 256), Image.LANCZOS)
                img.save(self._assign_img(img_id), quality=90)
                if os.path.isdir(media):
                    # cercle anti-crénelé dans l'alpha (dessiné en grand puis réduit)
                    mask = Image.new("L", (512, 512), 0)
                    ImageDraw.Draw(mask).ellipse((4, 4, 508, 508), fill=255)
                    tex = img.resize((128, 128), Image.LANCZOS).convert("RGBA")
                    tex.putalpha(mask.resize((128, 128), Image.LANCZOS))
                    tex.save(os.path.join(media, img_id + ".tga"))
            return {"ok": True, "id": img_id, "url": self._cached_url(self._assign_img(img_id))}

    def save_boss_banner(self, raid=None):
        """Bannière d'un boss (onglet Loots, Tables) : la dernière image choisie gardée entière (1600 px au plus) ;
        le cadrage est fait à l'affichage (bcrop du boss), il suit la hauteur du bouton."""
        from PIL import Image
        with self._lock:
            src = getattr(self, "_img_src", None)
            if not src:
                return {"ok": False, "error": "Choose an image first."}
            im = Image.open(src).convert("RGB")
            im.thumbnail((1600, 1600))
            base = "%s_Banner" % self._media_prefix(*self._raid_place(raid))
            img_id = base + str(self._next_index(base))
            os.makedirs(os.path.join(APP_DIR, "assign"), exist_ok=True)
            im.save(self._assign_img(img_id), quality=86)
            self._banner_tex(im, img_id)
            return {"ok": True, "id": img_id, "url": self._cached_url(self._assign_img(img_id))}

    def assign_image(self, img_id):
        if not re.match(r"^[A-Za-z0-9_]+$", str(img_id)):
            return None
        return self._cached_url(self._assign_img(img_id))

    def save_preset(self, raid, preset):
        """Onglets d'assigns d'un raid (créés dans l'exe en mode Config)."""
        with self._lock:
            presets = self._data.setdefault("presets", {})
            if preset and preset.get("tabs"):
                preset["t"] = remote.now()
                presets[str(raid)] = preset
            else:
                presets.pop(str(raid), None)
            _save(DATA_PATH, self._data)
            self._safe_write()
            return True

    def _assigns(self):
        """Noms changés à la main par compo ; ceux modifiés en jeu gagnent s'ils sont plus récents."""
        mine = self._data.setdefault("assigns", {})
        sv = self._sv.get("assigns")
        changed = False
        if isinstance(sv, dict):
            for cid, a in sv.items():
                if not isinstance(a, dict):
                    continue
                cur = mine.get(str(cid))
                if int(a.get("t") or 0) > int((cur or {}).get("t") or 0):
                    n = a.get("n") if isinstance(a.get("n"), dict) else {}
                    mine[str(cid)] = {"t": int(a["t"]), "n": {str(k): v for k, v in n.items() if isinstance(v, str)}}
                    changed = True
        if changed:
            _save(DATA_PATH, self._data)
        return mine

    def save_assign(self, comp_id, names):
        cid = str(comp_id)
        with self._lock:
            entry = {"t": remote.now(), "n": {str(k): v for k, v in (names or {}).items() if v}}
            self._assigns()[cid] = entry
            _save(DATA_PATH, self._data)
            self._safe_write()
        # compo communautaire, créateur de l'event sans droits d'officier : écrit par la fonction serveur
        cl = self._cloud
        if cl.officer:
            self._kick_live()
        if cid in (self._data.get("ccomps") or {}) and cl.logged and cl.guild_id and not cl.officer:
            def push():
                try:
                    cl.api("cassign", guildId=cl.guild_id, compId=cid, names=entry["n"])
                except Exception as e:
                    with self._lock:
                        self._data["lastError"] = "Assigns: %s" % e
            threading.Thread(target=push, daemon=True).start()
        return True

    # ------------------------------------------------------------ fenêtre sans cadre
    def win_minimize(self):
        webview.windows[0].minimize()

    def win_toggle_max(self):
        w = webview.windows[0]
        if getattr(self, "_maximized", False):
            w.restore()
            self._maximized = False
        else:
            w.maximize()
            self._maximized = True
        return self._maximized

    def win_close(self):
        # signal de départ (« X Online » des autres), puis fermeture
        self._presence(out=True)
        webview.windows[0].destroy()

    def online(self):
        return self._online()

    # ------------------------------------------------------------ mise à jour automatique de l'exe
    # ------------------------------------------------------------ mise à jour automatique de l'addon
    def _addon_version(self, folder):
        try:
            with open(os.path.join(folder, "GuildTool.toc"), encoding="utf-8", errors="replace") as f:
                m = re.search(r"^## Version:\s*(\S+)", f.read(), re.M)
            return m.group(1) if m else None
        except OSError:
            return None

    def update_addon(self):
        """Addon au numéro de l'exe : si celui installé est plus ancien (ou absent), installe GuildTool.zip de la
        release GitHub vAPP_VERSION (même version que l'exe). Import.lua et les images écrites par l'exe ne sont pas
        touchés (le zip ne les remplace pas), le .toc est écrit en dernier (= version marquée seulement si tout est
        copié). Dossier de développement (.git) ou exe non compilé : rien."""
        if not getattr(sys, "frozen", False):
            return {"ok": True, "skip": "dev"}
        wow = self._config.get("wowPath") or ""
        addons = os.path.join(wow, "Interface", "AddOns")
        folder = os.path.join(addons, "GuildTool")
        # dossier du jeu inconnu : la fenêtre « Install the addon » demande où il est ; dossier de développement : rien
        if not self._is_wow_dir(wow) or os.path.exists(os.path.join(folder, ".git")):
            return {"ok": True, "skip": "folder"}
        cur = self._addon_version(folder)
        if cur and _version_tuple(cur) >= _version_tuple(APP_VERSION):
            return {"ok": True, "current": cur}
        try:
            req = urllib.request.Request(ADDON_ZIP_URL % APP_VERSION, headers={"User-Agent": "GuildTool/" + APP_VERSION})
            with urllib.request.urlopen(req, timeout=120) as r:
                data = r.read()
            z = zipfile.ZipFile(io.BytesIO(data))
            root = os.path.realpath(folder)
            files, toc = [], None
            for info in z.infolist():
                rel = info.filename[len("GuildTool/"):] if info.filename.startswith("GuildTool/") else None
                if not rel or info.is_dir():
                    continue
                dest = os.path.realpath(os.path.join(folder, *rel.split("/")))
                if not dest.startswith(root + os.sep):
                    continue
                if rel == "Import.lua" and os.path.exists(dest):
                    continue
                if rel == "GuildTool.toc":
                    toc = (info, dest)
                else:
                    files.append((info, dest))
            if not toc:
                raise RuntimeError("GuildTool.toc missing from the archive")
            for info, dest in files + [toc]:
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                with open(dest + ".gtnew", "wb") as f:
                    f.write(z.read(info))
                os.replace(dest + ".gtnew", dest)
        except Exception as e:
            traceback.print_exc()
            return {"ok": False, "error": "Addon update failed: %s" % e}
        return {"ok": True, "updated": APP_VERSION, "from": cur}

    def check_update(self):
        cl = self._cloud
        latest = cl.latest_version()
        if latest and _version_tuple(latest.get("version")) > _version_tuple(APP_VERSION):
            return {"version": latest["version"], "url": latest["_url"]}
        return None

    def self_update(self):
        """Télécharge la nouvelle version à côté de l'exe, puis un petit script remplace l'exe une fois l'appli fermée
        et la relance. Exe non compilé ou dossier protégé : page de téléchargement ouverte à la place."""
        up = self.check_update()
        if not up:
            return {"ok": False, "error": "No update available."}
        exe = sys.executable
        if not getattr(sys, "frozen", False):
            webbrowser.open(up["url"])
            return {"ok": True, "manual": True}
        folder = os.path.dirname(exe)
        new = os.path.join(folder, "GuildTool.new.exe")
        # garde-fou : la même version vient d'être installée et on tourne toujours sur l'ancienne (remplacement raté)
        # -> page de téléchargement au lieu de recommencer en boucle
        last = self._config.get("lastUpdate") or {}
        if last.get("version") == up["version"] and time.time() - (last.get("t") or 0) < 600:
            self._config.pop("lastUpdate", None)
            _save(CONFIG_PATH, self._config)
            webbrowser.open(up["url"])
            return {"ok": True, "manual": True, "error": "The previous update could not replace the app: download it manually."}
        try:
            req = urllib.request.Request(up["url"], headers={"User-Agent": "GuildTool/" + APP_VERSION})
            with urllib.request.urlopen(req, timeout=180) as r, open(new, "wb") as f:
                shutil.copyfileobj(r, f)
            if os.path.getsize(new) < 1_000_000:
                raise RuntimeError("download incomplete")
            bat = os.path.join(folder, "GuildTool_update.bat")
            # Chemins passés par variables d'environnement (Unicode) : écrits dans le .bat en ASCII, un accent du
            # chemin devenait « ? » et le move échouait (l'ancien exe relancé redemandait la mise à jour).
            # Exe PyInstaller « onefile » = 2 processus : on attend aussi le lanceur (parent), qui verrouille l'exe ;
            # move réessayé 30 s (antivirus qui analyse le nouvel exe), sinon on lance le nouvel exe tel quel.
            # Outils de System32 en chemin complet (%S%) : avec Git / MSYS dans le PATH, « find » désignait un autre
            # programme. Pause = ping (timeout.exe échoue sans console : aucune attente, d'où l'exe encore verrouillé).
            with open(bat, "w", encoding="ascii") as f:
                f.write("\r\n".join([
                    "@echo off", "set n=0", r'set "S=%SystemRoot%\System32"', ":wait", '"%S%\\PING.EXE" -n 2 127.0.0.1 >nul',
                    '"%S%\\tasklist.exe" /FI "PID eq %GT_PID%" 2>nul | "%S%\\find.exe" "%GT_PID%" >nul && goto wait',
                    '"%S%\\tasklist.exe" /FI "PID eq %GT_PPID%" /FI "IMAGENAME eq %GT_IMG%" 2>nul | "%S%\\find.exe" "%GT_PPID%" >nul && goto wait',
                    ":move", 'move /y "%GT_NEW%" "%GT_EXE%" >nul 2>&1',
                    'if not exist "%GT_NEW%" goto run', "set /a n+=1",
                    'if %n% lss 30 ("%S%\\PING.EXE" -n 2 127.0.0.1 >nul & goto move)',
                    'set "GT_EXE=%GT_NEW%"', ":run",
                    # variables internes de PyInstaller vidées : sinon le nouvel exe cherche python311.dll dans le
                    # dossier temporaire (_MEI...) de l'ancien, supprimé à sa fermeture (« Failed to load Python DLL »)
                    'set "_MEIPASS2="', 'set "_PYI_APPLICATION_HOME_DIR="', 'set "_PYI_ARCHIVE_FILE="',
                    'set "_PYI_PARENT_PROCESS_LEVEL="', 'set "_PYI_SPLASH_IPC="', 'set "PYINSTALLER_RESET_ENVIRONMENT=1"',
                    'start "" "%GT_EXE%"', 'del "%~f0"', ""]))
        except Exception as e:
            try:
                os.remove(new)
            except OSError:
                pass
            webbrowser.open(up["url"])
            return {"ok": True, "manual": True, "error": str(e)}
        import subprocess
        # environnement propre (sans les variables _MEI / _PYI de cet exe) pour le script et le nouvel exe
        env = {k: v for k, v in os.environ.items() if not k.upper().startswith(("_MEI", "_PYI"))}
        env.update({"PYINSTALLER_RESET_ENVIRONMENT": "1", "GT_PID": str(os.getpid()), "GT_PPID": str(os.getppid()),
                    "GT_IMG": os.path.basename(exe), "GT_NEW": new, "GT_EXE": exe})
        subprocess.Popen(["cmd", "/c", bat], creationflags=0x08000000, env=env, cwd=folder)   # CREATE_NO_WINDOW
        self._config["lastUpdate"] = {"version": up["version"], "t": time.time()}
        _save(CONFIG_PATH, self._config)
        self._presence(out=True)
        threading.Timer(0.5, lambda: webview.windows[0].destroy()).start()
        return {"ok": True}

    def win_resize(self, width, height):
        webview.windows[0].resize(max(1200, int(width)), max(760, int(height)))

    def save_config(self, cfg):
        with self._lock:
            for k in DEFAULT_CONFIG:
                if k in cfg:
                    self._config[k] = cfg[k]
            self._config["serverId"] = re.sub(r"\D", "", str(self._config["serverId"]))
            if "wowAccounts" in cfg:
                accs = [{"folder": str(a.get("folder")), "all": bool(a.get("all"))}
                        for a in (cfg["wowAccounts"] or []) if isinstance(a, dict) and a.get("folder")]
                self._config["wowAccounts"] = accs
                self._config["account"] = accs[0]["folder"] if accs else ""
            _save(CONFIG_PATH, self._config)
            self._sv_mtime = 0
            self._read_sv()
            return True

    def copy_text(self, text):
        try:
            _set_clipboard(text)
            return True
        except Exception as e:
            return str(e)

    def check_webhook(self, url):
        try:
            return {"ok": True, **remote.check_webhook(url)}
        except remote.RemoteError as e:
            return {"ok": False, "error": str(e)}

    def post_discord(self, webhook_index, content, user_ids, image_data_url, channel_id="", comp_id=""):
        """Compo publiée sur Discord : salon du serveur de la guilde (bot du serveur, route « post » ; officiers ou
        créateur de l'event commu), sinon webhook enregistré dans les Settings."""
        if channel_id:
            r = self._rh_call("post", channelId=str(channel_id), content=content or "", users=[str(u) for u in user_ids or []],
                              image=image_data_url or "", compId=str(comp_id or ""))
            return {"ok": True} if r.get("ok") else r
        hooks = self._config.get("webhooks") or []
        if not (0 <= webhook_index < len(hooks)):
            return {"ok": False, "error": "Choose a channel (webhook) first."}
        try:
            png = remote.png_from_data_url(image_data_url) if image_data_url else None
            remote.post_webhook(hooks[webhook_index]["url"], content, user_ids, png)
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": str(e)}


def main():
    bridge = Bridge()
    index = os.path.join(BASE_DIR, "web", "index.html")
    # fenêtre sans cadre Windows : la barre du haut de l'interface sert de poignée (classe pywebview-drag-region,
    # seulement sur la cible directe pour que boutons et onglets restent cliquables)
    webview.settings["DRAG_REGION_DIRECT_TARGET_ONLY"] = True
    webview.create_window("Guild Tool", index, js_api=bridge, width=1250, height=800,
                          min_size=(1200, 760), background_color="#1e1f24", frameless=True, easy_drag=False)
    # stockage persistant : garde les préférences d'affichage (onglet, tri) entre deux lancements
    webview.start(http_server=True, debug="--debug" in sys.argv, private_mode=False,
                  storage_path=os.path.join(APP_DIR, "webview"))


if __name__ == "__main__":
    main()
