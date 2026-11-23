import { accountLinkingOf, linkStarted } from '../../account-linking/account-linking.ts';
import type { AccountLinks, MemberOfAnAccount } from '../../account-linking/account-links.ts';
import { linkCodeKeysOf, namesFromTheServiceOf } from './account-links-in-memory.ts';

export const publicUrl = 'https://auto.example.test';

export const dana = { account: 'T-northwind', member: 'U-dana' };

export const omar = { account: 'T-northwind', member: 'U-omar' };

export const ada = 'a3f1c0de';

export const at = Date.parse('2026-11-21T09:00:00Z');

export const named = { service: 'A chat', app: 'Auto' };

export const names = namesFromTheServiceOf({
  services: { 'T-northwind': named },
  members: { 'U-dana': { memberName: 'Dana Reyes', accountName: 'Northwind' } },
});

export const keys = linkCodeKeysOf(1);

export const { hashed } = keys;

export function codesOf(code: string): () => string {
  return () => code;
}

export async function linkFor(links: AccountLinks, member: MemberOfAnAccount): Promise<string> {
  const link = await linkStarted(links, publicUrl, member);
  return link.slice(`${publicUrl}/account-links/`.length);
}

export async function aCodeShownTo(links: AccountLinks, member: MemberOfAnAccount, code = 'BCDFGH'): Promise<string> {
  await accountLinkingOf(links, names, keys, codesOf(code)).allowed(await linkFor(links, member), ada);
  return code;
}
