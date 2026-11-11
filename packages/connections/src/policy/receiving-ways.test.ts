import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { readConnectionsSetting } from './connection-policy.ts';
import { receivesOver } from './receiving-ways.ts';

function receiveEventsOf(environment: Readonly<Record<string, string>>) {
  return Effect.runSync(readConnectionsSetting(environment)).receiveEvents;
}

function refusalOf(environment: Readonly<Record<string, string>>) {
  return Effect.runSync(Effect.flip(readConnectionsSetting(environment))).message;
}

const written = (receiveEvents: readonly string[]) => JSON.stringify({ receive_events: receiveEvents });

describe('the ways the runtime receives what a connection’s service sends', () => {
  it('are those the setting lists, none for an empty list, and nothing where neither the setting nor the variable says', () => {
    expect([
      receiveEventsOf({ CONNECTIONS: written(['http']) }),
      receiveEventsOf({ CONNECTIONS: written([]) }),
      receiveEventsOf({ CONNECTIONS: JSON.stringify({ people_may_add: true }) }),
      receiveEventsOf({}),
    ]).toEqual([['http'], [], undefined, undefined]);
  });

  it('are those CONNECTIONS_RECEIVE_EVENTS lists, separated by commas, over the setting, none where it is empty', () => {
    expect([
      receiveEventsOf({ CONNECTIONS_RECEIVE_EVENTS: '', CONNECTIONS: written(['http']) }),
      receiveEventsOf({ CONNECTIONS_RECEIVE_EVENTS: ' http , ', CONNECTIONS: written([]) }),
      receiveEventsOf({ CONNECTIONS_RECEIVE_EVENTS: 'http' }),
    ]).toEqual([[], ['http'], ['http']]);
  });

  it('refuse a way the runtime does not know, in the setting or in the variable', () => {
    expect([
      refusalOf({ CONNECTIONS: written(['email']) }),
      refusalOf({ CONNECTIONS_RECEIVE_EVENTS: 'http,email' }),
    ]).toEqual([
      'The connection settings are invalid. CONNECTIONS: /receive_events/0: Expected "http"',
      'The connection settings are invalid. CONNECTIONS_RECEIVE_EVENTS: Expected ways of receiving separated by commas, of http, or nothing for none',
    ]);
  });

  it('say the runtime receives over http where every way is left to it or http is listed, and not where none is', () => {
    expect([
      receivesOver({ receiveEvents: undefined }, 'http'),
      receivesOver({ receiveEvents: ['http'] }, 'http'),
      receivesOver({ receiveEvents: [] }, 'http'),
    ]).toEqual([true, true, false]);
  });
});
