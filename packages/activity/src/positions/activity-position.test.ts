import { describe, expect, it } from 'vitest';

import {
  cursorOf,
  isAfter,
  newestFirst,
  positionOfCursor,
  positionOrder,
  type ActivityPosition,
} from './activity-position.ts';

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

  it('is written as an opaque cursor, base64url of its JSON, and read back', () => {
    const cursor = cursorOf(finance);

    expect(cursor).toBe(
      'eyJhdCI6MTc5MzU1MjU2MTUxMiwicGxheWJvb2siOiJmaW5hbmNlIiwia2V5IjoicnVucy8wMTlhNDAxMi03YzNlLTdkMTAtOWIyYS00ZTZmOGExYzJkM2UifQ',
    );
    expect(positionOfCursor(cursor)).toEqual(finance);
  });

  it('reads nothing from a cursor that does not decode to a position', () => {
    expect(positionOfCursor('not a cursor')).toBeUndefined();
    expect(positionOfCursor(cursorOf({ ...finance, playbook: 'No' }))).toBeUndefined();
    expect(positionOfCursor(cursorOf({ ...finance, at: -1 }))).toBeUndefined();
    expect(positionOfCursor(cursorOf({ ...finance, key: '' }))).toBeUndefined();
  });
});
