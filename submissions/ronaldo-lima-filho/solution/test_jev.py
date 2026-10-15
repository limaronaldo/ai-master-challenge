import copy
import json
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError, URLError
import jev


class JevContracts(unittest.TestCase):
    def setUp(self):
        self.env = {"LEADSCORER_JEV_ENABLED": "1", "LEADSCORER_JEV_ALLOW_NETWORK": "1",
                    "LEADSCORER_JEV_ALLOW_SPENDING": "1", "TYPESAFE_API_KEY": "synthetic-test-key"}
        self.body = {"mode": "service", "text": "Synthetic: a next meeting was agreed.",
                     "data_classification": "synthetic", "allow_transmission": True, "confirm_cost": True}
        self.response = {"model": jev.MODEL, "answers": {"text_context": {"type": "choice",
                         "choice": "explicit_next_step", "probabilities": {"explicit_next_step": .8,
                         "explicit_objection": .1, "insufficient_context": .1}, "confidence": .7}}}

    def test_disabled_and_mock_never_call_transport(self):
        transport = Mock(side_effect=AssertionError("network forbidden"))
        self.assertEqual(jev.classify({}, self.env, transport)["status"], "disabled")
        result = jev.classify({"mode": "mock", "text": "Synthetic only"}, {}, transport)
        self.assertEqual(result["source"], "synthetic_fixture")
        self.assertIsNone(result["classification"]["confidence"])
        transport.assert_not_called()

    def test_three_selected_fixtures_ignore_text_and_preserve_contract(self):
        transport = Mock(side_effect=AssertionError('network forbidden'))
        for category in jev.CRITERIA:
            a = jev.classify({'mode': 'mock', 'text': 'Contradictory arbitrary text', 'mock_category': category}, self.env, transport)
            b = jev.classify({'mode': 'mock', 'text': 'Different text', 'mock_category': category}, {}, transport)
            self.assertEqual(a, b)
            self.assertEqual(a['classification']['category'], category)
            self.assertEqual(a['status'], 'mock')
            self.assertEqual(a['source'], 'synthetic_fixture')
            self.assertIsNone(a['classification']['probabilities'])
            self.assertIsNone(a['classification']['confidence'])
            self.assertIn('não é uma leitura', a['message'])
            a['classification']['category'] = 'mutated'
            self.assertEqual(jev.MOCK_FIXTURES[category]['category'], category)
        self.assertEqual(jev.classify({'mode': 'mock', 'text': 'Synthetic'}, {}, transport)['classification']['category'], 'insufficient_context')
        transport.assert_not_called()

    def test_mock_selection_rejected_in_other_modes_and_for_invalid_categories(self):
        transport = Mock(side_effect=AssertionError('network forbidden'))
        for body in [dict(self.body, mock_category='explicit_next_step'),
                     {'mode': 'disabled', 'mock_category': 'insufficient_context'},
                     *({'mode': 'mock', 'text': 'Synthetic', 'mock_category': c}
                       for c in ['invalid', None, [], {}, 1])]:
            with self.subTest(body=body), self.assertRaises(ValueError):
                jev.classify(body, self.env, transport)
        transport.assert_not_called()

    def test_every_gate_required_even_with_credentials(self):
        for key in self.env:
            env = dict(self.env); env.pop(key)
            transport = Mock()
            self.assertEqual(jev.classify(self.body, env, transport)["status"], "unavailable")
            transport.assert_not_called()
        for key in ["allow_transmission", "confirm_cost", "data_classification"]:
            body = dict(self.body); body.pop(key)
            transport = Mock()
            self.assertEqual(jev.classify(body, self.env, transport)["status"], "blocked")
            transport.assert_not_called()
        self.assertEqual(jev.classify(dict(self.body, data_classification="private"), self.env, Mock())["status"], "blocked")

    def test_official_payload_and_separate_result(self):
        transport = Mock(return_value=self.response); original = copy.deepcopy(self.body)
        result = jev.classify(self.body, self.env, transport)
        sent = transport.call_args.args[0]
        self.assertEqual(sent["model"], "jev-1.13.0")
        self.assertEqual(sent["state"], {"text": self.body["text"]})
        self.assertEqual(sent["questions"]["text_context"]["type"], "choice")
        self.assertNotIn("score", result); self.assertTrue(result["baseline_unchanged"])
        self.assertEqual(result["source"], "typesafe_service"); self.assertEqual(self.body, original)

    def test_empty_oversize_wrong_types_and_unknown_fields(self):
        for body in [[], {"mode": "other"}, {"mode": []}, {"mode": "mock", "text": ""},
                     {"mode": "mock", "text": "x"*4001}, {"mode": "mock", "text": 1},
                     {"mode": "mock", "text": "Synthetic", "account": "not allowed"}]:
            with self.subTest(body=str(body)[:40]), self.assertRaises(ValueError):
                jev.classify(body, {}, Mock())

    def test_unhashable_classification_is_blocked_without_transport(self):
        transport = Mock()
        body = dict(self.body, data_classification=[])
        result = jev.classify(body, self.env, transport)
        self.assertEqual(result["status"], "blocked")
        transport.assert_not_called()

    def test_failures_are_explicit_without_leaking_raw_error(self):
        for error in [TimeoutError("secret text"), URLError("secret key"),
                      HTTPError(jev.ENDPOINT,429,"secret",{},None), ValueError("secret body")]:
            result = jev.classify(self.body, self.env, Mock(side_effect=error))
            self.assertIn(result["status"], {"unavailable", "invalid_response"})
            self.assertNotIn("secret", json.dumps(result)); self.assertTrue(result["baseline_unchanged"])

    def test_malformed_model_category_confidence_and_probabilities(self):
        mutations = [lambda r:r.update(model="unknown"),
                     lambda r:r["answers"]["text_context"].update(choice="injected"),
                     lambda r:r["answers"]["text_context"].update(confidence=float("nan")),
                     lambda r:r["answers"]["text_context"].update(probabilities={"explicit_next_step": 1}),
                     lambda r:r["answers"]["text_context"].update(choice="explicit_objection"),
                     lambda r:r["answers"]["text_context"].update(confidence=True)]
        for mutate in mutations:
            response = copy.deepcopy(self.response); mutate(response)
            self.assertEqual(jev.classify(self.body,self.env,Mock(return_value=response))["status"],"invalid_response")

    def test_disabled_default_without_credentials_or_network(self):
        with patch.dict("os.environ", {}, clear=True), patch("jev.http_transport") as transport:
            self.assertFalse(jev.status()["service_ready"])
            self.assertEqual(jev.classify(self.body)["status"], "unavailable")
            transport.assert_not_called()
