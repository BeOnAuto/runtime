import { describe, expect, it } from 'vitest';

import { addressesIn, commenting, listedOf, minute, otherRun, reader, run, step } from '../testing/commenting.ts';
import { ada, outputOf, priya } from '../testing/harness.ts';
import { listComments } from './list-comments.ts';

const version = 'finance/definitions/workflow/close-the-week/4';

const anyText: unknown = expect.any(String);

const inStudio: unknown = expect.stringContaining('studio.example');

const theRun = `finance/runs/${run}`;

async function commented() {
  const scene = await commenting();
  const { made } = scene;
  await made('playbooks/finance', minute(1));
  await made(version, minute(2));
  await made(step, minute(3));
  await made('finance/definitions/workflow/close-the-week/3', minute(4));
  await made(theRun, minute(5));
  await made(`${theRun}/events/${run}_2`, minute(6));
  await made(`${theRun}/result/2`, minute(7));
  await made(`finance/${run}`, minute(8));
  await made(`finance/runs/${otherRun}`, minute(9));
  return scene;
}

describe('list_comments', () => {
  it('is a query of the playbook at GET /comments, served as a tool too', () => {
    expect(listComments.registration).toMatchObject({
      scope: 'playbook',
      kind: 'query',
      name: 'list_comments',
      route: { method: 'GET', path: '/comments' },
    });
    expect(listComments.registration).not.toHaveProperty('servedOverHttpAlone');
  });

  it("lists the playbook's open comments, newest first, each whole", async () => {
    const { comments } = await commented();
    const listed = outputOf(await comments({ limit: '1' }));

    expect(listed).toEqual({
      comments: [
        {
          id: anyText,
          address: `finance/runs/${otherRun}`,
          text: `About finance/runs/${otherRun}`,
          anchor: null,
          by: priya.id,
          by_name: priya.name,
          at: minute(9),
          open: true,
          resolved_at: null,
          resolved_by: null,
          resolved_how: null,
          reopened_at: null,
          reopened_by: null,
          studio: inStudio,
        },
      ],
      has_more: true,
      next_cursor: anyText,
    });
    expect(addressesIn(await comments())).toHaveLength(9);
  });
});

describe('the pages of list_comments', () => {
  it('reads on from a cursor, page by page, to the last', async () => {
    const { comments } = await commented();
    const first = listedOf(await comments({ limit: '4' }));
    const second = listedOf(await comments({ limit: '4', cursor: String(first.next_cursor) }));
    const last = listedOf(await comments({ limit: '4', cursor: String(second.next_cursor) }));

    expect([first.has_more, second.has_more, last.has_more, last.next_cursor]).toEqual([true, true, false, null]);
    expect([...first.comments, ...second.comments, ...last.comments].map(({ address }) => address)).toEqual([
      `finance/runs/${otherRun}`,
      `finance/${run}`,
      `${theRun}/result/2`,
      `${theRun}/events/${run}_2`,
      theRun,
      'finance/definitions/workflow/close-the-week/3',
      step,
      version,
      'playbooks/finance',
    ]);
  });
});

describe('the comments list_comments keeps', () => {
  it('keeps those on one address, or under it: a run with its events and blocks and not its request, a version with its steps, a definition with every version', async () => {
    const { comments } = await commented();

    expect(addressesIn(await comments({ address: theRun }))).toEqual([theRun]);
    expect(addressesIn(await comments({ address: theRun, under: 'true' }))).toEqual([
      `${theRun}/result/2`,
      `${theRun}/events/${run}_2`,
      theRun,
    ]);
    expect(addressesIn(await comments({ address: version, under: 'true' }))).toEqual([step, version]);
    expect(
      addressesIn(await comments({ address: 'finance/definitions/workflow/close-the-week', under: 'true' })),
    ).toEqual(['finance/definitions/workflow/close-the-week/3', step, version]);
    expect(addressesIn(await comments({ address: step, under: 'true' }))).toEqual([step]);
    expect(addressesIn(await comments({ address: 'playbooks/finance', under: 'true' }))).toEqual(['playbooks/finance']);
  });
});

describe('the comments list_comments keeps under a thing that has parts', () => {
  it('keeps those on a thing and its parts under it, and a part alone under a part', async () => {
    const { comments, made } = await commenting();
    await made('playbooks/finance', minute(1));
    await made('playbooks/finance/parts/ledger', minute(2));
    await made(`${theRun}/parts/output`, minute(3));
    await made(`${version}/parts/source`, minute(4));

    expect(addressesIn(await comments({ address: 'playbooks/finance', under: 'true' }))).toEqual([
      'playbooks/finance/parts/ledger',
      'playbooks/finance',
    ]);
    expect(addressesIn(await comments({ address: 'playbooks/finance/parts/ledger', under: 'true' }))).toEqual([
      'playbooks/finance/parts/ledger',
    ]);
    expect(addressesIn(await comments({ address: theRun, under: 'true' }))).toEqual([`${theRun}/parts/output`]);
    expect(addressesIn(await comments({ address: version, under: 'true' }))).toEqual([`${version}/parts/source`]);
  });
});

describe('the resolved comments and those list_comments cannot place', () => {
  it('keeps the resolved comments with open=false, each closed', async () => {
    const { comments, made, resolve } = await commenting();
    const id = await made(theRun, minute(1));
    await made(step, minute(2));
    await resolve(id, 'acted');

    expect(listedOf(await comments({ open: 'false' })).comments).toEqual([
      { id, address: theRun, open: false, resolved_how: 'acted' },
    ]);
    expect(addressesIn(await comments())).toEqual([step]);
  });

  it('serves a comment whose address it cannot read without a place in Studio', async () => {
    const { comments, record } = await commenting();
    await record('playbook/acme/finance/comments/019a4120-5b6c-7d8e-9f01-2a3b4c5d6e7f', {
      type: 'comment_made',
      data: { address: 'finance/somewhere', text: 'Here.', made_by: { id: priya.id, name: priya.name } },
      context: { at: minute(1), by: priya.id },
    });

    expect(listedOf(await comments()).comments).toHaveLength(1);
    expect(JSON.stringify(outputOf(await comments()))).not.toContain('"studio"');
  });
});

describe('list_comments, given what it cannot take', () => {
  it('refuses under without an address, an address of another playbook or of no form, and a definition without its version but under', async () => {
    const { comments } = await commenting();
    const refused = await Promise.all([
      comments({ under: 'true' }),
      comments({ address: 'playbooks/sales' }),
      comments({ address: 'finance/somewhere' }),
      comments({ address: 'finance/definitions/workflow/close-the-week' }),
      comments({ address: 'org' }),
    ]);

    expect(refused).toMatchObject([
      { status: 'rejected', reason: 'invalid_input', issues: [{ pointer: '/under' }] },
      { status: 'rejected', reason: 'invalid_input', issues: [{ pointer: '/address' }] },
      { status: 'rejected', reason: 'invalid_input', issues: [{ pointer: '/address' }] },
      { status: 'rejected', reason: 'invalid_input', issues: [{ pointer: '/address' }] },
      { status: 'rejected', reason: 'invalid_input', issues: [{ pointer: '/address' }] },
    ]);
  });

  it('refuses a limit outside 1 to 200, and a cursor of another playbook or none it gave', async () => {
    const { comments, made } = await commenting();
    await made(theRun, minute(1));
    await made(step, minute(2));
    const { next_cursor: cursor } = listedOf(await comments({ limit: '1' }));
    const refused = await Promise.all([
      comments({ limit: '0' }),
      comments({ limit: '201' }),
      comments({ cursor: 'not a cursor' }),
      comments({ cursor: String(cursor) }, ada, 'sales'),
    ]);

    expect(refused).toMatchObject([
      { status: 'rejected', reason: 'invalid_input', issues: [{ pointer: '/limit' }] },
      { status: 'rejected', reason: 'invalid_input', issues: [{ pointer: '/limit' }] },
      { status: 'rejected', reason: 'invalid_input', issues: [{ pointer: '/cursor' }] },
      { status: 'rejected', reason: 'invalid_input', issues: [{ pointer: '/cursor' }] },
    ]);
    expect(await comments({ limit: '200' })).toMatchObject({ status: 'succeeded' });
  });
});

describe('the plain words of list_comments', () => {
  it('say how many open or resolved comments the page holds', () => {
    const outcome = listComments.registration.plainLanguage?.outcome;
    const comment = {
      id: run,
      address: theRun,
      text: 'Here.',
      anchor: null,
      by: priya.id,
      by_name: priya.name,
      at: minute(1),
      open: true,
      resolved_at: null,
      resolved_by: null,
      resolved_how: null,
      reopened_at: null,
      reopened_by: null,
    };
    const page = (count: number) => ({
      comments: Array.from({ length: count }, () => comment),
      has_more: false,
      next_cursor: null,
    });

    expect([
      listComments.registration.plainLanguage?.attempt({}),
      outcome?.(page(0), {}),
      outcome?.(page(1), {}),
      outcome?.(page(3), { open: true }),
      outcome?.(page(2), { open: false }),
    ]).toEqual([
      'list the comments',
      'No open comment is on this page.',
      'Found 1 open comment on this page.',
      'Found 3 open comments on this page.',
      'Found 2 resolved comments on this page.',
    ]);
  });
});

describe('list_comments for a reader of another playbook', () => {
  it('lists the comments of a playbook to its readers alone', async () => {
    const { comments, made } = await commenting();
    await made(theRun, minute(1), reader);

    expect(await comments({}, { ...reader, playbooks: ['sales'] })).toMatchObject({
      status: 'rejected',
      reason: 'forbidden',
    });
  });
});
