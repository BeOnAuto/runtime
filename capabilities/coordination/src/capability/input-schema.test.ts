import type { RunContext } from '@on.auto/definitions';
import { noLongestRuns, recordingJournal } from '@on.auto/definitions/testing';
import { InvalidInput } from '@on.auto/operations';
import { memoryLedger } from '@on.auto/operations/testing';
import type { Json } from '@on.auto/workflow-engine';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { playbookOn } from '../testing/playbook.ts';
import { recordingStarts, recordingWorkflows } from '../testing/recording-starts.ts';
import { acmeCaller } from '../testing/workflows.ts';

const booking = [
  "document: { dsl: '1.0.3', namespace: acme, name: booking, version: '1.0.0' }",
  'input:',
  '  schema:',
  '    document:',
  '      type: object',
  '      required: [seats, day]',
  '      properties:',
  "        seats: { type: integer, minimum: 1, description: 'How many seats to hold' }",
  '        day: { type: string }',
  'do: []',
].join('\n');

const dated = [
  "document: { dsl: '1.0.3', namespace: acme, name: dated, version: '1.0.0' }",
  'input:',
  '  schema:',
  '    document:',
  '      type: object',
  '      properties:',
  '        day: { type: string, format: date }',
  'do: []',
].join('\n');

const anyInput = "document: { dsl: '1.0.3', namespace: acme, name: any-input, version: '1.0.0' }\ndo: []\n";

const runId = '0199a3c4-7d2e-7c1a-9b3f-777777777771';

const tooFewSeats = { pointer: '/input/seats', detail: 'seats, How many seats to hold: expected at least 1.' };

async function playbookWith(name: string, source: string) {
  const { starts, recording } = recordingStarts();
  const playbook = playbookOn(memoryLedger(), [recordingWorkflows(recording)]);
  await playbook.call(playbook.createDefinition, { type: 'workflow', name, source });
  const run = (input: Json, run_id?: string) =>
    playbook.call(playbook.runDefinition, {
      type: 'workflow',
      name,
      input,
      ...(run_id === undefined ? {} : { run_id }),
    });
  return { starts, playbook, run };
}

describe('a run a caller starts of a workflow whose input schema refuses the input', () => {
  it('is refused before the workflow starts, each issue at its field under /input in the sentence of its rule', async () => {
    const { starts, run } = await playbookWith('booking', booking);

    const refused = [await run({}), await run({ seats: 'two', day: 7 }), await run({ seats: 0, day: 'monday' })];

    expect(refused).toEqual([
      {
        status: 'rejected',
        reason: 'invalid_input',
        kind: 'input_schema',
        detail: 'The input: expected the field seats, How many seats to hold. The input: expected the field day.',
        issues: [
          { pointer: '/input/seats', detail: 'The input: expected the field seats, How many seats to hold.' },
          { pointer: '/input/day', detail: 'The input: expected the field day.' },
        ],
      },
      {
        status: 'rejected',
        reason: 'invalid_input',
        kind: 'input_schema',
        detail: 'seats, How many seats to hold: expected a whole number, at least 1. day: expected text.',
        issues: [
          { pointer: '/input/seats', detail: 'seats, How many seats to hold: expected a whole number, at least 1.' },
          { pointer: '/input/day', detail: 'day: expected text.' },
        ],
      },
      {
        status: 'rejected',
        reason: 'invalid_input',
        kind: 'input_schema',
        detail: tooFewSeats.detail,
        issues: [tooFewSeats],
      },
    ]);
    expect(starts).toEqual([]);
  });
});

describe('a run a caller starts of a workflow whose input schema names a format', () => {
  it('is refused before the workflow starts when a string is out of its form, in the words of the form and an example', async () => {
    const { starts, run } = await playbookWith('dated', dated);
    const outOfForm = { pointer: '/input/day', detail: 'day: expected a date such as 2026-04-01.' };

    expect(await run({ day: 'April' })).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      kind: 'input_schema',
      detail: outOfForm.detail,
      issues: [outOfForm],
    });
    expect(starts).toEqual([]);
  });
});

describe('the record of a run a caller starts whose input the input schema refused', () => {
  it('is rejected for its input, as a refused run of a function is, the host never starting it, and a retry answers the same', async () => {
    const { starts, playbook, run } = await playbookWith('booking', booking);

    const first = await run({ seats: 0, day: 'monday' }, runId);
    const read = await playbook.call(playbook.getRun, { run_id: runId });
    const retried = await run({ seats: 0, day: 'monday' }, runId);

    expect(read).toMatchObject({
      status: 'succeeded',
      output: {
        status: 'rejected',
        rejection: { reason: 'invalid_input', kind: 'input_schema', issues: [tooFewSeats] },
      },
    });
    expect(retried).toEqual(first);
    expect(starts).toEqual([]);
  });
});

describe('a run a caller starts of a workflow whose input schema takes the input', () => {
  it('starts the workflow with the input as it was given', async () => {
    const { starts, run } = await playbookWith('booking', booking);
    const input = { seats: 2, day: 'monday', note: 'by the window' };

    expect(await run(input)).toMatchObject({ status: 'succeeded', output: { status: 'started' } });
    expect(starts.map((start) => start.input)).toEqual([input]);
  });
});

describe('a run a caller starts of a workflow with no input schema', () => {
  it('starts with any input it is given, as it is', async () => {
    const { starts, run } = await playbookWith('any-input', anyInput);

    await run({});
    await run({ anything: [1, 'two', null] });
    await run({ seats: 'none' });

    expect(starts.map((start) => start.input)).toEqual([{}, { anything: [1, 'two', null] }, { seats: 'none' }]);
  });
});

function contextOf(links: Partial<Pick<RunContext, 'trigger'>>): RunContext {
  return {
    id: runId,
    org: 'acme',
    playbook: 'alpha',
    caller: acmeCaller,
    definition: { name: 'booking', version: 1 },
    journal: recordingJournal(),
    lineage: { startId: 'start-1', correlationId: runId },
    depth: 1,
    callDepth: 0,
    ...links,
    ...noLongestRuns,
  };
}

describe('a run a trigger starts of a workflow with an input schema', () => {
  const event = { specversion: '1.0', id: 'e1', source: '/ledger', type: 'com.acme.ledger.closed', data: {} };

  it('starts with the input of its trigger, which the schema refuses from a caller', async () => {
    const { starts, recording } = recordingStarts();
    const prepared = Effect.runSync(recordingWorkflows(recording).prepare(booking));
    const due = { schedule: { due: '2026-10-19T09:00:00.000Z' } };

    const triggered = [
      await Effect.runPromiseExit(
        prepared.run([event], contextOf({ trigger: { kind: 'event', reference: '/schedule/on' } })),
      ),
      await Effect.runPromiseExit(
        prepared.run(due, contextOf({ trigger: { kind: 'cron', reference: '/schedule/cron' } })),
      ),
    ];
    const called = await Effect.runPromiseExit(prepared.run(due, contextOf({})));

    expect(triggered).toEqual([
      Exit.succeed({ finishesLater: true, record: {} }),
      Exit.succeed({ finishesLater: true, record: {} }),
    ]);
    expect(starts.map((start) => start.input)).toEqual([[event], due]);
    expect(called).toEqual(
      Exit.fail(
        new InvalidInput({
          detail: 'The input: expected the field seats, How many seats to hold. The input: expected the field day.',
          issues: [
            { pointer: '/seats', detail: 'The input: expected the field seats, How many seats to hold.' },
            { pointer: '/day', detail: 'The input: expected the field day.' },
          ],
          kind: 'input_schema',
        }),
      ),
    );
  });
});

describe('saving a workflow whose input schema the runtime does not take', () => {
  it('is refused at the line of each place the schema breaks a rule, under its pointer, in the words of the rule', async () => {
    const { playbook } = await playbookWith('booking', booking);
    const source = booking
      .replace("seats: { type: integer, minimum: 1, description: 'How many seats to hold' }", 'seats: { type: whole }')
      .replace('required: [seats, day]', 'required: seats');

    expect(await playbook.call(playbook.createDefinition, { type: 'workflow', name: 'unbookable', source })).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The workflow document is not a workflow this runtime runs',
      issues: [
        {
          pointer: '/source',
          detail: 'Line 6, column 17: at /input/schema/document/required: Expected a list of strings',
        },
        {
          pointer: '/source',
          detail:
            'Line 8, column 24: at /input/schema/document/properties/seats/type: Expected one of null, boolean, object, array, number, string, integer, or a non-empty list of them',
        },
      ],
    });
  });

  it('is refused for a schema of another format alone, without reading the schema it holds', async () => {
    const { playbook } = await playbookWith('booking', booking);
    const source = booking.replace('    document:', '    format: avro\n    document:').replace('[seats, day]', 'seats');

    expect(await playbook.call(playbook.createDefinition, { type: 'workflow', name: 'avro', source })).toMatchObject({
      status: 'rejected',
      issues: [
        {
          pointer: '/source',
          detail: 'Line 4, column 13: at /input/schema/format: Schemas are JSON Schema in this version, not avro',
        },
      ],
    });
  });
});

describe('saving a workflow whose input schema names a format the runtime does not check', () => {
  it('is refused at its pointer, in the words of the compiler, which names the formats it checks', async () => {
    const { playbook } = await playbookWith('dated', dated);
    const source = dated.replace('format: date', 'format: phone');

    expect(await playbook.call(playbook.createDefinition, { type: 'workflow', name: 'phoned', source })).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The workflow document is not a workflow this runtime runs',
      issues: [
        {
          pointer: '/source',
          detail:
            'Line 7, column 38: at /input/schema/document/properties/day/format: Expected one of the formats checked here: date, date-time, time, email, uri or uuid',
        },
      ],
    });
  });
});
