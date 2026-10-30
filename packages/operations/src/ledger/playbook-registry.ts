import { Context, type Effect } from 'effect';

import type { PlaybookAddress } from '../caller/playbook-context.ts';

export type PlaybookStatus = 'active' | 'retired' | 'unknown';

export type LivePlaybookStatus = Exclude<PlaybookStatus, 'unknown'>;

export class PlaybookRegistry extends Context.Service<
  PlaybookRegistry,
  {
    readonly status: (address: PlaybookAddress) => Effect.Effect<PlaybookStatus>;
  }
>()('@on.auto/operations/PlaybookRegistry') {}
