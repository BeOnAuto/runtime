import { Redacted, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  documentServerOf,
  hostAlternativesOf,
  operatorVariablesOf,
  operatorValuesIn,
  operatorVariablesIn,
  providerNamed,
  type Provider,
} from '../index.ts';
import {
  fixtureProviders,
  ledgers,
  metrics,
  providerOf,
  providersOf,
  regions,
  tracker,
} from '../testing/fixture-providers.ts';

function waysOf(provider: Provider) {
  return provider.entry.credentials.map((way) => hostAlternativesOf(provider, way));
}

function named(name: string): Provider {
  return Result.getOrThrow(providerNamed(fixtureProviders, name));
}

describe('the hosts a way of a provider reaches', () => {
  it('are its server, with a placeholder a person gives in its place, and the issuer of client credentials', () => {
    expect([waysOf(named('tracker')), waysOf(named('ledgers'))]).toEqual([
      [[['{site}.tracker.example.com']], [['{site}.tracker.example.com']]],
      [[['api.ledgers.example.com', 'auth.ledgers.example.com']]],
    ]);
  });

  it('hold the placeholder of an issuer that names its host in its place', () => {
    const issuing = providersOf({
      ...ledgers,
      credentials: [{ kind: 'client_credentials', issuer: 'https://{tenant}.auth.ledgers.example.com' }],
    });

    expect(waysOf(Result.getOrThrow(providerNamed(issuing, 'ledgers')))).toEqual([
      [['api.ledgers.example.com', '{tenant}.auth.ledgers.example.com']],
    ]);
  });

  it('are one set for each choice of a placeholder whose choices set the host', () => {
    expect(waysOf(named('regions'))).toEqual([[['api-na.regions.example.com'], ['api-eu.regions.example.com']]]);
  });
});

describe('the server of the document of a provider', () => {
  it('is its address where its document lies beside the entries and it gives no base_url, and none otherwise', () => {
    const beside = { ...ledgers, document: 'documents/ledgers.openapi.json' };
    const { base_url: _baseUrl, ...unbased } = beside;
    const { base_url: _remoteBaseUrl, ...remote } = ledgers;

    expect(
      [
        providerOf(unbased, 'https://api.ledgers.example.com/v2'),
        providerOf(beside),
        providerOf(remote),
        providerOf(tracker),
      ].map((provider) => documentServerOf(provider)),
    ).toEqual(['https://api.ledgers.example.com/v2', undefined, undefined, undefined]);
  });
});

describe('the variables of the operator a provider refers to', () => {
  it('are named by the references of its headers and query values', () => {
    expect([metrics, ledgers, regions, tracker].map((entry) => operatorVariablesOf(entry))).toEqual([
      ['METRICS_DEVELOPER_TOKEN'],
      [],
      [],
      [],
    ]);
  });

  it('are set where the environment gives each a value', () => {
    const values = [
      operatorValuesIn(fixtureProviders, { METRICS_DEVELOPER_TOKEN: 'token-of-the-operator' }),
      operatorValuesIn(fixtureProviders, { METRICS_DEVELOPER_TOKEN: '' }),
      operatorValuesIn(fixtureProviders, {}),
    ];

    expect(operatorVariablesIn(fixtureProviders)).toEqual(['METRICS_DEVELOPER_TOKEN']);
    expect(
      values.map((set) =>
        [...set].map(([name, value]: readonly [string, Redacted.Redacted]) => [name, Redacted.value(value)]),
      ),
    ).toEqual([[['METRICS_DEVELOPER_TOKEN', 'token-of-the-operator']], [], []]);
  });
});

describe('a provider named', () => {
  it('is the provider of that name in the list, or a refusal at /provider', () => {
    expect(named('tracker').entry).toEqual(tracker);
    expect(Result.getOrThrow(Result.flip(providerNamed(fixtureProviders, 'crm')))).toEqual([
      { pointer: '/provider', detail: 'There is no provider named crm here' },
    ]);
  });
});
