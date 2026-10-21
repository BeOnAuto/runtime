import { plainTextIn, problemIn } from '@on.auto/api/testing';
import { Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  descriptionIn,
  sentenceNaming,
  servingMeetings,
  type MeetingsServer,
} from '../testing/interaction-servers/meetings-server.ts';

let meetings: MeetingsServer;

beforeAll(async () => {
  meetings = await servingMeetings([]);
});

afterAll(async () => {
  await meetings.stop();
});

const ArgumentsSchema = Schema.Struct({
  properties: Schema.Struct({ playbook: Schema.Struct({ description: Schema.String }) }),
  required: Schema.optionalKey(Schema.Array(Schema.String)),
});

function playbookArgumentOf(tool: string) {
  return Schema.decodeUnknownSync(ArgumentsSchema)(
    meetings.surfaces.tools.find(({ name }) => name === tool)?.inputSchema,
  );
}

const SearchedServersSchema = Schema.Struct({
  servers: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)),
});

function fieldsOfEachServer(found: unknown): readonly (readonly string[])[] {
  return Schema.decodeUnknownSync(SearchedServersSchema)(found).servers.map((server) => Object.keys(server));
}

const aSummary: unknown = expect.any(String);

const searchThatReads: unknown = expect.arrayContaining([
  { server: 'slack', tool: 'search', summary: aSummary, read_only: true },
]);

async function askedBeforeAndAfterThePlaybookIsMade() {
  const inOrg = await meetings.onMcp((session) => session.callTool('search', {}));
  await meetings.onMcp((session) => session.callTool('create_playbook', { playbook: 'meetings', name: 'Meetings' }));
  const inPlaybook = await meetings.onPlaybook('meetings', (session) => session.callTool('search', {}));
  return { inOrg, inPlaybook };
}

describe('episode 9: asked for the tool servers on the connection of the whole org, without naming a playbook', () => {
  it('finds the playbook optional, and what the tool answers without it, in the served surfaces', () => {
    const { required = [], properties } = playbookArgumentOf('search');

    expect(required).not.toContain('playbook');
    expect(properties.playbook.description).toContain('without it, every tool server of the org');
    expect(sentenceNaming(descriptionIn(meetings.surfaces, 'search'), 'Without `playbook`')).toBe(
      'Without `playbook` it searches every tool server of the org, with the playbooks each serves.',
    );
  });

  it('is answered, before the playbook is made, with the tool servers of the org and the playbooks each serves, and on the playbook endpoint with those of the playbook', async () => {
    const { inOrg, inPlaybook } = await askedBeforeAndAfterThePlaybookIsMade();

    expect(inOrg.isError).not.toBe(true);
    expect(inOrg.structuredContent).toMatchObject({
      servers: [
        { name: 'notes', playbooks: ['meetings'], because: 'key_refused' },
        { name: 'slack', playbooks: ['meetings'] },
      ],
      tools: searchThatReads,
    });
    expect(plainTextIn(inOrg)).toMatch(
      /^The playbooks of this org may use 2 tool servers\. “notes”, for the playbook “meetings”, did not accept the key/u,
    );
    expect(inPlaybook.structuredContent).toMatchObject({
      servers: [
        { name: 'notes', because: 'key_refused' },
        { name: 'slack', tool_count: 14 },
      ],
      tools: searchThatReads,
    });
    expect(fieldsOfEachServer(inPlaybook.structuredContent).map((fields) => fields.includes('playbooks'))).toEqual([
      false,
      false,
    ]);
    expect(plainTextIn(inPlaybook)).toMatch(/^This playbook's functions may use 2 tool servers\. /u);
  });
});

async function askedForAMissingPlaybook() {
  return {
    onMcp: await meetings.onMcp((session) => session.callTool('search', { playbook: 'nowhere' })),
    onItsEndpoint: await meetings.onPlaybook('nowhere', (session) => session.callTool('search', {})),
  };
}

describe('the tool servers of a playbook the org does not have', () => {
  it('are refused on /mcp as on the playbook endpoint, not_found in the same words', async () => {
    const { onMcp, onItsEndpoint } = await askedForAMissingPlaybook();

    expect(problemIn(onMcp)).toMatchObject({
      status: 404,
      reason: 'not_found',
      detail: 'There is no playbook nowhere in this org',
    });
    expect(problemIn(onMcp)).toEqual(problemIn(onItsEndpoint));
    expect(plainTextIn(onMcp)).toBe(plainTextIn(onItsEndpoint));
  });
});
