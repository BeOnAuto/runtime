import { listedTools, plainTextIn, withMcpSession, type ListedTool } from '@on.auto/api/testing';
import { Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { goalsText, goalsTextGaps, servingReasoningWithGoals } from '../testing/settings/goals-kept.ts';

let server: ReasoningServer;
let tools: readonly ListedTool[];

beforeAll(async () => {
  server = await servingReasoningWithGoals([]);
  tools = await withMcpSession('current revision', { url: `${server.origin}/mcp`, headers: {} }, async (session) =>
    listedTools(await session.listTools()),
  );
});

afterAll(async () => {
  await server.stop();
});

const InputSchema = Schema.Struct({
  properties: Schema.optionalKey(Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown))),
  required: Schema.optionalKey(Schema.Array(Schema.String)),
});

const inputOf = Schema.decodeUnknownSync(InputSchema);

const sentencesOf = (text: string): number => text.split(/(?<=[.!?])\s+(?=[A-Z`])/u).length;

const descriptionOf = (name: string): string => tools.find((tool) => tool.name === name)?.description ?? '';

const goalsArgumentOf = ({ inputSchema }: ListedTool) => inputOf(inputSchema).properties?.['goals'];

const isOutsideItsBounds = ({ description = '' }: ListedTool): boolean =>
  description.length >= 800 || sentencesOf(description) < 3 || sentencesOf(description) > 8;

describe('the tools of /mcp on a server that keeps goals', () => {
  it('stay forty-two, each under 800 characters, in three to eight sentences', () => {
    expect(tools).toHaveLength(42);
    expect(tools.filter((tool) => isOutsideItsBounds(tool)).map(({ name }) => name)).toEqual([]);
  });

  it('take the whole list of goals as an optional string of at most 16384 characters in create_playbook and update_playbook, and in no other tool', () => {
    const takers = tools.filter((tool) => goalsArgumentOf(tool) !== undefined);

    expect(takers.map(({ name }) => name)).toEqual(['create_playbook', 'update_playbook']);
    expect(takers.map((tool) => goalsArgumentOf(tool))).toEqual([
      expect.objectContaining({ type: 'string', maxLength: 16_384 }),
      expect.objectContaining({ type: 'string', maxLength: 16_384 }),
    ]);
    expect(takers.map((tool) => String(goalsArgumentOf(tool)?.['description']).length < 300)).toEqual([true, true]);
    expect(takers.map(({ inputSchema }) => inputOf(inputSchema).required?.includes('goals'))).not.toContain(true);
  });

  it('say in create_playbook, update_playbook and get_playbook that they carry goals, and in update_playbook that goals are always the whole list', () => {
    expect(
      ['create_playbook', 'update_playbook', 'get_playbook'].map((name) => /goals/u.test(descriptionOf(name))),
    ).toEqual([true, true, true]);
    expect(descriptionOf('update_playbook')).toContain(
      '`goals` is always the whole list: a goal missing from it is removed, and one that has been judged must stay, with `retired: true`.',
    );
  });
});

const firstSentenceOf = (name: string): string | undefined => descriptionOf(name).split(/(?<=[.!?])\s+(?=\S)/u)[0];

function calledOnMcp(name: string, input: Readonly<Record<string, unknown>>): Promise<string> {
  return withMcpSession('current revision', { url: `${server.origin}/mcp`, headers: {} }, async (session) =>
    plainTextIn(await session.callTool(name, input)),
  );
}

describe('the words of the goals an agent reads first on a server that keeps goals', () => {
  it('lead each description that touches goals with what an agent needs of them', () => {
    expect(
      ['create_playbook', 'update_playbook', 'get_playbook', 'create_definition', 'list_playbooks', 'get_guide'].map(
        (name) => firstSentenceOf(name),
      ),
    ).toEqual([
      'First ask the person what this playbook should achieve for them, how they will know it worked (a number, a target, their words for a pass and a fail), and what to tell them, when and where.',
      'Changes the goals, the name, the description or the page of an active playbook and returns it with what its goals still lack.',
      'Reads one playbook by its id, active or retired, with its goals, what they still lack and the source of its page.',
      'Saves a new function or workflow from its document, without running it; a workflow needs a `contributes` list, as the goals guide says.',
      'Before you make anything for the person, ask what it should achieve for them, how they will know it worked, and what they want to be told and where, as the goals guide says.',
      'Read the start guide before anything else, and the goals guide before you make anything: here a playbook is made only with goals learned from the person.',
    ]);
  });

  it('answer a create with the link to show the person and the gaps the goals still have, and a read with the same gaps', async () => {
    const created = await calledOnMcp('create_playbook', { playbook: 'worded', name: 'Worded', goals: goalsText });
    const read = await calledOnMcp('get_playbook', { playbook: 'worded' });
    const gaps = `Its goals still have ${String(goalsTextGaps.length)} gaps, each saying what is missing and who puts it right.`;

    expect(created).toBe(
      `Created the playbook “Worded”. Stop here: give the person the \`studio\` link. If these are the goals the person said yes to, record that yes with agree_playbook_goals; if not, ask again. Build nothing before that call. ${gaps}`,
    );
    expect(read).toBe(`Found the playbook “Worded”. ${gaps}`);
  });
});

describe('the search of the org on a server that keeps goals', () => {
  it('leads an answer that found no tool with where to start and what to ask the person before anything is made', async () => {
    expect(await calledOnMcp('search', { terms: 'experiments customers' })).toMatch(
      /^To do work for the person here, read the guide start with get_guide, and before you make anything ask them what it should achieve for them, how they will know it worked, and what they want to be told and where\. /u,
    );
  });
});
