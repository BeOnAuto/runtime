import { describe, expect, it } from 'vitest';

import { commentStreamOf } from '../facts/comment-facts.ts';
import { addressesIn, commentOf, commenting, minute, reader } from '../testing/commenting.ts';
import { priya } from '../testing/harness.ts';

const savedAt = '2026-11-01T11:00:00.000Z';

const pageSource = '---\nof: workflow/close-the-week\n---\n{% result %}\n{{ output.week }}\n{% endresult %}\n';

const madeBy = { id: priya.id, name: priya.name };

const oldPage = 'finance/definitions/page/weekly-close/1/parts/lately-1';

async function withAPageOfItsOwn() {
  const scene = await commenting();
  await scene.record('playbook/acme/finance/definitions/page', {
    type: 'definition_created',
    data: {
      content: { source: pageSource, details: { of: 'workflow/close-the-week' } },
      created_by: madeBy,
    },
    context: {
      at: savedAt,
      by: priya.id,
      definitionType: 'page',
      definitionName: 'weekly-close',
      definitionVersion: 1,
    },
  });
  const id = '019a4120-5b6c-7d8e-9f01-2a3b4c5d6e7f';
  await scene.record(`playbook/acme/finance/${commentStreamOf(id)}`, {
    type: 'comment_made',
    data: { address: oldPage, text: 'The chart misses October', made_by: madeBy },
    context: { at: minute(1), by: priya.id },
  });
  return { ...scene, id };
}

describe('a comment made on a page saved as a definition of its own', () => {
  it('is listed at the address of its subject’s page, and under its subject with the comments made there', async () => {
    const scene = await withAPageOfItsOwn();
    await scene.made('finance/definitions/workflow/close-the-week/4/parts/lately-2', minute(2));
    await scene.made('finance/definitions/workflow/close-the-week/4', minute(3));
    await scene.made('finance/definitions/workflow/other/4', minute(4));

    expect(addressesIn(await scene.comments())).toEqual([
      'finance/definitions/workflow/other/4',
      'finance/definitions/workflow/close-the-week/4',
      'finance/definitions/workflow/close-the-week/4/parts/lately-2',
      'finance/definitions/workflow/close-the-week',
    ]);
    expect(
      addressesIn(await scene.comments({ address: 'finance/definitions/workflow/close-the-week', under: 'true' })),
    ).toEqual([
      'finance/definitions/workflow/close-the-week/4',
      'finance/definitions/workflow/close-the-week/4/parts/lately-2',
      'finance/definitions/workflow/close-the-week',
    ]);
  });

  it('is listed under its subject in the order of the comments made there at the same moment', async () => {
    const scene = await withAPageOfItsOwn();
    await scene.made('finance/definitions/workflow/close-the-week/4', minute(1));
    await scene.made('finance/definitions/workflow/close-the-week/4/parts/lately-2', minute(1));

    expect(
      addressesIn(await scene.comments({ address: 'finance/definitions/workflow/close-the-week', under: 'true' })),
    ).toHaveLength(3);
  });

  it('is answered at that address when it is resolved and reopened', async () => {
    const scene = await withAPageOfItsOwn();

    expect(commentOf(await scene.resolve(scene.id, 'acted', reader)).address).toBe(
      'finance/definitions/workflow/close-the-week',
    );
    expect(commentOf(await scene.reopen(scene.id, reader)).address).toBe('finance/definitions/workflow/close-the-week');
  });
});
