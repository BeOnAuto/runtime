import { once } from 'node:events';
import { createServer } from 'node:net';

import { rolesImported } from '@on.auto/access-control';
import { signInScopes } from '@on.auto/identity';
import type { FakeIssuer } from '@on.auto/identity/testing';
import { ledgerLayer } from '@on.auto/ledger/sqlite';
import { Ledger, OrgWriter, streamPrefixOfOrg } from '@on.auto/operations';
import { Effect, ManagedRuntime } from 'effect';

import { tcpPort } from '../lifecycle/http-server.ts';

export async function aPortNothingListensOn(): Promise<number> {
  const probe = createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = tcpPort(probe.address());
  probe.close();
  await once(probe, 'close');
  return port;
}

export async function importedBeforeTheRelease(fileName: string): Promise<void> {
  const runtime = ManagedRuntime.make(ledgerLayer({ fileName }));
  try {
    await runtime.runPromise(
      Effect.flatMap(Effect.service(Ledger), (ledger) =>
        rolesImported(
          'acme',
          [
            { person: 'user|ada', roleKey: 'org:admin' },
            { person: 'user|priya', roleKey: 'org:member' },
          ],
          { at: '2026-11-14T09:00:00.000Z', by: 'runtime' },
        ).pipe(
          Effect.provideService(OrgWriter, {
            execute: (stream, decider, command, lineage) =>
              ledger.execute(`${streamPrefixOfOrg({ org: 'acme' })}${stream}`, decider, command, lineage),
          }),
        ),
      ),
    );
  } finally {
    await runtime.dispose();
  }
}

export function tokenOf(issuer: FakeIssuer, audience: string, subject: string): Promise<string> {
  const seconds = Math.floor(Date.now() / 1000);
  return issuer.sign({
    iss: issuer.issuer,
    sub: subject,
    name: subject,
    aud: audience,
    iat: seconds,
    exp: seconds + 300,
    org_id: 'acme',
    scope: signInScopes.join(' '),
  });
}
