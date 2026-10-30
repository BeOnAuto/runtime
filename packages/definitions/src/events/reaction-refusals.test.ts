import { recordedFactsBehaviour } from '@on.auto/ledger/testing';
import { presentationOf } from '@on.auto/operations';
import { memoryLedger, nothingKept } from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeDefinitionPresenters } from '../index.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { reactionRefusalDecider, ReactionRefusedSchema } from './reaction-refusals.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const prefix = 'playbook/acme/alpha/';

const refusal = {
  playbook: alpha,
  workflow: 'close-the-month',
  version: 3,
  refused: { count: 2, reason: 'Past the bound of a chain', minute: '2026-10-01T09:00:00.000Z' },
  at: '2026-10-01T09:01:00.000Z',
};

describe('a refused reaction of a workflow', () => {
  it('is recorded through its decider with the playbook as its actor and the workflow and its version as its context', async () => {
    const ledger = memoryLedger();
    const stream = 'playbook/acme/alpha/reactions/close-the-month';

    await Effect.runPromise(ledger.service.execute(stream, reactionRefusalDecider, refusal));
    const page = await Effect.runPromise(
      ledger.service.readRecorded(alpha, { kind: 'everything' }, { order: 'asc', limit: 10 }),
    );
    const rows = page.records.flatMap((record) =>
      presentationOf(makeDefinitionPresenters([echo])).present(
        { ...record, stream: record.stream.slice(prefix.length) },
        {
          streamPrefix: prefix,
          content: nothingKept,
          view: 'page',
        },
      ),
    );

    expect(page.records.map(({ type, data, context }) => ({ type, data, context }))).toEqual([
      {
        type: 'reaction_refused',
        data: refusal.refused,
        context: {
          at: refusal.at,
          by: 'playbook:alpha',
          definitionType: 'workflow',
          definitionName: 'close-the-month',
          definitionVersion: 3,
        },
      },
    ]);
    expect(rows).toMatchObject([
      { type: 'reaction_refused', metadata: { definition: { type: 'workflow', name: 'close-the-month', version: 3 } } },
    ]);
  });
});

describe('the facts of the reactions a playbook refused', () => {
  recordedFactsBehaviour({
    schema: ReactionRefusedSchema,
    folder: new URL('.', import.meta.url),
    releases: {
      '0.46.0': [
        {
          type: 'reaction_refused',
          data: { count: 4, reason: 'The workflow started 60 runs this minute', minute: '2026-10-29T10:00' },
          context: {
            at: '2026-10-29T10:00:30.000Z',
            by: 'playbook:sales',
            definitionType: 'workflow',
            definitionName: 'close-the-month',
            definitionVersion: 3,
          },
        },
      ],
    },
  });
});
