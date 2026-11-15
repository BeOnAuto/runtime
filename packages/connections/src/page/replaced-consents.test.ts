import { describe, expect, it } from 'vitest';

import { added } from '../testing/additions.ts';
import { ada, operationNamed } from '../testing/harness.ts';
import { replacingFiles } from '../testing/replacements.ts';

describe('the consent of a connection whose provider another provider replaces', () => {
  it('is not started through a link that is still open, saying how it is connected again, and asks its authorization server nothing', async () => {
    const { h, after, files } = await replacingFiles();
    const { id, token } = await added(h, { provider: 'files' });
    const before = await h.facts();

    const outcome = await h.call(operationNamed(after, 'start'), ada, { id, token });

    expect(outcome).toMatchObject({
      reason: 'conflict',
      detail:
        'The connection files was added from the provider files, which messages replaces here, so it is not signed in to again: reconnecting it adds it again from messages under the same name',
    });
    expect([await h.facts(), files.heard()]).toEqual([before, []]);
  });
});
