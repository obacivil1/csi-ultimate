"""
learn/portswigger.py — جسر أكاديمية PortSwigger (Web Security Academy).
=========================================================================
يربط كل فحص من فحوصاتنا بمسار الأكاديمية المجاني المقابل: ادرس النظرية
هناك، وطبّق عمليًا على مختبرنا المحلي (نفس الثغرة، نفس المنهجية).
الأكواد بلا رابط (None) تغطيها مختبراتنا فقط — موثقة بسبب صريح.
"""
PS = "https://portswigger.net/web-security"

ACADEMY = {
    "SQLLOGIN": (f"{PS}/sql-injection",
                 "SQL injection UNION attack + Login bypass"),
    "SQLSEARCH": (f"{PS}/sql-injection",
                  "Retrieving hidden data"),
    "SQLBLIND": (f"{PS}/sql-injection/blind",
                 "Blind boolean + time delays"),
    "SQLTIME": (f"{PS}/sql-injection/blind",
                "Blind with time delays"),
    "XSSREFLECT": (f"{PS}/cross-site-scripting/reflected",
                   "Reflected XSS into HTML context"),
    "XSSSTORED": (f"{PS}/cross-site-scripting/stored",
                  "Stored XSS into HTML context"),
    "XSSATTR": (f"{PS}/cross-site-scripting/contexts",
                "Attribute context"),
    "XSSJS": (f"{PS}/cross-site-scripting/contexts",
              "JavaScript string context"),
    "XSSPOLY": (f"{PS}/cross-site-scripting/contexts",
                "Multiple contexts"),
    "IDOR": (f"{PS}/access-control",
             "Insecure direct object references"),
    "PATH": (f"{PS}/file-path-traversal",
             "Reading arbitrary files"),
    "UPLOAD": (f"{PS}/file-upload",
               "Web shell via extension bypass"),
    "CMDI": (f"{PS}/os-command-injection",
             "Simple + blind cases"),
    "WEAKCOOKIE": (f"{PS}/authentication",
                   "Password-based + session handling"),
"NOLOCK": (f"{PS}/authentication/password-based",
                 "Brute-force protection"),
      "AUTHENUM": (f"{PS}/authentication/username-enumeration",
                   "Different responses + timing"),
      "SESSFIX": (f"{PS}/authentication/session-management",
                  "Session fixation + session tokens"),
      "GRAPHQL": (f"{PS}/graphql",
                   "Introspection + query testing"),
      "NOSQLI": (f"{PS}/nosql", "NoSQL injection"),
      "FRAMING": (f"{PS}/http-request-smuggling",
                  "CL.TE and TE.CL desync"),
    "APIAUTH": (f"{PS}/access-control",
                "Unprotected functionality"),
    "SSRF": (f"{PS}/ssrf", "Basic SSRF against localhost"),
    "SSTI": (f"{PS}/server-side-template-injection",
             "Basic + Jinja2 cases"),
    "OPENREDIR": (None, "لا مسار مخصص — تغطية مختبرنا كاملة"),
    "CSRF": (f"{PS}/csrf", "CSRF without defenses"),
    "SECHDRS": (f"{PS}/clickjacking", "Framing + headers"),
    "CSPWEAK": (f"{PS}/cross-site-scripting/content-security-policy",
                "CSP bypasses"),
    "JWTNONE": (f"{PS}/jwt", "None algorithm"),
    "JWTWEAK": (f"{PS}/jwt", "Weak secret / cracking"),
    "INFOLEAK": (f"{PS}/information-disclosure",
                 "Error messages"),
    "CORS": (f"{PS}/cors", "Permissive ACAO"),
    "CORSLAB": (f"{PS}/cors", "Origin reflection + credentials"),
    "HOSTHDR": (f"{PS}/host-header", "Password reset poisoning"),
    "XXE": (f"{PS}/xxe", "File read via external entities"),
    "LFI": (f"{PS}/file-path-traversal", "Local file inclusion"),
    "MASSASSIGN": (f"{PS}/access-control",
                  "Privilege escalation / mass assignment"),
    "METHODS": (None, "توثيق تصليب — مختبرنا يغطيه"),
}

ORDER_STUDY = ["SQLLOGIN", "SQLSEARCH", "SQLBLIND", "SQLTIME", "XSSREFLECT",
               "XSSSTORED", "XSSATTR", "XSSJS", "XSSPOLY", "IDOR", "PATH",
               "LFI", "UPLOAD", "CMDI", "WEAKCOOKIE", "NOLOCK", "AUTHENUM", "SESSFIX", "JWTNONE",
               "JWTWEAK", "SSRF", "XXE", "SSTI", "CSRF", "CORS", "CORSLAB",
               "HOSTHDR", "MASSASSIGN",
               "APIAUTH", "SECHDRS", "CSPWEAK", "INFOLEAK", "OPENREDIR",
               "GRAPHQL", "NOSQLI", "FRAMING",
               "METHODS"]


def academy_for(code):
    """يعيد (url|None, suggested_lab) لكود الفحص."""
    if code not in ACADEMY:
        raise ValueError(f"كود غير معروف: {code}")
    return ACADEMY[code]
