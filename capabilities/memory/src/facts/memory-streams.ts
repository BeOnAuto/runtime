import { streamPrefixOfAddress, type ProjectedAddress } from '@on.auto/operations';

import { memoriesKind, type MemoryScope, type MovedTo } from './memory-facts.ts';

export interface MemoryPlace {
  readonly org: string;
  readonly playbook: string;
}

export interface MemoryAt {
  readonly place: MemoryPlace;
  readonly scope: MemoryScope;
  readonly id: string;
}

export function addressOfScope({ org, playbook }: MemoryPlace, scope: MemoryScope): ProjectedAddress {
  return scope === 'playbook' ? { org, playbook } : { org };
}

export function memoryStreamOf({ place, scope, id }: MemoryAt): string {
  return `${streamPrefixOfAddress(addressOfScope(place, scope))}${memoriesKind}/${id}`;
}

const scopeWords: Readonly<Record<MemoryScope, string>> = {
  playbook: "the playbook's memories",
  organization: "the organization's memories",
};

export function scopeInWords(scope: MemoryScope): string {
  return scopeWords[scope];
}

export function destinationInWords({ to, playbook }: Pick<MovedTo, 'to' | 'playbook'>): string {
  return playbook === undefined ? scopeInWords(to) : `the memories of the playbook ${playbook}`;
}

const keeperWords: Readonly<Record<MemoryScope, string>> = {
  playbook: 'The playbook',
  organization: 'The organization',
};

export function keeperInWords(scope: MemoryScope): string {
  return keeperWords[scope];
}
