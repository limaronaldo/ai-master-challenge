import csv
import json
import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from datetime import timedelta
import app


class DataContracts(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.root = Path(self.temp.name)
        (self.root/"data").mkdir()
        self.tables = {name:app.read_table(name) for name in app.SCHEMAS}
        for name, rows in self.tables.items():
            self.write(name, rows)
        self.patcher=patch("app.ROOT",self.root); self.patcher.start()
    def tearDown(self):
        self.patcher.stop(); self.temp.cleanup()
    def write(self,name,rows,headers=None):
        with (self.root/"data"/name).open('w',newline='') as f:
            writer=csv.DictWriter(f,fieldnames=headers or app.SCHEMAS[name]);writer.writeheader();writer.writerows(rows)
    def test_missing_duplicate_headers_blank_and_duplicate_keys(self):
        for text in ["product,series\nX,Y\n", "product,product,sales_price\nX,X,1\n",
                     "product,series,sales_price\n,Y,1\n", "product,series,sales_price\nX,Y,1\nX,Y,2\n",
                     "product,series,sales_price\nX,Y,1,extra\n", "product,series,sales_price\nX,Y\n",
                     "product,series,sales_price\nGTXPro,Y,1\nGTX Pro,Y,2\n"]:
            (self.root/'data/products.csv').write_text(text)
            with self.subTest(text=text),self.assertRaises(app.DataContractError):app.dataset()
    def test_invalid_prices_refs_and_stages_fail_before_ranking(self):
        for price in ['NaN','inf','-1','oops']:
            self.write('products.csv',[dict(self.tables['products.csv'][0],sales_price=price)])
            with self.assertRaises(app.DataContractError):app.read_table('products.csv')
        self.write('products.csv',self.tables['products.csv'])
        for field,value in [('product','unknown'),('sales_agent','unknown'),('account','unknown'),('deal_stage','unknown')]:
            self.write('sales_pipeline.csv',[dict(self.tables['sales_pipeline.csv'][0],**{field:value})])
            with self.subTest(field=field),self.assertRaises(app.DataContractError):app.dataset()
    def test_prospecting_expected_absence_keeps_signal_and_qualification_separate(self):
        row=next(r for r in self.tables['sales_pipeline.csv'] if r['deal_stage']=='Prospecting' and r['account'])
        accounts={r['account']:r for r in self.tables['accounts.csv']}; products={r['product']:r for r in self.tables['products.csv']};teams={r['sales_agent']:r for r in self.tables['sales_teams.csv']}
        result=app.score(row,accounts,products,teams)
        self.assertEqual(result['missing'],[]);self.assertEqual(len(result['unavailable']),1)
        self.assertEqual(result['suggestion'],'Qualificar necessidade e identificar contato.')
        self.assertIsNone(result['age']);self.assertEqual(result['urgency'],0)
        invalid=app.score(dict(row,engage_date='invalid'),accounts,products,teams)
        self.assertEqual(len(invalid['missing']),1);self.assertIn('Validar',invalid['suggestion'])
    def test_baseline_projection_matches_prechange_2089_rows(self):
        after=[{k:r[k] for k in ['id','position','score','urgency','age','value_points']}|{'factor_points':[f['points'] for f in r['factors']]} for r in app.dataset()['rows']]
        # Oracle frozen from the 2,089 prechange decisions, not recomputed by the implementation.
        digest=hashlib.sha256(json.dumps(after,sort_keys=True,separators=(',',':')).encode()).hexdigest()
        self.assertEqual(digest,'d758d0023dff0fd18a7114a525065899db5fb243b96c19fc1268bbb1fd2e3b10')
    def test_catalog_boundaries_and_80_point_ceiling(self):
        row=next(r for r in self.tables['sales_pipeline.csv'] if r['deal_stage']=='Engaging')
        for price,expected in [(999,0),(1000,10),(4999,10),(5000,20),(9999,20),(10000,25)]:
            result=app.score(dict(row,engage_date=(app.AS_OF-timedelta(days=90)).isoformat()),{}, {row['product']:{'sales_price':str(price)}},{})
            self.assertEqual(result['value_points'],expected);self.assertLessEqual(result['score'],80)
    def test_shuffle_and_closed_outcomes_preserve_open_decisions(self):
        before=app.dataset(); expected=[(r['id'],r['score'],r['position']) for r in before['rows']]
        rows=list(reversed(self.tables['sales_pipeline.csv']))
        for row in rows:
            row['close_value']='999999999';row['close_date']='2100-01-01'
            if row['deal_stage'] in {'Won','Lost'}:row['deal_stage']='Lost' if row['deal_stage']=='Won' else 'Won'
        self.write('sales_pipeline.csv',rows)
        after=app.dataset();self.assertEqual([(r['id'],r['score'],r['position']) for r in after['rows']],expected)
        self.assertNotEqual(after['dataset_hash'],before['dataset_hash'])

    def test_published_source_hashes_and_rules_are_current(self):
        manifest=json.loads((Path(__file__).resolve().parents[1]/'docs/source-manifest.json').read_text())
        for name,expected in manifest['files'].items():
            file=Path(__file__).resolve().parent/'data'/name
            self.assertEqual(hashlib.sha256(file.read_bytes()).hexdigest(),expected)
        self.assertEqual(app.fingerprint(app.RULES),manifest['base_rules_hash'])
        self.assertEqual(app.data_hash(),manifest['dataset_hash'])

    def test_dataset_passes_only_allowlisted_fields_to_score(self):
        original=app.score
        def guarded(row,*args,**kwargs):
            self.assertEqual(set(row),set(app.SCORE_FIELDS));return original(row,*args,**kwargs)
        with patch('app.score',side_effect=guarded):self.assertEqual(len(app.dataset()['rows']),2089)

    def test_monotone_rule_changes_do_not_claim_new_ranking(self):
        before=app.dataset()
        after=app.dataset({'days_30':15,'days_60':45,'days_90':120,'engaging':20})
        self.assertEqual([r['id'] for r in before['rows']],[r['id'] for r in after['rows']])
        self.assertNotEqual(after['rules_hash'],before['rules_hash'])

    def test_hash_identifies_parsed_bytes_if_file_replaced_during_parsing(self):
        expected=app.data_hash();original=app.read_table;changed=False
        def replace_after_read(name,raw=None):
            nonlocal changed
            result=original(name,raw)
            if not changed:
                changed=True
                file=self.root/'data/sales_pipeline.csv';file.write_bytes(file.read_bytes()+b'\n')
            return result
        with patch('app.read_table',side_effect=replace_after_read):result=app.dataset()
        self.assertEqual(result['dataset_hash'],expected);self.assertNotEqual(app.data_hash(),expected)
