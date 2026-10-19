import { textOf, type McpSession } from '@on.auto/api/testing';
import { Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  descriptionIn,
  sentenceNaming,
  sentencesOf,
  servingMeetings,
  type MeetingsServer,
} from '../testing/interaction-servers/meetings-server.ts';
import { runIdIn, workflowSource } from '../testing/servers/workflow-server.ts';
import { until } from '../testing/waiting/until.ts';

let meetings: MeetingsServer;

const inMeetings = { playbook: 'meetings' };

const approvingTheDraft = [
  '---',
  "description: Asks the owner to approve the month's draft",
  "to: '{{ input.owner }}'",
  'expires: P2D',
  'deliver:',
  '  server: chat',
  '  tool: post_message',
  '  with:',
  "    channel: '#drafts'",
  "    text: '{{ message }}'",
  'input:',
  '  schema:',
  '    type: object',
  '    required: [month, owner]',
  '    properties: { month: { type: string }, owner: { type: string } }',
  'output:',
  '  schema:',
  '    type: object',
  '    required: [decision]',
  '    properties:',
  '      decision: { type: string, enum: [approve, revise, skip] }',
  '      note: { type: string }',
  '---',
  'Here is the draft for {{ input.month }}: approve, revise or skip?',
].join('\n');

const draftingEachMonth = workflowSource(
  'monthly-draft',
  [
    'input:',
    '  schema:',
    '    document: { type: object, required: [month, owner] }',
    'do:',
    '  - approval:',
    '      call: run_definition',
    "      with: { type: interaction, name: approve-draft, input: '${ $data }' }",
    '',
  ].join('\n'),
);

beforeAll(async () => {
  meetings = await servingMeetings([], { chat: true });
  await meetings.onMcp(async (session) => {
    await session.callTool('create_playbook', { ...inMeetings, name: 'Meetings' });
    await session.callTool('create_definition', {
      ...inMeetings,
      type: 'interaction',
      name: 'approve-draft',
      source: approvingTheDraft,
    });
    await session.callTool('create_definition', {
      ...inMeetings,
      type: 'workflow',
      name: 'monthly-draft',
      source: draftingEachMonth,
    });
  });
});

afterAll(async () => {
  await meetings.stop();
});

const OpenRequestsSchema = Schema.Struct({
  interactions: Schema.Array(
    Schema.Struct({
      run_id: Schema.String,
      delivery: Schema.NullOr(Schema.Struct({ server: Schema.String, tool: Schema.String })),
      message: Schema.String,
      standing: Schema.String,
      answer_schema: Schema.NullOr(Schema.JsonObject),
    }),
  ),
});

const draftAnswerSchema = {
  type: 'object',
  required: ['decision'],
  properties: { decision: { type: 'string', enum: ['approve', 'revise', 'skip'] }, note: { type: 'string' } },
};

type OpenRequest = (typeof OpenRequestsSchema.Type)['interactions'][number];

async function openRequestsIn(session: McpSession): Promise<readonly OpenRequest[]> {
  const listed = await session.callTool('list_interactions', inMeetings);
  return Schema.decodeUnknownSync(OpenRequestsSchema)(listed.structuredContent).interactions;
}

function deliveredRequestsIn(session: McpSession, count: number): Promise<readonly OpenRequest[]> {
  return until(async () => {
    const open = await openRequestsIn(session);
    expect(open.filter(({ standing }) => standing === 'delivered')).toHaveLength(count);
    return open;
  });
}

function endedIn(session: McpSession, runId: string): Promise<unknown> {
  return until(async () => {
    const read = await session.callTool('get_run', { ...inMeetings, run_id: runId });
    expect(read.structuredContent).not.toMatchObject({ status: 'started' });
    return read.structuredContent;
  });
}

function draftFor(session: McpSession, month: string): Promise<string> {
  return session
    .callTool('run_definition', {
      ...inMeetings,
      type: 'workflow',
      name: 'monthly-draft',
      input: { month, owner: 'ada' },
    })
    .then(({ structuredContent }) => runIdIn(structuredContent));
}

async function approvedThenNextMonth(session: McpSession) {
  const september = await draftFor(session, 'September');
  const [asked] = await deliveredRequestsIn(session, 1);
  const answered = await session.callTool('answer_interaction', {
    ...inMeetings,
    run_id: String(asked?.run_id),
    answer: { decision: 'approve' },
  });
  const ended = await endedIn(session, september);
  const openOnceAnswered = await openRequestsIn(session);
  await draftFor(session, 'October');
  return { asked, answered, ended, openOnceAnswered, openForOctober: await deliveredRequestsIn(session, 1) };
}

describe('episode 7: the person approves, in the chat, a draft a workflow sent through a tool', () => {
  it('finds in the instructions, answer_interaction and the guide that the answer goes to the waiting request, and nothing that says to wait in a loop', async () => {
    const { instructions } = meetings.surfaces;
    const guide = await meetings.onMcp((session) => session.callTool('get_guide', { guide: 'interaction-function' }));

    expect(sentenceNaming(instructions, 'answer_interaction')).toBe(
      'When the person approves, rejects or otherwise answers what a run waits on, answer its request with answer_interaction, not a new run.',
    );
    expect(sentenceNaming(instructions, 'get_run')).toBe(
      'A run of a workflow answers started; get_run shows whether it ended or still waits.',
    );
    expect(instructions).not.toMatch(/\bpoll|\buntil (?:it ends|its status changes)/iu);
    expect(descriptionIn(meetings.surfaces, 'answer_interaction')).toContain(
      'Use it when the person approves, rejects, revises or otherwise answers a request list_interactions shows, wherever it reached them; a new run asks again and answers nothing,',
    );
    expect(descriptionIn(meetings.surfaces, 'answer_interaction')).toContain(
      '`answer` takes the shape of the request\'s answer_schema, which list_interactions shows, such as {"decision": "approve"}.',
    );
    expect(textOf(guide)).toContain('it is `{ "decision": "approve" }`.');
    expect(textOf(guide)).toContain('Running the function or its workflow again answers nothing:');
  });

  it('answers the request the person approved, which ends the run that waited, and starts a new run only for the next month', async () => {
    const outcome = await meetings.onMcp(approvedThenNextMonth);

    expect([outcome.asked?.delivery, outcome.asked?.message, outcome.asked?.answer_schema]).toEqual([
      { server: 'chat', tool: 'post_message' },
      'Here is the draft for September: approve, revise or skip?',
      draftAnswerSchema,
    ]);
    expect(outcome.answered.structuredContent).toMatchObject({ answer: { decision: 'approve' } });
    expect(outcome.ended).toMatchObject({ status: 'succeeded', output: { decision: 'approve' } });
    expect(outcome.openOnceAnswered).toEqual([]);
    expect(outcome.openForOctober.map(({ message }) => message)).toEqual([
      'Here is the draft for October: approve, revise or skip?',
    ]);
    expect(meetings.chat?.chat.posted().map(({ text }) => text)).toEqual([
      'Here is the draft for September: approve, revise or skip?',
      'Here is the draft for October: approve, revise or skip?',
    ]);
  });
});

describe('the shape of the answer an open request takes, as the agent reads it', () => {
  it('is on each listed request, as the description of list_interactions says within the bounds the server holds texts to', () => {
    const description = descriptionIn(meetings.surfaces, 'list_interactions');

    expect(sentenceNaming(description, 'answer_schema')).toBe(
      'Each carries its `answer_schema`, the shape answer_interaction checks an answer against, as recorded when it was asked, which get_definition may no longer show; null for a notification.',
    );
    expect(descriptionIn(meetings.surfaces, 'answer_interaction')).toContain(
      "`answer` takes the shape of the request's answer_schema, which list_interactions shows,",
    );
    expect([description.length, sentencesOf(description).length]).toEqual([765, 5]);
  });
});
