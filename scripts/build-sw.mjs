import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
async function files(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const item = path.join(directory, entry.name);
      return entry.isDirectory() ? files(item) : item;
    }),
  );
  return nested.flat();
}
const emitted = (await files('dist')).filter((file) => !file.endsWith(path.sep + 'sw.js')).sort();
const source = await fs.readFile('public/sw.js', 'utf8');
const digest = createHash('sha256');
digest.update(source);
for (const file of emitted) {
  digest.update(file.replaceAll(path.sep, '/'));
  digest.update(await fs.readFile(file));
}
const version = digest.digest('hex').slice(0, 16);
const html = await fs.readFile('dist/index.html', 'utf8');
await fs.writeFile(
  'dist/index.html',
  html.replace('</head>', '<meta name="offline-build" content="' + version + '"></head>'),
);
const precache = [
  '/',
  ...emitted
    .filter((file) => !file.endsWith('index.html'))
    .map((file) => '/' + path.relative('dist', file).replaceAll(path.sep, '/')),
];
const worker = source
  .replaceAll('__BUILD_VERSION__', version)
  .replace(
    /const PRECACHE = \[\];?\s*\/\*__PRECACHE__\*\/;?/,
    'const PRECACHE = ' + JSON.stringify(precache) + ';',
  );
if (worker.includes('__PRECACHE__')) throw new Error('Precache placeholder was not replaced');
await fs.writeFile('dist/sw.js', worker);
console.log('Offline shell: ' + precache.length + ' resources, build ' + version);
