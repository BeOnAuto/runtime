import {
  clientIdWrittenOut,
  credentialAsDefault,
  credentialProblems,
  decodedJsonSetting,
  decodedSettingValue,
  pointerOf,
  problem,
  referencedVariablesOf,
  settingProblemText,
  substituted,
  variableNamePattern,
  type SettingProblem,
  type Substituted,
} from '@on.auto/config';
import type { RegisteredClient } from '@on.auto/tool-servers';
import { Data, Effect, Option, Result, Schema } from 'effect';

import {
  heldAsWritten,
  referenceHoldingFields,
  type ReferenceHoldingField,
} from '../registered-clients/reference-fields.ts';
import { registeredClientsOf, RegisteredClientsSchema } from '../registered-clients/registered-clients.ts';
import { CredentialKindSchema, type CredentialKind } from '../registry/credential.ts';
import { AddedProvidersSchema, type AddedProviders } from './added-providers.ts';

export const connectionsSetting = 'CONNECTIONS';

export const connectionsSortsOfCredential: readonly string[] = ['credential_kinds', 'token_endpoint_auth_method'];

const registeredClientsKey = 'registered_clients';

const writtenOutWords: Readonly<Record<string, string>> = {
  client_secret:
    'Looks like a client secret written out, which a registered client holds only as a reference to the environment variable that holds it, such as ${EXAMPLE_CLIENT_SECRET}',
  private_key:
    'Looks like a private key written out, which a registered client holds only as a reference to the environment variable that holds it, such as ${EXAMPLE_PRIVATE_KEY}',
  client_id: clientIdWrittenOut,
};

const writtenOutElsewhere =
  'Looks like a credential, which a registered client holds only in its client_secret or its private_key, as a reference';

const writtenAsDefault =
  'Holds a reference whose default looks like a credential, which a registered client never holds; set the variable the reference names instead of writing a default';

const resolvedToNothing = 'Is empty once its references are substituted; set the variable it refers to';

const hostLabel = '[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?';

const HostPatternSchema = Schema.String.check(
  heldAsWritten,
  Schema.isPattern(new RegExp(`^(?:\\*\\.)?${hostLabel}(?:\\.${hostLabel})*$`, 'u'), {
    message: 'Expected a host, such as crm.example.com, or a host after *. for every host under it',
  }),
);

const VariableNameSchema = Schema.String.check(
  heldAsWritten,
  Schema.isPattern(variableNamePattern, { message: 'Expected the name of a variable, such as CRM_API_KEY' }),
);

const policyFields = {
  people_may_add: Schema.optionalKey(
    Schema.Boolean.annotate({
      description: 'Whether people may add connections through their agents; true when left out',
    }),
  ),
  allowed_hosts: Schema.optionalKey(
    Schema.Array(HostPatternSchema).annotate({
      description:
        'The hosts a connection may reach, each a host or *. and a host for every host under it; every host when left out',
    }),
  ),
  credential_kinds: Schema.optionalKey(
    Schema.Array(CredentialKindSchema).annotate({
      description:
        'The kinds of credential a connection may take, of none, reference, secret, client_credentials and authorization; every kind when left out',
    }),
  ),
  variables: Schema.optionalKey(
    Schema.Array(VariableNameSchema).annotate({
      description:
        'The variables of the runtime a reference credential may name, never one the runtime reads for itself; none when left out, so no connection takes a reference',
    }),
  ),
};

const ConnectionPolicyFieldsSchema = Schema.Struct(policyFields);

export const ConnectionsSettingSchema = Schema.Struct({
  ...policyFields,
  registered_clients: Schema.optionalKey(RegisteredClientsSchema),
  auto_clients: Schema.optionalKey(
    Schema.Boolean.annotate({
      description:
        "Whether a provider whose way takes a registered client takes Auto's client too, through Auto's consent service, where no client registered at its issuer covers the scope the way asks; true in local mode and false otherwise when left out. AUTO_CLIENTS wins over it",
    }),
  ),
  providers: Schema.optionalKey(AddedProvidersSchema),
}).annotate({
  description:
    "What people may add as connections through their agents, tool servers of an org which every playbook of the org may use; the clients whoever runs the runtime registered at authorization servers, and whether Auto's clients serve as well; and the providers it adds beside those the runtime ships. CONNECTIONS wins over it",
});

export type ConnectionPolicyFields = typeof ConnectionPolicyFieldsSchema.Type;

type ConnectionsSettingFields = typeof ConnectionsSettingSchema.Type;

type WrittenClient = NonNullable<ConnectionsSettingFields['registered_clients']>[number];

type Environment = Readonly<Record<string, string | undefined>>;

export interface ConnectionPolicy {
  readonly peopleMayAdd: boolean;
  readonly allowedHosts: readonly string[] | null;
  readonly credentialKinds: readonly CredentialKind[] | null;
  readonly variables: readonly string[];
}

export interface ConnectionsSetting {
  readonly policy: ConnectionPolicy;
  readonly registeredClients: readonly RegisteredClient[];
  readonly autoClients: boolean | undefined;
  readonly clientVariables: readonly string[];
  readonly providers: AddedProviders;
}

interface ResolvedClient {
  readonly client: WrittenClient;
  readonly problems: readonly SettingProblem[];
}

interface Substitution {
  readonly field: ReferenceHoldingField;
  readonly pointer: string;
  readonly resolved: Substituted;
}

export class ConnectionsSettingInvalid extends Data.TaggedError('connections_setting_invalid')<{
  readonly message: string;
  readonly problems: readonly SettingProblem[];
}> {}

const decodeWrittenSetting = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Json));

const textOf = Schema.decodeUnknownSync(Schema.String);

export function connectionPolicyOf({
  people_may_add: peopleMayAdd = true,
  allowed_hosts: allowedHosts,
  credential_kinds: credentialKinds,
  variables = [],
}: ConnectionPolicyFields): ConnectionPolicy {
  return { peopleMayAdd, allowedHosts: allowedHosts ?? null, credentialKinds: credentialKinds ?? null, variables };
}

function ownVariableProblems(
  { variables }: ConnectionPolicy,
  ownVariables: ReadonlySet<string>,
): readonly SettingProblem[] {
  return variables.flatMap((name, index) =>
    ownVariables.has(name)
      ? [
          problem(
            connectionsSetting,
            `/variables/${String(index)}`,
            `${name} is a variable the runtime reads for itself, which no connection may name`,
          ),
        ]
      : [],
  );
}

function invalid(problems: readonly SettingProblem[]): ConnectionsSettingInvalid {
  const listed = problems.map((refused) => settingProblemText(refused)).join('; ');
  return new ConnectionsSettingInvalid({ message: `The connection settings are invalid. ${listed}`, problems });
}

function writtenClientsOf(written: Schema.Json): Schema.Json {
  return Option.getOrElse(
    Option.flatMap(decodeWrittenSetting(written), (setting) => Option.fromNullishOr(setting[registeredClientsKey])),
    () => [],
  );
}

function writtenOutProblemsOf(clients: Schema.Json): readonly SettingProblem[] {
  const pointer = `/${registeredClientsKey}`;
  return credentialProblems(registeredClientsKey, clients, pointer, connectionsSortsOfCredential).map((place) =>
    problem(
      connectionsSetting,
      place.pointer,
      place.detail === credentialAsDefault
        ? writtenAsDefault
        : (writtenOutWords[place.pointer.split('/').slice(3, 4).join('')] ?? writtenOutElsewhere),
    ),
  );
}

function problemsOf({ pointer, resolved }: Substitution): readonly SettingProblem[] {
  const unresolved = resolved.problems.map((each) => problem(connectionsSetting, each.pointer, each.detail));
  return unresolved.length === 0 && textOf(resolved.value) === ''
    ? [problem(connectionsSetting, pointer, resolvedToNothing)]
    : unresolved;
}

function substitutionsOf(client: WrittenClient, index: number, environment: Environment): readonly Substitution[] {
  return referenceHoldingFields.flatMap((field) => {
    const text = client[field];
    const pointer = pointerOf([registeredClientsKey, index, field]);
    return text === undefined ? [] : [{ field, pointer, resolved: substituted(text, pointer, environment) }];
  });
}

function resolvedClientOf(client: WrittenClient, index: number, environment: Environment): ResolvedClient {
  const substitutions = substitutionsOf(client, index, environment);
  const values: Partial<Record<ReferenceHoldingField, string>> = Object.fromEntries(
    substitutions.map(({ field, resolved }) => [field, textOf(resolved.value)]),
  );
  return { client: { ...client, ...values }, problems: substitutions.flatMap((each) => problemsOf(each)) };
}

function clientsResolved(
  clients: readonly WrittenClient[],
  environment: Environment,
): Result.Result<readonly WrittenClient[], readonly SettingProblem[]> {
  const resolved = clients.map((client, index) => resolvedClientOf(client, index, environment));
  const problems = resolved.flatMap((each) => each.problems);
  return problems.length === 0 ? Result.succeed(resolved.map(({ client }) => client)) : Result.fail(problems);
}

function decodedFields(
  written: Schema.Json,
  clients: Schema.Json,
): Result.Result<ConnectionsSettingFields, readonly SettingProblem[]> {
  const writtenOut = writtenOutProblemsOf(clients);
  return writtenOut.length > 0
    ? Result.fail(writtenOut)
    : decodedSettingValue(connectionsSetting, written, ConnectionsSettingSchema);
}

function settingOf(
  written: Schema.Json,
  environment: Environment,
): Result.Result<ConnectionsSetting, readonly SettingProblem[]> {
  const clients = writtenClientsOf(written);
  return Result.flatMap(decodedFields(written, clients), (fields) =>
    Result.map(clientsResolved(fields.registered_clients ?? [], environment), (resolved) => ({
      policy: connectionPolicyOf(fields),
      registeredClients: registeredClientsOf(resolved),
      autoClients: fields.auto_clients,
      clientVariables: referencedVariablesOf(clients),
      providers: fields.providers ?? [],
    })),
  );
}

export function readConnectionsSetting(
  environment: Environment,
): Effect.Effect<ConnectionsSetting, ConnectionsSettingInvalid> {
  const text = environment[connectionsSetting];
  if (text === undefined || text === '') {
    return Effect.succeed({
      policy: connectionPolicyOf({}),
      registeredClients: [],
      autoClients: undefined,
      clientVariables: [],
      providers: [],
    });
  }
  const read = Result.flatMap(decodedJsonSetting(connectionsSetting, text, Schema.Json), (written) =>
    settingOf(written, environment),
  );
  return Result.match(read, {
    onSuccess: (setting) => Effect.succeed(setting),
    onFailure: (problems) => Effect.fail(invalid(problems)),
  });
}

export function namingNoOwnVariable(
  setting: ConnectionsSetting,
  ownVariables: ReadonlySet<string>,
): Effect.Effect<ConnectionsSetting, ConnectionsSettingInvalid> {
  const problems = ownVariableProblems(setting.policy, new Set([...ownVariables, ...setting.clientVariables]));
  return problems.length === 0 ? Effect.succeed(setting) : Effect.fail(invalid(problems));
}
