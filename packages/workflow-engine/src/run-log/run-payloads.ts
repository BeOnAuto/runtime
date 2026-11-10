import type { Digested } from '@on.auto/content';
import type { PayloadToKeep } from '@on.auto/operations/payloads';
import { Data, Effect } from 'effect';

import type { HeldContents } from '../machine/held-contents.ts';

export interface RunPayloads<Unavailable> {
  readonly keepsPayloadsOutside: boolean;
  readonly read: (runId: string, kept: readonly Digested[]) => Effect.Effect<HeldContents, Unavailable>;
  readonly keep: (runId: string, payloads: readonly PayloadToKeep[]) => Effect.Effect<void, Unavailable>;
}

export class NoPayloadStore extends Data.TaggedError('no_payload_store')<{ readonly runId: string }> {}

export const noPayloadStore: RunPayloads<never> = {
  keepsPayloadsOutside: false,
  read: (runId) => Effect.die(new NoPayloadStore({ runId })),
  keep: (runId) => Effect.die(new NoPayloadStore({ runId })),
};
