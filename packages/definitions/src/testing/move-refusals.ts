import { PlaybookAdmission, PlaybookContext, PlaybookReader, playbookLedgerOf } from '@on.auto/operations';
import { Context, Effect } from 'effect';

import { knownCapabilities } from '../capability/known-capabilities.ts';
import { checkedMove, type MoveAsked } from '../moving/move-checks.ts';
import { connections, movingCapabilities, started, type Definitions } from './moving.ts';

const checking = { known: knownCapabilities(movingCapabilities), started, connections };

export async function recordOfTheRefusal(definitions: Definitions, asked: Omit<MoveAsked, 'to'>): Promise<unknown> {
  const { service } = definitions.ledger;
  const alpha = { org: 'acme', playbook: 'alpha' };
  const readerOf = (playbook: string) =>
    Context.get(playbookLedgerOf(service, { org: 'acme', playbook }), PlaybookReader);
  const admitting = {
    admitted: (playbook: string) => Effect.succeed({ address: { org: 'acme', playbook }, reader: readerOf(playbook) }),
  };
  const refusal = await Effect.runPromise(
    Effect.flip(
      checkedMove(checking, { to: 'beta', ...asked }).pipe(
        Effect.provideContext(playbookLedgerOf(service, alpha)),
        Effect.provideService(PlaybookContext, alpha),
        Effect.provideService(PlaybookAdmission, admitting),
      ),
    ),
  );
  const record: unknown = Reflect.get(new Object(refusal), 'record');
  return record;
}
