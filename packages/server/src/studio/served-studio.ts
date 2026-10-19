import type { ApiStudio } from '@on.auto/api';
import { fetchWithin, type OutboundFetch } from '@on.auto/outbound';

import { outboundFetch } from '../composition/outbound-fetch.ts';
import { besideTheLedgerFile } from '../settings/ledger-settings.ts';
import type { Settings } from '../settings/settings.ts';
import { keptAnswersIn, type Keeping } from './kept-answers.ts';
import { studioBounds, studioHostOf, type StudioBounds } from './studio-host.ts';

export const studioFolderName = 'auto-runtime-studio';

const mostKeptBytes = 67_108_864;

export interface StudioServing {
  readonly report: Keeping['report'];
  readonly fetch?: OutboundFetch;
  readonly bounds?: StudioBounds;
  readonly now?: () => number;
}

export function reachingOnly(origin: string): (url: string) => string | undefined {
  return (url) => (new URL(url).origin === origin ? undefined : `Studio is fetched from ${origin} alone`);
}

export function servedStudioOf(
  { studio, ledger }: Pick<Settings, 'studio' | 'ledger'>,
  { report, fetch = outboundFetch, bounds = studioBounds, now = Date.now }: StudioServing,
): ApiStudio {
  const { origin } = studio;
  if (!studio.served) {
    return { origin, served: false };
  }
  const kept = keptAnswersIn(besideTheLedgerFile(ledger, studioFolderName), { mostBytes: mostKeptBytes, report });
  const host = studioHostOf({ origin, fetch: fetchWithin(fetch, reachingOnly(origin)), kept, bounds, now });
  return { origin, served: true, host };
}
