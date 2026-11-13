import type { PlaybookRequest } from '@on.auto/operations';
import { PayloadOffloading } from '@on.auto/operations/payloads';
import { Effect, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { acmeAdmin } from '../testing/callers.ts';
import { prompted } from '../testing/capabilities/prompted.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { harness, toPlaybook, type Harness } from '../testing/harness.ts';
import { keptArmOf, watchedStore } from '../testing/kept-payloads.ts';
import { admittingMeter } from '../testing/recording-meter.ts';

const { createDefinition, runDefinition } = definitionOperationsFor([prompted]);

const toAlpha = toPlaybook('acme', 'alpha');

const alpha = { org: 'acme', playbook: 'alpha' };

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const prompt = { message: 'm'.repeat(17_000), truncated: false };

const promptKept = keptArmOf(prompt);

async function asking() {
  const watched = watchedStore();
  const definitions = harness(admittingMeter, watched.store);
  await definitions.call(
    createDefinition,
    toAlpha(acmeAdmin, { type: 'prompted', name: 'ask', source: '{"greeting": "Hi"}' }),
  );
  return { definitions, watched };
}

function keepingOutside(definitions: Harness, request: PlaybookRequest) {
  return definitions.run(
    definitions.dispatch(runDefinition, request).pipe(Effect.provideService(PayloadOffloading, true)),
  );
}

function askedWith(record: Schema.JsonObject, answer: Schema.Json = null) {
  return toAlpha(acmeAdmin, { type: 'prompted', name: 'ask', input: { record, answer }, run_id: runId });
}

async function recordsOf(definitions: Harness) {
  const { records } = await Effect.runPromise(
    definitions.ledger.service.readRecorded(alpha, { kind: 'run', run: runId }, { order: 'asc', limit: 10 }),
  );
  return records;
}

async function endingOf(definitions: Harness) {
  const ending = (await recordsOf(definitions)).find(({ type }) => type === 'run_succeeded');
  return ending === undefined ? undefined : { type: ending.type, data: ending.data };
}

async function storedTextOfTheEnding(definitions: Harness) {
  return JSON.stringify((await endingOf(definitions))?.data);
}

const storedAsBefore = JSON.stringify({
  output: { greeting: 'Hi', answer: null },
  record: { greeting: 'Hi', model: 'm', prompt, duration_ms: 12 },
});

describe('a prompt past 16,384 bytes in the record of a run that succeeded, while the runtime reads a prompt kept by digest and keeps none', () => {
  it('stays in the record, member for member, where its playbook keeps large values outside, and nothing is read', async () => {
    const { definitions, watched } = await asking();

    await keepingOutside(definitions, askedWith({ model: 'm', prompt, duration_ms: 12 }));

    expect(await storedTextOfTheEnding(definitions)).toBe(storedAsBefore);
    expect(watched.reads()).toBe(0);
  });

  it('stays in the record while the switch is off, as the release before wrote it, member for member, and nothing is read', async () => {
    const { definitions, watched } = await asking();

    await definitions.call(runDefinition, askedWith({ model: 'm', prompt, duration_ms: 12 }));

    expect(await storedTextOfTheEnding(definitions)).toBe(storedAsBefore);
    expect(watched.reads()).toBe(0);
  });

  it('leaves a record with no prompt as it is', async () => {
    const { definitions } = await asking();

    await keepingOutside(
      definitions,
      toAlpha(acmeAdmin, { type: 'prompted', name: 'ask', input: 'Ada', run_id: runId }),
    );

    expect(await endingOf(definitions)).toEqual({
      type: 'run_succeeded',
      data: { output: { greeting: 'Hi', answer: null }, record: { greeting: 'Hi' } },
    });
  });
});

describe('a record a capability answers with that names a prompt by a digest', () => {
  it('breaks the run down, recorded, and appends no fact that names content the playbook does not keep', async () => {
    const { definitions } = await asking();
    const named = { prompt_sha256: promptKept.sha256, prompt_bytes: promptKept.bytes };

    expect(await keepingOutside(definitions, askedWith(named))).toMatchObject({ status: 'failed' });
    expect((await recordsOf(definitions)).map(({ type }) => type)).toEqual(['run_started', 'run_failed']);
  });
});
