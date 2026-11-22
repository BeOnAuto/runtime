import type { ServiceNamed } from '@on.auto/openid-connect/authorization-server';
import { secretKeyBytes } from '@on.auto/secrets';
import { Option, Redacted } from 'effect';

import type {
  AccountLink,
  AccountLinks,
  LinkStart,
  MemberNamed,
  MemberOfAnAccount,
  NamesFromTheService,
} from '../../account-linking/account-links.ts';
import { keyedHashUnder, type KeyedHash } from '../../account-linking/link-secrets.ts';

function keyOf({ account, member }: MemberOfAnAccount): string {
  return JSON.stringify([account, member]);
}

function withoutThePerson<Kept extends { readonly person?: string }>(kept: Map<string, Kept>, person: string): void {
  for (const [key, each] of kept) {
    if (each.person === person) {
      kept.delete(key);
    }
  }
}

export function accountLinksInMemory(): AccountLinks {
  const starts = new Map<string, LinkStart>();
  const links = new Map<string, AccountLink>();
  return {
    started: (start) => {
      starts.set(keyOf(start), start);
      return Promise.resolve();
    },
    startFound: (secret) => Promise.resolve([...starts.values()].find((start) => start.secret === secret)),
    startOf: (member) => Promise.resolve(starts.get(keyOf(member))),
    startEnded: (start) => {
      const ended = starts.get(keyOf(start))?.secret === start.secret;
      if (ended) {
        starts.delete(keyOf(start));
      }
      return Promise.resolve(ended);
    },
    linked: (link) => {
      links.set(keyOf(link), link);
      return Promise.resolve();
    },
    linkOf: (member) => Promise.resolve(links.get(keyOf(member))),
    personForgotten: (person) => {
      withoutThePerson(starts, person);
      withoutThePerson(links, person);
      return Promise.resolve();
    },
  };
}

interface NamesGiven {
  readonly services: Readonly<Record<string, ServiceNamed>>;
  readonly members: Readonly<Record<string, MemberNamed>>;
}

export function namesFromTheServiceOf({ services, members }: NamesGiven): NamesFromTheService {
  return {
    ofTheService: (account) => Promise.resolve(Object.hasOwn(services, account) ? services[account] : undefined),
    ofTheMember: ({ member }) => Promise.resolve(Object.hasOwn(members, member) ? members[member] : undefined),
  };
}

export function aLinkCodeKey(byte: number, bytes = secretKeyBytes): Redacted.Redacted<Uint8Array> {
  return Redacted.make(new Uint8Array(bytes).fill(byte));
}

export function keyedHashOf(byte: number): KeyedHash {
  return Option.getOrThrow(Option.fromNullishOr(keyedHashUnder(aLinkCodeKey(byte))));
}
