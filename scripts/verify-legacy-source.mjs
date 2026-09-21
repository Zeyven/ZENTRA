import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const baseline=JSON.parse(await readFile(new URL('../docs/legacy-source-baseline.json',import.meta.url),'utf8'));
const changed=[];
for(const [file,expected] of Object.entries(baseline)){const actual=createHash('sha256').update(await readFile(file)).digest('hex');if(actual!==expected)changed.push(file)}
console.log(JSON.stringify({files:Object.keys(baseline).length,changed},null,2));if(changed.length)process.exitCode=1;
