const problemTypes = 'https://on.auto/problems/';

const reasonsOfKinds = {
  tools_unfinished: 'unavailable',
  tools_called: 'conflict',
  effect_unknown: 'conflict',
  rebuilding: 'unavailable',
  credits_exhausted: 'conflict',
} as const;

export type KindWithType = keyof typeof reasonsOfKinds;

export const kindsWithTypes: readonly KindWithType[] = [
  'tools_unfinished',
  'tools_called',
  'effect_unknown',
  'rebuilding',
  'credits_exhausted',
];

export function problemTypeOf(name: string): string {
  return `${problemTypes}${name}`;
}

export function isKindWithType(kind?: string): kind is KindWithType {
  return kind !== undefined && Object.hasOwn(reasonsOfKinds, kind);
}

export function reasonOfKind(kind: KindWithType): (typeof reasonsOfKinds)[KindWithType] {
  return reasonsOfKinds[kind];
}
