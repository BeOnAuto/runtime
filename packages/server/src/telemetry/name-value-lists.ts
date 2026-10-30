export type NameValues = Readonly<Record<string, string>>;

type Pair = readonly [string, string];

function decoded(text: string): string | undefined {
  try {
    return decodeURIComponent(text);
  } catch {
    return undefined;
  }
}

function pairOf(item: string): Pair | undefined {
  const separator = item.indexOf('=');
  const name = item.slice(0, Math.max(separator, 0)).trim();
  const value = decoded(item.slice(separator + 1).trim());
  return name === '' || value === undefined ? undefined : [name, value];
}

export function nameValuesOf(list: string): NameValues | undefined {
  const pairs = list
    .split(',')
    .filter((item) => item.trim() !== '')
    .map((item) => pairOf(item));
  return pairs.every((pair): pair is Pair => pair !== undefined) ? Object.fromEntries(pairs) : undefined;
}
