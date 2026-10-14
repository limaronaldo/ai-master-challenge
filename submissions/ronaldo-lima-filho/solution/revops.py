"""Operational queues and account context, independent of the baseline index."""
import math
from collections import Counter
from datetime import date

VERSION = "operations-v1.2"
POLICY = {"cleanup_days_exclusive": 120, "cleanup_cycle_ratio_exclusive": 2.5,
          "window_ratio_min": 1, "window_ratio_max": 2,
          "fallback_window_days_min": 30, "fallback_window_days_max": 90,
          "conversion_identified_account_tiebreak": True}


def optional_number(value):
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) and result >= 0 else None


def account_history(pipeline, as_of):
    """Only actually closed Won/Lost strictly before the reference date."""
    history = {}
    for row in pipeline:
        if not row["account"] or row["deal_stage"] not in {"Won", "Lost"}:
            continue
        try:
            closed = date.fromisoformat(row["close_date"])
        except (ValueError, TypeError):
            continue
        if closed < as_of:
            counts = history.setdefault(row["account"], {"won": 0, "lost": 0})
            counts["won" if row["deal_stage"] == "Won" else "lost"] += 1
    return history


def operational_context(row, median_cycle):
    age = row["age"]
    usable_cycle = median_cycle if median_cycle is not None and median_cycle > 0 else None
    ratio = age / usable_cycle if age is not None and usable_cycle else None
    reasons = []
    if row["stage"] == "Prospecting" or age is None:
        queue, timing = "qualify", "qualification"
        action = ("Qualificar necessidade e identificar contato." if row["account_identified"] else
                  "Identificar e vincular a conta no CRM antes de qualificar.")
        if row["missing"] and row["account_identified"]:
            action = "Validar cadastro e contexto antes de qualificar."
        reasons.append("Prospecting ou início sem data válida; sem urgência inferida.")
    elif age > POLICY["cleanup_days_exclusive"] or (ratio is not None and ratio > POLICY["cleanup_cycle_ratio_exclusive"]):
        queue, timing = "cleanup", "critical"
        if age > POLICY["cleanup_days_exclusive"]:
            reasons.append(f"{age} dias > {POLICY['cleanup_days_exclusive']} dias.")
        if ratio is not None and ratio > POLICY["cleanup_cycle_ratio_exclusive"]:
            reasons.append(f"Idade / ciclo mediano = {ratio:.2f} > {POLICY['cleanup_cycle_ratio_exclusive']}.")
        action = "Confirmar continuidade do projeto com a conta e combinar o próximo passo; registrar a decisão no CRM. Idade sozinha não justifica encerramento."
    else:
        queue = "conversion"
        in_window = (POLICY["window_ratio_min"] <= ratio <= POLICY["window_ratio_max"] if ratio is not None else
                     POLICY["fallback_window_days_min"] <= age <= POLICY["fallback_window_days_max"])
        timing = "window" if in_window else "overrun" if ratio is not None and ratio > 2 else "early"
        reasons.append(("Na janela de atenção (1–2× ciclo mediano)." if ratio is not None else
                        "Na janela de atenção alternativa (30–90 dias; sem ciclo positivo disponível).") if in_window else
                       "Acima de 2× o ciclo mediano, abaixo do limite de saneamento." if timing == "overrun" else
                       "Acompanhar evolução; fora da janela de atenção.")
        action = "Confirmar andamento e combinar próximo passo para avançar a conversão."
    if not row["account_identified"] and queue != "qualify":
        action = "Identificar e vincular a conta; " + action[0].lower() + action[1:]
    return {"queue": queue, "timing": timing, "cycle_ratio": ratio,
            "median_cycle_days": median_cycle, "reason": " ".join(reasons),
            "action": action, "version": VERSION}


def enrich(rows, accounts, pipeline, as_of):
    history = account_history(pipeline, as_of)
    subsidiaries = Counter(account.get("subsidiary_of") for account in accounts.values()
                           if account.get("subsidiary_of"))
    totals = {}
    for row in rows:
        if row["account"] in accounts:
            total = totals.setdefault(row["account"], {"open_count": 0, "catalog_sum": 0, "catalog_known_count": 0})
            total["open_count"] += 1
            if row["catalog_price"] is not None:
                total["catalog_sum"] += row["catalog_price"]
                total["catalog_known_count"] += 1
    for row in rows:
        account = accounts.get(row["account"], {})
        row["account_identified"] = bool(account)
        prior = history.get(row["account"], {"won": 0, "lost": 0})
        row["account_context"] = {
            "prior_won": prior["won"] if account else None,
            "prior_lost": prior["lost"] if account else None,
            "revenue_million_usd": optional_number(account.get("revenue")),
            "employees": optional_number(account.get("employees")),
            "subsidiary_of": account.get("subsidiary_of") or None,
            "declared_subsidiaries_count": subsidiaries[row["account"]] if account else None,
            "history_cutoff": "close_date < " + as_of.isoformat(),
            **totals.get(row["account"], {"open_count": None, "catalog_sum": None, "catalog_known_count": 0})}
        row["operations"] = operational_context(row, row["evidence"]["previous_won_median_cycle"])
    return dict(Counter(row["operations"]["queue"] for row in rows))
