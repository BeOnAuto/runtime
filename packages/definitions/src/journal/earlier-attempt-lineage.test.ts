import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { idAt, journalled, linksIn } from '../journal-testing/run-links.ts';
import { runDecider, runStreamNameOf } from '../runs/run-decider.ts';
import { answerOfCall, startOfCall } from '../testing/capabilities/tool-user.ts';
import { harness } from '../testing/harness.ts';
import { testRunId as runId } from '../testing/run-facts.ts';

describe('the journal of an attempt, given the end of a call an attempt before it started', () => {
  it('links the end to where its attempt began, knowing no start of the call', async () => {
    const definitions = harness();
    const startedBefore = definitions.ledger.service.execute(
      `playbook/acme/alpha/${runStreamNameOf(runId)}`,
      runDecider,
      {
        type: 'call',
        fact: { type: 'tool_call_started', data: startOfCall(1) },
        runId,
        by: 'acme-admin',
        at: '2026-10-01T09:00:01.000Z',
      },
    );

    expect(
      await journalled(definitions, (journal) =>
        Effect.andThen(Effect.orDie(startedBefore), journal.ended(1, answerOfCall(1))),
      ),
    ).toBe(true);
    expect((await linksIn(definitions)).at(-1)).toEqual({
      type: 'tool_call_answered',
      id: idAt(3),
      causationId: idAt(1),
      correlationId: runId,
    });
  });
});
