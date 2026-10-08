// Medición opt-in del título con una ISO ya extraída en PROFILE.
// Uso: PROFILE=... CHANNEL=chrome PLAYWRIGHT=... node test-frame-pacing.mjs URL [fps_min=55]
import { pathToFileURL } from 'node:url';
const pw = await import(process.env.PLAYWRIGHT ? pathToFileURL(process.env.PLAYWRIGHT).href : 'playwright');
const { chromium } = pw.chromium ? pw : pw.default;
if (!process.env.PROFILE) throw new Error('Hace falta PROFILE con la ISO extraída');
const [url = 'http://localhost:8080', minimum = '55'] = process.argv.slice(2);
const context = await chromium.launchPersistentContext(process.env.PROFILE, {
  ...(process.env.CHANNEL ? {channel: process.env.CHANNEL} : {}),
  viewport: {width:1280,height:720},
  args: ['--autoplay-policy=no-user-gesture-required'],
});
try {
  const page = await context.newPage();
  const readings = [];
  let enteredAt = null;
  await new Promise(async (resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout esperando muestras estables del título')), 180000);
    page.on('pageerror', e => {clearTimeout(timer); reject(e);});
    page.on('console', m => {
      const text = m.text();
      if (enteredAt === null && /ctysluma/.test(text)) {enteredAt = Date.now(); console.log('[pacing] nivel del título detectado');}
      if (/crashed|has no suspended stack|abort/.test(text)) console.log('[pacing] aviso', text);
      const perf = text.match(/\[perf\] ([\d.]+) fps/);
      if (!perf || enteredAt === null || Date.now() - enteredAt < 20000) return;
      console.log(text);
      readings.push(Number(perf[1]));
      if (readings.length === 3) {clearTimeout(timer); resolve();}
    });
    try { await page.goto(`${url}/?boot=game&display=1`); }
    catch (e) {clearTimeout(timer);reject(e);}
  });
  const median = [...readings].sort((a,b)=>a-b)[1];
  console.log(`[pacing] mediana ${median} fps; mínimo solicitado ${minimum}`);
  if (median < Number(minimum)) process.exitCode = 1;
} finally { await context.close(); }
