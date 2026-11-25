"""Independent CSV Decimal oracle for net/gross/returns, including all source groups."""
from pathlib import Path
from decimal import Decimal
import csv
import hashlib
import json
import sys

source, protocol_path, output = map(Path, sys.argv[1:])
protocol = json.loads(protocol_path.read_text())
assert hashlib.sha256(source.read_bytes()).hexdigest() == protocol['dataset_csv_sha256']
components = protocol['components']; groups = {c['id']: {} for c in components}; count = 0
assert all(c['comparison']['metric'] in ['net_sales', 'gross_sales', 'returns'] for c in components)
with source.open(newline='') as stream:
    for row in csv.DictReader(stream):
        count += 1; price, quantity = Decimal(row['unit_price']), int(row['quantity'])
        cancelled = row['invoice_no'].upper().startswith('C')
        if price <= 0 or cancelled and quantity >= 0:
            continue
        when = row['invoice_time'][:10]; amount = price * quantity
        for component in components:
            comparison = component['comparison']; metric = comparison['metric']
            period = next((p for p in ['baseline', 'current'] if comparison[p]['start'] <= when < comparison[p]['end']), None)
            if period is None:
                continue
            group = groups[component['id']].setdefault(row[component['dimension']] or None, {'baseline': Decimal(0), 'current': Decimal(0)})
            value = amount if metric == 'net_sales' else amount if metric == 'gross_sales' and quantity > 0 and not cancelled else -amount if metric == 'returns' and quantity < 0 else Decimal(0)
            group[period] += value
assert count == 541909
oracle = {}
for component in components:
    values = groups[component['id']]; baseline = sum((v['baseline'] for v in values.values()), Decimal(0)); current = sum((v['current'] for v in values.values()), Decimal(0))
    oracle[component['id']] = {'comparison': component['comparison'], 'dimension': component['dimension'], 'limit': component['limit'], 'totals': {k: format(v, '.4f') for k,v in [('baseline', baseline), ('current', current), ('delta', current-baseline)]}, 'groups': [{'dimension': key, 'baseline': format(v['baseline'], '.4f'), 'current': format(v['current'], '.4f'), 'delta': format(v['current']-v['baseline'], '.4f')} for key,v in sorted(values.items(), key=lambda item: str(item[0]))]}
for period in ['baseline', 'current']:
    assert Decimal(oracle['gross_sales-country']['totals'][period]) - Decimal(oracle['returns-country']['totals'][period]) == Decimal(oracle['net_sales-country']['totals'][period])
with output.open('x') as stream:
    json.dump({'csv_sha256': protocol['dataset_csv_sha256'], 'rows': count, 'components': oracle}, stream, indent=2)
print(json.dumps({'rows': count, 'components': {k: {'groups': len(v['groups']), 'totals': v['totals']} for k,v in oracle.items()}}))
