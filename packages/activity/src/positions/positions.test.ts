import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import {
  type ActivityItem,
  addressOf,
  brokenKeyOf,
  commentKeyOf,
  itemOfAddress,
  playbookChangeKeyOf,
  positionOfItem,
  requestKeyOf,
  resultKeyOf,
  versionKeyOf,
} from './activity-addresses.ts';
import {
  type ActivityPosition,
  cursorOf,
  isAfter,
  newestFirst,
  positionOfCursor,
  positionOrder,
} from './activity-position.ts';
import { currentAddressOf, noPagesOfTheirOwn, pagesOfTheirOwnIn, pagesOfTheirOwnOf } from './current-addresses.ts';

const carried = {
  version: 3,
  source: '---\n---\n{% result %}{% endresult %}\n',
  details: {},
  saved_at: '2026-10-01T09:00:00.000Z',
};

const pages = pagesOfTheirOwnIn(
  new Map([
    ['workflow/close-the-week', { ...carried, name: 'weekly-close' }],
    ['playbook', { ...carried, name: 'dashboard' }],
  ]),
);

describe('the current address of a comment made on a page saved as a definition of its own', () => {
  it('is its subject without a version, and the playbook’s page or its parts of runs for the playbook’s', () => {
    expect(
      [
        'finance/definitions/page/weekly-close/3/parts/lately-2-1',
        'finance/definitions/page/weekly-close/3',
        'finance/definitions/page/dashboard/1/parts/lately-1',
        'finance/definitions/page/dashboard/1/parts/source',
        'finance/definitions/page/dashboard/1',
      ].map((address) => currentAddressOf(address, pages)),
    ).toEqual([
      'finance/definitions/workflow/close-the-week',
      'finance/definitions/workflow/close-the-week',
      'playbooks/finance/parts/runs-1',
      'playbooks/finance',
      'playbooks/finance',
    ]);
  });

  it('stays as it is for a page the playbook does not carry, and for any other address', () => {
    expect(
      [
        'finance/definitions/page/gone/1/parts/runs-1',
        'finance/definitions/page/weekly-close',
        'finance/definitions/workflow/close-the-week/4/parts/runs-2',
        'org/parts/playbooks',
      ].map((address) => currentAddressOf(address, pages)),
    ).toEqual([
      'finance/definitions/page/gone/1/parts/runs-1',
      'finance/definitions/page/weekly-close',
      'finance/definitions/workflow/close-the-week/4/parts/runs-2',
      'org/parts/playbooks',
    ]);
  });
});

describe('the current address of a comment made on a block of the runs of a page, as it was recorded', () => {
  it('names the block a part of runs', () => {
    expect(
      [
        'finance/definitions/workflow/close-the-week/4/parts/lately-2',
        'playbooks/finance/parts/lately-1-3',
        'finance/definitions/workflow/close-the-week/4/parts/lately',
      ].map((address) => currentAddressOf(address, noPagesOfTheirOwn)),
    ).toEqual([
      'finance/definitions/workflow/close-the-week/4/parts/runs-2',
      'playbooks/finance/parts/runs-1-3',
      'finance/definitions/workflow/close-the-week/4/parts/lately',
    ]);
  });
});

describe('the pages of their own of a subject', () => {
  it('are named as the comments made on them name their definition', () => {
    expect(pagesOfTheirOwnOf(pages, 'workflow', 'close-the-week')).toEqual(['page/weekly-close']);
    expect(pagesOfTheirOwnOf(pages, 'workflow', 'other')).toEqual([]);
  });
});

const finance = { at: 1_793_552_561_512, playbook: 'finance', key: 'runs/019a4012-7c3e-7d10-9b2a-4e6f8a1c2d3e' };

describe('a position in the activity', () => {
  it('orders by time, then playbook, then key', () => {
    expect(positionOrder(finance, { ...finance, at: finance.at + 1 })).toBe(-1);
    expect(positionOrder(finance, { ...finance, playbook: 'aaa' })).toBe(1);
    expect(positionOrder(finance, { ...finance, key: 'runs/0' })).toBe(1);
    expect(positionOrder(finance, { ...finance, key: 'zzz' })).toBe(-1);
    expect(positionOrder(finance, { ...finance })).toBe(0);
    expect(isAfter({ ...finance, at: finance.at + 1 }, finance)).toBe(true);
    expect(isAfter(finance, finance)).toBe(false);
    const positions: readonly ActivityPosition[] = [finance, { ...finance, at: finance.at + 1 }];

    expect(positions.toSorted(newestFirst)).toEqual([{ ...finance, at: finance.at + 1 }, finance]);
  });

  it('orders the rows of one time by the time their result names, a position without one naming its own time', () => {
    const earlier = { ...finance, resultAt: finance.at - 1, key: 'zzz' };
    const later = { ...finance, resultAt: finance.at - 1, playbook: 'aaa' };

    expect(positionOrder(earlier, { ...finance, resultAt: finance.at - 2 })).toBe(1);
    expect(positionOrder(earlier, finance)).toBe(-1);
    expect(positionOrder({ ...finance, resultAt: finance.at }, finance)).toBe(0);
    expect(positionOrder(earlier, later)).toBe(1);
    expect(positionOrder(earlier, { ...finance, at: finance.at + 1, resultAt: 0 })).toBe(-1);
  });
});

describe('the cursor of a position in the activity', () => {
  it('is written as an opaque cursor, base64url of its JSON, and read back', () => {
    const cursor = cursorOf(finance);

    expect(cursor).toBe(
      'eyJhdCI6MTc5MzU1MjU2MTUxMiwicGxheWJvb2siOiJmaW5hbmNlIiwia2V5IjoicnVucy8wMTlhNDAxMi03YzNlLTdkMTAtOWIyYS00ZTZmOGExYzJkM2UifQ',
    );
    expect(positionOfCursor(cursor)).toEqual(finance);
  });

  it('writes the time a result names into its cursor, and reads it back', () => {
    const judged = { ...finance, resultAt: finance.at - 60_000 };

    expect(JSON.parse(Buffer.from(cursorOf(judged), 'base64url').toString('utf8'))).toEqual({
      at: finance.at,
      playbook: 'finance',
      key: finance.key,
      result_at: finance.at - 60_000,
    });
    expect(positionOfCursor(cursorOf(judged))).toEqual(judged);
    expect(positionOfCursor(cursorOf({ ...finance, resultAt: -1 }))).toBeUndefined();
  });

  it('reads nothing from a cursor that does not decode to a position', () => {
    expect(positionOfCursor('not a cursor')).toBeUndefined();
    expect(positionOfCursor(cursorOf({ ...finance, playbook: 'No' }))).toBeUndefined();
    expect(positionOfCursor(cursorOf({ ...finance, at: -1 }))).toBeUndefined();
    expect(positionOfCursor(cursorOf({ ...finance, key: '' }))).toBeUndefined();
  });
});

const runId = '019a4012-7c3e-7d10-9b2a-4e6f8a1c2d3e';

describe('the address of an item of the activity', () => {
  it('is the playbook and the key of its row, or the register of playbooks for a playbook changed, a comment among them', () => {
    const items: readonly ActivityItem[] = [
      { form: 'request', playbook: 'finance', key: requestKeyOf(runId) },
      { form: 'broken', playbook: 'finance', key: brokenKeyOf('reasoning', 'categorize-invoice') },
      { form: 'result', playbook: 'finance', key: resultKeyOf(runId) },
      { form: 'version', playbook: 'finance', key: versionKeyOf('workflow', 'close-the-week', 4) },
      { form: 'version', playbook: 'finance', key: versionKeyOf('lookup', 'vendor-terms', 2_147_483_646) },
      { form: 'playbook', playbook: 'finance', key: playbookChangeKeyOf(1_793_552_561_512) },
      { form: 'comment', playbook: 'finance', key: commentKeyOf(runId) },
    ];

    expect(items.map((item) => addressOf(item))).toEqual([
      `finance/${runId}`,
      'finance/reasoning/categorize-invoice',
      `finance/runs/${runId}`,
      'finance/definitions/workflow/close-the-week/4',
      'finance/definitions/lookup/vendor-terms/2147483646',
      'playbooks/finance/1793552561512',
      `finance/comments/${runId}`,
    ]);
    expect(items.map((item) => itemOfAddress(addressOf(item)))).toEqual(items);
  });
});

describe('an address of no item of the activity', () => {
  it('is of none of the forms when a segment is wrong, missing or one too many', () => {
    const malformed = [
      '',
      'finance',
      'Finance/reasoning/categorize-invoice',
      `finance/${runId.toUpperCase()}`,
      `finance/${runId}/request`,
      `finance/runs/${runId}/more`,
      'finance/runs/not-a-run',
      'finance/reasoning/Categorize',
      'finance/reasoning/categorize-invoice/more',
      'finance/definitions/workflow/close-the-week/0',
      'finance/definitions/workflow/close-the-week/2147483647',
      'finance/definitions/workflow/close-the-week/0123456789',
      'finance/definitions/recall/close-the-week/4',
      'finance/definitions/workflow/close-the-week/4/more',
      'finance/definitions/workflow/close-the-week',
      'playbooks/finance/01',
      'playbooks/finance/1793552561512/more',
      'playbooks/Finance/1793552561512',
      'finance/comments/not-a-comment',
      `finance/comments/${runId}/more`,
    ];

    expect(malformed.filter((address) => itemOfAddress(address) !== undefined)).toEqual([]);
  });
});

describe('the place of an item of the activity', () => {
  it('places an item at its time, playbook and key', () => {
    expect(positionOfItem({ form: 'result', playbook: 'finance', key: resultKeyOf(runId) }, 5)).toEqual({
      at: 5,
      playbook: 'finance',
      key: `runs/${runId}`,
    });
  });
});
