"""Local, dependency-free CRM priority queue. Never predicts conversion probability."""
import csv
import json
import hashlib
import math
import io
from collections import Counter
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from statistics import median
from urllib.parse import urlparse, parse_qs
import jev
import revops

ROOT = Path(__file__).resolve().parent
AS_OF = date(2017, 12, 31)
ALIASES = {"GTXPro": "GTX Pro"}
RULES = {"engaging": 25, "prospecting": 10, "age_30": 10, "age_60": 20,
         "age_90": 30, "value_1000": 10, "value_5000": 20, "value_10000": 25,
         "days_30": 30, "days_60": 60, "days_90": 90,
         "price_1000": 1000, "price_5000": 5000, "price_10000": 10000}
RULE_VERSION = "review-v1.3"
EVIDENCE_VERSION = "context-v1.2"
IMPLEMENTATION_VERSION = "local-v1.11.1"
SCORE_FIELDS = ("opportunity_id", "product", "account", "sales_agent", "deal_stage", "engage_date")
SCHEMAS = {
    "accounts.csv": ("account", "sector", "year_established", "revenue", "employees", "office_location", "subsidiary_of"),
    "products.csv": ("product", "series", "sales_price"),
    "sales_teams.csv": ("sales_agent", "manager", "regional_office"),
    "sales_pipeline.csv": ("opportunity_id", "sales_agent", "product", "account", "deal_stage", "engage_date", "close_date", "close_value"),
}


class DataContractError(ValueError):
    """Invalid structure, never silently discard or overwrite rows."""


def validate_rules(overrides=None):
    rules = dict(RULES)
    for key, value in (overrides or {}).items():
        if key not in rules or isinstance(value, bool) or not isinstance(value, int):
            raise ValueError("Regras devem usar chaves conhecidas e inteiros")
        maximum = 3650 if key.startswith("days_") else 1000000 if key.startswith("price_") else 30 if key.startswith("age_") else 25 if key.startswith("value_") or key in {"engaging", "prospecting"} else 10
        if not 0 <= value <= maximum:
            raise ValueError("Valor fora dos limites: " + key)
        rules[key] = value
    for keys in [("days_30", "days_60", "days_90"), ("price_1000", "price_5000", "price_10000")]:
        if not 0 < rules[keys[0]] < rules[keys[1]] < rules[keys[2]]:
            raise ValueError("Limiares devem ser positivos e estritamente crescentes")
    return rules


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def data_hash():
    return fingerprint({name: hashlib.sha256((ROOT / "data" / name).read_bytes()).hexdigest()
                        for name in ["accounts.csv", "products.csv", "sales_teams.csv", "sales_pipeline.csv"]})


def read_table(name, raw=None):
    raw = (ROOT / "data" / name).read_bytes() if raw is None else raw
    with io.StringIO(raw.decode("utf-8-sig"), newline="") as stream:
        reader = csv.DictReader(stream)
        required = SCHEMAS[name]
        if reader.fieldnames is None or len(set(reader.fieldnames)) != len(reader.fieldnames) or not set(required) <= set(reader.fieldnames):
            raise DataContractError(name + ": cabeçalhos ausentes ou duplicados")
        rows = list(reader)
    seen = set()
    key = required[0]
    for row in rows:
        if None in row or any(v is None for v in row.values()):
            raise DataContractError(name + ": quantidade de colunas inconsistente")
        identity = row[key]
        if name == "products.csv":
            identity = ALIASES.get(identity, identity)
            row[key] = identity
            try:
                price = float(row["sales_price"])
                if not math.isfinite(price) or price < 0:
                    raise ValueError()
            except ValueError as error:
                raise DataContractError("products.csv: preço inválido") from error
        if not identity.strip() or identity in seen:
            raise DataContractError(name + ": chave vazia ou duplicada")
        seen.add(identity)
    return rows


def score(opportunity, accounts, products, teams, rules=None, as_of=AS_OF):
    rules = validate_rules(rules)
    # Explicit allowlist: close_date and close_value are never read here.
    product_name = ALIASES.get(opportunity["product"], opportunity["product"])
    product = products.get(product_name, {})
    account = accounts.get(opportunity["account"], {})
    team = teams.get(opportunity["sales_agent"], {})
    factors = []
    missing = []
    stage = opportunity["deal_stage"]
    stage_points = rules["engaging"] if stage == "Engaging" else rules["prospecting"]
    factors.append({"label": "Fase: " + stage, "points": stage_points})
    age = None
    try:
        engaged = date.fromisoformat(opportunity["engage_date"])
        if engaged > as_of:
            missing.append("Data de engajamento futura")
        else:
            age = (as_of - engaged).days
    except (ValueError, TypeError):
        if stage != "Prospecting" or opportunity["engage_date"]:
            missing.append("Data de engajamento ausente/inválida")
    urgency = 0 if age is None else rules["age_90"] if age >= rules["days_90"] else rules["age_60"] if age >= rules["days_60"] else rules["age_30"] if age >= rules["days_30"] else 0
    factors.append({"label": "Tempo desde início do engajamento: " + (str(age) + " dias" if age is not None else "desconhecido") + "; limiares " + "/".join(str(rules[k]) for k in ["days_30", "days_60", "days_90"]) + " dias; não é última atividade", "points": urgency})
    price = float(product["sales_price"]) if product else None
    value = 0 if price is None else rules["value_10000"] if price >= rules["price_10000"] else rules["value_5000"] if price >= rules["price_5000"] else rules["value_1000"] if price >= rules["price_1000"] else 0
    factors.append({"label": "Catálogo: " + (str(price) if price is not None else "desconhecido") + "; limiares " + "/".join(str(rules[k]) for k in ["price_1000", "price_5000", "price_10000"]), "points": value})
    if not product:
        missing.append("Produto sem correspondência")
    if not account:
        missing.append("Conta ausente/sem correspondência")
    if not team:
        missing.append("Vendedor sem correspondência")
    # Coverage remains distinct from actionable defects; expected absence still lacks a signal.
    unavailable = list(missing)
    if stage == "Prospecting" and not opportunity["engage_date"]:
        unavailable.append("Início de Engaging não informado; pode ser esperado em Prospecting")
    suggestion = ("Validar cadastro e contexto antes de priorizar contato." if missing else
                  "Revisar andamento e confirmar próximo passo com a conta." if age is not None and age >= rules["days_60"] else
                  "Confirmar necessidade e combinar próximo passo." if stage == "Engaging" else
                  "Qualificar necessidade e identificar contato.")
    review_reason = ("Sem data para calcular necessidade de revisão por idade." if age is None else
                     f"Engajamento iniciado há {age} dias: conferir andamento (limiar {rules['days_60']} dias)."
                     if age >= rules['days_60'] else
                     f"Engajamento iniciado há {age} dias: abaixo do limiar de revisão de {rules['days_60']} dias.")
    return {"id": opportunity["opportunity_id"], "rules_version": RULE_VERSION,
            "rules_hash": fingerprint(rules), "as_of": as_of.isoformat(), "account": opportunity["account"] or "Conta não informada",
            "agent": opportunity["sales_agent"], "manager": team.get("manager", "Não informado"),
            "region": team.get("regional_office", "Não informado"), "product": product_name,
            "product_normalized": product_name != opportunity["product"], "stage": stage,
            "age": age, "catalog_price": price, "sector": account.get("sector", "Não informado"),
            "score": sum(f["points"] for f in factors), "urgency": urgency, "value_points": value,
            "factors": factors, "missing": missing, "suggestion": suggestion,
            "unavailable": unavailable, "review_reason": review_reason}


def previous_product_cycles(pipeline, as_of, periods=None):
    """Observed historical Won durations; not a prediction or ranking signal."""
    cycles = {}
    for opportunity in pipeline:
        if opportunity["deal_stage"] != "Won":
            continue
        try:
            engaged = date.fromisoformat(opportunity["engage_date"])
            closed = date.fromisoformat(opportunity["close_date"])
        except ValueError:
            continue
        if engaged <= closed < as_of:
            product = ALIASES.get(opportunity["product"], opportunity["product"])
            cycles.setdefault(product, []).append((opportunity["opportunity_id"], (closed - engaged).days))
            if periods is not None:
                period = periods.setdefault(product, {"earliest_engage_date": engaged.isoformat(),
                                                       "earliest_close_date": closed.isoformat(),
                                                       "latest_close_date": closed.isoformat()})
                period["earliest_engage_date"] = min(period["earliest_engage_date"], engaged.isoformat())
                period["earliest_close_date"] = min(period["earliest_close_date"], closed.isoformat())
                period["latest_close_date"] = max(period["latest_close_date"], closed.isoformat())
    return cycles


def evidence_context(row, open_rows, history, as_of):
    """Descriptive context only. Never adds points or estimates conversion."""
    same_sector = row["sector"] != "Não informado"
    peers = [r for r in open_rows if r["id"] != row["id"] and r["product"] == row["product"]
             and (not same_sector or r["sector"] == row["sector"])]
    peer_ages = [r["age"] for r in peers if r["age"] is not None]
    cycles = [days for identifier, days in history.get(row["product"], []) if identifier != row["id"]]
    available = 4 - len(row["unavailable"])
    # Partial is the ceiling: no last-contact data or historical CRM snapshots.
    limited = bool(row["unavailable"]) or len(peers) < 5
    return {"version": EVIDENCE_VERSION, "level": "limitada" if limited else "parcial",
            "available_fields": available, "required_fields": 4,
            "comparable_n": len(peers), "comparable_scope": "produto + setor" if same_sector else "somente produto; setor desconhecido",
            "comparable_distinct_accounts": len({r["account"] for r in peers if r["account"] != "Conta não informada"}),
            "comparable_dated_n": len(peer_ages), "comparable_median_age": median(peer_ages) if peer_ages else None,
            "previous_won_n": len(cycles), "previous_won_median_cycle": median(cycles) if cycles else None,
            "history_cutoff": "close_date < " + as_of.isoformat(),
            "limits": "Contexto descritivo, sem pontos; não é confiança estatística ou chance. Sem última interação, validação de fit ou snapshots históricos."}


def dataset(rules=None, as_of=AS_OF):
    active_rules = validate_rules(rules)
    # Parse and identify the exact same bytes, even if a file is subsequently replaced.
    raw = {name: (ROOT / "data" / name).read_bytes() for name in SCHEMAS}
    tables = {name: read_table(name, content) for name, content in raw.items()}
    accounts = {r["account"]: r for r in tables["accounts.csv"]}
    products = {r["product"]: r for r in tables["products.csv"]}
    teams = {r["sales_agent"]: r for r in tables["sales_teams.csv"]}
    pipeline = tables["sales_pipeline.csv"]
    for row in pipeline:
        for field, index in [("account", accounts), ("sales_agent", teams), ("product", products)]:
            value = ALIASES.get(row[field], row[field]) if field == "product" else row[field]
            if value and value not in index:
                raise DataContractError("sales_pipeline.csv: referência desconhecida em " + field)
        if row["deal_stage"] not in {"Won", "Lost", "Engaging", "Prospecting"}:
            raise DataContractError("sales_pipeline.csv: etapa desconhecida")
    rows = [score({key: r[key] for key in SCORE_FIELDS}, accounts, products, teams, active_rules, as_of) for r in pipeline if r["deal_stage"] in {"Engaging", "Prospecting"}]
    rows.sort(key=lambda r: (r["age"] is None, -r["urgency"], -(r["age"] if r["age"] is not None else -1), r["id"]))
    snapshot_hash = fingerprint({name: hashlib.sha256(content).hexdigest() for name, content in raw.items()})
    periods = {}
    history = previous_product_cycles(pipeline, as_of, periods)
    for position, row in enumerate(rows, 1):
        row["position"] = position
        row["dataset_hash"] = snapshot_hash
        row["evidence"] = evidence_context(row, rows, history, as_of)
        row["evidence"]["previous_won_period"] = periods.get(row["product"])
    queue_counts = revops.enrich(rows, accounts, pipeline, as_of)
    return {"as_of": as_of.isoformat(), "rules": active_rules, "rules_version": RULE_VERSION,
            "implementation_version": IMPLEMENTATION_VERSION,
            "operations_version": revops.VERSION, "operations_policy": dict(revops.POLICY),
            "queue_counts": queue_counts,
            "teams": [{"agent": r["sales_agent"], "manager": r["manager"], "region": r["regional_office"]}
                      for r in tables["sales_teams.csv"]],
            "rules_hash": fingerprint(active_rules), "dataset_hash": snapshot_hash, "rows": rows,
            "stages": dict(Counter(r["deal_stage"] for r in pipeline)), "total": len(pipeline)}


def simulate(overrides, as_of=AS_OF):
    """Independent results; no mutation of RULES, CSVs, or base ranking."""
    base = dataset(as_of=as_of)
    changed = dataset(overrides, as_of)
    before = {r["id"]: r for r in base["rows"]}
    for row in changed["rows"]:
        row["base_position"] = before[row["id"]]["position"]
        row["base_score"] = before[row["id"]]["score"]
    return {"base": base, "simulation": changed}


class Handler(BaseHTTPRequestHandler):
    def json_response(self, value, code=200):
        content = json.dumps(value, ensure_ascii=False, allow_nan=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(content)

    def do_POST(self):
        if self.path != "/api/jev/classify":
            self.send_error(404)
            return
        origin = self.headers.get("Origin")
        port = self.server.server_port
        if origin and origin not in {f"http://127.0.0.1:{port}", f"http://localhost:{port}"}:
            self.json_response({"error": "Origem não autorizada"}, 403)
            return
        try:
            if self.headers.get("Content-Type", "").split(";")[0] != "application/json" or self.headers.get("Transfer-Encoding"):
                raise ValueError("Use JSON com Content-Length")
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 20000:
                raise ValueError("Tamanho inválido")
            self.connection.settimeout(5)
            raw = self.rfile.read(length)
            if len(raw) != length:
                raise ValueError("Corpo incompleto")
            body = json.loads(raw)
            result = jev.classify(body)
        except (ValueError, UnicodeError, TimeoutError):
            self.json_response({"error": "Entrada inválida: confira modo, texto e limites documentados"}, 400)
            return
        self.json_response(result)

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/jev/status":
            self.json_response(jev.status())
            return
        if path == "/api/pipeline":
            try:
                query = parse_qs(urlparse(self.path).query)
                overrides = json.loads(query.get("rules", ["null"])[0])
                if overrides is not None and not isinstance(overrides, dict):
                    raise ValueError("Regras devem ser objeto")
                content = json.dumps(dataset(overrides), ensure_ascii=False).encode()
            except (DataContractError, OSError):
                self.json_response({"error": "Falha no contrato dos CSVs. Confira os arquivos locais; nenhum registro foi descartado silenciosamente."}, 500)
                return
            except (ValueError, TypeError) as error:
                self.send_error(400, str(error))
                return
            mime = "application/json; charset=utf-8"
        elif path in {"/", "/index.html"}:
            content = (ROOT / "index.html").read_bytes()
            mime = "text/html; charset=utf-8"
        elif path == "/assets/manrope.woff2":
            content = (ROOT / "assets" / "manrope.woff2").read_bytes()
            mime = "font/woff2"
        elif path == "/workflow.js":
            content = (ROOT / "workflow.js").read_bytes()
            mime = "text/javascript; charset=utf-8"
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(content)


def create_server(port=8765):
    """Idle browser preconnections must not block other resources or the API."""
    return ThreadingHTTPServer(("127.0.0.1", port), Handler)


if __name__ == "__main__":
    print("Lead Scorer local: http://127.0.0.1:8765", flush=True)
    with create_server() as server:
        server.serve_forever()
