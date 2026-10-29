"""Guild Tool : compte Discord et données partagées de la guilde (Supabase).

- Login : Supabase Auth avec le fournisseur Discord (PKCE). La page officielle de Discord s'ouvre dans le navigateur
  (l'exe ne voit jamais le mot de passe) ; le code revient sur http://127.0.0.1:53134/callback.
- Session (jetons Supabase et jeton Discord) chiffrée par Windows (DPAPI) dans APP_DIR/session.bin.
- Données de guilde : tables docs / chars (REST), fichiers dans le stockage « guild/<serveur>/... » ; seuls les officiers
  écrivent (règles de la base). Envois et réceptions incrémentaux : seulement ce qui a changé depuis la dernière synchro.
"""
import base64
import ctypes
import ctypes.wintypes
import hashlib
import http.server
import json
import os
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser

PORT = 53134
REDIRECT = "http://127.0.0.1:%d/callback" % PORT
SCOPES = "identify guilds guilds.members.read"
DISCORD = "https://discord.com/api/v10"
UA = "GuildTool/2.0"
# versions de l'exe : dépôt GitHub PUBLIC (téléchargements gratuits, ne comptent pas dans la data de Supabase) ;
# le dossier public « releases » de Supabase reste un secours (et sert aux exe d'avant la 2.25.2)
GITHUB_RELEASES = "https://github.com/gechar/GuildTool-releases/releases/latest/download"


class CloudError(Exception):
    pass


# ---------------------------------------------------------------- chiffrement Windows (DPAPI)
class _Blob(ctypes.Structure):
    _fields_ = [("cbData", ctypes.wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]


def _dpapi(data, encrypt):
    buf = ctypes.create_string_buffer(data, len(data))
    src = _Blob(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char)))
    out = _Blob()
    fn = ctypes.windll.crypt32.CryptProtectData if encrypt else ctypes.windll.crypt32.CryptUnprotectData
    if not fn(ctypes.byref(src), None, None, None, None, 0, ctypes.byref(out)):
        raise CloudError("Windows could not %s the session" % ("protect" if encrypt else "read"))
    try:
        return ctypes.string_at(out.pbData, out.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(out.pbData)


# ---------------------------------------------------------------- HTTP
def _http(url, body=None, headers=None, method=None, raw=None, timeout=30, binary=False):
    h = {"User-Agent": UA, **(headers or {})}
    data = raw
    if body is not None:
        data = json.dumps(body).encode()
        h["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            content = r.read()
            if binary:
                return content
            return json.loads(content) if content else None
    except urllib.error.HTTPError as e:
        text = e.read().decode("utf-8", "replace")
        try:
            j = json.loads(text)
            msg = j.get("error_description") or j.get("error") or j.get("message") or j.get("msg") if isinstance(j, dict) else j
        except ValueError:
            msg = text[:200]
        raise CloudError(str(msg or "HTTP %s" % e.code))
    except urllib.error.URLError as e:
        raise CloudError("Network error: %s" % e.reason)


class Cloud:
    def __init__(self, app_dir, base_dir):
        self.app_dir = app_dir
        self.conf = {}
        for d in (base_dir, app_dir):          # cloud.json fourni avec l'exe, sinon dans APP_DIR
            p = os.path.join(d, "cloud.json")
            if os.path.exists(p):
                with open(p, encoding="utf-8") as f:
                    self.conf.update(json.load(f))
        self.session = self._load()

    # ---------------------------------------------------------- état
    @property
    def configured(self):
        return bool(self.conf.get("url") and self.conf.get("anonKey"))

    @property
    def logged(self):
        return bool(self.session.get("refresh"))

    @property
    def guild_id(self):
        return (self.session.get("guild") or {}).get("id")

    @property
    def officer(self):
        return bool((self.session.get("member") or {}).get("officer"))

    @property
    def full_officer(self):
        """Officier par le rôle officier du serveur Discord ou admin du serveur ; pas un officier temporaire (droits
        donnés par un officier : contenu de l'appli seulement, pas les réglages de la guilde)."""
        m = self.session.get("member") or {}
        if m.get("admin"):
            return True
        role = (self.session.get("guild") or {}).get("officer_role")
        return bool(m.get("officer") and role and any(isinstance(r, dict) and r.get("id") == role for r in m.get("roles") or []))

    @property
    def user_id(self):
        return (self.session.get("user") or {}).get("uid")

    def public_state(self):
        s = self.session
        return {"configured": self.configured, "logged": self.logged, "user": s.get("user"),
                "guilds": s.get("guilds") or [], "guild": s.get("guild"), "member": s.get("member"),
                "discordExpired": self.logged and time.time() > s.get("discordExp", 0)}

    # ---------------------------------------------------------- session chiffrée
    def _path(self):
        return os.path.join(self.app_dir, "session.bin")

    def _load(self):
        try:
            with open(self._path(), "rb") as f:
                return json.loads(_dpapi(f.read(), False).decode())
        except Exception:
            return {}

    def save(self):
        os.makedirs(self.app_dir, exist_ok=True)
        with open(self._path(), "wb") as f:
            f.write(_dpapi(json.dumps(self.session).encode(), True))

    def logout(self):
        self.session = {}
        try:
            os.remove(self._path())
        except OSError:
            pass

    # ---------------------------------------------------------- login Discord (Supabase Auth, PKCE)
    def _auth(self, path, body):
        return _http("%s/auth/v1/%s" % (self.conf["url"], path), body, {"apikey": self.conf["anonKey"]})

    def login_url(self, redirect=REDIRECT):
        """Page de connexion Discord (Supabase, PKCE) -> (adresse, vérificateur à rendre à finish_login)."""
        if not self.configured:
            raise CloudError("Cloud not configured yet (cloud.json missing).")
        verifier = secrets.token_urlsafe(64)
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
        return "%s/auth/v1/authorize?%s" % (self.conf["url"], urllib.parse.urlencode({
            "provider": "discord", "redirect_to": redirect, "scopes": SCOPES,
            "code_challenge": challenge, "code_challenge_method": "s256"})), verifier

    def login(self, timeout=180):
        url, verifier = self.login_url()
        result = {}

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                if "code" in q:
                    result["code"] = q["code"][0]
                elif "error" in q:
                    result["error"] = q.get("error_description", q["error"])[0]
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.end_headers()
                msg = "Guild Tool: you are logged in, you can close this tab." if "code" in result else "Guild Tool: login cancelled."
                self.wfile.write(("<html><body style='font:16px Segoe UI;background:#1e1f24;color:#ecedf1;padding:40px'>%s</body></html>" % msg).encode())

            def log_message(self, *a):
                pass

        try:
            srv = http.server.HTTPServer(("127.0.0.1", PORT), Handler)
        except OSError:
            raise CloudError("Port %d is busy: close the other Guild Tool window and try again." % PORT)
        srv.timeout = 1
        webbrowser.open(url)
        end = time.time() + timeout
        try:
            while time.time() < end and not result:
                srv.handle_request()
        finally:
            srv.server_close()
        if "code" not in result:
            raise CloudError("Discord login: %s" % result.get("error", "timed out"))
        return self.finish_login(result["code"], verifier)

    def finish_login(self, code, verifier):
        """Code renvoyé par Discord (Supabase) -> session, compte Discord, serveurs, serveur de guilde par défaut."""
        tok = self._auth("token?grant_type=pkce", {"auth_code": code, "code_verifier": verifier})
        if not tok.get("provider_token"):
            raise CloudError("Discord did not return its token: check the Discord provider in Supabase.")
        self._apply_tokens(tok)
        self.session["discordToken"] = tok["provider_token"]
        self.session["discordExp"] = time.time() + 6 * 86400
        u = tok.get("user") or {}
        meta = u.get("user_metadata") or {}
        me = _http(DISCORD + "/users/@me", headers={"Authorization": "Bearer " + tok["provider_token"]})
        self.session["user"] = {"uid": u.get("id"), "id": me["id"], "username": me["username"],
                                "globalName": me.get("global_name") or meta.get("full_name"), "avatar": me.get("avatar")}
        self.refresh_guilds(save=False)
        self.save()
        # serveur de guilde par défaut (cloud.json « defaultGuild ») si l'utilisateur en est membre
        default = str(self.conf.get("defaultGuild") or "")
        if not self.guild_id and default and any(g["id"] == default for g in self.session.get("guilds") or []):
            try:
                self.select_guild(default)
            except CloudError:
                pass
        return self.public_state()

    def _apply_tokens(self, tok):
        self.session.update({"access": tok["access_token"], "refresh": tok["refresh_token"],
                             "exp": time.time() + int(tok.get("expires_in", 3600)) - 120})

    def access(self):
        if not self.logged:
            raise CloudError("Not logged in.")
        if time.time() > self.session.get("exp", 0):
            self._apply_tokens(self._auth("token?grant_type=refresh_token", {"refresh_token": self.session["refresh"]}))
            self.save()
        return self.session["access"]

    def _discord(self):
        if time.time() > self.session.get("discordExp", 0):
            raise CloudError("Discord session expired: log out and log in again to change server.")
        return self.session["discordToken"]

    def refresh_guilds(self, save=True):
        """Serveurs Discord de l'utilisateur (admin = propriétaire, Administrateur ou Gérer le serveur)."""
        guilds = _http(DISCORD + "/users/@me/guilds", headers={"Authorization": "Bearer " + self._discord()})
        self.session["guilds"] = [{"id": g["id"], "name": g["name"], "icon": g.get("icon"),
                                   "admin": bool(g.get("owner")) or bool(int(g.get("permissions") or 0) & 0x28)} for g in guilds]
        if save:
            self.save()

    # ---------------------------------------------------------- fonction serveur
    def api(self, route, timeout=60, **body):
        return _http("%s/functions/v1/api" % self.conf["url"], {"route": route, **body},
                     {"apikey": self.conf["anonKey"], "Authorization": "Bearer " + self.access()}, timeout=timeout)

    def select_guild(self, guild_id):
        r = self.api("join", guildId=str(guild_id), discordToken=self._discord())
        self.session["guild"], self.session["member"] = r["guild"], r["member"]
        self.save()
        return self.public_state()

    def rejoin(self):
        """Rôles et droits à jour (au Sync), tant que le jeton Discord est valide."""
        if self.guild_id and time.time() < self.session.get("discordExp", 0):
            try:
                self.select_guild(self.guild_id)
            except CloudError:
                pass

    def guild_update(self, r):
        self.session["guild"] = r["guild"]
        self.save()
        return self.public_state()

    # ---------------------------------------------------------- tables (REST)
    def _rest(self, path, body=None, method=None, prefer=None):
        h = {"apikey": self.conf["anonKey"], "Authorization": "Bearer " + self.access()}
        if prefer:
            h["Prefer"] = prefer
        return _http("%s/rest/v1/%s" % (self.conf["url"], path), body, h, method=method)

    def pull_docs(self, since):
        rows = self._rest("docs?select=id,t,data&guild_id=eq.%s&t=gt.%d" % (self.guild_id, int(since))) or []
        return {r["id"]: (int(r["t"]), r["data"]) for r in rows}

    def get_doc(self, doc_id):
        """Un doc tel qu'il est sur le serveur maintenant : (t, data), (0, None) s'il n'existe pas."""
        rows = self._rest("docs?select=t,data&guild_id=eq.%s&id=eq.%s" % (self.guild_id, urllib.parse.quote(doc_id))) or []
        return (int(rows[0]["t"]), rows[0]["data"]) if rows else (0, None)

    def push_docs(self, docs):
        rows = [{"guild_id": self.guild_id, "id": k, "t": int(t), "data": v} for k, (t, v) in docs.items()]
        for i in range(0, len(rows), 200):
            self._rest("docs", rows[i:i + 200], prefer="resolution=merge-duplicates,return=minimal")

    def pull_chars(self, since):
        return self._rest("chars?select=name,discord_id,data,t&guild_id=eq.%s&t=gt.%d" % (self.guild_id, int(since))) or []

    def push_chars(self, chars, hidden):
        """Mes persos partagés (upsert) ; les persos cachés sont retirés du serveur."""
        if chars:
            rows = [{"guild_id": self.guild_id, "name": n, "owner": self.user_id, "discord_id": (self.session.get("user") or {}).get("id"),
                     "data": d, "t": int(time.time())} for n, d in chars.items()]
            self._rest("chars", rows, prefer="resolution=merge-duplicates,return=minimal")
        if hidden:
            names = ",".join('"%s"' % n.replace('"', "") for n in hidden)
            self._rest("chars?guild_id=eq.%s&owner=eq.%s&name=in.(%s)" % (self.guild_id, self.user_id, urllib.parse.quote(names)),
                       method="DELETE")

    def members(self):
        rows = self._rest("members?select=discord_id,username,name,nick,admin,officer,roles&guild_id=eq.%s" % self.guild_id) or []
        # droits retirés : ligne gardée (revoked) avec sa date, pour écarter les demandes plus anciennes
        grants = self._rest("grants?select=*&guild_id=eq.%s" % self.guild_id) or []
        granted = {g["discord_id"]: g for g in grants if not g.get("revoked")}
        for r in rows:
            r["granted"] = r["discord_id"] in granted
            r["grantT"] = int((granted.get(r["discord_id"]) or {}).get("t") or 0)
        return rows

    # ---------------------------------------------------------- fichiers (stockage « guild/<serveur>/... »)
    def list_files(self):
        """{chemin relatif: date de modification} des fichiers de la guilde."""
        out = {}
        for folder in ("assign", "raids", "app", "chars"):
            rows = _http("%s/storage/v1/object/list/guild" % self.conf["url"],
                         {"prefix": "%s/%s/" % (self.guild_id, folder), "limit": 1000, "offset": 0},
                         {"apikey": self.conf["anonKey"], "Authorization": "Bearer " + self.access()}) or []
            for r in rows:
                if r.get("id"):
                    out["%s/%s" % (folder, r["name"])] = r.get("updated_at") or r.get("created_at") or ""
        return out

    def download(self, rel):
        return _http("%s/storage/v1/object/authenticated/guild/%s/%s" % (self.conf["url"], self.guild_id, urllib.parse.quote(rel)),
                     headers={"apikey": self.conf["anonKey"], "Authorization": "Bearer " + self.access()}, binary=True, timeout=120)

    def auth_uid(self):
        """Identifiant Supabase (sub du jeton) du compte connecté, sans tirets : préfixe des images de mes persos."""
        try:
            part = self.access().split(".")[1]
            part += "=" * (-len(part) % 4)
            return json.loads(base64.urlsafe_b64decode(part)).get("sub", "").replace("-", "")
        except Exception:
            return None

    def delete_file(self, rel):
        _http("%s/storage/v1/object/guild" % self.conf["url"], {"prefixes": ["%s/%s" % (self.guild_id, rel)]},
              {"apikey": self.conf["anonKey"], "Authorization": "Bearer " + self.access()}, method="DELETE")

    def upload(self, rel, data):
        _http("%s/storage/v1/object/guild/%s/%s" % (self.conf["url"], self.guild_id, urllib.parse.quote(rel)), raw=data,
              headers={"apikey": self.conf["anonKey"], "Authorization": "Bearer " + self.access(),
                       "Content-Type": "image/jpeg", "x-upsert": "true"}, method="POST", timeout=120)

    # ---------------------------------------------------------- fichiers personnels (« personal/<mon id>/... »)
    # visibles par moi seul (règles du stockage) : SavedVariables envoyées par GuildTool Sync, lues par la version web
    def _personal(self, rel, kind=""):
        return "%s/storage/v1/object/%spersonal/%s/%s" % (self.conf["url"], kind, self.user_id, urllib.parse.quote(rel))

    def personal_upload(self, rel, data, ctype="application/octet-stream"):
        _http(self._personal(rel), raw=data, method="POST", timeout=120,
              headers={"apikey": self.conf["anonKey"], "Authorization": "Bearer " + self.access(),
                       "Content-Type": ctype, "x-upsert": "true"})

    def personal_download(self, rel):
        """Contenu du fichier, None s'il n'existe pas."""
        try:
            return _http(self._personal(rel, "authenticated/") + "?t=%d" % time.time(), binary=True, timeout=120,
                         headers={"apikey": self.conf["anonKey"], "Authorization": "Bearer " + self.access()})
        except CloudError as e:
            if "not found" in str(e).lower().replace("_", " "):
                return None
            raise

    # ---------------------------------------------------------- mise à jour de l'exe
    def releases_url(self, name, base=None):
        base = base or self.conf.get("releases") or GITHUB_RELEASES
        if base == "supabase":
            base = "%s/storage/v1/object/public/releases" % self.conf.get("url", "")
        return "%s/%s" % (base.rstrip("/"), name)

    def latest_version(self):
        """version.json de la dernière version (GitHub, sinon Supabase) ; « _url » = lien de l'exe au même endroit."""
        if not self.configured:
            return None
        for base in (None, "supabase"):
            try:
                v = _http(self.releases_url("version.json", base), timeout=10)
            except CloudError:
                continue
            if isinstance(v, dict) and v.get("version"):
                v["_url"] = self.releases_url(v.get("file") or "GuildTool.exe", base)
                return v
        return None
