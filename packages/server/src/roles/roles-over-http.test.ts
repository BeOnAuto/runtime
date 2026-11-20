import { toolNamesIn, withMcpSession } from '@on.auto/api/testing';
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
