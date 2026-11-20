import { describe, expect, it, onTestFinished } from 'vitest';

import { compositionRoot } from '../composition/composition-root.ts';
import { startServer } from '../lifecycle/lifecycle.ts';
import { personSigningIn } from '../sign-in/person-signing-in.ts';
import { aPortNothingListensOn } from '../testing/processes/free-port.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { importedBeforeTheRelease } from './roles-of-an-org.ts';

async function signingIn() {
  const ledger = temporaryLedger();
  const signing = await personSigningIn();
  const [ada, priya] = [signing.personOf('Ada'), signing.personOf('Priya')];
  await importedBeforeTheRelease(ledger.fileName, [
    { person: ada, roleKey: 'org:admin' },
    { person: priya, roleKey: 'org:member' },
  ]);
  const port = await aPortNothingListensOn();
  const origin = `http://127.0.0.1:${port}`;
  const server = await startServer(
    { HOST: '127.0.0.1', PORT: String(port), LEDGER_FILE: ledger.fileName, ...signing.environment },
    compositionRoot,
  );
  onTestFinished(async () => {
    await server.stop();
    ledger.remove();
  });
  const tokens = { Ada: await signing.tokenAt(origin, 'Ada'), Priya: await signing.tokenAt(origin, 'Priya') };
  const asked = async (who: keyof typeof tokens, method: string, path: string) => {
    const answer = await fetch(`${origin}/v1/orgs/default${path}`, {
      method,
      headers: { authorization: `Bearer ${tokens[who]}` },
    });
    return { status: answer.status, body: await answer.json() };
  };
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
