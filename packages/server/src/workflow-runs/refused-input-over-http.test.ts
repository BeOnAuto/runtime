import { afterEach, describe, expect, it } from 'vitest';

import { alpha, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { runIdIn, servingWorkflows, settledRun, workflowSource } from '../testing/servers/workflow-server.ts';

const seatHold = [
  '---',
  'model: anthropic/claude-sonnet-4-5',
  'input:',
  '  schema:',
  '    type: object',
  '    required: [seats]',
  '    properties:',
  "      seats: { type: integer, minimum: 1, description: 'How many seats to hold' }",
  '---',
  'Hold {{ input.seats }} seats.',
].join('\n');

const holdingSeats = workflowSource(
  'holding-seats',
  `do:
  - count-seats:
      call: run_definition
      with: { type: reasoning, name: seat-hold, input: '\${ $input }' }
`,
);

const travelling = workflowSource(
  'travelling',
  `do:
  - book:
      call: run_definition
      with: { type: workflow, name: holding-seats, input: '\${ $input }' }
`,
);

const bookingSeats = workflowSource(
  'booking-seats',
  `input:
  schema:
    document:
      type: object
      required: [seats]
      properties:
        seats: { type: integer, minimum: 1, description: 'How many seats to hold' }
do:
  - count-seats:
      call: run_definition
      with: { type: reasoning, name: seat-hold, input: '\${ $input }' }
`,
);

const flying = workflowSource(
  'flying',
  `do:
  - book:
      call: run_definition
      with: { type: workflow, name: booking-seats, input: '\${ $input }' }
`,
);

const catchingTheRefusal = workflowSource(
  'catching-the-refusal',
  `do:
  - book:
      try:
        - hold:
            call: run_definition
            with: { type: workflow, name: booking-seats, input: '\${ $input }' }
      catch:
        errors:
          with: { kind: input_schema }
        do:
          - note: { set: { refused: true } }
`,
);

const refusedSeats = { pointer: '/input/seats', detail: 'seats, How many seats to hold: expected at least 1.' };

const refusedRunId = '0199a3c4-7d2e-7c1a-9b3f-888888888881';

const refusedAtTheStep =
  'The reasoning function seat-hold refused its input, at the step count-seats: seats, How many seats to hold: expected at least 1.';

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

async function servingTheHold(): Promise<void> {
  server = await servingWorkflows([]);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/definitions/reasoning`, { body: { name: 'seat-hold', source: seatHold } });
  await server.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'holding-seats', source: holdingSeats } });
  await server.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'travelling', source: travelling } });
  await server.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'booking-seats', source: bookingSeats } });
  await server.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'flying', source: flying } });
  await server.call('POST', `${alpha}/definitions/workflow`, {
    body: { name: 'catching-the-refusal', source: catchingTheRefusal },
  });
}

describe('a workflow whose first step refuses a field of its input, over HTTP', () => {
  it('is rejected in the words of the field, with the issues of the step at their pointers', async () => {
    await servingTheHold();
    const started = await server.call('POST', `${alpha}/definitions/workflow/holding-seats/run`, {
      body: { input: { seats: 0 } },
    });
    const runId = runIdIn(started.body);

    expect(await settledRun(server, `${alpha}/runs/${runId}`)).toMatchObject({
      body: {
        status: 'rejected',
        rejection: { reason: 'invalid_input', detail: refusedAtTheStep, issues: [refusedSeats] },
      },
    });
    expect(
      await server.call('POST', `${alpha}/definitions/workflow/holding-seats/run`, {
        body: { input: { seats: 0 }, run_id: runId },
      }),
    ).toMatchObject({
      status: 422,
      body: { reason: 'invalid_input', detail: refusedAtTheStep, errors: [refusedSeats] },
    });
  });
});

describe('a workflow that called a workflow whose first step refuses a field, over HTTP', () => {
  it('says the workflow stopped at its own step, then the refusal inside it, with the innermost issues', async () => {
    await servingTheHold();
    const started = await server.call('POST', `${alpha}/definitions/workflow/travelling/run`, {
      body: { input: { seats: 0 } },
    });

    expect(await settledRun(server, `${alpha}/runs/${runIdIn(started.body)}`)).toMatchObject({
      body: {
        status: 'rejected',
        rejection: {
          reason: 'invalid_input',
          detail: `The workflow holding-seats stopped, at the step book: ${refusedAtTheStep}`,
          issues: [refusedSeats],
        },
      },
    });
  });
});

describe('a workflow whose input schema refuses a field of the input, over HTTP', () => {
  it('is refused with 422 of the kind input_schema, in the words of the field, at its pointer under /input, and no step runs', async () => {
    await servingTheHold();

    const refused = await server.call('POST', `${alpha}/definitions/workflow/booking-seats/run`, {
      body: { input: { seats: 0 }, run_id: refusedRunId },
    });
    const read = await server.call('GET', `${alpha}/runs/${refusedRunId}`);

    expect(refused).toMatchObject({
      status: 422,
      body: { reason: 'invalid_input', kind: 'input_schema', detail: refusedSeats.detail, errors: [refusedSeats] },
    });
    expect(read).toMatchObject({
      body: {
        status: 'rejected',
        rejection: { reason: 'invalid_input', kind: 'input_schema', issues: [refusedSeats] },
      },
    });
    expect(server.modelCalls()).toBe(0);
  });
});

describe('a workflow that called a workflow whose input schema refuses a field, over HTTP', () => {
  it('says the workflow it called refused its input, at its own step, with the issues of that input and no kind', async () => {
    await servingTheHold();
    const started = await server.call('POST', `${alpha}/definitions/workflow/flying/run`, {
      body: { input: { seats: 0 } },
    });
    const settled = await settledRun(server, `${alpha}/runs/${runIdIn(started.body)}`);

    expect(settled).toMatchObject({
      body: {
        status: 'rejected',
        rejection: {
          reason: 'invalid_input',
          detail: `The workflow booking-seats refused its input, at the step book: ${refusedSeats.detail}`,
          issues: [refusedSeats],
        },
      },
    });
    expect(settled.body).not.toHaveProperty('rejection.kind');
    expect(server.modelCalls()).toBe(0);
  });

  it('lets a catch take the refusal by its kind, input_schema', async () => {
    await servingTheHold();
    const started = await server.call('POST', `${alpha}/definitions/workflow/catching-the-refusal/run`, {
      body: { input: { seats: 0 } },
    });

    expect(await settledRun(server, `${alpha}/runs/${runIdIn(started.body)}`)).toMatchObject({
      body: { status: 'succeeded', output: { refused: true } },
    });
  });
});
