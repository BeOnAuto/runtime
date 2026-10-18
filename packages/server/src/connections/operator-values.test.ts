import { fixtureProviders } from '@on.auto/providers/testing';
import { Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { readSettings } from '../settings/settings.ts';
import { readConnectionSettings } from './connection-settings.ts';

const functions = readSettings({});

describe('the values the operator sets for the providers', () => {
  it('are read from the environment for each variable a provider refers to, and for no other', () => {
    const { providerValues } = readConnectionSettings(
      { METRICS_DEVELOPER_TOKEN: 'metrics-developer-token-0123', UNRELATED_TOKEN: 'unrelated-0123' },
      undefined,
      functions,
      fixtureProviders,
    );

    expect(
      [...providerValues].map(([name, value]: readonly [string, Redacted.Redacted]) => [name, Redacted.value(value)]),
    ).toEqual([['METRICS_DEVELOPER_TOKEN', 'metrics-developer-token-0123']]);
  });

  it('name variables the runtime reads for itself, which connections.variables may not name', () => {
    const naming = { CONNECTIONS: JSON.stringify({ variables: ['METRICS_DEVELOPER_TOKEN'] }) };

    expect(() => readConnectionSettings(naming, undefined, functions, fixtureProviders)).toThrow(
      'METRICS_DEVELOPER_TOKEN is a variable the runtime reads for itself, which no connection may name',
    );
  });
});
