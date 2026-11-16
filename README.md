# lean-fns

A general-purpose JavaScript and TypeScript utility library.

## Project status

`updateIn` and the experimental `produce` are implemented with runtime and consumer type tests.

The package is not published. It remains private until the API, license, and release process are agreed.

## updateIn

Update one nested value without mutating the input:

```ts
import { updateIn } from 'lean-fns';

const state = { user: { name: 'Anna' }, settings: { theme: 'dark' } };
const path = ['user', 'name'] as const;

const next = updateIn(state, path, name => name.toUpperCase());
// next.user.name === 'ANNA'; state.user.name === 'Anna'
// next.settings === state.settings

updateIn(state, path, 'Olga'); // A replacement value also works.
updateIn(state, path, 'Anna') === state; // Existing leaf + Object.is equality.
```

The root must be a plain object. Paths are non-empty arrays of string, number or symbol keys; a supplied path is neither copied nor mutated. Arrays inside the object accept numeric indices only, from 0 to 4294967294. Numeric keys also work on ordinary objects; string array indices and `length` are not supported. `__proto__`, `constructor` and `prototype` are forbidden path keys.

Only own properties are read along the path. An absent **final** property receives `undefined` in the callback and can be initialized with a complete value:

```ts
type State = { user?: { name: string; age: number } };
const state: State = {};
const next = updateIn(state, ['user'], user => user ?? { name: 'Olga', age: 0 });
// next: State; user remains optional in the result's type.
```

Every intermediate parent must already exist as a plain object or ordinary array. Missing, null, primitive or unsupported intermediate values throw `TypeError` before the callback; intermediate objects and arrays are not created automatically. Invalid numeric indices throw `RangeError`. A callback runs once with only the current value; it must return a replacement and must not mutate the input, current value or path. To store a function, return it from a callback: `updateIn(state, ['handler'], () => handler)`.

- Changed paths are shallowly copied; untouched values keep their references. Returned replacement values are stored by reference without merging or deep cloning.
- An existing own leaf with an `Object.is`-equal replacement returns the original root. An absent leaf assigned `undefined` creates an own property; `undefined` does not mean deletion.
- Arrays preserve holes and accept append or sparse writes. Only their own indexed elements and length are copied; extra named or symbol properties are not preserved.
- Object copies use spread semantics: enumerable own strings and symbols, without preserving descriptors or other non-enumerable properties. The updated property becomes an ordinary data property.
- Frozen/sealed inputs are supported. New containers are not frozen automatically. Getters may run during traversal or copying; setters on the input are not called. Getter and callback errors propagate, including getter errors during copying after the callback.
- Class instances and special objects such as `Map`, `Date`, typed arrays and buffers can be replaced as whole leaves, but cannot be traversed. Proxy behavior, custom prototypes and cyclic graph preservation are outside the contract. Null-prototype dictionaries are accepted and copied into regular objects.

TypeScript preserves the input type, including optional and readonly fields, and checks exact tuple paths and replacement values. A callback is not an Immer draft. Like Immer and ordinary TypeScript assignments, dynamic dictionary keys use the index signature: they can violate a narrower named field's value while the result still has the original type. Exact keys retain their field-specific checks. Arbitrary `string[]` paths, ambiguous unions and variadic tuples require narrowing or a more precise model. Type checks currently use TypeScript 7.0.2 with strict mode and `exactOptionalPropertyTypes` enabled.

### Storing function values

At runtime, every function passed as the third argument is an updater. TypeScript cannot always detect this: assigning a function to `object` or a structural interface can hide its call signature. The call can then compile even when the updater's result does not match the declared field type.

```ts
const state: { value: object } = { value: {} };
const replacement: object = () => 123;

const unsafe = updateIn(state, ['value'], replacement);
// Compiles, but calls replacement: unsafe.value is 123 at runtime,
// even though its TypeScript type is object.

const next = updateIn(state, ['value'], () => replacement);
// next.value === replacement; the function itself is not called.
```

To store a function, always wrap it in an updater that returns it, even if its static type does not expose that it is a function.

## produce (experimental)

Apply several related changes to plain object/array state through a temporary draft:

```ts
import { produce } from 'lean-fns';

const state = {
  user: { name: 'Anna', age: 20 },
  items: [{ id: 1, done: false }],
  settings: { theme: 'dark' },
};
const next = produce(state, draft => {
  draft.user.name = 'Olga';
  draft.user.age++;
  draft.items.push({ id: 2, done: true });
});
// state.user.name === 'Anna'; next.user.name === 'Olga'
// next.settings === state.settings
```

The synchronous recipe runs once. Its draft uses revocable proxies, created lazily for accessed children. Containers are shallowly copied when changed. The result contains ordinary objects and arrays. Store or pass on the returned state. The API is experimental and may change before release.

### Supported state and operations

- A plain object or ordinary array at the root, containing a tree of plain objects, arrays and primitive values, including ordinary data from another JavaScript realm such as an iframe. Null-prototype dictionaries are supported and retain their prototype when copied.
- Objects have own enumerable string data properties. Arrays have indexed elements and their standard `length`. `undefined`, `null`, `NaN`, bigint and symbol **values** are supported.
- Assignment, deletion, `Object.keys`, `in`, spread, iteration and standard array methods work. Array callbacks receive drafts for objects from the input. `filter`, `map`, `splice`, `sort` and `reverse` can be followed by further edits to retained or moved elements.
- Frozen, sealed and non-extensible inputs are supported. New containers are writable and are not automatically frozen. Untouched frozen branches stay frozen and shared.
- The data model excludes cycles, repeated object references within a state, class instances, `Date`, `Map`, `Set`, functions, typed arrays, custom proxies, symbol keys, accessors and custom property descriptors. The input is not deeply validated in advance. Detected unsupported containers and operations throw, but untouched invalid branches may not be diagnosed.
- The reserved field names `__proto__`, `constructor` and `prototype` are outside the state model. Reading these object fields, assigning/deleting them, descriptor changes, changing prototypes and freezing drafts are rejected. Arrays retain their inherited constructor for standard methods such as `filter`. Nested `produce` over a draft and foreign drafts are unsupported.

`delete draft.items[index]` leaves a hole. Use `splice` to remove and shift elements. Missing intermediate branches must be initialized explicitly, for example `draft.user ??= { name: '', age: 0 }` when the input type has an optional user.

The draft's `filter` method is the native `Array.prototype.filter`, operating on the draft through its proxy. Standard callback arguments, `thisArg`, sparse-array behavior and initial-length semantics are preserved. Objects from the input reach the callback as drafts.

Property values are read directly, without inspecting descriptors to detect getters or non-enumerable fields. Getters can run during reads, shallow copying and finalization; their side effects are not isolated by `produce`. The supported state model remains a tree of ordinary data properties, and accessors or custom descriptors are not validated or fully supported.

### Identity and no-op behavior

```ts
produce(state, draft => { draft.user.name = 'Anna'; }) === state; // true
produce(state, draft => { void draft.user.age; }) === state; // true
```

An existing own value is compared with `Object.is`. Creating a missing property with `undefined` or filling a hole with `undefined` changes the state. A new object is a change even when its contents are equal. Writing a different value and then restoring the old value may return a new root.

Unchanged branches are shared. Treat the input and result as read-only outside recipes: mutating a shared branch directly also affects the other state.

### External values

Objects assigned from outside the recipe are stored by reference and remain raw during that call:

```ts
const external = { name: 'Olga', age: 21 };
const next = produce(state, draft => {
  draft.user = external;
  draft.user.age++; // Also changes external.age to 22.
});
// next.user === external
```

Assign a complete new value to preserve an external object, such as `draft.user = { ...external, age: external.age + 1 }`. Spread is shallow. Nested external objects need their own copies when modified. On a later `produce(next, ...)` call, that branch belongs to the input and receives ordinary draft protection. New wrappers containing drafts are finalized without mutating the wrappers.

### Returns, errors and TypeScript

No return, `return undefined` and `return draft` finalize the draft. A complete replacement state can be returned when the draft was not changed:

```ts
const reset = produce(state, () => ({ ...state, items: [] }));
```

Changing the draft and returning a different state throws. Prefer block callbacks: `draft => { draft.items.push(item); }`. A short arrow that returns `push`'s number is invalid. Async/thenable recipe results are rejected. Every draft is revoked after success or error, so it cannot be used later. Recipe errors propagate. The library does not roll back external side effects performed by the recipe.

`ProduceDraft<T>` removes readonly modifiers within the recipe. Field types, optional fields, tuples and literal unions are preserved, and the result retains `T`. Consumer checks cover NodeNext, Bundler and CommonJS. TypeScript can hide unsupported runtime values through wider structural types, including class instances or an async function previously typed as returning `void`. Runtime restrictions still apply.

### Measuring produce

```sh
pnpm bench:produce:verify
pnpm bench:produce
pnpm bench:produce --rounds 3 --time 500 --warmup 200 --output /absolute/path/outside-the-repo/produce.json
# Focus on one scenario; all implementations use the same fixture and recipe.
pnpm bench:produce --scenario filter-1000 --rounds 5 --time 2000 --warmup 500
pnpm bench:produce --scenario filter-numbers --rounds 5 --time 2000 --warmup 500
pnpm bench:produce --scenario many-writes --rounds 5 --time 2000 --warmup 500
# Optional saved baseline module, measured on the same current fixtures.
pnpm bench:produce --baseline /absolute/path/to/historical-produce.mjs --output /absolute/path/outside-the-repo/comparison.json
```

The comparison builds the isolated `produce` export and the installed Immer's `Immer({ autoFreeze: false }).produce` as production/minified ESM using the same installed Rolldown. Immer's Array Methods Plugin is not enabled, so both implementations use native `filter`. Seventeen scenarios cover no-op, read-only, equal-value writes, deep writes, many writes, wide objects, numeric/object arrays, filtering, spreading, external assignment, array reordering and frozen input. Filter cases include object and numeric arrays with and without writes, and callback mutations on a sparse array. Four scenarios also include a handwritten update as an overhead reference. The optional saved module keeps its original build and is labeled `baseline`, with its source path and hash in JSON. `--scenario` selects one exact scenario ID from `benchmarks/produce-cases.mjs`.

Correctness checks compare values, input preservation, callback count and reference identity before timing. Each call uses a fresh independent fixture; creation occurs outside timing and consumes the wall-clock budget. Operations are measured in batches of 16, with at least 64 samples per worker, 3 rounds, 500 ms measurement and 200 ms warmup by default. Each scenario/implementation/round runs in a separate sequential process in a seeded shuffled order. Results escape timing and are checked afterwards. No timer-overhead subtraction or forced GC is used.

Reports show the median of per-process mean ns/op, ranges, RME and warnings. Size covers standalone runtime ESM minified/gzip-9/Brotli-11, excluding declarations and sourcemaps. Optional output writes JSON, Markdown and the measured modules to new paths outside the repository, with source/module hashes, versions, environment and Git state. Keep the machine otherwise idle. These fixtures and measurements do not establish a universal speed advantage or full Immer compatibility.

## Goals

- Zero runtime dependencies.
- Small imports with independent utility functions.
- Fast execution, verified with reproducible benchmarks.
- Clear behavior and precise TypeScript types.

## Planned areas

Arrays and collections, objects, strings, functions, numbers, type predicates, and asynchronous operations.

## Runtime support

The built package supports Node.js 22.0.0 or newer through ESM and CommonJS. Use the latest patch of a supported LTS release.

## Development

Use Node.js 24.18.0 and pnpm 12.14.0. Tooling requires Node.js 24.11.0 or newer in the Node 24 line. This requirement applies to building and testing the repository; package consumers use the runtime baseline above.

```sh
pnpm install --frozen-lockfile
pnpm check
```

`pnpm check` checks source and tooling types, builds ESM/CommonJS with declarations, runs runtime and native package tests, checks consumer types, validates package metadata with publint, and verifies both utilities' benchmark correctness without measuring performance.

GitHub Actions runs the full check on the pinned Node 24 version and packs the package. Separate jobs install that archive into a clean consumer project and load its ESM and CommonJS exports on Node 22.0.0 and the latest Node 22 release.

| Command | Purpose |
| --- | --- |
| `pnpm build` | Build ESM, CommonJS, and declarations |
| `pnpm dev` | Rebuild source changes in watch mode |
| `pnpm typecheck` | Check source, configuration, and test types |
| `pnpm test` | Build and run tests |
| `pnpm test:watch` | Build once and watch tests; run `pnpm dev` alongside it for source changes |
| `pnpm test:types` | Check consumer types after building |
| `pnpm check:package` | Validate package metadata after building |
| `pnpm bench` | Build and measure immutable update scenarios |
| `pnpm bench:verify` | Check benchmark correctness after building |
| `pnpm bench:produce` | Build and measure draft-based state updates |
| `pnpm bench:produce:verify` | Check produce benchmark correctness after building |
| `pnpm check` | Run all local checks |
| `pnpm pack` | Typecheck, build, and create a local package archive |

To use the pinned pnpm without changing a global installation, prefix commands with `npx --yes pnpm@12.14.0`.

## Benchmarks

```sh
pnpm install --frozen-lockfile
pnpm bench
# Longer measurement; the output directory must already exist and the file must be new.
pnpm bench --rounds 5 --time 1000 --warmup 300 --seed 1729 --output /absolute/path/outside-the-repo/update-in.json
```

The benchmark uses the current minified ESM build and exact devDependency versions of Immer, Lodash, es-toolkit and Tinybench. They are not runtime dependencies and benchmark files are not shipped in the package. Keep measurements and reports outside this repository.

Seven scenarios update a shallow field, a six-segment path, one property of a 100-property object, one element in arrays of 32 and 1,000 objects, a missing complete branch, and an unchanged deep leaf. Paths and callbacks are reused. Each operation starts from one of 16 equivalent, **pre-frozen** fixtures with varied values; results are not chained into the next operation. Fixture creation, freezing, imports and assertions are outside timing. These are single-path steady-state measurements, not fresh-JSON ingestion, multiple edits in one transaction, or arbitrary data types.

| Implementation | Measured operation |
| --- | --- |
| `lean-fns` | Public `updateIn(state, path, updater)` |
| `immer-no-freeze` | `Immer({ autoFreeze: false }).produce` with a direct, pre-created recipe |
| `immer-auto-freeze` | `Immer({ autoFreeze: true }).produce`; additionally freezes new output |
| `lodash-fp` | Native immutable `lodash/fp/update(path, updater, state)` |
| `lodash-copy-update` | Benchmark adapter: shallow-copy parents, then Lodash `update` |
| `es-toolkit-copy-update` | The same copying adapter, then `es-toolkit/compat/update` |

The two copying adapters include the copy in measured time. They preserve untouched references and do not use `cloneDeep`; their measurements include our adapter, so they are not measurements of the mutating APIs alone. Adapters are restricted to valid ordinary fixture data and are not full replacements for the `updateIn` contract. Immer gets an idiomatic direct recipe, without an extra generic path traversal. See the [Lodash FP guide](https://github.com/lodash/lodash/wiki/FP-Guide), [es-toolkit update](https://es-toolkit.dev/compat/reference/object/update.html) and [Immer freezing](https://immerjs.github.io/immer/freezing/) for API differences.

Before timing, 84 assertions-based case checks verify equal values, one callback invocation, input preservation and shared untouched branches. The no-op scenario deliberately retains native behavior: lean-fns and Immer return the input; Lodash FP and both copying adapters create a new root. The no-op row therefore includes different allocation/identity behavior. Immer's two modes also differ in output freezing; neither is silently presented as the other's contract.

Defaults: three rounds, 500 ms measurement and 200 ms warmup per case, at least 64 samples, 32 updates per sample, `NODE_ENV=production`. Each scenario/implementation/repeat runs in a fresh Node process, sequentially. A seeded shuffle changes case order across rounds. A result escapes the timed loop and is consumed afterwards. Automatic GC remains part of execution; no forced GC or subtraction of a synthetic baseline is used.

The table reports the median of each process's **mean nanoseconds per update**, the min/max across processes, and the largest within-process RME. Timing warnings are printed with their case and round, collected in the summary, and saved in JSON. Throughput is the reciprocal of mean latency, not an average of per-sample reciprocals. RME describes batches and is not a confidence interval over independent processes. The optional JSON retains every process result, warnings, options, installed package versions, Node/V8/OS/CPU, Git state and hashes of source/build/config/lockfile. Changes to these files during a run invalidate its results. Run on an otherwise idle machine with a fixed power mode; small differences and noisy results need longer/repeated runs. Measurements describe that machine and fixture set, not universal library rankings.
