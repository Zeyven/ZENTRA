import ts from 'typescript';
import {readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createApp} from '../apps/server/src/app.js';
import {closePools} from '../apps/server/src/db/pools.js';
import assert from 'node:assert/strict';
assert.equal(process.env.NODE_ENV,'test');
const source=ts.createSourceFile('api.ts',await readFile('apps/client/src/renderer/src/api/index.ts','utf8'),ts.ScriptTarget.Latest,true);
function value(n:ts.Node):string{
 if(ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n))return n.text;
 if(ts.isIdentifier(n))return n.text==='P'?'/api/merchant/v1':'1';
 if(ts.isCallExpression(n)&&n.expression.getText(source)==='query')return '';
 if(ts.isParenthesizedExpression(n))return value(n.expression);
 if(ts.isConditionalExpression(n))return value(n.whenFalse);
 if(ts.isBinaryExpression(n)&&n.operatorToken.kind===ts.SyntaxKind.PlusToken)return value(n.left)+value(n.right);
 if(ts.isTemplateExpression(n))return n.head.text+n.templateSpans.map(s=>'1'+s.literal.text).join('');
 return '1';
}
const routes=new Map<string,{path:string;method:string;line:number}>();
function visit(n:ts.Node){
 if(ts.isCallExpression(n)&&['mutateOrder','mutateItem'].includes(n.expression.getText(source))&&n.arguments[1]&&ts.isStringLiteral(n.arguments[1])){
  const path='/api/merchant/v1/'+(n.expression.getText(source)==='mutateOrder'?'sessions':'session-items')+'/1/'+n.arguments[1].text;
  routes.set('POST '+path,{path,method:'POST',line:source.getLineAndCharacterOfPosition(n.pos).line+1});
 }
 if(ts.isCallExpression(n)&&n.expression.getText(source)==='remote'&&n.arguments[0]){
  const path=value(n.arguments[0]).split('?')[0];let method='GET';const options=n.arguments[1];
  if(options&&ts.isObjectLiteralExpression(options)){const prop=options.properties.find(p=>ts.isPropertyAssignment(p)&&p.name.getText(source)==='method');if(prop&&ts.isPropertyAssignment(prop))method=value(prop.initializer)}
  if(path.startsWith('/api/merchant/v1/')&&!path.includes('/auth/')&&!/^\/api\/merchant\/v1\/(sessions|session-items)\/1\/1$/.test(path))routes.set(method+' '+path,{path,method,line:source.getLineAndCharacterOfPosition(n.pos).line+1});
 }
 ts.forEachChild(n,visit);
}visit(source);
const server=createServer(createApp());server.listen(0,'127.0.0.1');await once(server,'listening');const port=(server.address() as any).port;
try{const results=[];for(const route of routes.values()){
 const response=await fetch('http://127.0.0.1:'+port+route.path,{method:route.method,headers:{'Content-Type':'application/json'},body:['GET','HEAD'].includes(route.method)?undefined:'{}'});
 results.push({...route,status:response.status});
}const missing=results.filter(r=>r.status===404);await writeFile('.runtime/client-route-audit.json',JSON.stringify({checked:results.length,missing,results},null,2));console.log(JSON.stringify({checked:results.length,missing},null,2));assert.equal(missing.length,0,'Client calls unimplemented routes');
}finally{await new Promise<void>(r=>server.close(()=>r()));await closePools()}
