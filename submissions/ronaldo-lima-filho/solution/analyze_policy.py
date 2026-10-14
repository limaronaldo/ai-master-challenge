"""Reproduce descriptive policy checks from the bundled public CRM snapshot."""
import json
from collections import Counter
from datetime import date
from statistics import median, quantiles

from app import AS_OF, dataset, read_table


def queue_for(row, days=120, ratio=2.5):
    if row["stage"] == "Prospecting" or row["age"] is None:
        return "qualify"
    relative = row["operations"]["cycle_ratio"]
    if row["age"] > days or (ratio is not None and relative is not None and relative > ratio):
        return "cleanup"
    return "conversion"


def analyze():
    data = dataset()
    rows = data["rows"]
    original = {row["id"]: row["operations"]["queue"] for row in rows}
    scenarios = []
    for label, days, ratio in [("current", 120, 2.5), ("days_96", 96, 2.5),
                               ("days_144", 144, 2.5), ("ratio_2", 120, 2),
                               ("ratio_3", 120, 3)]:
        queues = {row["id"]: queue_for(row, days, ratio) for row in rows}
        scenarios.append({"scenario": label, "cleanup_days_exclusive": days,
                          "cleanup_cycle_ratio_exclusive": ratio,
                          "counts": dict(Counter(queues.values())),
                          "changed_queue_count": sum(queues[key] != original[key] for key in queues)})
    assert scenarios[0]["changed_queue_count"] == 0
    closed = []
    for row in read_table("sales_pipeline.csv"):
        if row["deal_stage"] not in {"Won", "Lost"}:
            continue
        try:
            engaged = date.fromisoformat(row["engage_date"])
            ended = date.fromisoformat(row["close_date"])
        except ValueError:
            continue
        if engaged <= ended < AS_OF:
            closed.append((row["deal_stage"], (ended - engaged).days))
    won = [days for stage, days in closed if stage == "Won"]
    lost = [days for stage, days in closed if stage == "Lost"]
    maximum = max(days for _, days in closed)
    rates = []
    for threshold in range(maximum + 1):
        sample = [stage for stage, days in closed if days >= threshold]
        rates.append({"minimum_duration_days": threshold, "closed_count": len(sample),
                      "won_fraction": sample.count("Won") / len(sample)})
    cleanup = [r for r in rows if r["operations"]["queue"] == "cleanup"]
    partition = {"up_to_120_days": sum(r["age"] <= 120 for r in cleanup),
                 "days_121_to_138": sum(121 <= r["age"] <= 138 for r in cleanup),
                 "more_than_138_days": sum(r["age"] > 138 for r in cleanup)}
    relative_only = [{"id": r["id"], "product": r["product"], "age": r["age"]}
                     for r in cleanup if r["age"] <= 120]
    central = [r for r in rows if r["region"] == "Central"]
    central_engaging = [r for r in central if r["stage"] == "Engaging"]
    teams = {r["sales_agent"]: r for r in read_table("sales_teams.csv")}
    central_starts = [r["engage_date"] for r in read_table("sales_pipeline.csv")
                      if teams[r["sales_agent"]]["regional_office"] == "Central" and r["deal_stage"] == "Engaging"]
    central_recent = [r for r in read_table("sales_pipeline.csv")
                      if teams[r["sales_agent"]]["regional_office"] == "Central"
                      and r["deal_stage"] in {"Won", "Lost"}
                      and r["engage_date"] >= "2017-08-16" and r["close_date"] <= AS_OF.isoformat()]
    strict = [r for r in central_recent if r["close_date"] < AS_OF.isoformat()]
    durations = {}
    for label, predicate in [("less_than_30_days", lambda days: days < 30),
                             ("more_than_120_days", lambda days: days > 120)]:
        group = [stage for stage, days in closed if predicate(days)]
        durations[label] = {"closed_count": len(group), "won_count": group.count("Won"),
                            "won_fraction": group.count("Won") / len(group)}
    criteria = Counter()
    for row in rows:
        if row["stage"] != "Engaging" or row["age"] is None:
            continue
        days = row["age"] > 120
        relative = row["operations"]["cycle_ratio"]
        ratio = relative is not None and relative > 2.5
        criteria["both" if days and ratio else "days_only" if days else
                 "ratio_only" if ratio else "neither"] += 1
    regions = {}
    for region in sorted({row["region"] for row in rows}):
        group = [row for row in rows if row["region"] == region]
        regions[region] = {"open_count": len(group),
                           "queues": dict(Counter(row["operations"]["queue"] for row in group))}
    agents = {row["agent"] for row in rows}
    empty = [agent for agent in sorted(agents)
             if not any(row["agent"] == agent and row["operations"]["queue"] == "conversion" for row in rows)]
    top = sorted(rows, key=lambda row: (-row["score"], -(row["age"] or -1), row["id"]))[:20]
    return {"reference": AS_OF.isoformat(), "dataset_hash": data["dataset_hash"],
            "operations_policy": data["operations_policy"], "open_count": len(rows),
            "scenarios": scenarios, "cleanup_criteria": dict(criteria),
            "cleanup_duration_partition": partition, "cleanup_relative_only": relative_only,
            "closed_maximum_duration_days": maximum,
            "closed_cumulative_duration_rates": rates,
            "closed_cumulative_rate_decreases": sum(b["won_fraction"] < a["won_fraction"]
                                                       for a, b in zip(rates, rates[1:])),
            "central_pattern": {"prospecting_open": sum(r["stage"] == "Prospecting" for r in central),
                                "engaging_open": len(central_engaging),
                                "engage_date_min": min(central_starts),
                                "engage_date_max": max(central_starts),
                                "age_days_min": min(r["age"] for r in central_engaging),
                                "age_days_max": max(r["age"] for r in central_engaging),
                                "recent_closed_strict": dict(Counter(r["deal_stage"] for r in strict)),
                                "recent_closed_inclusive": dict(Counter(r["deal_stage"] for r in central_recent))},
            "closed_before_reference": len(closed), "won_count": len(won),
            "lost_count": len(lost), "won_median_days": median(won),
            "lost_median_days": median(lost),
            "won_p90_days_inclusive": quantiles(won, n=10, method="inclusive")[8],
            "won_more_than_120_days_count": sum(days > 120 for days in won),
            "closed_duration_groups": durations, "regions": regions,
            "salespeople_with_open_pipeline": len(agents),
            "salespeople_without_conversion_count": len(empty),
            "top20_index_queues": dict(Counter(row["operations"]["queue"] for row in top)),
            "interpretation": "Descriptive snapshot checks only. Closed duration groups are selected by eventual duration and observed closure; they do not estimate open-deal win probability or validate causal effects. No historical account snapshots or last-contact observations are available."}


if __name__ == "__main__":
    print(json.dumps(analyze(), ensure_ascii=False, indent=2))
