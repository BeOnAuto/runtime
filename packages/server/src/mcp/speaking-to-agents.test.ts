import { plainTextIn, type McpSession } from '@on.auto/api/testing';
import { internalTermsIn } from '@on.auto/operations/testing';
import { answers, jsonResult } from '@on.auto/reasoning/testing';
import { Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  descriptionIn,
  sentenceNaming,
  sentencesOf,
  servingMeetings,
  type MeetingsServer,
  type Surfaces,
} from '../testing/interaction-servers/meetings-server.ts';
import { liveOverMcp } from '../testing/servers/recall-server.ts';

let meetings: MeetingsServer;

let surfaces: Surfaces;

function onMcp<T>(use: (session: McpSession) => Promise<T>): Promise<T> {
  return meetings.onMcp(use);
}

beforeAll(async () => {
  meetings = await servingMeetings([answers(jsonResult({ posted: 'The notes of the standup, to the team channel' }))]);
  ({ surfaces } = meetings);
});

afterAll(async () => {
  await meetings.stop();
});

function descriptionOf(tool: string): string {
  return descriptionIn(surfaces, tool);
}

const PromptSchema = Schema.Struct({
  messages: Schema.Array(Schema.Struct({ content: Schema.Struct({ text: Schema.optionalKey(Schema.String) }) })),
});

const meetingsPlaybook = { playbook: 'meetings', name: 'Meetings', description: "Keeps the team's meeting notes" };

const posting = [
  '---',
  'model: anthropic/claude-sonnet-4-5',
  'description: Posts the notes of a meeting to the team',
  'tools: [notes/search]',
  '---',
  'Post the notes of {{ input.meeting }}.',
].join('\n');

describe('episode 1: asked "what is a playbook?"', () => {
  it('is answered by the first three sentences of the instructions, without any tool or rule', () => {
    const answer = sentencesOf(surfaces.instructions).slice(0, 3).join(' ');

    expect(answer).toBe(
      'Auto Runtime executes playbooks; Studio manages them; your agent is a separate client. A playbook contains one brain (its reusable functions) and workflows. The brain shares its lifecycle.',
    );
    expect(internalTermsIn(answer)).toEqual([]);
    expect(answer).not.toMatch(/[a-z]+_[a-z_]+|\bid\b/u);
  });
});

describe('episode 2: asked to create a playbook for meetings', () => {
  it('finds no rule of an id beyond the argument, and words that say what the playbook is for and what comes next', async () => {
    const created = await onMcp((session) => session.callTool('create_playbook', meetingsPlaybook));

    expect(sentencesOf(descriptionOf('create_playbook')).filter((sentence) => /\bid\b/u.test(sentence))).toEqual([
      'Use it when the person wants a new playbook; list_playbooks shows the playbooks that exist, and an id that is taken or retired is refused.',
      "`playbook` is the id every tool inside the playbook takes, `name` is what people call it, and `description` says what the playbook is for, in the person's words.",
    ]);
    expect(descriptionOf('create_playbook')).not.toMatch(/lowercase|never changes|immutable|reused/u);
    expect(plainTextIn(created)).toBe(
      "Created the playbook “Meetings”. What it is for: Keeps the team's meeting notes. Its functions and workflows come next.",
    );
  });
});

describe('episode 3: asked to use Slack', () => {
  it('finds search in the instructions, and its answer names each tool server', async () => {
    const listed = await onMcp((session) => session.callTool('search', { playbook: 'meetings' }));

    expect(sentenceNaming(surfaces.instructions, 'search finds')).toBe(
      'A reasoning function names a model that list_models lists and may name tools that search finds.',
    );
    expect(plainTextIn(listed)).toMatch(/^This playbook's functions may use 2 tool servers\. /u);
    expect(plainTextIn(listed)).toContain('“slack” offers');
    expect(plainTextIn(listed)).toContain(
      '“notes” did not accept the key this server gives it, so whoever runs this server can check that key.',
    );
  });
});

const postingWhatItPosted = [
  '---',
  'model: anthropic/claude-sonnet-4-5',
  'description: Posts the notes of a meeting to the team, and answers what it posted',
  'output:',
  '  format: json',
  '  schema: {type: object, properties: {posted: {type: string}}, required: [posted]}',
  '---',
  'Post the notes of {{ input.meeting }}, and answer what you posted.',
].join('\n');

const rememberingWhatWasPosted = [
  '---',
  'description: What post-notes answered it posted, oldest first',
  'language: typescript',
  'source:',
  '  events:',
  '    - type: run_succeeded',
  '      subject: reasoning/post-notes',
  'view:',
  '  initial: []',
  '  schema: {type: array, items: {type: string}}',
  '---',
  'export function fold(view: View, event: Event): View {',
  '  const data = event.data as { output: { posted: string } };',
  '  return [...view, data.output.posted];',
  '}',
].join('\n');

const inPosts = { playbook: 'posts' };

async function rememberedOverMcp(session: McpSession) {
  await session.callTool('create_playbook', { ...inPosts, name: 'Posts' });
  await session.callTool('create_definition', {
    ...inPosts,
    type: 'reasoning',
    name: 'post-notes',
    source: postingWhatItPosted,
  });
  await session.callTool('run_definition', {
    ...inPosts,
    type: 'reasoning',
    name: 'post-notes',
    input: { meeting: 'the standup' },
  });
  await session.callTool('create_definition', {
    ...inPosts,
    type: 'recall',
    name: 'posted',
    source: rememberingWhatWasPosted,
  });
  await liveOverMcp(session, { ...inPosts, name: 'posted' }, 1);
  return session.callTool('run_definition', { ...inPosts, type: 'recall', name: 'posted' });
}

describe('episode 4: asked to make the playbook remember what it posted today', () => {
  it('finds what a recall function folds and never folds, and a recipe that says the function must answer what it posted', async () => {
    const prompt = Schema.decodeUnknownSync(PromptSchema)(
      await onMcp((session) => session.getPrompt('remember', { what: 'what it posted today' })),
    );

    expect(sentenceNaming(surfaces.instructions, 'Recall retrieves')).toContain('never run inputs or tool calls.');
    expect(String(prompt.messages[0]?.content.text)).toContain(
      'a function whose job is to post must answer what it posted.',
    );
  });

  it('saves the recall function the recipe describes over the runs of the function that posts, which answers what was posted', async () => {
    const recalled = await onMcp(rememberedOverMcp);

    expect(recalled.structuredContent).toMatchObject({
      status: 'succeeded',
      output: ['The notes of the standup, to the team channel'],
    });
  });
});

describe('episode 5: quoting the tools to a person who does not code', () => {
  it('finds only the words of the terminology in the instructions and in the words of the results', async () => {
    const words = await onMcp(async (session) => {
      await session.callTool('create_playbook', { playbook: 'standups', name: 'Standups' });
      const results = [
        await session.callTool('create_definition', {
          playbook: 'standups',
          type: 'reasoning',
          name: 'post-notes',
          source: posting,
        }),
        await session.callTool('list_definitions', { playbook: 'standups', type: 'reasoning' }),
        await session.callTool('list_runs', { playbook: 'standups' }),
      ];
      return results.map((result) => plainTextIn(result));
    });

    expect(internalTermsIn(surfaces.instructions)).toEqual([]);
    expect(words.flatMap((text) => internalTermsIn(text))).toEqual([]);
  });
});

describe('episode 6: a tool server that refuses its key, and a playbook with no tool server', () => {
  it('says the key was not accepted and that trying again will not help until it is checked, and what to do in the words of an empty listing', async () => {
    const outcome = await onMcp(async (session) => {
      await session.callTool('create_definition', {
        playbook: 'meetings',
        type: 'reasoning',
        name: 'post-notes',
        source: posting,
      });
      return {
        refused: await session.callTool('run_definition', {
          playbook: 'meetings',
          type: 'reasoning',
          name: 'post-notes',
          input: { meeting: 'the standup' },
        }),
        empty: await session.callTool('search', { playbook: 'standups' }),
      };
    });

    expect(plainTextIn(outcome.refused)).toBe(
      'Could not run the reasoning function “post-notes”: a tool server it needs could not be used, because the tool server did not accept the key this server gives it. Nothing was changed. Trying again will not help until whoever runs the server checks the key it gives that tool server.',
    );
    expect(plainTextIn(outcome.empty)).toBe(
      'No tool server serves this playbook, so its functions can call no tools until whoever runs this server sets one up, or a person connects a provider this search lists, with add_connection where your tools include it; the give-tools guide says how.',
    );
  });
});

const ChannelsSchema = Schema.fromJsonString(Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })));

const CalledSchema = Schema.Struct({ structuredContent: Schema.Struct({ text: Schema.String }) });

function channelsIn(called: unknown) {
  return Schema.decodeUnknownSync(ChannelsSchema)(
    Schema.decodeUnknownSync(CalledSchema)(called).structuredContent.text,
  );
}

async function lookedAtOverMcp(session: McpSession) {
  const before = await session.callTool('list_definitions', { playbook: 'meetings', type: 'reasoning' });
  const found = await session.callTool('search', { playbook: 'meetings', server: 'slack', terms: 'search rows' });
  const called = await session.callTool('execute', {
    playbook: 'meetings',
    server: 'slack',
    tool: 'search',
    arguments: { query: 'standups' },
  });
  const after = await session.callTool('list_definitions', { playbook: 'meetings', type: 'reasoning' });
  return { before, found, called, after };
}

describe('episode 8: asked what a gateway-style tool server offers, and then to post to #random', () => {
  it('finds search in the instructions and what execute answers in its description, finds the search tool by its words, calls it, and makes no function to look', async () => {
    const seen = await onMcp(lookedAtOverMcp);

    expect(sentenceNaming(surfaces.instructions, 'search finds')).toBe(
      'A reasoning function names a model that list_models lists and may name tools that search finds.',
    );
    expect(descriptionOf('execute')).toContain(
      "as a run of a reasoning function would call it, and answers what that run's model would see.",
    );
    expect(seen.found.structuredContent).toMatchObject({
      servers: [{ name: 'slack' }],
      tools: [{ server: 'slack', tool: 'search', read_only: true }],
    });
    expect(plainTextIn(seen.found)).toBe(
      "1 tool of this playbook's tool servers matches “search rows”, best first: the search tool of slack.",
    );
    expect(seen.called.structuredContent).toMatchObject({ outcome: 'result', text: 'Found 2 rows for standups.' });
    expect(seen.after.structuredContent).toEqual(seen.before.structuredContent);
    expect(descriptionOf('execute')).toContain('in place of a function made to look');
  });

  it('calls the tool that lists the channels and takes the id of #random from its answer, as the give-tools recipe says', async () => {
    const { prompt, called } = await onMcp(async (session) => ({
      prompt: Schema.decodeUnknownSync(PromptSchema)(await session.getPrompt('give-tools', { server: 'slack' })),
      called: await session.callTool('execute', {
        playbook: 'meetings',
        server: 'slack',
        tool: 'list_channels',
      }),
    }));

    expect(String(prompt.messages[0]?.content.text)).toContain(
      "When a prompt needs an id, such as a channel's, call the tool that lists them and take the id from its answer, confirming the choice with the person.",
    );
    expect(channelsIn(called).find(({ name }) => name === 'random')?.id).toBe('C08RNDM4Q2');
  });
});
