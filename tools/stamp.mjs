/**
 * Stamps a build id into index.html.
 *
 * GitHub Pages serves assets with a cache lifetime, and Safari in particular
 * will happily keep an old stylesheet after a deploy. The stamp is appended to
 * the asset URLs so a new build cannot be served from an old cache, and it is
 * written into a meta tag so the running app can say which build it is.
 *
 *   node tools/stamp.mjs        # run before committing a change
 */
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * GitHub Pages archives the repo with `tar --dereference`, which fails on a
 * committed symlink whose target is not itself committed. The deploy then
 * fails and the previous build keeps being served, silently — this cost five
 * deploys once. Check everything git would include, before we ship.
 */
function checkArchivable() {
  const shipped = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: repo })
    .toString().split('\n').filter(Boolean);
  const shippedSet = new Set(shipped);

  // A symlink survives the archive only if whatever it points at is also
  // shipped. Locally the target usually exists (node_modules, a build dir),
  // which is why this cannot be checked by simply resolving the link.
  const willShip = (relTarget) =>
    shippedSet.has(relTarget) || shipped.some((f) => f.startsWith(`${relTarget}/`));

  const broken = [];
  for (const rel of shipped) {
    const path = join(repo, rel);
    let target;
    try {
      if (!lstatSync(path).isSymbolicLink()) continue;
      target = realpathSync(path);
    } catch {
      broken.push(`${rel} (dangling)`);
      continue;
    }
    const relTarget = relative(repo, target);
    if (relTarget.startsWith('..') || isAbsolute(relTarget)) broken.push(`${rel} -> outside the repo`);
    else if (!willShip(relTarget)) broken.push(`${rel} -> ${relTarget}, which git does not ship`);
  }

  if (broken.length) {
    console.error('\nThis tree will not deploy. GitHub Pages archives with `tar --dereference`,');
    console.error('which fails on a symlink whose target is not in the checkout:');
    broken.forEach((f) => console.error(`  ${f}`));
    console.error('\nRemove it, and make sure .gitignore covers it, before committing.\n');
    process.exit(1);
  }
}

checkArchivable();
const file = join(repo, 'index.html');
const build = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

let html = readFileSync(file, 'utf8');
html = html
  .replace(/(href="\.\/assets\/css\/styles\.css)(\?v=[^"]*)?"/, `$1?v=${build}"`)
  .replace(/(src="\.\/assets\/js\/app\.js)(\?v=[^"]*)?"/, `$1?v=${build}"`);

html = /<meta name="app-version"/.test(html)
  ? html.replace(/<meta name="app-version" content="[^"]*" \/>/, `<meta name="app-version" content="${build}" />`)
  : html.replace('<title>', `<meta name="app-version" content="${build}" />\n<title>`);

writeFileSync(file, html);
console.log('stamped build', build);
