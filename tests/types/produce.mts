import { produce, type ProduceDraft } from 'lean-fns';

type State = {
  readonly user: { readonly name: string; readonly age: number };
  readonly items: readonly { readonly id: number; readonly done: boolean }[];
  readonly pair: readonly [number, { readonly label: string }];
  optional?: { readonly enabled: boolean };
  readonly status: 'idle' | 'ready';
};
declare const state: State;
const next = produce(state, draft => {
  const name: string = draft.user.name;
  draft.user.name = name.toUpperCase();
  draft.user.age++;
  draft.items.push({ id: 2, done: false });
  draft.items[0]!.done = true;
  draft.pair[0]++;
  draft.pair[1].label = 'new';
  draft.optional ??= { enabled: false };
  draft.optional.enabled = true;
  draft.status = 'ready';
  // @ts-expect-error Field types are preserved in the draft.
  draft.user.age = 'wrong';
  // @ts-expect-error Tuple slots retain their types.
  draft.pair[1] = 123;
  // @ts-expect-error Literal unions remain constrained.
  draft.status = 'other';
  // @ts-expect-error exactOptionalPropertyTypes applies to the draft.
  draft.optional = undefined;
});
const sameType: State = next;
void sameType;
// @ts-expect-error The result retains the input's readonly fields.
next.user.name = 'wrong';
// @ts-expect-error The result retains readonly arrays.
next.items.push({ id: 3, done: false });

const recipe: (draft: ProduceDraft<State>) => void = draft => { draft.user.age++; };
const fromRecipe: State = produce(state, recipe);
const rootDraft: State = produce(state, draft => draft);
const replacement: State = produce(state, () => state);
const noChange: State = produce(state, () => undefined);
void [fromRecipe, rootDraft, replacement, noChange];

const array: readonly number[] = [1, 2];
const arrayResult: readonly number[] = produce(array, draft => { draft.push(3); });
void arrayResult;
const primitiveValues = { nan: NaN, missing: undefined, big: 1n, symbol: Symbol(), nullable: null as null | number };
produce(primitiveValues, draft => { draft.nullable = 1; });
produce({ optional: undefined as undefined | { count: number } }, draft => { draft.optional = { count: 1 }; });

// @ts-expect-error Root values must be supported objects or arrays.
produce(1, () => {});
// @ts-expect-error Date is outside the supported model.
produce(new Date(), () => {});
// @ts-expect-error Nested special values also fall outside the data model.
produce({ date: new Date() }, () => {});
// @ts-expect-error Functions are unsupported state values.
produce({ handler: () => {} }, () => {});
// @ts-expect-error Symbol keys are unsupported.
produce({ [Symbol.iterator]: 1 }, () => {});
// @ts-expect-error Promise-returning callbacks are rejected.
produce(state, async draft => { draft.user.age++; });
// @ts-expect-error Empty object input must not let an async callback through.
produce({}, async () => {});
// @ts-expect-error Promise-like returns are rejected even for an empty schema.
produce({}, () => Promise.resolve({}));
// @ts-expect-error An accidental number return is not a new state.
produce({ items: [1] }, draft => draft.items.push(2));
// @ts-expect-error Replacement must preserve the input schema.
produce(state, () => ({ user: { name: 'Anna' } }));
// @ts-expect-error Null cannot replace an object root.
produce(state, () => null);

declare const possiblyAsync: (draft: ProduceDraft<State>) => void | Promise<void>;
// @ts-expect-error A callback union that can be async is rejected.
produce(state, possiblyAsync);
