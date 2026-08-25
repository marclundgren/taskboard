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
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
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
