import { toolNamesIn, withMcpSession } from '@on.auto/api/testing';
import { browserAt } from '@on.auto/openid-connect/testing';
import { describe, expect, it, onTestFinished } from 'vitest';

import { compositionRoot } from '../composition/composition-root.ts';
import { startServer } from '../lifecycle/lifecycle.ts';
import { personSigningIn, type PersonSigningIn } from '../sign-in/person-signing-in.ts';
import { aPortNothingListensOn } from '../testing/processes/free-port.ts';
import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';
import { goalsText } from '../testing/settings/goals-kept.ts';
import { importedBeforeTheRelease } from './roles-of-an-org.ts';

async function servedTo(signing: PersonSigningIn, ledger: TemporaryLedger): Promise<string> {
  const port = await aPortNothingListensOn();
  const server = await startServer(
    { HOST: '127.0.0.1', PORT: String(port), LEDGER_FILE: ledger.fileName, ...signing.environment },
    compositionRoot,
  );
  onTestFinished(async () => {
    await server.stop();
    ledger.remove();
  });
  return `http://127.0.0.1:${port}`;
}

function askingAt(origin: string) {
  return async (token: string, method: string, path: string, body?: unknown) => {
    const authorization = `Bearer ${token}`;
    const answer = await fetch(`${origin}/v1/orgs/default${path}`, {
      method,
      ...(body === undefined
        ? { headers: { authorization } }
        : { headers: { authorization, 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
    return { status: answer.status, body: await answer.json() };
  };
}

async function signingIn() {
  const ledger = temporaryLedger();
  const signing = await personSigningIn();
  const [ada, priya] = [signing.personOf('Ada'), signing.personOf('Priya')];
  await importedBeforeTheRelease(ledger.fileName, [
    { person: ada, roleKey: 'org:admin' },
    { person: priya, roleKey: 'org:member' },
  ]);
  const origin = await servedTo(signing, ledger);
  const tokens = { Ada: await signing.tokenAt(origin, 'Ada'), Priya: await signing.tokenAt(origin, 'Priya') };
  const asking = askingAt(origin);
  const asked = (who: keyof typeof tokens, method: string, path: string) => asking(tokens[who], method, path);
  return { ada, priya, asked };
}

describe('the roles of an org over HTTP, on a runtime that signs people in', () => {
  it('are read from the roles a store recorded before the release that keeps them, and given and listed by its admin alone', async () => {
    const { ada, priya, asked } = await signingIn();

    const given = await asked('Ada', 'PUT', `/role-assignments/${priya}/viewer`);
    const refused = await asked('Priya', 'PUT', `/role-assignments/${ada}/editor`);
    const listed = await asked('Priya', 'GET', '/role-assignments');

    expect(given).toEqual({
      status: 200,
      body: {
        principal: { type: 'person', id: priya },
        scope: { type: 'org', id: 'default' },
        roles: [{ type: 'built_in', id: 'viewer' }],
      },
    });
    expect(refused).toMatchObject({ status: 403 });
    const bothListed: unknown = expect.arrayContaining([
      expect.objectContaining({
        principal: { type: 'person', id: ada },
        role: { type: 'built_in', id: 'admin' },
        source: 'import',
      }),
      expect.objectContaining({
        principal: { type: 'person', id: priya },
        role: { type: 'built_in', id: 'viewer' },
        assigned_by: `person:${ada}`,
      }),
    ]);
    expect(listed).toMatchObject({ status: 200, body: { role_assignments: bothListed, has_more: false } });
  });
});

const aPlaybook = (playbook: string) => ({ playbook, name: playbook, goals: goalsText });

function toolsOfferedAt(origin: string, token: string): Promise<readonly string[]> {
  const connection = { url: `${origin}/mcp`, headers: { authorization: `Bearer ${token}` } };
  return withMcpSession('current revision', connection, async (session) => toolNamesIn(await session.listTools()));
}

describe('every call of a runtime that signs people in, decided by the role each person holds there', () => {
  it('lets the first person to sign in, its admin, change things, holds the next, a viewer, and their agent to reading until the admin gives them more, and answers each what they may do', async () => {
    const signing = await personSigningIn();
    const origin = await servedTo(signing, temporaryLedger());
    const asked = askingAt(origin);
    const ada = await signing.tokenAt(origin, 'Ada');
    const priya = await signing.tokenAt(origin, 'Priya');
    const priyasAgent = await signing.agentTokenAt(origin, 'Priya');

    const madeByTheAdmin = await asked(ada, 'POST', '/playbooks', aPlaybook('alpha'));
    const refusedTheViewer = await asked(priya, 'POST', '/playbooks', aPlaybook('beta'));
    const refusedTheViewersAgent = await asked(priyasAgent, 'POST', '/playbooks', aPlaybook('beta'));
    const readByTheViewer = await asked(priya, 'GET', '/playbooks');
    const mayDo = [(await asked(ada, 'GET', '/caller')).body, (await asked(priya, 'GET', '/caller')).body];
    const offeredAsAViewer = await toolsOfferedAt(origin, priyasAgent);
    const madeAnEditor = await asked(ada, 'PUT', `/role-assignments/${signing.personOf('Priya')}/editor`);
    const madeByTheEditor = await asked(priya, 'POST', '/playbooks', aPlaybook('beta'));
    const offeredAsAnEditor = await toolsOfferedAt(origin, priyasAgent);

    expect([madeByTheAdmin.status, readByTheViewer.status, madeAnEditor.status, madeByTheEditor.status]).toEqual([
      201, 200, 200, 201,
    ]);
    expect([refusedTheViewer, refusedTheViewersAgent]).toMatchObject([
      { status: 403, body: { reason: 'forbidden', kind: 'permission_denied' } },
      { status: 403, body: { reason: 'forbidden', kind: 'permission_denied' } },
    ]);
    expect(mayDo).toEqual([
      { permissions: ['org:read', 'org:write', 'playbook:read', 'playbook:write'] },
      { permissions: ['org:read', 'playbook:read'] },
    ]);
    expect([offeredAsAViewer.includes('list_playbooks'), offeredAsAViewer.includes('create_playbook')]).toEqual([
      true,
      false,
    ]);
    expect(offeredAsAnEditor).toContain('create_playbook');
  });
});

function askingWithABody(origin: string) {
  return async (token: string, method: string, path: string, body?: unknown) => {
    const authorization = `Bearer ${token}`;
    const answer = await fetch(`${origin}/v1/orgs/default${path}`, {
      method,
      ...(body === undefined
        ? { headers: { authorization } }
        : { headers: { authorization, 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
    return { status: answer.status, body: Object.fromEntries(Object.entries(new Object(await answer.json()))) };
  };
}

describe('the members of a runtime that signs people in, over HTTP', () => {
  it('are listed to anyone in the org and offered to their agents, changed and removed by its admin alone, and a member removed is signed out at once and refused when they sign in again', async () => {
    const signing = await personSigningIn();
    const origin = await servedTo(signing, temporaryLedger());
    const asked = askingAt(origin);
    const ada = await signing.tokenAt(origin, 'Ada');
    const priya = await signing.tokenAt(origin, 'Priya');
    const priyasAgent = await signing.agentTokenAt(origin, 'Priya');
    const [theAdmin, theViewer] = [signing.personOf('Ada'), signing.personOf('Priya')];

    const listedToTheViewer = await asked(priya, 'GET', '/members');
    const refusedTheViewer = await asked(priya, 'PUT', `/members/${theAdmin}/role`, { role: 'viewer' });
    const offeredToTheViewersAgent = await toolsOfferedAt(origin, priyasAgent);
    const madeAnEditor = await asked(ada, 'PUT', `/members/${theViewer}/role`, { role: 'editor' });
    const removed = await asked(ada, 'DELETE', `/members/${theViewer}`);
    const askedOnceRemoved = [await asked(priya, 'GET', '/playbooks'), await asked(priyasAgent, 'GET', '/playbooks')];
    const signingInOnceRemoved = await signing.signedInWithTheCookie(origin, 'Priya', 'no-invitation');
    const givenARoleOnceRemoved = await asked(ada, 'PUT', `/members/${theViewer}/role`, { role: 'viewer' });

    const bothViewing = [
      { id: theAdmin, role: 'admin' },
      { id: theViewer, role: 'viewer' },
    ];
    expect(listedToTheViewer).toMatchObject({
      status: 200,
      body: { members: bothViewing, members_total: 2, invitations: [], invitations_total: 0 },
    });
    expect(refusedTheViewer).toMatchObject({ status: 403, body: { reason: 'forbidden', kind: 'permission_denied' } });
    const offered = ['list_members', 'invite_member', 'set_member_role'].map((tool) =>
      offeredToTheViewersAgent.includes(tool),
    );
    expect(offered).toEqual([true, false, false]);
    const asAnEditor = { status: 200, body: { id: theViewer, role: 'editor' } };
    expect([madeAnEditor, removed, ...askedOnceRemoved]).toMatchObject([
      asAnEditor,
      asAnEditor,
      { status: 401 },
      { status: 401 },
    ]);
    expect([signingInOnceRemoved.status, givenARoleOnceRemoved.status]).toEqual([403, 404]);
  });
});

function invitingAt(origin: string) {
  const asked = askingWithABody(origin);
  return {
    asked,
    invited: async (token: string, path: string, emailAddress: string) => {
      const answered = await asked(token, 'POST', path, { email_address: emailAddress });
      return { ...answered, id: String(answered.body['id']), link: String(answered.body['link']) };
    },
  };
}

describe('the invitations of a runtime that signs people in, made by an agent and over HTTP', () => {
  it('give a link that signs in once whoever it reaches, a removed person among them, while an id in its place accepts nothing', async () => {
    const signing = await personSigningIn();
    const origin = await servedTo(signing, temporaryLedger());
    const { asked, invited } = invitingAt(origin);
    const [ada, adasAgent] = [await signing.tokenAt(origin, 'Ada'), await signing.agentTokenAt(origin, 'Ada')];
    await signing.tokenAt(origin, 'Priya');
    await asked(ada, 'DELETE', `/members/${signing.personOf('Priya')}`);

    const offered = await toolsOfferedAt(origin, adasAgent);
    const byTheAgent = await withMcpSession(
      'current revision',
      { url: `${origin}/mcp`, headers: { authorization: `Bearer ${adasAgent}` } },
      (session) => session.callTool('invite_member', { email_address: 'sam@example.com' }),
    );
    const linkOfSam = String(Reflect.get(new Object(byTheAgent.structuredContent), 'link'));
    const toPriya = await invited(ada, '/members/invitations', 'priya@example.com');
    const toLee = await invited(ada, '/members/admin-invitations', 'lee@example.com');
    const byItsId = await signing.signedInWithTheCookie(origin, 'Priya', toLee.id);
    const sam = await signing.signedInCarrying(origin, 'Sam', linkOfSam);
    const priya = await signing.signedInCarrying(origin, 'Priya', toPriya.link);
    const usedAgain = await browserAt(origin, signing.publicUrl).at(linkOfSam);

    expect([offered.includes('invite_member'), byTheAgent.isError === true, toPriya.status, toLee.status]).toEqual([
      true,
      false,
      201,
      201,
    ]);
    const toStudio: unknown = expect.stringContaining(`server=${encodeURIComponent(signing.publicUrl)}`);
    expect([sam.opened.status, sam.opened.headers.get('location')]).toEqual([303, toStudio]);
    expect([byItsId.status, sam.finished.status, priya.finished.status, usedAgain.status]).toEqual([
      403, 303, 303, 404,
    ]);
    expect([sam.stillCarried, priya.stillCarried]).toEqual([false, false]);
    expect(await asked(ada, 'GET', '/members')).toMatchObject({
      body: { members_total: 3, invitations: [{ id: toLee.id, role: 'admin' }] },
    });
  });
});

describe('the invitations of a runtime that signs people in, resent and revoked by its admin over HTTP', () => {
  it('replace a link by a new one and end it, each earlier link working no more', async () => {
    const signing = await personSigningIn();
    const origin = await servedTo(signing, temporaryLedger());
    const { asked, invited } = invitingAt(origin);
    const opened = (link: unknown) => browserAt(origin, signing.publicUrl).at(String(link));
    const ada = await signing.tokenAt(origin, 'Ada');
    const toLee = await invited(ada, '/members/invitations', 'lee@example.com');

    const resent = await asked(ada, 'POST', `/members/invitations/${toLee.id}/resend`);
    const replaced = await opened(toLee.link);
    const revoked = await asked(ada, 'DELETE', `/members/invitations/${String(resent.body['id'])}`);
    const afterTheRevoke = await opened(resent.body['link']);

    expect([resent.status, revoked.status, revoked.body['status']]).toEqual([201, 200, 'revoked']);
    expect([replaced.status, afterTheRevoke.status]).toEqual([404, 404]);
    expect(await asked(ada, 'GET', '/members')).toMatchObject({ body: { invitations: [], invitations_total: 0 } });
  });
});

describe('how people join a runtime that signs people in, set by its admin over HTTP', () => {
  it('is answered to anyone in the org, changed with the role people join with by its admin alone, and decides each next sign-in', async () => {
    const signing = await personSigningIn();
    const origin = await servedTo(signing, temporaryLedger());
    const asked = askingWithABody(origin);
    const [ada, priya] = [await signing.tokenAt(origin, 'Ada'), await signing.tokenAt(origin, 'Priya')];

    const read = await asked(priya, 'GET', '/enrolment');
    const refusedTheViewer = await asked(priya, 'PUT', '/enrolment', { enrolment: 'invitation' });
    const refusedAnAdminAsTheRole = await asked(ada, 'PUT', '/enrolment', {
      enrolment: 'join_without_invitation',
      default_role: 'admin',
    });
    const byInvitation = await asked(ada, 'PUT', '/enrolment', { enrolment: 'invitation', default_role: 'editor' });
    const uninvited = await signing.signedInWithTheCookie(origin, 'Sam', 'no-invitation');
    await asked(ada, 'PUT', '/enrolment', { enrolment: 'join_without_invitation' });
    await signing.tokenAt(origin, 'Lee');

    expect(read).toMatchObject({ status: 200, body: { enrolment: 'join_without_invitation', default_role: 'viewer' } });
    expect([refusedTheViewer.status, refusedAnAdminAsTheRole.status, byInvitation.status, uninvited.status]).toEqual([
      403, 422, 200, 403,
    ]);
    expect(await asked(ada, 'GET', '/members')).toMatchObject({
      body: { members: [{ role: 'admin' }, { role: 'viewer' }, { id: signing.personOf('Lee'), role: 'editor' }] },
    });
  });
});
