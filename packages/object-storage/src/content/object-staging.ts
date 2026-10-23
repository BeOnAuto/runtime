import {
  leftUnread,
  stagingEnded,
  type PlaybookAddress,
  type ContentKept,
  type ContentRefused,
  type ContentToKeep,
  type StagingEnded,
} from '@on.auto/operations';
import { Effect } from 'effect';

import { placedOn, type Placing } from './object-writes.ts';

interface StagedRun {
  readonly playbook: PlaybookAddress;
  readonly run: string;
}

function endedOf({ bucket, keys }: Placing, { playbook, run }: StagedRun): Effect.Effect<boolean> {
  return Effect.promise(async () => (await bucket.head(keys.ended(playbook, run))) !== undefined);
}

function stagingOpen(placing: Placing, staged: StagedRun): Effect.Effect<void, StagingEnded> {
  return Effect.flatMap(endedOf(placing, staged), (ended) =>
    ended ? Effect.fail(stagingEnded(staged.run)) : Effect.void,
  );
}

export function stagedOn(
  placing: Placing,
  staged: StagedRun,
  content: ContentToKeep,
): Effect.Effect<ContentKept, ContentRefused | StagingEnded> {
  const { bucket, keys } = placing;
  const { playbook, run } = staged;
  return Effect.gen(function* () {
    yield* stagingOpen(placing, staged).pipe(Effect.tapError(() => leftUnread(content.stream)));
    const kept = yield* placedOn(placing, (sha256) => keys.staged(playbook, run, sha256), content);
    if (yield* endedOf(placing, staged)) {
      yield* Effect.promise(() => bucket.delete([keys.staged(playbook, run, kept.sha256)]));
      return yield* Effect.fail(stagingEnded(run));
    }
    return kept;
  });
}

export async function unstagedOn({ bucket, keys }: Placing, { playbook, run }: StagedRun): Promise<void> {
  const ended = keys.ended(playbook, run);
  await bucket.put(ended, { data: new Uint8Array() });
  const staged: string[] = [];
  for await (const key of bucket.list(keys.run(playbook, run))) {
    if (key !== ended) {
      staged.push(key);
    }
  }
  await bucket.delete(staged);
}
