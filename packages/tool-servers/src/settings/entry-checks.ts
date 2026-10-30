import { problem, servedScopeOf, variableNamePattern, type SettingProblem } from '@on.auto/config';
import { Result, type Redacted } from 'effect';

import { endsAtTheFirstSeparator } from '../names/model-facing-names.ts';
import { isServerName } from '../names/tool-reference.ts';
import { apiTransport } from './api-entry-checks.ts';
import { accepted, at, problemsOf, refused, rejected, redactedValuesOf, type Checked } from './checked.ts';
import { checkedAuth, checkedHeaders } from './remote-checks.ts';
import { toolServersSetting, type ServerEntryFields } from './server-entries.ts';
import type {
  DocumentsPlace,
  McpServerSettings,
  ServerSettings,
  ServerType,
  StdioServerSettings,
} from './server-settings.ts';
import { toolListProblems } from './tool-lists.ts';

type Transport<S extends ServerSettings> = S extends ServerSettings
  ? Omit<
      S,
      | 'name'
      | 'orgs'
      | 'playbooks'
      | 'allowed'
      | 'record_content'
      | 'request_id'
      | 'secrets'
      | 'connection'
      | 'provider'
    >
  : never;

const serverKinds: Readonly<Record<ServerType, string>> = {
  mcp: 'an mcp server',
  stdio: 'a stdio server',
  openapi: 'an openapi server',
};

const fieldsOfKinds = {
  mcp: ['url', 'headers', 'auth'],
  stdio: ['command', 'args', 'env'],
  openapi: ['document', 'base_url', 'headers', 'query_params', 'security', 'auth'],
} as const satisfies Readonly<Record<ServerType, readonly (keyof ServerEntryFields)[]>>;

const sourcesOfKinds = { mcp: 'url', stdio: 'command', openapi: 'document' } as const;

const serverTypes: readonly ServerType[] = ['mcp', 'stdio', 'openapi'];

function checkedName(name: string, modelProviders: readonly string[]): Checked<string> {
  if (!isServerName(name)) {
    return refused(
      name,
      [],
      'Expected a name of 1 to 32 lowercase letters, digits and hyphens, starting with a letter',
    );
  }
  if (!endsAtTheFirstSeparator(name)) {
    return refused(
      name,
      [],
      "Expected no two hyphens together and none at the end: a model sees each tool of the server as server__tool, a hyphen as an underscore, and the server's name ends at the first __",
    );
  }
  return modelProviders.includes(name)
    ? refused(
        name,
        [],
        'The name of a model provider or gateway, which a reasoning function could not tell apart from it',
      )
    : accepted(name);
}

export function serverNameProblems(name: string, modelProviders: readonly string[]): readonly SettingProblem[] {
  return problemsOf(checkedName(name, modelProviders));
}

function foreignFieldProblems(name: string, fields: ServerEntryFields, type: ServerType): readonly SettingProblem[] {
  const own: readonly string[] = fieldsOfKinds[type];
  const foreign = [...new Set(serverTypes.flatMap((kind) => fieldsOfKinds[kind]))].filter(
    (field) => !own.includes(field),
  );
  return foreign
    .filter((field) => fields[field] !== undefined)
    .map((field) => problem(toolServersSetting, at(name, field), `Not a field of ${serverKinds[type]}`));
}

function isWebUrl(url: string): boolean {
  return URL.canParse(url) && ['http:', 'https:'].includes(new URL(url).protocol);
}

function mcpTransport(name: string, fields: ServerEntryFields, url: string): Checked<Transport<McpServerSettings>> {
  const checkedUrl = isWebUrl(url) ? accepted(url) : refused(name, ['url'], 'Expected an http or https URL');
  const headers = checkedHeaders(name, fields.headers ?? {}, 'mcp');
  const auth = checkedAuth(name, fields);
  return checkedUrl.ok && headers.ok && auth.ok
    ? accepted({ type: 'mcp', url, headers: headers.value, auth: auth.value })
    : rejected(problemsOf(checkedUrl, headers, auth));
}

function stdioTransport(
  name: string,
  fields: ServerEntryFields,
  command: string,
): Checked<Transport<StdioServerSettings>> {
  const env = fields.env ?? {};
  const problems = [
    ...(command.trim() === '' ? problemsOf(refused(name, ['command'], 'Expected a command')) : []),
    ...Object.keys(env).flatMap((variable) =>
      variableNamePattern.test(variable)
        ? []
        : problemsOf(refused(name, ['env', variable], 'Expected an environment variable name')),
    ),
  ];
  return problems.length === 0
    ? accepted({ type: 'stdio', command, args: fields.args ?? [], env: redactedValuesOf(env) })
    : rejected(problems);
}

function typeOf(fields: ServerEntryFields): ServerType | undefined {
  if (fields.type !== undefined) {
    return fields.type;
  }
  const given = serverTypes.filter((type) => fields[sourcesOfKinds[type]] !== undefined);
  return given.length === 1 ? given[0] : undefined;
}

function missingTransport<A>(name: string, type: ServerType | undefined): Checked<A> {
  return refused(
    name,
    [],
    type === undefined
      ? 'Expected url for an mcp server, command for a stdio server or document for an openapi server, one of the three'
      : `Expected ${sourcesOfKinds[type]} for ${serverKinds[type]}`,
  );
}

function transportOf(
  name: string,
  fields: ServerEntryFields,
  type: ServerType | undefined,
  documents: DocumentsPlace,
): Checked<Transport<ServerSettings>> {
  const { url, command, document } = fields;
  if (type === 'mcp' && url !== undefined) {
    return mcpTransport(name, fields, url);
  }
  if (type === 'stdio' && command !== undefined) {
    return stdioTransport(name, fields, command);
  }
  return type === 'openapi' && document !== undefined
    ? apiTransport(name, fields, document, documents)
    : missingTransport(name, type);
}

function checkedTransport(
  name: string,
  fields: ServerEntryFields,
  documents: DocumentsPlace,
): Checked<Transport<ServerSettings>> {
  const type = typeOf(fields);
  const transport = transportOf(name, fields, type, documents);
  const foreign = type === undefined ? [] : foreignFieldProblems(name, fields, type);
  return transport.ok && foreign.length === 0 ? transport : rejected([...foreign, ...problemsOf(transport)]);
}

type WrittenFields = Pick<ServerEntryFields, 'playbooks' | 'allowed' | 'record_content' | 'request_id'>;

type ServedFields = Pick<ServerSettings, 'playbooks' | 'allowed' | 'record_content' | 'request_id'>;

export function servedFieldsOf({ playbooks, allowed, record_content, request_id }: WrittenFields): ServedFields {
  return {
    playbooks: playbooks ?? null,
    allowed: allowed ?? null,
    record_content: record_content ?? true,
    request_id: request_id ?? null,
  };
}

interface EntryContext {
  readonly modelProviders: readonly string[];
  readonly documents: DocumentsPlace;
  readonly secrets: readonly Redacted.Redacted[];
  readonly provider: string | null;
}

export function checkedEntry(
  name: string,
  fields: ServerEntryFields,
  { modelProviders, documents, secrets, provider }: EntryContext,
): Result.Result<ServerSettings, readonly SettingProblem[]> {
  const named = checkedName(name, modelProviders);
  const scope = servedScopeOf(toolServersSetting, name, fields, 'server');
  const transport = checkedTransport(name, fields, documents);
  const toolLists = toolListProblems(name, fields);
  if (!named.ok || Result.isFailure(scope) || !transport.ok || toolLists.length > 0) {
    return Result.fail([
      ...problemsOf(named),
      ...(Result.isFailure(scope) ? scope.failure : []),
      ...problemsOf(transport),
      ...toolLists,
    ]);
  }
  return Result.succeed({
    ...transport.value,
    name,
    orgs: scope.success.orgs,
    ...servedFieldsOf(fields),
    secrets,
    connection: null,
    provider,
  });
}
