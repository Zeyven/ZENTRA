import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {computeDiscount,maskPhone,parseMoneyInput}=createRequire(import.meta.url)('../apps/client/src/renderer/src/utils/format.ts');

// 缺陷回归：整单折扣留空时 Number('') === 0，空输入被当成 0 折 → 静默全额减免。
// 下方 legacyDiscount 逐行还原修复前的实现，用于锁定「修复前的错误行为」，
// 任何一天有人回退 computeDiscount 的守卫，本组断言会立刻失败。
function legacyDiscount(discType:'rate'|'amount'|'round'|'free',discValue:string,discAmount:string,subtotal:number){
 let discount=0;
 if(discType==='rate')discount=subtotal*(1-Number(discValue)/100);
 else if(discType==='amount')discount=Number(discAmount);
 else if(discType==='round')discount=subtotal-Math.floor(subtotal);
 else discount=subtotal;
 return Math.max(0,Math.min(subtotal,Math.round(discount*100)/100));
}

test('回归锁定：修复前实现确实会把空折扣算成全额减免',()=>{
 assert.equal(legacyDiscount('rate','','',1280),1280,'空值被当成 0 折 → 全额减免');
 assert.equal(legacyDiscount('rate','0','',800),800,'空值与 0 折金额完全一致，无法区分');
 assert.ok(Number.isNaN(legacyDiscount('amount','','abc',500)),'非数字的金额输入在旧实现里产出 NaN，序列化后变成 null 提交');
});

test('整单折扣：空值/纯空格/非数字/零或负数/超过 100 一律拒绝，不产生任何减免',()=>{
 for(const value of ['','   ','abc','0','-10','100.1','150']){
  assert.throws(()=>computeDiscount({discType:'rate',discValue:value,subtotal:1280}),/折扣/,`折扣 ${JSON.stringify(value)} 必须被拒绝`);
 }
});

test('整单折扣：极端但合法的折扣（如 0.5 折）仍放行，由审批阈值管理',()=>{
 assert.deepEqual(computeDiscount({discType:'rate',discValue:'0.5',subtotal:1000}),{discount:995,detail:'整单0.5折'});
});

test('减免金额：空值/非数字/零/负数/超过小计一律拒绝',()=>{
 for(const value of ['','   ','abc','0','-50']){
  assert.throws(()=>computeDiscount({discType:'amount',discAmount:value,subtotal:500}),/减免金额/,`金额 ${JSON.stringify(value)} 必须被拒绝`);
 }
 assert.throws(()=>computeDiscount({discType:'amount',discAmount:'900',subtotal:500}),/不能超过订单小计/);
});

test('小计与折扣类型非法时拒绝',()=>{
 assert.throws(()=>computeDiscount({discType:'free',subtotal:Number.NaN}),/订单小计无效/);
 assert.throws(()=>computeDiscount({discType:'free',subtotal:-1}),/订单小计无效/);
 assert.throws(()=>computeDiscount({discType:'free',subtotal:'abc' as never}),/订单小计无效/);
 assert.throws(()=>computeDiscount({discType:'hack' as never,subtotal:100}),/折扣类型无效/);
});

test('正常路径行为不变：88 折 / 100 折 / 小数折 / 减免 / 抹零 / 免单',()=>{
 assert.deepEqual(computeDiscount({discType:'rate',discValue:'88',subtotal:1280}),{discount:153.6,detail:'整单88折'});
 assert.deepEqual(computeDiscount({discType:'rate',discValue:'100',subtotal:1280}),{discount:0,detail:'整单100折'});
 assert.deepEqual(computeDiscount({discType:'rate',discValue:'8.8',subtotal:1000}),{discount:912,detail:'整单8.8折'});
 assert.deepEqual(computeDiscount({discType:'amount',discAmount:' 50 ',subtotal:500}),{discount:50,detail:'优惠50元'});
 assert.deepEqual(computeDiscount({discType:'round',subtotal:1280.66}),{discount:0.66,detail:'抹零'});
 assert.deepEqual(computeDiscount({discType:'free',subtotal:1280}),{discount:1280,detail:'免单'});
 assert.deepEqual(computeDiscount({discType:'scheme',subtotal:1280}),{discount:0,detail:''});
});

test('产出金额永远是有限数，不会序列化成 null 提交',()=>{
 for(const input of [{discType:'rate' as const,discValue:'88',subtotal:1000},{discType:'round' as const,subtotal:0.3}]){
  const {discount}=computeDiscount(input);
  assert.ok(Number.isFinite(discount));
  assert.notEqual(JSON.stringify({discount}),'{"discount":null}');
 }
});

test('浮点尾差不外泄',()=>{
 const {discount}=computeDiscount({discType:'amount',discAmount:'0.1',subtotal:0.3});
 assert.equal(discount,0.1);
 assert.equal(Number((0.3-discount).toFixed(2)),0.2);
});

test('金额解析：空值与非有限数返回 NaN，数字与合法字符串返回数值',()=>{
 assert.ok(Number.isNaN(parseMoneyInput('')));
 assert.ok(Number.isNaN(parseMoneyInput('   ')));
 assert.ok(Number.isNaN(parseMoneyInput('abc')));
 assert.ok(Number.isNaN(parseMoneyInput(null)));
 assert.ok(Number.isNaN(parseMoneyInput(Number.NaN)));
 assert.ok(Number.isNaN(parseMoneyInput(Number.POSITIVE_INFINITY)));
 assert.equal(parseMoneyInput(' 88 '),88);
 assert.equal(parseMoneyInput(0),0);
});

test('手机号脱敏：列表默认不泄露完整号码',()=>{
 assert.equal(maskPhone('13812345678'),'138****5678');
 assert.equal(maskPhone(''),'-');
 assert.equal(maskPhone(null),'-');
 assert.equal(maskPhone(undefined),'-');
 assert.equal(maskPhone('12345'),'*****');
 assert.ok(!maskPhone('13812345678').includes('1234567'));
});
