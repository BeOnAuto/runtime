import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { ModelRuntimeSchema, type ModelRuntime } from './model-runtime.ts';

const runtime: ModelRuntime = {
  name: 'example-runtime',
  version: '1.2.3',
  formats: ['example', 'example-2'],
  capabilities: { features: true, given: false, totals: true },
  binding: { kind: 'process', module: () => new URL('file:///models/example-models.js') },
};

const decoded = Schema.decodeUnknownResult(ModelRuntimeSchema);

function refusalOf(value: unknown): string {
  const result = decoded(value);
  return Result.isFailure(result) ? result.failure.message : '';
}

const refusals: readonly (readonly [string, unknown, string])[] = [
  ['a format that is not lower case', { ...runtime, formats: ['Example'] }, 'Expected a format'],
  ['no format', { ...runtime, formats: [] }, 'Expected a value with a length of at least 1'],
  ['an empty name', { ...runtime, name: '' }, 'Expected a value with a length of at least 1'],
  [
    'a capability that is not a flag',
    { ...runtime, capabilities: { ...runtime.capabilities, given: 'yes' } },
    'boolean',
  ],
  [
    'a binding of another kind',
    { ...runtime, binding: { kind: 'remote', url: 'https://models.example.com' } },
    'process',
  ],
  [
    'a module that is not a function',
    { ...runtime, binding: { kind: 'process', module: 'file:///m.js' } },
    'a function',
  ],
];

describe('a model runtime', () => {
  it('names itself, its version, the formats it executes, what it takes and the module a model process loads', () => {
    expect(Result.isSuccess(decoded(runtime))).toBe(true);
  });

  it.each(refusals)('is refused with %s', (_case, value, words) => {
    expect(refusalOf(value)).toContain(words);
  });
});
