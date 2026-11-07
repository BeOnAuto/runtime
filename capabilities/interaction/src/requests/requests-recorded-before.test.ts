import type { ProjectedRow, RunContext } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { openRequests } from './open-requests.ts';

const person = 'person:user_7kLm2';

const askedAt = '2026-11-05T10:00:00.000Z';

const expiresAt = '2026-11-05T10:05:00.000Z';

function contextOf(type: string): RunContext {
  return {
    by: person,
    at: askedAt,
    runId: 'r-asking',
    definitionType: type,
    definitionName: 'asking-a-person',
    definitionVersion: 1,
  };
}

function after(row: ProjectedRow | undefined, type: string, data: unknown, context: RunContext) {
  return openRequests.rowAfter(row, { id: 'm-1', position: 2, type, data, context });
}

const recordedBefore = [
  {
    type: 'reasoning',
    key: 'approval',
    value: { server: 'browser', tool: 'browser_click', action: 'Click "Pay now"', site: 'shop.example', kind: 'pay' },
    answer: { approved: true },
    ending: null,
  },
  {
    type: 'interaction',
    key: 'sign_in',
    value: { server: 'browser', site: 'portal.supplier.example', link: 'https://studio.example/sign-in' },
    answer: { signed_in: true },
    ending: Date.parse(askedAt),
  },
] as const;

describe('the open request a run recorded when it asked a person to approve an action or to sign in to a site', () => {
  it.each(recordedBefore)(
    'is a request of its $type run held for an agent, with nothing of its $key kept, and its answer closes it as any answer does',
    ({ type, key, value, answer, ending }) => {
      const context = contextOf(type);
      const record = {
        to: person,
        answerer: person,
        message: 'asking-a-person waits for you',
        answer_schema: { type: 'object' },
        expires_at: expiresAt,
        requested_at: askedAt,
        [key]: value,
      };
      const asked = after(undefined, 'run_deferred', { record }, context);
      const answered = after(
        asked,
        'request_answered',
        { answer, answered_by: { id: person, name: 'Priya' } },
        context,
      );

      expect([asked, answered]).toEqual([
        expect.objectContaining({
          type,
          party: person,
          answerer: person,
          standing: 'held_for_an_agent',
          open: true,
          ending_due_at: Date.parse(expiresAt),
        }),
        expect.objectContaining({ standing: 'answered', open: false, ending_due_at: ending }),
      ]);
      expect(asked).not.toHaveProperty(key);
    },
  );
});
