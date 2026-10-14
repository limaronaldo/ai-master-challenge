"""Exercise the real HTTP path used by the UI, including bad rules."""
import json
import threading
import unittest
from unittest.mock import patch
from http.server import HTTPServer
from urllib.request import urlopen, Request
from urllib.error import HTTPError
from app import Handler

class HTTPContracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), Handler)
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

    def post(self, body, origin=None):
        headers={"Content-Type":"application/json"}
        if origin:headers["Origin"]=origin
        return urlopen(Request(self.url+"/api/jev/classify",data=json.dumps(body).encode(),headers=headers))

    def test_jev_modes_preserve_live_pipeline(self):
        with urlopen(self.url+"/api/pipeline") as response: before=json.load(response)
        for mode,expected in [("disabled","disabled"),("mock","mock"),("service","unavailable")]:
            with patch.dict("os.environ",{},clear=True), self.post({"mode":mode,"text":"Synthetic: agreed a next meeting."}) as response:
                result=json.load(response);self.assertEqual(result["status"],expected)
        with urlopen(self.url+"/api/pipeline") as response:self.assertEqual(json.load(response),before)

    def test_jev_rejects_cross_origin_and_bad_inputs(self):
        for body,origin,code in [({},"https://untrusted.example",403),({"mode":"mock","text":""},None,400),
                                  ({"mode":"mock","text":"x"*4001},None,400)]:
            with self.assertRaises(HTTPError) as error:self.post(body,origin)
            self.assertEqual(error.exception.code,code);error.exception.close()

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
