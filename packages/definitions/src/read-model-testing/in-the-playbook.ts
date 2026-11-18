import {
  PlaybookContext,
  playbookLedgerOf,
  type Ledger,
  type PlaybookAddress,
  type PlaybookReader,
  type PlaybookWriter,
} from '@on.auto/operations';
import { Effect } from 'effect';

import { recordedWith } from '../operations/registry-access.ts';
import type { DefinitionCommand } from '../registry/definition-commands.ts';

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

export function inPlaybookOf<A, E>(
  ledger: Ledger['Service'],
  playbook: PlaybookAddress,
  read: Effect.Effect<A, E, PlaybookReader | PlaybookWriter | PlaybookContext>,
): Effect.Effect<A, E> {
  return read.pipe(
    Effect.provideContext(playbookLedgerOf(ledger, playbook)),
    Effect.provideService(PlaybookContext, playbook),
  );
}

export function decidedIn(
  ledger: Ledger['Service'],
  playbook: PlaybookAddress,
  type: string,
  command: DefinitionCommand,
): Effect.Effect<void> {
  return Effect.ignore(inPlaybookOf(ledger, playbook, recordedWith(type, command)));
}
