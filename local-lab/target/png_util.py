"""
png_util.py — توليد صور PNG بسيطة (شعارات/بدائل) بمكتبة بايثون القياسية فقط.
تُستعمل لصناعة شعار افتراضي وتوليد شعار بديل في مهمات إثبات السيطرة (PoC).
لا تحتاج أي حزمة خارجية (zlib + struct فقط).
"""
import struct
import zlib


def _chunk(tag: bytes, data: bytes) -> bytes:
    raw = tag + data
    return struct.pack(">I", len(data)) + raw + struct.pack(">I", zlib.crc32(raw))


def make_png(width: int, height: int, color1=(14, 116, 144), color2=(30, 27, 75),
             band: bool = True) -> bytes:
    """يرسم PNG بخطوط مائلة بلونين بحيث يبدو كشعار، ويرجع بايتاته."""
    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filter: None
        for x in range(width):
            stripe = ((x // 16 + y // 16) % 2 == 0) if band else True
            c = color1 if stripe else color2
            raw += bytes((c[0], c[1], c[2], 255))
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", ihdr)
        + _chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + _chunk(b"IEND", b"")
    )


def default_logo() -> bytes:
    """الشعار الأصلي للمنصة (تركوازي/كحلي)."""
    return make_png(240, 64)


def replacement_logo() -> bytes:
    """شعار بديل أحمر/برتقالي ليثبت أن الشعار استُبدل فعلا."""
    return make_png(240, 64, (190, 40, 40), (255, 140, 0))