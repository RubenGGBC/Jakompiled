// Requiere el kernel con backend/tests/runtime/fiber-cleanup.gc, servido sin ISO.
// Uso: PLAYWRIGHT=... CHROME=... node test-fiber-cleanup.mjs URL
import {spawn} from 'node:child_process';
import {readFileSync,mkdtempSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const pw = await import(process.env.PLAYWRIGHT ? pathToFileURL(process.env.PLAYWRIGHT).href : 'playwright');
const {chromium}=pw.chromium?pw:pw.default;
const profile=mkdtempSync(resolve('web/work/fiber-profile-'));
const chrome=spawn(process.env.CHROME??chromium.executablePath(),[
  '--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',
  `--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore',windowsHide:true});
let browser, socket;
try {
  let port, wsPath;
  for(let i=0;i<300;i++) {
    try {[port,wsPath]=readFileSync(`${profile}/DevToolsActivePort`,'utf8').trim().split('\n');break;}
    catch {await new Promise(r=>setTimeout(r,100));}
  }
  assert.ok(port,'Chrome no abrió su puerto de diagnóstico propio');
  socket=new WebSocket(`ws://127.0.0.1:${port}${wsPath}`);
  await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});
  let id=0;const pending=new Map(),sessions=new Set();
  const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{
    const n=++id;const timer=setTimeout(()=>{pending.delete(n);reject(Error(`CDP timeout: ${method}`));},5000);pending.set(n,{resolve:r=>{clearTimeout(timer);resolve(r);},reject:e=>{clearTimeout(timer);reject(e);}});socket.send(JSON.stringify({id:n,method,params,...(sessionId?{sessionId}:{})}));
  });
  socket.onmessage=event=>{
    const m=JSON.parse(event.data);
    if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(p){m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}return;}
    if(m.method==='Target.attachedToTarget'){
      sessions.add(m.params.sessionId);
      send('Debugger.enable',{},m.params.sessionId).catch(()=>{});
      send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:false,flatten:true},m.params.sessionId).catch(()=>{});
    }
    if(m.method==='Target.detachedFromTarget')sessions.delete(m.params.sessionId);
  };
  await send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:false,flatten:true});
  browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page=await browser.contexts()[0].newPage();
  let done,fail;const finished=new Promise((r,j)=>{done=r;fail=j;});
  const timer=setTimeout(()=>fail(Error('Timeout en la prueba de fibras')),60000);
  page.on('console',m=>{const t=m.text();if(t.includes('fiber-test:')){console.log(t);done();}if(/crashed|RuntimeError|abort/.test(t)){console.log(t);fail(Error(t));}});
  page.on('pageerror',fail);
  try {
    await page.goto(process.argv[2]??'http://localhost:8081');await finished;
    await page.waitForTimeout(200);
    await Promise.allSettled([...sessions].map(session=>send('Debugger.pause',{},session)));
    const responses=await Promise.allSettled([...sessions].map(async session=>{
      const r=await send('Runtime.evaluate',{expression:'globalThis.jak ? ({fibers:globalThis.jak.fibers.size}) : null',returnByValue:true},session);
      return r.result.value;
    }));
    const states=responses.filter(r=>r.status==='fulfilled'&&r.value).map(r=>r.value);
    assert.equal(states.length,1,'Debe haber un único worker EE con estado GOAL');
    console.log('[fiber-test]',states[0]);
    assert.equal(states[0].fibers,0,'Quedan fibras de procesos muertos en el worker EE');
  }finally{clearTimeout(timer);}
}finally {
  if(browser)await browser.close();
  socket?.close();
  chrome.kill();
}
