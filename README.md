# lean-fns

A general-purpose JavaScript and TypeScript utility library.

## Project status

The first utility, `updateIn`, is implemented with runtime and consumer type tests.

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

`pnpm check` checks source and tooling types, builds ESM/CommonJS with declarations, runs runtime and native package tests, checks consumer types, validates package metadata with publint, and verifies benchmark correctness without measuring performance.

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
