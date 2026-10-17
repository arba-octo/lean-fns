import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const cwd = fileURLToPath(new URL('../', import.meta.url));

describe('built package entry points', () => {
  it.each([
    ['ESM', '--input-type=module', "import * as library from 'lean-fns'; console.log(JSON.stringify(Object.keys(library)));"],
    ['CommonJS', '--input-type=commonjs', "const library = require('lean-fns'); console.log(JSON.stringify(Object.keys(library)));"],
  ])('loads the %s export in a native Node process', (_format, inputType, source) => {
    const output = execFileSync(process.execPath, [inputType, '--eval', source], {
      cwd,
      encoding: 'utf8',
    });

    expect(JSON.parse(output)).toBeInstanceOf(Array);
  });
});
