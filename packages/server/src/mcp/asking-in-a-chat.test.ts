import { Buffer } from 'node:buffer';

import { mostGuideBytes } from '@on.auto/api';
import { plainTextIn, problemIn, textOf, type McpSession } from '@on.auto/api/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  sentenceNaming,
  servingMeetings,
  type MeetingsServer,
} from '../testing/interaction-servers/meetings-server.ts';

let meetings: MeetingsServer;

const namingTheMessage: unknown = expect.stringContaining('"ts":"1699.000001"');

const listingTheMessages: unknown = expect.stringContaining('"messages":[');

const someMessages: unknown = expect.any(Array);

const inMeetings = { playbook: 'meetings' };

const approvingInTheChat = [
  '---',
  'description: Send the draft to its owner in the chat and take their approval',
  "to: '{{ input.owner }}'",
  'expires: P2D',
  'deliver:',
  '  server: chat',
  '  tool: post_message',
  '  with:',
  "    channel: '#drafts'",
  "    text: '{{ message }}'",
  '  sent:',
  '    conversation: /channel',
  '    id: /ts',
  'replies:',
  "  conversation: '{{ sent.conversation }}/{{ sent.id }}'",
  '  tool: thread_replies',
  '  with:',
  "    channel: '{{ sent.conversation }}'",
  "    ts: '{{ sent.id }}'",
  `    oldest: '{{ since | default: "0" }}'`,
  '  read:',
  '    list: /messages',
  '    order: oldest_first',
  '    each: { id: /ts, sender: /user, text: /text, to: /thread_ts }',
  'input:',
  '  schema:',
  '    type: object',
  '    required: [owner, draft]',
  '    properties: { owner: { type: string }, draft: { type: string, maxLength: 4000 } }',
  'output:',
  '  schema:',
  '    type: object',
  '    required: [choice]',
  '    properties:',
  '      choice: { type: string, enum: [approve, reject] }',
  '      note: { type: string, maxLength: 2000 }',
  '---',
  'Here is the draft:',
  '',
  '{{ input.draft }}',
  '',
  'Reply **approve** or **reject**, with a note if you reject.',
].join('\n');

beforeAll(async () => {
  meetings = await servingMeetings([], { chat: true });
  await meetings.onMcp((session) => session.callTool('create_playbook', { ...inMeetings, name: 'Meetings' }));
});

afterAll(async () => {
  await meetings.stop();
});

async function askedToSendADraft(session: McpSession) {
  const guide = textOf(await session.callTool('get_guide', { guide: 'interaction-function' }));
  const sent = await session.callTool('execute', {
    ...inMeetings,
    server: 'chat',
    tool: 'post_message',
    arguments: { channel: '#drafts', text: 'A draft to look at' },
  });
  const read = await session.callTool('execute', {
    ...inMeetings,
    server: 'chat',
    tool: 'thread_replies',
    arguments: { channel: '#drafts', ts: '1699.000001' },
  });
  const saved = await session.callTool('create_definition', {
    ...inMeetings,
    type: 'interaction',
    name: 'approve-draft',
    source: approvingInTheChat,
  });
  const reasoning = await session.callTool('list_definitions', { ...inMeetings, type: 'reasoning' });
  return { guide, sent, read, saved, reasoning };
}

async function askedWhereNoToolServerIs(session: McpSession) {
  const briefs = { playbook: 'briefs' };
  await session.callTool('create_playbook', { ...briefs, name: 'Briefs' });
  await session.callTool('create_definition', {
    ...briefs,
    type: 'interaction',
    name: 'approve-draft',
    source: approvingInTheChat,
  });
  return session.callTool('run_definition', {
    ...briefs,
    type: 'interaction',
    name: 'approve-draft',
    input: { owner: 'ada', draft: 'The September newsletter' },
  });
}

describe('episode 9: asked to send the person a draft in the chat and take their approval', () => {
  it('reads the interaction sentence, calls the tool that sends and the tool that reads, and saves one interaction function', async () => {
    const seen = await meetings.onMcp(askedToSendADraft);

    expect(sentenceNaming(meetings.surfaces.instructions, 'An interaction function')).toBe(
      'An interaction function asks a system and answers at once, or a person and answers started.',
    );
    expect([seen.sent.structuredContent, seen.read.structuredContent]).toMatchObject([
      { outcome: 'result', text: namingTheMessage },
      { outcome: 'result', text: listingTheMessages },
    ]);
    expect(seen.guide).toMatch(/^## Sending through a tool\n[\s\S]*^### Attempts\n[\s\S]*^## Fields$/mu);
    expect(Buffer.byteLength(seen.guide)).toBeLessThan(mostGuideBytes);
    expect(seen.saved.isError).not.toBe(true);
    expect(seen.reasoning.structuredContent).toEqual({ definitions: [] });
  });

  it('is told, on a playbook no tool server serves, what whoever runs the server sets up', async () => {
    const refused = await meetings.onMcp(askedWhereNoToolServerIs);

    expect(plainTextIn(refused)).toBe(
      'Could not run the interaction function “approve-draft”: this server does not offer a tool it names, because whoever runs the server has not set up a tool server of that name for this playbook. Nothing was changed. This can be put right on your side: whoever runs the server decides which tool servers and tools this playbook may use, which search shows, so once it names only those, it can be tried again.',
    );
  });
});

const readingAThread = [
  '---',
  'description: Read the replies of a thread in the team chat, oldest first',
  'call:',
  '  server: chat',
  '  tool: thread_replies',
  '  with:',
  "    channel: '{{ input.channel }}'",
  "    ts: '{{ input.thread }}'",
  '  read: /messages',
  'input:',
  '  schema: { type: object, required: [channel, thread], properties: { channel: { type: string }, thread: { type: string } } }',
  'output:',
  '  schema:',
  '    type: array',
  '    items: { type: object, required: [user, ts], properties: { user: { type: string }, text: { type: string }, ts: { type: string } } }',
  '---',
  '',
].join('\n');

async function askedForTheRepliesOfAThread(session: McpSession) {
  const recipe = textOf(await session.callTool('get_guide', { guide: 'give-tools' }));
  const called = await session.callTool('execute', {
    ...inMeetings,
    server: 'chat',
    tool: 'thread_replies',
    arguments: { channel: '#drafts', ts: '1699.000001' },
  });
  const saved = await session.callTool('create_definition', {
    ...inMeetings,
    type: 'interaction',
    name: 'thread-replies',
    source: readingAThread,
  });
  const reasoning = await session.callTool('list_definitions', { ...inMeetings, type: 'reasoning' });
  return { recipe, called, saved, reasoning };
}

describe('episode 10: asked to put the replies of a thread into the weekly summary', () => {
  it('reads the interaction sentence and the give-tools sentence, calls the tool, reads its answer, and saves one interaction function that calls it', async () => {
    const seen = await meetings.onMcp(askedForTheRepliesOfAThread);

    expect(sentenceNaming(meetings.surfaces.instructions, 'An interaction function')).toBe(
      'An interaction function asks a system and answers at once, or a person and answers started.',
    );
    expect(seen.recipe).toContain(
      "To read or act on a system, write an interaction function that calls the connection's tool with `call` instead",
    );
    expect(seen.called.structuredContent).toMatchObject({
      outcome: 'result',
      text: listingTheMessages,
      answer: { messages: someMessages },
    });
    expect(seen.saved.isError).not.toBe(true);
    expect(seen.reasoning.structuredContent).toEqual({ definitions: [] });
  });
});

const askingTheOwner = [
  '---',
  'description: Ask the owner to approve the draft',
  "to: '{{ input.owner }}'",
  'expires: P2D',
  'input:',
  '  schema: { type: object, required: [owner, draft], properties: { owner: { type: string }, draft: { type: string } } }',
  'output:',
  '  schema: { type: object, required: [verdict], properties: { verdict: { type: string, enum: [approve, revise] } } }',
  '---',
  'Here is the draft: {{ input.draft }}',
].join('\n');

const savingIt = {
  name: 'create_definition',
  arguments: { ...inMeetings, type: 'interaction', name: 'approve-the-draft', source: askingTheOwner },
};

const throughTheChat =
  'Line 2, /deliver: Deliver through chat: write deliver with server chat and tool post_message, its sent pointing into what post_message answers, and replies with tool thread_replies; learn what each tool takes with introspect, and call post_message with execute once the person agrees.';

const namingTheChatAndTheAgent: unknown = expect.stringMatching(
  /deliver: agent holds the request for an agent, .* This playbook can send a request and read its replies through the tool server chat \(post_message, thread_replies\); a connection can also be added with search and add_connection\.$/u,
);

describe('episode 11: asked to have the owner approve a draft, without saying where', () => {
  it('asks the person where the owner should be asked, choosing among the tool servers that can carry it and the agent way, and is refused in the words of the chat they chose', async () => {
    const { answer, elicited } = await meetings.answeringForms(savingIt, { content: { choice: 'tool_server:chat' } });

    expect(elicited).toMatchObject([
      {
        mode: 'form',
        message: 'Where should the owner be asked?',
        requestedSchema: {
          properties: {
            choice: {
              oneOf: [
                { const: 'tool_server:chat', title: 'chat' },
                { const: 'agent', title: 'An agent, such as this one' },
              ],
            },
          },
        },
      },
    ]);
    expect(problemIn(answer)).toMatchObject({ errors: [{ pointer: '/source', detail: throughTheChat }] });
  });

  it('is refused, for a client that answers no form, with the tool servers that can carry it and the agent way, which the agent asks the person about in words', async () => {
    const refused = await meetings.onMcp((session) => session.callTool('create_definition', savingIt.arguments));

    expect(problemIn(refused)).toMatchObject({ errors: [{ pointer: '/source', detail: namingTheChatAndTheAgent }] });
  });
});
