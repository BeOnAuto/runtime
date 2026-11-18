import { wokenOrgOf } from '../follower/org-records.ts';

export interface Wakes {
  readonly woken: (stream: string) => void;
  readonly orgAgain: (org: string) => void;
  readonly orgsWoken: () => readonly string[];
  readonly anyWoken: () => boolean;
}

export function wakesOf(): Wakes {
  const orgs = new Set<string>();
  return {
    woken: (stream) => {
      const org = wokenOrgOf(stream);
      if (org !== undefined) {
        orgs.add(org);
      }
    },
    orgAgain: (org) => {
      orgs.add(org);
    },
    orgsWoken: () => {
      const taken = [...orgs];
      orgs.clear();
      return taken;
    },
    anyWoken: () => orgs.size > 0,
  };
}
