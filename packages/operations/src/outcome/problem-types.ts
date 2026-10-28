const problemTypes = 'https://on.auto/problems/';

const reasonsOfKinds = {
  tools_unfinished: 'unavailable',
  tools_called: 'conflict',
  effect_unknown: 'conflict',
  rebuilding: 'unavailable',
  credits_exhausted: 'conflict',
  license_required: 'conflict',
  license_invalid: 'conflict',
  account_closed: 'conflict',
  terms_required: 'conflict',
  metering_fault: 'conflict',
} as const;

export type KindWithType = keyof typeof reasonsOfKinds;

export function problemTypeOf(name: string): string {
  return `${problemTypes}${name}`;
}

export function isKindWithType(kind?: string): kind is KindWithType {
  return kind !== undefined && Object.hasOwn(reasonsOfKinds, kind);
}

export const kindsWithTypes: readonly KindWithType[] = Object.keys(reasonsOfKinds).filter((kind) =>
  isKindWithType(kind),
);

export function reasonOfKind(kind: KindWithType): (typeof reasonsOfKinds)[KindWithType] {
  return reasonsOfKinds[kind];
}
