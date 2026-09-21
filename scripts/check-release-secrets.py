"""Review staged content and untracked text; never print matching secret values."""
import re,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
RULES={
 'private-key':re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----'),
 'database-credential':re.compile(rb'''postgres(?:ql)?://[^\s/:@"']+:[^\s/@"']+@'''),
 'credential-assignment':re.compile(rb'''(?i)(?:password|api_key|jwt_secret)\s*["']?\s*[:=]\s*["']([^"'\r\n]{8,})["']'''),
}
def findings(data):
    if b'\0' in data:return []
    return [name for name,pattern in RULES.items() if pattern.search(data)]
def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT)
def main():
    staged=git('diff','--cached','--name-only','--diff-filter=ACMR','-z').split(b'\0')
    untracked=git('ls-files','--others','--exclude-standard','-z').split(b'\0')
    hits=[]
    for names,index in [(staged,True),(untracked,False)]:
        for raw in filter(None,names):
            path=raw.decode('utf-8')
            data=git('show',':'+path) if index else (ROOT/path).read_bytes()
            for rule in findings(data):hits.append({'file':path,'rule':rule,'source':'staged' if index else 'untracked'})
    import json
    print(json.dumps({'findings':hits,'scope':'staged and untracked text; heuristic only'},ensure_ascii=False))
    return 1 if hits else 0
if __name__=='__main__':sys.exit(main())
