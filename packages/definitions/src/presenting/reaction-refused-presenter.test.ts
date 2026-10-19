import { presentationOf, type RecordedEvent, type Context } from '@on.auto/operations';
import { nothingKept } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

import { makeDefinitionPresenters } from '../index.ts';
import { echo } from '../testing/capabilities/echo.ts';

const { present } = presentationOf(makeDefinitionPresenters([echo]));

function recordOf(stream: string, type: string, data: unknown, context: Context): RecordedEvent {
  return {
    id: '5c6f1a43-0d6e-5b2a-9c1e-7e3f2a1b0c9d',
    cursor: 'c-1',
    causationId: null,
    correlationId: null,
    stream,
    version: 1,
    globalPosition: 1,
    type,
    data,
    context,
    recordedAt: '2026-10-01T09:00:02.000Z',
  };
}

const showing = { streamPrefix: 'playbook/acme/alpha/', content: nothingKept, view: 'page' } as const;

const reason =
  'An event matched the event trigger of the workflow at reaction depth 9, past the 8 a chain of reactions may reach';

describe('the presenter of the refused reactions of a workflow', () => {
  it('says in words that the workflow of its context was not started every time its triggers called for it, and gives the count and the last reason', () => {
    const context = {
      at: '2026-10-01T09:01:00.000Z',
      by: 'playbook:alpha',
      definitionType: 'workflow',
      definitionName: 'close-the-month',
      definitionVersion: 2,
    };
    const data = { count: 3, reason, minute: '2026-10-01T09:00:00.000Z' };

    expect(present(recordOf('reactions/close-the-month', 'reaction_refused', data, context), showing)).toMatchObject([
      {
        type: 'reaction_refused',
        summary:
          'The workflow “close-the-month” was not started every time its triggers called for it in a minute; the details say how often and why.',
        data,
        metadata: { definition: { type: 'workflow', name: 'close-the-month', version: 2 } },
      },
    ]);
  });
});
