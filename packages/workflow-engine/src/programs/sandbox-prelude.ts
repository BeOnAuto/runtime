import { mostValueDepth } from '../dsl/json.ts';
import { sandboxRemovals } from './sandbox-names.ts';

const listed = (names: readonly string[]): string => JSON.stringify(names);

const dates = String.raw`
  const OriginalDate = Date;
  const DatePrototype = OriginalDate.prototype;
  const originalUTC = OriginalDate.UTC;
  const getTime = DatePrototype.getTime;
  const dateAlone = /^(?:[+-]\d{6}|\d{4})(?:-\d{2}(?:-\d{2})?)?$/;
  const dateTimeWithOffset = /^(?:[+-]\d{6}|\d{4})-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;
  let moment = 0;
  const instantOfText = (text) => {
    if (!matches(dateAlone, text) && !matches(dateTimeWithOffset, text)) {
      throw new Refusal('A date is read from text only as a date alone or a date and time with its offset, such as 2026-01-01 or 2026-01-01T09:00:00Z');
    }
    return apply(getTime, construct(OriginalDate, [text]), []);
  };
  const instantOf = (value) => {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') return instantOfText(value);
    try { return apply(getTime, value, []); } catch { throw new Refusal('A Date is made from no argument, one number, one string or one Date'); }
  };
  const SandboxDate = function Date(...values) {
    if (!${sandboxRemovals.dateConstructor.called} && new.target === undefined) throw new Refusal('Date is called with new, as a constructor');
    if (values.length > ${sandboxRemovals.dateConstructor.mostArguments}) throw new Refusal('A Date made from several numbers reads the time zone of the server; make it from Date.UTC(...) instead');
    return construct(OriginalDate, [values.length === 0 ? moment : instantOf(values[0])], new.target);
  };
  const local = () => { throw new Refusal('A Date is written as text with toISOString, which reads no time zone'); };
  const method = (value) => ({ value, writable: true, enumerable: false, configurable: true });
  defineProperty(SandboxDate, 'prototype', { value: DatePrototype, writable: false, enumerable: false, configurable: false });
  defineProperty(SandboxDate, 'length', { value: 7, writable: false, enumerable: false, configurable: true });
  defineProperty(SandboxDate, 'now', method(function now() { return moment; }));
  defineProperty(SandboxDate, 'parse', method(function parse(text) { return instantOfText(TextOf(text)); }));
  defineProperty(SandboxDate, 'UTC', method(originalUTC));
  defineProperty(DatePrototype, 'constructor', method(SandboxDate));
  for (const name of ${listed(sandboxRemovals.dateMethods)}) deleteProperty(DatePrototype, name);
  for (const name of ${listed(sandboxRemovals.dateTextMethods)}) defineProperty(DatePrototype, name, method(local));
  defineProperty(DatePrototype, Symbol.toPrimitive, { value: function (hint) { return hint === 'number' ? apply(getTime, this, []) : local(); }, writable: false, enumerable: false, configurable: true });
  defineProperty(global, 'Date', { value: SandboxDate, writable: false, enumerable: false, configurable: false });
`;

const removals = String.raw`
  for (const name of ${listed(sandboxRemovals.mathMembers)}) deleteProperty(Math, name);
  for (const name of ${listed(sandboxRemovals.globals)}) deleteProperty(global, name);
  for (const sample of [function () {}, function* () {}, async function () {}, async function* () {}]) {
    deleteProperty(getPrototypeOf(sample), 'constructor');
  }
`;

const writing = String.raw`
  const refusal = {};
  const mostDepth = ${mostValueDepth};
  const isPlain = (value) => {
    const prototype = getPrototypeOf(value);
    return prototype === ObjectPrototype || prototype === null || isArray(value);
  };
  const isJsonValue = (raw, form, present) => {
    switch (typeof raw) {
      case 'string':
      case 'boolean':
        return true;
      case 'number':
        return raw === raw && raw !== Infinity && raw !== -Infinity;
      case 'undefined':
        return form === 'expression' && present;
      case 'object':
        return raw === null || isPlain(raw);
      default:
        return false;
    }
  };
  const rawOf = (holder, key) => ({ present: hasOwn(holder, key), raw: holder[key] });
  const replacerOf = (form, depths) => function (key, given) {
    if (this[key] !== given) throw refusal;
    switch (typeof given) {
      case 'string':
      case 'boolean':
        return given;
      case 'number':
        if (given !== given || given === Infinity || given === -Infinity) throw refusal;
        return given;
      case 'object': {
        if (given === null) return given;
        if (!isPlain(given)) throw refusal;
        const depth = (apply(mapGet, depths, [this]) ?? 0) + 1;
        if (depth > mostDepth) throw refusal;
        apply(mapSet, depths, [given, depth]);
        return given;
      }
      case 'undefined':
        if (form === 'expression' && hasOwn(this, key)) return null;
        throw refusal;
      default:
        throw refusal;
    }
  };
  const kindOf = (raw, present) => {
    if (!present) return 'an empty place in a list';
    if (typeof raw === 'number') return TextOf(raw);
    if (typeof raw !== 'object' || raw === null) return typeof raw === 'undefined' ? 'undefined' : 'a ' + typeof raw;
    try { apply(getTime, raw, []); return 'a Date'; } catch {}
    const prototype = getPrototypeOf(raw);
    const named = prototype !== null && hasOwn(prototype, 'constructor') && typeof prototype.constructor === 'function' ? prototype.constructor.name : '';
    return typeof named === 'string' && named !== '' ? 'a ' + named : 'an object of a class';
  };
  const placeOf = (path, key, list) => {
    if (list) return path + '[' + key + ']';
    return matches(/^[A-Za-z_$][\w$]*$/, key) ? path + '.' + key : path + '[' + stringify(key) + ']';
  };
  const contains = (list, item) => {
    for (let index = 0; index < list.length; index++) if (list[index] === item) return true;
    return false;
  };
  const childrenOf = (raw, entry) => {
    const list = isArray(raw);
    const keys = list ? [] : keysOf(raw);
    const count = list ? raw.length : keys.length;
    const children = [];
    for (let index = count - 1; index >= 0; index--) {
      const key = list ? TextOf(index) : keys[index];
      apply(push, children, [{ holder: raw, key, path: placeOf(entry.path, key, list), ancestors: [...entry.ancestors, raw] }]);
    }
    return children;
  };
  const refusedIn = (root, form) => {
    const pending = [{ holder: { '': root }, key: '', path: '$', ancestors: [] }];
    while (pending.length > 0) {
      const entry = apply(pop, pending, []);
      const { present, raw } = rawOf(entry.holder, entry.key);
      if (!isJsonValue(raw, form, present)) return kindOf(raw, present) + ' at ' + entry.path;
      if (typeof raw === 'object' && raw !== null && contains(entry.ancestors, raw)) return 'a cycle at ' + entry.path;
      if (typeof raw === 'object' && raw !== null && entry.ancestors.length >= mostDepth) return 'a value deeper than ' + mostDepth + ' levels at ' + entry.path;
      if (typeof raw === 'object' && raw !== null) apply(push, pending, childrenOf(raw, entry));
    }
    return undefined;
  };
  const write = (value, form, most) => {
    try {
      const text = stringify(value, replacerOf(form, new Depths()));
      return text.length > most ? text.length : text;
    } catch (error) {
      const refusing = error === refusal || error instanceof Refusal;
      const refused = refusing ? refusedIn(value, form) ?? (error === refusal ? 'a member that changes as it is read' : undefined) : undefined;
      if (refused === undefined) throw error;
      throw new Refusal('The answer holds ' + refused + ', which JSON cannot carry');
    }
  };
`;

const freezing = String.raw`
  const generatorFunction = getPrototypeOf(function* () {});
  const asyncGeneratorFunction = getPrototypeOf(async function* () {});
  const reachedByNoName = [
    getPrototypeOf([][Symbol.iterator]()),
    getPrototypeOf(new Map()[Symbol.iterator]()),
    getPrototypeOf(new Set()[Symbol.iterator]()),
    getPrototypeOf(''[Symbol.iterator]()),
    getPrototypeOf(apply(String.prototype.matchAll, '', [/x/g])),
    generatorFunction,
    generatorFunction.prototype,
    asyncGeneratorFunction,
    asyncGeneratorFunction.prototype,
    getPrototypeOf(async function () {}),
    getPrototypeOf(apply(Iterator.prototype.map, [][Symbol.iterator](), [(each) => each])),
    getPrototypeOf(Iterator.from({ next: () => ({ done: true, value: undefined }) })),
  ];
  const tame = (object, name) => {
    const described = getOwnPropertyDescriptor(object, name);
    if (described === undefined || !hasOwn(described, 'value') || !described.writable || !described.configurable) return;
    const value = described.value;
    const accessors = {
      get() { return value; },
      set(next) {
        if (this === object) throw new Refusal('The intrinsics of the sandbox do not change');
        defineProperty(this, name, { value: next, writable: true, enumerable: true, configurable: true });
      },
    };
    defineProperty(object, name, { get: accessors.get, set: accessors.set, enumerable: described.enumerable, configurable: false });
  };
  const isPrototypeObject = (object) => {
    const described = getOwnPropertyDescriptor(object, 'constructor');
    return described !== undefined && typeof described.value === 'function' && described.value.prototype === object;
  };
  const tamedNames = ['constructor', 'name', 'message'];
  const tameAll = (object) => {
    const names = object === ObjectPrototype ? ownKeys(object) : isPrototypeObject(object) ? tamedNames : [];
    for (let index = 0; index < names.length; index++) tame(object, names[index]);
  };
  const isNamespace = (object) => {
    const tag = getOwnPropertyDescriptor(object, Symbol.toStringTag);
    return tag !== undefined && tag.value === 'Module' && getPrototypeOf(object) === null;
  };
  const freezeAll = (...roots) => {
    const seen = new Seen();
    const pending = [global, ...reachedByNoName, ...roots];
    while (pending.length > 0) {
      const object = apply(pop, pending, []);
      if (!isHeld(object) || apply(setHas, seen, [object])) continue;
      apply(setAdd, seen, [object]);
      const namespace = isNamespace(object);
      if (!namespace) tameAll(object);
      const keys = ownKeys(object);
      for (let index = 0; index < keys.length; index++) {
        const described = getOwnPropertyDescriptor(object, keys[index]);
        apply(push, pending, [described.value, described.get, described.set]);
      }
      apply(push, pending, [getPrototypeOf(object)]);
      if (!namespace) freeze(object);
    }
    return apply(setSize, seen, []);
  };
`;

const describing = String.raw`
  const isHeld = (value) => (typeof value === 'object' || typeof value === 'function') && value !== null;
  const describe = (thrown) => {
    let text = 'an error that is not written as text';
    let stack = '';
    try {
      if (isHeld(thrown)) {
        const { name, message, stack: trace } = thrown;
        text = typeof message === 'string' ? (typeof name === 'string' && name !== '' ? name + ': ' + message : message) : TextOf(thrown);
        stack = typeof trace === 'string' ? trace : '';
      } else {
        text = TextOf(thrown);
      }
    } catch {}
    return '{"text":' + stringify(apply(slice, text, [0, mostDescribed])) + ',"stack":' + stringify(apply(slice, stack, [0, mostDescribed])) + '}';
  };
`;

function preludeWith(frozen: string, exported: string): string {
  return String.raw`(() => {
  'use strict';
  const global = globalThis;
  const { apply, construct, defineProperty, deleteProperty, ownKeys, getOwnPropertyDescriptor, getPrototypeOf } = Reflect;
  const { freeze, hasOwn, keys: keysOf, prototype: ObjectPrototype } = Object;
  const { isArray } = Array;
  const { parse, stringify } = JSON;
  const exec = RegExp.prototype.exec;
  const matches = (pattern, text) => apply(exec, pattern, [text]) !== null;
  const TextOf = String;
  const Refusal = TypeError;
  const Seen = Set;
  const setHas = Seen.prototype.has;
  const setAdd = Seen.prototype.add;
  const setSize = getOwnPropertyDescriptor(Seen.prototype, 'size').get;
  const Depths = Map;
  const mapGet = Depths.prototype.get;
  const mapSet = Depths.prototype.set;
  const push = Array.prototype.push;
  const pop = Array.prototype.pop;
  const slice = String.prototype.slice;
  const mostDescribed = 4096;
${dates}
${removals}
${writing}
${describing}
${frozen}
  return {
    moment: (value) => { moment = value; },
    parse: (text) => parse(text),
    write,
    describe,
    drain: () => { for (;;) {} },
${exported}  };
})()`;
}

export const preludeSource = preludeWith('', '');

export const freezingPreludeSource = preludeWith(freezing, '    freeze: freezeAll,\n');
