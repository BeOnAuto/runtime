import { NotFound } from '@on.auto/operations';
import { Effect, Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { echo } from '../testing/capabilities/echo.ts';
import { probe } from '../testing/capabilities/probe.ts';
import { knownCapabilities } from './known-capabilities.ts';

const known = knownCapabilities([echo, probe().capability]);

const decodeType = Schema.decodeUnknownResult(known.field);

function refusalOf(input: unknown): string {
  return Result.match(decodeType(input), { onFailure: String, onSuccess: () => 'accepted' });
}

describe('the type field of the definition operations', () => {
  it('takes a type a capability of the server serves', () => {
    expect([refusalOf('echo'), refusalOf('probe')]).toEqual(['accepted', 'accepted']);
  });

  it('refuses a type no capability serves by naming the types the server runs, and a malformed one by its shape alone', () => {
    expect([refusalOf('prediction'), refusalOf('Echo!')]).toEqual([
      'SchemaError(Expected a type this server runs: echo or probe)',
      'SchemaError(Expected a type: 3 to 32 lowercase letters, digits and hyphens, starting with a letter)',
    ]);
  });
});

describe('the capability of a type', () => {
  it('is the capability that serves it, and not found for a type none serves', () => {
    expect(Effect.runSync(known.capabilityOfType('echo'))).toBe(echo);
    expect(Effect.runSync(Effect.flip(known.capabilityOfType('prediction')))).toEqual(
      new NotFound({ detail: 'There is no definition type prediction' }),
    );
  });
});
