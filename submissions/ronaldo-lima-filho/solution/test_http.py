"""Exercise the real HTTP path used by the UI, including bad rules."""
import json
import os
import socket
import urllib.request
import threading
import unittest
from unittest.mock import patch
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.request import urlopen, Request
from urllib.error import HTTPError
from app import Handler, create_server

class HTTPContracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = create_server(0)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = "http://127.0.0.1:" + str(cls.server.server_port)
    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
    def test_live_pipeline_and_explanation(self):
        with urlopen(self.url + "/api/pipeline") as response:
            data = json.load(response)
        self.assertEqual((data["total"], len(data["rows"])), (8800, 2089))
        row = next(r for r in data["rows"] if r["id"] == "HAXMC4IX")
        self.assertEqual([f["points"] for f in row["factors"]], [25,30,10])
        self.assertEqual(row["score"], 65)
    def test_invalid_rules_return_400(self):
        for rules in ["%5B%5D", "%7B%22unknown%22%3A1%7D", "%7B%22days_60%22%3A1%7D"]:
            with self.subTest(rules=rules), self.assertRaises(HTTPError) as error:
                urlopen(self.url + "/api/pipeline?rules=" + rules)
            self.assertEqual(error.exception.code, 400)
            error.exception.close()
    def test_local_font_route(self):
        with urlopen(self.url + "/assets/manrope.woff2") as response:
            self.assertEqual(response.headers["Content-Type"], "font/woff2")
            self.assertTrue(response.read().startswith(b"wOF2"))

    def test_local_review_script_route_is_explicit(self):
        with urlopen(self.url + "/workflow.js") as response:
            self.assertEqual(response.headers["Content-Type"], "text/javascript; charset=utf-8")
            self.assertIn(b"ReviewWorkflow", response.read())
        with self.assertRaises(HTTPError) as error:
            urlopen(self.url + "/other.js")
        self.assertEqual(error.exception.code, 404)
        error.exception.close()

    def test_idle_connection_does_not_block_resources_or_pipeline(self):
        accepted = threading.Event()
        idle = socket.socket()
        idle.bind(("127.0.0.1", 0))
        idle_port = idle.getsockname()[1]
        handler = self.server.RequestHandlerClass

        class ObservedHandler(handler):
            def handle_one_request(self):
                if self.client_address[1] == idle_port:
                    accepted.set()
                return super().handle_one_request()

        try:
            with patch.object(self.server, "RequestHandlerClass", ObservedHandler):
                idle.connect(("127.0.0.1", self.server.server_port))
                self.assertTrue(accepted.wait(2), "Idle connection was not accepted")
                # Keep it open without sending a request, like browser preconnections.
                for path, mime in [("/", "text/html"), ("/workflow.js", "text/javascript"),
                                   ("/assets/manrope.woff2", "font/woff2"),
                                   ("/api/pipeline", "application/json")]:
                    with self.subTest(path=path), urlopen(self.url + path, timeout=3) as response:
                        self.assertEqual(response.status, 200)
                        self.assertIn(mime, response.headers["Content-Type"])
                        content = response.read()
                        self.assertTrue(content)
                        if path == "/api/pipeline":
                            data = json.loads(content)
                            self.assertEqual(len(data["rows"]), 2089)
                            self.assertEqual(data["queue_counts"], {
                                "conversion": 212, "cleanup": 1377, "qualify": 500})
        finally:
            idle.close()

    def setUp(self):
        self._origin_env = patch.dict(os.environ, {"LEADSCORER_ALLOWED_ORIGINS": ""}, clear=False)
        self._origin_env.start()
        self.addCleanup(self._origin_env.stop)

    def post(self, body, origin=None):
        headers={"Content-Type":"application/json"}
        if origin is not None:headers["Origin"]=origin
        return urlopen(Request(self.url+"/api/jev/classify",data=json.dumps(body).encode(),headers=headers))

    def test_jev_modes_preserve_live_pipeline(self):
        with urlopen(self.url+"/api/pipeline") as response: before=json.load(response)
        for mode,expected in [("disabled","disabled"),("mock","mock"),("service","unavailable")]:
            with patch.dict("os.environ", {
                "LEADSCORER_JEV_ENABLED": "0",
                "LEADSCORER_JEV_ALLOW_NETWORK": "0",
                "LEADSCORER_JEV_ALLOW_SPENDING": "0",
            }, clear=False), self.post({"mode":mode,"text":"Synthetic: agreed a next meeting."}) as response:
                result=json.load(response);self.assertEqual(result["status"],expected)
        with urlopen(self.url+"/api/pipeline") as response:self.assertEqual(json.load(response),before)

    def test_jev_rejects_cross_origin_and_bad_inputs(self):
        for body,origin,code in [({},"https://untrusted.example",403),({"mode":"mock","text":""},None,400),
                                  ({"mode":"mock","text":"x"*4001},None,400),({"mode":[]},None,400)]:
            with self.assertRaises(HTTPError) as error:self.post(body,origin)
            self.assertEqual(error.exception.code,code);error.exception.close()

    def test_configured_origin_allowlist_is_exact_and_requires_origin(self):
        body = {"mode": "mock", "text": "Synthetic text",
                "mock_category": "explicit_objection"}
        with patch.dict(os.environ, {
            "LEADSCORER_ALLOWED_ORIGINS": "https://leadscorer.fly.dev"
        }, clear=False):
            with self.post(body, "https://leadscorer.fly.dev") as response:
                self.assertEqual(json.load(response)["status"], "mock")
            for origin in [None, "https://evil.example",
                           "https://leadscorer.fly.dev.attacker.example",
                           "https://leadscorer.fly.dev/"]:
                with self.subTest(origin=origin), self.assertRaises(HTTPError) as error:
                    self.post(body, origin)
                self.assertEqual(error.exception.code, 403)
                error.exception.close()

        for configured in ["*", "https://leadscorer.fly.dev/"]:
            with patch.dict(os.environ, {
                "LEADSCORER_ALLOWED_ORIGINS": configured
            }, clear=False):
                with self.subTest(configured=configured), self.assertRaises(HTTPError) as error:
                    self.post(body, "https://leadscorer.fly.dev")
                self.assertEqual(error.exception.code, 503)
                error.exception.close()

    def test_mock_accepts_actual_loopback_origin_and_rejects_other_ports(self):
        body = {'mode': 'mock', 'text': 'Synthetic text', 'mock_category': 'explicit_objection'}
        with self.post(body, self.url) as response:
            self.assertEqual(json.load(response)['classification']['category'], 'explicit_objection')
        for origin in ['http://127.0.0.1:1', 'https://127.0.0.1:' + str(self.server.server_port),
                       'http://untrusted.example:' + str(self.server.server_port)]:
            with self.subTest(origin=origin), self.assertRaises(HTTPError) as error:
                self.post(body, origin)
            self.assertEqual(error.exception.code, 403)
            error.exception.close()

    def test_jev_modes_preserve_cached_proxy_bypass_and_environment(self):
        hits = []
        class RejectingProxy(BaseHTTPRequestHandler):
            def do_GET(self):
                hits.append(self.command)
                self.send_error(403, "Synthetic loopback proxy")
            do_POST = do_GET
            def log_message(self, *args):
                pass
        proxy = HTTPServer(("127.0.0.1", 0), RejectingProxy)
        thread = threading.Thread(target=proxy.serve_forever, daemon=True)
        thread.start()
        cached = urllib.request._opener
        before = dict(os.environ)
        proxy_url = "http://127.0.0.1:" + str(proxy.server_port)
        try:
            with patch.dict(os.environ, {
                "HTTP_PROXY": proxy_url, "http_proxy": proxy_url,
                "NO_PROXY": "127.0.0.1,localhost", "no_proxy": "127.0.0.1,localhost",
                "LEADSCORER_JEV_ENABLED": "1",
                "LEADSCORER_JEV_ALLOW_NETWORK": "1",
                "LEADSCORER_JEV_ALLOW_SPENDING": "1",
            }, clear=False), patch("jev.http_transport") as transport:
                urllib.request.install_opener(urllib.request.build_opener())
                handlers = urllib.request._opener.handlers
                self.assertTrue(any(isinstance(h, urllib.request.ProxyHandler)
                                    and h.proxies.get("http") == proxy_url for h in handlers))
                configured = dict(os.environ)
                self.test_jev_modes_preserve_live_pipeline()
                self.assertEqual(dict(os.environ), configured)
                self.assertEqual(hits, [])
                transport.assert_not_called()
        finally:
            urllib.request._opener = cached
            proxy.shutdown()
            proxy.server_close()
            thread.join()
        self.assertEqual(dict(os.environ), before)
