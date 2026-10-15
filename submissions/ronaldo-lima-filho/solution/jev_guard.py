"""Public JEV admission. Origin and UI consent do not identify a caller.

Production transport is blocked until a provable per-call monetary ceiling
exists. No environment switch bypasses that block. Test injection is offline.
"""
import ipaddress
import os
from decimal import Decimal, ROUND_CEILING
from pathlib import Path
import jev
from jev_budget import AdmissionError, Ledger, RESERVE_MICRO_USD, CAP_MICRO_USD

VOLUME_ROOT = Path("/data/jev")
LEDGER_PATH = VOLUME_ROOT / "ledger.sqlite3"


def client_identity(peer, headers):
    """No proxy header is trusted until the exact ingress path is verified."""
    address = ipaddress.ip_address(peer)
    # Group IPv6 privacy addresses into one /64; rotating addresses cannot
    # bypass the client window within that subnet. Global limits remain final.
    return (str(ipaddress.ip_network(str(address) + "/64", strict=False))
            if address.version == 6 else str(address))


class PublicJev:
    def __init__(self, environ=None, ledger=None, transport=None, verified_cost_bound=False):
        self.environ = environ
        self.ledger = ledger
        self.transport = transport
        # A verified fixture policy MUST NOT enable the real transport.
        self.offline_verified_policy = bool(verified_cost_bound and transport is not None)

    def env(self):
        return os.environ if self.environ is None else self.environ

    def _ledger(self):
        if self.ledger is not None:
            return self.ledger
        if not os.path.ismount(VOLUME_ROOT) or not LEDGER_PATH.is_file():
            raise AdmissionError(503, "Persistência de gasto indisponível")
        return Ledger(LEDGER_PATH, expected_epoch=self.env().get("LEADSCORER_JEV_LEDGER_EPOCH"))

    def status(self):
        result = jev.status(self.env())
        blockers = []
        if result["provider"] != jev.OPENROUTER_PROVIDER:
            blockers.append("public_openrouter_required")
        if not result["service_ready"]:
            blockers.append("server_gates_or_secret_missing")
        if not self.offline_verified_policy:
            blockers.append("cost_bound_unverified")
        try:
            budget = self._ledger().snapshot()
        except AdmissionError:
            blockers.append("persistent_ledger_unavailable")
        else:
            if self.env().get("LEADSCORER_JEV_LEDGER_EPOCH") != budget["epoch"]:
                blockers.append("ledger_epoch_unbound")
            if budget["halted"] or budget["remaining_micro_usd"] < RESERVE_MICRO_USD:
                blockers.append("lifetime_budget_unavailable")
        result.update(service_ready=not blockers, blockers=blockers,
                      lifetime_budget_usd=CAP_MICRO_USD / 1_000_000, budget_renews=False)
        return result

    def classify(self, body, client, key):
        env = dict(self.env())
        # Validate ALL modes before inspecting untrusted mode values.
        preview = jev.classify(body, dict(env, LEADSCORER_JEV_ALLOW_NETWORK="0"))
        if body.get("mode", "disabled") != "service":
            return preview, 200
        if not jev.status(env)["service_ready"]:
            return preview, 200
        if (body.get("allow_transmission") is not True or body.get("confirm_cost") is not True
                or not isinstance(body.get("data_classification"), str)
                or body["data_classification"] not in {"synthetic", "public"}):
            preview.update(status="blocked", message="Envio exige texto público/sintético e confirmação de custo")
            return preview, 200
        if not self.status()["service_ready"]:
            preview.update(status="unavailable", message="JEV indisponível: controles de gasto ainda não aprovados ou incompletos. Nenhum texto foi enviado.")
            return preview, 200
        try:
            ledger = self._ledger()
            payload = jev.request_body(body["text"].strip(), jev.OPENROUTER_PROVIDER)
            jev.encoded_payload(payload)  # Full fixed question + input, before reserve/dispatch.
            key_hash, replay = ledger.reserve(client, key, payload)
            if replay is not None:
                return dict(replay, replayed=True), 200
            # Reservation is COMMITTED before any transport may start.
            try:
                result = jev.classify(body, env, self.transport)
            except Exception:
                result = dict(preview, status="unavailable", message="Serviço indisponível; envio não será repetido")
            cost = result.get("usage", {}).get("cost")
            actual = (int((Decimal(str(cost)) * 1_000_000).to_integral_value(rounding=ROUND_CEILING))
                      if cost is not None else None)
            usage = result.get("usage", {})
            # Candidate tariff sanity check, not a contractual cost bound.
            expected = (int((Decimal(usage["input_tokens"]) * Decimal("0.042")).to_integral_value(rounding=ROUND_CEILING))
                        if "input_tokens" in usage else None)
            consistent = (actual is None or (expected is not None and abs(actual - expected) <= 1
                                             and usage["input_tokens"] <= 262144))
            if not ledger.finish(key_hash, result, actual, cost_consistent=consistent):
                result = dict(preview, status="unavailable", message="Resultado indisponível; reserva mantida e envio não será repetido")
            return result, 200
        except AdmissionError as error:
            return {"error": error.message, "baseline_unchanged": True}, error.code
