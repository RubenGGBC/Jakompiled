// Prueba determinista del reloj usado por el runtime web, sin ISO ni navegador.
// Lee el helper real de opengl.cpp después de aplicar los parches a jak-project.
// Uso: node test-web-frame-clock.mjs [ruta/opengl.cpp]
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const path = process.argv[2] ?? 'web/work/jak-project/game/graphics/pipelines/opengl.cpp';
const source = readFileSync(path, 'utf8');
const body = source.match(/EM_ASYNC_JS\(void, web_limit_frame, \(double interval\), \{([\s\S]*?)^\}\);/m)?.[1];
assert.ok(body, 'No se encuentra web_limit_frame en el runtime');
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
const limit = new AsyncFunction('interval', body);
async function withDisplay(hz, fn) {
  const oldRAF = globalThis.requestAnimationFrame;
  let stamp = 0;
  delete globalThis.jakompiledFrameClock;
  globalThis.requestAnimationFrame = callback => {stamp += 1000 / hz; callback(stamp);};
  try {await fn({now:()=>stamp, stall:ms=>{stamp+=ms;}});}
  finally {delete globalThis.jakompiledFrameClock;globalThis.requestAnimationFrame=oldRAF;}
}
for (const [display, target] of [[60,60],[60,30],[144,60]]) {
  test(`pantalla ${display} Hz, objetivo ${target} fps`, async()=>{
    await withDisplay(display, async ({now})=>{
      await limit(1000/target);
      const start = now();
      for(let i=0;i<120;i++) await limit(1000/target);
      const actual = 120000/(now()-start);
      assert.ok(Math.abs(actual-target)<0.5, `ritmo obtenido: ${actual}`);
    });
  });
}
test('una pausa larga no produce una ráfaga para recuperar fotogramas',async()=>{
  await withDisplay(60,async({now,stall})=>{
    await limit(1000/60);stall(2000);await limit(1000/60);
    let last=now();
    for(let i=0;i<4;i++){await limit(1000/60);assert.ok(now()-last>=16);last=now();}
  });
});
test('cambiar el objetivo reinicia el plazo sin quedarse esperando el anterior',async()=>{
  await withDisplay(60,async({now})=>{
    await limit(1000/10);const start=now();await limit(1000/60);
    assert.ok(now()-start<17);
  });
});
