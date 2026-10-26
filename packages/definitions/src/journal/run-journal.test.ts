import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import type { RunCommand } from '../runs/run-commands.ts';
import { runDecider, runStreamNameOf } from '../runs/run-decider.ts';
import { acmeAdmin, recordedAdmin } from '../testing/callers.ts';
import { startOfCall, toolUser } from '../testing/capabilities/tool-user.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { harness, toPlaybook } from '../testing/harness.ts';

const toAlpha = toPlaybook('acme', 'alpha');

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const at = { runId, by: 'acme-admin', at: '2026-10-01T09:00:00.000Z' };

const typesOf = Schema.decodeUnknownSync(
  Schema.Struct({ output: Schema.Struct({ events: Schema.Array(Schema.Struct({ type: Schema.String })) }) }),
);

async function playbookWithToolUser() {
  const user = toolUser();
  const operations = definitionOperationsFor([user.capability]);
  const definitions = harness();
  await definitions.call(
    operations.createDefinition,
    toAlpha(acmeAdmin, { type: 'tool-user', name: 'caller', source: 'x' }),
  );
  const running = (input: object) =>
    definitions.call(
      operations.runDefinition,
      toAlpha(acmeAdmin, { type: 'tool-user', name: 'caller', input, run_id: runId }),
    );
  const history = async () =>
    typesOf(
      await definitions.call(operations.getRunHistory, toAlpha(acmeAdmin, { run_id: runId, limit: 100 })),
    ).output.events.map(({ type }) => type);
  const recordedDirectly = (...commands: readonly RunCommand[]) =>
    definitions.run(
      Effect.forEach(commands, (command) =>
        Effect.orDie(
          definitions.ledger.service.execute(`playbook/acme/alpha/${runStreamNameOf(runId)}`, runDecider, command),
        ),
      ),
    );
  return { ...definitions, ...operations, user, running, history, recordedDirectly };
}

const calls = (count: number, type: string): readonly string[] => Array.from({ length: count }, () => type);

describe('the journal of a run', () => {
  it('records ten calls made at once, one append at a time, each start before its answer', async () => {
    const { running, history, user } = await playbookWithToolUser();

    expect(await running({ calls: 10 })).toMatchObject({
      status: 'succeeded',
      output: { output: { recorded: Array.from({ length: 20 }, () => true) } },
    });
    expect(await history()).toEqual([
      'run_started',
      ...calls(10, 'tool_call_started'),
      ...calls(10, 'tool_call_answered'),
      'run_succeeded',
    ]);
    expect(user.capability.describeOutput({ recorded: [] })).toBe('It called its tools.');
  });

  it('numbers the calls made at once in the order their starts land, each from the run, never twice', async () => {
    const { call, running, getRunHistory } = await playbookWithToolUser();
    await running({ calls: 10 });

    const read = await call(getRunHistory, toAlpha(acmeAdmin, { run_id: runId, limit: 100 }));
    const { events } = Schema.decodeUnknownSync(
      Schema.Struct({
        output: Schema.Struct({
          events: Schema.Array(
            Schema.Struct({ type: Schema.String, data: Schema.Struct({ number: Schema.optionalKey(Schema.Int) }) }),
          ),
        }),
      }),
    )(read).output;

    expect(events.filter(({ type }) => type === 'tool_call_started').map(({ data }) => data.number)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
  });
});

describe('the journal of a run whose calls failed', () => {
  it('records how each call failed after its start', async () => {
    const { running, history } = await playbookWithToolUser();
    await running({ calls: 1, failing: true });

    expect(await history()).toEqual(['run_started', 'tool_call_started', 'tool_call_failed', 'run_succeeded']);
  });
});

describe('the journal of a run that has finished', () => {
  it('records nothing more', async () => {
    const { running, history, user } = await playbookWithToolUser();
    await running({ calls: 1 });

    expect(await user.recordedLate()).toEqual([false]);
    expect(await user.startedLate()).toEqual([undefined]);
    expect(await history()).toEqual(['run_started', 'tool_call_started', 'tool_call_answered', 'run_succeeded']);
  });

  it('leaves a call in flight when the run is cancelled with a start and no answer', async () => {
    const { callCancelledWhen, runDefinition, history, user } = await playbookWithToolUser();
    const request = toAlpha(acmeAdmin, {
      type: 'tool-user',
      name: 'caller',
      input: { calls: 1, ending: 'stall' },
      run_id: runId,
    });

    expect(await callCancelledWhen(user.stalled, runDefinition, request)).toEqual({ status: 'cancelled' });
    expect(await user.recordedLate()).toEqual([false]);
    expect(await history()).toEqual(['run_started', 'tool_call_started', 'run_failed']);
  });
});

describe('a run that called tools', () => {
  it.each(['unavailable', 'conflict'])(
    'is not run again under its id after it ended %s, and says to start a new run',
    async (ending) => {
      const { running, user } = await playbookWithToolUser();
      await running({ calls: 1, ending });

      expect(await running({ calls: 1, ending })).toMatchObject({
        status: 'rejected',
        reason: 'conflict',
        kind: 'tools_called',
      });
      expect(await user.recordedLate()).toEqual([false]);
    },
  );

  it('is answered again when it succeeded', async () => {
    const { running, user } = await playbookWithToolUser();
    const first = await running({ calls: 2 });

    expect(await running({ calls: 2 })).toEqual(first);
    expect(await user.recordedLate()).toEqual([false]);
  });

  it('left started by a server that died stays started, is listed as running, and is not run again', async () => {
    const { call, running, getRun, listRuns, recordedDirectly } = await playbookWithToolUser();
    await recordedDirectly(
      {
        type: 'start',
        started_by: recordedAdmin,
        definition_type: 'tool-user',
        name: 'caller',
        input: {},
        definition_version: 1,
        calls_tools: true,
        ...at,
      },
      { type: 'call', fact: { type: 'tool_call_started', data: startOfCall(1) }, ...at },
    );

    expect(await running({})).toMatchObject({ status: 'rejected', reason: 'conflict', kind: 'tools_called' });
    expect(await call(getRun, toAlpha(acmeAdmin, { run_id: runId }))).toMatchObject({
      output: { status: 'started' },
    });
    expect(await call(listRuns, toAlpha(acmeAdmin, { status: 'started' }))).toMatchObject({
      output: { runs: [{ run_id: runId, status: 'started' }] },
    });
  });
});

describe('a run of a definition that calls tools, still in progress', () => {
  it('is not run again under its id while an earlier call still runs it, before any tool was called', async () => {
    const { callCancelledWhen, runDefinition, running, history, user } = await playbookWithToolUser();
    const first = toAlpha(acmeAdmin, {
      type: 'tool-user',
      name: 'caller',
      input: { calls: 0, ending: 'stall' },
      run_id: runId,
    });
    const retried = user.stalled.then(() => running({ calls: 0, ending: 'stall' }));

    expect(await callCancelledWhen(retried, runDefinition, first)).toEqual({ status: 'cancelled' });
    expect(await retried).toMatchObject({ status: 'rejected', reason: 'conflict', kind: 'tools_called' });
    expect(await history()).toEqual(['run_started', 'run_failed']);
  });
});
