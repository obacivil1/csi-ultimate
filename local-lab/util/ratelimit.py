"""
util/ratelimit.py — حدّ معدّل token-bucket (طلب/ثانية)، آمن للخيوط.
====================================================================
استعمله مع intruder.fuzz(..., limiter=RateLimiter(2)) لفحص مهذب،
أو مع أي حلقة طلبات طويلة.
"""
import threading
import time


class RateLimiter:
    def __init__(self, per_second: float, burst: float | None = None):
        if per_second <= 0:
            raise ValueError("المعدل يجب أن يكون موجبًا")
        self.rate = float(per_second)
        self.capacity = float(burst or per_second)
        self._tokens = self.capacity
        self._stamp = time.monotonic()
        self._lock = threading.Lock()

    def wait(self) -> float:
        """يحجز رمزًا وينام عند الحاجة. يعيد زمن الانتظار بالثواني."""
        with self._lock:
            now = time.monotonic()
            self._tokens = min(self.capacity,
                               self._tokens + (now - self._stamp) * self.rate)
            self._stamp = now
            if self._tokens >= 1.0:
                self._tokens -= 1.0
                return 0.0
            need = (1.0 - self._tokens) / self.rate
            self._tokens = 0.0
        time.sleep(need)
        with self._lock:
            self._stamp = time.monotonic()
        return need
