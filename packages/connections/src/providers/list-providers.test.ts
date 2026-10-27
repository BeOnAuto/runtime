import type { CallerIdentity, Outcome, Succeeded } from '@on.auto/operations';
import { providersOf, regions, tracker } from '@on.auto/providers/testing';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { connectionPolicyOf, type ConnectionPolicyFields } from '../policy/connection-policy.ts';
import {
  acmeViewer,
  ada,
  developerTokenSet,
  harness,
  operationNamed,
  type HarnessOptions,
} from '../testing/harness.ts';

const acmeKey: CallerIdentity = { ...ada, id: 'acme-key' };

const adaReading: CallerIdentity = { ...ada, permissions: ['org:read'] };

const ListedSchema = Schema.Struct({
  output: Schema.Struct({
    providers: Schema.Array(
      Schema.Struct({
        name: Schema.String,
        credentials: Schema.Array(
          Schema.Struct({
            kind: Schema.String,
            offered: Schema.Boolean,
            because: Schema.optionalKey(Schema.String),
          }),
        ),
      }),
    ),
    may_add: Schema.Boolean,
    refusal: Schema.NullOr(Schema.String),
  }),
});

const listedOf = Schema.decodeUnknownSync(ListedSchema);

const ledgersListed = {
  name: 'ledgers',
  title: 'Ledgers',
  description: 'Read and post the journal entries of one tenant.',
  website: 'https://developer.ledgers.example.com/api',
  type: 'openapi',
  credentials: [
    {
      kind: 'client_credentials',
      issuer: 'https://auth.ledgers.example.com/{tenant}',
      scope: 'journal.read journal.write',
      description: 'The client id and secret of a client registered for your tenant.',
      offered: true,
    },
  ],
  placeholders: [
    {
      name: 'tenant',
      description: 'Your tenant, as in https://api.ledgers.example.com/<tenant>',
      pattern: '^.{1,40}$',
      example: 'acme',
      required: true,
    },
    {
      name: 'manager',
      description: 'The id of the manager account you connect through, where you connect through one',
      pattern: '^[0-9]{10}$',
      example: '1234567890',
      required: false,
    },
  ],
};

const regionsPlaceholders = [
  {
    name: 'region',
    description: 'The region your account is kept in, which sets the host of the API',
    required: true,
    choices: [
      { value: 'na', title: 'North America' },
      { value: 'eu', title: 'Europe' },
    ],
  },
  {
    name: 'account',
    description: 'The id of your account',
    pattern: '^[A-Za-z0-9]{1,32}$',
    example: 'acme1',
    required: true,
  },
];

function listing(options: HarnessOptions = {}, caller = ada): Promise<Outcome<Succeeded>> {
  const h = harness(options);
  return h.call(operationNamed(h.operations, 'list_providers'), caller);
}

async function addingOf(options: HarnessOptions, caller = ada) {
  const { may_add: mayAdd, refusal } = listedOf(await listing(options, caller)).output;
  return { may_add: mayAdd, refusal };
}

async function waysListedUnder(policy: ConnectionPolicyFields): Promise<readonly string[]> {
  const answer = await listing({ policy: connectionPolicyOf(policy), providers: providersOf(tracker, regions) });
  return listedOf(answer).output.providers.map(
    ({ name, credentials }) => `${name}: ${credentials.map(({ kind }) => kind).join(', ')}`,
  );
}

async function offeringsOf(name: string, options: HarnessOptions) {
  const { providers } = listedOf(await listing(options)).output;
  return providers
    .filter((provider) => provider.name === name)
    .flatMap(({ credentials }) => credentials.map(({ offered, because }) => ({ offered, because })));
}

describe('the providers listed', () => {
  it('are every provider by name, with its ways, the placeholders a person gives, and whether the caller may add', async () => {
    const { output } = Schema.decodeUnknownSync(Schema.Struct({ output: Schema.Unknown }))(await listing());

    expect(output).toMatchObject({
      providers: [
        ledgersListed,
        { name: 'metrics', placeholders: [] },
        {
          name: 'regions',
          credentials: [{ kind: 'secret', in: 'query', name: 'api_key', offered: true }],
          placeholders: regionsPlaceholders,
        },
        { name: 'tracker', credentials: [{ kind: 'secret', scheme: 'Bearer' }, { kind: 'none' }] },
      ],
      may_add: true,
      refusal: null,
    });
  });

  it('offer a way whose values whoever runs the runtime sets only once they are set', async () => {
    expect([
      await offeringsOf('metrics', {}),
      await offeringsOf('metrics', { providerValues: developerTokenSet }),
    ]).toEqual([
      [
        {
          offered: false,
          because:
            'Whoever runs the runtime sets this up first: it sends METRICS_DEVELOPER_TOKEN, which this runtime does not set',
        },
      ],
      [{ offered: true, because: undefined }],
    ]);
  });
});

describe('the providers the rules of the runtime could allow', () => {
  it('are those whose hosts a pattern could take, a host with a placeholder by its shape or its fixed end', async () => {
    const policies: readonly ConnectionPolicyFields[] = [
      {},
      { allowed_hosts: [] },
      { allowed_hosts: ['ACME.tracker.example.com'] },
      { allowed_hosts: ['*.example.com'] },
      { allowed_hosts: ['*.acme.tracker.example.com', 'api-eu.regions.example.com'] },
      { allowed_hosts: ['tracker.example.com'] },
    ];

    expect(await Promise.all(policies.map((policy) => waysListedUnder(policy)))).toEqual([
      ['tracker: secret, none', 'regions: secret'],
      [],
      ['tracker: secret, none'],
      ['tracker: secret, none', 'regions: secret'],
      ['regions: secret'],
      [],
    ]);
  });

  it('list the ways of the kinds the rules take, and no provider without one', async () => {
    expect(await waysListedUnder({ credential_kinds: ['none'] })).toEqual(['tracker: none']);
  });
});

describe('whether a caller may add', () => {
  it('is refused, in the sentence of the first rule that refuses, to a key, a reader and anyone where people may not add', async () => {
    expect([
      await addingOf({}, acmeKey),
      await addingOf({ access: 'keys' }),
      await addingOf({}, adaReading),
      await addingOf({ policy: connectionPolicyOf({ people_may_add: false }) }),
      await addingOf({ access: 'local' }, acmeKey),
    ]).toEqual([
      {
        may_add: false,
        refusal:
          'A connection is added by a person, through an agent signed in as them, and a key cannot add or reconnect one',
      },
      {
        may_add: false,
        refusal:
          'This runtime signs nobody in, so no person can approve a connection: set PUBLIC_URL, or add the server to the configuration',
      },
      { may_add: false, refusal: 'The caller lacks the org:write permission' },
      {
        may_add: false,
        refusal: 'People may not add connections on this runtime: its operator sets up its tool servers itself',
      },
      { may_add: true, refusal: null },
    ]);
  });

  it('is refused for the permission first, then for the adder, then where people may not add, as add_connection is', async () => {
    const nobodyAdds = connectionPolicyOf({ people_may_add: false });

    expect([
      await addingOf({ access: 'keys', policy: nobodyAdds }, adaReading),
      await addingOf({ access: 'keys', policy: nobodyAdds }),
    ]).toEqual([
      { may_add: false, refusal: 'The caller lacks the org:write permission' },
      {
        may_add: false,
        refusal:
          'This runtime signs nobody in, so no person can approve a connection: set PUBLIC_URL, or add the server to the configuration',
      },
    ]);
  });

  it('is asked of a caller who may read the org, and of no other', async () => {
    expect(await listing({}, acmeViewer)).toMatchObject({ status: 'rejected', reason: 'forbidden' });
  });
});
