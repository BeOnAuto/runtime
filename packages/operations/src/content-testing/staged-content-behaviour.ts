import { describe, expect, it } from 'vitest';

import type { ContentEntry } from './content-entry.ts';
import {
  alpha,
  beta,
  generated,
  generatedStream,
  octets,
  readBack,
  refusalOf,
  resultOf,
  unread,
} from './content-samples.ts';

function unstagingWhileRead(unstage: () => Promise<void>, bytes: number): ReadableStream<Uint8Array> {
  const source = generatedStream(bytes, 7).getReader();
  let pulls = 0;
  return new ReadableStream<Uint8Array>({
    pull: async (controller) => {
      pulls += 1;
      if (pulls === 20) {
        await unstage();
      }
      const { done, value } = await source.read();
      if (done) {
        controller.close();
        return;
      }
      controller.enqueue(value);
    },
  });
}

function stagedAndUnstaged(entry: ContentEntry): void {
  it('reads back through another client under its playbook and run alone, until the run is unstaged', async () => {
    const { content, elsewhere, unnamedLeft } = await entry.aStore();
    const { sha256, content: generatedContent } = await generated(2_500_000);

    const kept = await resultOf(content.stage(alpha, 'run-1', generatedContent()));
    await resultOf(content.stage(alpha, 'run-1', generatedContent()));
    await resultOf(content.stage(alpha, 'run-2', generatedContent()));
    const before = [
      await readBack(await resultOf(elsewhere.staged(alpha, 'run-1', sha256))),
      await readBack(await resultOf(elsewhere.staged(beta, 'run-1', sha256))),
      await readBack(await resultOf(elsewhere.staged(alpha, 'run-3', sha256))),
      await readBack(await resultOf(elsewhere.get(alpha, sha256))),
    ];
    await resultOf(content.unstage(alpha, 'run-1'));
    const after = [
      await readBack(await resultOf(elsewhere.staged(alpha, 'run-1', sha256))),
      await readBack(await resultOf(elsewhere.staged(alpha, 'run-2', sha256))),
    ];

    const staged = { bytes: 2_500_000, sha256, mediaType: octets, declared: 2_500_000 };
    expect(kept).toEqual({ sha256, bytes: 2_500_000, mediaType: octets });
    expect([before, after]).toMatchObject([
      [staged, undefined, undefined, undefined],
      [undefined, staged],
    ]);
    expect(await unnamedLeft()).toBe(0);
  });
}

function stagedAfterUnstaging(entry: ContentEntry): void {
  it('refuses a stage under a run once unstaged, leaving its stream unread, and keeps nothing of a stage the unstage raced', async () => {
    const { content, elsewhere, unnamedLeft } = await entry.aStore();
    const { sha256 } = await generated(2_500_000);
    await resultOf(elsewhere.unstage(alpha, 'run-1'));
    const late = unread();

    const refused = await Promise.all([
      refusalOf(content.stage(alpha, 'run-1', late.content)),
      refusalOf(
        content.stage(alpha, 'run-2', {
          stream: unstagingWhileRead(() => resultOf(elsewhere.unstage(alpha, 'run-2')), 2_500_000),
          mediaType: octets,
        }),
      ),
    ]);

    expect(refused).toEqual([
      expect.objectContaining({
        _tag: 'staging_ended',
        detail: 'Nothing more is staged under run run-1, since what it staged was removed',
      }),
      expect.objectContaining({ _tag: 'staging_ended', run: 'run-2' }),
    ]);
    expect(late.cancelled()).toBe(true);
    expect(await resultOf(elsewhere.staged(alpha, 'run-2', sha256))).toBeUndefined();
    expect(await unnamedLeft()).toBe(0);
  });
}

export function stagedContentBehaviour(entry: ContentEntry): void {
  describe('the content staged under a run', () => {
    stagedAndUnstaged(entry);
    stagedAfterUnstaging(entry);
  });
}
