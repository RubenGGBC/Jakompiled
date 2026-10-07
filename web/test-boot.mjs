// Arranca la página en Chromium headless y comprueba hasta dónde llega el runtime.
// Uso: node test-boot.mjs [url] [timeout_s]
// PLAYWRIGHT permite usar una instalación global: PLAYWRIGHT=$(npm root -g)/playwright/index.js
const pw = await import(process.env.PLAYWRIGHT ?? "playwright");
const { chromium } = pw.chromium ? pw : pw.default;

const url = process.argv[2] ?? "http://localhost:8080/";
const timeoutMs = Number(process.argv[3] ?? 120) * 1000;

const browser = await chromium.launch();
const page = await browser.newPage();
const lines = [];
let done;
const finished = new Promise((r) => (done = r));
page.on("console", (msg) => {
  const text = msg.text();
  lines.push(text);
  console.log(text);
  if (text.includes("[jakompiled]") || text.includes("[boot] abort")) done("stopped");
});
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));

await page.goto(url);
const isolated = await page.evaluate(() => crossOriginIsolated);
console.log(`[test] crossOriginIsolated=${isolated}`);
const outcome = await Promise.race([finished, new Promise((r) => setTimeout(() => r("timeout"), timeoutMs))]);
await browser.close();

const reached = lines.some((l) => l.includes("[jakompiled]") && l.includes("call into GOAL code"));
console.log(`[test] outcome=${outcome} reached_goal_call=${reached}`);
process.exit(reached ? 0 : 1);
