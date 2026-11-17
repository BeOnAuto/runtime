import { listedTools, withMcpSession, type ListedTool } from '@on.auto/api/testing';
import { Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { servingReasoningWithGoals } from '../testing/settings/goals-kept.ts';

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

  it('say in create_playbook, update_playbook and get_playbook that they carry goals', () => {
    expect(
      ['create_playbook', 'update_playbook', 'get_playbook'].map((name) => /goals/u.test(descriptionOf(name))),
    ).toEqual([true, true, true]);
  });
});
