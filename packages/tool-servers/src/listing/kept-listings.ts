import type { ServerTool } from './tool-server.ts';

export const LISTING_KEPT_MS = 5 * 60 * 1000;

interface KeptTools {
  readonly tools: readonly ServerTool[];
  readonly until: number;
}

export interface KeptListings {
  readonly toolsOf: (org: string, keptAs: string) => readonly ServerTool[] | undefined;
  readonly keep: (org: string, keptAs: string, tools: readonly ServerTool[]) => void;
  readonly keepOnly: (org: string, servers: ReadonlySet<string>) => void;
}

function endedLetGo(byOrg: Map<string, Map<string, KeptTools>>, now: number): void {
  for (const [org, kept] of byOrg) {
    for (const [keptAs, { until }] of kept) {
      if (until <= now) {
        kept.delete(keptAs);
      }
    }
    if (kept.size === 0) {
      byOrg.delete(org);
    }
  }
}

export function keptListingsOf(now: () => number): KeptListings {
  const byOrg = new Map<string, Map<string, KeptTools>>();
  return {
    toolsOf: (org, keptAs) => {
      const kept = byOrg.get(org)?.get(keptAs);
      return kept !== undefined && kept.until > now() ? kept.tools : undefined;
    },
    keep: (org, keptAs, tools) => {
      const kept = byOrg.get(org) ?? new Map<string, KeptTools>();
      kept.set(keptAs, { tools, until: now() + LISTING_KEPT_MS });
      byOrg.set(org, kept);
    },
    keepOnly: (org, servers) => {
      const kept = byOrg.get(org) ?? new Map<string, KeptTools>();
      for (const keptAs of [...kept.keys()].filter((each) => !servers.has(each))) {
        kept.delete(keptAs);
      }
      endedLetGo(byOrg, now());
    },
  };
}
