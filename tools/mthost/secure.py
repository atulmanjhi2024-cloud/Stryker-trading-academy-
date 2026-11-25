"""Password sealing (AES-256-GCM), Firebase ID-token check, per-user rate limit. No network, no secrets in logs."""
import base64, os, time, json, threading, urllib.request
import jwt  # PyJWT
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

PROJECT = "strykertrades-e0cd8"
CERTS_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com"


def load_key(b64=None):
    """b64 or MTHOST_KEY; the env copy is removed at once so no child process (systemd-run, wine) ever inherits it."""
    k = base64.b64decode(b64 or os.environ.pop("MTHOST_KEY", ""))
    if len(k) != 32:
        raise RuntimeError("MTHOST_KEY must be 32 bytes, base64")
    return k


def seal(key, plaintext, aad):
    """-> base64(nonce12 + ciphertext+tag). aad binds the blob to uid+account id: a copied blob will not open elsewhere."""
    n = os.urandom(12)
    return "v1:" + base64.b64encode(n + AESGCM(key).encrypt(n, plaintext.encode(), aad.encode())).decode()   # v1: key version, for rotation


def unseal(key, blob, aad):
    if blob.startswith("v1:"): blob = blob[3:]
    elif ":" in blob: raise ValueError("unknown key version")
    raw = base64.b64decode(blob)
    return AESGCM(key).decrypt(raw[:12], raw[12:], aad.encode()).decode()


class Verifier:
    """Firebase ID token -> uid or None. certs: injectable for tests."""
    def __init__(self, certs=None, now=time.time):
        self._certs, self._at, self._fixed, self.now = certs or {}, 0, certs is not None, now

    def _load(self):
        if self._fixed:
            return self._certs
        if not self._certs or self.now() - self._at > 3600:
            with urllib.request.urlopen(CERTS_URL, timeout=8) as r:
                self._certs = json.loads(r.read()); self._at = self.now()
        return self._certs

    def uid(self, token):
        try:
            kid = jwt.get_unverified_header(token).get("kid")
            pem = self._load().get(kid)
            if not pem:
                return None
            from cryptography.x509 import load_pem_x509_certificate
            pub = load_pem_x509_certificate(pem.encode()).public_key() if "CERTIFICATE" in pem else pem
            c = jwt.decode(token, pub, algorithms=["RS256"], audience=PROJECT, issuer="https://securetoken.google.com/" + PROJECT)
            return c.get("sub") if isinstance(c.get("sub"), str) and c.get("sub") else None
        except Exception:
            return None


class RateLimiter:
    def __init__(self, now=time.time):
        self.now, self.h, self.lk = now, {}, threading.RLock()

    def hit(self, key, limit, per=60):
        with self.lk:
            t = self.now()
            q = [x for x in self.h.get(key, []) if t - x < per]
            if len(q) >= limit:
                self.h[key] = q; return False
            q.append(t); self.h[key] = q
            if len(self.h) > 5000: self.prune()
            return True

    def prune(self):
        """drop keys with no hit in the last 10 minutes (memory stays bounded)"""
        with self.lk:
            t = self.now()
            for k in [k for k, q in self.h.items() if not q or t - q[-1] > 600]: del self.h[k]
