import { accountLinkPath } from '@on.auto/openid-connect';
import type { AccountLinking, LinkChoices, LinkShown } from '@on.auto/openid-connect/authorization-server';
import type { Redacted } from 'effect';

import type { AccountLinks, LinkStart, MemberOfAnAccount, NamesFromTheService } from './account-links.ts';
import {
  aCode,
  aLinkValue,
  codeIn,
  isTheSameSecret,
  linkCodeKeysUnder,
  secretOf,
  type KeyedHash,
  type LinkCodeKeys,
} from './link-secrets.ts';

const ended: LinkShown = { ended: true };

export type CodeHandedBack =
  | { readonly linked: string }
  | { readonly refused: 'another_member' | 'wrong_code' }
  | { readonly awaited: false };

const notAwaited: CodeHandedBack = { awaited: false };

async function openStartOf(links: AccountLinks, value: string): Promise<LinkStart | undefined> {
  const start = await links.startFound(secretOf(value));
  return start?.person === undefined ? start : undefined;
}

async function allowShownFor(
  start: LinkStart,
  names: NamesFromTheService,
  { allowAt, denyAt, tryAgainAt }: LinkChoices,
): Promise<LinkShown> {
  const named = await names.ofTheService(start.account);
  if (named === undefined) {
    return ended;
  }
  const { service } = named;
  const member = await names.ofTheMember(start);
  return member === undefined
    ? { unnamed: { service, tryAgainAt } }
    : { allow: { service, ...member, allowAt, denyAt } };
}

async function codeGivenFor(
  start: LinkStart,
  person: string,
  { links, names, codes, keys }: Linking,
): Promise<LinkShown> {
  const named = await names.ofTheService(start.account);
  if (named === undefined || !(await links.startEnded(start))) {
    return ended;
  }
  const code = codes();
  await links.started({ account: start.account, member: start.member, secret: keys.hashed.of(code), person });
  return { code: { ...named, code } };
}

async function codeShownAgainFor(sealed: string, { links, names, keys }: Linking): Promise<LinkShown> {
  const code = keys.seal.opened(sealed);
  if (code === undefined) {
    return ended;
  }
  const start = await links.startFound(keys.hashed.of(code));
  if (start?.person === undefined) {
    return ended;
  }
  const named = await names.ofTheService(start.account);
  return named === undefined ? ended : { code: { ...named, code } };
}

async function deniedFor(start: LinkStart, { links, names }: Linking): Promise<LinkShown> {
  if (!(await links.startEnded(start))) {
    return ended;
  }
  const named = await names.ofTheService(start.account);
  return named === undefined ? ended : { denied: named };
}

interface Linking {
  readonly links: AccountLinks;
  readonly names: NamesFromTheService;
  readonly keys: LinkCodeKeys;
  readonly codes: () => string;
}

export function accountLinkingOf(
  links: AccountLinks,
  names: NamesFromTheService,
  keys: LinkCodeKeys,
  codes = aCode,
): AccountLinking {
  const linking: Linking = { links, names, keys, codes: () => codes() };
  return {
    opened: async (value) => (await openStartOf(links, value)) !== undefined,
    allowShown: async (value, choices) => {
      const start = await openStartOf(links, value);
      return start === undefined ? ended : allowShownFor(start, names, choices);
    },
    allowed: async (value, person) => {
      const start = await openStartOf(links, value);
      return start === undefined ? ended : codeGivenFor(start, person, linking);
    },
    denied: async (value) => {
      const start = await openStartOf(links, value);
      return start === undefined ? ended : deniedFor(start, linking);
    },
    codeSealed: (code) => Promise.resolve(keys.seal.sealed(code)),
    codeShownAgain: (sealed) => codeShownAgainFor(sealed, linking),
  };
}

export interface LinkingServed {
  readonly accountLinks?: AccountLinks;
  readonly namesFromTheService?: NamesFromTheService;
  readonly linkCodeKey?: Redacted.Redacted<Uint8Array>;
}

export interface Linked {
  readonly linking?: AccountLinking;
}

export function linkingOf({ accountLinks, namesFromTheService, linkCodeKey }: LinkingServed): Linked {
  const keys = linkCodeKeysUnder(linkCodeKey);
  return accountLinks === undefined || namesFromTheService === undefined || keys === undefined
    ? {}
    : { linking: accountLinkingOf(accountLinks, namesFromTheService, keys) };
}

export async function linkStarted(links: AccountLinks, publicUrl: string, member: MemberOfAnAccount): Promise<string> {
  const value = aLinkValue();
  await links.started({ account: member.account, member: member.member, secret: secretOf(value) });
  return `${publicUrl}${accountLinkPath}/${value}`;
}

function isOf(start: LinkStart, { account, member }: MemberOfAnAccount): boolean {
  return start.account === account && start.member === member;
}

async function linkedBy(links: AccountLinks, start: LinkStart, person: string, at: number): Promise<CodeHandedBack> {
  if (!(await links.startEnded(start))) {
    return notAwaited;
  }
  await links.linked({ account: start.account, member: start.member, person, linkedAt: at });
  return { linked: person };
}

async function endedAs(links: AccountLinks, start: LinkStart, refused: 'another_member' | 'wrong_code') {
  await links.startEnded(start);
  return { refused };
}

export interface CodesAwaited {
  readonly links: AccountLinks;
  readonly hashed: KeyedHash;
}

export async function codeHandedBack(
  { links, hashed }: CodesAwaited,
  sender: MemberOfAnAccount,
  text: string,
  at: number,
): Promise<CodeHandedBack> {
  const code = codeIn(text);
  if (code === undefined) {
    return notAwaited;
  }
  const secret = hashed.of(code);
  const own = await links.startOf(sender);
  const awaiting = own?.person === undefined ? undefined : { start: own, person: own.person };
  if (awaiting !== undefined && isTheSameSecret(secret, awaiting.start.secret)) {
    return linkedBy(links, awaiting.start, awaiting.person, at);
  }
  const another = await links.startFound(secret);
  if (another?.person !== undefined && !isOf(another, sender)) {
    return endedAs(links, another, 'another_member');
  }
  return awaiting === undefined ? notAwaited : endedAs(links, awaiting.start, 'wrong_code');
}
