import { describe, expect, it, vi } from 'vitest';
import { produce } from '../src/index.js';

// JavaScript callers and deliberately invalid recipes also need runtime coverage.
const invoke = produce as (state: unknown, recipe: (draft: any) => unknown) => any;

describe('produce', () => {
  it('combines nested edits while preserving the input and untouched references', () => {
    const state = { user: { name: 'Anna', age: 20 }, cart: [{ quantity: 1 }, { quantity: 2 }], shared: {} };
    const next = produce(state, draft => {
      draft.user.name = 'Olga';
      draft.user.age++;
      draft.cart[0]!.quantity++;
    });
    expect(next).toEqual({ user: { name: 'Olga', age: 21 }, cart: [{ quantity: 2 }, { quantity: 2 }], shared: {} });
    expect(state.user).toEqual({ name: 'Anna', age: 20 });
    expect(state.cart[0]!.quantity).toBe(1);
    expect(next).not.toBe(state);
    expect(next.user).not.toBe(state.user);
    expect(next.cart).not.toBe(state.cart);
    expect(next.cart[0]).not.toBe(state.cart[0]);
    expect(next.cart[1]).toBe(state.cart[1]);
    expect(next.shared).toBe(state.shared);
  });

  it('calls the recipe synchronously once with only the draft', () => {
    const recipe = vi.fn((draft: { count: number }) => { draft.count++; });
    expect(produce({ count: 1 }, recipe)).toEqual({ count: 2 });
    expect(recipe).toHaveBeenCalledTimes(1);
    expect(recipe.mock.calls[0]).toHaveLength(1);
  });

  it('reuses drafts and returns the input for empty, read-only and equal-value recipes', () => {
    const state = { nested: { count: 1 }, nan: NaN, value: undefined };
    expect(produce(state, () => {})).toBe(state);
    expect(produce(state, draft => {
      expect(draft.nested).toBe(draft.nested);
      expect(draft.nested.count).toBe(1);
      draft.nested.count = 1;
      draft.nested = draft.nested;
      draft.nan = NaN;
      draft.value = undefined;
    })).toBe(state);
  });

  it('distinguishes zero signs, real writes followed by reverts and equal new objects', () => {
    const state = { count: 0, nested: { count: 1 } };
    const signed = produce(state, draft => { draft.count = -0; });
    expect(signed).not.toBe(state);
    expect(Object.is(signed.count, -0)).toBe(true);
    const reverted = produce(state, draft => { draft.count = 2; draft.count = 0; });
    expect(reverted).toEqual(state);
    expect(reverted).not.toBe(state);
    expect(produce(state, draft => { draft.nested = { count: 1 }; }).nested).not.toBe(state.nested);
  });

  it('writes undefined over an existing value and creates an absent own property', () => {
    const state: { value?: number | undefined } = { value: 1 };
    const next = produce(state, draft => { draft.value = undefined; });
    expect(Object.hasOwn(next, 'value')).toBe(true);
    expect(next.value).toBeUndefined();
    expect(state.value).toBe(1);
    const empty: typeof state = {};
    expect(Object.hasOwn(produce(empty, draft => { draft.value = undefined; }), 'value')).toBe(true);
  });

  it('finalizes the latest assignment when a field alternates between objects and primitives', () => {
    const state: { value: number | { count: number }; other: { count: number } } = { value: 1, other: { count: 2 } };
    const next = produce(state, draft => {
      draft.value = { count: 3 };
      draft.value = 4;
      draft.value = draft.other;
      draft.other = { count: 5 };
      draft.value.count++;
    });
    expect(next).toEqual({ value: { count: 3 }, other: { count: 5 } });
    expect(state).toEqual({ value: 1, other: { count: 2 } });
    expect(produce(state, draft => { draft.value = draft.other; draft.value = 6; }).value).toBe(6);
  });

  it('deletes own fields, ignores absent deletions and initializes missing branches', () => {
    const state: { user?: { name: string }; count?: number } = { count: 1 };
    expect(produce(state, draft => { delete draft.user; })).toBe(state);
    const next = produce(state, draft => {
      delete draft.count;
      draft.user ??= { name: '' };
      draft.user.name = 'Olga';
    });
    expect(next).toEqual({ user: { name: 'Olga' } });
    expect(state).toEqual({ count: 1 });
  });

  it.each(['freeze', 'seal', 'preventExtensions'] as const)('accepts %s containers and copies them as writable data', operation => {
    const restrict: (value: object) => object = Object[operation];
    const state: { user: { count: number }; shared: { flag: boolean } } = {
      user: { count: 1 }, shared: Object.freeze({ flag: true }),
    };
    restrict(state.user);
    restrict(state);
    const next = produce(state, draft => { draft.user.count++; });
    expect(state.user.count).toBe(1);
    expect(next.user.count).toBe(2);
    expect(Object.isFrozen(next)).toBe(false);
    expect(Object.isFrozen(next.user)).toBe(false);
    expect(next.shared).toBe(state.shared);
    expect(Object.isFrozen(next.shared)).toBe(true);
  });

  it('preserves null prototypes and missing inherited names', () => {
    const state = Object.assign(Object.create(null) as Record<string, unknown>, { child: { count: 1 } });
    const next = invoke(state, draft => {
      expect(draft.toString).toBeUndefined();
      expect('toString' in draft).toBe(false);
      draft.child.count++;
      draft.new = true;
    });
    expect(Object.getPrototypeOf(next)).toBeNull();
    expect(next.child.count).toBe(2);
    expect((state.child as { count: number }).count).toBe(1);
  });

  it('caches children with numeric keys and names inherited from Object.prototype', () => {
    const state = { toString: { count: 1 }, hasOwnProperty: { count: 2 }, 0: { count: 3 } };
    const next = produce(state, draft => {
      expect(draft.toString).toBe(draft.toString);
      expect(draft.hasOwnProperty).toBe(draft.hasOwnProperty);
      draft.toString.count++;
      draft.hasOwnProperty.count++;
      draft[0].count++;
    });
    expect(next).toEqual({ toString: { count: 2 }, hasOwnProperty: { count: 3 }, 0: { count: 4 } });
    expect(state).toEqual({ toString: { count: 1 }, hasOwnProperty: { count: 2 }, 0: { count: 3 } });
  });

  it('supports reflection and spread on frozen drafts', () => {
    const state = Object.freeze({ user: Object.freeze({ count: 1 }), list: Object.freeze([1, 2]) });
    const next = invoke(state, draft => {
      expect(Object.keys(draft)).toEqual(['user', 'list']);
      expect(Object.getPrototypeOf(draft)).toBe(Object.prototype);
      expect(Object.getOwnPropertyDescriptor(draft, 'user')!.value).toBe(draft.user);
      expect(Object.getOwnPropertyDescriptor(draft.list, 'length')).toEqual({
        value: 2, writable: true, enumerable: false, configurable: false,
      });
      expect(Reflect.ownKeys(draft.list)).toEqual(['0', '1', 'length']);
      expect('user' in draft).toBe(true);
      expect('missing' in draft).toBe(false);
      draft.user = { ...draft.user, count: 3 };
      draft.list.push(3);
    });
    expect(next).toEqual({ user: { count: 3 }, list: [1, 2, 3] });
    expect(state.list).toEqual([1, 2]);
  });

  it('supports arrays at the root and common mutating methods', () => {
    const state = [3, 1, 2];
    const next = produce(state, draft => {
      draft.sort((a, b) => a - b);
      draft.reverse();
      expect(draft.pop()).toBe(1);
      draft.push(4);
      expect(draft.shift()).toBe(3);
      draft.unshift(5);
      expect(draft.splice(1, 1, 6)).toEqual([2]);
    });
    expect(next).toEqual([5, 6, 4]);
    expect(state).toEqual([3, 1, 2]);
  });

  it('preserves holes, distinguishes undefined and handles length changes', () => {
    const state = [1, , 3];
    const next = produce(state, draft => {
      draft[1] = undefined;
      delete draft[0];
      draft[5] = 6;
    });
    expect(next.length).toBe(6);
    expect(0 in next).toBe(false);
    expect(1 in next).toBe(true);
    expect(3 in next).toBe(false);
    expect(1 in state).toBe(false);
    expect(produce(next, draft => { draft.length = 2; })).toEqual([, undefined]);
    expect(produce(state, draft => { delete draft[1]; })).toBe(state);
  });

  it('edits elements after reversing and moving them by splice', () => {
    const state = [{ id: 1, count: 1 }, { id: 2, count: 2 }, { id: 3, count: 3 }];
    const next = produce(state, draft => {
      draft.reverse();
      draft[0]!.count = 30;
      const [moved] = draft.splice(1, 1);
      draft.push(moved!);
      draft[2]!.count = 20;
    });
    expect(next).toEqual([{ id: 3, count: 30 }, { id: 1, count: 1 }, { id: 2, count: 20 }]);
    expect(next[1]).toBe(state[0]);
    expect(state.map(item => item.count)).toEqual([1, 2, 3]);
  });

  it('drafts array method callback values and finalizes filter/map/spread wrappers', () => {
    const state = { items: [{ id: 1, count: 1 }, { id: 2, count: 2 }], extra: [] as { item: { id: number; count: number } }[] };
    const next = produce(state, draft => {
      draft.items = draft.items.filter(item => {
        item.count++;
        return item.id === 2;
      });
      draft.extra = draft.items.map(item => ({ item }));
      draft.items = [...draft.items];
      // Move the draft into a wrapper as its only final location.
      draft.items = [];
      draft.extra[0]!.item.count++;
    });
    expect(next).toEqual({ items: [], extra: [{ item: { id: 2, count: 4 } }] });
    expect(state.items.map(item => item.count)).toEqual([1, 2]);
    expect(() => JSON.stringify(next)).not.toThrow();
  });

  it('filters frozen sparse arrays with draft values, native callback arguments and sharing', () => {
    const state = { items: Object.freeze([
      Object.freeze({ id: 0, count: 1 }), , Object.freeze({ id: 2, count: 2 }),
      Object.freeze({ id: 3, count: 3 }),
    ]) };
    const context = { keep: 2 };
    const visited: number[] = [];
    let retained: { id: number; count: number } | undefined;
    const next = produce(state, draft => {
      expect(draft.items.filter).toBe(Array.prototype.filter);
      draft.items = draft.items.filter(function (this: typeof context, item, index, array) {
        visited.push(index);
        expect(this).toBe(context);
        expect(array).toBe(draft.items);
        expect(item).toBe(draft.items[index]);
        if (item!.id === 2) {
          retained = item;
          item!.count++;
        }
        return item!.id >= this.keep;
      }, context);
      draft.items[0]!.count++;
    });
    expect(visited).toEqual([0, 2, 3]);
    expect(next.items).toEqual([{ id: 2, count: 4 }, { id: 3, count: 3 }]);
    expect(next.items[1]).toBe(state.items[3]);
    expect(state.items[2]!.count).toBe(2);
    expect(1 in state.items).toBe(false);
    expect(() => retained!.count).toThrow(TypeError);
  });

  it('observes callback edits to later filter elements while retaining the initial length', () => {
    const state = { items: [{ id: 0, count: 0 }, , { id: 2, count: 2 }, { id: 3, count: 3 }, { id: 4, count: 4 }] };
    const inserted = { id: 1, count: 1 };
    const visited: number[] = [];
    const next = produce(state, draft => {
      draft.items = draft.items.filter((item, index, array) => {
        visited.push(index);
        if (index === 0) {
          item!.count++;
          array[1] = inserted;
          delete array[2];
          array[3]!.count++;
          array.push({ id: 5, count: 5 });
        }
        if (index === 3) array.length = 4;
        return true;
      });
    });
    expect(visited).toEqual([0, 1, 3]);
    expect(next.items).toEqual([{ id: 0, count: 1 }, inserted, { id: 3, count: 4 }]);
    expect(next.items[1]).toBe(inserted);
    expect(state.items).toEqual([{ id: 0, count: 0 }, , { id: 2, count: 2 }, { id: 3, count: 3 }, { id: 4, count: 4 }]);
  });

  it('keeps read-only filtering a no-op and finalizes a returned filtered root', () => {
    const state = [{ count: 1 }, { count: 2 }];
    expect(produce(state, draft => { draft.filter(item => item.count > 1); })).toBe(state);
    const next = produce(state, draft => draft.filter(item => item.count > 1));
    expect(next).toEqual([{ count: 2 }]);
    expect(next[0]).toBe(state[1]);
  });

  it('preserves primitive values, holes and truthiness when filtering', () => {
    const symbol = Symbol('value');
    const state = { items: [NaN, -0, 0, 1n, symbol, null, undefined, false, 'keep', , 2] };
    const next = produce(state, draft => {
      draft.items = draft.items.filter((_value, index) => index < 9 ? 'yes' : 0);
    });
    expect(next.items).toEqual([NaN, -0, 0, 1n, symbol, null, undefined, false, 'keep']);
    expect(Object.is(next.items[1], -0)).toBe(true);
    expect(9 in state.items).toBe(false);
    expect(state.items.length).toBe(11);
  });

  it('retains the value read before a filter callback replaces its current array slot', () => {
    const state = { items: [{ count: 1 }, { count: 2 }] };
    const next = produce(state, draft => {
      draft.items = draft.items.filter((item, index, array) => {
        if (index === 0) {
          array[0] = { count: 10 };
          item.count++;
        }
        return true;
      });
    });
    expect(next.items).toEqual([{ count: 2 }, { count: 2 }]);
    expect(next.items[1]).toBe(state.items[1]);
    expect(state.items[0]!.count).toBe(1);
  });

  it('supports borrowed filter methods, exactly three callback arguments and overridden callback.call', () => {
    const state = { items: [{ count: 1 }, { count: 2 }] };
    const next = produce(state, draft => {
      const filter = draft.items.filter as Function;
      expect(filter.call([1, 2, 3], (value: number) => value > 1)).toEqual([2, 3]);
      expect(filter.call({ 0: 1, 2: 3, length: 3 }, (value: number) => value > 1)).toEqual([3]);
      const callback = function (item: { count: number }, index: number, array: typeof draft.items) {
        expect(arguments.length).toBe(3);
        expect(array).toBe(draft.items);
        expect(item).toBe(array[index]);
        return item.count > 1;
      };
      Object.defineProperty(callback, 'call', { value: () => { throw new Error('must not call callback.call'); } });
      const optimized = filter.call(draft.items, callback);
      const native = Array.prototype.filter.call(draft.items, callback);
      expect(optimized).toEqual(native);
      draft.items = optimized;
      draft.items[0]!.count++;
    });
    expect(next.items).toEqual([{ count: 3 }]);
    expect(state.items[1]!.count).toBe(2);
  });

  it('reads species once after validating the callback and defines custom result fields', () => {
    const original = Object.getOwnPropertyDescriptor(Array, Symbol.species)!;
    let reads = 0;
    let constructedLength: number | undefined;
    let output: any;
    const state = [1, , 3];
    try {
      Object.defineProperty(Array, Symbol.species, { configurable: true, get() {
        reads++;
        return function (length: number) { constructedLength = length; return { marker: true }; };
      } });
      invoke(state, draft => { output = draft.filter((value: number) => value > 1); });
    } finally {
      Object.defineProperty(Array, Symbol.species, original);
    }
    expect(reads).toBe(1);
    expect(constructedLength).toBe(0);
    expect(output).toEqual({ marker: true, 0: 3 });
    expect(Object.getOwnPropertyDescriptor(output, '0')).toEqual({
      value: 3, writable: true, enumerable: true, configurable: true,
    });
    reads = 0;
    let invalid: unknown;
    try {
      Object.defineProperty(Array, Symbol.species, { configurable: true, get() { reads++; return Array; } });
      try { invoke([], draft => draft.filter(null)); } catch (error) { invalid = error; }
    } finally {
      Object.defineProperty(Array, Symbol.species, original);
    }
    expect(invalid).toBeInstanceOf(TypeError);
    expect(reads).toBe(0);
  });

  it('uses the actual receiver when filter is borrowed by an object inheriting a draft', () => {
    produce([1, 2, 3], draft => {
      const receiver = Object.create(draft);
      Object.defineProperties(receiver, { 0: { value: 9 }, length: { value: 1 } });
      const observed: unknown[] = [];
      const result = (draft.filter as Function).call(receiver, (value: number, _index: number, array: unknown) => {
        observed.push(array);
        return value > 0;
      });
      expect(result).toEqual([9]);
      expect(observed).toEqual([receiver]);
      expect(observed[0]).not.toBe(draft);
    });
  });

  it('uses native filter when the inherited array constructor is customized', () => {
    const original = Object.getOwnPropertyDescriptor(Array.prototype, 'constructor')!;
    let reads = 0;
    let output: unknown;
    try {
      Object.defineProperty(Array.prototype, 'constructor', { configurable: true, get() {
        reads++;
        return { [Symbol.species]: Array };
      } });
      invoke([1, 2, 3], draft => { output = draft.filter((value: number) => value > 1); });
    } finally {
      Object.defineProperty(Array.prototype, 'constructor', original);
    }
    expect(reads).toBe(1);
    expect(output).toEqual([2, 3]);
  });

  it('creates own filter results even if a callback installs an inherited index setter', () => {
    const original = Object.getOwnPropertyDescriptor(Array.prototype, '0');
    let writes = 0;
    let next: number[] | undefined;
    try {
      next = produce([1, 2], draft => draft.filter((value, index) => {
        if (index === 0) Object.defineProperty(Array.prototype, '0', {
          configurable: true, set() { writes++; },
        });
        return value > 0;
      }));
    } finally {
      if (original) Object.defineProperty(Array.prototype, '0', original);
      else delete Array.prototype[0];
    }
    expect(writes).toBe(0);
    expect(next).toEqual([1, 2]);
    expect(Object.hasOwn(next!, 0)).toBe(true);
  });

  it('propagates filter callback errors and revokes the visited drafts', () => {
    const state = [{ count: 1 }, { count: 2 }];
    const error = new Error('predicate failed');
    let visited: { count: number } | undefined;
    expect(() => produce(state, draft => {
      draft.filter(item => { visited = item; item.count++; throw error; });
    })).toThrow(error);
    expect(state).toEqual([{ count: 1 }, { count: 2 }]);
    expect(() => visited!.count).toThrow(TypeError);
  });

  it('handles removed and replaced child drafts without restoring stale values', () => {
    const state: { child?: { count: number }; items: { count: number }[] } = { child: { count: 1 }, items: [{ count: 2 }] };
    const next = produce(state, draft => {
      const child = draft.child!;
      delete draft.child;
      child.count = 10;
      draft.child = { count: 3 };
      const item = draft.items[0]!;
      draft.items.length = 0;
      item.count = 20;
      draft.items.length = 1;
    });
    expect(next.child).toEqual({ count: 3 });
    expect(next.items.length).toBe(1);
    expect(0 in next.items).toBe(false);
    expect(state).toEqual({ child: { count: 1 }, items: [{ count: 2 }] });
  });

  it('can reset an edited child to its original raw value', () => {
    const state = { child: { count: 1 } };
    const next = produce(state, draft => {
      draft.child.count++;
      draft.child = state.child;
    });
    expect(next.child).toBe(state.child);
    expect(next.child.count).toBe(1);
  });

  it('finalizes only the current child when an edited branch is reset and drafted again', () => {
    const state = { child: { count: 1 } };
    const next = produce(state, draft => {
      const detached = draft.child;
      detached.count = 2;
      draft.child = state.child;
      draft.child.count = 3;
      detached.count = 4;
    });
    expect(next.child.count).toBe(3);
    expect(state.child.count).toBe(1);
  });

  it('stores external objects by reference, including subsequent raw mutations', () => {
    const external = { count: 10 };
    const state = { child: { count: 1 } };
    const next = produce(state, draft => { draft.child = external; draft.child.count++; });
    expect(next.child).toBe(external);
    expect(external.count).toBe(11);
    expect(state.child.count).toBe(1);
    const later = produce(next, draft => { draft.child.count++; });
    expect(later.child.count).toBe(12);
    expect(external.count).toBe(11);
  });

  it('does not copy an external NaN-containing value without drafts', () => {
    const external = { value: NaN };
    expect(produce({ child: { value: 1 } }, draft => { draft.child = external; }).child).toBe(external);
  });

  it('copies external wrappers containing drafts without mutating those wrappers', () => {
    const state = { child: { count: 1 }, wrapper: null as null | { nested: { count: number } } };
    let wrapper: { nested: { count: number } };
    const next = produce(state, draft => {
      draft.child.count++;
      wrapper = Object.freeze({ nested: draft.child });
      draft.wrapper = wrapper;
      draft.child = { count: 3 };
    });
    expect(next.wrapper === wrapper!).toBe(false);
    expect(next.wrapper!.nested.count).toBe(2);
    expect(() => wrapper!.nested.count).toThrow(TypeError);
    expect(state.child.count).toBe(1);
  });

  it('returns finalized drafts or a complete replacement', () => {
    const state = { child: { count: 1 } };
    expect(produce(state, draft => { draft.child.count++; return draft; })).toEqual({ child: { count: 2 } });
    expect(produce(state, () => undefined)).toBe(state);
    const replacement = { child: { count: 3 } };
    expect(produce(state, () => replacement)).toBe(replacement);
    const wrapped = produce(state, draft => ({ child: draft.child }));
    expect(wrapped).toEqual(state);
    expect(wrapped.child).toBe(state.child);
  });

  it('rejects conflicting mutation and replacement or invalid return values', () => {
    expect(() => invoke({ count: 1 }, draft => { draft.count++; return { count: 3 }; })).toThrow(/replacement/);
    expect(() => invoke([], draft => draft.push(1))).toThrow(TypeError);
    expect(() => invoke({}, () => null)).toThrow(TypeError);
  });

  it.each([false, true])('revokes root and nested drafts after completion (throw=%s)', fail => {
    const state = { child: { count: 1 } };
    let root: typeof state;
    let child: typeof state.child;
    const error = new Error('recipe failed');
    const run = () => produce(state, draft => {
      root = draft;
      child = draft.child;
      draft.child.count++;
      if (fail) throw error;
    });
    if (fail) expect(run).toThrow(error);
    else run();
    expect(() => root!.child).toThrow(TypeError);
    expect(() => child!.count).toThrow(TypeError);
    expect(state.child.count).toBe(1);
  });

  it('rejects async recipes and observes their continuation failures', async () => {
    const state = { count: 1 };
    expect(() => invoke(state, async draft => {
      await Promise.resolve();
      draft.count++;
    })).toThrow(/synchronous/);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(state.count).toBe(1);
  });

  it('rejects nested and foreign drafts', () => {
    produce({ child: { count: 1 } }, outer => {
      expect(() => invoke(outer.child, () => {})).toThrow(/Nested/);
      produce({ child: { count: 2 } }, inner => {
        expect(() => { inner.child = outer.child; }).toThrow(/Foreign/);
      });
    });
  });

  it.each([null, 1, 'text', () => {}, new Date(), new Map(), new Set(), new Uint8Array(2), new (class Value { count = 1; })()])(
    'rejects unsupported roots (%s)', state => {
      const recipe = vi.fn();
      expect(() => invoke(state, recipe)).toThrow(TypeError);
      expect(recipe).not.toHaveBeenCalled();
    },
  );

  it('rejects unsupported encountered values and invalid recipe arguments', () => {
    for (const value of [new Date(), new Map(), () => {}]) {
      expect(() => invoke({ value }, draft => { void draft.value; })).toThrow(TypeError);
      expect(() => invoke({ value: null }, draft => { draft.value = value; })).toThrow(TypeError);
    }
    expect(() => (produce as Function)({}, 1)).toThrow(/recipe/);
  });

  it('reads properties directly, allowing getters to run on the source', () => {
    const getter = vi.fn(function (this: { count: number }) { return this.count + 1; });
    const state = Object.defineProperty({ count: 1 }, 'value', { get: getter, enumerable: true });
    const next = invoke(state, draft => { expect(draft.value).toBe(2); });
    expect(next).toBe(state);
    expect(getter).toHaveBeenCalledOnce();
    expect(getter.mock.contexts[0]).toBe(state);
  });

  it('reads getter-backed values before writing a shallow copy', () => {
    const getter = vi.fn(() => 1);
    const state = Object.defineProperty({}, 'value', { get: getter, enumerable: true });
    const next = invoke(state, draft => { draft.value = 2; });
    expect(getter).toHaveBeenCalled();
    expect(next.value).toBe(2);
    expect(Object.getOwnPropertyDescriptor(state, 'value')!.get).toBe(getter);
    expect(Object.getOwnPropertyDescriptor(next, 'value')!.value).toBe(2);
  });

  it('keeps native filter when directly reading a frozen array getter', () => {
    const getter = vi.fn(() => 4);
    const state = [1, 2, 3];
    Object.defineProperty(state, '1', { get: getter, enumerable: true, configurable: true });
    Object.freeze(state);
    const next = produce(state, draft => {
      expect(draft.filter).toBe(Array.prototype.filter);
      return draft.filter(value => value % 2 === 0);
    });
    expect(next).toEqual([4]);
    expect(getter).toHaveBeenCalledOnce();
    expect(Object.getOwnPropertyDescriptor(state, '1')!.get).toBe(getter);
  });

  it('reads assigned values directly during finalization', () => {
    const getter = vi.fn(() => 2);
    const external = Object.defineProperty({}, 'value', { get: getter, enumerable: true });
    const state = { child: { value: 1 } };
    const next = invoke(state, draft => { draft.child = external; });
    expect(next.child).toBe(external);
    expect(state.child.value).toBe(1);
    expect(getter).toHaveBeenCalledOnce();
  });

  it('propagates getter errors and revokes the draft', () => {
    const error = new Error('getter failed');
    const getter = vi.fn(() => { throw error; });
    const state = Object.defineProperty({}, 'value', { get: getter, enumerable: true });
    let visited: { value: unknown } | undefined;
    expect(() => invoke(state, draft => { visited = draft; void draft.value; })).toThrow(error);
    expect(() => visited!.value).toThrow(TypeError);
    expect(getter).toHaveBeenCalledOnce();
  });

  it.each(['__proto__', 'constructor', 'prototype'])('rejects dangerous writes to %s', key => {
    expect(() => invoke({}, draft => { draft[key] = {}; })).toThrow(TypeError);
    expect(() => invoke({}, draft => { delete draft[key]; })).toThrow(TypeError);
  });

  it('rejects descriptor, prototype, freezing and symbol-key operations', () => {
    const operations = [
      (draft: object) => Object.defineProperty(draft, 'value', { value: 1 }),
      (draft: object) => Object.setPrototypeOf(draft, null),
      (draft: object) => Object.freeze(draft),
      (draft: any) => { draft[Symbol('key')] = 1; },
    ];
    for (const operation of operations) expect(() => invoke({}, operation)).toThrow(TypeError);
  });

  it.each(['-1', '1.5', '01', '4294967295', 'field'])('rejects non-index array property %s', key => {
    expect(() => invoke([], draft => { draft[key] = 1; })).toThrow(/indices/);
  });

  it('preserves native array length errors and rejects deletion of length', () => {
    expect(() => invoke([], draft => { draft.length = -1; })).toThrow(RangeError);
    expect(() => invoke([], draft => { delete draft.length; })).toThrow(TypeError);
  });

  it('rejects cycles introduced through drafts or assigned wrappers', () => {
    expect(() => invoke({ child: null }, draft => { draft.child = draft; })).toThrow(/Cyclic/);
    const cycle: any = {};
    cycle.self = cycle;
    expect(() => invoke({ child: null }, draft => { draft.child = cycle; })).toThrow(/Cyclic/);
  });
});
