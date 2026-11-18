import { describe, expect, it, onTestFinished } from 'vitest';

import { compositionRoot } from '../composition/composition-root.ts';
import { startServer } from '../lifecycle/lifecycle.ts';
import { issuerOverHttps } from '../sign-in/issuer-over-https.ts';
import { aPortNothingListensOn } from '../testing/processes/free-port.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { importedBeforeTheRelease, tokenOf } from './roles-of-an-org.ts';

async function signingIn() {
  const ledger = temporaryLedger();
  await importedBeforeTheRelease(ledger.fileName);
  const issuer = await issuerOverHttps();
  const port = await aPortNothingListensOn();
  const address = `http://localhost:${port}`;
  const server = await startServer(
    {
      HOST: '127.0.0.1',
      PORT: String(port),
      LEDGER_FILE: ledger.fileName,
      IDENTITY_ISSUER: issuer.issuer,
      PUBLIC_URL: address,
    },
    compositionRoot,
  );
  onTestFinished(async () => {
    await server.stop();
    ledger.remove();
  });
  return async (subject: string, method: string, path: string) => {
    const answer = await fetch(`http://127.0.0.1:${port}/v1/orgs/acme${path}`, {
      method,
      headers: { authorization: `Bearer ${await tokenOf(issuer, address, subject)}` },
    });
    return { status: answer.status, body: await answer.json() };
  };
}

describe('the roles of an org over HTTP, on a runtime that signs people in', () => {
  it('are read from the roles a store recorded before the release that keeps them, and given and listed by its admin alone', async () => {
    const asked = await signingIn();

    const given = await asked('user|ada', 'PUT', '/role-assignments/user%7Cpriya/viewer');
    const refused = await asked('user|priya', 'PUT', '/role-assignments/user%7Cada/editor');
    const listed = await asked('user|priya', 'GET', '/role-assignments');

    expect(given).toEqual({
      status: 200,
      body: {
        principal: { type: 'person', id: 'user|priya' },
        scope: { type: 'org', id: 'acme' },
        roles: [{ type: 'built_in', id: 'viewer' }],
      },
    });
    expect(refused).toMatchObject({ status: 403 });
    expect(listed).toMatchObject({
      status: 200,
      body: {
        role_assignments: [
          { principal: { id: 'user|ada' }, role: { id: 'admin' }, source: 'import', assigned_by: 'runtime' },
          { principal: { id: 'user|priya' }, role: { id: 'viewer' }, source: 'manual', assigned_by: 'person:user|ada' },
        ],
        has_more: false,
      },
    });
  });
});
