import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { modelCallAnswered, modelCallSent, modelCallTimedOut } from '../journal-testing/model-calls.ts';
import { idAt, journalled, linksIn } from '../journal-testing/run-links.ts';
import type { ModelCallFact } from '../runs/run-commands.ts';
import { answerOfCall, startOfCall } from '../testing/capabilities/tool-user.ts';
import { harness } from '../testing/harness.ts';

function modelCalled(number: number): ModelCallFact {
  return { type: 'model_call_started', data: { number, ...modelCallSent() } };
}

const takenSecond: unknown = expect.objectContaining({ _tag: 'conflict', kind: 'taken' });

describe('the journal of a run that calls its model', () => {
  it('links each model call to the answer before it and its answer or failure to it, a tool call asked for to that answer, and the finish to the last', async () => {
    const definitions = harness();
    const recorded = await journalled(definitions, (journal) =>
      Effect.orDie(
        Effect.all([
          journal.record(modelCalled(1)),
          journal.record({ type: 'model_call_answered', data: { number: 1, ...modelCallAnswered() } }),
          journal.started(startOfCall(1)),
          journal.ended(1, answerOfCall(1)),
          journal.record(modelCalled(2)),
          Effect.flip(journal.record(modelCalled(2))),
          journal.record({ type: 'model_call_failed', data: { number: 2, ...modelCallTimedOut } }),
          journal.latest,
        ]),
      ),
    );

    expect(recorded).toEqual([1, 1, 1, true, 2, takenSecond, 2, idAt(7)]);
    expect((await linksIn(definitions)).map(({ type, causationId }) => [type, causationId])).toEqual([
      ['run_started', null],
      ['model_call_started', idAt(1)],
      ['model_call_answered', idAt(2)],
      ['tool_call_started', idAt(3)],
      ['tool_call_answered', idAt(4)],
      ['model_call_started', idAt(5)],
      ['model_call_failed', idAt(6)],
    ]);
  });
});
