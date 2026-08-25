/**
 * End-to-end proof that a task created in one browser is stored on the server
 * and visible in a different browser signed in to the same account.
 *
 * Run: npm install && npm run setup && npm test   (see README.md)
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const tmp = join(here, '.tmp');
const APP_PORT = 8124;
const RUN = String(Date.now());
const EMAIL = `marc-${RUN}@example.com`;
const UID = `marc-${RUN}`;
const REST = 'http://127.0.0.1:8080/v1/projects/taskboard-test/databases/(default)/documents';

const results = [];
const ok = (label, pass, extra = '') => {
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${extra ? '  — ' + extra : ''}`);
};

/** Poll until `fn` is true, so a slow first snapshot isn't read as a failure. */
async function waitFor(fn, timeout = 12000, step = 250) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, step));
  }
  return false;
}

const types = { html: 'text/html', js: 'text/javascript', css: 'text/css', json: 'application/json' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  const file = join(tmp, 'app', path === '/' ? 'index.html' : path);
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[file.split('.').pop()] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404).end('not found'); }
}).listen(APP_PORT);

const emulators = spawn(join(here, 'node_modules', '.bin', 'firebase'),
  ['emulators:start', '--only', 'auth,firestore', '--project', 'taskboard-test'],
  { cwd: tmp, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('emulators did not start in 90s')), 90000);
  emulators.stdout.on('data', (chunk) => {
    if (String(chunk).includes('All emulators ready')) { clearTimeout(timer); resolve(); }
  });
});

const url = (extra = '') => `http://127.0.0.1:${APP_PORT}/index.html?uid=${UID}&email=${encodeURIComponent(EMAIL)}${extra}`;
const fromServer = async (path = '') =>
  (await fetch(`${REST}/${path}`, { headers: { Authorization: 'Bearer owner' } })).json();

const browser = await chromium.launch();
const errors = [];
const watch = (page, tag) => {
  page.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`));
  page.on('console', (m) => {
    // Network noise from the deliberate offline phase is expected.
    if (m.type() !== 'error' || /ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(m.text())) return;
    errors.push(`${tag} console: ${m.text()}`);
  });
};

async function signIn(page) {
  await page.goto(url(), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#auth-actions button', { timeout: 20000 });
  await page.click('#auth-actions button:has-text("Continue with Google")');
  await page.waitForSelector('#app:not([hidden])', { timeout: 20000 });
}

async function addTask(page, column, title) {
  await page.locator('.column', { hasText: column }).locator('.column__foot button').click();
  await page.keyboard.type(title);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
}

try {
  // --- one browser creates a board and a task
  const ctxA = await browser.newContext();
  const A = await ctxA.newPage();
  watch(A, 'browser1');
  await signIn(A);

  await A.click('#new-board-btn');
  await A.fill('.modal input.input', `E2E ${RUN}`);
  await A.click('.modal button:has-text("Create board")');
  await A.waitForSelector('.column', { timeout: 15000 });
  await A.waitForTimeout(1500);
  await addTask(A, 'Blocked', 'blocked task');

  ok('creating browser shows its own task', await waitFor(async () =>
    (await A.locator('.card__title').allTextContents()).includes('blocked task')));
  ok('sync indicator reports synced', await waitFor(async () =>
    (await A.textContent('#mode-chip')).includes('Synced')));

  if (process.env.DEBUG_STATE) {
    console.log('  state:', JSON.stringify(await A.evaluate(() => {
      const s = window.taskboard.state;
      return {
        boardId: s.boardId, boardName: s.board?.name,
        boards: s.boards.map((b) => `${b.id}:${b.name}`),
        boardColumns: (s.board?.columns || []).map((c) => `${c.id}:${c.name}`),
        tasks: s.tasks.map((t) => `${t.title}@${t.columnId}`),
        visible: s.visibleTasks.length,
        domCards: document.querySelectorAll('.card').length,
        domColumns: [...document.querySelectorAll('.column')].map((c) => c.dataset.columnId),
        filters: s.filters,
      };
    })));
  }

  // --- the server really has it
  const boardDocs = ((await fromServer('boards')).documents || [])
    .filter((d) => d.fields?.name?.stringValue === `E2E ${RUN}`);
  ok('board reached the server', boardDocs.length === 1);
  const boardId = boardDocs[0]?.name.split('/').pop();
  const titles = ((await fromServer(`boards/${boardId}/tasks`)).documents || [])
    .map((d) => d.fields.title.stringValue);
  ok('task reached the server', titles.includes('blocked task'), JSON.stringify(titles));

  // --- a different browser, same account, separate storage
  const ctxB = await browser.newContext();
  const B = await ctxB.newPage();
  watch(B, 'browser2');
  await signIn(B);
  ok('second browser sees the board', await waitFor(async () =>
    (await B.$$eval('.nav-item__name', (n) => n.map((e) => e.textContent))).includes(`E2E ${RUN}`)));
  await B.locator('.nav-item', { hasText: `E2E ${RUN}` }).click();
  ok('second browser sees the task', await waitFor(async () =>
    (await B.locator('.card__title').allTextContents()).includes('blocked task')));

  // --- live sync between the two
  await addTask(A, 'To do', 'live sync check');
  ok('a new task appears live in the other browser', await waitFor(async () =>
    (await B.locator('.card__title').allTextContents()).includes('live sync check')));

  // --- offline writes queue and land on reconnect
  await ctxA.setOffline(true);
  await addTask(A, 'Backlog', 'written while offline');
  // Either wording is correct while disconnected; what matters is that it does
  // not claim the change is saved.
  ok('offline write is not reported as synced', await waitFor(async () =>
    !(await A.textContent('#mode-chip')).includes('Synced')));
  await ctxA.setOffline(false);
  await waitFor(async () => (await A.textContent('#mode-chip')).includes('Synced'), 20000);
  const afterReconnect = ((await fromServer(`boards/${boardId}/tasks`)).documents || [])
    .map((d) => d.fields.title.stringValue);
  ok('queued offline write reaches the server', afterReconnect.includes('written while offline'),
     JSON.stringify(afterReconnect));

  ok('no JavaScript errors in either browser', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
  server.close();
  emulators.kill('SIGTERM');
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
