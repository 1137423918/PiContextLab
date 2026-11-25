"""Server-side archive boundary check, including deterministic output and escape rejection."""
from pathlib import Path
import hashlib
import json
import tempfile
import tarfile
from source_snapshot import create_archive

with tempfile.TemporaryDirectory() as folder:
    root = Path(folder) / 'source'; root.mkdir()
    for name in ['package.json', 'package-lock.json', 'vendor/pi-agent-core/package.json', 'src/runtime.ts', 'evidence/uci-oracle.json', 'src/keep.ts', 'private/secret.json', '.env', 'evidence/old/source-snapshot.tar.gz', 'vendor/pi-agent-core/dist/generated.js', 'node_modules/x/index.js']:
        path = root / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_text('{}')
    first, second = Path(folder)/'one.tgz', Path(folder)/'two.tgz'
    manifest = create_archive(root, first); create_archive(root, second)
    assert first.read_bytes() == second.read_bytes()
    with tarfile.open(first) as archive:
        names = set(archive.getnames()); assert 'src/keep.ts' in names and 'evidence/uci-oracle.json' in names
        assert not any('private/' in n or 'node_modules/' in n or '/dist/' in n or n.endswith(('.tar.gz', '.env')) for n in names)
        for name, digest in manifest['files'].items():
            assert hashlib.sha256(archive.extractfile(name).read()).hexdigest() == digest
    outside = Path(folder)/'outside.ts'; outside.write_text('outside')
    (root/'src/escape.ts').symlink_to(outside)
    try:
        create_archive(root, Path(folder)/'escape.tgz')
        raise AssertionError('Expected symlink rejection')
    except ValueError:
        pass
print(json.dumps({'passed': True, 'checks': ['required source/fixture included', 'private/output/history excluded', 'deterministic bytes', 'all member digests', 'symlink rejected']}))
