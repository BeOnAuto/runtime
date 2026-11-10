import { playbookCallerOf } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineStartVersion } from '../index.ts';
import { acmeAdmin, recordedAdmin } from '../testing/callers.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { firstMoment, harness, toPlaybook } from '../testing/harness.ts';
import { keptArmOf, keptIn, recordedAsGiven, watchedStore } from '../testing/kept-payloads.ts';
import { admittingMeter } from '../testing/recording-meter.ts';

const { createDefinition } = definitionOperationsFor([echo]);

const startVersion = defineStartVersion([echo]);

const toAlpha = toPlaybook('acme', 'alpha');

const alpha = { org: 'acme', playbook: 'alpha' };

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const input = { who: 'Ada', notes: 'n'.repeat(3000) };

const kept = keptArmOf(input);

const onTheRun = { runId, by: 'acme-admin', at: firstMoment, definitionType: 'echo', definitionName: 'greet' };

async function endedUnworkedWithAKeptInput() {
  const watched = watchedStore();
  const definitions = harness(admittingMeter, watched.store);
  await definitions.call(
    createDefinition,
    toAlpha(acmeAdmin, { type: 'echo', name: 'greet', source: '{"greeting": "Hi"}' }),
  );
  const { service } = definitions.ledger;
  await Effect.runPromise(keptIn(service.content, alpha, input));
  await Effect.runPromise(
    recordedAsGiven(
      service,
      `playbook/acme/alpha/runs/${runId}`,
      [
        {
          type: 'run_started',
          data: { input_sha256: kept.sha256, input_bytes: kept.bytes, started_by: recordedAdmin },
        },
        { type: 'run_rejected', data: { rejection: { reason: 'unavailable', detail: 'Busy' } } },
      ],
      { ...onTheRun, definitionVersion: 1 },
    ),
  );
  return { definitions, watched };
}

function startedOnceWith(given: object) {
  return toAlpha(playbookCallerOf(alpha), { type: 'echo', name: 'greet', version: 1, input: given, run_id: runId });
}

describe('a start made once of a run that ended unworked with an input its playbook keeps outside it', () => {
  it('reads the recorded input only once the decider cannot tell, and starts again for the same input in another order', async () => {
    const { definitions, watched } = await endedUnworkedWithAKeptInput();
    const reordered = { notes: input.notes, who: input.who };

    expect(await definitions.call(startVersion, startedOnceWith(reordered))).toMatchObject({
      status: 'succeeded',
      output: { status: 'succeeded', output: { greeting: 'Hi', input: reordered } },
    });
    expect(watched.reads()).toBe(1);
  });

  it('reads nothing where the text is the same, the digest telling it', async () => {
    const { definitions, watched } = await endedUnworkedWithAKeptInput();

    expect(await definitions.call(startVersion, startedOnceWith(input))).toMatchObject({ status: 'succeeded' });
    expect(watched.reads()).toBe(0);
  });

  it('loads the stream of the run only where the decider cannot tell, so a start it can tell loads none', async () => {
    const told = await endedUnworkedWithAKeptInput();
    const untold = await endedUnworkedWithAKeptInput();
    const loadOfTheRun = { loaded: `playbook/acme/alpha/runs/${runId}` };

    await told.definitions.call(startVersion, startedOnceWith(input));
    await untold.definitions.call(startVersion, startedOnceWith({ notes: input.notes, who: input.who }));

    expect(told.definitions.ledgerReads()).not.toContainEqual(loadOfTheRun);
    expect(untold.definitions.ledgerReads()).toContainEqual(loadOfTheRun);
  });
});
