import { describe, expect, it } from 'vitest';

import { memoriesShape } from '../index.ts';

const kept = {
  id: '019a3c4e-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  scope: 'playbook',
  text: 'Ada prefers short answers',
  tags: [],
  written_at: '2026-10-01T09:00:00.000Z',
  written_by: 'key_7f3a',
};

describe('the shape of what a memory function recalls', () => {
  it('takes memories newest first, with or without the days they are about, and none at all', () => {
    expect(
      memoriesShape.check({ memories: [kept, { ...kept, about: { from: '2026-10-01', to: '2026-10-01' } }] }),
    ).toEqual([]);
    expect(memoriesShape.check({ memories: [] })).toEqual([]);
  });

  it('refuses more text across the memories than a recall answers, at most 16,000 characters', () => {
    const long = { ...kept, text: 'x'.repeat(2000) };

    expect(memoriesShape.check({ memories: Array.from({ length: 8 }, () => long) })).toEqual([]);
    expect(memoriesShape.check({ memories: Array.from({ length: 9 }, () => long) })).toEqual([
      { pointer: '/memories', detail: 'Expected at most 16,000 characters of text across the memories' },
    ]);
  });

  it('refuses days that are not of the calendar, and a span that ends before it begins', () => {
    expect(memoriesShape.check({ memories: [{ ...kept, about: { from: '2026-02-30', to: '2026-13-01' } }] })).toEqual([
      { pointer: '/memories/0/about/from', detail: 'Expected a day of the calendar' },
      { pointer: '/memories/0/about/to', detail: 'Expected a day of the calendar' },
    ]);
    expect(memoriesShape.check({ memories: [{ ...kept, about: { from: '2026-10-02', to: '2026-10-01' } }] })).toEqual([
      { pointer: '/memories/0/about/to', detail: 'Expected a day no earlier than from' },
    ]);
  });

  it('refuses a tag that is not lowercase letters, digits and hyphens', () => {
    expect(memoriesShape.check({ memories: [{ ...kept, tags: ['releases', 'Not-A-Tag'] }] })).toEqual([
      {
        pointer: '/memories/0/tags/1',
        detail: 'Expected lowercase letters, digits and hyphens, starting with a letter or a digit',
      },
    ]);
  });

  it('checks the text, the tags and the span only as far as they are there, beside what the schema says of them', () => {
    const first = memoriesShape.check({ memories: [{ ...kept, text: 3, tags: [4], about: { from: '2026-10-01' } }] });
    const second = memoriesShape.check({ memories: [{ ...kept, about: { to: '2026-10-01' } }] });

    expect([first.length > 0, second.length > 0]).toEqual([true, true]);
    expect([...first, ...second].map(({ detail }) => detail)).not.toContain('Expected a day of the calendar');
    expect([...first, ...second].map(({ detail }) => detail)).not.toContain(
      'Expected lowercase letters, digits and hyphens, starting with a letter or a digit',
    );
  });
});
