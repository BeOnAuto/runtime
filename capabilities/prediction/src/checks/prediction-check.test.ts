import type { SavedDefinition } from '@on.auto/definitions';
import { nothingSaved } from '@on.auto/definitions/testing';
import { Cause, Effect, Exit, Struct, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { poolOf, predictionRuns, savedInPlaybook } from '../testing/prediction-runs.ts';
import { weeklyOrders, weeklyOrdersWith } from '../testing/weekly-orders.ts';

const approving = weeklyOrdersWith(['  activate: automatic', '  activate: { approved: approve-version }']);

const sending = weeklyOrdersWith(['  expires: P7D', '  expires: P7D\n  through: send-build']);

const atTheDataTest: unknown = expect.stringMatching(/^Line 12, \/data\/events\/0\/data: /u);

const notTheDecision =
  'Line 22, /evaluation/activate/approved: The output schema of approve-version, the function that approves a version, is not an object whose one required property decision is approve or reject';

const notTheCandidates =
  'Line 25, /source/through: The output schema of send-build, the function that sends a build to its trainer, is not an object whose one required property candidates is a list of the SHA-256 of each candidate as text';

const decision: Schema.JsonObject = {
  type: 'object',
  required: ['decision'],
  properties: { decision: { type: 'string', enum: ['reject', 'approve'] } },
};

const candidates: Schema.JsonObject = {
  type: 'object',
  required: ['candidates'],
  properties: { candidates: { type: 'array', items: { type: 'string' } } },
};

function listed(candidatesSchema: Schema.Json): Schema.JsonObject {
  return { type: 'object', required: ['candidates'], properties: { candidates: candidatesSchema } };
}

const notCandidates: readonly (readonly [string, Schema.JsonObject])[] = [
  ['a list', { type: 'array', required: ['candidates'], properties: candidates['properties'] ?? {} }],
  ['candidates not required', { type: 'object', required: [], properties: candidates['properties'] ?? {} }],
  [
    'candidates beside another required property',
    { type: 'object', required: ['candidates', 'notes'], properties: candidates['properties'] ?? {} },
  ],
  ['candidates as text', listed({ type: 'string', items: { type: 'string' } })],
  ['items of any kind', listed({ type: 'array', items: true })],
  ['items that are numbers', listed({ type: 'array', items: { type: 'integer' } })],
  ['required that is not a list', { type: 'object', required: 'candidates' }],
];

function tested(expression: string): string {
  return weeklyOrdersWith(['    - type: order.placed', `    - type: order.placed\n      data: '\${ ${expression} }'`]);
}

function approver(more: Partial<SavedDefinition> = {}): SavedDefinition {
  return {
    name: 'approve-version',
    version: 2,
    inputSchema: {
      type: 'object',
      required: ['function', 'version', 'card'],
      properties: { version: { type: 'integer' } },
    },
    outputSchema: decision,
    ...more,
  };
}

function sender(more: Partial<SavedDefinition> = {}): SavedDefinition {
  return { name: 'send-build', version: 1, outputSchema: candidates, ...more };
}

async function checked(source: string, saved: readonly SavedDefinition[] = []): Promise<unknown> {
  const exit = await Effect.runPromiseExit(predictionRuns().prepared(source).check(savedInPlaybook(saved)));
  return Exit.isFailure(exit) ? Cause.squash(exit.cause) : exit.value;
}

function problems(...details: readonly string[]): unknown {
  return expect.objectContaining({ issues: details.map((detail) => ({ pointer: '', detail })) });
}

describe('the check of an approver when a prediction function is saved', () => {
  it('strips nothing from a document with no data test and no function it calls', async () => {
    expect(await Effect.runPromise(predictionRuns().prepared(weeklyOrders).check(nothingSaved))).toEqual({});
  });

  it('takes an active interaction function asked with a card and answering approve or reject', async () => {
    expect(await checked(approving, [approver()])).toEqual({});
    expect(await checked(approving, [Struct.omit(approver(), ['inputSchema'])])).toEqual({});
  });

  it('refuses a function that is not an active interaction function, naming its line', async () => {
    expect(await checked(approving)).toEqual(
      problems(
        'Line 22, /evaluation/activate/approved: approve-version is not an active interaction function of this playbook; save it first, or name one that is',
      ),
    );
  });

  it('refuses a function whose input schema does not take the card, or whose output is not the decision', async () => {
    const strict = { type: 'object', required: ['reviewer'], properties: { reviewer: { type: 'string' } } };
    const yesOrNo = {
      type: 'object',
      required: ['decision'],
      properties: { decision: { type: 'string', enum: ['yes', 'no'] } },
    };

    expect(await checked(approving, [approver({ inputSchema: strict, outputSchema: yesOrNo })])).toEqual(
      problems(
        'Line 22, /evaluation/activate/approved: The input schema of approve-version does not take { function, version, card }, which an approval is asked with: /reviewer: Missing key',
        notTheDecision,
      ),
    );
    expect(await checked(approving, [Struct.omit(approver(), ['outputSchema'])])).toEqual(problems(notTheDecision));
  });
});

describe('the check of a function to send builds through when a prediction function is saved', () => {
  it('takes a function whose answer is the candidates', async () => {
    expect(await checked(sending, [sender()])).toEqual({});
  });

  it.each(notCandidates)('refuses a function whose answer is %s', async (_case, outputSchema) => {
    expect(await checked(sending, [sender({ outputSchema })])).toEqual(problems(notTheCandidates));
  });

  it('refuses a function whose input schema does not take the build', async () => {
    expect(await checked(sending, [sender({ inputSchema: { type: 'object', required: ['run'] } })])).toEqual(
      problems(
        'Line 25, /source/through: The input schema of send-build does not take { build: {} }, which a build is sent with: /run: Missing key',
      ),
    );
    expect(await checked(sending, [sender({ inputSchema: { type: 'string' } })])).toEqual(
      problems(
        'Line 25, /source/through: The input schema of send-build does not take { build: {} }, which a build is sent with: its root: Expected string',
      ),
    );
  });
});

describe('the check of a data test when a prediction function is saved', () => {
  it('keeps what it stripped of a test that names $data alone, and refuses one that names more at its line', async () => {
    const pool = poolOf();
    const stripped = await Effect.runPromise(
      predictionRuns(pool).prepared(tested('($data as { region: string }).region !== "test"')).check(nothingSaved),
    );
    const refused = await Effect.runPromise(
      Effect.flip(predictionRuns(pool).prepared(tested('$workflow.input.region === $data.region')).check(nothingSaved)),
    );

    expect(stripped).toEqual({
      expressions: {
        ' ($data as { region: string }).region !== "test" ': ' ($data                      ).region !== "test" ',
      },
    });
    expect(refused).toMatchObject({ issues: [{ pointer: '', detail: atTheDataTest }] });
  });
});
