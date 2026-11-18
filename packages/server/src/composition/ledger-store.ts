import type { ContentStore } from '@on.auto/content';
import type { AppendSignal, LedgerServices } from '@on.auto/ledger';
import { authStoreOpened, type AuthStore } from '@on.auto/openid-connect';
import { Effect, Layer } from 'effect';

import { ledgerConnectionIn, type LedgerDatabase } from '../database/ledger-database.ts';
import { withItsContentFound } from '../database/ledger-of-content-not-found.ts';
import { signInStoreRefusalExplained } from '../database/sign-in-store-of-a-newer-version.ts';
import { clientRegistrationsIn, enrollingIn, type Enrolling } from '../sign-in/admission.ts';
import { contentStoreOf, type ContentStoreSettings } from './content-store.ts';
import { keptByTheLedgerWith } from './kept-by-the-ledger.ts';

type DeclaredFacts = Parameters<typeof keptByTheLedgerWith>[0];

interface LedgerOpening {
  readonly declared?: DeclaredFacts;
  readonly mostActiveOf?: (type: string) => number;
  readonly appends?: AppendSignal;
  readonly content?: ContentStore;
}

export function ledgerLayerOf(
  database: LedgerDatabase,
  { declared = [], appends, content, mostActiveOf }: LedgerOpening = {},
): Layer.Layer<LedgerServices> {
  return database.ledgerLayer({
    ...keptByTheLedgerWith(declared, mostActiveOf),
    ...(appends === undefined ? {} : { appends }),
    ...(content === undefined ? {} : { content }),
  });
}

interface LedgerOpeningOfTheServer {
  readonly declared: DeclaredFacts;
  readonly mostActiveOf?: (type: string) => number;
  readonly appends?: AppendSignal;
}

export function ledgerLayerFor(
  settings: ContentStoreSettings & Parameters<typeof withItsContentFound>[1],
  database: LedgerDatabase,
  opening: LedgerOpeningOfTheServer,
): Layer.Layer<LedgerServices> {
  const composing = contentStoreOf(settings);
  return composing === undefined
    ? withItsContentFound(ledgerLayerOf(database, opening), settings)
    : Layer.unwrap(
        Effect.flatMap(composing, ({ reached, store, unreachableBy }) =>
          Effect.as(
            reached,
            withItsContentFound(ledgerLayerOf(database, { ...opening, content: store }), settings, unreachableBy),
          ),
        ),
      );
}

export interface SignInOpened extends AuthStore {
  readonly enrolling: Enrolling;
  readonly clientRegistrationsWith: ReturnType<typeof clientRegistrationsIn>;
}

export async function signInOpened(
  runtime: Parameters<typeof ledgerConnectionIn>[0] &
    Parameters<typeof enrollingIn>[0] &
    Parameters<typeof clientRegistrationsIn>[0],
  settings: Parameters<typeof signInStoreRefusalExplained>[1],
): Promise<SignInOpened> {
  try {
    const store = await authStoreOpened(await ledgerConnectionIn(runtime));
    return { ...store, enrolling: enrollingIn(runtime), clientRegistrationsWith: clientRegistrationsIn(runtime) };
  } catch (failure) {
    throw signInStoreRefusalExplained(failure, settings);
  }
}
