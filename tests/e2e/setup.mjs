/**
 * Builds a runnable copy of the app that talks to the Firebase emulators
 * instead of Google's servers. Two deviations from what ships, both isolated
 * here so the test exercises the real data code:
 *   1. the SDK is bundled locally rather than fetched from gstatic
 *   2. sign-in uses the emulator's fake-credential flow instead of a Google popup
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const tmp = join(here, '.tmp');
const app = join(tmp, 'app');

rmSync(tmp, { recursive: true, force: true });
mkdirSync(join(app, 'vendor'), { recursive: true });

for (const entry of ['index.html', 'config.js', 'manifest.webmanifest', 'assets']) {
  cpSync(join(repo, entry), join(app, entry), { recursive: true });
}

// 1. One bundle, re-exported three ways, so app/auth/firestore share a core.
writeFileSync(join(tmp, 'entry-core.js'),
  "export * from 'firebase/app';\nexport * from 'firebase/auth';\nexport * from 'firebase/firestore';\n");
execFileSync(join(here, 'node_modules', '.bin', 'esbuild'), [
  join(tmp, 'entry-core.js'), '--bundle', '--format=esm',
  `--outfile=${join(app, 'vendor', 'firebase-core.js')}`, '--log-level=error',
], { cwd: here });
for (const m of ['app', 'auth', 'firestore']) {
  writeFileSync(join(app, 'vendor', `firebase-${m}.js`), "export * from './firebase-core.js';\n");
}

// 2. Point the provider at the local bundle and the emulators.
const providerPath = join(app, 'assets', 'js', 'data', 'firebase.js');
let provider = readFileSync(providerPath, 'utf8');
const swap = (from, to) => {
  if (!provider.includes(from)) throw new Error(`setup: could not patch — app source changed near:\n${from.slice(0, 80)}`);
  provider = provider.replace(from, to);
};

swap("const SDK = 'https://www.gstatic.com/firebasejs/12.18.0';",
     "const SDK = new URL('../../../vendor', import.meta.url).href;");
swap('      await fb.auth.setPersistence(auth, fb.auth.browserLocalPersistence).catch(() => {});',
`      fb.auth.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      fb.db.connectFirestoreEmulator(db, '127.0.0.1', 8080);
      await fb.auth.setPersistence(auth, fb.auth.browserLocalPersistence).catch(() => {});`);
swap(`      // Completes a redirect sign-in (used when popups are unavailable).
      await fb.auth.getRedirectResult(auth).catch(() => {});`, '');
swap(`      try {
        const cred = await signInWithPopup(auth, provider);
        return toProfile(cred.user);`,
`      try {
        const q = new URLSearchParams(location.search);
        const token = JSON.stringify({
          sub: q.get('uid') || 'test-uid',
          email: q.get('email') || 'test@example.com',
          email_verified: true,
          name: q.get('name') || 'Test User',
        });
        const c = await fb.auth.signInWithCredential(auth, GoogleAuthProvider.credential(token));
        return toProfile(c.user);
        // eslint-disable-next-line no-unreachable
        const cred = await signInWithPopup(auth, provider);
        return toProfile(cred.user);`);
writeFileSync(providerPath, provider);

// The emulator project needs no real credentials.
writeFileSync(join(app, 'config.js'), readFileSync(join(repo, 'config.js'), 'utf8')
  .replace(/  firebase: \{[\s\S]*?\n  \},/,
`  firebase: {
    apiKey: 'fake-api-key', authDomain: '127.0.0.1',
    projectId: 'taskboard-test', appId: '1:1:web:test',
  },`));

cpSync(join(repo, 'firestore.rules'), join(tmp, 'firestore.rules'));
writeFileSync(join(tmp, 'firebase.json'), JSON.stringify({
  firestore: { rules: 'firestore.rules' },
  emulators: {
    auth: { host: '127.0.0.1', port: 9099 },
    firestore: { host: '127.0.0.1', port: 8080 },
    ui: { enabled: false },
    singleProjectMode: true,
  },
}, null, 2));
writeFileSync(join(tmp, '.firebaserc'), JSON.stringify({ projects: { default: 'taskboard-test' } }));

console.log('e2e: prepared', tmp);
