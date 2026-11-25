"""Independent original-workbook oracle; does not import the TS metric compiler."""
import argparse
import datetime as dt
from decimal import Decimal, ROUND_HALF_UP
import hashlib
import json
from pathlib import Path
from openpyxl import load_workbook

def run(workbook, output):
    periods = [('baseline', dt.datetime(2011, 10, 1), dt.datetime(2011, 11, 1)),
               ('current', dt.datetime(2011, 11, 1), dt.datetime(2011, 12, 1))]
    state = {name: {'gross': Decimal(0), 'refund': Decimal(0), 'net': Decimal(0),
                    'orders': set(), 'customers': set(), 'countries': {}} for name, _, _ in periods}
    quality = dict(rows=0, unknown_customers=0, missing_descriptions=0, nonpositive_prices=0,
                   negative_quantities=0, inconsistent_cancellations=0)
    book = load_workbook(workbook, read_only=True, data_only=True)
    try:
        for invoice, stock, description, quantity, when, raw_price, customer, country in book.active.iter_rows(min_row=2, values_only=True):
            quality['rows'] += 1
            price = Decimal(str(raw_price))
            cancelled = str(invoice).upper().startswith('C')
            for key, condition in [('unknown_customers', customer is None), ('missing_descriptions', description is None),
                                   ('nonpositive_prices', price <= 0), ('negative_quantities', quantity < 0),
                                   ('inconsistent_cancellations', cancelled and quantity >= 0)]:
                quality[key] += int(condition)
            # Standalone business interpretation, calculated directly from original cells.
            if price <= 0 or (cancelled and quantity >= 0):
                continue
            for name, start, end in periods:
                if not start <= when < end: continue
                s = state[name]; money = Decimal(quantity) * price
                s['net'] += money
                s['countries'][country] = s['countries'].get(country, Decimal(0)) + money
                if quantity < 0: s['refund'] -= money
                if quantity > 0 and not cancelled:
                    s['gross'] += money; s['orders'].add(str(invoice))
                    if customer is not None: s['customers'].add(str(int(customer)))
    finally:
        book.close()
    fmt = lambda x: format(x.quantize(Decimal('.0001'), rounding=ROUND_HALF_UP), 'f')
    metrics = {}
    for name, s in state.items():
        metrics[name] = dict(net_sales=fmt(s['net']), gross_sales=fmt(s['gross']), returns=fmt(s['refund']),
                             sales_orders=str(len(s['orders'])), identified_customers=str(len(s['customers'])),
                             avg_order_value=fmt(s['gross']/len(s['orders'])) if s['orders'] else None)
    countries = []
    for country in set(state['baseline']['countries']) | set(state['current']['countries']):
        a = state['baseline']['countries'].get(country, Decimal(0)); b = state['current']['countries'].get(country, Decimal(0))
        countries.append(dict(dimension=country, baseline=fmt(a), current=fmt(b), delta=fmt(b-a)))
    countries.sort(key=lambda r: (r['dimension'] is not None, r['dimension'] or ''))
    result = dict(source='independent openpyxl/Decimal from original XLSX', workbook_sha256=hashlib.sha256(workbook.read_bytes()).hexdigest(),
                  frozen_periods=[dict(name=n,start=a.isoformat(),end=b.isoformat()) for n,a,b in periods], metrics=metrics, quality=quality, countries=countries)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n'); print(json.dumps({'oracle_ready':True,'rows':quality['rows'],'metrics':metrics}))

if __name__ == '__main__':
    p=argparse.ArgumentParser(); p.add_argument('workbook',type=Path);p.add_argument('output',type=Path);a=p.parse_args();run(a.workbook,a.output)
