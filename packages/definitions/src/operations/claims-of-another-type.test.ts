import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { runDecider } from '../runs/run-decider.ts';
import { acmeAdmin, recordedAdmin } from '../testing/callers.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { quietMs, resumer } from '../testing/capabilities/resumer.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { firstMoment, harness, toPlaybook } from '../testing/harness.ts';
import { acted, momentAfter, stream } from '../testing/resumed-runs.ts';
import { drivingAShell } from '../testing/shell-drives.ts';

const toAlpha = toPlaybook('acme', 'alpha');

const startOfAnEcho = {
  type: 'start',
  started_by: recordedAdmin,
  definition_type: 'echo',
  name: 'step',
  input: {},
  definition_version: 1,
  calls_tools: false,
  ...acted,
  at: firstMoment,
} as const;

describe('the next attempt of a started run of another type than the capability a shell gives', () => {
  it("is refused as run_definition refuses it, though a definition of that capability has the run's name, and records nothing", async () => {
    const resuming = resumer();
    const operations = definitionOperationsFor([resuming.capability, echo]);
    const definitions = harness();
    const created = (type: string, source: string) =>
      definitions.call(operations.createDefinition, toAlpha(acmeAdmin, { type, name: 'step', source }));
    await created('echo', '{"greeting":"hello"}');
    await created('resumer', 'resumer source');
    await definitions.run(Effect.orDie(definitions.ledger.service.execute(stream, runDecider, startOfAnEcho)));
    const drive = drivingAShell([resuming.capability, echo], resuming.capability);

    const driven = await definitions.call(drive, toAlpha(acmeAdmin, { run_id: acted.runId }), momentAfter(quietMs + 1));
    const { version } = await definitions.run(definitions.ledger.service.load(stream, runDecider));

    expect(driven).toEqual({
      status: 'rejected',
      reason: 'conflict',
      detail: 'The run id belongs to a run of another definition or with another input',
    });
    expect(version).toBe(1);
  });
});
