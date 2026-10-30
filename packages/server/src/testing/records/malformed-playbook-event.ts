import { ledgerLayer } from '@on.auto/ledger/sqlite3';
import { ActedContextSchema, Ledger, factOf, type Decided, type Decider } from '@on.auto/operations';
import { playbooksStreamOfOrg } from '@on.auto/playbooks';
import { Effect, ManagedRuntime, Result, Schema } from 'effect';

const MalformedPlaybook = factOf('playbook_created', Schema.Struct({ playbook: Schema.Number }), ActedContextSchema);

type Malformed = typeof MalformedPlaybook.Type;

const malformedRegistry: Decider<readonly Malformed[], Decided<Malformed>, Malformed> = {
  initialState: [],
  evolve: (written, event) => [...written, event],
  decide: (event) => Result.succeed([event]),
  context: () => ({ by: 'acme-admin', at: '2026-10-01T09:00:00.000Z' }),
  eventSchema: MalformedPlaybook,
};

export async function appendMalformedPlaybookEvent(fileName: string, org: string): Promise<void> {
  const runtime = ManagedRuntime.make(ledgerLayer({ fileName }));
  await runtime.runPromise(
    Effect.gen(function* () {
      const ledger = yield* Ledger;
      yield* ledger.execute(playbooksStreamOfOrg(org), malformedRegistry, {
        type: 'playbook_created',
        data: { playbook: 42 },
      });
    }),
  );
  await runtime.dispose();
}
