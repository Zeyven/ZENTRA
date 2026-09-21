import {readFile,writeFile} from 'node:fs/promises';
const source=await readFile(new URL('../apps/client/build/process-guard.ps1',import.meta.url),'utf8');
const encoded=Buffer.from(source,'utf16le').toString('base64');
if(encoded.length>7400)throw Error('Installer guard exceeds NSIS command length');
await writeFile(new URL('../apps/client/build/process-guard.generated.nsh',import.meta.url),`!define THERA_PROCESS_GUARD "${encoded}"\n`);
