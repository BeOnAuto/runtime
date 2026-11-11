import type { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { endingWords, isPlacedByTheRequest, namingTheRequest } from './ending-words.ts';
import type { TellingRoute } from './telling-routes.ts';

function lineWith(written: Readonly<Record<string, Schema.Json>>): TellingRoute {
  return { when: 'all', line: { tool: 'post', with: { channel: '{{ sent.conversation }}', ...written } } };
}

describe('the words of how a request ended', () => {
  it('are Studio’s, naming who answered in Auto and the words of their answer', () => {
    expect([
      endingWords({ fact: 'f', kind: 'answered', by: 'June Park', words: ['approve'] }),
      endingWords({ fact: 'f', kind: 'answered', by: 'June Park', words: [] }),
      endingWords({ fact: 'f', kind: 'expired' }),
      endingWords({ fact: 'f', kind: 'cancelled' }),
    ]).toEqual([
      'Answered in Auto by June Park: approve.',
      'Answered in Auto by June Park.',
      'Expired unanswered.',
      'Cancelled unanswered.',
    ]);
  });

  it('name the request by the day and time it was sent, in UTC, where the line is not under its message', () => {
    expect(namingTheRequest(Date.parse('2026-11-09T09:00:00.000Z'), 'Expired unanswered.')).toBe(
      'The request sent 9 Nov, 09:00 UTC: Expired unanswered.',
    );
  });
});

describe('a line placed by the request’s message', () => {
  it('reads sent.id in any of its arguments, however deep, and none without a line or that reading', () => {
    expect([
      isPlacedByTheRequest(lineWith({ thread: '{{ reply.to | default: sent.id }}' })),
      isPlacedByTheRequest(lineWith({ body: { reply: ['{{ sent.id }}'] } })),
      isPlacedByTheRequest(lineWith({ body: { text: '{{ message }}', count: 1, empty: null } })),
      isPlacedByTheRequest({ when: 'all' }),
    ]).toEqual([true, true, false, false]);
  });
});
