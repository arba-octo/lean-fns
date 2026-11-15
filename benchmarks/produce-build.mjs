import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const toolingRequire = createRequire(require.resolve('tsdown'));
export const hash = content => createHash('sha256').update(content).digest('hex');

export function packageVersion(name, resolver = require) {
  let directory = dirname(resolver.resolve(name));
  while (true) {
    try {
      const metadata = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
      if (metadata.name === name) return metadata.version;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`Cannot find version of ${name}`);
    directory = parent;
  }
}

export async function buildModules(directory, baseline) {
  const { rolldown } = await import(pathToFileURL(toolingRequire.resolve('rolldown')).href);
  const entries = [
    { id: 'lean-fns', source: `export { produce } from ${JSON.stringify(resolve(root, 'src/produce.ts'))};` },
    { id: 'immer-no-freeze', source: `import { Immer } from ${JSON.stringify(fileURLToPath(import.meta.resolve('immer')))}; export const produce = new Immer({ autoFreeze: false }).produce;` },
  ];
  const modules = [];
  for (const entry of entries) {
    const bundle = await rolldown({
      input: 'produce-entry', platform: 'neutral',
      transform: { target: 'es2022', define: { 'process.env.NODE_ENV': JSON.stringify('production') } },
      plugins: [{ name: 'produce-entry',
        resolveId(id) { if (id === 'produce-entry') return '\0produce-entry'; },
        load(id) { if (id === '\0produce-entry') return entry.source; },
      }],
    });
    try {
      const { output } = await bundle.generate({ format: 'esm', minify: true, sourcemap: false });
      if (output.length !== 1 || output[0].type !== 'chunk' || output[0].imports.length || output[0].dynamicImports.length) {
        throw new Error('Expected one standalone runtime module');
      }
      modules.push(saveModule(directory, entry.id, Buffer.from(output[0].code)));
    } finally { await bundle.close(); }
  }
  if (baseline) modules.push({ ...saveModule(directory, 'baseline', readFileSync(baseline)), source: resolve(baseline) });
  return { modules, rolldown: packageVersion('rolldown', toolingRequire),
    settings: 'Standalone runtime ESM / ES2022, production, minify, no sourcemaps or external imports; optional saved baseline is copied as-is' };
}

function saveModule(directory, id, content) {
  const path = join(directory, `${id}.mjs`);
  writeFileSync(path, content, { flag: 'wx' });
  return { id, path, sha256: hash(content), minifiedBytes: content.length,
    gzip9Bytes: gzipSync(content, { level: 9 }).length,
    brotli11Bytes: brotliCompressSync(content, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length };
}
