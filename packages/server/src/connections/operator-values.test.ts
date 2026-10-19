import { fixtureProviders } from '@on.auto/providers/testing';
import { Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { readSettings } from '../settings/settings.ts';
import { readConnections, readConnectionSettings } from './connection-settings.ts';

const functions = readSettings({});

describe('the values the operator sets for the providers', () => {
  it('are read from the environment for each variable a provider refers to, and for no other', () => {
    const environment = { METRICS_DEVELOPER_TOKEN: 'metrics-developer-token-0123', UNRELATED_TOKEN: 'unrelated-0123' };
    const read = readConnections(environment, undefined, fixtureProviders);
    const { providerValues } = readConnectionSettings(environment, undefined, functions, read);

    expect(
      [...providerValues].map(([name, value]: readonly [string, Redacted.Redacted]) => [name, Redacted.value(value)]),
    ).toEqual([['METRICS_DEVELOPER_TOKEN', 'metrics-developer-token-0123']]);
  });

  it('name variables the runtime reads for itself, which connections.variables may not name', () => {
    const naming = { CONNECTIONS: JSON.stringify({ variables: ['METRICS_DEVELOPER_TOKEN'] }) };
    const read = readConnections(naming, undefined, fixtureProviders);

    expect(() => readConnectionSettings(naming, undefined, functions, read)).toThrow(
      'METRICS_DEVELOPER_TOKEN is a variable the runtime reads for itself, which no connection may name',
    );
  });
});
