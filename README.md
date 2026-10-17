# lean-fns

A general-purpose JavaScript and TypeScript utility library.

## Project status

Tooling is configured. Utility implementation has not started, and the public API is not yet finalized.

The package currently has no public utility exports. It is marked private until the API, license, and release process are agreed.

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

`pnpm check` checks source and tooling types, builds ESM/CommonJS with declarations, runs package import tests, checks consumer types, and validates package metadata with publint.

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
| `pnpm check` | Run all local checks |
| `pnpm pack` | Typecheck, build, and create a local package archive |

To use the pinned pnpm without changing a global installation, prefix commands with `npx --yes pnpm@12.14.0`.
