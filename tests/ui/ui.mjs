/**
 * UI checks that need no backend — the app runs in local mode via ?mode=local.
 *
 *   node tests/ui/ui.mjs            (serves the repo itself on :8125)
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = 8125;
const APP = `http://127.0.0.1:${PORT}/index.html?mode=local`;
const types = { html: 'text/html', js: 'text/javascript', css: 'text/css', json: 'application/json' };

const results = [];
const ok = (label, pass, extra = '') => {
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${extra ? '  — ' + extra : ''}`);
};

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  try {
    const file = join(repo, path === '/' ? 'index.html' : path);
    res.writeHead(200, { 'content-type': types[file.split('.').pop()] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch { res.writeHead(404).end('not found'); }
}).listen(PORT);

const browser = await chromium.launch();
const errors = [];

async function start(page) {
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await page.click('#auth-actions button');
  await page.waitForSelector('.column .card');
}

try {
  // --- phone: the far end of the board must be reachable ---
  const phone = await browser.newPage({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
  await start(phone);

  const reach = await phone.evaluate(async () => {
    const board = document.getElementById('board');
    board.scrollTo({ left: board.scrollWidth - board.clientWidth, behavior: 'instant' });
    await new Promise((r) => setTimeout(r, 900));   // let scroll snapping settle
    const add = document.querySelector('.add-column').getBoundingClientRect();
    return { visible: add.left >= 0 && add.right <= window.innerWidth, left: Math.round(add.left) };
  });
  ok('mobile: "Add column" is reachable at the end of the board', reach.visible, `left=${reach.left}`);

  await phone.locator('.add-column').tap();
  ok('mobile: "Add column" opens its dialog',
     await phone.locator('.modal:has-text("Add column")').isVisible().catch(() => false));
  await phone.keyboard.press('Escape');

  // --- iOS zooms the page when a focused field is under 16px ---
  const fieldSizes = () => phone.evaluate(() => [...document.querySelectorAll('input, textarea, select')]
    .filter((el) => el.type !== 'checkbox' && el.offsetParent !== null)
    .map((el) => ({ el: el.className || el.type, px: parseFloat(getComputedStyle(el).fontSize) })));

  const tooSmall = [];
  const collect = async () => tooSmall.push(...(await fieldSizes()).filter((f) => f.px < 16));

  await phone.locator('.column', { hasText: 'To do' }).locator('.column__foot button').tap();
  await collect();                                        // the card composer
  await phone.keyboard.press('Escape');

  await phone.locator('.card').first().tap();
  await phone.waitForSelector('.modal');
  await collect();                                        // title, selects, due date, notes
  await phone.locator('.modal button:has-text("+ Add item")').tap();
  await collect();                                        // checklist row
  await phone.keyboard.press('Escape');

  ok('mobile: no text field is small enough to trigger iOS zoom on focus',
     tooSmall.length === 0, JSON.stringify(tooSmall));

  // columns should still snap, or the phone layout loses its rhythm
  const snaps = await phone.evaluate(() => getComputedStyle(document.getElementById('board')).scrollSnapType);
  ok('mobile: columns still snap while scrolling', snaps.startsWith('x'), snaps);

  // --- desktop: dragging a card between columns ---
  const desk = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  await start(desk);
  const card = desk.locator('.card', { hasText: 'Drag me to another column' });
  const from = await card.boundingBox();
  const target = await desk.locator('.column', { hasText: 'In progress' }).boundingBox();
  await desk.mouse.move(from.x + from.width / 2, from.y + 20);
  await desk.mouse.down();
  await desk.mouse.move(from.x + from.width / 2 + 40, from.y + 40, { steps: 6 });
  await desk.mouse.move(target.x + target.width / 2, target.y + 120, { steps: 12 });
  await desk.mouse.up();
  await desk.waitForTimeout(400);
  ok('desktop: a card can be dragged to another column',
     (await desk.locator('.column', { hasText: 'In progress' }).locator('.card__title').allTextContents())
       .includes('Drag me to another column'));

  // --- keyboard: the non-dragging path WCAG 2.5.7 asks for ---
  await desk.locator('.card', { hasText: 'Open me to add notes' }).focus();
  await desk.keyboard.press(' ');
  await desk.keyboard.press('ArrowRight');
  await desk.keyboard.press(' ');
  await desk.waitForTimeout(400);
  ok('keyboard: a focused card can be moved with the arrow keys',
     (await desk.locator('.column', { hasText: 'In progress' }).locator('.card__title').allTextContents())
       .includes('Open me to add notes, a due date and a checklist'));

  ok('no JavaScript errors', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
