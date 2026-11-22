import { describe, expect, it } from 'vitest';

import type { Trigger } from '../registry/definition-triggers.ts';
import { startsInWords } from './definition-words.ts';

const opened = 'com.example.ticket.opened';

function listeningWith(attributes: Readonly<Record<string, string | boolean>>): readonly Trigger[] {
  return [
    {
      kind: 'event',
      reference: '/schedule/on',
      filters: [{ reference: '/schedule/on/one', type: opened, attributes: { type: opened, ...attributes } }],
    },
    { kind: 'every', reference: '/schedule/every', milliseconds: 60_000 },
  ];
}

const listening = listeningWith({ source: '/connections/tracker' });

const standingOfOne = {
  reference: '/schedule/on/one',
  connection: 'tracker',
  event: 'A ticket is opened',
  speed: 'instant',
  listening: true,
  not_listening_because: null,
  needs_reconnecting: false,
} as const;

const { event: _event, ...unnamed } = standingOfOne;

describe('the words a save answers of the triggers that start from a connection', () => {
  it('are none for a definition that starts from no connection, or whose standing holds no triggers', () => {
    expect([startsInWords({}), startsInWords({ standing: { queued: 0, next_queued_start: null } })]).toEqual(['', '']);
  });

  it('are given for each such trigger, alike whether its filters are read beside it or not', () => {
    const read = startsInWords({ standing: { triggers: [standingOfOne] }, triggers: listening });

    expect(read).not.toBe('');
    expect(startsInWords({ standing: { triggers: [standingOfOne] } })).toBe(read);
  });

  it('name no trigger whose event cannot be named, and still say where to see how each stands', () => {
    expect(startsInWords({ standing: { triggers: [unnamed] }, triggers: listening })).not.toBe('');
    expect(startsInWords({ standing: { triggers: [unnamed, standingOfOne] }, triggers: listening })).toBe(
      startsInWords({ standing: { triggers: [standingOfOne] }, triggers: listening }),
    );
  });

  it('change where the filter asks for what the connection itself does', () => {
    const own = listeningWith({ source: '/connections/tracker', own: true });

    expect(startsInWords({ standing: { triggers: [standingOfOne] }, triggers: own })).not.toBe(
      startsInWords({ standing: { triggers: [standingOfOne] }, triggers: listening }),
    );
  });
});
