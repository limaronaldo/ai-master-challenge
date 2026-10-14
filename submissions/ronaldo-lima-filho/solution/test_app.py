import unittest
from copy import deepcopy
from datetime import date, timedelta
from app import AS_OF, RULES, dataset, read_table, score, simulate, validate_rules, evidence_context, previous_product_cycles
from audit import inventory


class PriorityTests(unittest.TestCase):
    def setUp(self):
        self.accounts = {r['account']: r for r in read_table('accounts.csv')}
        self.products = {r['product']: r for r in read_table('products.csv')}
        self.teams = {r['sales_agent']: r for r in read_table('sales_teams.csv')}
        self.row = next(r for r in read_table('sales_pipeline.csv') if r['deal_stage'] == 'Engaging' and r['account'])

    def compute(self, row):
        return score(row, self.accounts, self.products, self.teams)

    def test_real_snapshot(self):
        data = dataset()
        self.assertEqual(len(data['rows']), 2089)
        self.assertEqual(data['total'], 8800)
        self.assertTrue(all(r['stage'] in {'Engaging', 'Prospecting'} for r in data['rows']))
        self.assertEqual(len({r['id'] for r in data['rows']}), 2089)

    def test_outcomes_cannot_change_score(self):
        changed = deepcopy(self.row)
        changed['close_value'] = '999999999'
        changed['close_date'] = '2100-01-01'
        self.assertEqual(self.compute(self.row), self.compute(changed))

    def test_age_boundaries(self):
        for days, expected in [(0, 0), (29, 0), (30, 10), (59, 10), (60, 20), (89, 20), (90, 30)]:
            row = dict(self.row, engage_date=(AS_OF - timedelta(days=days)).isoformat())
            self.assertEqual(self.compute(row)['urgency'], expected)

    def test_missing_and_future_dates(self):
        for value in ['', 'invalid', '2018-01-01']:
            result = self.compute(dict(self.row, engage_date=value, account=''))
            self.assertIsNone(result['age'])
            self.assertEqual(result['urgency'], 0)
            self.assertEqual(len(result['missing']), 2)
            self.assertIn('Validar', result['suggestion'])

    def test_product_alias(self):
        result = self.compute(dict(self.row, product='GTXPro'))
        self.assertEqual(result['product'], 'GTX Pro')
        self.assertEqual(result['catalog_price'], 4821)

    def test_factor_sum_and_bounds(self):
        for r in dataset()['rows']:
            self.assertEqual(r['score'], sum(f['points'] for f in r['factors']))
            self.assertTrue(0 <= r['score'] <= 80)

    def test_deterministic(self):
        self.assertEqual(dataset(), dataset())

    def test_simulation_preserves_base_and_reset(self):
        before = dataset()
        rules_before = dict(RULES)
        csv_before = read_table('sales_pipeline.csv')
        changed = simulate({'age_90': 0, 'age_30': 30})
        self.assertEqual(changed['base'], before)
        self.assertNotEqual(changed['simulation']['rules_hash'], before['rules_hash'])
        self.assertNotEqual([r['id'] for r in changed['simulation']['rows']], [r['id'] for r in before['rows']])
        self.assertEqual(dataset(), before)
        self.assertEqual(simulate(dict(RULES))['simulation']['rows'], simulate({})['simulation']['rows'])
        self.assertEqual(RULES, rules_before)
        self.assertEqual(read_table('sales_pipeline.csv'), csv_before)

    def test_rules_and_explanations_change_together(self):
        rules = dict(RULES, days_30=10, days_60=20, days_90=30)
        row = dict(self.row, engage_date='2017-12-01')
        result = score(row, self.accounts, self.products, self.teams, rules)
        self.assertEqual(result['urgency'], rules['age_90'])
        self.assertIn('10/20/30 dias', result['factors'][1]['label'])
        self.assertEqual(result['score'], sum(f['points'] for f in result['factors']))
        self.assertEqual(result['as_of'], '2017-12-31')

    def test_invalid_rules_and_unknown_age(self):
        for overrides in [{'days_30': 0}, {'days_60': 20}, {'age_90': -1}, {'age_90': True}, {'bad': 1}]:
            with self.assertRaises(ValueError):
                validate_rules(overrides)
        data = dataset({'age_90': 0, 'age_30': 30})
        first_unknown = next(i for i, r in enumerate(data['rows']) if r['age'] is None)
        self.assertTrue(all(r['age'] is None for r in data['rows'][first_unknown:]))
        self.assertTrue(all(r['dataset_hash'] == data['dataset_hash'] and r['rules_hash'] == data['rules_hash'] for r in data['rows']))

    def test_evidence_counts_exclude_self_and_explain_fallback(self):
        original = self.compute(self.row)
        peer = dict(original, id='OTHER')
        unrelated = dict(original, id='UNRELATED', product='Other Product')
        context = evidence_context(original, [original, peer, unrelated], {}, AS_OF)
        self.assertEqual(context['comparable_n'], 1)
        self.assertEqual(context['comparable_scope'], 'produto + setor')
        self.assertEqual(context['level'], 'limitada')
        incomplete = self.compute(dict(self.row, account=''))
        fallback = evidence_context(incomplete, [incomplete, peer], {}, AS_OF)
        self.assertEqual(fallback['available_fields'], 3)
        self.assertEqual(fallback['comparable_n'], 1)
        self.assertIn('somente produto', fallback['comparable_scope'])
        self.assertEqual(original['score'], sum(f['points'] for f in original['factors']))

    def test_history_is_prior_valid_won_context_only(self):
        source = dict(self.row, product='GTXPro', engage_date='2017-01-01')
        rows = [dict(source, opportunity_id='PRIOR', deal_stage='Won', close_date='2017-01-11'),
                dict(source, opportunity_id='AT_CUTOFF', deal_stage='Won', close_date='2017-12-31'),
                dict(source, opportunity_id='FUTURE', deal_stage='Won', close_date='2018-01-01'),
                dict(source, opportunity_id='INVALID', deal_stage='Won', close_date='invalid'),
                dict(source, opportunity_id='LOST', deal_stage='Lost', close_date='2017-01-11'),
                dict(source, opportunity_id='OPEN', deal_stage='Engaging', close_date='2017-01-11')]
        periods = {}
        history = previous_product_cycles(rows, AS_OF, periods)
        self.assertEqual(history, {'GTX Pro': [('PRIOR', 10)]})
        self.assertEqual(periods, {'GTX Pro': {'earliest_engage_date': '2017-01-01',
                                              'earliest_close_date': '2017-01-11',
                                              'latest_close_date': '2017-01-11'}})
        deal = self.compute(dict(self.row, product='GTXPro'))
        before = deepcopy(deal)
        context = evidence_context(deal, [deal], history, AS_OF)
        self.assertEqual(context['previous_won_n'], 1)
        self.assertEqual(context['previous_won_median_cycle'], 10)
        self.assertEqual(deal, before)

    def test_missing_account_and_owner_do_not_lower_priority(self):
        complete = self.compute(self.row)
        missing = self.compute(dict(self.row, account='', sales_agent='Unmapped owner'))
        self.assertEqual(complete['score'], missing['score'])
        self.assertEqual(complete['urgency'], missing['urgency'])
        self.assertEqual(complete['age'], missing['age'])
        self.assertIn('Conta ausente/sem correspondência', missing['missing'])
        self.assertIn('Vendedor sem correspondência', missing['missing'])
        self.assertIn('Validar cadastro', missing['suggestion'])

    def test_audit_keys_dates(self):
        audit = inventory()
        self.assertTrue(all(not t['duplicate_keys'] for t in audit['tables'].values()))
        self.assertEqual(audit['invalid_dates'], [])
        self.assertEqual(audit['close_before_engage'], [])


if __name__ == '__main__':
    unittest.main()
