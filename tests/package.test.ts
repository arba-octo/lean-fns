import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const cwd = fileURLToPath(new URL('../', import.meta.url));

describe('built package entry points', () => {
  it.each([
    ['ESM', '--input-type=module', "import * as library from 'lean-fns';"],
    ['CommonJS', '--input-type=commonjs', "const library = require('lean-fns');"],
  ])('executes the %s export in a native Node process', (_format, inputType, importSource) => {
    const source = `${importSource}
      const state = { user: { name: 'Anna' }, shared: {} };
      const next = library.updateIn(state, ['user', 'name'], name => name.toUpperCase());
      console.log(JSON.stringify({
        exports: Object.keys(library),
        before: state.user.name,
        after: next.user.name,
        changed: next !== state && next.user !== state.user,
        shared: next.shared === state.shared,
        noop: library.updateIn(next, ['user', 'name'], 'ANNA') === next,
      }));`;
    const output = execFileSync(process.execPath, [inputType, '--eval', source], {
      cwd,
      encoding: 'utf8',
    });

    expect(JSON.parse(output)).toEqual({
      exports: ['updateIn'], before: 'Anna', after: 'ANNA', changed: true, shared: true, noop: true,
    });
  });
});
