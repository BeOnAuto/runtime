import { streamPrefixOfOrg } from '@on.auto/operations';

export const playbooksStream = 'playbooks';

export function playbooksStreamOfOrg(org: string): string {
  return `${streamPrefixOfOrg({ org })}${playbooksStream}`;
}
