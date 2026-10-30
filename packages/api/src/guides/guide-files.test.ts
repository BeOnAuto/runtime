import { shippedFilesOnDisk } from '@on.auto/operations/shipped-files-on-disk';
import { expect, it } from 'vitest';

import { apiShippedRoots } from '../index.ts';
import { guideShelfFrom } from './served-guides.ts';

it('refuses to start without the format page of a type the server runs', async () => {
  await expect(
    guideShelfFrom(shippedFilesOnDisk(apiShippedRoots()), [
      { type: 'drafting', noun: { one: 'draft', other: 'drafts' }, guide: { name: 'drafting-function' } },
    ]),
  ).rejects.toThrow(/no such file or directory.*drafting-format\.md/u);
});
