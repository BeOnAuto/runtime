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

const { createDefinition, runDefinition, getRun } = definitionOperationsFor([prompted]);

const toAlpha = toPlaybook('acme', 'alpha');

const alpha = { org: 'acme', playbook: 'alpha' };

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const twoHoursLater = '2026-10-01T11:00:00.000Z';

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

function readOf({ definitions }: { readonly definitions: Harness }) {
  return definitions.call(getRun, toAlpha(acmeAdmin, { run_id: runId }));
}

async function storedTextOfTheEnding(definitions: Harness) {
  return JSON.stringify((await endingOf(definitions))?.data);
}

describe('a run whose record holds a prompt past 16,384 bytes, where its playbook keeps large values outside its runs', () => {
  it('keeps the prompt once, before the fact that names it, in the place of the prompt in its record, holds it, and answers with the prompt in hand', async () => {
    const { definitions, watched } = await asking();

    const answered = await keepingOutside(definitions, askedWith({ model: 'm', prompt }));

    expect(answered).toMatchObject({
      status: 'succeeded',
      output: { status: 'succeeded', record: { greeting: 'Hi', model: 'm', prompt } },
    });
    expect(answered).not.toHaveProperty('output.record.prompt_sha256');
    expect(await storedTextOfTheEnding(definitions)).toBe(
      JSON.stringify({
        output: { greeting: 'Hi', answer: null },
        record: { greeting: 'Hi', model: 'm', prompt_sha256: promptKept.sha256, prompt_bytes: promptKept.bytes },
      }),
    );
    expect(watched.reads()).toBe(0);
    expect(
      await definitions.run(definitions.ledger.service.removeUnheld(alpha, promptKept.sha256), twoHoursLater),
    ).toBe('held');
  });

  it('keeps its output and its prompt each once where both are past it, and answers with both in hand', async () => {
    const { definitions, watched } = await asking();
    const answer = 'a'.repeat(17_000);
    const outputKept = keptArmOf({ greeting: 'Hi', answer });

    expect(await keepingOutside(definitions, askedWith({ prompt }, answer))).toMatchObject({
      status: 'succeeded',
      output: { output: { greeting: 'Hi', answer }, record: { greeting: 'Hi', prompt } },
    });
    expect(await endingOf(definitions)).toEqual({
      type: 'run_succeeded',
      data: {
        output_sha256: outputKept.sha256,
        output_bytes: outputKept.bytes,
        record: { greeting: 'Hi', prompt_sha256: promptKept.sha256, prompt_bytes: promptKept.bytes },
      },
    });
    expect(watched.reads()).toBe(0);
  });
});

describe('a prompt past 16,384 bytes of a run whose playbook keeps large values outside its runs', () => {
  it('is kept by the size of its text, whatever JSON value it is and whatever kind of run recorded it', async () => {
    const { definitions } = await asking();
    const text = 't'.repeat(17_000);

    await keepingOutside(definitions, askedWith({ prompt: text }));

    expect(await endingOf(definitions)).toMatchObject({
      data: { record: { prompt_sha256: keptArmOf(text).sha256, prompt_bytes: 17_002 } },
    });
  });

  it('is answered by get_run, read once, as the run would be answered had the prompt been kept in its record', async () => {
    const [outside, inline] = [await asking(), await asking()];
    await keepingOutside(outside.definitions, askedWith({ model: 'm', prompt }));
    await inline.definitions.call(runDefinition, askedWith({ model: 'm', prompt }));

    expect(await readOf(outside)).toEqual(await readOf(inline));
    expect(outside.watched.reads()).toBe(1);
  });
});

describe('a prompt kept in its record: within 16,384 bytes, or with the switch off', () => {
  it('stays in the record at 16,384 bytes, and is kept outside a byte longer', async () => {
    const [within, past] = [await asking(), await asking()];
    const [atTheThreshold, aByteOver] = ['w'.repeat(16_382), 'w'.repeat(16_383)];

    await keepingOutside(within.definitions, askedWith({ prompt: atTheThreshold }));
    await keepingOutside(past.definitions, askedWith({ prompt: aByteOver }));

    expect([await endingOf(within.definitions), await endingOf(past.definitions)]).toMatchObject([
      { data: { record: { prompt: atTheThreshold } } },
      { data: { record: { prompt_sha256: keptArmOf(aByteOver).sha256, prompt_bytes: 16_385 } } },
    ]);
  });

  it('stays in the record while the switch is off, as the release before wrote it, member for member, and nothing is read', async () => {
    const { definitions, watched } = await asking();

    await definitions.call(runDefinition, askedWith({ model: 'm', prompt, duration_ms: 12 }));

    expect(await storedTextOfTheEnding(definitions)).toBe(
      JSON.stringify({
        output: { greeting: 'Hi', answer: null },
        record: { greeting: 'Hi', model: 'm', prompt, duration_ms: 12 },
      }),
    );
    expect(watched.reads()).toBe(0);
  });
});

describe('a prompt the store of its content does not take, and a record with none', () => {
  it('stays in the record, member for member, and the run ends, while the store takes no value', async () => {
    const { definitions, watched } = await asking();
    watched.failPuts();

    expect(await keepingOutside(definitions, askedWith({ model: 'm', prompt, duration_ms: 12 }))).toMatchObject({
      status: 'succeeded',
      output: { status: 'succeeded' },
    });
    expect(await storedTextOfTheEnding(definitions)).toBe(
      JSON.stringify({
        output: { greeting: 'Hi', answer: null },
        record: { greeting: 'Hi', model: 'm', prompt, duration_ms: 12 },
      }),
    );
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
