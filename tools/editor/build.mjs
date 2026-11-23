import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const out = process.argv[2] || fileURLToPath(new URL('../../src/vendor/editor.js', import.meta.url));
await build({
  entryPoints: [fileURLToPath(new URL('./entry.js', import.meta.url))],
  bundle: true, format: 'esm', minify: true, target: 'es2020', outfile: out,
  legalComments: 'eof',
  banner: { js: '// TipTap 3.32.2 + ProseMirror, MIT licensed. Built by tools/editor/build.mjs.' }
});
console.log('Built', out);
