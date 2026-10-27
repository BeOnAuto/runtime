import { describe, expect, it } from 'vitest';

import { isKindWithType, kindsWithTypes, problemTypeOf, reasonOfKind } from '../index.ts';

describe('the types of problems', () => {
  it('are URIs under https://on.auto/problems/', () => {
    expect(problemTypeOf('unavailable')).toBe('https://on.auto/problems/unavailable');
  });

  it('give tools_unfinished, tools_called, effect_unknown, rebuilding and credits_exhausted types of their own, and no other kind', () => {
    expect(kindsWithTypes).toEqual([
      'tools_unfinished',
      'tools_called',
      'effect_unknown',
      'rebuilding',
      'credits_exhausted',
    ]);
    expect([
      isKindWithType('tools_unfinished'),
      isKindWithType('tools_called'),
      isKindWithType('effect_unknown'),
      isKindWithType('rebuilding'),
      isKindWithType('credits_exhausted'),
      isKindWithType('stalled'),
      isKindWithType('tool_not_offered'),
      isKindWithType('toString'),
      isKindWithType(),
    ]).toEqual([true, true, true, true, true, false, false, false, false]);
  });

  it('keep the reason of each kind with a type of its own', () => {
    expect(kindsWithTypes.map((kind) => reasonOfKind(kind))).toEqual([
      'unavailable',
      'conflict',
      'conflict',
      'unavailable',
      'conflict',
    ]);
  });
});
