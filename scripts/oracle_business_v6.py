"""Independent Decimal arithmetic for the frozen new business comparisons; no DuckDB or model calls."""
from pathlib import Path
from decimal import Decimal
import csv
import hashlib
import json
import sys

source, protocol_path, output = map(Path, sys.argv[1:])
protocol = json.loads(protocol_path.read_text())
assert hashlib.sha256(source.read_bytes()).hexdigest() == protocol['dataset_csv_sha256']
groups = {c['id']: {} for c in protocol['cases']}
rows = 0
with source.open(newline='') as stream:
    for row in csv.DictReader(stream):
        rows += 1
        price, quantity = Decimal(row['unit_price']), int(row['quantity'])
        if price <= 0 or row['invoice_no'].upper().startswith('C') and quantity >= 0:
            continue
        when = row['invoice_time'][:10]
        for case in protocol['cases']:
            comparison = case['comparison']
            period = next((p for p in ['baseline', 'current'] if comparison[p]['start'] <= when < comparison[p]['end']), None)
            if period is None:
                continue
            key = row[case['dimension']] or None
            values = groups[case['id']].setdefault(key, {'baseline': Decimal(0), 'current': Decimal(0)})
            amount = price * quantity
            values[period] += -amount if comparison['metric'] == 'returns' and quantity < 0 else Decimal(0) if comparison['metric'] == 'returns' else amount
assert rows == 541909
cases = {}
for case in protocol['cases']:
    values = groups[case['id']]
    serialize = lambda x: format(x, '.4f')
    baseline = sum((v['baseline'] for v in values.values()), Decimal(0))
    current = sum((v['current'] for v in values.values()), Decimal(0))
    cases[case['id']] = {'comparison': case['comparison'], 'dimension': case['dimension'], 'limit': case['limit'], 'totals': {'baseline': serialize(baseline), 'current': serialize(current), 'delta': serialize(current-baseline)}, 'groups': [{'dimension': key, 'baseline': serialize(v['baseline']), 'current': serialize(v['current']), 'delta': serialize(v['current']-v['baseline'])} for key, v in sorted(values.items(), key=lambda item: str(item[0]))]}
with output.open('x') as stream:
    json.dump({'kind': 'independent Python CSV/Decimal arithmetic, not model inference', 'csv_sha256': protocol['dataset_csv_sha256'], 'rows': rows, 'cases': cases}, stream, indent=2)
print(json.dumps({'rows': rows, 'cases': {k: {'groups': len(v['groups']), 'totals': v['totals']} for k,v in cases.items()}}))
