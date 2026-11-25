"""Pack the built core and consume it outside the repository; run only on the authorized server."""
from pathlib import Path, PurePosixPath
import hashlib, json, os, shutil, subprocess, sys, tarfile, tempfile

destination = Path(sys.argv[1]).resolve()
destination.mkdir(exist_ok=False)
root = Path.cwd().resolve()
npm = shutil.which('npm'); node = shutil.which('node')
assert npm and node
environment = {**os.environ, 'NODE_PATH': ''}
def run(label, argv, cwd):
 with (destination / (label + '.log')).open('wb') as log:
  result = subprocess.run(argv, cwd=cwd, env=environment, stdout=log, stderr=subprocess.STDOUT, check=False)
 assert result.returncode == 0, label + ': inspect captured log'

result = subprocess.run([npm, 'pack', '--ignore-scripts', '--json', '--pack-destination', str(destination)], cwd=root/'vendor/pi-agent-core', env=environment, capture_output=True, check=True)
(destination/'npm-pack.json').write_bytes(result.stdout)
packing = json.loads(result.stdout)[0]
archive = destination/packing['filename']; assert archive.is_file()
members = {}
with tarfile.open(archive, 'r:gz') as bundle:
 for member in bundle:
  name = PurePosixPath(member.name)
  assert not name.is_absolute() and '..' not in name.parts and name.parts[0] == 'package'
  if member.isdir(): continue
  assert member.isfile(), 'No package links or special files'
  members[str(PurePosixPath(*name.parts[1:]))] = bundle.extractfile(member).read()
package = json.loads(members['package.json'])
assert package['name'] == '@earendil-works/pi-agent-core'
assert package['version'] == '1.6.0-contextlab.12' and package['dependencies'] == {'@earendil-works/pi-ai': '1.6.0', '@earendil-works/pi-schema': '1.6.0'}
assert {'LICENSE', 'UPSTREAM.json', 'dist/index.js', 'dist/index.d.ts'} <= members.keys()
assert json.loads(members['UPSTREAM.json'])['commit'] == 'faac585884ae2c013a6b1400f3e9e77f10b34bac'
assert members['LICENSE'] == (root/'vendor/pi-agent-core/LICENSE').read_bytes()
missing_maps = []
for name, data in members.items():
 if not name.endswith('.map'): continue
 mapping = json.loads(data)
 assert not mapping.get('sourceRoot'), 'Map source roots must stay package-relative'
 for i, source in enumerate(mapping['sources']):
  if i < len(mapping.get('sourcesContent', [])) and mapping['sourcesContent'][i] is not None: continue
  target = os.path.normpath(str(PurePosixPath(name).parent/source))
  if target not in members: missing_maps.append({'map': name, 'source': target})
distribution = {'package': package['name'], 'version': package['version'], 'archive': archive.name,
 'bytes': archive.stat().st_size, 'sha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
 'integrity': packing['integrity'], 'members': len(members), 'missing_map_sources': missing_maps,
 'license_and_upstream_identity_checked': True, 'source_commit': subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip() if (root/'.git').exists() else None}
(destination/'distribution.json').write_text(json.dumps(distribution, indent=2)+'\n')
assert not missing_maps, 'Declaration/source maps reference missing packaged source files'

consumer = Path(tempfile.mkdtemp(prefix='pi-context-consumer-', dir=os.environ.get('TMPDIR'))).resolve()
assert consumer != root and root not in consumer.parents and not (consumer.parent/'node_modules').exists()
(destination/'consumer-location.json').write_text(json.dumps({'consumer': str(consumer), 'repository': str(root), 'outside_repository': True})+'\n')
for name in ['package.json', 'tsconfig.json', 'agent.ts', 'smoke.ts']:
 shutil.copy2(root/'examples/sdk-consumer'/name, consumer/name)
shutil.copy2(archive, consumer/'core-package.tgz')
run('consumer-freeze', [npm,'install','--package-lock-only','--ignore-scripts','--no-audit','--no-fund'], consumer)
run('consumer-install', [npm,'ci','--ignore-scripts','--no-audit','--no-fund'], consumer)
installed = consumer/'node_modules/@earendil-works/pi-agent-core'
assert installed.is_dir() and not installed.is_symlink() and consumer in installed.resolve().parents
assert json.loads((installed/'package.json').read_text())['version'] == package['version']
for name, data in members.items():
 assert (installed/name).read_bytes() == data, 'Installed package differs from packed bytes: '+name
run('consumer-typecheck-and-build', [node,'node_modules/typescript/bin/tsc','-p','tsconfig.json'], consumer)
run('consumer-native-runtime', [node,'dist/smoke.js'], consumer)
evidence = json.loads((consumer/'consumer-result.json').read_text())
assert evidence['passed'] and evidence['real_model_calls'] == 0
evidence.update(outside_repository=True, package_installed_from_tarball=True, all_installed_package_bytes_match=True, skipLibCheck=False)
(destination/'consumer-result.json').write_text(json.dumps(evidence,indent=2)+'\n')
shutil.copy2(consumer/'package-lock.json', destination/'consumer-package-lock.json')
shutil.copy2(consumer/'package.json', destination/'consumer-package.json')
print(json.dumps({'distribution': distribution, 'consumer': evidence}))
