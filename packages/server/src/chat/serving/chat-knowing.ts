import type { ConnectionPorts } from '@on.auto/ledger';
import type { PeopleRows } from '@on.auto/openid-connect';
import type { Redacted } from 'effect';

import { keyedHashUnder, type KeyedHash } from '../../account-linking/link-secrets.ts';
import { personOfAVerifiedAddress } from '../../account-linking/verified-address.ts';
import type { Enrolling } from '../../sign-in/admission.ts';
import { keptSecretsOf } from '../../sign-in/issued-tokens.ts';
import type { Knowing } from '../people/who-is-who.ts';
import { chatStoreOpened, type ChatStore } from '../store/chat-store.ts';

export interface ChatOpened {
  readonly store: ChatStore;
  readonly publicUrl: string;
  readonly enrolling: Pick<Enrolling, 'holdsARole'>;
  readonly peopleRows: Pick<PeopleRows, 'listed' | 'found'>;
  readonly hashed: KeyedHash;
}

export interface ChatOpening {
  readonly publicUrl: string | undefined;
  readonly signIn: Pick<ChatOpened, 'enrolling' | 'peopleRows'> & { readonly connection: ConnectionPorts };
  readonly secrets: Parameters<typeof keptSecretsOf>[0];
  readonly linkCodeKey: Redacted.Redacted<Uint8Array> | undefined;
}

async function storeOpenedWith(
  { signIn, secrets }: ChatOpening,
  publicUrl: string,
  hashed: KeyedHash,
): Promise<ChatOpened> {
  const store = await chatStoreOpened(signIn.connection, keptSecretsOf(secrets));
  return { store, publicUrl, enrolling: signIn.enrolling, peopleRows: signIn.peopleRows, hashed };
}

export function chatOpenedFor(opening: ChatOpening): Promise<ChatOpened> | undefined {
  const hashed = keyedHashUnder(opening.linkCodeKey);
  const { publicUrl } = opening;
  return publicUrl === undefined || hashed === undefined ? undefined : storeOpenedWith(opening, publicUrl, hashed);
}

export function knowingOf({ store, publicUrl, enrolling, peopleRows, hashed }: ChatOpened, now: () => number): Knowing {
  return {
    links: store.links,
    hashed,
    publicUrl,
    holdsARole: (person) => enrolling.holdsARole(person),
    personOfAVerifiedAddress: personOfAVerifiedAddress(peopleRows, enrolling),
    nameOf: async (person) => {
      const row = await peopleRows.found(person);
      return row?.name ?? row?.emailAddress ?? person;
    },
    now,
  };
}
