import { toolNamesIn, withMcpSession } from '@on.auto/api/testing';
import { createApiKey } from '@on.auto/identity';
import { defaultOrg } from '@on.auto/openid-connect';
import { allPermissions } from '@on.auto/operations';
import { serveFakeMcp, type FakeMcpServer } from '@on.auto/tool-servers/served-fakes';
import { Schema } from 'effect';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { personSigningIn, type PersonSigningIn } from '../sign-in/person-signing-in.ts';
import { connectionsOnLoopback } from '../testing/servers/loopback-connections.ts';
import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const connections = `/v1/orgs/${defaultOrg}/connections`;

const builder = createApiKey({ id: 'builder', org: defaultOrg, permissions: allPermissions, playbooks: '*' });

let notesServer: FakeMcpServer;

beforeAll(async () => {
  notesServer = await serveFakeMcp();
});

afterAll(async () => {
  await notesServer.close();
});

function notes() {
  return { name: 'notes', type: 'mcp', entry: { url: notesServer.url }, credential: { kind: 'none' } };
}

const AddedSchema = Schema.Struct({ id: Schema.String, connect: Schema.Struct({ url: Schema.String }) });

const LinkSchema = Schema.Struct({ token: Schema.String, server: Schema.String });

function linkOf(url: string) {
  return Schema.decodeUnknownSync(LinkSchema)(Object.fromEntries(new URL(url).searchParams));
}

let server: ReasoningServer | undefined;

afterEach(async () => {
  await server?.stop();
});

async function signedInServer(environment: Readonly<Record<string, string>> = {}) {
  const signing = await personSigningIn();
  const served = await servingReasoning([], { ...signing.environment, ...environment });
  server = served;
  return {
    signing,
    served,
    tokenOf: (who: string, scopes?: readonly string[]) => signing.tokenAt(served.origin, who, scopes),
  };
}

async function graceMadeAnEditorBy(admin: string, signing: PersonSigningIn, served: ReasoningServer) {
  const signedIn = await signing.tokenAt(served.origin, 'Grace');
  await served.call('PUT', `/v1/orgs/${defaultOrg}/role-assignments/${signing.personOf('Grace')}/editor`, {
    key: admin,
  });
  return signedIn;
}

function linkRoutesOf(id: string, token: string) {
  return [
    ['GET', `${connections}/${id}/link/${token}`, undefined],
    ['POST', `${connections}/${id}/approve`, { token }],
    ['POST', `${connections}/${id}/credential`, { token, value: 'Bearer notes-0f3c' }],
    ['POST', `${connections}/${id}/consent`, { token }],
    ['POST', `${connections}/${id}/consent/code`, { token, state: 'state', code: 'code' }],
  ] as const;
}

function grantedOnly(signing: PersonSigningIn, origin: string, ...permissions: readonly string[]): Promise<string> {
  return signing.tokenAt(origin, 'Ada', ['user:org:read', ...permissions]);
}

async function linusMadeAnAdminBy(admin: string, signing: PersonSigningIn, served: ReasoningServer) {
  const signedIn = await signing.tokenAt(served.origin, 'Linus');
  await served.call('PUT', `/v1/orgs/${defaultOrg}/role-assignments/${signing.personOf('Linus')}/admin`, {
    key: admin,
  });
  return signedIn;
}

const AnswerSchema = Schema.Record(Schema.String, Schema.Unknown);

const RequestedSchema = Schema.Struct({ id: Schema.String, request: Schema.Struct({ requested_by: Schema.String }) });

describe('a connection on a runtime that signs people in, over HTTP', () => {
  it('links to the page with PUBLIC_URL as the server, is approved by any admin, and is refused to an editor for their role', async () => {
    const { signing, served, tokenOf } = await signedInServer(connectionsOnLoopback);
    const ada = await tokenOf('Ada');
    const grace = await graceMadeAnEditorBy(ada, signing, served);
    const linus = await linusMadeAnAdminBy(ada, signing, served);

    const answer = await served.call('POST', connections, { key: ada, body: notes() });
    const { id, connect } = Schema.decodeUnknownSync(AddedSchema)(answer.body);
    const { token, server: named } = linkOf(connect.url);
    const byGrace = await served.call('POST', `${connections}/${id}/approve`, { key: grace, body: { token } });
    const byLinus = await served.call('POST', `${connections}/${id}/approve`, { key: linus, body: { token } });

    expect(answer).toMatchObject({ status: 201, body: { added_by: { id: `person:${signing.personOf('Ada')}` } } });
    expect(named).toBe(signing.publicUrl);
    expect(byGrace).toMatchObject({ status: 403, body: { kind: 'permission_denied' } });
    expect(byLinus).toMatchObject({
      status: 200,
      body: { status: 'connected', connected_by: { id: `person:${signing.personOf('Linus')}` } },
    });
  });

  it('added by an editor, is recorded as their request with no link, which an admin then reconnects and removes', async () => {
    const { signing, served, tokenOf } = await signedInServer(connectionsOnLoopback);
    const ada = await tokenOf('Ada');
    const grace = await graceMadeAnEditorBy(ada, signing, served);

    const asked = await served.call('POST', connections, { key: grace, body: notes() });
    const { id, request } = Schema.decodeUnknownSync(RequestedSchema)(asked.body);
    const refused = await served.call('POST', `${connections}/${id}/link`, { key: grace, body: {} });
    const relinked = await served.call('POST', `${connections}/${id}/link`, { key: ada, body: {} });
    const removed = await served.call('DELETE', `${connections}/${id}`, { key: ada });

    expect([asked.status, request.requested_by]).toEqual([201, `person:${signing.personOf('Grace')}`]);
    expect(asked.body).not.toHaveProperty('connect');
    expect(refused).toMatchObject({ status: 403, body: { kind: 'permission_denied' } });
    expect([relinked.status, Schema.decodeUnknownSync(AddedSchema)(relinked.body).id]).toEqual([200, id]);
    expect(removed).toMatchObject({ status: 200, body: { id, status: 'removed' } });
  });
});

describe('a connection on a runtime that signs people in, through an editor’s agent over MCP', () => {
  it('is asked for as a request, with no link, and the tools that reconnect or remove one are not offered', async () => {
    const { signing, served, tokenOf } = await signedInServer(connectionsOnLoopback);
    const ada = await tokenOf('Ada');
    await graceMadeAnEditorBy(ada, signing, served);
    const gracesAgent = await signing.agentTokenAt(served.origin, 'Grace');

    const { offered, asked } = await withMcpSession(
      'current revision',
      { url: `${served.origin}/mcp`, headers: { authorization: `Bearer ${gracesAgent}` } },
      async (session) => ({
        offered: toolNamesIn(await session.listTools()),
        asked: await session.callTool('add_connection', { ...notes(), name: 'notes-asked' }),
      }),
    );

    expect(
      ['add_connection', 'reconnect_connection', 'remove_connection'].map((tool) => offered.includes(tool)),
    ).toEqual([true, false, false]);
    expect(asked).toMatchObject({ structuredContent: { name: 'notes-asked', request: { message: null } } });
    expect(asked.structuredContent).not.toHaveProperty('connect');
  });
});

describe('the playbooks named as a connection is approved on a runtime that signs people in', () => {
  it('are recorded with an admin’s approval, and the approval an editor tries changes nothing', async () => {
    const { signing, served, tokenOf } = await signedInServer(connectionsOnLoopback);
    const ada = await tokenOf('Ada');
    const grace = await graceMadeAnEditorBy(ada, signing, served);
    const answer = await served.call('POST', connections, { key: ada, body: notes() });
    const { id, connect } = Schema.decodeUnknownSync(AddedSchema)(answer.body);
    const { token } = linkOf(connect.url);

    const byGrace = await served.call('POST', `${connections}/${id}/approve`, {
      key: grace,
      body: { token, playbooks: ['alpha'] },
    });
    const afterGrace = await served.call('GET', `${connections}/${id}`, { key: ada });
    const byAda = await served.call('POST', `${connections}/${id}/approve`, {
      key: ada,
      body: { token, playbooks: ['alpha'] },
    });

    expect(byGrace).toMatchObject({ status: 403 });
    expect(afterGrace).toMatchObject({ status: 200, body: { status: 'pending' } });
    expect(afterGrace.body).not.toHaveProperty('entry.playbooks');
    expect(byAda).toMatchObject({ status: 200, body: { status: 'connected', entry: { playbooks: ['alpha'] } } });
  });
});

describe('a server on loopback on a runtime that signs people in', () => {
  it('is refused, since only a local runtime takes it unnamed', async () => {
    const { served, tokenOf } = await signedInServer();
    const ada = await tokenOf('Ada');
    const onLoopback = { ...notes(), entry: { url: 'http://127.0.0.1:8443/mcp' } };

    expect(await served.call('POST', connections, { key: ada, body: onLoopback })).toMatchObject({
      status: 403,
      body: {
        detail:
          'A connection may not reach the host 127.0.0.1, a loopback address, unless its operator names the host in connections.allowed_hosts',
      },
    });
  });

  it('is refused to a key, since no person would approve it', async () => {
    const { served } = await signedInServer({ API_KEYS: JSON.stringify([builder.entry]) });

    expect(await served.call('POST', connections, { key: builder.key, body: notes() })).toMatchObject({
      status: 403,
      body: {
        detail:
          'A connection is added by a person, through an agent signed in as them, and a key cannot add or reconnect one',
      },
    });
  });
});

describe('the link of a connection on a runtime that signs people in', () => {
  it('answers its five routes 403 to a person who granted no org:write, and leaves it open to the one who did', async () => {
    const { signing, served, tokenOf } = await signedInServer(connectionsOnLoopback);
    const adder = await tokenOf('Ada');
    const added = await served.call('POST', connections, { key: adder, body: notes() });
    const { id, connect } = Schema.decodeUnknownSync(AddedSchema)(added.body);
    const { token } = linkOf(connect.url);
    const withoutOrgWrite = [
      await grantedOnly(signing, served.origin, 'org:read'),
      await grantedOnly(signing, served.origin, 'playbook:read'),
      await grantedOnly(signing, served.origin, 'playbook:write'),
    ];

    const refused = await Promise.all(
      withoutOrgWrite.flatMap((key) =>
        linkRoutesOf(id, token).map(
          async ([method, path, body]) => (await served.call(method, path, { key, body })).status,
        ),
      ),
    );
    const approvedByWriter = await served.call('POST', `${connections}/${id}/approve`, {
      key: await grantedOnly(signing, served.origin, 'org:write'),
      body: { token },
    });

    expect(refused).toEqual(Array.from({ length: 15 }, () => 403));
    expect(approvedByWriter).toMatchObject({ status: 200, body: { status: 'connected' } });
  });
});

describe('a connection on a runtime of keys alone', () => {
  it('is refused, since the runtime signs in no person to approve it, and says what to set', async () => {
    server = await servingReasoning([], { API_KEYS: JSON.stringify([builder.entry]) });

    expect(await server.call('POST', connections, { key: builder.key, body: notes() })).toMatchObject({
      status: 403,
      body: {
        detail:
          'This runtime signs nobody in, so no person can approve a connection: set PUBLIC_URL, or add the server to the configuration',
      },
    });
  });
});

describe('the providers the search of an org lists on a runtime that signs people in', () => {
  it('are left out for a key and for a person who may only read, and listed to a person who may add', async () => {
    const { signing, served, tokenOf } = await signedInServer({ API_KEYS: JSON.stringify([builder.entry]) });
    const reader = await grantedOnly(signing, served.origin, 'org:read');
    const adder = await tokenOf('Ada');

    const answers = await Promise.all(
      [builder.key, reader, adder].map((key) =>
        served.call('GET', `/v1/orgs/${defaultOrg}/tool-servers/search`, { key }),
      ),
    );

    expect(
      answers.map(({ status, body }) => [status, Object.keys(Schema.decodeUnknownSync(AnswerSchema)(body))]),
    ).toEqual([
      [200, ['servers', 'tools', 'scopes']],
      [200, ['servers', 'tools', 'scopes']],
      [200, ['servers', 'tools', 'scopes', 'providers']],
    ]);
  });
});
