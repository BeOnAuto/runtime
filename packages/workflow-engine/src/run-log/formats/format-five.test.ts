import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { stateFormats, stateInCurrentFormat } from '../../index.ts';

const CorpusStateSchema = Schema.Struct({ state: Schema.JsonObject });

const { state: stateOfFormatFive } = Schema.decodeUnknownSync(Schema.fromJsonString(CorpusStateSchema))(
  readFileSync(fileURLToPath(new URL('../../../corpus/format-5.json', import.meta.url)), 'utf8'),
);

const [, , , , formatFive] = stateFormats.older;

const cancelledState = { ...stateOfFormatFive, status: 'ended', outcome: { kind: 'cancelled' } };

describe('a state of format 5', () => {
  it('is upcast as it is, its limits naming no limit of a task', () => {
    const upcast = stateInCurrentFormat(5, stateOfFormatFive);

    expect(formatFive?.format).toBe(5);
    expect(upcast.limits).toEqual({ mostDurationMs: 2_592_000_000, longestCallMs: 600_000 });
  });

  it('is upcast from a cancelled run with a cancellation that names no one, since format 5 kept no actor or reason', () => {
    expect(stateInCurrentFormat(5, cancelledState).outcome).toEqual({
      kind: 'cancelled',
      cancel: {
        by: 'unknown',
        kind: 'requested',
        reason: 'The run was cancelled before a cancellation said who asked for it and why',
      },
    });
  });

  it('is read strictly as format 5, so a state with what format 6 added is refused', () => {
    const withCancel = {
      ...cancelledState,
      outcome: { kind: 'cancelled', cancel: { by: 'acme-admin', kind: 'requested', reason: 'No' } },
    };

    expect(() => stateInCurrentFormat(5, withCancel)).toThrow(/excess property/u);
  });
});
