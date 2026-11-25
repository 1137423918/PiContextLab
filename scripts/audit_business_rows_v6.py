"""Post-study independent check of every saved SQL group, without changing the frozen task grader."""
from pathlib import Path
from decimal import Decimal
import copy
import json
import sys

def check_rows(rows, expected):
    actual, seen = {}, set()
    for row in rows:
        key, period = row['dimension'], row['period']
        assert period in ['baseline', 'current']
        assert (key, period) not in seen, 'Duplicate group/period row'
        seen.add((key, period))
        actual.setdefault(key, {'baseline': Decimal(0), 'current': Decimal(0)})[period] = Decimal(row['value'])
    assert set(actual) == {g['dimension'] for g in expected}, 'Missing/extra group'
    for group in expected:
        values = actual[group['dimension']]
        for period in ['baseline', 'current']:
            assert values[period] == Decimal(group[period]), 'Group amount mismatch'
        assert values['current'] - values['baseline'] == Decimal(group['delta']), 'Group delta mismatch'
    return len(actual)

fixture = [{'dimension': 'A', 'period': 'baseline', 'value': '1.0000'}, {'dimension': 'A', 'period': 'current', 'value': '2.0000'}]
expected = [{'dimension': 'A', 'baseline': '1.0000', 'current': '2.0000', 'delta': '1.0000'}]
assert check_rows(fixture, expected) == 1
wrong = copy.deepcopy(fixture); wrong[0]['value'] = '1.0001'
for bad in [wrong, [], fixture + [fixture[0]]]:
    try:
        check_rows(bad, expected)
        raise RuntimeError('Negative control was accepted')
    except AssertionError:
        pass

run, output = map(Path, sys.argv[1:])
status = json.loads((run/'run-report.json').read_text()); assert status['terminal'] and status['owned_after'] == 0
root = Path(json.loads((run/'location.json').read_text())['root'])/'source'
data = json.loads((root/'business-v6/results.json').read_text())
oracle = json.loads((root/'business-v6-oracle.json').read_text())
assert data['oracle_csv_sha256'] == oracle['csv_sha256']
results = []
for case in data['cases']:
    expected_case = oracle['cases'][case['case']]
    assert case['report'], 'No report for raw-row audit'
    evidence = next(e for e in case['report']['evidence'] if e['kind'] == 'breakdown' and e['request'] == {'comparison': expected_case['comparison'], 'dimension': expected_case['dimension'], 'limit': expected_case['limit']})
    groups = check_rows(evidence['rows'], expected_case['groups'])
    results.append({'case': case['case'], 'variant': case['variant'], 'groups_checked_individually': groups, 'saved_SQL_rows_checked': len(evidence['rows']), 'passed': True})
with output.open('x') as stream:
    json.dump({'kind': 'Post-study full raw-group arithmetic audit, frozen task grades unchanged', 'results': results, 'controls': ['exact amounts accepted', 'corrupt amount rejected', 'missing group rejected', 'duplicate period rejected'], 'model_calls': 0, 'GPU_used': False, 'passed': True}, stream, indent=2)
print(json.dumps({'passed': True, 'results': results}))
