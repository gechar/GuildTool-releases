"""Guild Tool : données du jeu de chaque joueur gardées sur le serveur, pour la version web sans dossier du jeu.

GuildTool Sync (sync.py, petit exe près de l'horloge) envoie ce dont l'appli a besoin du dossier du jeu dans le
stockage personnel du joueur (« personal/<son id>/game/... », visible par lui seul) : SavedVariables (GuildTool,
RCLootCouncil, RaidPlanner) de chaque compte, dossiers des comptes / serveurs / persos et le .toc de l'addon (version).
La version web en refait une copie locale (dossier /wow) et la relit comme un dossier du jeu.

- manifest.json : {"v": 1, "t": date de l'envoi, "files": {chemin: date de modification en ms}, "dirs": [chemins]}
- un fichier par chemin, compressé (gzip), nommé d'après le chemin : seuls ceux qui ont changé sont renvoyés / relus
"""
import gzip
import hashlib
import json
import os
import shutil
import time

SV_FILES = ("GuildTool.lua", "RCLootCouncil.lua", "RaidPlanner.lua")
TOC = "Interface/AddOns/GuildTool/GuildTool.toc"
MANIFEST = "game/manifest.json"
INDEX = ".gtsync.json"          # copie locale (version web) : {"t": date de l'envoi, "files": {chemin: date}}


def _obj(rel):
    return "game/f/%s.gz" % hashlib.sha1(rel.encode("utf-8")).hexdigest()[:20]


def _listdir(p):
    try:
        return sorted(os.listdir(p))
    except OSError:
        return []


def scan(wow):
    """Ce que l'appli lit du dossier du jeu : {"files": {chemin: date en ms}, "dirs": [chemins]}."""
    files, dirs = {}, []
    root = os.path.join(wow, "WTF", "Account")
    for a in _listdir(root):
        ap = os.path.join(root, a)
        if not os.path.isdir(ap):
            continue
        dirs.append("WTF/Account/" + a)
        for r in _listdir(ap):
            rp = os.path.join(ap, r)
            if not os.path.isdir(rp):
                continue
            if r == "SavedVariables":
                for f in SV_FILES:
                    p = os.path.join(rp, f)
                    if os.path.isfile(p):
                        files["WTF/Account/%s/SavedVariables/%s" % (a, f)] = int(os.path.getmtime(p) * 1000)
            else:
                dirs.extend("WTF/Account/%s/%s/%s" % (a, r, c) for c in _listdir(rp) if os.path.isdir(os.path.join(rp, c)))
    toc = os.path.join(wow, *TOC.split("/"))
    if os.path.isfile(toc):
        files[TOC] = int(os.path.getmtime(toc) * 1000)
    return {"files": files, "dirs": dirs}


def push(cl, wow, sent):
    """GuildTool Sync : envoie ce qui a changé depuis le dernier envoi (sent, gardé par l'appelant).
    Renvoie le nouvel état à garder, None si rien n'a changé."""
    cur = scan(wow)
    mine = sent.get("uid") == cl.user_id
    if mine and sent.get("files") == cur["files"] and sent.get("dirs") == cur["dirs"]:
        return None
    old = sent.get("files") if mine else {}
    for rel, m in cur["files"].items():
        if (old or {}).get(rel) == m:
            continue
        with open(os.path.join(wow, *rel.split("/")), "rb") as f:
            data = f.read()
        cl.personal_upload(_obj(rel), gzip.compress(data, 6), "application/gzip")
    manifest = {"v": 1, "t": int(time.time()), "files": cur["files"], "dirs": cur["dirs"]}
    cl.personal_upload(MANIFEST, json.dumps(manifest).encode("utf-8"), "application/json")
    return {"uid": cl.user_id, "t": manifest["t"], **cur}


def pull(cl, wow):
    """Version web : copie locale du dossier du jeu mise à jour d'après le dernier envoi de GuildTool Sync.
    None si rien n'a jamais été envoyé, sinon {"t": date de l'envoi, "changed": copie modifiée}."""
    raw = cl.personal_download(MANIFEST)
    if raw is None:
        return None
    man = json.loads(raw)
    ip = os.path.join(wow, INDEX)
    try:
        with open(ip, encoding="utf-8") as f:
            index = json.load(f)
    except (OSError, ValueError):
        index = {}
    have = index.get("files") or {}
    if index.get("t") == man["t"] and set(have) == set(man["files"]):
        return {"t": man["t"], "changed": False}
    changed = False
    for d in man["dirs"]:
        os.makedirs(os.path.join(wow, *d.split("/")), exist_ok=True)
    for rel, m in man["files"].items():
        p = os.path.join(wow, *rel.split("/"))
        if have.get(rel) == m and os.path.isfile(p):
            continue
        data = cl.personal_download(_obj(rel))
        if data is None:
            continue
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "wb") as f:
            f.write(gzip.decompress(data))
        os.utime(p, (m / 1000, m / 1000))
        have[rel] = m
        changed = True
    # comptes, persos et fichiers qui n'existent plus dans le dossier du jeu
    keep_files = {os.path.join(wow, *r.split("/")) for r in man["files"]}
    keep_dirs = {os.path.join(wow, *d.split("/")) for d in man["dirs"]}
    keep_dirs |= {os.path.dirname(p) for p in keep_files}
    root = os.path.join(wow, "WTF", "Account")
    for d, subs, names in os.walk(root, topdown=False) if os.path.isdir(root) else []:
        for n in names:
            p = os.path.join(d, n)
            if p not in keep_files:
                os.remove(p)
                changed = True
        for n in subs:
            p = os.path.join(d, n)
            if p not in keep_dirs and not os.listdir(p):
                shutil.rmtree(p, ignore_errors=True)
                changed = True
    for rel in [r for r in have if r not in man["files"]]:
        have.pop(rel)
    with open(ip, "w", encoding="utf-8") as f:
        json.dump({"t": man["t"], "files": have}, f)
    return {"t": man["t"], "changed": changed}
