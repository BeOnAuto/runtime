import {
  describedAccess,
  serversUnderTest,
  toolAccessBehaviour,
  type CredentialUnderTest,
  type SourcedEntry,
  type SourceUnderTest,
} from '@on.auto/tool-servers/testing';
import { Option, Redacted } from 'effect';
import { expect } from 'vitest';

import { connectionPolicyOf } from '../policy/connection-policy.ts';
import type { Credential } from '../registry/credential.ts';
import { added } from '../testing/additions.ts';
import { ada, harness, operationNamed } from '../testing/harness.ts';
import { makeConnectionSource } from './connection-source.ts';

const variable = 'GRAPH_API_KEY';

const policy = connectionPolicyOf({ variables: [variable] });

type SentIn = Exclude<CredentialUnderTest, { readonly in: 'auth' }>;

interface Placing {
  readonly credential: Credential;
  readonly giving: Readonly<Record<string, string>> | undefined;
  readonly variables: ReadonlyMap<string, Redacted.Redacted>;
}

function isSentIn(credential: CredentialUnderTest): credential is SentIn {
  return credential.in !== 'auth';
}

function givenOnThePage(credential: CredentialUnderTest): Placing {
  const variables = new Map<string, Redacted.Redacted>();
  if (credential.in === 'auth') {
    const { issuer, clientId, value } = credential;
    const clientCredentials: Credential = { kind: 'client_credentials', issuer, client_id: clientId };
    return { credential: clientCredentials, giving: { client_secret: value }, variables };
  }
  const { name, in: placement, value } = credential;
  return { credential: { kind: 'secret', name, in: placement }, giving: { value }, variables };
}

function byReference(credential: CredentialUnderTest): Placing {
  const { name, in: placement, value } = Option.getOrThrow(Option.liftPredicate(credential, isSentIn));
  return {
    credential: { kind: 'reference', variable, name, in: placement },
    giving: undefined,
    variables: new Map([[variable, Redacted.make(value)]]),
  };
}

async function connectedThrough(
  { type, bare, credential }: SourcedEntry,
  placingOf: (c: CredentialUnderTest) => Placing,
) {
  const h = harness({ policy });
  const placing = placingOf(credential);
  const { id, token } = await added(h, { name: 'graph', kind: type, entry: bare, credential: placing.credential });
  const giving = placing.giving === undefined ? 'approve' : 'give_credential';
  await h.call(operationNamed(h.operations, giving), ada, { id, token, ...placing.giving });
  return makeConnectionSource({
    registry: h.ledger.service,
    secrets: h.secrets,
    policy,
    variables: placing.variables,
    modelProviders: [],
  });
}

function aConnection(kind: string, placingOf: (credential: CredentialUnderTest) => Placing): SourceUnderTest {
  return {
    kind,
    recorded: { connection_id: expect.any(String) },
    accessTo: async (served, options) =>
      describedAccess({}, { ...options, connections: await connectedThrough(served, placingOf) }),
  };
}

const onThePage = aConnection('a connection given its credential on the page', givenOnThePage);

const referenced = aConnection('a connection of a reference to a variable', byReference);

for (const underTest of serversUnderTest) {
  toolAccessBehaviour(underTest, onThePage);
}

for (const underTest of serversUnderTest.filter(({ kind }) => !kind.includes('client credentials'))) {
  toolAccessBehaviour(underTest, referenced);
}
