import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { updateIn } from '../src/index.js';

// Exercise JavaScript callers and invalid inputs without weakening the public overloads.
const invoke = updateIn as (object: unknown, path: unknown, valueOrUpdater: unknown) => unknown;

describe('updateIn', () => {
  it('replaces a leaf and shares every untouched branch', () => {
    const state = { user: { profile: { name: 'Anna' }, tags: ['a'] }, settings: { theme: 'dark' } };
    const next = updateIn(state, ['user', 'profile', 'name'], 'Olga');
    expect(next.user.profile.name).toBe('Olga');
    expect(state.user.profile.name).toBe('Anna');
    expect(next).not.toBe(state);
    expect(next.user).not.toBe(state.user);
    expect(next.user.profile).not.toBe(state.user.profile);
    expect(next.user.tags).toBe(state.user.tags);
    expect(next.settings).toBe(state.settings);
  });

  it('calls an updater synchronously once, with only the current value', () => {
    const updater = vi.fn((current: number) => current + 1);
    expect(updateIn({ count: 1 }, ['count'], updater)).toEqual({ count: 2 });
    expect(updater.mock.calls).toEqual([[1]]);
  });

  it('passes the original leaf and stores the returned object by reference', () => {
    const state = { user: { name: 'Anna', age: 1 } };
    const replacement = { name: 'Olga', age: 2 };
    const next = updateIn(state, ['user'], user => {
      expect(user).toBe(state.user);
      return replacement;
    });
    expect(next.user).toBe(replacement);
    expect(state.user).toEqual({ name: 'Anna', age: 1 });
  });

  it('creates an absent optional branch in full', () => {
    const state: { user?: { name: string; age: number } } = {};
    const updater = vi.fn((current: { name: string; age: number } | undefined) =>
      current ?? { name: 'Olga', age: 0 });
    const next = updateIn(state, ['user'], updater);
    expect(next).toEqual({ user: { name: 'Olga', age: 0 } });
    expect(updater.mock.calls).toEqual([[undefined]]);
    expect(Object.hasOwn(state, 'user')).toBe(false);
  });

  it('creates a whole missing array and new dictionary entries', () => {
    const state: { users?: { name: string }[]; counts: Record<string, number> } = { counts: {} };
    const users = [{ name: 'Olga' }];
    expect(updateIn(state, ['users'], users).users).toBe(users);
    expect(updateIn(state, ['counts', 'new'], count => (count ?? 0) + 1).counts).toEqual({ new: 1 });
    expect(state).toEqual({ counts: {} });
  });

  it('treats null as a leaf value rather than a missing field', () => {
    const state: { value: string | null } = { value: null };
    const updater = vi.fn((current: string | null) => current ?? 'set');
    expect(updateIn(state, ['value'], updater)).toEqual({ value: 'set' });
    expect(updater.mock.calls).toEqual([[null]]);
  });

  it('uses functions as updaters and a wrapper to store a function', () => {
    const oldHandler = () => 'old';
    const handler = vi.fn(() => 'next');
    const state = { handler: oldHandler };
    expect(updateIn(state, ['handler'], () => handler).handler).toBe(handler);
    expect(handler).not.toHaveBeenCalled();
    expect(invoke({ value: 0 }, ['value'], handler)).toEqual({ value: 'next' });
    expect(handler).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('stores a promise without awaiting it', () => {
    const promise = Promise.resolve(2);
    const state = { value: Promise.resolve(1) };
    expect(updateIn(state, ['value'], () => promise).value).toBe(promise);
  });

  it('propagates callback errors without changing the input', () => {
    const state = { nested: { value: 1 } };
    const error = new Error('callback');
    expect(() => updateIn(state, ['nested', 'value'], () => { throw error; })).toThrow(error);
    expect(state).toEqual({ nested: { value: 1 } });
  });

  it('reads a reusable frozen path by index without copying or iterating it', () => {
    const path: ['user', 'name'] = ['user', 'name'];
    Object.defineProperties(path, {
      slice: { get: () => { throw new Error('path slice'); } },
      [Symbol.iterator]: { get: () => { throw new Error('path iterator'); } },
    });
    Object.freeze(path);
    const state = { user: { name: 'Anna' } };
    expect(updateIn(state, path, 'Olga').user.name).toBe('Olga');
    expect(updateIn(state, path, 'Maria').user.name).toBe('Maria');
    expect(path[0]).toBe('user');
    expect(path[1]).toBe('name');
    expect(path.length).toBe(2);
  });

  it('supports string, number and symbol object keys', () => {
    const key = Symbol('value');
    const state = { '0': { name: 'Anna' }, [key]: 1 };
    expect(updateIn(state, [0, 'name'], 'Olga')['0'].name).toBe('Olga');
    expect(updateIn(state, [key], value => value + 1)[key]).toBe(2);
    expect(invoke({ '01': 1 }, ['01'], 2)).toEqual({ '01': 2 });
    expect(Array.isArray(updateIn(state, [key], 2))).toBe(false);
  });

  it.each(['other', 'constructor'])('uses the validated path key when a getter later returns %s', later => {
    let reads = 0;
    const path: ['correct', 'value'] = ['correct', 'value'];
    Object.defineProperty(path, 0, { get: () => reads++ === 0 ? 'correct' : later });
    Object.freeze(path);
    const state = { correct: { value: 1 }, other: { value: 10, keep: true } };
    const next = updateIn(state, path, 2);
    expect(next.correct.value).toBe(2);
    expect(next.other).toBe(state.other);
    expect(Object.hasOwn(next, 'constructor')).toBe(false);
    expect(state.correct.value).toBe(1);
    expect(reads).toBe(1);
  });

  it('accepts a plain root and nested objects from another realm', () => {
    const state = runInNewContext('({ user: { name: "Anna" }, shared: {} })') as {
      user: { name: string }; shared: object;
    };
    const next = updateIn(state, ['user', 'name'], 'Olga');
    expect(next.user.name).toBe('Olga');
    expect(state.user.name).toBe('Anna');
    expect(next.shared).toBe(state.shared);
    expect(Object.getPrototypeOf(next)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(next.user)).toBe(Object.prototype);
    expect(updateIn(state, ['user', 'name'], 'Anna')).toBe(state);
  });

  it('accepts a nested array from another realm', () => {
    const values = runInNewContext('[{ value: 1 }, { value: 2 }]') as { value: number }[];
    const next = updateIn({ values }, ['values', 0, 'value'], 3);
    expect(next.values).toEqual([{ value: 3 }, { value: 2 }]);
    expect(values[0]?.value).toBe(1);
    expect(next.values[1]).toBe(values[1]);
    expect(Object.getPrototypeOf(next.values)).toBe(Array.prototype);
  });

  it.each([
    'new (class Example { value = 1 })()',
    'new (class Example extends Array { constructor() { super(1, 2); } })()',
    'Object.create({ value: 1 })',
    'Object.create({ constructor: Object, value: 1 })',
  ])('rejects nonstandard prototypes from another realm: %s', expression => {
    const branch: unknown = runInNewContext(expression);
    const updater = vi.fn(() => 2);
    expect(() => invoke({ branch }, ['branch', 'value'], updater)).toThrow(TypeError);
    expect(updater).not.toHaveBeenCalled();
  });

  it('does not invoke constructor getters on custom prototypes', () => {
    const getter = vi.fn(() => { throw new Error('constructor getter'); });
    const prototype = Object.defineProperty({}, 'constructor', { get: getter });
    const branch: unknown = Object.create(prototype);
    expect(() => invoke({ branch }, ['branch', 'value'], 2)).toThrow(TypeError);
    expect(getter).not.toHaveBeenCalled();
  });

  it('handles deep finite paths without recursive calls', () => {
    const root: Record<string, unknown> = {};
    const path: string[] = [];
    let current = root;
    for (let index = 0; index < 12000; index++) {
      const child: Record<string, unknown> = {};
      current['child'] = child;
      current = child;
      path.push('child');
    }
    current['value'] = 1;
    path.push('value');
    let next = invoke(root, path, 2) as Record<string, unknown>;
    expect(next === root).toBe(false);
    for (let index = 0; index < 12000; index++) next = next['child'] as Record<string, unknown>;
    expect(next['value']).toBe(2);
    expect(current['value']).toBe(1);
  });
});

describe('updateIn identity and absence', () => {
  it.each([1, 'same', null, undefined, NaN])('returns the root for an Object.is no-op (%s)', value => {
    const state = { nested: { value } };
    const updater = vi.fn(() => value);
    expect(updateIn(state, ['nested', 'value'], updater)).toBe(state);
    expect(updater).toHaveBeenCalledTimes(1);
  });

  it('distinguishes signed zeros', () => {
    const state = { value: -0 };
    const next = updateIn(state, ['value'], 0);
    expect(next).not.toBe(state);
    expect(Object.is(next.value, 0)).toBe(true);
    expect(Object.is(state.value, -0)).toBe(true);
  });

  it('compares object leaves by identity', () => {
    const state = { user: { name: 'Anna' } };
    expect(updateIn(state, ['user'], user => user)).toBe(state);
    expect(updateIn(state, ['user'], { name: 'Anna' })).not.toBe(state);
  });

  it('creates an own undefined field when absent, but preserves an existing one on no-op', () => {
    const state: { value?: number | undefined } = {};
    const next = updateIn(state, ['value'], undefined);
    expect(next).not.toBe(state);
    expect(Object.hasOwn(next, 'value')).toBe(true);
    expect(Object.hasOwn(state, 'value')).toBe(false);
    expect(updateIn(next, ['value'], undefined)).toBe(next);
  });

  it('does not read neighboring getters or copy descriptors on a no-op', () => {
    const state = { nested: { value: 1 }, get neighbor(): number { throw new Error('copied'); } };
    Object.defineProperty(state.nested, 'hidden', { value: 'preserved' });
    expect(updateIn(state, ['nested', 'value'], 1)).toBe(state);
    expect(Object.hasOwn(state.nested, 'hidden')).toBe(true);
  });

  it('ignores inherited leaves and never invokes their getters', () => {
    const key = Symbol('inherited');
    const getter = vi.fn(() => 1);
    Object.defineProperty(Object.prototype, key, { get: getter, configurable: true });
    try {
      const state: { [key]?: number } = {};
      const updater = vi.fn((current: number | undefined) => current ?? 2);
      const next = updateIn(state, [key], updater);
      expect(next[key]).toBe(2);
      expect(Object.hasOwn(next, key)).toBe(true);
      expect(updater.mock.calls).toEqual([[undefined]]);
      expect(getter).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(Object.prototype, key);
    }
  });
});

describe('updateIn arrays', () => {
  it.each([false, true])('preserves every own undefined slot in a dense array (frozen: %s)', frozen => {
    const values = Array.from<number | undefined>({ length: 1000 });
    if (frozen) Object.freeze(values);
    const state = { values };
    const updater = vi.fn((current: number | undefined) => (current ?? 0) + 1);

    const next = updateIn(state, ['values', 500], updater);

    expect(next.values.length).toBe(1000);
    expect(Object.keys(next.values).length).toBe(1000);
    expect(updater.mock.calls).toEqual([[undefined]]);
    for (let index = 0; index < values.length; index++) {
      expect(next.values[index]).toBe(index === 500 ? 1 : undefined);
      expect(Object.hasOwn(next.values, index)).toBe(true);
      expect(values[index]).toBeUndefined();
    }
    expect(updateIn(next, ['values', 0], undefined)).toBe(next);
  });

  it.each(['plain', 'freeze', 'seal', 'preventExtensions'] as const)('preserves mixed values, undefined accessors and holes in %s arrays', mode => {
    const shared = { flag: true };
    const values: unknown[] = [0, false, null, '', NaN, -0, undefined];
    values.length = 11;
    Object.defineProperty(values, 8, { value: undefined, enumerable: false });
    values[9] = shared;
    const setter = vi.fn();
    Object.defineProperty(values, 6, { get: () => undefined, set: setter, enumerable: false });
    Object.defineProperty(values, 'hasOwnProperty', { get: () => { throw new Error('array method'); } });
    if (mode !== 'plain') {
      const protect: (value: object) => object = Object[mode];
      protect(values);
    }

    const next = updateIn({ values }, ['values', 3], 'updated');

    expect(next.values.length).toBe(11);
    expect(Object.keys(next.values)).toEqual(['0', '1', '2', '3', '4', '5', '6', '8', '9']);
    for (const index of [0, 1, 2, 4, 5, 6, 8, 9]) {
      expect(Object.is(next.values[index], values[index])).toBe(true);
    }
    expect(next.values[3]).toBe('updated');
    expect(values[3]).toBe('');
    expect(Object.hasOwn(next.values, 7)).toBe(false);
    expect(Object.hasOwn(next.values, 10)).toBe(false);
    for (const index of [6, 8]) {
      expect(Object.getOwnPropertyDescriptor(next.values, index)).toEqual({
        value: undefined, writable: true, enumerable: true, configurable: true,
      });
    }
    expect(setter).not.toHaveBeenCalled();
  });

  it('preserves an undefined-filled prefix when updating the maximum sparse index', () => {
    const values = Array.from<number | undefined>({ length: 32 });
    Object.defineProperty(values, 7, { value: undefined, enumerable: false });
    values[4294967294] = 1;
    Object.freeze(values);

    const next = updateIn({ values }, ['values', 4294967294], 2);

    expect(next.values.length).toBe(4294967295);
    expect(Object.keys(next.values)).toEqual([...Array.from({ length: 32 }, (_, i) => String(i)), '4294967294']);
    for (let index = 0; index < 32; index++) {
      expect(Object.hasOwn(next.values, index)).toBe(true);
      expect(next.values[index]).toBeUndefined();
    }
    expect(Object.hasOwn(next.values, 32)).toBe(false);
    expect(next.values[4294967294]).toBe(2);
    expect(values[4294967294]).toBe(1);
  });

  it('preserves own undefined and holes in a frozen foreign-realm array', () => {
    const values = runInNewContext('Object.freeze([undefined, Object.freeze({ count: 1 }), , Object.freeze({ count: 2 })])') as readonly ({ count: number } | undefined)[];

    const next = updateIn({ values }, ['values', 1, 'count'], count => count + 1);

    expect(next.values[1]).toEqual({ count: 2 });
    expect(values[1]?.count).toBe(1);
    expect(next.values[3]).toBe(values[3]);
    expect(next.values.length).toBe(4);
    expect(Object.hasOwn(next.values, 0)).toBe(true);
    expect(Object.hasOwn(next.values, 2)).toBe(false);
    expect(Object.isFrozen(next.values)).toBe(false);
  });

  it.each([
    [32, 0], [32, 16], [32, 31],
    [1000, 0], [1000, 500], [1000, 999],
  ])('updates a frozen dense array of length %s at index %s while sharing every neighbor', (length, index) => {
    const items = Object.freeze(Array.from({ length }, (_, id) => Object.freeze({ id, count: id })));
    const state = Object.freeze({ items, shared: { flag: true } });
    const path = Object.freeze(['items', index, 'count'] as const);
    const updater = vi.fn((current: number) => current + 1);

    const next = updateIn(state, path, updater);

    expect(next).not.toBe(state);
    expect(next.items).not.toBe(items);
    expect(next.items.length).toBe(length);
    expect(Object.keys(next.items).length).toBe(length);
    expect(next.items[index]).toEqual({ id: index, count: index + 1 });
    expect(items[index]?.count).toBe(index);
    expect(updater.mock.calls).toEqual([[index]]);
    expect(next.shared).toBe(state.shared);
    expect(Object.isFrozen(next.items)).toBe(false);
    expect(Object.isFrozen(next.items[index])).toBe(false);
    for (let neighbor = 0; neighbor < length; neighbor++) {
      if (neighbor !== index) expect(next.items[neighbor]).toBe(items[neighbor]);
    }
    expect(path).toEqual(['items', index, 'count']);
  });

  it.each(['freeze', 'seal', 'preventExtensions'] as const)('copies dense non-enumerable indices from Object.%s arrays', mode => {
    const values: (number | undefined)[] = [1, undefined, 3];
    Object.defineProperty(values, 1, { value: undefined, enumerable: false });
    const protect: (value: object) => object = Object[mode];
    protect(values);

    const next = updateIn({ values }, ['values', 2], 4);

    expect(next.values).toEqual([1, undefined, 4]);
    expect(Object.keys(next.values)).toEqual(['0', '1', '2']);
    expect(Object.getOwnPropertyDescriptor(next.values, '1')).toEqual({
      value: undefined, writable: true, enumerable: true, configurable: true,
    });
    expect(values[2]).toBe(3);
    expect(Object.getOwnPropertyDescriptor(values, '1')?.enumerable).toBe(false);
  });

  it.each([0, 3, 7])('preserves holes and non-enumerable accessors after a dense prefix ending at %s', hole => {
    const values: (number | undefined)[] = Array.from({ length: 10 }, (_, i) => i);
    delete values[hole];
    delete values[9];
    const setter = vi.fn();
    Object.defineProperty(values, 8, { get: () => undefined, set: setter, enumerable: false });
    Object.freeze(values);
    const updater = vi.fn((current: number | undefined) => (current ?? 0) + 10);

    const next = updateIn({ values }, ['values', 1], updater);

    expect(next.values.length).toBe(10);
    expect(Object.getOwnPropertyNames(next.values)).toEqual(Object.getOwnPropertyNames(values));
    expect(Object.hasOwn(next.values, hole)).toBe(false);
    expect(Object.hasOwn(next.values, 9)).toBe(false);
    for (let i = 0; i < 10; i++) {
      expect(next.values[i]).toBe(i === 1 ? 11 : values[i]);
    }
    expect(Object.getOwnPropertyDescriptor(next.values, '8')).toEqual({
      value: undefined, writable: true, enumerable: true, configurable: true,
    });
    expect(values[1]).toBe(1);
    expect(updater.mock.calls).toEqual([[1]]);
    expect(setter).not.toHaveBeenCalled();
  });

  it('copies a dense prefix and far sparse indices without walking the whole length', () => {
    const values = Array.from({ length: 32 }, (_, i) => i);
    Object.defineProperty(values, 1000, { value: 1000, enumerable: false });
    values[4294967294] = 1;
    Object.freeze(values);

    const next = updateIn({ values }, ['values', 4294967294], 2);

    expect(next.values.length).toBe(4294967295);
    expect(Object.keys(next.values)).toEqual([...Array.from({ length: 32 }, (_, i) => String(i)), '1000', '4294967294']);
    for (let i = 0; i < 32; i++) expect(next.values[i]).toBe(i);
    expect(Object.hasOwn(next.values, 32)).toBe(false);
    expect(next.values[1000]).toBe(1000);
    expect(next.values[4294967294]).toBe(2);
    expect(values[4294967294]).toBe(1);
  });

  it.each([false, true])('skips neighboring array getters on no-op and propagates copy errors (sparse: %s)', sparse => {
    const error = new Error('array neighbor');
    const values = [1, 2, 3];
    if (sparse) delete values[1];
    const getter = vi.fn(() => { throw error; });
    Object.defineProperty(values, 2, { get: getter });
    const state = { values };

    expect(updateIn(state, ['values', 0], current => current ?? 1)).toBe(state);
    expect(getter).not.toHaveBeenCalled();

    const updater = vi.fn(() => 4);
    expect(() => updateIn(state, ['values', 0], updater)).toThrow(error);
    expect(updater).toHaveBeenCalledTimes(1);
    expect(values[0]).toBe(1);
  });

  it('copies arrays along the path and shares unchanged elements', () => {
    const state = { users: [{ name: 'Anna' }, { name: 'Maria' }] };
    const next = updateIn(state, ['users', 0, 'name'], 'Olga');
    expect(next.users).not.toBe(state.users);
    expect(next.users[0]).not.toBe(state.users[0]);
    expect(next.users[1]).toBe(state.users[1]);
    expect(state.users[0]?.name).toBe('Anna');
    expect(next.users[0]?.name).toBe('Olga');
  });

  it('appends and creates sparse elements without filling holes', () => {
    const state = { values: [1] };
    expect(updateIn(state, ['values', 1], 2).values).toEqual([1, 2]);
    const next = updateIn(state, ['values', 3], current => {
      expect(current).toBeUndefined();
      return 4;
    });
    expect(next.values.length).toBe(4);
    expect(Object.keys(next.values)).toEqual(['0', '3']);
    expect(state.values).toEqual([1]);
  });

  it('preserves pre-existing and trailing holes, including a non-enumerable element', () => {
    const values: number[] = new Array<number>(5);
    Object.defineProperty(values, 1, { value: 10, enumerable: false });
    const next = updateIn({ values }, ['values', 3], 20);
    expect(next.values.length).toBe(5);
    expect(next.values[1]).toBe(10);
    expect(Object.keys(next.values)).toEqual(['1', '3']);
    expect(Object.hasOwn(next.values, 0)).toBe(false);
    expect(Object.hasOwn(next.values, 4)).toBe(false);
    expect(Object.hasOwn(values, 3)).toBe(false);
  });

  it('distinguishes a hole from an own undefined element', () => {
    const state = { values: new Array<number | undefined>(1) };
    const next = updateIn(state, ['values', 0], undefined);
    expect(next).not.toBe(state);
    expect(Object.hasOwn(next.values, 0)).toBe(true);
    expect(Object.hasOwn(state.values, 0)).toBe(false);
    expect(updateIn(next, ['values', 0], undefined)).toBe(next);
  });

  it('supports -0 and the maximum valid array index', () => {
    const state = { values: [1] };
    expect(updateIn(state, ['values', -0], 2).values).toEqual([2]);
    const next = updateIn({ values: [] as number[] }, ['values', 4294967294], 1);
    expect(next.values.length).toBe(4294967295);
    expect(next.values[4294967294]).toBe(1);
    expect(Object.keys(next.values)).toEqual(['4294967294']);
    const changed = updateIn(next, ['values', 4294967294], 2);
    expect(changed.values.length).toBe(4294967295);
    expect(changed.values[4294967294]).toBe(2);
    expect(Object.keys(changed.values)).toEqual(['4294967294']);
    expect(next.values[4294967294]).toBe(1);
  });

  it.each([false, true])('copies only canonical array indices without reading named properties (sparse: %s)', sparse => {
    const values = [1, 2];
    if (sparse) values.length = 4;
    const getter = vi.fn(() => { throw new Error('named property'); });
    for (const name of ['01', '-0', '-1', '1.5', '1e0', '4294967295', 'Infinity', 'NaN']) {
      Object.defineProperty(values, name, { get: getter, enumerable: true });
    }
    const next = updateIn({ values }, ['values', 0], 3);
    expect(Object.keys(next.values)).toEqual(['0', '1']);
    expect(next.values.length).toBe(values.length);
    expect(next.values[0]).toBe(3);
    expect(next.values[1]).toBe(2);
    expect(getter).not.toHaveBeenCalled();
  });

  it.each([false, true])('does not call overridden array methods, iterators or species constructors (sparse: %s)', sparse => {
    const values = [1, 2];
    if (sparse) values.length = 4;
    Object.defineProperties(values, {
      slice: { get: () => { throw new Error('slice'); } },
      constructor: { get: () => { throw new Error('species'); } },
      [Symbol.iterator]: { get: () => { throw new Error('iterator'); } },
    });
    const next = updateIn({ values }, ['values', 0], 3);
    expect(Object.keys(next.values)).toEqual(['0', '1']);
    expect(next.values.length).toBe(values.length);
    expect(next.values[0]).toBe(3);
    expect(next.values[1]).toBe(2);
  });

  it('copies array accessors as writable data properties without invoking setters', () => {
    const setter = vi.fn();
    const values: number[] = [1, 2];
    Object.defineProperty(values, 0, { get: () => 1, set: setter });
    const next = updateIn({ values }, ['values', 0], 3);
    expect(next.values).toEqual([3, 2]);
    expect(Object.getOwnPropertyDescriptor(next.values, '0')).toMatchObject({ value: 3, writable: true });
    expect(setter).not.toHaveBeenCalled();
  });
});

describe('updateIn properties and frozen inputs', () => {
  it.each(['freeze', 'seal', 'preventExtensions'] as const)('supports Object.%s inputs', mode => {
    const user: { name: string } = { name: 'Anna' };
    const shared = Object.freeze({ flag: true });
    const state = { user, shared };
    const protect: (value: object) => object = Object[mode];
    protect(user);
    protect(state);
    const next = updateIn(state, ['user', 'name'], 'Olga');
    expect(next.user.name).toBe('Olga');
    expect(state.user.name).toBe('Anna');
    expect(Object.isFrozen(next)).toBe(false);
    expect(Object.isFrozen(next.user)).toBe(false);
    expect(next.shared).toBe(shared);
    expect(Object.isFrozen(next.shared)).toBe(true);
  });

  it('updates frozen arrays without thawing shared elements', () => {
    const values: readonly number[] = Object.freeze([1, 2]);
    const next = updateIn({ values }, ['values', 0], 3);
    expect(next.values).toEqual([3, 2]);
    expect(Object.isFrozen(next.values)).toBe(false);
    expect(values).toEqual([1, 2]);
  });

  it('supports null-prototype dictionaries and creates a regular object copy', () => {
    const state = Object.create(null) as Record<string, number>;
    state['count'] = 1;
    const next = updateIn(state, ['count'], 2);
    expect(next['count']).toBe(2);
    expect(state['count']).toBe(1);
    expect(Object.getPrototypeOf(next)).toBe(Object.prototype);
  });

  it('copies enumerable strings/symbols and drops unrelated non-enumerable properties', () => {
    const symbol = Symbol('data');
    const state = { count: 1, [symbol]: { shared: true } };
    Object.defineProperty(state, 'hidden', { value: 3 });
    const next = updateIn(state, ['count'], 2);
    expect(next[symbol]).toBe(state[symbol]);
    expect(Object.hasOwn(next, 'hidden')).toBe(false);
    expect(Object.hasOwn(state, 'hidden')).toBe(true);
  });

  it('updates non-enumerable leaves as ordinary data properties', () => {
    const state = { value: 1 };
    Object.defineProperty(state, 'value', { value: 1, enumerable: false, writable: false });
    const next = updateIn(state, ['value'], 2);
    expect(Object.getOwnPropertyDescriptor(next, 'value')).toEqual({ value: 2, enumerable: true, writable: true, configurable: true });
    expect(state.value).toBe(1);
  });

  it('reads getters and replaces accessors without invoking the original setter', () => {
    const setter = vi.fn();
    const state = { get value() { return 1; }, set value(next: number) { setter(next); } };
    const next = updateIn(state, ['value'], value => value + 1);
    expect(next.value).toBe(2);
    expect(Object.getOwnPropertyDescriptor(next, 'value')).toEqual({ value: 2, enumerable: true, writable: true, configurable: true });
    expect(setter).not.toHaveBeenCalled();
  });

  it('propagates errors from path getters before the callback', () => {
    const error = new Error('getter');
    const state = { get value(): number { throw error; } };
    const updater = vi.fn(() => 2);
    expect(() => updateIn(state, ['value'], updater)).toThrow(error);
    expect(updater).not.toHaveBeenCalled();
  });

  it('propagates errors from neighboring getters after the callback', () => {
    const error = new Error('copy getter');
    const state = { value: 1, get other(): number { throw error; } };
    const updater = vi.fn(() => 2);
    expect(() => updateIn(state, ['value'], updater)).toThrow(error);
    expect(updater).toHaveBeenCalledTimes(1);
    expect(state.value).toBe(1);
  });

  it('copies an own __proto__ data property without changing the output prototype', () => {
    const state = JSON.parse('{"__proto__":{"polluted":true},"value":1}') as { value: number };
    const next = updateIn(state, ['value'], 2);
    expect(Object.getPrototypeOf(next)).toBe(Object.prototype);
    expect(Object.hasOwn(next, '__proto__')).toBe(true);
    expect('polluted' in next).toBe(false);
  });
});

describe('updateIn invalid paths and containers', () => {
  class Example { value = 1; }
  class ArraySubclass extends Array<number> {}
  const unsupported = [
    new Date(), new Map(), new Set(), new RegExp('x'), new Example(),
    new Uint8Array(1), new Int32Array(1), new BigInt64Array(1),
    new ArrayBuffer(8), new SharedArrayBuffer(8), new DataView(new ArrayBuffer(8)),
    Promise.resolve(1), () => 1, new ArraySubclass(1),
  ];

  it.each([null, undefined, 1, 'x', true, Symbol('x'), [], ...unsupported].map(root => [root]))('rejects unsupported root %# before callback', root => {
    const updater = vi.fn();
    expect(() => invoke(root, ['value'], updater)).toThrow(TypeError);
    expect(updater).not.toHaveBeenCalled();
  });

  it.each([null, undefined, 1, 'x', true, ...unsupported].map(value => [value]))('rejects unsupported intermediate container %# before callback', value => {
    const updater = vi.fn();
    expect(() => invoke({ value }, ['value', 'field'], updater)).toThrow(TypeError);
    expect(updater).not.toHaveBeenCalled();
  });

  it.each(unsupported.map(value => [value]))('allows replacing unsupported container %# as a whole leaf', value => {
    const replacement = {};
    expect(invoke({ value }, ['value'], () => replacement)).toEqual({ value: replacement });
  });

  it.each([[], 'value', null, undefined, {}].map(path => [path]))('rejects invalid path %# before callback', path => {
    const updater = vi.fn();
    expect(() => invoke({ value: 1 }, path, updater)).toThrow(TypeError);
    expect(updater).not.toHaveBeenCalled();
  });

  it.each([null, undefined, true, {}, [], 1n].map(key => [key]))('rejects an invalid path segment %# before callback', key => {
    const updater = vi.fn();
    expect(() => invoke({ nested: {} }, ['nested', key], updater)).toThrow(TypeError);
    expect(updater).not.toHaveBeenCalled();
  });

  it.each([-1, 0.5, NaN, Infinity, -Infinity, 4294967295])('rejects out-of-range numeric key %s before callback', index => {
    const updater = vi.fn();
    expect(() => invoke({ values: [] }, ['values', index], updater)).toThrow(RangeError);
    expect(() => invoke({}, [index], updater)).toThrow(RangeError);
    expect(updater).not.toHaveBeenCalled();
  });

  it.each(['0', 'length', 'extra', Symbol('index')])('rejects a nonnumeric array key %# before callback', key => {
    const updater = vi.fn();
    expect(() => invoke({ values: [1] }, ['values', key], updater)).toThrow(TypeError);
    expect(updater).not.toHaveBeenCalled();
  });

  it.each(['__proto__', 'constructor', 'prototype'])('rejects forbidden key %s at any depth', key => {
    const updater = vi.fn();
    expect(() => invoke({}, [key], updater)).toThrow(TypeError);
    expect(() => invoke({ safe: {} }, ['safe', key], updater)).toThrow(TypeError);
    expect(updater).not.toHaveBeenCalled();
  });

  it('does not create missing intermediate objects or array elements', () => {
    const updater = vi.fn(() => undefined);
    const state = { values: [] };
    expect(() => invoke(state, ['missing', 'name'], updater)).toThrow(TypeError);
    expect(() => invoke(state, ['values', 0, 'name'], updater)).toThrow(TypeError);
    expect(updater).not.toHaveBeenCalled();
    expect(state).toEqual({ values: [] });
  });

  it('does not traverse inherited parents', () => {
    const key = Symbol('parent');
    const getter = vi.fn(() => ({ value: 1 }));
    Object.defineProperty(Object.prototype, key, { get: getter, configurable: true });
    try {
      const updater = vi.fn();
      expect(() => invoke({}, [key, 'value'], updater)).toThrow(TypeError);
      expect(updater).not.toHaveBeenCalled();
      expect(getter).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(Object.prototype, key);
    }
  });
});
