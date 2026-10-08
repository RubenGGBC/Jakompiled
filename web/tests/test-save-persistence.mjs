// Kernel: backend/tests/runtime/save-persistence.gc. Sin ISO y con perfil propio.
import {pathToFileURL} from 'node:url';
const pw=await import(process.env.PLAYWRIGHT?pathToFileURL(process.env.PLAYWRIGHT).href:'playwright');
const {chromium}=pw.chromium?pw:pw.default;
import {mkdtempSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const profile=mkdtempSync(resolve('web/work/save-profile-'));
const url=process.argv[2]??'http://localhost:8081';
for (let run=0;run<4;run++) {
 const context=await chromium.launchPersistentContext(profile,{channel:'chrome'});
 try {
  const page=await context.newPage();
  if (run===2) await page.addInitScript(()=>{
    const set=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){if(String(key).startsWith('jakompiled:saves:'))throw new DOMException('Cuota agotada','QuotaExceededError');return set.call(this,key,value);};
  });
  const result=new Promise((resolve,reject)=>{
   const timeout=setTimeout(()=>reject(Error('Timeout esperando save-test')),60000);
   const lines=[];
   page.on('console',m=>{const t=m.text();if(t.includes('[save-test]')){console.log(t);lines.push(t);if(t.includes('[save-test] done')){clearTimeout(timeout);resolve(lines.join('\n'));}}if(t.includes('Error opening file'))console.log(t);});
   page.on('pageerror',e=>{clearTimeout(timeout);reject(e);});
  });
  await page.goto(url);
  const output=await result;
  assert.match(output,run===2?/save result 5/:/save result 1/);
  if(run===1)assert.match(output,/loaded 123 231/);
  if(run>=2)assert.match(output,/loaded 77 88/);
  if(run===2)assert.match(output,/rollback 77 88 result 1/);
  const records=await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('jakompiled:saves:')));
  assert.equal(records.length,run===0?1:2,'El banco debe estar confirmado en localStorage');
 }finally {await context.close();}
}
console.log('OK: reinicio de Chrome, cuota agotada y conservación del guardado anterior');
