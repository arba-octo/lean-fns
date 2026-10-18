import assert from 'node:assert/strict';
import { updateIn } from '../dist/index.js';
import { Immer } from 'immer';
import fpUpdate from 'lodash/fp/update.js';
import lodashUpdate from 'lodash/update.js';
import { update as toolkitUpdate } from 'es-toolkit/compat';

const increment = value => value + 1;
const identity = value => value;
const makeProfile = () => ({ name: 'Olga', age: 30 });
const shared = () => ({ settings: { theme: 'dark' } });

function nested(seed) {
  return { a: { b: { c: { d: { e: { count: seed }, sibling: {} } } } }, shared: shared() };
}

function arrayCase(length) {
  const index = Math.floor(length / 2);
  return {
    id: `array-${length}`, path: ['items', index, 'count'], updater: increment,
    create: seed => ({ items: Array.from({ length }, (_, id) => ({ id, count: seed + id })), shared: shared() }),
    recipe: (draft, updater) => { draft.items[index].count = updater(draft.items[index].count); },
  };
}

export const scenarios = [
  {
    id: 'shallow', path: ['count'], updater: increment,
    create: seed => ({ count: seed, shared: shared() }),
    recipe: (draft, updater) => { draft.count = updater(draft.count); },
  },
  {
    id: 'deep-6', path: ['a', 'b', 'c', 'd', 'e', 'count'], updater: increment, create: nested,
    recipe: (draft, updater) => { draft.a.b.c.d.e.count = updater(draft.a.b.c.d.e.count); },
  },
  {
    id: 'wide-100', path: ['record', 'key50'], updater: increment,
    create: seed => ({ record: Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`key${i}`, seed + i])), shared: shared() }),
    recipe: (draft, updater) => { draft.record.key50 = updater(draft.record.key50); },
  },
  arrayCase(32),
  arrayCase(1000),
  {
    id: 'create-branch', path: ['profile'], updater: makeProfile,
    create: seed => ({ id: seed, shared: shared() }),
    recipe: (draft, updater) => { draft.profile = updater(draft.profile); },
  },
  {
    id: 'noop-deep', path: ['a', 'b', 'c', 'd', 'e', 'count'], updater: identity, create: nested, noop: true,
    recipe: (draft, updater) => { draft.a.b.c.d.e.count = updater(draft.a.b.c.d.e.count); },
  },
];

// Benchmark adapter for valid, dense, ordinary fixture data only, not a public utility.
// Copy just the root and intermediate parents; the mutation stays inside those copies.
function copyParents(state, path) {
  const copy = value => Array.isArray(value) ? value.slice() : { ...value };
  const result = copy(state);
  let source = state;
  let target = result;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    source = source[key];
    target = target[key] = copy(source);
  }
  return result;
}

function mutatingAdapter(update) {
  return ({ path, updater }) => state => update(copyParents(state, path), path, updater);
}

function immerAdapter(autoFreeze) {
  const immer = new Immer({ autoFreeze });
  return scenario => {
    // Use an idiomatic direct recipe rather than charging Immer for a generic path walker.
    const recipe = draft => scenario.recipe(draft, scenario.updater);
    return state => immer.produce(state, recipe);
  };
}

export const implementations = [
  { id: 'lean-fns', prepare: ({ path, updater }) => state => updateIn(state, path, updater), noopIdentity: true, freezes: false },
  { id: 'immer-no-freeze', prepare: immerAdapter(false), noopIdentity: true, freezes: false },
  { id: 'immer-auto-freeze', prepare: immerAdapter(true), noopIdentity: true, freezes: true },
  { id: 'lodash-fp', prepare: ({ path, updater }) => state => fpUpdate(path, updater, state), noopIdentity: false, freezes: false },
  { id: 'lodash-copy-update', prepare: mutatingAdapter(lodashUpdate), noopIdentity: false, freezes: false },
  { id: 'es-toolkit-copy-update', prepare: mutatingAdapter(toolkitUpdate), noopIdentity: false, freezes: false },
];

export function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export function readAt(state, path) {
  return path.reduce((value, key) => value[key], state);
}

export function verifyCase(scenario, implementation, seed = 0) {
  const input = deepFreeze(scenario.create(seed));
  const original = structuredClone(input);
  const expected = structuredClone(input);
  let leafParent = expected;
  for (const key of scenario.path.slice(0, -1)) leafParent = leafParent[key];
  const leafKey = scenario.path.at(-1);
  leafParent[leafKey] = scenario.updater(leafParent[leafKey]);

  let calls = 0;
  const operation = implementation.prepare({
    ...scenario,
    updater(current) {
      calls++;
      assert.deepEqual(current, readAt(input, scenario.path));
      return scenario.updater(current);
    },
  });
  const result = operation(input);
  assert.equal(calls, 1, 'updater runs exactly once');
  assert.deepEqual(result, expected, 'equal resulting values');
  assert.deepEqual(input, original, 'unchanged input');
  assert.equal(result === input, Boolean(scenario.noop && implementation.noopIdentity), 'documented no-op identity');

  let before = input;
  let after = result;
  for (const key of scenario.path) {
    for (const neighbor of Object.keys(before)) {
      if (neighbor !== String(key)) assert.equal(after[neighbor], before[neighbor], 'untouched values/references shared');
    }
    if (!scenario.noop || !implementation.noopIdentity) assert.notEqual(after, before, 'changed ancestors copied');
    before = before[key];
    after = after[key];
  }
  if (!scenario.noop) assert.equal(Object.isFrozen(result), implementation.freezes, 'documented output freeze mode');
  return result;
}

export function verifyAll() {
  let checks = 0;
  for (const scenario of scenarios) {
    for (const implementation of implementations) {
      for (const seed of [0, 15]) {
        try { verifyCase(scenario, implementation, seed); }
        catch (cause) { throw new Error(`${scenario.id} / ${implementation.id} / seed ${seed}`, { cause }); }
        checks++;
      }
    }
  }
  return checks;
}
