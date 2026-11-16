type Unsupported = Function | Date | RegExp | ReadonlyMap<unknown, unknown>
  | ReadonlySet<unknown> | WeakMap<object, unknown> | WeakSet<object>
  | PromiseLike<unknown> | ArrayBufferLike | ArrayBufferView;
type ForbiddenKey = '__proto__' | 'constructor' | 'prototype';
type IsAny<T> = 0 extends 1 & T ? true : false;

/** The writable view of a supported object or array, valid only inside a recipe. */
export type ProduceDraft<T> = T extends Unsupported ? never
  : T extends object ? { -readonly [K in keyof T]: ProduceDraft<T[K]> } : T;

type Supported<T> = IsAny<T> extends true ? never
  : T extends Unsupported ? never
  : T extends readonly unknown[] ? { [K in keyof T]: Supported<T[K]> }
  : T extends object ? {
    [K in keyof T]: K extends symbol | ForbiddenKey ? never : Supported<T[K]>
  } : T;
type InputGuard<T> = [T] extends [Supported<T>] ? unknown : never;
type RecipeGuard<R> = IsAny<R> extends true ? never
  : [Extract<R, PromiseLike<unknown>>] extends [never] ? unknown : never;

type Container = Record<string, unknown> | unknown[];
type ChildCache = [string, DraftNode] | Record<string, DraftNode>;
interface Scope {
  nodes: DraftNode[];
  resolved?: WeakMap<object, Container>;
  visiting?: WeakSet<object>;
}
interface DraftNode {
  base: Container;
  scope: Scope;
  parent: DraftNode | undefined;
  parentKey: string | undefined;
  copy: Container | undefined;
  children: ChildCache | undefined;
  modifiedChildren: DraftNode[] | undefined;
  assigned: Set<string> | undefined;
  proxy: Container;
  revoke: () => void;
  finalizing: boolean;
  finalized: boolean;
}

const draftState = Symbol('produce state');
const hasOwn = Object.hasOwn;

function isObject(value: unknown): value is Container {
  return typeof value === 'object' && value !== null;
}

function nodeOf(value: Container): DraftNode | undefined {
  return (value as unknown as { [draftState]?: DraftNode })[draftState];
}

function assertContainer(value: unknown): asserts value is Container {
  if (!isObject(value)) throw new TypeError('produce expects a plain object or array');
  assertPrototype(value);
}

function assertPrototype(value: Container): void {
  const prototype = Object.getPrototypeOf(value);
  const array = Array.isArray(value);
  const expected = array ? Array.prototype : Object.prototype;
  if (prototype !== expected && !(prototype === null && !array) && !isForeignPrototype(prototype, array)) {
    throw new TypeError('produce supports only plain objects and ordinary arrays');
  }
}

function isForeignPrototype(prototype: unknown, array: boolean): boolean {
  if (prototype === null || typeof prototype !== 'object') return false;
  // Other realms have distinct built-ins. Inspect only the prototype's constructor,
  // without invoking a custom constructor getter or changing direct data reads.
  const constructor: unknown = Object.getOwnPropertyDescriptor(prototype, 'constructor')?.value;
  return typeof constructor === 'function' && constructor.prototype === prototype
    && Function.prototype.toString.call(constructor) === Function.prototype.toString.call(array ? Array : Object);
}

function assertValue(value: unknown, scope: Scope): void {
  if (typeof value === 'function') throw new TypeError('Functions are unsupported state values');
  if (!isObject(value)) return;
  const node = nodeOf(value);
  if (node) {
    if (node.scope !== scope) throw new TypeError('Foreign drafts are unsupported');
  } else {
    assertPrototype(value);
  }
}

function shallowCopy(base: Container): Container {
  if (Array.isArray(base)) return Array.prototype.slice.call(base) as unknown[];
  if (Object.getPrototypeOf(base) === null) {
    return Object.assign(Object.create(null) as Record<string, unknown>, base);
  }
  return { ...base };
}

function prepareCopy(node: DraftNode): Container {
  if (!node.copy) {
    node.copy = shallowCopy(node.base);
    if (node.parent) {
      prepareCopy(node.parent);
      (node.parent.modifiedChildren ??= []).push(node);
    }
  }
  return node.copy;
}

function assertWritableKey(node: DraftNode, key: string | symbol): asserts key is string {
  if (typeof key !== 'string' || key === '__proto__' || key === 'constructor' || key === 'prototype') {
    throw new TypeError('Unsupported produce property');
  }
  if (Array.isArray(node.base) && key !== 'length') {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= 4294967295 || String(index) !== key) {
      throw new TypeError('Arrays accept only indices and length');
    }
  }
}

type Target = DraftNode | [DraftNode];
function targetNode(target: Target): DraftNode {
  return Array.isArray(target) ? target[0] : target;
}

function cachedChild(node: DraftNode, key: string | symbol): DraftNode | undefined {
  const children = node.children;
  if (!children) return undefined;
  if (Array.isArray(children)) return children[0] === key ? children[1] : undefined;
  return typeof key === 'string' ? children[key] : undefined;
}

function forgetChild(node: DraftNode, key: string): void {
  const children = node.children;
  if (!children) return;
  if (Array.isArray(children)) {
    if (children[0] === key) node.children = undefined;
  } else delete children[key];
}

function draftChild(node: DraftNode, key: string, value: Container): Container {
  const existingDraft = nodeOf(value);
  if (existingDraft) {
    if (existingDraft.scope !== node.scope) throw new TypeError('Foreign drafts are unsupported');
    return value;
  }
  assertPrototype(value);
  // Assigned external values remain raw. Reads of the base use a separate draft cache.
  if (node.copy && (!hasOwn(node.base, key) || value !== (node.base as Record<string, unknown>)[key])) return value;
  const child = createDraft(value, node.scope, node, key);
  // A single path needs no dictionary, especially at a sparse array index.
  const children = node.children;
  if (!children) node.children = [key, child];
  else if (Array.isArray(children)) {
    const expanded = Object.create(null) as Record<string, DraftNode>;
    expanded[children[0]] = children[1];
    expanded[key] = child;
    node.children = expanded;
  } else children[key] = child;
  return child.proxy;
}

function readProperty(node: DraftNode, key: string | symbol, receiver: unknown): unknown {
  const source = node.copy ?? node.base;
  // Writes to this property invalidate its cache; a length truncation removes the own key.
  const cached = node.children ? cachedChild(node, key) : undefined;
  if (cached && (!node.copy || hasOwn(source, key))) return cached.proxy;
  if (!hasOwn(source, key)) return Reflect.get(source, key, receiver);
  const value = (source as Record<string | symbol, unknown>)[key];
  if (typeof key === 'symbol') throw new TypeError('Symbol keys are unsupported');
  if (!isObject(value)) {
    if (typeof value === 'function') throw new TypeError('Functions are unsupported state values');
    return value;
  }
  return draftChild(node, key, value);
}

const handlers: ProxyHandler<Target> = {
  get(target, key, receiver) {
    const node = targetNode(target);
    if (key === draftState) return node;
    if (key === '__proto__' || key === 'prototype') throw new TypeError('Unsupported produce property');
    const { base } = node;
    const source = node.copy ?? base;
    // Array methods use the inherited constructor for species creation.
    if (key === 'constructor' && (!Array.isArray(base) || hasOwn(source, key))) {
      throw new TypeError('Unsupported produce property');
    }
    return readProperty(node, key, receiver);
  },

  set(target, key, value: unknown) {
    const node = targetNode(target);
    assertWritableKey(node, key);
    assertValue(value, node.scope);
    const source = node.copy ?? node.base;
    const present = hasOwn(source, key);
    const current = present ? (source as Record<string, unknown>)[key] : undefined;
    const cached = cachedChild(node, key);
    const child = cached?.base === current ? cached : undefined;
    if (present && ((Object.is(current, value) && !child?.copy)
      || (child !== undefined && child.proxy === value))) return true;
    (prepareCopy(node) as Record<string, unknown>)[key] = value;
    forgetChild(node, key);
    // Only object assignments can contain drafts that require finalization.
    if (isObject(value)) (node.assigned ??= new Set()).add(key);
    else node.assigned?.delete(key);
    return true;
  },

  deleteProperty(target, key) {
    const node = targetNode(target);
    assertWritableKey(node, key);
    if (Array.isArray(node.base) && key === 'length') throw new TypeError('Cannot delete array length');
    if (hasOwn(node.copy ?? node.base, key)) {
      Reflect.deleteProperty(prepareCopy(node), key);
    }
    forgetChild(node, key);
    node.assigned?.delete(key);
    return true;
  },

  has(target, key) {
    const node = targetNode(target);
    return key in (node.copy ?? node.base);
  },
  ownKeys(target) {
    const node = targetNode(target);
    return Reflect.ownKeys(node.copy ?? node.base);
  },
  getPrototypeOf(target) {
    return Object.getPrototypeOf(targetNode(target).base);
  },
  getOwnPropertyDescriptor(target, key) {
    const node = targetNode(target);
    if (!hasOwn(node.copy ?? node.base, key)) return undefined;
    const isLength = Array.isArray(node.base) && key === 'length';
    return {
      value: Reflect.get(node.proxy, key), writable: true,
      enumerable: !isLength, configurable: !isLength,
    };
  },
  defineProperty() { throw new TypeError('Defining draft descriptors is unsupported'); },
  setPrototypeOf() { throw new TypeError('Changing draft prototypes is unsupported'); },
  preventExtensions() { throw new TypeError('Freezing drafts is unsupported'); },
};

const arrayHandlers: ProxyHandler<[DraftNode]> = {
  ...handlers,
  get(target, key, receiver) {
    const node = target[0];
    // Array length is always a native data property, including on frozen arrays.
    if (key === 'length') return (node.copy ?? node.base).length;
    if (typeof key === 'string') {
      const first = key.charCodeAt(0);
      // Digit-prefixed keys cannot be a reserved property or the internal symbol.
      if (first >= 48 && first <= 57) return readProperty(node, key, receiver);
    }
    return handlers.get!(node, key, receiver);
  },
  has(target, key) {
    const node = target[0];
    return key in (node.copy ?? node.base);
  },
};

function createDraft(base: Container, scope: Scope, parent?: DraftNode, parentKey?: string): DraftNode {
  const node: DraftNode = {
    base, scope, parent, parentKey, copy: undefined,
    children: undefined, modifiedChildren: undefined, assigned: undefined,
    proxy: base, revoke: () => {}, finalizing: false, finalized: false,
  };
  // A separate extensible target allows writable drafts over frozen inputs.
  const { proxy, revoke } = Array.isArray(base)
    ? Proxy.revocable<[DraftNode]>([node], arrayHandlers)
    : Proxy.revocable(node, handlers);
  node.proxy = proxy as unknown as Container;
  node.revoke = revoke;
  scope.nodes.push(node);
  return node;
}

function resolveValue(value: unknown, scope: Scope): unknown {
  if (!isObject(value)) {
    if (typeof value === 'function') throw new TypeError('Functions are unsupported state values');
    return value;
  }
  const node = nodeOf(value);
  if (node) {
    if (node.scope !== scope) throw new TypeError('Foreign drafts are unsupported');
    return finalize(node);
  }
  assertPrototype(value);
  const known = scope.resolved?.get(value);
  if (known) return known;
  if (scope.visiting?.has(value)) throw new TypeError('Cyclic state is unsupported');
  (scope.visiting ??= new WeakSet()).add(value);
  let result = value;
  // A newly assigned wrapper can contain drafts at any depth.
  for (const key of Object.keys(value)) {
    const current = (value as Record<string, unknown>)[key];
    if (!isObject(current)) {
      if (typeof current === 'function') throw new TypeError('Functions are unsupported state values');
      continue;
    }
    const resolved = resolveValue(current, scope);
    if (current !== resolved) {
      if (result === value) result = shallowCopy(value);
      // The shallow copy contains writable own data properties.
      (result as Record<string, unknown>)[key] = resolved;
    }
  }
  scope.visiting.delete(value);
  (scope.resolved ??= new WeakMap()).set(value, result);
  return result;
}

function finalize(node: DraftNode): Container {
  if (!node.copy) return node.base;
  if (node.finalized) return node.copy;
  if (node.finalizing) throw new TypeError('Cyclic state is unsupported');
  node.finalizing = true;
  // Read-only children already have their base values in the shallow copy.
  if (node.modifiedChildren) {
    for (const child of node.modifiedChildren) {
      const key = child.parentKey!;
      if (cachedChild(node, key) === child && hasOwn(node.copy, key)
        && (node.copy as Record<string, unknown>)[key] === child.base) {
        (node.copy as Record<string, unknown>)[key] = finalize(child);
      }
    }
  }
  if (node.assigned) {
    for (const key of node.assigned) {
      if (hasOwn(node.copy, key)) {
        (node.copy as Record<string, unknown>)[key] = resolveValue((node.copy as Record<string, unknown>)[key], node.scope);
      }
    }
  }
  node.finalizing = false;
  node.finalized = true;
  return node.copy;
}

/**
 * Update plain object/array state through a synchronous, temporary draft.
 * Untouched branches are shared. External assigned objects remain shared by reference.
 */
export function produce<T extends object, R extends void | NoInfer<T> | ProduceDraft<NoInfer<T>>>(
  state: T & NoInfer<InputGuard<T>>,
  recipe: (draft: ProduceDraft<T>) => R & RecipeGuard<R>,
): T;
export function produce(state: object, recipe: Function): object {
  if (typeof recipe !== 'function') throw new TypeError('produce expects a synchronous recipe');
  assertContainer(state);
  if (nodeOf(state)) throw new TypeError('Nested produce on a draft is unsupported');
  const scope: Scope = { nodes: [] };
  const root = createDraft(state, scope);
  try {
    const result: unknown = recipe(root.proxy);
    if (isObject(result) && typeof Reflect.get(result, 'then') === 'function') {
      // Observe async failures, including continuation attempts on revoked drafts.
      void Promise.resolve(result).catch(() => {});
      throw new TypeError('produce recipes must be synchronous');
    }
    if (result === undefined || result === root.proxy) return finalize(root);
    if (root.copy) throw new TypeError('Cannot modify a draft and return a replacement');
    assertContainer(result);
    return resolveValue(result, scope) as Container;
  } finally {
    for (const node of scope.nodes) node.revoke();
  }
}
