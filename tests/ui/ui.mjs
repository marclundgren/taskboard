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

  // --- dialog must stay above the on-screen keyboard ---
  const vv = await phone.evaluate(() => ({
    height: getComputedStyle(document.documentElement).getPropertyValue('--vv-height').trim(),
    inner: window.innerHeight,
  }));
  ok('mobile: dialogs track the visual viewport', vv.height === `${vv.inner}px`, JSON.stringify(vv));

  await phone.locator('.card').first().tap();
  await phone.waitForSelector('.modal');
  // Stand in for the keyboard: the visual viewport shrinks, layout does not.
  const KEYBOARD_HEIGHT = 380;
  const shrunk = await phone.evaluate((h) => {
    document.documentElement.style.setProperty('--vv-height', `${h}px`);
    const foot = document.querySelector('.modal__foot').getBoundingClientRect();
    const body = document.querySelector('.modal__body');
    return {
      footBottom: Math.round(foot.bottom),
      footVisible: foot.bottom <= h + 1,
      bodyScrolls: body.scrollHeight > body.clientHeight,
    };
  }, KEYBOARD_HEIGHT);
  ok('mobile: dialog buttons stay above the keyboard',
     shrunk.footVisible, `footer bottom ${shrunk.footBottom} vs viewport ${KEYBOARD_HEIGHT}`);
  ok('mobile: the dialog body scrolls instead of pushing buttons off screen', shrunk.bodyScrolls);

  const overflow = await phone.evaluate(() => {
    const modal = document.querySelector('.modal').getBoundingClientRect();
    return [...document.querySelectorAll('.modal__body *')]
      .filter((el) => el.offsetParent !== null)
      .map((el) => ({ el: el.className || el.tagName, over: Math.round(el.getBoundingClientRect().right - modal.right) }))
      .filter((x) => x.over > 1);
  });
  ok('mobile: nothing in the dialog overflows its edge', overflow.length === 0, JSON.stringify(overflow));
  await phone.keyboard.press('Escape');
  await phone.evaluate(() => document.documentElement.style.removeProperty('--vv-height'));

  // the scroller must hold wherever it is left, including the far end
  const held = await phone.evaluate(async () => {
    const board = document.getElementById('board');
    const max = board.scrollWidth - board.clientWidth;
    board.scrollTo({ left: max, behavior: 'instant' });
    await new Promise((r) => setTimeout(r, 900));
    const atEnd = Math.round(board.scrollLeft);
    board.scrollTo({ left: Math.round(max / 2), behavior: 'instant' });
    await new Promise((r) => setTimeout(r, 900));
    return { max: Math.round(max), atEnd, mid: Math.round(board.scrollLeft), wanted: Math.round(max / 2) };
  });
  ok('mobile: the board stays where it is scrolled, at the end and in between',
     held.atEnd === held.max && held.mid === held.wanted, JSON.stringify(held));

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

  await desk.locator('.card').first().click();
  await desk.waitForSelector('.modal');
  await desk.locator('.modal button:has-text("+ Add item")').click();
  const deskSmall = await desk.evaluate(() => [...document.querySelectorAll('input, textarea, select')]
    .filter((el) => el.type !== 'checkbox' && el.offsetParent !== null)
    .map((el) => ({ el: el.className || el.type, px: parseFloat(getComputedStyle(el).fontSize) }))
    .filter((f) => f.px < 16));
  ok('desktop: the 16px floor applies without a media query', deskSmall.length === 0, JSON.stringify(deskSmall));
  await desk.keyboard.press('Escape');

  ok('no JavaScript errors', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
