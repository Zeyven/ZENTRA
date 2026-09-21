"""Build locally and bind inputs to output hashes. Never contacts production."""
import argparse, hashlib, json, os, re, subprocess
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
RECORD=ROOT/'.runtime/release-build.json'
INPUT_DIRS=['apps/server/src','apps/client/src','apps/client/build','packages/contracts/src','tools/hardware-gateway','scripts']
OUTPUT_DIRS=['apps/server/dist','packages/contracts/dist','apps/client/out/web','apps/client/out/main','apps/client/out/preload','apps/client/out/renderer']

def sha(path):
    with path.open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()

def inventory(root, dirs, files=()):
    paths=set(root/p for p in files)
    for folder in dirs:
        directory=root/folder
        if not directory.is_dir():raise ValueError('Required directory missing: '+folder)
        found=[p for p in directory.rglob('*') if p.is_file() and '__pycache__' not in p.parts and p.suffix!='.pyc']
        if not found:raise ValueError('Empty directory: '+folder)
        paths.update(found)
    return {p.relative_to(root).as_posix():sha(p) for p in sorted(paths)}

def inputs(root=ROOT):
    files=['package.json','package-lock.json']
    for folder in ['', 'apps/server','apps/client','packages/contracts']:
        for p in (root/folder).iterdir():
            if p.is_file() and (p.suffix in ['.json','.yaml','.yml','.ts','.js','.mjs','.cjs'] or p.name in ['.npmrc','.nvmrc'] or p.name.startswith('.env')):files.append(p.relative_to(root).as_posix())
    result=inventory(root,INPUT_DIRS,files)
    result.pop('apps/client/build/process-guard.generated.nsh',None)
    return result

def version(root=ROOT):
    v=json.loads((root/'package.json').read_text(encoding='utf-8'))['version']
    if not re.fullmatch(r'\d+\.\d+\.\d+(?:-[\w.]+)?',v):raise ValueError('Invalid release version')
    lock=json.loads((root/'package-lock.json').read_text(encoding='utf-8'))
    if lock['version']!=v:raise ValueError('Lockfile root version mismatch')
    for path in ['', 'apps/server','apps/client']:
        if json.loads((root/path/'package.json').read_text(encoding='utf-8'))['version']!=v or lock['packages'][path]['version']!=v:raise ValueError('Product version mismatch: '+path)
    contract=json.loads((root/'packages/contracts/package.json').read_text(encoding='utf-8'))['version']
    if lock['packages']['packages/contracts']['version']!=contract:raise ValueError('Contracts lock version mismatch')
    for path,count in [('apps/server/src/app.ts',2),('apps/server/src/index.ts',1),('apps/server/src/routes/maintenance.ts',1)]:
        matches=re.findall(r"version\s*:\s*'([^']+)'",(root/path).read_text(encoding='utf-8'))
        if matches!=[v]*count:raise ValueError('Runtime version mismatch: '+path)
    if not re.search(r"APP_VERSION\s*=\s*'"+re.escape(v)+"'",(root/'apps/client/src/renderer/src/utils/version.ts').read_text(encoding='utf-8')):raise ValueError('Display version mismatch')
    return v

def outputs(root=ROOT):
    v=version(root)
    return inventory(root,OUTPUT_DIRS+['apps/client/release/win-unpacked'],['apps/client/release/latest.yml',f'apps/client/release/ZA-Thera-{v}-Windows-x64.exe',f'apps/client/release/ZA-Thera-{v}-Windows-x64.exe.blockmap'])

def require_equal(expected,actual,label):
    if expected!=actual:raise ValueError(label+' changed; rebuild using scripts/release_build.py')

def verify():
    record=json.loads(RECORD.read_text(encoding='utf-8'))
    if record.get('schema')!=1 or record.get('version')!=version():raise ValueError('No matching successful release build')
    require_equal(record['inputs'],inputs(),'Build inputs')
    require_equal(record['outputs'],outputs(),'Build outputs')
    return sha(RECORD)

def node():
    p=Path(os.environ.get('SAAS_NODE',r'C:\Program Files\nodejs\node.exe'))
    if not p.is_absolute() or not p.is_file():raise ValueError('SAAS_NODE must be an existing absolute Node path')
    if not subprocess.check_output([str(p),'--version'],text=True).strip().startswith('v24.'):raise ValueError('Node 24 required')
    return p

def run_build():
    RECORD.parent.mkdir(exist_ok=True)
    RECORD.unlink(missing_ok=True)
    n=node();npm=n.parent/'node_modules/npm/bin/npm-cli.js'
    if not npm.is_file():raise ValueError('npm-cli.js not found beside selected Node')
    os.environ['PATH']=str(n.parent)+os.pathsep+os.environ.get('PATH','')
    if os.name=='nt':os.environ['PATHEXT']='.COM;.EXE;.BAT;.CMD'
    before=inputs();v=version()
    for args in [['run','typecheck'],['run','build'],['run','build:web','-w','@za-spa/client'],['run','package','-w','@za-spa/client']]:
        subprocess.run([str(n),str(npm),*args],cwd=ROOT,check=True)
        require_equal(before,inputs(),'Build inputs')
    subprocess.run([str(n),'scripts/verify-client-artifact.mjs'],cwd=ROOT,check=True)
    result={'schema':1,'version':v,'inputs':before,'outputs':outputs(),'node':subprocess.check_output([str(n),'--version'],text=True).strip()}
    require_equal(before,inputs(),'Build inputs')
    temp=RECORD.with_suffix('.tmp');temp.write_text(json.dumps(result,indent=2),encoding='utf-8');temp.replace(RECORD)
    print('Local release build verified; nothing deployed.')

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--verify',action='store_true');args=parser.parse_args()
    try:
        if args.verify:print('Build fingerprint verified: '+verify())
        else:run_build()
    except (ValueError,OSError,KeyError,subprocess.SubprocessError) as error:
        raise SystemExit('Release build check failed: '+str(error))
