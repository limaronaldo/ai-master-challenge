"""Reproducible inventory and provenance; reports outcomes only for auditing."""
import hashlib
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from app import ROOT, ALIASES, read_table


def inventory():
    keys = {"accounts.csv": "account", "products.csv": "product",
            "sales_teams.csv": "sales_agent", "sales_pipeline.csv": "opportunity_id"}
    report = {"source": "https://www.kaggle.com/datasets/agungpambudi/crm-sales-predictive-analytics",
              "download": "https://www.kaggle.com/api/v1/datasets/download/agungpambudi/crm-sales-predictive-analytics",
              "license": "CC0 as declared by G4 brief; upstream page supplied no readable license metadata",
              "audit_generated_utc": datetime.now(timezone.utc).isoformat(),
              "snapshot_reference": "2017-12-31", "tables": {}}
    for name, key in keys.items():
        rows = read_table(name)
        counts = Counter(r[key] for r in rows)
        report["tables"][name] = {"rows": len(rows), "key": key,
            "sha256": hashlib.sha256((ROOT / "data" / name).read_bytes()).hexdigest(),
            "duplicate_rows": len(rows) - len({tuple(r.values()) for r in rows}),
            "duplicate_keys": {k: v for k, v in counts.items() if v > 1},
            "missing": {k: sum(not r[k].strip() for r in rows) for k in rows[0]}}
    pipeline = read_table("sales_pipeline.csv")
    report["stages"] = dict(Counter(r["deal_stage"] for r in pipeline))
    report["dates"] = {k: {"min": min(r[k] for r in pipeline if r[k]),
                           "max": max(r[k] for r in pipeline if r[k])} for k in ["engage_date", "close_date"]}
    report["missing_by_stage"] = {stage: {k: sum(not r[k] for r in pipeline if r["deal_stage"] == stage)
        for k in ["account", "engage_date", "close_date", "close_value"]} for stage in report["stages"]}
    report["join_checks"] = {}
    for column, table in [("account", "accounts.csv"), ("product", "products.csv"), ("sales_agent", "sales_teams.csv")]:
        valid = {r[column] for r in read_table(table)}
        report["join_checks"][column] = dict(Counter(r[column] for r in pipeline if r[column] and r[column] not in valid))
    report["product_alias"] = ALIASES
    report["invalid_dates"] = []
    report["close_before_engage"] = [r["opportunity_id"] for r in pipeline if r["close_date"] and r["engage_date"] and r["close_date"] < r["engage_date"]]
    from datetime import date
    for r in pipeline:
        for k in ["engage_date", "close_date"]:
            if r[k]:
                try:
                    date.fromisoformat(r[k])
                except ValueError:
                    report["invalid_dates"].append([r["opportunity_id"], k, r[k]])
    report["leakage_risks"] = ["close_value and close_date reveal outcome and are excluded from scoring",
        "Won/Lost are final outcomes; excluded from actionable queue",
        "Account and product attributes have no historical version; point-in-time validity unproven",
        "Engage date is not last contact or time in current stage",
        "Open snapshot is censored; no calibrated probability or conversion evaluation"]
    return report


if __name__ == "__main__":
    destination = ROOT.parent / "docs" / "data-audit.json"
    destination.write_text(json.dumps(inventory(), ensure_ascii=False, indent=2))
    print(destination)
