import type { Unavailable } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { filesRefusedAs } from '../files/files-refusals.ts';
import { notReadyAs } from './build-files.ts';

describe('a dataset that is not ready for a build or a question', () => {
  it('is said to have stalled, which waiting does not put right, apart from one still being built', () => {
    expect(
      [notReadyAs(filesRefusedAs.notReady('stalled')), notReadyAs(filesRefusedAs.notReady('rebuilding'))].map(
        ({ kind, because }: Pick<Unavailable, 'kind' | 'because'>) => [kind, because],
      ),
    ).toEqual([
      ['dataset_not_ready', 'stalled'],
      ['dataset_not_ready', undefined],
    ]);
  });
});
