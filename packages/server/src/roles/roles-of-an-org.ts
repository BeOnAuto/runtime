import { rolesImported } from '@on.auto/access-control';
import { ledgerLayer } from '@on.auto/ledger/sqlite';
import { defaultOrg } from '@on.auto/openid-connect';
import { Ledger, OrgWriter, streamPrefixOfOrg } from '@on.auto/operations';
import { Effect, ManagedRuntime } from 'effect';

export interface ImportedRole {
  readonly person: string;
  readonly roleKey: string;
}

export async function importedBeforeTheRelease(fileName: string, roles: readonly ImportedRole[]): Promise<void> {
  const runtime = ManagedRuntime.make(ledgerLayer({ fileName }));
  try {
    await runtime.runPromise(
      Effect.flatMap(Effect.service(Ledger), (ledger) =>
        rolesImported(defaultOrg, roles, { at: '2026-11-14T09:00:00.000Z', by: 'runtime' }).pipe(
          Effect.provideService(OrgWriter, {
            execute: (stream, decider, command, lineage) =>
              ledger.execute(`${streamPrefixOfOrg({ org: defaultOrg })}${stream}`, decider, command, lineage),
          }),
        ),
      ),
    );
  } finally {
    await runtime.dispose();
  }
}
