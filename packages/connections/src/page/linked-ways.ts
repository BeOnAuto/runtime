import { accountTypesOf, permissionsOf } from '@on.auto/providers';
import { Schema } from 'effect';

import type { ConnectionServices } from '../operations/connection-services.ts';
import { policyRefusalOf } from '../policy/policy-rules.ts';
import { ListedWaySchema } from '../providers/listed-providers.ts';
import { providingOf } from '../providers/provider-providing.ts';
import { CredentialKindSchema } from '../registry/credential.ts';
import type { KeptConnection } from '../registry/registry.ts';

const { permissions, account_types: accountTypes } = ListedWaySchema.fields;

const LinkedWaySchema = Schema.Struct({
  kind: CredentialKindSchema.annotate({
    description: 'The kind of the way, which choose_way takes as credential.kind.',
  }),
  permissions,
  account_types: accountTypes,
  offered: Schema.Boolean.annotate({ description: 'Whether a person may connect the server this way here.' }),
  because: Schema.optionalKey(Schema.String.annotate({ description: 'Why the way is not offered here.' })),
}).annotate({ description: 'A way a server given by hand offers' });

type LinkedWay = typeof LinkedWaySchema.Type;

type Connection = KeptConnection['connection'];

export const LinkedWaysField = Schema.optionalKey(
  Schema.Array(LinkedWaySchema).annotate({
    description:
      'For a server given by hand, the ways it offers, as its own metadata named them when the connection was added, including the way the connection uses now. choose_way takes one of them. Left out for a connection made from a provider, whose ways list_providers lists.',
  }),
);

type Reading = Pick<ConnectionServices, 'policy' | 'providers' | 'providerValues'>;

function linkedWayOf(connection: Connection, way: Connection['credential'], reading: Reading) {
  const acting = permissionsOf(way);
  const taken = accountTypesOf(way);
  const { provider, type, entry } = connection;
  const addition = { provider, type, entry, credential: way };
  const refusal = policyRefusalOf(reading.policy, addition, providingOf(addition, reading));
  return {
    kind: way.kind,
    ...(acting === undefined ? {} : { permissions: acting }),
    ...(taken.length === 0 ? {} : { account_types: taken }),
    offered: refusal === undefined,
    ...(refusal === undefined ? {} : { because: refusal.detail }),
  };
}

export function linkedWaysOf(
  { connection, ways = [connection.credential] }: Pick<KeptConnection, 'connection' | 'ways'>,
  reading: Reading,
): { readonly ways?: readonly LinkedWay[] } {
  return connection.provider === null ? { ways: ways.map((way) => linkedWayOf(connection, way, reading)) } : {};
}
