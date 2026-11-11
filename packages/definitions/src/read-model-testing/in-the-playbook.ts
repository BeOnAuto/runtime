import {
  PlaybookContext,
  playbookLedgerOf,
  type Ledger,
  type PlaybookAddress,
  type PlaybookReader,
  type PlaybookWriter,
} from '@on.auto/operations';
import { Effect } from 'effect';

const alphaOfAcme: PlaybookAddress = { org: 'acme', playbook: 'alpha' };

export function inThePlaybook<A, E>(
  { service }: { readonly service: Ledger['Service'] },
  read: Effect.Effect<A, E, PlaybookReader | PlaybookWriter | PlaybookContext>,
  playbook: PlaybookAddress = alphaOfAcme,
): Promise<A> {
  return Effect.runPromise(
    read.pipe(Effect.provide(playbookLedgerOf(service, playbook)), Effect.provideService(PlaybookContext, playbook)),
  );
}
