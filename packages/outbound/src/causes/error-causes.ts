import { Predicate } from 'effect';

const mostCauses = 8;

export function causesOf(error: unknown): readonly object[] {
  const causes: object[] = [];
  let current: unknown = error;
  while (causes.length < mostCauses && Predicate.isObject(current)) {
    causes.push(current);
    current = current['cause'];
  }
  return causes;
}

export function codesOf(error: unknown): readonly unknown[] {
  return causesOf(error).map((cause) => (Predicate.hasProperty(cause, 'code') ? cause.code : undefined));
}
