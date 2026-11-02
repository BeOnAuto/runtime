import { JsonPointer, Predicate } from 'effect';

const escape = /~(?![01])/u;

export function isJsonPointer(text: string): boolean {
  return text === '' || (text.startsWith('/') && !escape.test(text));
}

function stepInto(value: unknown, token: string): unknown {
  if (Array.isArray(value)) {
    return /^(?:0|[1-9]\d*)$/u.test(token) ? value.at(Number(token)) : undefined;
  }
  return Predicate.isObject(value) && Object.hasOwn(value, token) ? Reflect.get(value, token) : undefined;
}

export function valueAt(document: unknown, pointer: string): unknown {
  if (pointer === '') {
    return document;
  }
  return pointer
    .slice(1)
    .split('/')
    .map((token) => JsonPointer.unescapeToken(token))
    .reduce<unknown>((value, token) => stepInto(value, token), document);
}

export function textAt(document: unknown, pointer: string): string | undefined {
  const value = valueAt(document, pointer);
  if (typeof value === 'string') {
    return value;
  }
  return typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : undefined;
}
