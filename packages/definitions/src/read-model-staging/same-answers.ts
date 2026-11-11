type Fields = Readonly<Record<string, unknown>>;

function isObject(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function definedKeysOf(value: Fields): readonly string[] {
  return Object.entries(value)
    .filter(([, field]: readonly [string, unknown]) => field !== undefined)
    .map(([key]: readonly [string, unknown]) => key);
}

function sameArrays(today: readonly unknown[], candidate: readonly unknown[]): boolean {
  return today.length === candidate.length && today.every((entry, at) => sameAnswer(entry, candidate[at]));
}

function sameObjects(today: Fields, candidate: Fields): boolean {
  const keys = definedKeysOf(today);
  return keys.length === definedKeysOf(candidate).length && keys.every((key) => sameAnswer(today[key], candidate[key]));
}

export function sameAnswer(today: unknown, candidate: unknown): boolean {
  if (Array.isArray(today) && Array.isArray(candidate)) {
    return sameArrays(today, candidate);
  }
  if (isObject(today) && isObject(candidate)) {
    return sameObjects(today, candidate);
  }
  return Object.is(today, candidate);
}

export function differingFieldsOf(today: unknown, candidate: unknown): readonly string[] {
  if (!isObject(today) || !isObject(candidate)) {
    return sameAnswer(today, candidate) ? [] : ['value'];
  }
  const keys = new Set([...definedKeysOf(today), ...definedKeysOf(candidate)]);
  return [...keys].filter((key) => !sameAnswer(today[key], candidate[key])).toSorted();
}
