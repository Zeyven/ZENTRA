from pathlib import Path
import hashlib,json,re,shutil
root=Path(__file__).resolve().parents[1]
assert root==Path('E:/Shipin/ZuyuSaaS')
legacy=root.parent/'ZuyuPOS'
server=root.parent/'ZuyuPOS-server'
client=root/'apps/client'
client.mkdir(parents=True,exist_ok=True)
target=client/'src/renderer'
if target.exists(): raise SystemExit('Renderer already exists; do not overwrite work')
shutil.copytree(legacy/'src/renderer',target)
for name in ['tsconfig.web.json','tsconfig.node.json','tsconfig.json','tailwind.config.js','postcss.config.js','electron.vite.config.ts','vite.web.config.ts']:
 if (legacy/name).exists():shutil.copy2(legacy/name,client/name)
shutil.copytree(legacy/'build',client/'build',ignore=shutil.ignore_patterns('*.p12','*.pem','*.key'))
pkg=json.loads((legacy/'package.json').read_text(encoding='utf-8'))
pkg.update(name='@za-spa/client',version='1.0.0-rc.1',description='ZA-SPA SaaS independent merchant client',private=True)
pkg['scripts']={k:v for k,v in pkg['scripts'].items() if k in ['dev','dev:web','build','build:web','start','typecheck','package']}
pkg['scripts']['package']='electron-vite build && electron-builder --win'
(client/'package.json').write_text(json.dumps(pkg,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
baseline={}
for base in [legacy,server]:
 for source in [*sorted((base/'src').rglob('*')),base/'package.json',base/'package-lock.json']:
  if source.is_file():baseline[str(source)]=hashlib.sha256(source.read_bytes()).hexdigest()
(root/'docs/legacy-source-baseline.json').write_text(json.dumps(baseline,indent=2)+'\n',encoding='utf-8')
routes=[]
for source in sorted((server/'src/routes').glob('*.js')):
 for m in re.finditer(r"\b(?:router|privateRouter|webhookRouter)\.(get|post|put|delete|patch)\(['\"]([^'\"]+)",source.read_text(encoding='utf-8')):
  routes.append({'module':source.stem,'method':m.group(1).upper(),'path':m.group(2),'status':'pending'})
(root/'docs/feature-parity.json').write_text(json.dumps(routes,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('Legacy baseline files:',len(baseline),'API operations:',len(routes))
