"""Lifetime USD ledger. Only explicit initialization creates a database.

Integer microdollars; BEGIN IMMEDIATE serializes admission across processes.
Reservations are never refunded, including errors, timeout and process death.
No text, IP address, credential or raw upstream error is persisted.
"""
import hashlib
import json
import os
import re
import sqlite3
import time
import uuid
import tempfile
from contextlib import contextmanager
from pathlib import Path

CAP_MICRO_USD = 3_500_000
RESERVE_MICRO_USD = 20_000  # Candidate $0.02 upper bound; NOT yet verified.
CLIENT_PER_MINUTE = 2
GLOBAL_PER_MINUTE = 6
CLIENT_CONCURRENCY = 1
GLOBAL_CONCURRENCY = 1
MAX_ALIASES = 1000
KEY_PATTERN = re.compile(r"[A-Za-z0-9_-]{16,128}\Z")


class AdmissionError(Exception):
    def __init__(self, code, message):
        self.code = code
        self.message = message
        super().__init__(message)


def digest(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


class Ledger:
    def __init__(self, path, clock=time.time, expected_epoch=None):
        self.path = Path(path).resolve()
        self.clock = clock
        self.expected_epoch = expected_epoch
        self.anchor_path = self.path.with_suffix(self.path.suffix + ".anchor.json")

    def read_anchor(self):
        value = json.loads(self.anchor_path.read_text())
        if (not isinstance(value, dict) or set(value) != {"epoch", "reserved"}
                or not isinstance(value["epoch"], str)
                or str(uuid.UUID(value["epoch"])) != value["epoch"]
                or type(value["reserved"]) is not int
                or not 0 <= value["reserved"] <= CAP_MICRO_USD):
            raise AdmissionError(503, "Controle de gasto indisponível")
        if self.expected_epoch is not None and value["epoch"] != self.expected_epoch:
            raise AdmissionError(503, "Época do orçamento incompatível")
        return value

    @staticmethod
    def sync_directory(path):
        fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)

    def write_anchor(self, value):
        # Write the high-water mark BEFORE SQLite commits. If a crash occurs
        # between the two commits, the mismatch closes the service. Never
        # repair either counter automatically or lower a high-water mark.
        with tempfile.NamedTemporaryFile(mode="w", dir=self.path.parent, prefix=".jev-anchor-", delete=False) as file:
            temporary = Path(file.name)
            file.write(json.dumps(value, sort_keys=True))
            file.flush()
            os.fsync(file.fileno())
        try:
            os.replace(temporary, self.anchor_path)
            self.sync_directory(self.path.parent)
        finally:
            temporary.unlink(missing_ok=True)

    @staticmethod
    def initialize(path):
        """Operator action, never called by the server. Refuse overwrite/reset."""
        path = Path(path)
        anchor_path = path.with_suffix(path.suffix + ".anchor.json")
        if path.exists() or anchor_path.exists():
            raise FileExistsError("Ledger/anchor already exists; initialization cannot reset it")
        epoch = str(uuid.uuid4())
        anchor_fd = os.open(anchor_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(anchor_fd, "w") as file:
            file.write(json.dumps({"epoch": epoch, "reserved": 0}, sort_keys=True))
            file.flush()
            os.fsync(file.fileno())
        Ledger.sync_directory(path.parent)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        os.close(fd)
        db = sqlite3.connect(path)
        try:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("PRAGMA synchronous=FULL")
            db.executescript("""
                CREATE TABLE budget (
                    id INTEGER PRIMARY KEY CHECK(id=1),
                    version INTEGER NOT NULL CHECK(version=2),
                    epoch TEXT NOT NULL,
                    cap INTEGER NOT NULL CHECK(cap=3500000),
                    reserved INTEGER NOT NULL CHECK(reserved BETWEEN 0 AND cap),
                    halted INTEGER NOT NULL CHECK(halted IN (0,1)));
                CREATE TABLE requests (
                    key_hash TEXT PRIMARY KEY,
                    payload_hash TEXT NOT NULL,
                    client_hash TEXT NOT NULL,
                    amount INTEGER NOT NULL CHECK(amount=20000),
                    state TEXT NOT NULL CHECK(state IN ('inflight','done','uncertain')),
                    result TEXT,
                    UNIQUE(client_hash,payload_hash));
                CREATE TABLE events (ts REAL NOT NULL, client_hash TEXT NOT NULL);
                CREATE INDEX event_time ON events(ts);
                CREATE TABLE aliases (key_hash TEXT PRIMARY KEY, request_hash TEXT NOT NULL);
            """)
            db.execute("INSERT INTO budget VALUES(1,2,?,3500000,0,0)", (epoch,))
            db.commit()
        finally:
            db.close()
        return epoch

    @contextmanager
    def transaction(self):
        db = None
        try:
            with self.path.open("rb") as file:
                if file.read(16) != b"SQLite format 3\x00":
                    raise AdmissionError(503, "Controle de gasto indisponível")
            # mode=rw MUST NOT recreate an absent ledger after deploy/data loss.
            db = sqlite3.connect(self.path.as_uri() + "?mode=rw", uri=True, timeout=.5)
            db.execute("PRAGMA synchronous=FULL")
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT version,cap,reserved,halted,epoch FROM budget WHERE id=1").fetchone()
            anchor = self.read_anchor()
            total = db.execute("SELECT COALESCE(SUM(amount),0) FROM requests").fetchone()[0]
            # Missing tables, tombstones or inconsistent holds fail closed.
            db.execute("SELECT COUNT(*) FROM aliases").fetchone()
            missing_aliases = db.execute("SELECT COUNT(*) FROM requests r LEFT JOIN aliases a ON a.key_hash=r.key_hash AND a.request_hash=r.key_hash WHERE a.key_hash IS NULL").fetchone()[0]
            orphan_aliases = db.execute("SELECT COUNT(*) FROM aliases a LEFT JOIN requests r ON a.request_hash=r.key_hash WHERE r.key_hash IS NULL").fetchone()[0]
            if (not row or row[0] != 2 or row[1] != CAP_MICRO_USD
                    or not 0 <= row[2] <= row[1] or row[2] != total or row[3] not in (0, 1)
                    or row[4] != anchor["epoch"] or row[2] != anchor["reserved"]
                    or missing_aliases or orphan_aliases):
                raise AdmissionError(503, "Controle de gasto indisponível")
            yield db
            after = db.execute("SELECT epoch,reserved FROM budget WHERE id=1").fetchone()
            if after[1] < anchor["reserved"]:
                raise AdmissionError(503, "Controle de gasto indisponível")
            if after[1] != anchor["reserved"]:
                self.write_anchor({"epoch": after[0], "reserved": after[1]})
            db.commit()
        except (sqlite3.Error, OSError, ValueError):
            if db:
                db.rollback()
            raise AdmissionError(503, "Controle de gasto indisponível") from None
        except BaseException:
            if db:
                db.rollback()
            raise
        finally:
            if db:
                db.close()

    def snapshot(self):
        with self.transaction() as db:
            cap, used, halted, epoch = db.execute("SELECT cap,reserved,halted,epoch FROM budget").fetchone()
            return {"cap_micro_usd": cap, "reserved_micro_usd": used,
                    "remaining_micro_usd": cap - used, "halted": bool(halted), "epoch": epoch}

    def reserve(self, client, key, payload):
        if not isinstance(key, str) or not KEY_PATTERN.fullmatch(key):
            raise AdmissionError(400, "Idempotency-Key inválida ou ausente")
        client_hash = digest(client)
        key_hash = digest(client_hash + ":" + key)
        payload_hash = digest(json.dumps(payload, sort_keys=True, ensure_ascii=True,
                                         separators=(",", ":"), allow_nan=False))
        denial = None
        replay = None
        with self.transaction() as db:
            # Sliding window survives process restarts. Replay is also rate-limited.
            now = self.clock()
            db.execute("DELETE FROM events WHERE ts < ?", (now - 60,))
            global_count = db.execute("SELECT COUNT(*) FROM events").fetchone()[0]
            client_count = db.execute("SELECT COUNT(*) FROM events WHERE client_hash=?", (client_hash,)).fetchone()[0]
            if global_count >= GLOBAL_PER_MINUTE or client_count >= CLIENT_PER_MINUTE:
                denial = AdmissionError(429, "Limite de frequência atingido; aguarde")
            else:
                db.execute("INSERT INTO events VALUES(?,?)", (now, client_hash))
                prior = db.execute("SELECT r.key_hash,r.payload_hash,r.state,r.result FROM aliases a JOIN requests r ON a.request_hash=r.key_hash WHERE a.key_hash=?", (key_hash,)).fetchone()
                if prior and prior[1] != payload_hash:
                    denial = AdmissionError(409, "Idempotency-Key já usada com outro texto")
                if not prior:
                    prior = db.execute("SELECT key_hash,payload_hash,state,result FROM requests WHERE client_hash=? AND payload_hash=?",
                                       (client_hash, payload_hash)).fetchone()
                if not denial and prior:
                    known_key = db.execute("SELECT 1 FROM aliases WHERE key_hash=?", (key_hash,)).fetchone()
                    alias_count = db.execute("SELECT COUNT(*) FROM aliases").fetchone()[0]
                    if not known_key and alias_count >= MAX_ALIASES:
                        denial = AdmissionError(429, "Limite de repetições atingido")
                    else:
                        db.execute("INSERT OR IGNORE INTO aliases VALUES(?,?)", (key_hash, prior[0]))
                    if not denial and prior[2] == "done" and prior[3]:
                        replay = json.loads(prior[3])
                    elif not denial:
                        denial = AdmissionError(409, "Pedido já reservado; envio não será repetido")
                if not denial and not prior:
                    _, used, halted = db.execute("SELECT cap,reserved,halted FROM budget").fetchone()
                    alias_count = db.execute("SELECT COUNT(*) FROM aliases").fetchone()[0]
                    active = db.execute("SELECT COUNT(*) FROM requests WHERE state!='done'").fetchone()[0]
                    client_active = db.execute("SELECT COUNT(*) FROM requests WHERE state!='done' AND client_hash=?", (client_hash,)).fetchone()[0]
                    if alias_count >= MAX_ALIASES:
                        denial = AdmissionError(429, "Limite de repetições atingido")
                    elif halted or used + RESERVE_MICRO_USD > CAP_MICRO_USD:
                        denial = AdmissionError(503, "Orçamento total indisponível ou esgotado")
                    elif active >= GLOBAL_CONCURRENCY or client_active >= CLIENT_CONCURRENCY:
                        denial = AdmissionError(429, "Limite de concorrência atingido")
                    else:
                        db.execute("UPDATE budget SET reserved=reserved+? WHERE id=1", (RESERVE_MICRO_USD,))
                        db.execute("INSERT INTO requests VALUES(?,?,?,?,'inflight',NULL)",
                                   (key_hash, payload_hash, client_hash, RESERVE_MICRO_USD))
                        db.execute("INSERT INTO aliases VALUES(?,?)", (key_hash, key_hash))
        if denial:
            raise denial
        return key_hash, replay

    def finish(self, key_hash, result, actual_micro_usd=None, cost_consistent=True):
        """Even successful calls keep the whole hold. Unknown charges keep slots."""
        if actual_micro_usd is not None and (type(actual_micro_usd) is not int or actual_micro_usd < 0):
            raise AdmissionError(503, "Uso do provedor inválido")
        safe_result = json.dumps(result, ensure_ascii=False, allow_nan=False)
        if len(safe_result.encode()) > 8192:
            raise AdmissionError(503, "Resposta indisponível")
        with self.transaction() as db:
            if not cost_consistent or (actual_micro_usd is not None and actual_micro_usd > RESERVE_MICRO_USD):
                db.execute("UPDATE budget SET halted=1")
                state = "uncertain"
            else:
                state = "done" if result.get("status") == "ok" and actual_micro_usd is not None else "uncertain"
            db.execute("UPDATE requests SET state=?,result=? WHERE key_hash=? AND state='inflight'",
                       (state, safe_result, key_hash))
        return state == "done"


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Initialize a NEW lifetime ledger; never reset")
    parser.add_argument("action", choices=["init"])
    parser.add_argument("path")
    args = parser.parse_args()
    epoch = Ledger.initialize(args.path)
    print("Ledger initialized: lifetime USD 3.50; no renewal")
    print("Bind non-secret LEADSCORER_JEV_LEDGER_EPOCH to", epoch)
