"""
engine/enc.py — الترميز وفك الترميز الداخلي (Burp Decoder).
============================================================
kind مدعومة: url, dblurl, b64, b64url, hex, html, uni
"""
import base64
import html
import urllib.parse

KINDS = ("url", "dblurl", "b64", "b64url", "hex", "html", "uni")


def encode(kind, text):
    b = text.encode("utf-8")
    if kind == "url":
        return urllib.parse.quote(text, safe="")
    if kind == "dblurl":
        return urllib.parse.quote(urllib.parse.quote(text, safe=""), safe="")
    if kind == "b64":
        return base64.b64encode(b).decode()
    if kind == "b64url":
        return base64.urlsafe_b64encode(b).decode()
    if kind == "hex":
        return b.hex()
    if kind == "html":
        return html.escape(text)
    if kind == "uni":
        return "".join(f"\\u{ord(c):04x}" for c in text)
    raise ValueError(f"ترميز غير معروف: {kind}")


def decode(kind, text):
    if kind == "url":
        return urllib.parse.unquote(text)
    if kind == "dblurl":
        return urllib.parse.unquote(urllib.parse.unquote(text))
    if kind == "b64":
        s = text + "=" * (-len(text) % 4)
        return base64.b64decode(s).decode("utf-8", "replace")
    if kind == "b64url":
        s = text + "=" * (-len(text) % 4)
        return base64.urlsafe_b64decode(s).decode("utf-8", "replace")
    if kind == "hex":
        return bytes.fromhex("".join(text.split())).decode("utf-8", "replace")
    if kind == "html":
        return html.unescape(text)
    if kind == "uni":
        return text.encode("utf-8").decode("unicode_escape", "replace")
    raise ValueError(f"ترميز غير معروف: {kind}")
