import type { PlaybookRequest } from '@on.auto/operations';
import { PayloadOffloading } from '@on.auto/operations/payloads';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { acmeAdmin, recordedAdmin } from '../testing/callers.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { harness, toPlaybook, type Harness } from '../testing/harness.ts';
import { keptArmOf, watchedStore } from '../testing/kept-payloads.ts';
import { admittingMeter, recordingMeter } from '../testing/recording-meter.ts';

const { createDefinition, runDefinition, getRunHistory } = definitionOperationsFor([echo]);

const toAlpha = toPlaybook('acme', 'alpha');

const alpha = { org: 'acme', playbook: 'alpha' };

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const input = { who: 'Ada', notes: 'n'.repeat(17_000) };

const output = { greeting: 'Hi', input };

const tenKiB = { who: 'Ada', notes: 'n'.repeat(10_240) };

async function greeting() {
  const watched = watchedStore();
  const definitions = harness(admittingMeter, watched.store);
  await definitions.call(
    createDefinition,
    toAlpha(acmeAdmin, { type: 'echo', name: 'greet', source: '{"greeting": "Hi"}' }),
  );
  return { definitions, watched };
}

function keepingOutside(definitions: Harness, request: PlaybookRequest, at?: string) {
  return definitions.run(
    definitions.dispatch(runDefinition, request).pipe(Effect.provideService(PayloadOffloading, true)),
    at,
  );
}

const twoHoursLater = '2026-10-01T11:00:00.000Z';

function ranWith(given: object) {
  return toAlpha(acmeAdmin, { type: 'echo', name: 'greet', input: given, run_id: runId });
}

async function recordsOf(definitions: Harness) {
  const { records } = await Effect.runPromise(
    definitions.ledger.service.readRecorded(alpha, { kind: 'run', run: runId }, { order: 'asc', limit: 10 }),
  );
  return records;
}

async function factsOf(definitions: Harness) {
  return (await recordsOf(definitions)).map(({ type, data }) => ({ type, data }));
}

function historyOf(definitions: Harness) {
  return definitions.call(getRunHistory, toAlpha(acmeAdmin, { run_id: runId }));
}

async function dataOf(definitions: Harness) {
  return (await recordsOf(definitions)).map(({ data }) => data);
}

describe('a run whose playbook keeps large values outside its runs', () => {
  it('keeps its input and its output once each, before the fact that names it, and answers with its output in hand', async () => {
    const { definitions, watched } = await greeting();
    const [inputKept, outputKept] = [keptArmOf(input), keptArmOf(output)];

    expect(await keepingOutside(definitions, ranWith(input))).toMatchObject({
      status: 'succeeded',
      output: { run_id: runId, status: 'succeeded', output },
    });
    expect(await factsOf(definitions)).toEqual([
      {
        type: 'run_started',
        data: { input_sha256: inputKept.sha256, input_bytes: inputKept.bytes, started_by: recordedAdmin },
      },
      {
        type: 'run_succeeded',
        data: { output_sha256: outputKept.sha256, output_bytes: outputKept.bytes, record: { greeting: 'Hi' } },
      },
    ]);
    expect(watched.reads()).toBe(0);
  });

  it('keeps its input before the meter is asked, so a run the meter refuses leaves content held by nothing, not a charge with no run', async () => {
    const meter = recordingMeter();
    const definitions = harness(meter.layer, watchedStore().store);
    await definitions.call(
      createDefinition,
      toAlpha(acmeAdmin, { type: 'echo', name: 'greet', source: '{"greeting": "Hi"}' }),
    );
    meter.refuseNext('credits_exhausted');

    expect(await keepingOutside(definitions, ranWith(input))).toMatchObject({ status: 'rejected', reason: 'conflict' });
    expect(
      await Effect.runPromise(definitions.ledger.service.content.getHead(alpha, keptArmOf(input).sha256)),
    ).toMatchObject({ bytes: keptArmOf(input).bytes });
    expect(await factsOf(definitions)).toEqual([]);
  });
});

describe('a run that keeps nothing outside its record: a small input, the switch off, a store that takes nothing', () => {
  it('keeps a small input in the fact as before', async () => {
    const { definitions } = await greeting();

    await keepingOutside(definitions, ranWith({ who: 'Ada' }));

    expect(await dataOf(definitions)).toEqual([
      { input: { who: 'Ada' }, started_by: recordedAdmin },
      { output: { greeting: 'Hi', input: { who: 'Ada' } }, record: { greeting: 'Hi' } },
    ]);
  });

  it('records every value in its fact while the switch is off, as the release before wrote it', async () => {
    const { definitions, watched } = await greeting();

    await definitions.call(runDefinition, ranWith(input));

    expect(await dataOf(definitions)).toEqual([
      { input, started_by: recordedAdmin },
      { output, record: { greeting: 'Hi' } },
    ]);
    expect(watched.reads()).toBe(0);
  });

  it('records its input and its output inline, and runs once, while the store of its content takes no value', async () => {
    const { definitions, watched } = await greeting();
    watched.failPuts();

    expect(await keepingOutside(definitions, ranWith(input))).toMatchObject({
      status: 'succeeded',
      output: { status: 'succeeded', output },
    });
    expect(await dataOf(definitions)).toEqual([
      { input, started_by: recordedAdmin },
      { output, record: { greeting: 'Hi' } },
    ]);
  });
});

describe('a run whose input and output are past what a page shows whole and within 16,384 bytes', () => {
  it('keeps them in its facts where its playbook keeps large values outside, and its history shows them as their sizes, as with the switch off', async () => {
    const [outside, inline] = [await greeting(), await greeting()];
    await keepingOutside(outside.definitions, ranWith(tenKiB));
    await inline.definitions.call(runDefinition, ranWith(tenKiB));

    expect(await dataOf(outside.definitions)).toEqual([
      { input: tenKiB, started_by: recordedAdmin },
      { output: { greeting: 'Hi', input: tenKiB }, record: { greeting: 'Hi' } },
    ]);
    expect(await dataOf(outside.definitions)).toEqual(await dataOf(inline.definitions));
    expect(await historyOf(outside.definitions)).toMatchObject({
      status: 'succeeded',
      output: {
        events: [
          { type: 'run_started', data: { input_bytes: 10_264, started_by: recordedAdmin } },
          { type: 'run_succeeded', data: { output_bytes: 10_290, record: { greeting: 'Hi' } } },
        ],
      },
    });
    expect(await historyOf(outside.definitions)).toEqual(await historyOf(inline.definitions));
    expect(outside.watched.reads()).toBe(0);
  });
});

describe('a request made again for a run whose input its playbook keeps outside the run', () => {
  it('is answered as the same run where its input is the same value written in another order, read once to tell', async () => {
    const { definitions, watched } = await greeting();
    await keepingOutside(definitions, ranWith(input));
    const reordered = { notes: input.notes, who: input.who };

    expect(await keepingOutside(definitions, ranWith(reordered))).toMatchObject({
      status: 'succeeded',
      output: { run_id: runId, status: 'succeeded', output },
    });
    expect(watched.reads()).toBe(2);
  });

  it('is a conflict with another input, and refused where the input it would be told from is gone', async () => {
    const { definitions, watched } = await greeting();
    await keepingOutside(definitions, ranWith(input));
    const other = await keepingOutside(definitions, ranWith({ ...input, who: 'Grace' }));
    watched.lose();
    const missing: unknown = expect.stringContaining('is missing from the content of its playbook');

    expect([
      other,
      await keepingOutside(definitions, ranWith({ ...input, who: 'Grace' }), twoHoursLater),
    ]).toMatchObject([
      {
        status: 'rejected',
        reason: 'conflict',
        detail: 'The run id belongs to a run of another definition or with another input',
      },
      {
        status: 'rejected',
        reason: 'conflict',
        detail: missing,
      },
    ]);
  });
});
