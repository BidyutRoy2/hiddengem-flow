// Probe 16 (v2): does clicking "Details" on chrome://extensions show
// "Allow User Scripts" in the shadow DOM? Closes live-test6 test 3's
// last assertion (the ?id= deep link renders the LIST in this build).
delete process.env.HTTP_PROXY; delete process.env.HTTPS_PROXY;
delete process.env.http_proxy; delete process.env.https_proxy;
delete process.env.ALL_PROXY; delete process.env.all_proxy;

const { chromium } = require('playwright-core');
const EXT_PATH = '/home/hatch/workspace/hiddengem-flow/.output/chrome-mv3';
const CHROME = '/home/hatch/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome';
const PROFILE = '/home/hatch/workspace/hgf-live-test/profile-probe16';
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Walk every shadow root; return the list of visible text nodes.
// (Each evaluate() function must be fully self-contained — Playwright
// serializes only the function itself, not its closure.)
function collectTexts() {
  const out = [];
  function walk(node) {
    if (!node) return;
    if (node.nodeType === 1 && (node.tagName === 'STYLE' || node.tagName === 'SCRIPT')) return;
    if (node.nodeType === 3) { const t = node.textContent.trim(); if (t) out.push(t); return; }
    if (node.shadowRoot) walk(node.shadowRoot);
    const kids = node.childNodes ? Array.from(node.childNodes) : [];
    for (const k of kids) walk(k);
  }
  walk(document.documentElement);
  return out;
}
function hasText(label) {
  const out = [];
  function walk(node) {
    if (!node) return;
    if (node.nodeType === 1 && (node.tagName === 'STYLE' || node.tagName === 'SCRIPT')) return;
    if (node.nodeType === 3) { const t = node.textContent.trim(); if (t) out.push(t); return; }
    if (node.shadowRoot) walk(node.shadowRoot);
    const kids = node.childNodes ? Array.from(node.childNodes) : [];
    for (const k of kids) walk(k);
  }
  walk(document.documentElement);
  return out.some((t) => t.includes(label));
}
// Click the smallest element whose OWN text is exactly `label`.
function clickText(label) {
  let target = null;
  function walk(node) {
    if (target) return;
    if (node.nodeType === 1) {
      const tag = node.tagName;
      if (tag === 'STYLE' || tag === 'SCRIPT') return;
      let own = '';
      for (const c of node.childNodes) if (c.nodeType === 3) own += c.textContent;
      if (own.trim() === label) {
        const clickable = node.closest ? node.closest('button, a, cr-button, [role="button"]') : null;
        if (clickable) { target = clickable; return; }
      }
    }
    if (node.shadowRoot) walk(node.shadowRoot);
    const kids = node.childNodes ? Array.from(node.childNodes) : [];
    for (const k of kids) walk(k);
  }
  walk(document.documentElement);
  if (!target) return 'NOT-FOUND';
  target.click();
  return 'CLICKED ' + target.tagName;
}

(async () => {
  const context = await chromium.launchPersistentContext(PROFILE, {
    executablePath: CHROME, headless: false,
    args: [
      `--load-extension=${EXT_PATH}`,
      `--disable-extensions-except=${EXT_PATH}`,
      '--no-sandbox', '--disable-dev-shm-usage',
      '--window-size=1280,900', '--window-position=0,0',
      '--ignore-certificate-errors', '--disable-features=Translate',
    ],
    viewport: null, ignoreHTTPSErrors: true,
  });
  let sw = null;
  for (let i = 0; i < 20 && !sw; i++) {
    const sws = context.serviceWorkers();
    if (sws.length) sw = sws[0];
    else try { sw = await context.waitForEvent('serviceworker', { timeout: 2000 }); } catch {}
  }
  if (!sw) { console.log('NO SERVICE WORKER'); process.exit(1); }
  const extId = sw.url().split('/')[2];
  console.log('extId:', extId);
  const page = await context.newPage();
  await page.goto(`chrome://extensions/?id=${extId}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(3000);
  console.log('url:', page.url());
  console.log('Allow User Scripts before Details click:', await page.evaluate(hasText, 'Allow User Scripts'));
  console.log('HiddenGem Flow listed:', await page.evaluate(hasText, 'HiddenGem Flow'));
  console.log('clicking Details:', await page.evaluate(clickText, 'Details'));
  let found = false;
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    if (await page.evaluate(hasText, 'Allow User Scripts')) { found = true; break; }
  }
  console.log(`Allow User Scripts after Details click: ${found}`);
  console.log('url after:', page.url());
  await page.screenshot({ path: '/home/hatch/workspace/hgf-live-test/probe16-details.png' });
  const stillOff = await sw.evaluate(async () => {
    try { await chrome.userScripts.getScripts(); return false; } catch (e) { return true; }
  });
  console.log('toggle still OFF (getScripts throws):', stillOff);
  const texts = await page.evaluate(collectTexts);
  console.log('DETAILS PAGE TEXTS (' + texts.length + '):');
  console.log(texts.slice(0, 80).join(' | '));
  await context.close();
  process.exit(found && stillOff ? 0 : 1);
})().catch((e) => { console.error('PROBE FATAL', e); process.exit(2); });
