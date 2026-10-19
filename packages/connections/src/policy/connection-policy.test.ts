import { Effect, Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { registeredClientSecrets } from '../registered-clients/registered-clients.ts';
import { readConnectionsSetting } from './connection-policy.ts';

const ownVariables: ReadonlySet<string> = new Set(['SECRETS_KEY', 'GRAPH_API_KEY']);

function policyOf(environment: Readonly<Record<string, string>>) {
  return Effect.runSync(readConnectionsSetting(environment, ownVariables)).policy;
}

function refusalOf(text: string, environment: Readonly<Record<string, string>> = {}) {
  return Effect.runSync(Effect.flip(readConnectionsSetting({ ...environment, CONNECTIONS: text }, ownVariables)))
    .message;
}

const aRegisteredClient = {
  issuers: ['https://accounts.example.com'],
  client_id: '1234.apps.example.com',
  client_secret: '${EXAMPLE_CLIENT_SECRET}',
};

const environment = { EXAMPLE_CLIENT_SECRET: 'example-client-secret-5f2a' };

describe('the policy of connections', () => {
  it('lets people add any connection when CONNECTIONS is left out or empty', () => {
    const everything = { peopleMayAdd: true, allowedHosts: null, credentialKinds: null, variables: [] };

    expect([policyOf({}), policyOf({ CONNECTIONS: '' })]).toEqual([everything, everything]);
  });

  it('reads the four rules as the file gives them', () => {
    const rules = {
      people_may_add: false,
      allowed_hosts: ['*.example.com'],
      credential_kinds: ['none', 'secret'],
      variables: ['CRM_API_KEY'],
    };

    expect(policyOf({ CONNECTIONS: JSON.stringify(rules) })).toEqual({
      peopleMayAdd: false,
      allowedHosts: ['*.example.com'],
      credentialKinds: ['none', 'secret'],
      variables: ['CRM_API_KEY'],
    });
  });

  it('stops the server at start for a variable that is no name, or one the runtime reads for itself', () => {
    expect(refusalOf(JSON.stringify({ variables: ['CRM_API_KEY', 'SECRETS_KEY', 'crm-key', 'GRAPH_API_KEY'] }))).toBe(
      'The connection settings are invalid. CONNECTIONS: /variables/2: Expected the name of a variable, such as CRM_API_KEY',
    );
    expect(refusalOf(JSON.stringify({ variables: ['CRM_API_KEY', 'SECRETS_KEY', 'GRAPH_API_KEY'] }))).toBe(
      'The connection settings are invalid. CONNECTIONS: /variables/1: SECRETS_KEY is a variable the runtime reads for itself, which no connection may name; CONNECTIONS: /variables/2: GRAPH_API_KEY is a variable the runtime reads for itself, which no connection may name',
    );
  });

  it('stops the server at start for a rule it does not know, a host that is not one and a kind there is not', () => {
    const malformed = { allowed_hosts: ['https://crm.example.com'], credential_kinds: ['token'], maybe: 1 };

    expect(refusalOf(JSON.stringify(malformed))).toBe(
      'The connection settings are invalid. CONNECTIONS: /maybe: Expected no excess property; CONNECTIONS: /allowed_hosts/0: Expected a host, such as crm.example.com, or a host after *. for every host under it; CONNECTIONS: /credential_kinds/0: Expected "none" | "reference" | "secret" | "client_credentials"',
    );
  });
});

describe('the registered clients of CONNECTIONS', () => {
  it('are read apart from the policy, their references substituted from the environment and the policy as it is written', () => {
    const connections = JSON.stringify({ allowed_hosts: ['*.example.com'], registered_clients: [aRegisteredClient] });

    const { policy, registeredClients } = Effect.runSync(
      readConnectionsSetting(
        { CONNECTIONS: connections, EXAMPLE_CLIENT_SECRET: 'example-client-secret-5f2a' },
        ownVariables,
      ),
    );

    expect(policy).toEqual({
      peopleMayAdd: true,
      allowedHosts: ['*.example.com'],
      credentialKinds: null,
      variables: [],
    });
    expect(registeredClients).toMatchObject([
      { clientId: '1234.apps.example.com', credential: { kind: 'client_secret' } },
    ]);
    expect(registeredClientSecrets(registeredClients).map((secret) => Redacted.value(secret))).toEqual([
      'example-client-secret-5f2a',
    ]);
  });

  it('are none where CONNECTIONS names none', () => {
    expect(Effect.runSync(readConnectionsSetting({ CONNECTIONS: '{}' }, ownVariables)).registeredClients).toEqual([]);
  });
});

describe('what stops the start in the registered clients of CONNECTIONS', () => {
  it('a secret, a key or a client id written out as a credential, each refused at its place in its own words and never with its value', () => {
    const writtenOut = {
      ...aRegisteredClient,
      client_secret: 'not-a-reference-5f2a',
      token_endpoint_auth_method: 'client_secret_post',
    };
    const withAKey = {
      issuers: ['https://login.example.net'],
      client_id: 'sk-live-not-an-id-0123456789abcdef',
      private_key: 'not-a-key-either',
      algorithm: 'RS256',
    };

    const refusal = refusalOf(JSON.stringify({ registered_clients: [writtenOut, withAKey] }));

    expect(refusal).toBe(
      [
        'The connection settings are invalid. CONNECTIONS: /registered_clients/0/client_secret: Looks like a client secret written out, which a registered client holds only as a reference to the environment variable that holds it, such as ${EXAMPLE_CLIENT_SECRET}',
        'CONNECTIONS: /registered_clients/1/client_id: Looks like a credential, which a client id never is: the secret or the key of the client goes in its client_secret or its private_key, as a reference',
        'CONNECTIONS: /registered_clients/1/private_key: Looks like a private key written out, which a registered client holds only as a reference to the environment variable that holds it, such as ${EXAMPLE_PRIVATE_KEY}',
      ].join('; '),
    );
    expect(refusal).not.toMatch(/not-a-reference|not-a-key|not-an-id/u);
  });

  it('a credential written out in any other field of a client, and a secret written as the default of a reference', () => {
    const inAnIssuer = { ...aRegisteredClient, issuers: ['https://ada:not-a-password@accounts.example.com'] };
    const asADefault = { ...aRegisteredClient, client_secret: '${UNSET:-not-a-reference-5f2a}' };

    expect(refusalOf(JSON.stringify({ registered_clients: [inAnIssuer] }), environment)).toBe(
      'The connection settings are invalid. CONNECTIONS: /registered_clients/0/issuers/0: Looks like a credential, which a registered client holds only in its client_secret or its private_key, as a reference',
    );
    expect(refusalOf(JSON.stringify({ registered_clients: [asADefault] }))).toBe(
      'The connection settings are invalid. CONNECTIONS: /registered_clients/0/client_secret: Holds a reference whose default looks like a credential, which a registered client never holds; set the variable the reference names instead of writing a default',
    );
  });
});

describe('the empty default of a reference in a registered client', () => {
  it('passes where the variable is set, and stops the start where the value comes to nothing', () => {
    const withAnEmptyDefault = { ...aRegisteredClient, client_secret: '${EXAMPLE_CLIENT_SECRET:-}' };
    const connections = JSON.stringify({ registered_clients: [withAnEmptyDefault] });

    const { registeredClients } = Effect.runSync(
      readConnectionsSetting({ ...environment, CONNECTIONS: connections }, ownVariables),
    );

    expect(registeredClientSecrets(registeredClients).map((secret) => Redacted.value(secret))).toEqual([
      environment.EXAMPLE_CLIENT_SECRET,
    ]);
    expect(refusalOf(connections)).toBe(
      'The connection settings are invalid. CONNECTIONS: /registered_clients/0/client_secret: Is empty once its references are substituted; set the variable it refers to',
    );
  });
});

describe('the references in CONNECTIONS that stop the start', () => {
  it('a reference anywhere but a client secret or a private key, a policy key among them, in words that say so', () => {
    const elsewhere = {
      allowed_hosts: ['crm.example.com', '${CRM_HOST}'],
      variables: ['${CRM_VARIABLE}'],
      registered_clients: [{ ...aRegisteredClient, issuers: ['${EXAMPLE_ISSUER}'], client_id: '${EXAMPLE_CLIENT_ID}' }],
    };
    const misplaced =
      'Holds a reference to an environment variable, which only the client_secret and the private_key of a registered client may hold';

    expect(refusalOf(JSON.stringify(elsewhere), { ...environment, CRM_HOST: 'crm.example.com' })).toBe(
      [
        `The connection settings are invalid. CONNECTIONS: /allowed_hosts/1: ${misplaced}`,
        `CONNECTIONS: /variables/0: ${misplaced}`,
        `CONNECTIONS: /registered_clients/0/issuers/0: ${misplaced}`,
        `CONNECTIONS: /registered_clients/0/client_id: ${misplaced}`,
      ].join('; '),
    );
  });

  it('a secret written out before a reference out of its place, as the file refuses them', () => {
    const both = { ...aRegisteredClient, client_id: '${EXAMPLE_CLIENT_ID}', client_secret: 'not-a-reference-5f2a' };

    expect(refusalOf(JSON.stringify({ registered_clients: [both] }), environment)).toBe(
      'The connection settings are invalid. CONNECTIONS: /registered_clients/0/client_secret: Looks like a client secret written out, which a registered client holds only as a reference to the environment variable that holds it, such as ${EXAMPLE_CLIENT_SECRET}',
    );
  });

  it('a reference whose variable is not set, as the references of the file', () => {
    expect(refusalOf(JSON.stringify({ registered_clients: [aRegisteredClient] }))).toBe(
      'The connection settings are invalid. CONNECTIONS: /registered_clients/0/client_secret: Refers to the environment variable EXAMPLE_CLIENT_SECRET, which is not set',
    );
  });

  it('a variable they refer to that variables names, since it counts among those the runtime reads for itself', () => {
    const connections = JSON.stringify({
      variables: ['EXAMPLE_CLIENT_SECRET'],
      registered_clients: [aRegisteredClient],
    });

    expect(refusalOf(connections, { EXAMPLE_CLIENT_SECRET: 'example-client-secret-5f2a' })).toBe(
      'The connection settings are invalid. CONNECTIONS: /variables/0: EXAMPLE_CLIENT_SECRET is a variable the runtime reads for itself, which no connection may name',
    );
  });

  it('a setting that is no object or no JSON, refused at its root', () => {
    expect(refusalOf('[1]')).toMatch(/^The connection settings are invalid\. CONNECTIONS: \/: Expected /u);
    expect(refusalOf('{registered')).toBe('The connection settings are invalid. CONNECTIONS: /: Expected JSON');
  });
});
