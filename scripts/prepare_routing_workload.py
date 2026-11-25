"""Project a read-only normalized corpus into a tools-only CPU workload; no query labels are exported."""
from pathlib import Path
import hashlib
import json
import sys

source, output = map(Path, sys.argv[1:])
data = source.read_bytes()
tools = json.loads(data)['tools']
assert len(tools) == 37292
rows = [{'id': t['id'], 'name': t['name'], 'description': t['description'], 'parameters': t['parameters']} for t in tools]
with output.open('x') as f:
    json.dump({'source_normalized_sha256': hashlib.sha256(data).hexdigest(), 'tools': rows}, f, ensure_ascii=False, allow_nan=False)
print(json.dumps({'tools': len(rows), 'output_sha256': hashlib.sha256(output.read_bytes()).hexdigest(), 'queries_exported': 0}))
