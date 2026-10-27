"""Guild Tool, version web : l'appli Python de l'exe (app.py, cloud.py, remote.py, luaio.py) tourne telle quelle dans
le navigateur (Pyodide, dans un Web Worker). Ce module remplace ce qui n'existe pas dans un navigateur :

- fenêtre pywebview (module « webview » factice : dialogues de fichiers servis par la page, boutons de fenêtre inactifs)
- réseau : urllib.request.urlopen -> XMLHttpRequest synchrone (permis dans un Worker), sans les en-têtes interdits
- threads : threading.Thread / Timer -> setTimeout (un seul fil d'exécution, les appels sont mis en file)
- session : pas de DPAPI (chiffrement Windows), elle reste dans le stockage du site (IndexedDB)
- connexion Discord : redirection de la page (login_url / finish_login de cloud.py) au lieu du petit serveur local
- dossier du jeu : copie dans /wow (lecture), fichiers de l'addon écrits renvoyés par le Worker (dossier lié ou export)
"""
import email
import io
import json
import os
import sys
import traceback
import types
import urllib.error
import urllib.parse
import urllib.request

import js
from pyodide.ffi import create_proxy, to_js

WOW = "/wow"
os.environ["GUILDTOOL_HOME"] = "/appdata/GuildTool"

# état fourni par le Worker : chemin du fichier choisi dans la page (dialogue), dossier lié en écriture, adresse du site
state = {"dialog": None, "linked": False, "base": ""}


def effect(kind, **data):
    """Action à faire par la page (ouvrir un lien, presse-papier…)."""
    js.gtEffect(kind, json.dumps(data))


# ---------------------------------------------------------------- module « webview » factice
class _Dialog:
    OPEN, FOLDER, SAVE = 10, 20, 30


class _Window:
    def create_file_dialog(self, *a, **k):
        p, state["dialog"] = state["dialog"], None
        return [p] if p else None

    def __getattr__(self, name):          # minimize, maximize, restore, resize, destroy : rien à faire
        return lambda *a, **k: None


_webview = types.ModuleType("webview")
_webview.FileDialog = _Dialog
_webview.OPEN_DIALOG, _webview.FOLDER_DIALOG, _webview.SAVE_DIALOG = _Dialog.OPEN, _Dialog.FOLDER, _Dialog.SAVE
_webview.windows = [_Window()]
_webview.settings = {}
sys.modules["webview"] = _webview

# ctypes : seulement pour le presse-papier et le DPAPI de Windows (jamais appelés ici) ; cloud.py en a besoin à l'import
try:
    import ctypes
except ImportError:
    ctypes = types.ModuleType("ctypes")
    ctypes.Structure = object
    ctypes.POINTER = lambda t: t
    ctypes.c_char = ctypes.c_void_p = ctypes.c_uint = None
    sys.modules["ctypes"] = ctypes
try:
    import ctypes.wintypes   # noqa: F401
except Exception:
    _wt = types.ModuleType("ctypes.wintypes")
    _wt.DWORD = getattr(ctypes, "c_uint32", None)
    sys.modules["ctypes.wintypes"] = _wt
    ctypes.wintypes = _wt


# ---------------------------------------------------------------- réseau
# en-têtes que le navigateur gère seul (User-Agent ajouterait une requête de contrôle CORS refusée par certains sites)
_FORBIDDEN = {"user-agent", "content-length", "host", "connection", "accept-encoding", "origin", "referer", "cookie"}


class _Response(io.BytesIO):
    def __init__(self, data, status, url, headers):
        super().__init__(data)
        self.status = self.code = status
        self.url, self.headers = url, headers

    def getcode(self):
        return self.status

    def info(self):
        return self.headers


def _headers(raw):
    return email.message_from_string(str(raw or "").replace("\r\n", "\n"))


def urlopen(req, data=None, timeout=None, **kw):
    if isinstance(req, str):
        req = urllib.request.Request(req, data=data)
    body = req.data if req.data is not None else data
    url = req.full_url
    xhr = js.XMLHttpRequest.new()
    xhr.open(req.get_method(), url, False)
    xhr.responseType = "arraybuffer"
    for k, v in req.header_items():
        if k.lower() not in _FORBIDDEN:
            xhr.setRequestHeader(k, v)
    host = urllib.parse.urlparse(url).netloc
    try:
        xhr.send(to_js(bytes(body)) if body is not None else None)
    except Exception:
        raise urllib.error.URLError("%s could not be reached from the browser (offline, or the site refuses web apps)" % host)
    if not xhr.status:
        raise urllib.error.URLError("%s could not be reached from the browser (offline, or the site refuses web apps)" % host)
    raw = js.Uint8Array.new(xhr.response).to_bytes() if xhr.response else b""
    hdrs = _headers(xhr.getAllResponseHeaders())
    if xhr.status >= 400:
        raise urllib.error.HTTPError(url, xhr.status, xhr.statusText, hdrs, io.BytesIO(raw))
    return _Response(raw, xhr.status, xhr.responseURL or url, hdrs)


urllib.request.urlopen = urlopen


# ---------------------------------------------------------------- threads -> setTimeout
def later(fn, delay=0):
    def run():
        try:
            fn()
        except Exception:
            traceback.print_exc()
        finally:
            proxy.destroy()
    proxy = create_proxy(run)
    return js.setTimeout(proxy, int(max(0, delay) * 1000))


import threading   # noqa: E402


def _thread_start(self):
    later(self.run)


threading.Thread.start = _thread_start


class _Timer:
    def __init__(self, interval, function, args=None, kwargs=None):
        self.interval, self.function = interval, function
        self.args, self.kwargs = args or (), kwargs or {}
        self.daemon, self._id, self._off = True, None, False

    def _fire(self):
        if not self._off:
            self.function(*self.args, **self.kwargs)

    def start(self):
        self._id = later(self._fire, self.interval)

    def cancel(self):
        self._off = True
        if self._id is not None:
            js.clearTimeout(self._id)


threading.Timer = _Timer

import webbrowser   # noqa: E402

webbrowser.open = lambda url, *a, **k: effect("open", url=str(url)) or True

# ---------------------------------------------------------------- l'appli
sys.path.insert(0, "/app")
import cloud    # noqa: E402
import remote   # noqa: E402
import app      # noqa: E402

cloud._dpapi = lambda data, encrypt: bytes(data)
cloud.Cloud.latest_version = lambda self: None          # le site est toujours à jour : pas de mise à jour d'exe
app._guess_wow_path = lambda: WOW
app._set_clipboard = lambda text: effect("clipboard", text=str(text))
B = app.Bridge


def _rh_events_local(self, api_key, server, known):
    raise remote.RemoteError("Raid-Helper refuses requests from web apps: the guild Raid-Helper key (Settings > Admin, "
                             "kept by the guild server) is needed in the web version.")


B._rh_events_local = _rh_events_local
B.check_update = lambda self: None
B.self_update = lambda self: {"ok": False, "error": "The web version is always up to date: reload the page."}
for _name in ("win_minimize", "win_toggle_max", "win_resize"):
    setattr(B, _name, lambda self, *a: False)
B.win_close = lambda self: self._presence(out=True)
_update_addon = B.update_addon


def update_addon(self):
    """Dossier lié (écriture permise) : addon installé / mis à jour depuis le site (même version que l'appli)."""
    if not state["linked"]:
        return {"ok": True, "skip": "web"}
    app.ADDON_ZIP_URL = state["base"] + "addon/GuildTool.zip?v=%s"
    sys.frozen = True
    try:
        return _update_addon(self)
    finally:
        del sys.frozen


B.update_addon = update_addon


def web_login_start(self, redirect):
    url, verifier = self._cloud.login_url(redirect)
    return {"url": url, "verifier": verifier}


def web_login_finish(self, code, verifier):
    try:
        self._cloud.finish_login(code, verifier)
        return {"ok": True, "cloud": self._cloud.public_state()}
    except Exception as e:
        traceback.print_exc()
        return {"ok": False, "error": str(e)}


def web_remount(self):
    """Dossier du jeu relu (lié de nouveau ou importé) : SavedVariables relues au prochain appel."""
    with self._lock:
        self._config["wowPath"] = WOW
        if not self._config.get("account"):                 # comme au lancement de l'exe : compte le plus récent
            self._config["account"] = self._guess_account()
        app._save(app.CONFIG_PATH, self._config)
        self._sv_mtime = 0
        self._rclc_mtime = 0
    return True


B.web_login_start = web_login_start
B.web_login_finish = web_login_finish
B.web_remount = web_remount

bridge = None


def boot():
    global bridge
    bridge = B()
    if bridge._config.get("wowPath") != WOW:          # config d'une ancienne session : chemin du site
        bridge._config["wowPath"] = WOW
        app._save(app.CONFIG_PATH, bridge._config)


def call(name, args_json):
    """Appel venu de la page (window.pywebview.api.<name>) -> réponse JSON, comme pywebview."""
    fn = getattr(bridge, name, None) if not name.startswith("_") else None
    if not callable(fn):
        raise AttributeError("Unknown function: %s" % name)
    return json.dumps(fn(*json.loads(args_json)), ensure_ascii=False, default=str)


def set_dialog(path):
    state["dialog"] = path or None


def make_zip(paths_json, out):
    """Fichiers de l'addon à recopier (version importée) : zip dont la racine est le dossier GuildTool."""
    import zipfile
    root = os.path.join(WOW, "Interface", "AddOns", "GuildTool")
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for rel in json.loads(paths_json):
            p = os.path.join(root, rel)
            if os.path.isfile(p):
                z.write(p, "GuildTool/" + rel)
    return out
