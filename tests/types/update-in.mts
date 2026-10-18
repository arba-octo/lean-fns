// Compile only: this fixture includes intentionally invalid calls.
import { updateIn } from 'lean-fns';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false;
type IsAny<T> = 0 extends 1 & T ? true : false;
declare function expect<T extends true>(): void;

type User = { name: string; age: number };
type State = {
  readonly id: string;
  user?: User;
  users: User[];
  readonly archived: readonly User[];
  profile: { nickname?: string; resettable?: string | undefined };
  byId: Record<string, User>;
  counts: Record<string, number>;
  pair: readonly [string, number?];
  maybe: User | null;
  onClick?: (event: string) => void;
};
declare const state: State;

// Literal paths infer each position without as const.
const renamed = updateIn(state, ['user', 'name'], name => {
  expect<Equal<typeof name, string>>();
  expect<Equal<IsAny<typeof name>, false>>();
  return name.toUpperCase();
});
expect<Equal<typeof renamed, State>>();
expect<Equal<IsAny<typeof renamed>, false>>();

const namePath = ['user', 'name'] as const;
const reused = updateIn(state, namePath, 'Olga');
expect<Equal<typeof reused, State>>();
declare const mutablePath: ['user', 'age'];
updateIn(state, mutablePath, age => age + 1);

// A missing final branch is initialized with every required field.
const initialized = updateIn(state, ['user'], user => {
  expect<Equal<typeof user, User | undefined>>();
  return user ? { ...user, name: 'Olga' } : { name: 'Olga', age: 0 };
});
expect<Equal<typeof initialized, State>>();
expect<Equal<typeof initialized.user, User | undefined>>();
updateIn(state, ['user'], { name: 'Olga', age: 0 });

updateIn(state, ['profile', 'nickname'], nickname => {
  expect<Equal<typeof nickname, string | undefined>>();
  return nickname?.trim() || 'Guest';
});
updateIn(state, ['profile', 'resettable'], undefined);
updateIn(state, ['profile', 'resettable'], () => undefined);

// Missing intermediate parents throw before calling an updater at runtime.
updateIn(state, ['maybe', 'name'], name => {
  expect<Equal<typeof name, string>>();
  return name;
});
updateIn(state, ['maybe'], user => {
  expect<Equal<typeof user, User | null>>();
  return user ?? { name: 'Olga', age: 0 };
});

declare const index: number;
const inserted = updateIn(state, ['users', index], user => {
  expect<Equal<typeof user, User | undefined>>();
  return user ?? { name: 'Olga', age: 0 };
});
expect<Equal<typeof inserted, State>>();
expect<Equal<typeof inserted.users, User[]>>();
updateIn(state, ['users', 10], { name: 'Olga', age: 0 });
updateIn(state, ['users', 0, 'name'], name => {
  expect<Equal<typeof name, string>>();
  return name;
});
const archived = updateIn(state, ['archived', 0], { name: 'Olga', age: 0 });
expect<Equal<typeof archived.archived, readonly User[]>>();

declare const key: string;
updateIn(state, ['byId', key], user => {
  expect<Equal<typeof user, User | undefined>>();
  return user ?? { name: 'Olga', age: 0 };
});
updateIn(state, ['counts', key], count => {
  expect<Equal<typeof count, number | undefined>>();
  return (count ?? 0) + 1;
});
updateIn(state, ['byId', key, 'name'], name => {
  expect<Equal<typeof name, string>>();
  return name;
});

const tuple = updateIn(state, ['pair', 1], current => {
  expect<Equal<typeof current, number | undefined>>();
  return current ?? 0;
});
expect<Equal<typeof tuple.pair, readonly [string, number?]>>();
updateIn(state, ['pair', 0], current => {
  expect<Equal<typeof current, string>>();
  return current;
});

const handler = (_event: string): void => {};
updateIn(state, ['onClick'], () => handler);
updateIn(state, ['onClick'], current => {
  expect<Equal<typeof current, ((event: string) => void) | undefined>>();
  return current ?? handler;
});

declare const symbolKey: unique symbol;
declare const symbolic: { [symbolKey]?: User };
updateIn(symbolic, [symbolKey], { name: 'Olga', age: 0 });
declare const numbered: { '0': User; 1: User };
updateIn(numbered, [0, 'name'], 'Olga');
updateIn(numbered, ['1', 'age'], 0);

// Readonly state remains readonly, while immutable replacements are allowed.
const readonlyResult = updateIn(state, ['id'], 'next');
expect<Equal<typeof readonlyResult, State>>();
// @ts-expect-error The return type must retain readonly id.
readonlyResult.id = 'mutation';
// @ts-expect-error The return type must retain readonly arrays.
archived.archived.push({ name: 'Olga', age: 0 });
// @ts-expect-error Creating user must not remove optional from the original schema.
initialized.user.name.toUpperCase();

// Negative tests also guard against inference and overload escape hatches.
// @ts-expect-error Unknown field.
updateIn(state, ['user', 'naem'], 'Olga');
// @ts-expect-error A closed empty model has no user field.
updateIn({}, ['user'], { name: 'Olga', age: 0 });
// @ts-expect-error A value cannot widen the declared field type.
updateIn(state, ['user', 'name'], 123);
// @ts-expect-error Callback results cannot widen the declared field type.
updateIn(state, ['user', 'name'], name => name.length);
// @ts-expect-error Callback annotations cannot widen the input model.
updateIn(state, ['user', 'name'], (name: number) => String(name));
// @ts-expect-error The current value must not silently become any.
updateIn(state, ['user', 'name'], name => name.toFixed());
// @ts-expect-error A complete User is required.
updateIn(state, ['user'], { name: 'Olga' });
// @ts-expect-error A callback must also return a complete User.
updateIn(state, ['user'], () => ({ name: 'Olga' }));
// @ts-expect-error Optional presence does not allow explicit undefined writes.
updateIn(state, ['profile', 'nickname'], undefined);
// @ts-expect-error The updater follows the same optional write restriction.
updateIn(state, ['profile', 'nickname'], () => undefined);
// @ts-expect-error Reading undefined does not allow writing it to user?: User.
updateIn(state, ['user'], user => user);
// @ts-expect-error Array elements must be complete.
updateIn(state, ['users', 0], { name: 'Olga' });
// @ts-expect-error Index signatures constrain new values too.
updateIn(state, ['byId', key], { name: 'Olga' });
// @ts-expect-error Array paths require numeric indices.
updateIn(state, ['users', '0'], { name: 'Olga', age: 0 });
// @ts-expect-error Array length is not an element path.
updateIn(state, ['users', 'length'], 0);
// @ts-expect-error A tuple cannot grow past its declared positions.
updateIn(state, ['pair', 2], 0);
// @ts-expect-error A tuple position retains its own type.
updateIn(state, ['pair', 0], 0);
// @ts-expect-error Optional tuple slots also have a distinct write type.
updateIn(state, ['pair', 1], undefined);
// @ts-expect-error A dynamic index cannot safely choose a heterogeneous tuple slot.
updateIn(state, ['pair', index], 0);
// @ts-expect-error Literal negative indices are invalid.
updateIn(state, ['users', -1], { name: 'Olga', age: 0 });
// @ts-expect-error Literal fractional indices are invalid.
updateIn(state, ['users', 0.5], { name: 'Olga', age: 0 });
// @ts-expect-error Function arguments are updaters, not direct function values.
updateIn(state, ['onClick'], handler);
// @ts-expect-error An updater must return a replacement, not void.
updateIn(state, ['user', 'name'], () => {});
// @ts-expect-error Async results cannot be stored in a string field.
updateIn(state, ['user', 'name'], async () => 'Olga');
// @ts-expect-error Empty paths do not replace the root.
updateIn(state, [], state);
// @ts-expect-error String paths are not supported.
updateIn(state, 'user.name', 'Olga');
declare const dynamicPath: string[];
// @ts-expect-error Widened arrays do not describe a tuple path.
updateIn(state, dynamicPath, 'Olga');
// @ts-expect-error Root arrays are outside the API.
updateIn([1, 2], [0], 3);
// @ts-expect-error Root primitives are outside the API.
updateIn('name', ['length'], 4);
// @ts-expect-error Root null is outside the API.
updateIn(null, ['name'], 'Olga');
// @ts-expect-error Forbidden keys remain forbidden even on dictionaries.
updateIn(state, ['counts', '__proto__'], 0);

declare const special: { date: Date; map: Map<string, number>; promise: Promise<string> };
updateIn(special, ['date'], new Date());
updateIn(special, ['promise'], async () => 'value');
// @ts-expect-error Opaque objects can only be replaced as whole values.
updateIn(special, ['date', 'getTime'], () => () => 0);
// @ts-expect-error Collection internals are not plain object paths.
updateIn(special, ['map', 'size'], 0);

type Choice = { kind: 'text'; value: string } | { kind: 'count'; value: number };
declare const choice: Choice;
// @ts-expect-error Updating a discriminator alone could invalidate the union.
updateIn(choice, ['kind'], 'text');
if (choice.kind === 'text') {
  updateIn(choice, ['value'], 'next');
}
declare const wrapped: { choice: Choice };
updateIn(wrapped, ['choice'], { kind: 'text', value: 'next' });
// @ts-expect-error Nested correlated unions cannot be edited one field at a time.
updateIn(wrapped, ['choice', 'kind'], 'text');
declare const unionPath: readonly ['user', 'name'] | readonly ['user', 'age'];
// @ts-expect-error Ambiguous paths require narrowing before a call.
updateIn(state, unionPath, 'next');
declare const unionKey: 'name' | 'age';
// @ts-expect-error Ambiguous keys require narrowing before a call.
updateIn(state, ['user', unionKey], 'next');

declare const unknownField: { value: unknown };
updateIn(unknownField, ['value'], current => {
  expect<Equal<typeof current, unknown>>();
  return current;
});
// @ts-expect-error A narrow callback must not escape through the value overload.
updateIn(unknownField, ['value'], (current: number) => current + 1);

declare const literal: { readonly name: 'Anna' };
// @ts-expect-error Readonly literal values retain their declared literal type.
updateIn(literal, ['name'], 'Olga');

declare const variadic: { prefix: [string, ...number[]]; suffix: [...number[], string] };
// @ts-expect-error Variadic tuples must not be widened to unsound element unions.
updateIn(variadic, ['prefix', 0], 1);
// @ts-expect-error Fixed suffixes of variadic tuples must also be protected.
updateIn(variadic, ['suffix', 0], 1);

// Full array creation and readonly callbacks retain the declared model.
declare const optionalArray: { readonly users?: readonly User[] };
const createdArray = updateIn(optionalArray, ['users'], users => {
  expect<Equal<typeof users, readonly User[] | undefined>>();
  return [...(users ?? []), { name: 'Olga', age: 0 }];
});
expect<Equal<typeof createdArray, typeof optionalArray>>();
// @ts-expect-error A new array still needs complete elements.
updateIn(optionalArray, ['users'], [{ name: 'Olga' }]);
declare const immutable: { readonly user: Readonly<User> };
updateIn(immutable, ['user'], user => {
  expect<Equal<typeof user, Readonly<User>>>();
  // @ts-expect-error An updater receives the value, not a writable draft.
  user.name = 'mutation';
  return { ...user, name: 'Olga' };
});

// Finite paths through a recursive model do not enumerate every possible path.
interface Tree {
  label: string;
  child?: Tree;
}
declare const tree: Tree;
const recursive = updateIn(tree, ['child', 'child', 'label'], label => label.trim());
expect<Equal<typeof recursive, Tree>>();

declare const mixedIndex: { known: number; [key: string]: number };
updateIn(mixedIndex, ['known'], current => {
  expect<Equal<typeof current, number>>();
  return current + 1;
});
updateIn(mixedIndex, ['new'], current => {
  expect<Equal<typeof current, number | undefined>>();
  return (current ?? 0) + 1;
});
updateIn(mixedIndex, [key], current => {
  expect<Equal<typeof current, number | undefined>>();
  return (current ?? 0) + 1;
});

// Like Immer, broad keys follow the index signature rather than every named field.
// This preserves T but cannot guarantee narrower fields for a runtime-selected key.
declare const mixedLiteral: { fixed: 'fixed'; [key: string]: string };
const exactFixed = updateIn(mixedLiteral, ['fixed'], 'fixed');
expect<Equal<typeof exactFixed, typeof mixedLiteral>>();
updateIn(mixedLiteral, ['new'], 'changed');
const dynamicReplacement = updateIn(mixedLiteral, [key], 'changed');
expect<Equal<typeof dynamicReplacement, typeof mixedLiteral>>();
expect<Equal<typeof dynamicReplacement.fixed, 'fixed'>>();
updateIn(mixedLiteral, [key], current => {
  expect<Equal<typeof current, string | undefined>>();
  return 'changed';
});
// @ts-expect-error An exact key still enforces the declared literal field type.
updateIn(mixedLiteral, ['fixed'], 'changed');
// @ts-expect-error The exact-key updater must obey the same restriction.
updateIn(mixedLiteral, ['fixed'], () => 'changed');

declare const mixedOptional: { name?: string; [key: string]: string | undefined };
updateIn(mixedOptional, ['name'], name => {
  expect<Equal<typeof name, string | undefined>>();
  return name ?? 'Olga';
});
updateIn(mixedOptional, ['new'], undefined);
// The index signature permits undefined, even though an exact name write does not.
updateIn(mixedOptional, [key], undefined);
updateIn(mixedOptional, [key], () => undefined);
// @ts-expect-error Exact optional property writes remain checked.
updateIn(mixedOptional, ['name'], undefined);
declare const resettableIndex: { name?: string | undefined; [key: string]: string | undefined };
updateIn(resettableIndex, [key], undefined);

declare const mixedNumeric: { 0: 1; [key: number]: number };
updateIn(mixedNumeric, [0], 1);
updateIn(mixedNumeric, [1], 2);
updateIn(mixedNumeric, [index], 2);
// @ts-expect-error An exact numeric key retains its declared literal type.
updateIn(mixedNumeric, [0], 2);
declare const refinedArray: { values: number[] & { 0: 1 } };
updateIn(refinedArray, ['values', 0], current => {
  expect<Equal<typeof current, 1 | undefined>>();
  return 1 as const;
});
updateIn(refinedArray, ['values', index], 2);
// @ts-expect-error Exact array indices also retain explicitly declared field types.
updateIn(refinedArray, ['values', 0], 2);
declare const numericStringKey: `${number}`;
updateIn(mixedNumeric, [numericStringKey], 2);
declare const stringZero: { '0': 1; [key: string]: number };
updateIn(stringZero, [index], 2);
declare const numericZero: { 0: 1; [key: string]: number };
updateIn(numericZero, [key], 2);

declare const dynamicSymbol: symbol;
declare const mixedSymbol: { [symbolKey]: 1; [key: symbol]: number };
updateIn(mixedSymbol, [symbolKey], 1);
updateIn(mixedSymbol, [dynamicSymbol], 2);
// @ts-expect-error An exact unique-symbol key still checks its declared field type.
updateIn(mixedSymbol, [symbolKey], 2);

declare const mixedBranches: {
  fixed: { name: 'fixed' };
  [key: string]: { name: string };
};
updateIn(mixedBranches, ['new', 'name'], 'changed');
// Intermediate dynamic segments likewise follow their declared index signature.
updateIn(mixedBranches, [key, 'name'], 'changed');
updateIn(mixedBranches, [key, 'name'], () => 'changed');

declare const patternedLiteral: { 'count-fixed': 1; [key: `count-${string}`]: number };
declare const countKey: `count-${string}`;
updateIn(patternedLiteral, ['count-new'], 2);
updateIn(patternedLiteral, [countKey], 2);
declare const overlappingIndexes: { [key: string]: number; [key: `fixed-${string}`]: 1 };
updateIn(overlappingIndexes, ['other'], 2);
updateIn(overlappingIndexes, ['fixed-one'], 1);
updateIn(overlappingIndexes, [key], 2);
// @ts-expect-error An exact key matching the narrower pattern keeps that value type.
updateIn(overlappingIndexes, ['fixed-one'], 2);

// Distinct pattern domains and noncanonical numeric-looking strings remain usable.
declare const separatePatterns: { [key: `a-${string}`]: number; [key: `b-${string}`]: string };
declare const aKey: `a-${string}`;
updateIn(separatePatterns, [aKey], current => {
  expect<Equal<typeof current, number | undefined>>();
  return (current ?? 0) + 1;
});
declare const numberAndString: { [key: number]: number; [key: string]: number | string };
updateIn(numberAndString, ['01'], 'text');
declare const patternIndex: { [key: `count-${string}`]: number };
updateIn(patternIndex, ['count-new'], current => {
  expect<Equal<typeof current, number | undefined>>();
  return (current ?? 0) + 1;
});
declare const symbolIndex: { [key: symbol]: number };
updateIn(symbolIndex, [symbolKey], current => {
  expect<Equal<typeof current, number | undefined>>();
  return (current ?? 0) + 1;
});
declare const numericIndex: Record<number, User>;
updateIn(numericIndex, ['0'], current => {
  expect<Equal<typeof current, User | undefined>>();
  return current ?? { name: 'Olga', age: 0 };
});
declare const finiteRecord: Record<'first' | 'second', number>;
updateIn(finiteRecord, ['first'], current => {
  expect<Equal<typeof current, number>>();
  return current + 1;
});

// @ts-expect-error A primitive leaf cannot be traversed as an object.
updateIn(state, ['user', 'name', 'length'], 0);
// @ts-expect-error constructor is forbidden even if it appears in the model.
updateIn({ constructor: 1 }, ['constructor'], 2);
// @ts-expect-error prototype is also forbidden on dictionaries.
updateIn(state, ['counts', 'prototype'], 0);
// @ts-expect-error Root special objects remain unsupported.
updateIn(new Date(), ['getTime'], () => () => 0);

// Binary values can be replaced, but are not ordinary path containers.
declare const binary: {
  bytes: Uint8Array;
  integers: Int32Array;
  bigints: BigInt64Array;
  buffer: ArrayBuffer;
  shared: SharedArrayBuffer;
  view: DataView;
};
const replacedBytes = updateIn(binary, ['bytes'], current => {
  expect<Equal<typeof current, Uint8Array>>();
  return new Uint8Array(current);
});
expect<Equal<typeof replacedBytes, typeof binary>>();
updateIn(binary, ['integers'], new Int32Array(1));
updateIn(binary, ['bigints'], new BigInt64Array(1));
updateIn(binary, ['buffer'], new ArrayBuffer(8));
updateIn(binary, ['shared'], new SharedArrayBuffer(8));
updateIn(binary, ['view'], new DataView(new ArrayBuffer(8)));
// @ts-expect-error Typed arrays are not supported intermediate containers.
updateIn(binary, ['bytes', 0], 7);
// @ts-expect-error The restriction also applies to the updater overload.
updateIn(binary, ['bytes', 0], () => 7);
// @ts-expect-error Other numeric typed arrays are opaque as well.
updateIn(binary, ['integers', 0], 7);
// @ts-expect-error BigInt typed arrays are also opaque.
updateIn(binary, ['bigints', 0], 7n);
// @ts-expect-error ArrayBuffer properties cannot be traversed.
updateIn(binary, ['buffer', 'byteLength'], 16);
// @ts-expect-error SharedArrayBuffer properties cannot be traversed.
updateIn(binary, ['shared', 'byteLength'], 16);
// @ts-expect-error DataView properties cannot be traversed.
updateIn(binary, ['view', 'byteLength'], 16);
// @ts-expect-error Typed arrays cannot be roots either.
updateIn(binary.bytes, [0], 7);
// @ts-expect-error ArrayBuffer cannot be a root.
updateIn(binary.buffer, ['byteLength'], 16);
// @ts-expect-error SharedArrayBuffer cannot be a root.
updateIn(binary.shared, ['byteLength'], 16);
// @ts-expect-error DataView cannot be a root.
updateIn(binary.view, ['byteLength'], 16);
