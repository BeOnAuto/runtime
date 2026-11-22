import { describe, expect, inject, it } from 'vitest';

import { handlerProbes } from './handler-probes.ts';

describe('the compiler', () => {
  const errors = inject('compiledProbes')['handler-rules'] ?? [];
  const { rejected } = handlerProbes;

  it('accepts every definition that keeps the rules and rejects every one that breaks them', () => {
    expect(new Set(errors.map((error) => error.slice(0, error.indexOf('('))))).toEqual(new Set(Object.keys(rejected)));
  });

  it.each(Object.entries(rejected))('rejects %s for the rule it breaks', (file, { because }) => {
    expect(errors.filter((error) => error.startsWith(`${file}(`)).join('\n')).toContain(because);
  });
});
