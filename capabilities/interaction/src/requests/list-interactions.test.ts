import { defineUpdateDefinition } from '@on.auto/definitions';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { approvalDocument, askedThroughChat, interactionHarness, nudging } from '../testing/index.ts';
import { answerInteraction } from './answer-interaction.ts';
import { listInteractions } from './list-interactions.ts';

const runIds = [
  '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b71',
  '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b72',
  '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b73',
];

const PageSchema = Schema.Struct({
  status: Schema.Literal('succeeded'),
  output: Schema.Struct({
    interactions: Schema.Array(Schema.Struct({ run_id: Schema.String })),
    has_more: Schema.Boolean,
    next_cursor: Schema.NullOr(Schema.String),
  }),
});

const decodePage = Schema.decodeUnknownSync(PageSchema);

async function playbookWithThreeRequests() {
  const playbook = interactionHarness();
  await playbook.define('approve-brief', approvalDocument());
  await playbook.define('approve-budget', approvalDocument());
  await playbook.ask('approve-brief', { campaign: 'Spring', owner: 'ada' }, String(runIds[0]));
  await playbook.ask('approve-budget', { campaign: 'Summer', owner: 'ada' }, String(runIds[1]));
  await playbook.ask('approve-brief', { campaign: 'Autumn', owner: 'grace' }, String(runIds[2]));
  return playbook;
}

async function listed(playbook: Awaited<ReturnType<typeof playbookWithThreeRequests>>, input: object) {
  const page = decodePage(await playbook.call(listInteractions, input));
  return { ids: page.output.interactions.map(({ run_id: id }) => id), page: page.output };
}

describe('the description of the open requests', () => {
  it('says that their pages are read on only as the person needs', () => {
    expect(listInteractions.registration.description).toContain(
      '`cursor` is the next_cursor of the page before, to read on only as the person needs.',
    );
  });
});

describe('the open requests of a playbook', () => {
  it('are listed newest first, kept to one party or one function when asked', async () => {
    const playbook = await playbookWithThreeRequests();

    expect([
      (await listed(playbook, {})).ids,
      (await listed(playbook, { to: 'ada' })).ids,
      (await listed(playbook, { function: 'approve-brief' })).ids,
      (await listed(playbook, { to: 'ada', function: 'approve-brief' })).ids,
    ]).toEqual([runIds.toReversed(), [runIds[1], runIds[0]], [runIds[2], runIds[0]], [runIds[0]]]);
  });

  it('are read on from the cursor of a page, and refuse a cursor list_interactions did not give', async () => {
    const playbook = await playbookWithThreeRequests();
    const first = await listed(playbook, { limit: 2 });

    expect(first).toMatchObject({ ids: [runIds[2], runIds[1]], page: { has_more: true } });
    expect(await listed(playbook, { limit: 2, cursor: first.page.next_cursor })).toMatchObject({
      ids: [runIds[0]],
      page: { has_more: false, next_cursor: null },
    });
    expect(await playbook.call(listInteractions, { cursor: 'bm90LWEtY3Vyc29y' })).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [{ pointer: '/cursor' }],
    });
  });
});

describe('the open requests of functions of one name', () => {
  it('are of one function when kept to its name and its type, since a name is unique only within its type', async () => {
    const playbook = interactionHarness({ others: [nudging] });
    await playbook.define('approve', approvalDocument());
    await playbook.ask('approve', { campaign: 'Spring', owner: 'ada' }, String(runIds[0]));
    await playbook.defineAs('nudging', 'approve', 'Approve?');
    await playbook.askAs('nudging', 'approve', {}, String(runIds[1]));

    expect([
      (await listed(playbook, { function: 'approve' })).ids,
      (await listed(playbook, { function: 'approve', type: 'interaction' })).ids,
      (await listed(playbook, { type: 'nudging' })).ids,
    ]).toEqual([[runIds[1], runIds[0]], [runIds[0]], [runIds[1]]]);
  });
});

const approvalSchema = {
  type: 'object',
  required: ['choice'],
  properties: { choice: { type: 'string', enum: ['approve', 'reject'] }, note: { type: 'string', maxLength: 2000 } },
};

const decisionDocument = [
  '---',
  'description: Ask the campaign owner to decide on a brief',
  "to: '{{ input.owner }}'",
  'expires: P2D',
  'deliver: agent',
  'input:',
  '  schema: { type: object, required: [campaign, owner], properties: { campaign: { type: string }, owner: { type: string } } }',
  'output:',
  '  schema: { type: object, required: [decision], properties: { decision: { type: string, enum: [approve, revise, skip] } } }',
  '---',
  'Please decide on the brief for {{ input.campaign }}.',
].join('\n');

const ShapesSchema = Schema.Struct({
  output: Schema.Struct({
    interactions: Schema.Array(
      Schema.Struct({
        version: Schema.Int,
        takes_answer: Schema.Boolean,
        answer_schema: Schema.NullOr(Schema.JsonObject),
      }),
    ),
  }),
});

const decodeShapes = Schema.decodeUnknownSync(ShapesSchema);

async function shapesIn(playbook: ReturnType<typeof interactionHarness>) {
  return decodeShapes(await playbook.call(listInteractions, {})).output.interactions;
}

describe('the answer shape of an open request', () => {
  it('is the answer schema its request recorded for a question, and null for a notification', async () => {
    const questioning = interactionHarness();
    await questioning.define('approve-brief', approvalDocument());
    await questioning.ask('approve-brief', { campaign: 'Spring', owner: 'ada' }, String(runIds[0]));
    const telling = await askedThroughChat({ notification: true });

    expect([await shapesIn(questioning), await shapesIn(telling.playbook)]).toEqual([
      [{ version: 1, takes_answer: true, answer_schema: approvalSchema }],
      [{ version: 1, takes_answer: false, answer_schema: null }],
    ]);
  });

  it('stays the one of the version that asked once its function changes, which is the one an answer is checked against', async () => {
    const playbook = interactionHarness();
    await playbook.define('approve-brief', approvalDocument());
    await playbook.ask('approve-brief', { campaign: 'Spring', owner: 'ada' }, String(runIds[0]));
    const changed = await playbook.call(defineUpdateDefinition([playbook.capability]), {
      type: 'interaction',
      name: 'approve-brief',
      source: decisionDocument,
    });
    const shapes = await shapesIn(playbook);

    expect(changed).toMatchObject({ status: 'succeeded', output: { version: 2 } });
    expect(shapes).toEqual([{ version: 1, takes_answer: true, answer_schema: approvalSchema }]);
    expect(
      await playbook.call(answerInteraction, { run_id: runIds[0], answer: { decision: 'approve' } }),
    ).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
    });
    expect(await playbook.call(answerInteraction, { run_id: runIds[0], answer: { choice: 'approve' } })).toMatchObject({
      status: 'succeeded',
      output: { answer: { choice: 'approve' } },
    });
  });
});
