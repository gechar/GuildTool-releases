"""Accès internet : API Raid-Helper (v4), utilisateurs Discord (bot optionnel), webhooks Discord."""
import base64
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

RH_BASE = "https://raid-helper.dev/api/v4"
DISCORD_API = "https://discord.com/api/v10"
UA = "GuildTool/1.0"

# Spé Raid-Helper -> (classe WoW, spé affichée, rôle). Le template Classic suffixe certaines spés d'un chiffre.
RH_SPEC = {
    "Protection": ("WARRIOR", "Protection", "Tank"), "Protection1": ("PALADIN", "Protection", "Tank"),
    "Guardian": ("DRUID", "Guardian", "Tank"),
    "Arms": ("WARRIOR", "Arms", "Melee"), "Fury": ("WARRIOR", "Fury", "Melee"),
    "Holy1": ("PALADIN", "Holy", "Healer"), "Retribution": ("PALADIN", "Retribution", "Melee"),
    "Holy": ("PRIEST", "Holy", "Healer"), "Discipline": ("PRIEST", "Discipline", "Healer"),
    "Shadow": ("PRIEST", "Shadow", "Ranged"), "Smite": ("PRIEST", "Smite", "Ranged"),
    "Restoration": ("DRUID", "Restoration", "Healer"), "Dreamstate": ("DRUID", "Dreamstate", "Healer"),
    "Balance": ("DRUID", "Balance", "Ranged"), "Feral": ("DRUID", "Feral", "Melee"),
    "Restoration1": ("SHAMAN", "Restoration", "Healer"), "Elemental": ("SHAMAN", "Elemental", "Ranged"),
    "Enhancement": ("SHAMAN", "Enhancement", "Melee"),
    "Assassination": ("ROGUE", "Assassination", "Melee"), "Combat": ("ROGUE", "Combat", "Melee"),
    "Subtlety": ("ROGUE", "Subtlety", "Melee"),
    "Beastmastery": ("HUNTER", "Beastmastery", "Ranged"), "Marksmanship": ("HUNTER", "Marksmanship", "Ranged"),
    "Survival": ("HUNTER", "Survival", "Ranged"),
    "Arcane": ("MAGE", "Arcane", "Ranged"), "Fire": ("MAGE", "Fire", "Ranged"), "Frost": ("MAGE", "Frost", "Ranged"),
    "Affliction": ("WARLOCK", "Affliction", "Ranged"), "Demonology": ("WARLOCK", "Demonology", "Ranged"),
    "Destruction": ("WARLOCK", "Destruction", "Ranged"),
}
def rh_specs_by_class():
    """Spés Raid-Helper par classe : {"DRUID": ["Balance", "Feral", "Guardian", "Restoration"], …}."""
    out = {}
    for name, (cls, _spec, _role) in RH_SPEC.items():
        out.setdefault(cls, []).append(name)
    return {k: sorted(v) for k, v in out.items()}


CLASSES = {"WARRIOR", "PALADIN", "DRUID", "PRIEST", "SHAMAN", "ROGUE", "HUNTER", "MAGE", "WARLOCK"}
STATUS_CLASSES = {"Late": "late", "Bench": "bench", "Tentative": "tentative", "Absence": "absence"}


class RemoteError(Exception):
    pass


def _request(url, headers=None, data=None, method=None, timeout=20):
    req = urllib.request.Request(url, data=data, method=method, headers={"User-Agent": UA, **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read()
            return json.loads(body) if body else None
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:300]
        raise RemoteError("HTTP %s on %s: %s" % (e.code, url.split("?")[0], detail))
    except urllib.error.URLError as e:
        raise RemoteError("Network error: %s" % e.reason)


# ---------------------------------------------------------------- Raid-Helper
def rh_events(api_key, server_id):
    """Liste des events postés sur le serveur (toutes les pages)."""
    events, page, pages = [], 1, 1
    while page <= pages:
        data = _request("%s/servers/%s/events?page=%d" % (RH_BASE, server_id, page), {"Authorization": api_key})
        events += data.get("postedEvents") or []
        pages = int(data.get("pages") or 1)
        page += 1
    return events


def rh_event(api_key, event_id):
    return _request("%s/events/%s" % (RH_BASE, event_id), {"Authorization": api_key})


RH_FETCH_MAX = 30


def rh_events_paced(api_key, ids, max_n=RH_FETCH_MAX):
    """Détail de plusieurs events sans dépasser le quota « event1 » (20 / 5 s, 100 / min par clé) : au plus 15 par 5 s
    et max_n par appel ; 429 : une attente (si courte) puis un nouvel essai. -> (events, ids pas encore relus)."""
    got, stamps, i = [], [], 0
    while i < len(ids) and len(got) < max_n:
        stamps = [t for t in stamps if time.time() - t <= 5]
        if len(stamps) >= 15:
            time.sleep(max(0, 5.1 - (time.time() - stamps[0])))
        stamps.append(time.time())
        try:
            got.append(rh_event(api_key, ids[i]))
        except RemoteError as e:
            msg = str(e)
            if "HTTP 404" in msg:                     # supprimé entre la liste et le détail
                i += 1
                continue
            if "HTTP 429" not in msg:
                raise
            m = re.search(r"Try again in (\d+)", msg)
            wait = int(m.group(1)) if m else 99
            if wait > 8:
                break
            time.sleep(wait + 1)
            try:
                got.append(rh_event(api_key, ids[i]))
            except RemoteError:
                break
        i += 1
    return got, ids[i:]


def normalize_signup(s):
    """Inscription Raid-Helper -> {uid, n, c, s, r, st}."""
    cls_name = s.get("className") or ""
    spec_name = s.get("specName") or ""
    status = STATUS_CLASSES.get(cls_name)
    if not status:
        st = (s.get("status") or "primary").lower()
        status = st if st in ("primary", "late", "bench", "tentative", "absence") else "primary"
    mapped = RH_SPEC.get(spec_name)
    real_class = cls_name.upper() if cls_name.upper() in CLASSES else None
    if mapped:
        cls, spec, role = mapped
        if real_class and real_class != cls:
            # même nom de spé, autre classe (ex. Holy paladin sur un autre template)
            cls, spec = real_class, spec_name.rstrip("0123456789")
            role = mapped[2]
    else:
        cls, spec, role = real_class, spec_name.rstrip("0123456789") or None, None
    return {
        "uid": str(s.get("userId") or ""), "n": s.get("name") or "?", "c": cls, "s": spec, "r": role,
        "rc": cls_name or None, "rs": spec_name or None,          # noms Raid-Helper exacts (pour s'inscrire pareil)
        "st": status, "pos": s.get("position") or 0, "id": s.get("id"),
    }


def status_emotes(e):
    """Emojis Raid-Helper des statuts du template : {"late"|"tentative"|"absence"|"bench": emoteId}."""
    out = {}
    for cls in e.get("classes") or []:
        name = (cls.get("name") or "").lower()
        if name in ("late", "tentative", "absence", "bench") and cls.get("emoteId"):
            out[name] = str(cls["emoteId"])
    return out


# Pouce levé (« s'inscrire ») : emoji Twemoji, celui que Discord affiche
THUMBSUP_URL = "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f44d.png"


def fetch_url(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=15) as r:
        return r.read()


def spec_emotes(e):
    """Icônes de spé du template de l'event : {"CLASSE:Spé": emoteId}."""
    out = {}
    for cls in e.get("classes") or []:
        for sp in cls.get("specs") or []:
            mapped = RH_SPEC.get(sp.get("name") or "")
            if mapped and sp.get("emoteId"):
                out.setdefault("%s:%s" % (mapped[0], mapped[1]), str(sp["emoteId"]))
    return out


def fetch_emoji(emote_id):
    req = urllib.request.Request("https://cdn.discordapp.com/emojis/%s.png?size=64" % emote_id, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read()


def _wowhead(kind, ident):
    """Tooltip Wowhead : base WoW Forever d'abord (objets propres à Forever), Classic sinon."""
    err = None
    for env in ("forever", "classic"):
        try:
            data = _request("https://nether.wowhead.com/%s/tooltip/%s/%d" % (env, kind, int(ident)), timeout=10)
            if data and data.get("name"):
                return data
        except Exception as e:
            err = e
    if err:
        raise err
    return {}


def wowhead_item(item_id):
    """{n, q, icon, l: niveau d'objet, tt: infobulle HTML (niveau, stats, effets)}."""
    data = _wowhead("item", item_id)
    tt = data.get("tooltip") or ""
    m = re.search(r"<!--ilvl-->(\d+)", tt)
    return {"n": data.get("name"), "q": data.get("quality"), "icon": data.get("icon"),
            "l": int(m.group(1)) if m else None, "tt": tt}


def wowhead_spell(spell_id):
    """{n, icon, tt} d'un sort (talents)."""
    data = _wowhead("spell", spell_id)
    return {"n": data.get("name"), "icon": data.get("icon"), "tt": data.get("tooltip") or ""}


def normalize_event(e):
    signups = [normalize_signup(s) for s in (e.get("signUps") or [])]
    signups.sort(key=lambda s: s["pos"])
    return {
        "id": str(e.get("id")), "title": e.get("displayTitle") or e.get("title") or "Event",
        "start": int(e.get("startTime") or 0), "channel": e.get("channelName") or "", "chId": str(e.get("channelId") or ""),
        "leader": e.get("leaderName") or "", "lid": str(e.get("leaderId") or ""), "signups": signups, "desc": e.get("description") or "",
    }


# ---------------------------------------------------------------- Discord
def discord_username(bot_token, uid):
    """Pseudo Discord unique d'un utilisateur (nécessite un token de bot, sans invitation)."""
    data = _request("%s/users/%s" % (DISCORD_API, uid), {"Authorization": "Bot " + bot_token})
    return (data or {}).get("username")


def post_webhook(url, content, user_ids, image_png=None, filename="comp.png"):
    """Message dans un salon via webhook : texte + mentions qui notifient + image optionnelle."""
    payload = {
        "content": content[:2000],
        "allowed_mentions": {"parse": [], "users": list(dict.fromkeys(user_ids))[:100]},
    }
    sep = "&" if "?" in url else "?"
    url = url + sep + "wait=true"
    if image_png is None:
        return _request(url, {"Content-Type": "application/json"}, json.dumps(payload).encode(), "POST")
    payload["attachments"] = [{"id": 0, "filename": filename}]
    boundary = uuid.uuid4().hex
    parts = [
        ("--%s\r\nContent-Disposition: form-data; name=\"payload_json\"\r\nContent-Type: application/json\r\n\r\n" % boundary).encode()
        + json.dumps(payload).encode() + b"\r\n",
        ("--%s\r\nContent-Disposition: form-data; name=\"files[0]\"; filename=\"%s\"\r\nContent-Type: image/png\r\n\r\n" % (boundary, filename)).encode()
        + image_png + b"\r\n",
        ("--%s--\r\n" % boundary).encode(),
    ]
    return _request(url, {"Content-Type": "multipart/form-data; boundary=" + boundary}, b"".join(parts), "POST", timeout=40)


def check_webhook(url):
    data = _request(url)
    return {"name": data.get("name"), "channel_id": data.get("channel_id")}


def png_from_data_url(data_url):
    return base64.b64decode(data_url.split(",", 1)[1])


def now():
    return int(time.time())
