type Path = readonly [PropertyKey, ...PropertyKey[]];
type ForbiddenKey = '__proto__' | 'constructor' | 'prototype';
type IsAny<T> = 0 extends 1 & T ? true : false;
type IsUnion<T, Whole = T> = T extends Whole
  ? [Whole] extends [T] ? false : true
  : never;

// Custom class instances cannot be distinguished from plain objects structurally.
type Opaque = Function | Date | RegExp | ReadonlyMap<unknown, unknown>
  | ReadonlySet<unknown> | WeakMap<object, unknown> | WeakSet<object>
  | PromiseLike<unknown> | ArrayBufferLike | ArrayBufferView;

type RootGuard<T> = IsAny<T> extends true ? never
  : IsUnion<T> extends true ? never
  : T extends readonly unknown[] | Opaque ? never : unknown;

type DeclaredKeys<T> = keyof {
  // Empty records identify open index signatures, including template patterns.
  [K in keyof T as {} extends Record<K, unknown> ? never : K]: unknown;
};

type ObjectKey<T, K extends PropertyKey> = K extends keyof T ? K
  : K extends number ? `${K}` extends keyof T ? `${K}` : never
  : K extends `${infer N extends number}`
    ? `${N}` extends K ? N extends keyof T ? N : never : never
    : never;

// Broad keys use their index signature, as with an ordinary TypeScript write.
type Field<T, K extends keyof T> = {
  read: K extends DeclaredKeys<T> ? T[K] : T[K] | undefined;
  write: Required<Pick<T, K>>[K];
};

// Literal integer checks are cheap; the maximum index remains a runtime check.
type IsIndex<K extends number> = number extends K ? true
  : `${K}` extends `-${string}` ? false
  : `${K}` extends `${bigint}` ? true : false;

type ArrayField<T extends readonly unknown[], K extends number> =
  number extends T['length']
    ? Extract<keyof T, `${number}`> extends never
      ? T extends readonly [...unknown[], unknown] ? never
        : { read: T[K] | undefined; write: Required<Pick<T, K>>[K] }
      : never // Variadic tuples need separate validation; do not widen their slots.
    : `${K}` extends keyof T ? Field<T, `${K}`> : never;

type Segment<T, K extends PropertyKey> = T extends readonly unknown[]
  ? K extends number ? ArrayField<T, K> : never
  : ObjectKey<T, K> extends infer Key
    ? [Key] extends [never] ? never
      : Key extends keyof T ? Field<T, Key> : never
    : never;

type Walk<T, P extends readonly PropertyKey[]> =
  IsAny<T> extends true ? never
  : [NonNullable<T>] extends [never] ? never
  : IsUnion<NonNullable<T>> extends true ? never
  : [NonNullable<T>] extends [object]
    ? NonNullable<T> extends Opaque ? never
      : P extends readonly [infer K extends PropertyKey, ...infer Rest extends PropertyKey[]]
        ? IsUnion<K> extends true ? never
          : K extends ForbiddenKey ? never
          : K extends number ? IsIndex<K> extends false ? never
            : Descend<NonNullable<T>, K, Rest>
          : Descend<NonNullable<T>, K, Rest>
        : never
    : never;

type Descend<T, K extends PropertyKey, Rest extends readonly PropertyKey[]> =
  Segment<T, K> extends infer Member
    ? Member extends { read: unknown; write: unknown }
      ? Rest extends readonly [] ? Member : Walk<Member['read'], Rest>
      : never
    : never;

type Info<T, P extends Path> = IsUnion<P> extends true ? never : Walk<T, P>;
type PathGuard<T, P extends Path> = [Info<T, P>] extends [never] ? never : unknown;
type ReadAt<T, P extends Path> = Info<T, P>['read'];
type WriteAt<T, P extends Path> = Info<T, P>['write'];
type NonCallable<V> = [Extract<V, Function>] extends [never] ? unknown : never;

/** Compute a replacement value. Parents must exist at runtime; current is not a draft. */
export function updateIn<T extends object, const P extends Path>(
  object: T & RootGuard<T>,
  path: P & NoInfer<PathGuard<T, P>>,
  updater: (current: NoInfer<ReadAt<T, P>>) => NoInfer<WriteAt<T, P>>,
): T;

/** Replace a value. Function values must be returned by an updater. */
export function updateIn<T extends object, const P extends Path, V>(
  object: T & RootGuard<T>,
  path: P & NoInfer<PathGuard<T, P>>,
  value: V & NoInfer<WriteAt<T, P>> & NoInfer<NonCallable<V>>,
): T;

export function updateIn(object: unknown, path: readonly PropertyKey[], valueOrUpdater: unknown): object {
  if (!isPlainObject(object)) {
    throw new TypeError('updateIn: the root must be a plain object');
  }
  if (!Array.isArray(path) || path.length === 0) {
    throw new TypeError('updateIn: path must be a non-empty array');
  }

  const parents: { parent: Container; key: PropertyKey }[] = [];
  const length = path.length;
  let parent: Container = object;

  for (let depth = 0; depth < length; depth++) {
    const key: unknown = path[depth];

    if (typeof key === 'number') {
      if (!Number.isInteger(key) || key < 0 || key > 4294967294) {
        throw new RangeError('updateIn: numeric keys must be valid array indices');
      }
    } else if (typeof key !== 'string' && typeof key !== 'symbol') {
      throw new TypeError('updateIn: path segments must be strings, numbers, or symbols');
    }
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      throw new TypeError('updateIn: unsafe path key');
    }
    if (Array.isArray(parent) && typeof key !== 'number') {
      throw new TypeError('updateIn: arrays require numeric indices');
    }

    const exists = Object.hasOwn(parent, key);
    const current: unknown = exists ? (parent as Record<PropertyKey, unknown>)[key] : undefined;

    if (depth === length - 1) {
      const next: unknown = typeof valueOrUpdater === 'function' ? valueOrUpdater(current) : valueOrUpdater;

      if (exists && Object.is(current, next)) {
        return object;
      }

      let result = replace(parent, key, next);

      for (let index = parents.length - 1; index >= 0; index--) {
        const frame = parents[index]!;
        result = replace(frame.parent, frame.key, result);
      }

      return result;
    }

    if (!exists || !isContainer(current)) {
      throw new TypeError('updateIn: every intermediate parent must be an existing object or array');
    }

    parents.push({ parent, key });
    parent = current;
  }

  // A validated non-empty path always returns from its final segment.
  throw new TypeError('updateIn: invalid path');
}

type Container = Record<PropertyKey, unknown> | unknown[];

function isContainer(value: unknown): value is Container {
  return Array.isArray(value) ? isStandardPrototype(Object.getPrototypeOf(value), Array) : isPlainObject(value);
}

function isPlainObject(value: unknown): value is Record<PropertyKey, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const prototype: unknown = Object.getPrototypeOf(value);

  return prototype === null || isStandardPrototype(prototype, Object);
}

function isStandardPrototype(prototype: unknown, constructor: typeof Object | typeof Array): boolean {
  if (prototype === constructor.prototype) {
    return true;
  }

  if (prototype === null || typeof prototype !== 'object') {
    return false;
  }

  // Other realms have their own built-in prototypes. Never invoke a custom constructor getter.
  const actualConstructor: unknown = Object.getOwnPropertyDescriptor(prototype, 'constructor')?.value;

  return typeof actualConstructor === 'function'
    && Function.prototype.toString.call(actualConstructor) === Function.prototype.toString.call(constructor)
    && actualConstructor.prototype === prototype;
}

const hasOwnProperty = Object.prototype.hasOwnProperty;

function replace(parent: Container, key: PropertyKey, value: unknown): Container {
  if (!Array.isArray(parent)) {
    return {...parent, [key]: value};
  }

  const length = parent.length;
  const copy: unknown[] = new Array<unknown>(length);
  let firstHole = 0;

  // Dense values need an own-property check only when the read is undefined.
  for (; firstHole < length; firstHole++) {
    const current = parent[firstHole];

    if (current === undefined && !hasOwnProperty.call(parent, firstHole)) {
      break;
    }

    copy[firstHole] = current;
  }

  // After the first hole, visit own indices rather than scanning a sparse length.
  if (firstHole < length) {
    for (const name of Object.getOwnPropertyNames(parent)) {
      const index = Number(name);

      if (Number.isInteger(index) && index >= firstHole && index < 4294967295 && String(index) === name) {
        copy[index] = parent[index];
      }
    }
  }

  Object.defineProperty(copy, key, { value, writable: true, enumerable: true, configurable: true });

  return copy;
}
