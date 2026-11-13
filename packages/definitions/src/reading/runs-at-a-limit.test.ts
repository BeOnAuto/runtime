import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { RunCommand, RunResult } from '../runs/run-commands.ts';
import { runDecider, runStreamNameOf } from '../runs/run-decider.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { firstMoment, harness, toPlaybook } from '../testing/harness.ts';

const toAlpha = toPlaybook('acme', 'alpha');

const answered = '0199a3c4-7d2e-7c1a-9b3f-00000000a001';

const stopped = '0199a3c4-7d2e-7c1a-9b3f-00000000a002';

const endedAt = '2026-10-01T09:00:05.000Z';

const answeredFromWhatItHad: RunResult = {
  type: 'run_succeeded',
  data: { output: { greeting: 'Hi' }, record: {}, incomplete_details: { reason: 'max_input_tokens' } },
};

const stoppedBeforeItFinished: RunResult = {
  type: 'run_rejected',
  data: {
    rejection: {
      reason: 'conflict',
      detail: 'The run needed more tool calls than it may make',
      kind: 'effect_unknown',
      because: 'max_tool_calls',
    },
  },
};

async function playbookWithRunsEndedAtALimit() {
  const operations = definitionOperationsFor([echo]);
  const definitions = harness();
  await definitions.call(
    operations.createDefinition,
    toAlpha(acmeAdmin, { type: 'echo', name: 'greet', source: '{"greeting":"Hi"}' }),
  );
  const ended = (runId: string, result: RunResult) => {
    const stream = `playbook/acme/alpha/${runStreamNameOf(runId)}`;
    const execute = (command: RunCommand) => definitions.ledger.service.execute(stream, runDecider, command);
    const start: RunCommand = {
      type: 'start',
      definition_type: 'echo',
      name: 'greet',
      input: {},
      started_by: { id: acmeAdmin.id, name: acmeAdmin.name },
      definition_version: 1,
      calls_tools: false,
      runId,
      by: acmeAdmin.id,
      at: firstMoment,
    };
    return Effect.orDie(
      Effect.andThen(execute(start), execute({ type: 'finish', result, runId, by: acmeAdmin.id, at: endedAt })),
    );
  };
  await definitions.run(
    Effect.andThen(ended(answered, answeredFromWhatItHad), ended(stopped, stoppedBeforeItFinished)),
  );
  return { ...definitions, ...operations };
}

const ofTheRun = {
  type: 'echo',
  name: 'greet',
  definition_version: 1,
  started_at: firstMoment,
  started_by: { id: acmeAdmin.id, name: acmeAdmin.name },
  finished_at: endedAt,
};

describe('a run that ended at a limit, as get_run reads it', () => {
  it('says the limit an answer was shaped by beside the answer, and the limit a run stopped at in its rejection', async () => {
    const { call, getRun } = await playbookWithRunsEndedAtALimit();

    expect([
      await call(getRun, toAlpha(acmeAdmin, { run_id: answered })),
      await call(getRun, toAlpha(acmeAdmin, { run_id: stopped })),
    ]).toEqual([
      {
        status: 'succeeded',
        output: {
          ...ofTheRun,
          run_id: answered,
          status: 'succeeded',
          output: { greeting: 'Hi' },
          incomplete_details: { reason: 'max_input_tokens' },
          record: {},
        },
      },
      {
        status: 'succeeded',
        output: {
          ...ofTheRun,
          run_id: stopped,
          status: 'rejected',
          rejection: stoppedBeforeItFinished.data.rejection,
        },
      },
    ]);
  });
});

describe('a run that ended at a limit, as list_runs lists it', () => {
  it('lists the limit an answer was shaped by, and the because of the limit a run stopped at', async () => {
    const { call, listRuns } = await playbookWithRunsEndedAtALimit();

    expect(await call(listRuns, toAlpha(acmeAdmin))).toMatchObject({
      status: 'succeeded',
      output: {
        runs: [
          {
            ...ofTheRun,
            run_id: stopped,
            status: 'rejected',
            rejection: { reason: 'conflict', kind: 'effect_unknown', because: 'max_tool_calls' },
          },
          { ...ofTheRun, run_id: answered, status: 'succeeded', incomplete_details: { reason: 'max_input_tokens' } },
        ],
      },
    });
  });
});

describe('a run that ended at a limit, in its history', () => {
  it('says in words that the answer came from what the run had, and shows the limit in its data', async () => {
    const { call, getRunHistory } = await playbookWithRunsEndedAtALimit();

    expect(await call(getRunHistory, toAlpha(acmeAdmin, { run_id: answered, order: 'desc', limit: 1 }))).toMatchObject({
      status: 'succeeded',
      output: {
        events: [
          {
            type: 'run_succeeded',
            summary: 'A run finished with an answer from what it had, after it had read as much as a run may read.',
            data: { output: { greeting: 'Hi' }, record: {}, incomplete_details: { reason: 'max_input_tokens' } },
          },
        ],
      },
    });
  });
});
