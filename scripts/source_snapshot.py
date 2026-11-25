"""Create a reproducible source-only archive without nesting historical evidence bundles."""
from pathlib import Path
import gzip
import hashlib
import io
import json
import sys
import tarfile

ROOT_FILES = {'.env.example', '.gitignore', 'AGENTS.md', 'LICENSE', 'README.md', 'package.json', 'package-lock.json', 'tsconfig.json', 'upstream-lock.json'}
SOURCE_DIRS = {'src', 'test', 'scripts', 'web', 'vendor', 'examples', 'docs', 'patches', 'THIRD_PARTY_NOTICES'}
SKIP_DIRS = {'.git', 'node_modules', 'dist', '.metriclab', '__pycache__', '.venv', 'private'}
EXTENSIONS = {'.ts', '.js', '.mjs', '.py', '.json', '.html', '.css', '.md', '.txt', '.png', '.patch'}
FIXTURES = {'evidence/uci-oracle.json'}

def source_files(root):
    root = root.resolve()
    selected = []
    for path in sorted(root.rglob('*')):
        rel = path.relative_to(root)
        if any(part in SKIP_DIRS for part in rel.parts):
            continue
        allowed = str(rel) in ROOT_FILES or str(rel) in FIXTURES or rel.parts[0] in SOURCE_DIRS and (path.suffix in EXTENSIONS or path.name == 'LICENSE')
        if not allowed:
            continue
        if path.is_symlink():
            raise ValueError('Source snapshots reject symlinks: ' + str(rel))
        if path.is_file():
            selected.append((str(rel), path.read_bytes()))
    names = {name for name, _ in selected}
    if not {'package.json', 'package-lock.json', 'vendor/pi-agent-core/package.json', 'src/runtime.ts', 'evidence/uci-oracle.json'} <= names:
        raise ValueError('Required build source or oracle fixture missing')
    return selected

def create_archive(root, output):
    files = source_files(root)
    manifest = {'format': 'source-only-v1', 'files': {name: hashlib.sha256(data).hexdigest() for name, data in files}, 'excluded': 'historical evidence/results/archives, raw datasets, generated output and private state; original frozen bundles remain unchanged'}
    members = files + [('snapshot-manifest.json', (json.dumps(manifest, indent=2) + '\n').encode())]
    with output.open('xb') as stream, gzip.GzipFile(fileobj=stream, mode='wb', filename='', mtime=0) as compressed, tarfile.open(fileobj=compressed, mode='w') as archive:
        for name, data in members:
            info = tarfile.TarInfo(name); info.size = len(data); info.mode = 0o644; info.mtime = 0
            archive.addfile(info, io.BytesIO(data))
    return manifest

if __name__ == '__main__':
    root, output = map(Path, sys.argv[1:])
    manifest = create_archive(root, output)
    print(json.dumps({'files': len(manifest['files']), 'bytes': output.stat().st_size, 'sha256': hashlib.sha256(output.read_bytes()).hexdigest()}))
