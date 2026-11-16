import assert from 'node:assert/strict';

function freezeTree(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value;
}

const common = seed => ({ tree: { a: { b: { c: { value: seed } } } }, shared: { seed } });
const objects = seed => ({ items: Array.from({ length: 1000 }, (_, id) => ({ id, value: seed + id })), shared: { seed } });
const externalBranch = { value: 42, label: 'loaded' };

export const scenarios = [
  { id: 'noop-empty', description: 'Empty recipe', create: common, noop: true,
    recipe() {}, handwritten: state => state },
  { id: 'read-deep', description: 'Read a four-segment path', create: common, noop: true,
    recipe(draft) { if (draft.tree.a.b.c.value < 0) throw new Error('invalid fixture'); } },
  { id: 'same-value', description: 'Write the existing value at a four-segment path', create: common, noop: true,
    recipe(draft) { draft.tree.a.b.c.value = draft.tree.a.b.c.value; } },
  { id: 'deep-write', description: 'Increment a four-segment path', create: common,
    recipe(draft) { draft.tree.a.b.c.value++; },
    handwritten: state => ({ ...state, tree: { a: { b: { c: { value: state.tree.a.b.c.value + 1 } } } } }) },
  { id: 'many-writes', description: 'Increment two fields in each of 100 objects',
    create: seed => ({ items: Array.from({ length: 100 }, (_, id) => ({ id, value: seed + id, count: 0 })), shared: { seed } }),
    recipe(draft) { for (const item of draft.items) { item.value++; item.count++; } } },
  { id: 'wide-100', description: 'Update one of 100 sibling properties',
    create: seed => ({ fields: Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`p${i}`, seed + i])), shared: { seed } }),
    recipe(draft) { draft.fields.p50++; } },
  { id: 'numbers-1000', description: 'Update one number in a 1000-element array',
    create: seed => ({ items: Array.from({ length: 1000 }, (_, i) => seed + i), shared: { seed } }),
    recipe(draft) { draft.items[500]++; },
    handwritten: state => { const items = state.items.slice(); items[500]++; return { ...state, items }; } },
  { id: 'objects-1000', description: 'Update one object in a 1000-element array', create: objects,
    recipe(draft) { draft.items[500].value++; },
    check(next, state) { assert.equal(next.items[0], state.items[0]); assert.notEqual(next.items[500], state.items[500]); } },
  { id: 'filter-1000', description: 'Filter 1000 objects, then edit a retained object', create: objects,
    recipe(draft) { draft.items = draft.items.filter(item => item.id % 2 === 0); draft.items[0].value++; },
    check(next, state) { assert.equal(next.items[1], state.items[2]); assert.notEqual(next.items[0], state.items[0]); } },
  { id: 'filter-read-only', description: 'Filter 1000 objects without changing state', create: objects, noop: true,
    recipe(draft) { if (draft.items.filter(item => item.id % 2 === 0).length !== 500) throw new Error('invalid fixture'); } },
  { id: 'filter-numbers', description: 'Filter 1000 numbers, then edit the first retained value',
    create: seed => ({ items: Array.from({ length: 1000 }, (_, i) => seed + i), shared: { seed } }),
    recipe(draft) { draft.items = draft.items.filter(item => item % 2 === 0); draft.items[0]++; } },
  { id: 'filter-numbers-read-only', description: 'Filter 1000 numbers without changing state', noop: true,
    create: seed => ({ items: Array.from({ length: 1000 }, (_, i) => seed + i), shared: { seed } }),
    recipe(draft) { if (draft.items.filter(item => item % 2 === 0).length !== 500) throw new Error('invalid fixture'); } },
  { id: 'filter-sparse-edit', description: 'Filter a sparse 1000-slot array and edit retained objects in the callback',
    create: seed => {
      const state = objects(seed);
      for (let i = 1; i < state.items.length; i += 2) delete state.items[i];
      return state;
    },
    recipe(draft) {
      draft.items = draft.items.filter(item => {
        if (item.id % 4 !== 0) return false;
        item.value++;
        return true;
      });
    },
    check(next, state) { assert.equal(next.items.length, 250); assert.notEqual(next.items[0], state.items[0]); } },
  { id: 'spread-branch', description: 'Replace a branch using spread and a nested draft',
    create: seed => ({ branch: { value: seed, nested: { value: seed } }, shared: { seed } }),
    recipe(draft) { draft.branch = { ...draft.branch, value: draft.branch.value + 1 }; },
    check(next, state) { assert.equal(next.branch.nested, state.branch.nested); } },
  { id: 'assign-branch', description: 'Assign a complete external object by reference',
    create: seed => ({ branch: { value: seed, label: 'initial' }, shared: { seed } }),
    recipe(draft) { draft.branch = externalBranch; },
    handwritten: state => ({ ...state, branch: externalBranch }),
    check(next) { assert.equal(next.branch, externalBranch); } },
  { id: 'reverse-edit', description: 'Reverse 100 objects, then edit the new first item',
    create: seed => ({ items: Array.from({ length: 100 }, (_, id) => ({ id, value: seed + id })), shared: { seed } }),
    recipe(draft) { draft.items.reverse(); draft.items[0].value++; },
    check(next, state) { assert.equal(next.items[99], state.items[0]); assert.notEqual(next.items[0], state.items[99]); } },
  { id: 'frozen-deep', description: 'Update a four-segment path in a deeply frozen input',
    create: seed => freezeTree(common(seed)), recipe(draft) { draft.tree.a.b.c.value++; } },
];

export function execute(implementation, scenario, input, recipe = scenario.recipe) {
  return implementation.id === 'handwritten' ? scenario.handwritten(input) : implementation.produce(input, recipe);
}

export function verifyCase(implementation, scenario, seed = 17) {
  const input = scenario.create(seed);
  const snapshot = structuredClone(input);
  const expected = structuredClone(input);
  scenario.recipe(expected);
  let calls = 0;
  const next = execute(implementation, scenario, input, draft => { calls++; scenario.recipe(draft); });
  if (implementation.id !== 'handwritten') assert.equal(calls, 1);
  assert.deepEqual(input, snapshot, 'input was mutated');
  assert.deepEqual(next, expected, 'wrong output values');
  assert.equal(next.shared, input.shared, 'untouched branch lost identity');
  assert.equal(next === input, Boolean(scenario.noop), 'wrong root identity');
  scenario.check?.(next, input);
}

export function verifyAll(implementations, cases = scenarios) {
  let count = 0;
  for (const implementation of implementations) {
    for (const scenario of cases) {
      if (implementation.id === 'handwritten' && !scenario.handwritten) continue;
      for (const seed of [17, 31]) { verifyCase(implementation, scenario, seed); count++; }
    }
  }
  return count;
}
