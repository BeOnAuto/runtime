import {
  OrgContext,
  type Caller,
  type Conflict,
  type InvalidInput,
  type PlaybookAddress,
  type Unavailable,
} from '@on.auto/operations';
import { Effect } from 'effect';

import type { Playbook } from '../registry/playbook.ts';

export interface PlaybookPage {
  readonly source: string;
}

export interface PlaybookPages {
  readonly pageOf: (playbook: PlaybookAddress) => Effect.Effect<PlaybookPage | undefined>;
  readonly save: (
    playbook: PlaybookAddress,
    source: string | null,
  ) => Effect.Effect<PlaybookPage | undefined, InvalidInput | Unavailable | Conflict, Caller>;
}

export function withItsPage(pages: PlaybookPages, playbook: Playbook): Effect.Effect<Playbook, never, OrgContext> {
  return Effect.gen(function* () {
    const { org } = yield* OrgContext;
    const page = yield* pages.pageOf({ org, playbook: playbook.id });
    return page === undefined ? playbook : { ...playbook, page: { source: page.source } };
  });
}
