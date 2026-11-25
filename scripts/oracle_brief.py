"""Independent Python CSV/Decimal/set oracle. No DuckDB, JS arithmetic or model input."""
from pathlib import Path
from decimal import Decimal, ROUND_HALF_UP
import csv, hashlib, json, sys
source, protocol_file, output = map(Path, sys.argv[1:])
protocol = json.loads(protocol_file.read_text())
assert hashlib.sha256(source.read_bytes()).hexdigest() == protocol['dataset_csv_sha256']
states = {c['id']: {p: {'gross_sales': Decimal(0), 'returns': Decimal(0), 'net_sales': Decimal(0), 'orders': set()} for p in ['baseline', 'current']} for c in protocol['cases']}
groups = {c['id']: {b['id']: {} for b in c['breakdowns']} for c in protocol['cases']}
rows = 0
with source.open(newline='') as stream:
    for row in csv.DictReader(stream):
        rows += 1
        price, quantity = Decimal(row['unit_price']), int(row['quantity'])
        cancelled = row['invoice_no'].upper().startswith('C')
        if price <= 0 or cancelled and quantity >= 0:
            continue
        amount, when = price * quantity, row['invoice_time'][:10]
        values = {'net_sales': amount, 'gross_sales': amount if quantity > 0 and not cancelled else Decimal(0), 'returns': -amount if quantity < 0 else Decimal(0)}
        for c in protocol['cases']:
            period = next((p for p in ['baseline', 'current'] if c['intent'][p]['start'] <= when < c['intent'][p]['end']), None)
            if period is None:
                continue
            state = states[c['id']][period]
            for metric in values:
                state[metric] += values[metric]
            if quantity > 0 and not cancelled:
                state['orders'].add(row['invoice_no'])
            for b in c['breakdowns']:
                pair = groups[c['id']][b['id']].setdefault(row[b['dimension']] or None, {'baseline': Decimal(0), 'current': Decimal(0)})
                pair[period] += values[b['metric']]
assert rows == 541909
fmt = lambda n: format(n, '.4f')
cases = {}
for c in protocol['cases']:
    state = states[c['id']]
    for p in state:
        state[p]['sales_orders'] = Decimal(len(state[p]['orders']))
        assert state[p]['sales_orders'] > 0
        state[p]['avg_order_value'] = (state[p]['gross_sales'] / state[p]['sales_orders']).quantize(Decimal('.0001'), rounding=ROUND_HALF_UP)
        assert state[p]['gross_sales'] - state[p]['returns'] == state[p]['net_sales']
    facts = {m: {'baseline': fmt(state['baseline'][m]), 'current': fmt(state['current'][m]), 'delta': fmt(state['current'][m]-state['baseline'][m])} for m in c['metrics']}
    breakdowns = {}
    for b in c['breakdowns']:
        data = groups[c['id']][b['id']]
        breakdowns[b['id']] = {'comparison': {**c['intent'], 'metric': b['metric']}, 'dimension': b['dimension'], 'limit': b['limit'], 'totals': {k: fmt(v) for k,v in [('baseline',state['baseline'][b['metric']]),('current',state['current'][b['metric']]),('delta',state['current'][b['metric']]-state['baseline'][b['metric']])]}, 'groups': [{'dimension': name, 'baseline': fmt(v['baseline']), 'current': fmt(v['current']), 'delta': fmt(v['current']-v['baseline'])} for name,v in sorted(data.items(),key=lambda pair:str(pair[0]))]}
    check_metric = 'avg_order_value' if c['check'] == 'gross_per_order' else 'net_sales'
    cases[c['id']] = {'facts': facts, 'breakdowns': breakdowns, 'check': {p: fmt(state[p][check_metric]) for p in ['baseline', 'current']}}
with output.open('x') as stream:
    json.dump({'kind':'independent CSV Decimal/set full-group oracle; never model input','rows':rows,'csv_sha256':protocol['dataset_csv_sha256'],'cases':cases},stream,indent=2)
print(json.dumps({'rows':rows,'cases':{k:{'facts':v['facts'],'groups':{b:len(x['groups']) for b,x in v['breakdowns'].items()}} for k,v in cases.items()}}))
