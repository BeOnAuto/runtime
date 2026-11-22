import {
  type AccessDecision,
  type AccessRequest,
  busyRefusal,
  type CallerIdentity,
  CallPermission,
  callPermissionDecidedBy,
  type Outcome,
  type PolicyDecisionPoint,
  roleRefusalDetail,
} from '@on.auto/operations';
import { decidingEach } from '@on.auto/operations/testing';
import { agents, drive, providersOf, regions, tracker } from '@on.auto/providers/testing';
import { shippedDocumentOf } from '@on.auto/tool-servers';
import { consentClientWith, fakeApiDocument, registeredAt } from '@on.auto/tool-servers/testing';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeProviderOffering } from '../index.ts';
import { connectionPolicyOf } from '../policy/connection-policy.ts';
import { added, adding, issuesIn } from '../testing/additions.ts';
import {
  ada,
  connectionServicesWith,
  harness,
  type Harness,
  harnessPages,
  operationNamed,
} from '../testing/harness.ts';

const anyWords: unknown = expect.any(String);

const acmeTracker = { provider: 'tracker', placeholders: { site: 'acme' } };

const keyed = {
  ...tracker,
  name: 'keyed',
  url: 'https://keyed.example.com/mcp',
  headers: { 'X-Api-Key': '{key_id}' },
  placeholders: { key_id: { description: 'The id of your key', pattern: '^[a-z0-9]{4,32}$', example: 'acme' } },
  credentials: [{ ...tracker.credentials[0], scheme: 'Bearer$' }],
};

const keyedHeader = { ...keyed, name: 'keyed-header', credentials: [{ kind: 'none' }] };

const notesApi = {
  name: 'notes-api',
  title: 'Notes',
  description: 'Read notes.',
  website: 'https://developer.notes.example.com',
  type: 'openapi',
  document: 'documents/notes-api.openapi.json',
  base_url: 'https://api.notes.example.org/v1',
  credentials: [{ kind: 'none' }],
};

const notesDocument = new TextEncoder().encode(JSON.stringify(fakeApiDocument('3.1', notesApi.base_url)));

const notesShipped = new Map([[notesApi.document, shippedDocumentOf(notesDocument)]]);

const openai = { ...tracker, name: 'openai', url: 'https://openai-tools.example.com/mcp', placeholders: {} };

const adaReading: CallerIdentity = { ...ada, permissions: ['org:read'] };

const allowed: AccessDecision = { decision: 'allow', determiningPolicies: ['by-the-test'], errors: [] };

const denied: AccessDecision = { decision: 'deny', determiningPolicies: [], errors: [] };

function decidedOf(addingDecided: AccessDecision): PolicyDecisionPoint {
  const decided = (request: AccessRequest) => (request.action.name === 'add_connection' ? addingDecided : allowed);
  return decidingEach((request) => Effect.succeed(decided(request)));
}

const AddingSchema = Schema.Struct({
  output: Schema.Struct({ may_add: Schema.Boolean, refusal: Schema.NullOr(Schema.String) }),
});

const addingIn = Schema.decodeUnknownSync(AddingSchema);

function listedBy(addingDecided: AccessDecision, caller: CallerIdentity): Promise<Outcome> {
  const h = harness({ decidedBy: decidedOf(addingDecided) });
  return h.call(operationNamed(h.operations, 'list_providers'), caller);
}

function offeredTo(addingDecided: AccessDecision, caller: CallerIdentity) {
  const offering = makeProviderOffering(
    connectionServicesWith({ policy: connectionPolicyOf({}), pages: harnessPages, consent: consentClientWith() }),
  );
  return Effect.runSync(
    offering(caller).pipe(Effect.provideService(CallPermission, callPermissionDecidedBy(decidedOf(addingDecided)))),
  );
}

const issuer = 'https://accounts.drive.example.com';

const [driveWay] = drive.credentials;

const shareWords = 'Share the files of the account with other people.';

const sharing = {
  name: 'share',
  for: 'Share your files with other people.',
  scope: 'files.share',
  says: { 'files.share': shareWords },
};

const files = {
  ...drive,
  name: 'files',
  credentials: [{ ...driveWay, more: [sharing] }],
};

function harnessCovering(scopes?: readonly string[]): Harness {
  const client = scopes === undefined ? registeredAt(issuer) : registeredAt(issuer, { scopes });
  return harness({ providers: providersOf(files), consenting: { registeredClients: [client] } });
}

function waysListedBy(h: Harness) {
  return h.call(operationNamed(h.operations, 'list_providers'), ada);
}

const notCovered =
  'The provider files takes consent through a client whoever runs Auto registers, and no client set up here covers every scope its way asks, files.read files.write';

describe('a connection added by a provider', () => {
  it('is the provider resolved, recorded with the provider and the values given, and pending with its link', async () => {
    const h = harness();

    expect(await adding(h, acmeTracker)).toMatchObject({
      status: 'succeeded',
      output: {
        name: 'tracker',
        type: 'mcp',
        provider: 'tracker',
        placeholders: { site: 'acme' },
        entry: { url: 'https://acme.tracker.example.com/mcp' },
        credential: { kind: 'secret', in: 'header', name: 'Authorization', scheme: 'Bearer' },
        status: 'pending',
        connect: {},
      },
    });
    expect((await h.facts())[0]?.data).toMatchObject({
      name: 'tracker',
      server_type: 'mcp',
      provider: 'tracker',
      placeholders: { site: 'acme' },
      entry: { url: 'https://acme.tracker.example.com/mcp' },
    });
  });

  it('takes the name, the way and what is per connection from the caller', async () => {
    const given = {
      ...acmeTracker,
      name: 'acme-issues',
      entry: { playbooks: ['support'], allowed: ['search'], record_content: false },
      credential: { kind: 'none' },
    };

    expect(await adding(harness(), given)).toMatchObject({
      output: {
        name: 'acme-issues',
        entry: {
          url: 'https://acme.tracker.example.com/mcp',
          playbooks: ['support'],
          allowed: ['search'],
          record_content: false,
        },
        credential: { kind: 'none' },
      },
    });
  });
});

describe('a connection added by hand', () => {
  it('answers a server given by hand with no provider and no placeholders', async () => {
    const { id } = await added(harness(), {
      name: 'notes',
      type: 'mcp',
      entry: { url: 'https://notes.example.com/mcp' },
      credential: { kind: 'none' },
    });

    expect(id).toMatch(/^[\da-f-]{36}$/u);
  });
});

describe('the input of a connection added by a provider', () => {
  it('refuses the server and every field of the credential but its kind, its scope and how its key is made among them, and the client id the person gives on the page', async () => {
    const given = {
      ...acmeTracker,
      type: 'mcp',
      entry: { url: 'https://elsewhere.example.com/mcp', headers: { 'X-Tenant': 'acme' } },
      credential: {
        kind: 'secret',
        name: 'X-Key',
        in: 'header',
        scope: 'issues.read',
        instructions: 'Make a key under **Settings**.',
        pattern: '^trk_.+$',
        client_id: 'acme',
      },
    };

    expect(issuesIn(await adding(harness(), given))).toEqual([
      { pointer: '/type', detail: 'Expected no type: the provider gives it' },
      { pointer: '/entry/url', detail: 'Expected no url: the provider gives the server' },
      { pointer: '/entry/headers', detail: 'Expected no headers: the provider gives the server' },
      { pointer: '/credential/name', detail: anyWords },
      { pointer: '/credential/in', detail: anyWords },
      { pointer: '/credential/scope', detail: anyWords },
      {
        pointer: '/credential/instructions',
        detail: anyWords,
      },
      { pointer: '/credential/pattern', detail: anyWords },
      { pointer: '/credential/client_id', detail: anyWords },
    ]);
  });

  it('without a provider, takes the server by hand and refuses placeholders', async () => {
    expect(issuesIn(await adding(harness(), { placeholders: { site: 'acme' } }))).toEqual([
      { pointer: '/name', detail: anyWords },
      { pointer: '/type', detail: anyWords },
      { pointer: '/entry', detail: anyWords },
      { pointer: '/credential', detail: anyWords },
      { pointer: '/placeholders', detail: 'Expected no placeholders without provider' },
    ]);
  });
});

describe('a provider a caller names', () => {
  it('is refused at /provider where the runtime has none of that name, and at the field written otherwise', async () => {
    const h = harness();

    expect(await adding(h, { provider: 'crm' })).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The connection cannot be added as it is given',
      issues: [
        {
          pointer: '/provider',
          detail: 'There is no provider named crm here; search lists the providers a person may connect',
        },
      ],
    });
    expect(
      issuesIn(
        await adding(h, { provider: 'regions', placeholders: { region: 'apac' }, credential: { kind: 'none' } }),
      ),
    ).toEqual([
      { pointer: '/placeholders/region', detail: 'Expected one of na or eu' },
      { pointer: '/placeholders/account', detail: 'Expected account: The id of your account' },
      { pointer: '/credential/kind', detail: 'The provider regions takes no none credential; it takes secret' },
    ]);
  });
});

describe('a provider whose addition the checks refuse', () => {
  it('is refused at /provider for what the checks of an addition find in what it resolved, at /name for a name given', async () => {
    const h = harness({ providers: providersOf(keyed, keyedHeader, openai, regions) });

    expect([
      issuesIn(await adding(h, { provider: 'keyed', placeholders: { key_id: 'acme' } })),
      issuesIn(await adding(h, { provider: 'keyed-header', placeholders: { key_id: 'acme' } })),
      issuesIn(await adding(h, { provider: 'openai' })),
      issuesIn(await adding(h, { provider: 'openai', name: 'Tools' })),
      issuesIn(await adding(h, { provider: 'openai', name: 'tools', entry: { playbooks: ['Sales'] } })),
    ]).toEqual([
      [
        {
          pointer: '/provider',
          detail: 'Expected a scheme without $, which the reading of the entry takes for a reference or an escape',
        },
      ],
      [
        {
          pointer: '/provider',
          detail:
            "Looks like a credential, which a connection's entry never holds: the person gives it on the page the link opens",
        },
      ],
      [
        {
          pointer: '/provider',
          detail: 'The name of a model provider or gateway, which a reasoning function could not tell apart from it',
        },
      ],
      [
        {
          pointer: '/name',
          detail: 'Expected a name of 1 to 32 lowercase letters, digits and hyphens, starting with a letter',
        },
      ],
      [{ pointer: '/entry/playbooks/0', detail: 'Expected a playbook id' }],
    ]);
  });
});

describe('the rules a connection added by a provider passes', () => {
  it('are those of a server given by hand: the hosts, the kinds and the names the file and the org hold', async () => {
    const h = harness({
      policy: connectionPolicyOf({ allowed_hosts: ['*.example.org'], credential_kinds: ['secret'] }),
    });

    expect([
      await adding(h, acmeTracker),
      await adding(harness({ policy: connectionPolicyOf({ credential_kinds: ['secret'] }) }), {
        ...acmeTracker,
        credential: { kind: 'none' },
      }),
      await adding(harness(), { ...acmeTracker, name: 'wiki' }),
    ]).toMatchObject([
      {
        reason: 'forbidden',
        detail:
          'A connection may not reach the host acme.tracker.example.com on this runtime, which allows *.example.org',
      },
      {
        reason: 'forbidden',
        detail: 'A connection may not take a none credential on this runtime, which allows secret',
      },
      { reason: 'conflict', kind: 'taken' },
    ]);
  });

  it('judge the host of an address a person gives whole by the hosts the operator allows, as for a server given by hand', async () => {
    const h = harness({
      policy: connectionPolicyOf({ allowed_hosts: ['*.acme.example.com'] }),
      providers: providersOf(agents),
    });
    const at = (address: string) => adding(h, { provider: 'agents', placeholders: { address } });

    expect([
      await at('https://agents.other.example.org/mcp'),
      await at('https://agents.acme.example.com/mcp'),
    ]).toMatchObject([
      {
        reason: 'forbidden',
        detail:
          'A connection may not reach the host agents.other.example.org on this runtime, which allows *.acme.example.com',
      },
      { status: 'succeeded', output: { provider: 'agents', entry: { url: 'https://agents.acme.example.com/mcp' } } },
    ]);
  });

  it('take the document beside the entries of a provider, which is no host, and judge the host its calls go to', async () => {
    const h = harness({
      policy: connectionPolicyOf({ allowed_hosts: ['*.example.org'] }),
      providers: { ...providersOf(notesApi), documents: notesShipped },
    });

    expect(await adding(h, { provider: 'notes-api' })).toMatchObject({
      status: 'succeeded',
      output: { type: 'openapi', entry: { document: 'documents/notes-api.openapi.json' }, status: 'pending' },
    });
  });

  it('say which provider could not be connected in the words of the refusal', async () => {
    expect(await adding(harness({ policy: connectionPolicyOf({ people_may_add: false }) }), acmeTracker)).toMatchObject(
      {
        reason: 'forbidden',
        detail: 'People may not add connections on this runtime: its operator sets up its tool servers itself',
      },
    );
  });
});

describe('whether a caller may add a connection, where a policy decision point decides', () => {
  it('is what it decides of add_connection, whatever the credential grants, and its refusal for the role is said so', async () => {
    expect([
      addingIn(await listedBy(allowed, adaReading)).output,
      addingIn(await listedBy(denied, ada)).output,
    ]).toEqual([
      { may_add: true, refusal: null },
      { may_add: false, refusal: roleRefusalDetail },
    ]);
  });

  it('offers search no answer at all, rather than no providers, where whether the caller may add is not decided in time', () => {
    const offering = makeProviderOffering(
      connectionServicesWith({ policy: connectionPolicyOf({}), pages: harnessPages, consent: consentClientWith() }),
    );
    const refused = Effect.runSync(
      Effect.flip(offering(ada)).pipe(
        Effect.provideService(CallPermission, () => Effect.fail(busyRefusal('nothing was done', 4))),
      ),
    );

    expect(refused).toMatchObject({ _tag: 'unavailable', kind: 'busy', retry_after: 4 });
  });

  it('offers search the providers to a caller it allows to add, and none to a caller it does not', () => {
    expect(offeredTo(allowed, adaReading)).not.toHaveLength(0);
    expect(offeredTo(denied, ada)).toBeUndefined();
  });
});

describe('the listing of a provider whose way names what a later consent may add', () => {
  it('answers the scopes its first consent asks and each group of more by its name, what it is for and the words of its scopes', async () => {
    expect(await waysListedBy(harnessCovering())).toMatchObject({
      output: {
        providers: [
          {
            name: 'files',
            credentials: [
              {
                kind: 'authorization',
                scopes: [
                  { name: 'files.read', says: 'Read the files of the account.' },
                  { name: 'files.write', says: 'Create and change the files of the account.' },
                ],
                more: [{ name: 'share', for: sharing.for, scopes: [{ name: 'files.share', says: shareWords }] }],
                offered: true,
              },
            ],
          },
        ],
      },
    });
  });
});

describe('a provider whose way names more, by the clients set up for it', () => {
  it('is offered and added where a client covers the scopes of its first consent, whether or not it covers a group of more', async () => {
    const h = harnessCovering(['files.read', 'files.write']);

    expect(await waysListedBy(h)).toMatchObject({
      output: { providers: [{ credentials: [{ offered: true }] }] },
    });
    expect(await adding(h, { provider: 'files' })).toMatchObject({
      status: 'succeeded',
      output: { credential: { scope: 'files.read files.write' } },
    });
  });

  it('is offered under the organization’s own OAuth client alone, in words that name its scope, where no client covers its first consent', async () => {
    const h = harnessCovering(['files.read', 'files.share']);

    expect(await waysListedBy(h)).toMatchObject({
      output: { providers: [{ credentials: [{ offered: true, oauth_client: 'required', because: notCovered }] }] },
    });
    expect(await adding(h, { provider: 'files', credential: { kind: 'authorization' } })).toMatchObject({
      status: 'succeeded',
      output: { credential: { scope: 'files.read files.write', client_source: 'own' } },
    });
  });
});
