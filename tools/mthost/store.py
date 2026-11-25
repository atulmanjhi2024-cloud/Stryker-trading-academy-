"""Account records on disk, root-only (0600). The password is only ever stored sealed; never returned by any function here."""
import json, os, re, time, threading

ID = re.compile(r"^[a-f0-9]{16}$")
UID = re.compile(r"^[A-Za-z0-9]{1,128}$")


class Store:
    def __init__(self, root):
        self.root, self.lk = root, threading.RLock()
        os.makedirs(root, mode=0o700, exist_ok=True)

    def _p(self, uid, aid):
        if not UID.match(uid) or not ID.match(aid):
            raise ValueError("bad id")
        return os.path.join(self.root, uid, aid + ".json")

    def put(self, rec):
        p = self._p(rec["uid"], rec["id"]); os.makedirs(os.path.dirname(p), mode=0o700, exist_ok=True)
        with self.lk:
            tmp = p + ".tmp"
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w") as f:
                json.dump(rec, f)
            os.replace(tmp, p)

    def get(self, uid, aid):
        """Only the owner's record: another user's id is simply 'not found'."""
        try:
            with open(self._p(uid, aid)) as f:
                return json.load(f)
        except (OSError, ValueError):
            return None

    def list(self, uid):
        d = os.path.join(self.root, uid) if UID.match(uid) else None
        if not d or not os.path.isdir(d):
            return []
        return [r for n in sorted(os.listdir(d)) if n.endswith(".json") and (r := self.get(uid, n[:-5]))]

    def all(self):
        out = []
        for u in os.listdir(self.root):
            if UID.match(u):
                out += self.list(u)
        return out

    def delete(self, uid, aid):
        try:
            os.remove(self._p(uid, aid)); return True
        except OSError:
            return False


def public(rec):
    """What a client may see: no password blob, no slot internals."""
    return {k: rec.get(k) for k in ("id", "platform", "login", "server", "mode", "state", "created", "lastUsed", "name", "currency")}
