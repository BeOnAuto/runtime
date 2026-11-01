import { describe, expect, it } from 'vitest';

import { adding, issuesIn, notes } from '../testing/additions.ts';
import { harness } from '../testing/harness.ts';

const marks = { reads: ['search'] };

describe('a connection added through the API', () => {
  it('carries no marks of its own, by hand or by a provider, refused at its entry with nothing recorded', async () => {
    const h = harness();

    const byHand = await adding(h, { ...notes, entry: { ...notes.entry, marks } });
    const byProvider = await adding(h, { provider: 'tracker', placeholders: { site: 'acme' }, entry: { marks } });

    expect([byHand, byProvider]).toMatchObject([
      { status: 'rejected', reason: 'invalid_input' },
      { status: 'rejected', reason: 'invalid_input' },
    ]);
    expect([issuesIn(byHand), issuesIn(byProvider)].map((issues) => issues.map(({ pointer }) => pointer))).toEqual([
      ['/entry/marks'],
      ['/entry/marks'],
    ]);
    expect(await h.facts()).toEqual([]);
  });
});
