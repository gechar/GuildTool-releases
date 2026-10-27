"""Lecture des SavedVariables WoW et écriture de fichiers Lua (Import.lua)."""
import re

_TOKEN = re.compile(r"""
    (?P<ws>\s+)
  | (?P<comment>--[^\n]*)
  | (?P<str>"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')
  | (?P<num>-?(?:0x[0-9a-fA-F]+|\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+(?:[eE][-+]?\d+)?))
  | (?P<name>[A-Za-z_][A-Za-z0-9_]*)
  | (?P<sym>[{}\[\]=,;])
""", re.VERBOSE | re.DOTALL)

_ESC = {"n": "\n", "t": "\t", "r": "\r", "\\": "\\", '"': '"', "'": "'", "\n": "\n", "a": "\a", "b": "\b", "f": "\f", "v": "\v"}


def _unescape(body):
    out = bytearray()
    i = 0
    raw = body.encode("utf-8", "surrogatepass")
    while i < len(raw):
        c = raw[i]
        if c == 0x5C and i + 1 < len(raw):  # backslash
            n = chr(raw[i + 1])
            if n.isdigit():
                j = i + 1
                while j < len(raw) and j < i + 4 and chr(raw[j]).isdigit():
                    j += 1
                out.append(int(raw[i + 1:j]) & 0xFF)
                i = j
                continue
            out += _ESC.get(n, n).encode("utf-8")
            i += 2
            continue
        out.append(c)
        i += 1
    return out.decode("utf-8", "replace")


def _tokens(src):
    pos = 0
    for m in _TOKEN.finditer(src):
        if m.start() != pos:
            raise ValueError("Lua parse error near: %r" % src[pos:pos + 30])
        pos = m.end()
        kind = m.lastgroup
        if kind in ("ws", "comment"):
            continue
        yield kind, m.group(kind)
    if pos != len(src):
        raise ValueError("Lua parse error near: %r" % src[pos:pos + 30])


class _Parser:
    def __init__(self, src):
        self.toks = list(_tokens(src))
        self.i = 0

    def peek(self):
        return self.toks[self.i] if self.i < len(self.toks) else (None, None)

    def take(self, value=None):
        tok = self.peek()
        if value is not None and tok[1] != value:
            raise ValueError("expected %r, got %r" % (value, tok[1]))
        self.i += 1
        return tok

    def value(self):
        kind, v = self.take()
        if kind == "str":
            return _unescape(v[1:-1])
        if kind == "num":
            if v.lower().startswith(("0x", "-0x")):
                return int(v, 16)
            f = float(v)
            return int(f) if f.is_integer() and "." not in v and "e" not in v.lower() else f
        if kind == "name":
            return {"true": True, "false": False, "nil": None}.get(v, v)
        if v == "{":
            return self.table()
        raise ValueError("unexpected %r" % v)

    def table(self):
        arr, hsh, n = [], {}, 0
        while self.peek()[1] != "}":
            kind, v = self.peek()
            if v == "[":
                self.take()
                key = self.value()
                self.take("]")
                self.take("=")
                hsh[key] = self.value()
            elif kind == "name" and self.toks[self.i + 1][1] == "=":
                self.take()
                self.take("=")
                hsh[v] = self.value()
            else:
                n += 1
                arr.append(self.value())
            if self.peek()[1] in (",", ";"):
                self.take()
        self.take("}")
        if not hsh:
            return arr
        for idx, item in enumerate(arr, 1):
            hsh[idx] = item
        # table à clés entières contiguës 1..n -> liste
        if all(isinstance(k, int) for k in hsh) and sorted(hsh) == list(range(1, len(hsh) + 1)):
            return [hsh[k] for k in range(1, len(hsh) + 1)]
        return hsh


def parse_savedvariables(src):
    """Retourne {NomVariable: valeur} pour un fichier SavedVariables."""
    p = _Parser(src)
    out = {}
    while p.peek()[0] is not None:
        _, name = p.take()
        p.take("=")
        out[name] = p.value()
    return out


def _lua_str(s):
    s = s.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n").replace("\r", "\\r")
    return '"' + re.sub(r"[\x00-\x1f]", lambda m: "\\%03d" % ord(m.group()), s) + '"'


_IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_KEYWORDS = {"and", "break", "do", "else", "elseif", "end", "false", "for", "function", "if", "in",
             "local", "nil", "not", "or", "repeat", "return", "then", "true", "until", "while"}


def to_lua(v, indent=0):
    pad = "\t" * (indent + 1)
    if v is None:
        return "nil"
    if v is True:
        return "true"
    if v is False:
        return "false"
    if isinstance(v, (int, float)):
        return repr(v)
    if isinstance(v, str):
        return _lua_str(v)
    if isinstance(v, (list, tuple)):
        if not v:
            return "{}"
        items = ",\n".join(pad + to_lua(x, indent + 1) for x in v)
        return "{\n" + items + ",\n" + "\t" * indent + "}"
    if isinstance(v, dict):
        if not v:
            return "{}"
        lines = []
        for k, x in v.items():
            if isinstance(k, str) and _IDENT.match(k) and k not in _KEYWORDS:
                key = k
            elif isinstance(k, (int, float)):
                key = "[%s]" % repr(k)
            else:
                key = "[%s]" % _lua_str(str(k))
            lines.append("%s%s = %s" % (pad, key, to_lua(x, indent + 1)))
        return "{\n" + ",\n".join(lines) + ",\n" + "\t" * indent + "}"
    raise TypeError("cannot serialize %r" % type(v))
