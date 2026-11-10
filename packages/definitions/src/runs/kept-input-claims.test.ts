import { Result, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { comparedWithoutItsValue } from '../payloads/payload-comparisons.ts';
import { recordedAdmin } from '../testing/callers.ts';
import { keptArmOf } from '../testing/kept-payloads.ts';
import { recordedWith, runStateAfter, testRunId } from '../testing/run-facts.ts';
import { claimOf, takesAStartOnce } from './run-claims.ts';
import { runDecider } from './run-decider.ts';
import type { RunEvent } from './run-events.ts';
import { startedRunOf } from './run-state.ts';

const at = { runId: testRunId, by: 'acme-admin', at: '2026-10-01T09:00:00.000Z' };

const recorded = recordedWith({ ...at, definitionType: 'echo', definitionName: 'score', definitionVersion: 1 });

const leads = { region: 'emea', leads: Array.from({ length: 80 }, (_, index) => `lead-${index}`) };

const reordered = { leads: leads.leads, region: 'emea' };

const kept = keptArmOf(leads);

const startedKept: RunEvent = {
  type: 'run_started',
  data: { input_sha256: kept.sha256, input_bytes: kept.bytes, started_by: recordedAdmin },
};

const rejected: RunEvent = { type: 'run_rejected', data: { rejection: { reason: 'unavailable', detail: 'Busy' } } };

function stateAfter(...events: readonly RunEvent[]) {
  return runStateAfter(events.map((event) => recorded(event)));
}

function asked(input: Schema.Json) {
  return { definition_type: 'echo', name: 'score', input: { inline: input } };
}

const request = { definition_type: 'echo', name: 'score' };

function createdOnlyWith(input: Schema.Json) {
  const start = { type: 'start', ...request, input, started_by: recordedAdmin, calls_tools: false } as const;
  return { ...start, definition_version: 1, createOnly: true, ...at } as const;
}

describe('a run whose input its playbook keeps outside the run', () => {
  it('holds its input by its digest and size in its state, unread', () => {
    expect(startedRunOf(stateAfter(startedKept))?.input).toEqual({ kept });
  });

  it('is claimed by a request with the same text, and answers unavailable for the same input in another order', () => {
    const state = stateAfter(startedKept);

    expect([
      Result.isSuccess(claimOf(state, asked(leads))),
      claimOf(state, asked(reordered)),
      claimOf(state, { ...asked(leads), name: 'other' }),
    ]).toMatchObject([
      true,
      Result.fail(comparedWithoutItsValue),
      {
        failure: {
          _tag: 'conflict',
          detail: 'The run id belongs to a run of another definition or with another input',
        },
      },
    ]);
  });
});

describe('a run whose input its playbook keeps outside the run, given what its operation read or kept', () => {
  it('is told the same as a request in another order, or another, by the input its operation read', () => {
    const state = stateAfter(startedKept);
    const valuesRead = new Map([[kept.sha256, leads]]);
    const readOfAnother = new Map([[keptArmOf({ region: 'apac' }).sha256, { region: 'apac' }]]);

    expect([
      Result.isSuccess(claimOf(state, { ...asked(reordered), valuesRead })),
      claimOf(state, { ...asked({ region: 'apac' }), valuesRead }),
      claimOf(state, { ...asked(reordered), valuesRead: readOfAnother }),
    ]).toMatchObject([true, { failure: { _tag: 'conflict' } }, Result.fail(comparedWithoutItsValue)]);
  });

  it('starts with its input kept outside where the start names the digest it was kept by', () => {
    const start = { type: 'start', ...request, input: leads, inputKept: kept, started_by: recordedAdmin } as const;

    expect(
      runDecider.decide({ ...start, calls_tools: false, definition_version: 1, ...at }, runDecider.initialState),
    ).toMatchObject(
      Result.succeed([{ type: 'run_started', data: { input_sha256: kept.sha256, input_bytes: kept.bytes } }]),
    );
  });

  it('starts once more with the same text after it ended unworked, and answers unavailable for other text', () => {
    const ended = stateAfter(startedKept, rejected);

    expect([
      takesAStartOnce(startedRunOf(ended), { ...request, input: leads }),
      takesAStartOnce(startedRunOf(ended), { ...request, input: reordered }),
      runDecider.decide(createdOnlyWith(reordered), ended),
    ]).toEqual([Result.succeed(false), Result.fail(comparedWithoutItsValue), Result.fail(comparedWithoutItsValue)]);
  });
});
