"""Queue boundaries, temporal account history and baseline isolation."""
import unittest
from unittest.mock import patch
import app
import revops


class OperationalTests(unittest.TestCase):
    def deal(self, age, **overrides):
        return dict(age=age, stage="Engaging", account_identified=True, missing=[], **overrides)

    def test_snapshot_is_a_disjoint_exhaustive_partition(self):
        data = app.dataset()
        self.assertEqual(data["queue_counts"], {"conversion": 212, "cleanup": 1377, "qualify": 500})
        self.assertEqual(sum(data["queue_counts"].values()), 2089)
        qualify = [r for r in data["rows"] if r["operations"]["queue"] == "qualify"]
        self.assertEqual(sum(r["account_identified"] for r in qualify), 163)
        self.assertEqual(sum(not r["account_identified"] for r in qualify), 337)
        oldest = next(r for r in data["rows"] if r["id"] == "HAXMC4IX")
        self.assertEqual(oldest["operations"]["queue"], "cleanup")
        self.assertAlmostEqual(oldest["operations"]["cycle_ratio"], 423/57)
        self.assertIn("confirmar continuidade", oldest["operations"]["action"].lower())
        self.assertIn("Idade sozinha não justifica encerramento", oldest["operations"]["action"])

    def test_exclusive_cleanup_boundaries_and_or_condition(self):
        for days, cycle, expected in [(120, 100, "conversion"), (121, 100, "cleanup"),
                                       (50, 20, "conversion"), (51, 20, "cleanup"),
                                       (0, 57, "conversion")]:
            with self.subTest(days=days, cycle=cycle):
                self.assertEqual(revops.operational_context(self.deal(days), cycle)["queue"], expected)
        for days, expected in [(56, "early"), (57, "window"), (114, "window"), (115, "overrun")]:
            self.assertEqual(revops.operational_context(self.deal(days), 57)["timing"], expected)

    def test_missing_zero_cycle_and_unknown_age_do_not_invent_ratio(self):
        for cycle in [None, 0]:
            for days, timing in [(29, "early"), (30, "window"), (90, "window"), (91, "early")]:
                context = revops.operational_context(self.deal(days), cycle)
                self.assertIsNone(context["cycle_ratio"])
                self.assertEqual(context["timing"], timing)
            self.assertEqual(revops.operational_context(self.deal(121), cycle)["queue"], "cleanup")
        self.assertEqual(revops.operational_context(self.deal(None), 57)["queue"], "qualify")
        prospect = self.deal(200); prospect["stage"] = "Prospecting"
        self.assertEqual(revops.operational_context(prospect, 57)["queue"], "qualify")

    def test_history_requires_identified_account_and_prior_closed_outcome(self):
        def row(stage, closed, account="ACME"):
            return dict(deal_stage=stage, close_date=closed, account=account)
        history = revops.account_history([
            row("Won", "2017-12-30"), row("Lost", "2017-01-01"),
            row("Won", "2017-12-31"), row("Won", "2018-01-01"),
            row("Won", "invalid"), row("Won", "2017-01-01", ""),
            row("Engaging", "2017-01-01"), row("Prospecting", "2017-01-01")], app.AS_OF)
        self.assertEqual(history, {"ACME": {"won": 1, "lost": 1}})

    def test_enrichment_uses_own_account_and_never_changes_baseline(self):
        data = app.dataset()
        account = next(r for r in data["rows"] if r["account_identified"])["account"]
        member = next(r for r in data["rows"] if r["account"] == account)
        peers = [r for r in data["rows"] if r["account"] == account]
        self.assertEqual(member["account_context"]["open_count"], len(peers))
        self.assertEqual(member["account_context"]["catalog_sum"], sum(r["catalog_price"] for r in peers))
        orphan = next(r for r in data["rows"] if not r["account_identified"])
        self.assertIsNone(orphan["account_context"]["prior_won"])
        self.assertIsNone(orphan["account_context"]["open_count"])
        with patch("app.revops.enrich", return_value={}):
            without = app.dataset()
        self.assertEqual([(r["id"],r["score"],r["position"]) for r in data["rows"]],
                         [(r["id"],r["score"],r["position"]) for r in without["rows"]])

    def test_open_close_fields_and_close_values_never_enter_context(self):
        original = app.read_table
        before = app.dataset()
        def mutated(name, raw=None):
            rows = original(name, raw)
            if name == "sales_pipeline.csv":
                for row in rows:
                    row["close_value"] = "999999999999"
                    if row["deal_stage"] in {"Engaging", "Prospecting"}:
                        row["close_date"] = "1900-01-01"
            return rows
        with patch("app.read_table", side_effect=mutated):
            self.assertEqual(app.dataset(), before)

    def test_missing_nonfinite_account_size_is_unavailable(self):
        for value in ["", "oops", "nan", "inf", "-1"]:
            self.assertIsNone(revops.optional_number(value))
        self.assertEqual(revops.optional_number("1100.04"), 1100.04)

    def test_declared_parent_and_subsidiaries_are_literal_without_revenue_consolidation(self):
        accounts = {r['account']: r for r in app.read_table('accounts.csv')}
        data = app.dataset()
        for r in data['rows']:
            c = r['account_context']
            a = accounts.get(r['account'])
            self.assertEqual(c['subsidiary_of'], (a.get('subsidiary_of') or None) if a else None)
            self.assertEqual(c['declared_subsidiaries_count'],
                             sum(x['subsidiary_of'] == r['account'] for x in accounts.values()) if a else None)
            self.assertEqual(c['revenue_million_usd'], revops.optional_number(a['revenue']) if a else None)

    def test_descriptive_analysis_reproduces_corrected_plan_numbers(self):
        from analyze_policy import analyze
        data = analyze()
        self.assertEqual(data['cleanup_duration_partition'],
                         {'up_to_120_days': 1, 'days_121_to_138': 85, 'more_than_138_days': 1291})
        self.assertEqual(data['cleanup_relative_only'], [{'id': 'KXR63BV7', 'product': 'GTX Pro', 'age': 118}])
        self.assertEqual(data['closed_before_reference'], 6687)
        self.assertEqual(data['closed_maximum_duration_days'], 138)
        self.assertEqual(data['closed_cumulative_rate_decreases'], 53)
        self.assertEqual(data['central_pattern'], {
            'prospecting_open': 500, 'engaging_open': 408,
            'engage_date_min': '2017-07-19', 'engage_date_max': '2017-08-15',
            'age_days_min': 138, 'age_days_max': 165,
            'recent_closed_strict': {'Won': 466, 'Lost': 308},
            'recent_closed_inclusive': {'Won': 474, 'Lost': 309}})
