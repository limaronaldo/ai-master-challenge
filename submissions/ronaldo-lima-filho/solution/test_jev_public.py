"""Offline public-route, money, crash, replay and simultaneous-process tests."""
import copy
from contextlib import contextmanager
import email.message
import http.client
import json
import os
from pathlib import Path
import sqlite3
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError, URLError

import app
import jev
from jev_budget import AdmissionError, CAP_MICRO_USD, Ledger, RESERVE_MICRO_USD, MAX_ALIASES, digest
from jev_guard import PublicJev, client_identity


ENV = {"LEADSCORER_JEV_ENABLED": "1", "LEADSCORER_JEV_ALLOW_NETWORK": "1",
       "LEADSCORER_JEV_ALLOW_SPENDING": "1", "LEADSCORER_JEV_PROVIDER": "openrouter",
       "OPENROUTER_API_KEY": "synthetic-offline-key"}
BODY = {"mode": "service", "text": "Synthetic: next meeting agreed.",
        "allow_transmission": True, "confirm_cost": True, "data_classification": "synthetic"}
RESPONSE = {"id": "synthetic-request", "provider": "TypeSafe", "model": jev.OPENROUTER_MODEL,
            "usage": {"input_tokens": 1200, "output_tokens": 20, "cost": .0000504},
            "answers": {"text_context": {"type": "choice", "choice": "explicit_next_step",
                        "confidence": .7, "probabilities": {"explicit_next_step": .8,
                        "explicit_objection": .1, "insufficient_context": .1}}}}


@contextmanager
def connection(path):
    db = sqlite3.connect(path)
    try:
        with db:
            yield db
    finally:
        db.close()


def key(i=0):
    return f"request-{i:08d}"


class PublicFixture:
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / "ledger.sqlite3"
        self.epoch = Ledger.initialize(self.path)
        self.env = dict(ENV, LEADSCORER_JEV_LEDGER_EPOCH=self.epoch)
        self.now = 1000
        self.ledger = Ledger(self.path, clock=lambda: self.now)
        self.transport = Mock(return_value=copy.deepcopy(RESPONSE))
        self.controller = PublicJev(self.env, self.ledger, self.transport, verified_cost_bound=True)
        self.forbidden = patch("jev.http_transport", side_effect=AssertionError("real provider forbidden"))
        self.forbidden.start()
        self.addCleanup(self.forbidden.stop)

    def send(self, text=None, client="127.0.0.1", request_key=None):
        return self.controller.classify(dict(BODY, text=text or BODY["text"]), client, request_key or key())


class PublicTests(PublicFixture, unittest.TestCase):
    def test_provider_and_secret_match_deploy_without_typesafe_key_fallback(self):
        result, code = self.send()
        payload, credential, provider = self.transport.call_args.args
        self.assertEqual(code, 200)
        self.assertEqual(result["source"], "openrouter_service")
        self.assertEqual((provider, payload["model"]), ("openrouter", "typesafe/jev-1.13"))
        self.assertEqual(payload["state"], {"text": BODY["text"]})
        self.assertEqual(set(payload), {"model", "state", "questions"})
        self.assertEqual(credential, "synthetic-offline-key")
        env = dict(self.env)
        del env["OPENROUTER_API_KEY"]
        env["TYPESAFE_API_KEY"] = "other-synthetic-key"
        self.assertFalse(PublicJev(env, self.ledger, self.transport, True).status()["service_ready"])

    def test_live_cost_bound_cannot_be_bypassed_by_environment_or_origin_consent(self):
        env = dict(self.env, LEADSCORER_JEV_COST_BOUND_VERIFIED="1")
        for controller in [PublicJev(env, self.ledger), PublicJev(env, self.ledger, verified_cost_bound=True),
                           PublicJev(env, self.ledger, self.transport)]:
            self.assertIn("cost_bound_unverified", controller.status()["blockers"])
            result, _ = controller.classify(BODY, "client", key())
            self.assertEqual(result["status"], "unavailable")
        self.transport.assert_not_called()
        self.assertEqual(self.ledger.snapshot()["reserved_micro_usd"], 0)

    def test_reservation_is_durable_before_transport(self):
        def inspect(payload, credential, provider):
            self.assertEqual(Ledger(self.path).snapshot()["reserved_micro_usd"], RESERVE_MICRO_USD)
            with connection(self.path) as db:
                self.assertEqual(db.execute("SELECT state FROM requests").fetchone()[0], "inflight")
            return RESPONSE
        self.transport.side_effect = inspect
        self.assertEqual(self.send()[0]["status"], "ok")
        self.assertEqual(self.ledger.snapshot()["reserved_micro_usd"], RESERVE_MICRO_USD)

    def test_replay_after_restart_and_new_key_is_not_billed_again(self):
        first, _ = self.send()
        self.controller = PublicJev(self.env, Ledger(self.path, lambda: self.now), self.transport, True)
        replay, _ = self.send(request_key=key(1))
        self.assertEqual(replay, dict(first, replayed=True))
        self.transport.assert_called_once()
        self.assertEqual(self.ledger.snapshot()["reserved_micro_usd"], RESERVE_MICRO_USD)
        self.now += 61
        changed, code = self.send(text="Changed synthetic payload", request_key=key(1))
        self.assertEqual(code, 409)  # The new alias remains bound to its first payload.
        self.transport.assert_called_once()

    def test_same_key_different_payload_conflicts_and_never_transports(self):
        self.send()
        _, code = self.send(text="Different text")
        self.assertEqual(code, 409)
        self.transport.assert_called_once()

    def test_replay_alias_storage_is_bounded_including_new_payloads(self):
        self.send()
        with connection(self.path) as db:
            request_hash = db.execute("SELECT key_hash FROM requests").fetchone()[0]
            db.executemany("INSERT INTO aliases VALUES(?,?)", [(digest(f"alias-{i}"), request_hash) for i in range(MAX_ALIASES - 1)])
        for text in [BODY["text"], "Brand new text"]:
            self.now += 61
            self.assertEqual(self.send(text=text, request_key=key(1001))[1], 429)
        with connection(self.path) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM aliases").fetchone()[0], MAX_ALIASES)
        self.transport.assert_called_once()

    def test_client_and_global_sliding_rates_survive_new_instances(self):
        for i in range(2):
            self.send(text=f"Synthetic {i}", request_key=key(i))
        self.controller = PublicJev(self.env, Ledger(self.path, lambda: self.now), self.transport, True)
        self.assertEqual(self.send(text="Third text", request_key=key(3))[1], 429)
        for i in range(4):
            self.assertEqual(self.send(text=f"Other {i}", client=f"client-{i}", request_key=key(i))[1], 200)
        self.assertEqual(self.send(client="another")[1], 429)
        self.assertEqual(self.transport.call_count, 6)
        self.now += 61
        self.assertEqual(self.send(text="New window", request_key=key(10))[0]["status"], "ok")

    def test_client_and_global_inflight_limits_are_atomic(self):
        entered = threading.Event()
        release = threading.Event()
        def slow(*args):
            entered.set()
            self.assertTrue(release.wait(3))
            return RESPONSE
        self.transport.side_effect = slow
        result = []
        thread = threading.Thread(target=lambda: result.append(self.send()), daemon=True)
        thread.start()
        try:
            self.assertTrue(entered.wait(2))
            self.assertEqual(self.send(text="Other same client", request_key=key(1))[1], 429)
            with self.assertRaises(AdmissionError) as error:
                self.ledger.reserve("client-3", key(3), {"text": "third pending"})
            self.assertEqual(error.exception.code, 429)
            self.assertEqual(self.transport.call_count, 1)
            self.assertEqual(self.ledger.snapshot()["reserved_micro_usd"], RESERVE_MICRO_USD)
        finally:
            release.set()
            thread.join(3)
        self.assertEqual(result[0][0]["status"], "ok")

    def test_timeout_and_provider_errors_keep_budget_and_block_replay(self):
        errors = [TimeoutError("PRIVATE INPUT/key"), URLError("PRIVATE INPUT/key"),
                  HTTPError(jev.OPENROUTER_ENDPOINT, 401, "PRIVATE INPUT/key", {}, None),
                  HTTPError(jev.OPENROUTER_ENDPOINT, 402, "PRIVATE INPUT/key", {}, None),
                  HTTPError(jev.OPENROUTER_ENDPOINT, 429, "PRIVATE INPUT/key", {}, None),
                  HTTPError(jev.OPENROUTER_ENDPOINT, 529, "PRIVATE INPUT/key", {}, None),
                  RuntimeError("PRIVATE INPUT/key")]
        for i, error in enumerate(errors):
            with self.subTest(error=type(error).__name__):
                path = Path(self.tmp.name) / f"error-{i}.sqlite3"
                epoch = Ledger.initialize(path)
                ledger = Ledger(path, lambda: self.now)
                transport = Mock(side_effect=error)
                env = dict(self.env, LEADSCORER_JEV_LEDGER_EPOCH=epoch)
                controller = PublicJev(env, ledger, transport, True)
                result, _ = controller.classify(BODY, "client", key())
                self.assertEqual(result["status"], "unavailable")
                self.assertNotIn("PRIVATE", json.dumps(result))
                self.assertNotIn(ENV["OPENROUTER_API_KEY"], json.dumps(result))
                self.assertEqual(ledger.snapshot()["reserved_micro_usd"], RESERVE_MICRO_USD)
                controller = PublicJev(env, Ledger(path, lambda: self.now), transport, True)
                self.assertEqual(controller.classify(BODY, "client", key())[1], 409)
                transport.assert_called_once()
                with connection(path) as db:
                    self.assertEqual(db.execute("SELECT state FROM requests").fetchone()[0], "uncertain")
                    stored = str(db.execute("SELECT * FROM requests").fetchall())
                    self.assertNotIn("PRIVATE", stored)
                    self.assertNotIn(BODY["text"], stored)

    def test_invalid_response_holds_reservation_and_overspend_halts(self):
        self.transport.return_value = dict(RESPONSE, model="unexpected")
        self.assertEqual(self.send()[0]["status"], "unavailable")
        self.assertEqual(self.ledger.snapshot()["reserved_micro_usd"], RESERVE_MICRO_USD)
        path = Path(self.tmp.name) / "overspend.sqlite3"
        epoch = Ledger.initialize(path)
        ledger = Ledger(path, lambda: self.now)
        response = copy.deepcopy(RESPONSE)
        response["usage"]["cost"] = .021
        self.transport.return_value = response
        controller = PublicJev(dict(self.env, LEADSCORER_JEV_LEDGER_EPOCH=epoch), ledger, self.transport, True)
        self.assertEqual(controller.classify(BODY, "another", key())[0]["status"], "unavailable")
        self.assertTrue(ledger.snapshot()["halted"])
        self.assertFalse(controller.status()["service_ready"])

    def test_cost_discrepancy_within_reserve_still_halts_circuit(self):
        response = copy.deepcopy(RESPONSE)
        response["usage"]["cost"] = .001
        self.transport.return_value = response
        self.assertEqual(self.send()[0]["status"], "unavailable")
        self.assertTrue(self.ledger.snapshot()["halted"])
        self.assertEqual(self.ledger.snapshot()["reserved_micro_usd"], RESERVE_MICRO_USD)
        self.assertFalse(self.controller.status()["service_ready"])

    def test_entire_upstream_payload_is_bounded_before_reservation(self):
        with self.assertRaises(ValueError):
            self.send(text="\x00" * 4000)  # JSON escapes exceed full-wire limit.
        self.assertEqual(self.ledger.snapshot()["reserved_micro_usd"], 0)
        self.transport.assert_not_called()

    def test_missing_corrupt_locked_and_inconsistent_ledger_fail_closed(self):
        self.path.unlink()
        self.assertEqual(self.send()[0]["status"], "unavailable")
        self.assertFalse(self.path.exists())
        with self.assertRaises(FileExistsError):
            Ledger.initialize(self.path)  # surviving anchor prevents fresh funds
        self.path.write_bytes(b"corrupt")
        self.assertEqual(self.send()[0]["status"], "unavailable")
        self.path = Path(self.tmp.name) / "another.sqlite3"
        self.epoch = Ledger.initialize(self.path)
        self.env["LEADSCORER_JEV_LEDGER_EPOCH"] = self.epoch
        self.ledger = Ledger(self.path, lambda: self.now)
        self.controller = PublicJev(self.env, self.ledger, self.transport, True)
        with connection(self.path) as db:
            db.execute("BEGIN IMMEDIATE")
            self.assertEqual(self.send()[0]["status"], "unavailable")
        with connection(self.path) as db:
            db.execute("UPDATE budget SET reserved=20000")
        self.assertEqual(self.send()[0]["status"], "unavailable")
        self.transport.assert_not_called()

    def test_ephemeral_root_is_rejected_even_when_ledger_exists(self):
        with patch("jev_guard.os.path.ismount", return_value=False), patch("jev_guard.LEDGER_PATH", self.path):
            self.assertIn("persistent_ledger_unavailable", PublicJev(self.env).status()["blockers"])
        with self.assertRaises(FileExistsError):
            Ledger.initialize(self.path)

    def test_restoring_only_database_cannot_reopen_spent_allowance(self):
        older = Path(self.tmp.name) / "before-reservation.sqlite3"
        shutil.copyfile(self.path, older)
        self.send()
        self.assertEqual(self.ledger.read_anchor()["reserved"], RESERVE_MICRO_USD)
        shutil.copyfile(older, self.path)
        self.assertFalse(self.controller.status()["service_ready"])
        self.assertEqual(self.send()[0]["status"], "unavailable")
        self.transport.assert_called_once()

    def test_fresh_volume_epoch_does_not_inherit_previous_activation(self):
        replacement = Path(self.tmp.name) / "replacement.sqlite3"
        new_epoch = Ledger.initialize(replacement)
        self.assertNotEqual(new_epoch, self.epoch)
        controller = PublicJev(self.env, Ledger(replacement), self.transport, True)
        self.assertIn("ledger_epoch_unbound", controller.status()["blockers"])
        self.assertEqual(controller.classify(BODY, "client", key())[0]["status"], "unavailable")
        self.transport.assert_not_called()

    def test_crash_between_highwater_mark_and_commit_fails_closed(self):
        with patch.object(self.ledger, "write_anchor", side_effect=lambda value: (Ledger.write_anchor(self.ledger, value), (_ for _ in ()).throw(OSError("synthetic crash")))):
            self.assertEqual(self.send()[1], 503)
        self.assertEqual(self.ledger.read_anchor()["reserved"], RESERVE_MICRO_USD)
        self.assertFalse(self.controller.status()["service_ready"])
        self.transport.assert_not_called()

    def test_entire_volume_rollback_is_not_claimed_safe_and_production_stays_blocked(self):
        # Same-volume state cannot detect restoration of BOTH old files.
        # Record this limitation, and verify the real HTTP policy still refuses
        # transport even when such a ledger is internally self-consistent.
        old_db = self.path.read_bytes()
        old_anchor = self.ledger.anchor_path.read_bytes()
        self.send()
        self.path.write_bytes(old_db)
        self.ledger.anchor_path.write_bytes(old_anchor)
        self.assertEqual(self.ledger.snapshot()["reserved_micro_usd"], 0)
        live = PublicJev(self.env, self.ledger)
        self.assertIn("cost_bound_unverified", live.status()["blockers"])
        self.assertEqual(live.classify(BODY, "client", key())[0]["status"], "unavailable")
        self.transport.assert_called_once()

    def test_every_gate_and_consent_remain_required(self):
        for item in self.env:
            env = dict(self.env)
            del env[item]
            controller = PublicJev(env, self.ledger, self.transport, True)
            self.assertFalse(controller.status()["service_ready"])
            self.assertEqual(controller.classify(BODY, "client", key())[0]["status"], "unavailable")
        for item, value in [("data_classification", []), ("data_classification", "private"),
                            ("allow_transmission", False), ("confirm_cost", False)]:
            self.assertEqual(self.controller.classify(dict(BODY, **{item: value}), "client", key())[0]["status"], "blocked")
        self.transport.assert_not_called()

    def test_bad_idempotency_keys_never_reserve_or_transmit(self):
        for item in [None, "short", "x" * 129, "x" * 15 + " ", "😀" * 16]:
            self.assertEqual(self.controller.classify(BODY, "client", item)[1], 400)
        self.assertEqual(self.ledger.snapshot()["reserved_micro_usd"], 0)
        self.transport.assert_not_called()

    def test_lifetime_cap_three_fifty_without_renewal(self):
        for i in range(175):
            self.now += 61
            result, code = self.send(text=f"Synthetic item {i}", request_key=key(i))
            self.assertEqual((code, result["status"]), (200, "ok"))
        self.assertEqual(self.ledger.snapshot()["reserved_micro_usd"], CAP_MICRO_USD)
        self.now += 365 * 86400
        self.controller = PublicJev(self.env, Ledger(self.path, lambda: self.now), self.transport, True)
        self.assertEqual(self.send(text="Next year", request_key=key(201))[0]["status"], "unavailable")
        self.assertEqual(self.transport.call_count, 175)

    def test_process_death_after_commit_keeps_hold_and_inflight_tombstone(self):
        code = "from jev_budget import Ledger; import os,sys; Ledger(sys.argv[1]).reserve('client',sys.argv[2],{'text':'crash'}); os._exit(17)"
        completed = subprocess.run([sys.executable, "-B", "-c", code, str(self.path), key()], capture_output=True)
        self.assertEqual(completed.returncode, 17, completed.stderr.decode())
        self.assertEqual(Ledger(self.path).snapshot()["reserved_micro_usd"], RESERVE_MICRO_USD)
        with self.assertRaises(AdmissionError) as error:
            Ledger(self.path).reserve("client", key(), {"text": "crash"})
        self.assertEqual(error.exception.code, 409)

    def test_overlapping_deploy_processes_cannot_overreserve_last_slot(self):
        for i in range(174):
            self.now += 61
            request_hash, _ = self.ledger.reserve(f"client-{i}", key(i), {"text": str(i)})
            self.ledger.finish(request_hash, {"status": "ok"}, 1)
        barrier = Path(self.tmp.name) / "start"
        code = """import pathlib,sys,time
from jev_budget import Ledger,AdmissionError
while not pathlib.Path(sys.argv[2]).exists(): time.sleep(.01)
try:
    Ledger(sys.argv[1]).reserve(sys.argv[3],sys.argv[4],{'text':sys.argv[3]})
    print('accepted')
except AdmissionError as error: print(error.code)
"""
        processes = [subprocess.Popen([sys.executable, "-B", "-c", code, str(self.path), str(barrier), f"deploy-{i}", key(i + 200)],
                                      stdout=subprocess.PIPE, stderr=subprocess.PIPE) for i in range(6)]
        barrier.touch()
        outputs = []
        for process in processes:
            stdout, stderr = process.communicate(timeout=10)
            self.assertEqual(process.returncode, 0, stderr.decode())
            outputs.append(stdout.decode().strip())
        self.assertEqual(outputs.count("accepted"), 1, outputs)
        self.assertEqual(Ledger(self.path).snapshot()["reserved_micro_usd"], CAP_MICRO_USD)

    def test_untrusted_forwarding_headers_do_not_change_client_bucket(self):
        headers = email.message.Message()
        headers["X-Forwarded-For"] = "1.1.1.1"
        headers["Fly-Client-IP"] = "2.2.2.2"
        self.assertEqual(client_identity("127.0.0.1", headers), "127.0.0.1")
        self.assertEqual(client_identity("fdaa::1", headers), "fdaa::/64")
        headers["Fly-Client-IP"] = "3.3.3.3"
        self.assertEqual(client_identity("fdaa::1", headers), "fdaa::/64")
        self.assertEqual(client_identity("2001:db8::1", headers), client_identity("2001:db8::ffff", headers))



class PublicHTTPTests(PublicFixture, unittest.TestCase):
    # Only real HTTP tests here; don't duplicate all ledger tests in this class.
    def setUp(self):
        super().setUp()
        self.server = app.create_server(0)
        self.server.jev_controller = self.controller
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop)
        self.env_patch = patch.dict(os.environ, {"LEADSCORER_ALLOWED_ORIGINS": ""}, clear=False)
        self.env_patch.start()
        self.addCleanup(self.env_patch.stop)

    def stop(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(3)

    def http(self, body=BODY, headers=None):
        client = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        self.addCleanup(client.close)
        client.request("POST", "/api/jev/classify", json.dumps(body).encode(),
                       headers or {"Content-Type": "application/json", "Idempotency-Key": key()})
        response = client.getresponse()
        return response.status, json.loads(response.read())

    def test_http_service_replay_and_key_conflict(self):
        self.assertEqual(self.http()[1]["status"], "ok")
        self.assertTrue(self.http()[1]["replayed"])
        self.now += 61
        self.assertEqual(self.http(dict(BODY, text="changed"))[0], 409)
        self.transport.assert_called_once()

    def test_http_invalid_shapes_payload_limit_and_missing_key(self):
        for body in [[], {"mode": []}, dict(BODY, text="x" * 4001), dict(BODY, text="x" * 20001),
                     dict(BODY, account="private"), dict(BODY, mode={})]:
            self.assertEqual(self.http(body)[0], 400)
        self.assertEqual(self.http(headers={"Content-Type": "application/json"})[0], 400)
        self.transport.assert_not_called()

    def test_http_duplicate_headers_json_and_chunked_are_rejected(self):
        variants = [("Content-Length: 2\r\nContent-Length: 2\r\n", "{}", 400),
                    ("Content-Length: 2\r\nTransfer-Encoding: chunked\r\n", "{}", 400),
                    ("Content-Length: 2\r\nOrigin: null\r\nOrigin: null\r\n", "{}", 403),
                    ("Content-Length: 27\r\n", '{"mode":"mock","mode":false}', 400)]
        for extra, body, expected in variants:
            client = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
            client.connect()
            request = "POST /api/jev/classify HTTP/1.0\r\nContent-Type: application/json\r\n" + extra + "\r\n" + body
            client.sock.sendall(request.encode())
            response = http.client.HTTPResponse(client.sock)
            response.begin()
            self.assertEqual(response.status, expected)
            self.assertNotIn("Traceback", response.read().decode())
            client.close()
        self.transport.assert_not_called()

    def test_http_origin_and_checkbox_cannot_enable_unverified_live_policy(self):
        self.server.jev_controller = PublicJev(self.env, self.ledger)
        with patch.dict(os.environ, {"LEADSCORER_ALLOWED_ORIGINS": "https://leadscorer.fly.dev"}, clear=False):
            code, result = self.http(headers={"Content-Type": "application/json", "Origin": "https://leadscorer.fly.dev"})
        self.assertEqual((code, result["status"]), (200, "unavailable"))
        self.transport.assert_not_called()

    def test_http_thread_bound_rejects_without_starting_transport(self):
        for _ in range(8):
            self.assertTrue(self.server.slots.acquire(blocking=False))
        try:
            client = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
            try:
                client.connect()
                client.sock.sendall(b"POST /api/jev/classify HTTP/1.0\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}")
                response = http.client.HTTPResponse(client.sock)
                response.begin()
                self.assertEqual(response.status, 503)
                self.assertEqual(response.read(), b"")
            finally:
                client.close()
        finally:
            for _ in range(8):
                self.server.slots.release()
        self.transport.assert_not_called()

    def test_inbound_trickles_release_all_workers_at_total_deadline(self):
        clients = []
        with patch("app.INBOUND_TIMEOUT", .3):
            try:
                for _ in range(8):
                    client = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=2)
                    client.connect()
                    client.sock.sendall(b"POST /api/jev/classify HTTP/1.0\r\nContent-Type: application/json\r\nContent-Length: 20000\r\n\r\n{")
                    clients.append(client)
                start = time.monotonic()
                # Every individual wait is below .3s. Only a total deadline
                # can release these requests while bytes continue arriving.
                while time.monotonic() - start < .55:
                    for client in clients:
                        try:
                            client.sock.sendall(b" ")
                        except OSError:
                            pass
                    time.sleep(.06)
                client = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=2)
                try:
                    client.request("GET", "/api/pipeline")
                    response = client.getresponse()
                    self.assertEqual(response.status, 200)
                    self.assertEqual(len(json.loads(response.read())["rows"]), 2089)
                finally:
                    client.close()
            finally:
                for client in clients:
                    client.close()
        self.transport.assert_not_called()

    def test_http_restart_reuses_ledger_and_preserves_pipeline(self):
        before = app.dataset()
        self.http()
        self.server.jev_controller = PublicJev(self.env, Ledger(self.path, lambda: self.now), self.transport, True)
        self.assertTrue(self.http()[1]["replayed"])
        self.assertEqual(app.dataset(), before)
        self.assertEqual(before["queue_counts"], {"conversion": 212, "cleanup": 1377, "qualify": 500})


class TransportTests(unittest.TestCase):
    class Response:
        def __init__(self, chunks, close_on_last=True):
            self.chunks = list(chunks)
            self.close_on_last = close_on_last
            self.socket = Mock()
            self.fp = SimpleNamespace(raw=SimpleNamespace(_sock=self.socket))

        def __enter__(self):
            return self

        def __exit__(self, *args):
            self.fp = None

        def read1(self, size):
            chunk = self.chunks.pop(0) if self.chunks else b""
            if not self.chunks and self.close_on_last:
                self.fp = None
            return chunk

    def test_fixed_openrouter_destination_no_redirect_proxy_or_retry(self):
        response = self.Response([b"{}"])
        opener = Mock()
        opener.open.return_value = response
        with patch("jev.build_opener", return_value=opener) as factory:
            self.assertEqual(jev.http_transport({}, "synthetic-key", "openrouter"), {})
        request = opener.open.call_args.args[0]
        self.assertEqual(request.full_url, "https://openrouter.ai/api/v1/systemone")
        self.assertEqual(request.get_header("Authorization"), "Bearer synthetic-key")
        self.assertEqual(opener.open.call_args.kwargs["timeout"], 5)
        self.assertEqual(factory.call_args.args[0].proxies, {})
        self.assertIsInstance(factory.call_args.args[1], jev.NoRedirect)
        with self.assertRaises(ValueError):
            factory.call_args.args[1].redirect_request(request, None, 302, "", {}, "https://other.example")
        opener.open.assert_called_once()

    def test_slow_trickles_hit_absolute_read_deadline(self):
        response = self.Response([b"{", b"}"], close_on_last=False)
        opener = Mock()
        opener.open.return_value = response
        with patch("jev.build_opener", return_value=opener), patch("jev.time.monotonic", side_effect=[0, 1, 5.01]):
            with self.assertRaises(TimeoutError):
                jev.http_transport({}, "synthetic-key", "openrouter")
        response.socket.settimeout.assert_called_once_with(4)
        opener.open.assert_called_once()

    def test_response_size_bound_and_bad_json_are_rejected_offline(self):
        for chunks in [[b"x" * 65537], [b"not-json"]]:
            response = self.Response(chunks)
            opener = Mock()
            opener.open.return_value = response
            with patch("jev.build_opener", return_value=opener), self.assertRaises(ValueError):
                jev.http_transport({}, "synthetic-key", "openrouter")
            opener.open.assert_called_once()
