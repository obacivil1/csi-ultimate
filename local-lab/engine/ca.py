"""
engine/ca.py — سلطة شهادات محلية للوكيل (MITM شفاف ومعلن).
=============================================================
يولّد CA خاصًا بالمختبر (data/proxy_ca/) + شهادات مضيفة موقعة منه.
الاستعمال الشرعي الوحيد: متصفحك أنت على جهازك وأهدافك المرخّصة —
ثبّت ca.pem في متصفحك ليزيل تحذير TLS أثناء الاعتراض.
بدون مكتبة cryptography: تُرفع RuntimeError واضحة ويبقى النفق الأعمى.
"""
from datetime import datetime, timedelta, timezone
from ipaddress import ip_address
from pathlib import Path

try:
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID
    HAVE_TLS = True
except Exception:
    HAVE_TLS = False

CA_DIRNAME = "proxy_ca"


def ca_dir(base_data_dir=None):
    root = Path(base_data_dir) if base_data_dir else \
        Path(__file__).resolve().parents[1] / "data"
    d = root / CA_DIRNAME
    d.mkdir(parents=True, exist_ok=True)
    return d


def _need():
    if not HAVE_TLS:
        raise RuntimeError("فكّ TLS يحتاج مكتبة cryptography (pip install cryptography).")


def ensure_ca(ca_path=None):
    """يولّد CA (RSA-2048، عشر سنوات) إن غاب، ويعيد (key.pem, ca.pem)."""
    _need()
    d = Path(ca_path) if ca_path else ca_dir()
    d.mkdir(parents=True, exist_ok=True)
    key_p, cert_p = d / "ca_key.pem", d / "ca.pem"
    if key_p.exists() and cert_p.exists():
        return str(key_p), str(cert_p)
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,
                                         "LocalLab Proxy CA")])
    now = datetime.now(timezone.utc)
    cert = (x509.CertificateBuilder()
            .subject_name(name).issuer_name(name)
            .public_key(key.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(now - timedelta(days=1))
            .not_valid_after(now + timedelta(days=3650))
            .add_extension(x509.BasicConstraints(ca=True, path_length=0), True)
            .add_extension(x509.KeyUsage(True, False, False, False, False,
                                         True, True, False, False), True)
            .add_extension(x509.SubjectKeyIdentifier.from_public_key(
                key.public_key()), False)
            .sign(key, hashes.SHA256()))
    key_p.write_bytes(key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.TraditionalOpenSSL,
        serialization.NoEncryption()))
    cert_p.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    return str(key_p), str(cert_p)


def leaf_cert(hostname, ca_path=None):
    """شهادة مضيفة (SAN=DNS/IP) موقعة من CA — تُخزَّن مؤقتًا لكل مضيف.

    تُثبَّت ببصمة الـ CA: إن تجددت الـ CA وُلّدت الورقة من جديد
    (ورقة قديمة مع CA جديد = سلسلة مكسورة وفشل تحقق مضلل).
    """
    _need()
    import hashlib as _hl
    d = Path(ca_path) if ca_path else ca_dir()
    key_p, cert_p = ensure_ca(d)
    cafp = _hl.sha256(Path(cert_p).read_bytes()).hexdigest()[:12]
    safe = hostname.replace(":", "_").replace("/", "_")
    lp, kp = d / f"leaf_{safe}_{cafp}.pem", d / f"leaf_{safe}_{cafp}_key.pem"
    if lp.exists() and kp.exists():
        return str(lp), str(kp)
    from cryptography.hazmat.primitives.serialization import load_pem_private_key
    ca_key = load_pem_private_key(Path(key_p).read_bytes(), password=None)
    ca_cert = x509.load_pem_x509_certificate(Path(cert_p).read_bytes())
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    try:
        san = x509.IPAddress(ip_address(hostname))
    except ValueError:
        san = x509.DNSName(hostname)
    now = datetime.now(timezone.utc)
    cert = (x509.CertificateBuilder()
            .subject_name(x509.Name(
                [x509.NameAttribute(NameOID.COMMON_NAME, hostname)]))
            .issuer_name(ca_cert.subject)
            .public_key(key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(now - timedelta(days=1))
            .not_valid_after(now + timedelta(days=825))
            .add_extension(x509.SubjectAlternativeName([san]), False)
            .add_extension(x509.BasicConstraints(ca=False, path_length=None), True)
            .add_extension(x509.SubjectKeyIdentifier.from_public_key(
                key.public_key()), False)
            .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(
                ca_key.public_key()), False)
            .sign(ca_key, hashes.SHA256()))
    lp.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    kp.write_bytes(key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.TraditionalOpenSSL,
        serialization.NoEncryption()))
    return str(lp), str(kp)
