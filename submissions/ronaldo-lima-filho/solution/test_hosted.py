"""Exercise the proposed Fly wrapper locally, with no provider access."""
import importlib.util
import json
import os
from pathlib import Path
import threading
import unittest
from unittest.mock import patch
from urllib.request import Request, build_opener, ProxyHandler


def load_wrapper():
    path = Path(__file__).resolve().parent.parent / "deployment" / "demo_server.py"
    spec = importlib.util.spec_from_file_location("reviewed_demo_server", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class HostedTests(unittest.TestCase):
    def test_wrapper_never_activates_even_when_gates_and_synthetic_keys_exist(self):
        with patch.dict(os.environ, {"LEADSCORER_JEV_ENABLED": "1",
                                    "LEADSCORER_JEV_ALLOW_NETWORK": "1",
                                    "LEADSCORER_JEV_ALLOW_SPENDING": "1",
                                    "OPENROUTER_API_KEY": "synthetic-only",
                                    "TYPESAFE_API_KEY": "synthetic-only"}, clear=False):
            load_wrapper()
            for gate in ["LEADSCORER_JEV_ENABLED", "LEADSCORER_JEV_ALLOW_NETWORK", "LEADSCORER_JEV_ALLOW_SPENDING"]:
                self.assertEqual(os.environ[gate], "0")
            self.assertNotIn("OPENROUTER_API_KEY", os.environ)
            self.assertNotIn("TYPESAFE_API_KEY", os.environ)

    def test_current_pr_ui_workflow_health_and_origin_work_in_fly_wrapper(self):
        with patch.dict(os.environ, {"LEADSCORER_ALLOWED_ORIGINS": "https://leadscorer.fly.dev"}, clear=False), patch("jev.http_transport") as transport:
            wrapper = load_wrapper()
            with wrapper.DemoServer(("127.0.0.1", 0), "https://leadscorer.fly.dev") as server:
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                base = f"http://127.0.0.1:{server.server_port}"
                opener = build_opener(ProxyHandler({}))
                try:
                    for path in ["/", "/workflow.js", "/healthz", "/api/jev/status"]:
                        with opener.open(base + path, timeout=3) as response:
                            self.assertEqual(response.status, 200)
                            content = response.read()
                            if path == "/":
                                self.assertIn("DEMONSTRAÇÃO HOSPEDADA", content.decode())
                                self.assertIn("default-src 'self'", response.headers["Content-Security-Policy"])
                            elif path == "/healthz":
                                health = json.loads(content)
                                self.assertEqual(health["open_rows"], 2089)
                                self.assertFalse(health["jev_real_enabled"])
                            elif path == "/api/jev/status":
                                self.assertFalse(json.loads(content)["service_ready"])
                    request = Request(base + "/api/jev/classify", data=json.dumps({"mode": "mock", "text": "Synthetic"}).encode(),
                                      headers={"Content-Type": "application/json", "Origin": "https://leadscorer.fly.dev"})
                    with opener.open(request, timeout=3) as response:
                        self.assertEqual(json.load(response)["status"], "mock")
                finally:
                    server.shutdown()
                    thread.join(3)
            transport.assert_not_called()
