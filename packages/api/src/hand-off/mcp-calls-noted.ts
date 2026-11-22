import { AsyncLocalStorage } from 'node:async_hooks';

import { Predicate } from 'effect';

export interface McpToolNamed {
  readonly operation: boolean;
  readonly arguments: readonly string[];
}

export interface McpNames {
  readonly tools: ReadonlyMap<string, McpToolNamed>;
  readonly guides: ReadonlySet<string>;
  readonly prompts: ReadonlySet<string>;
}

export interface McpNotingBounds {
  readonly mostBytes: number;
  readonly mostNamed: number;
}

export interface McpRequestNoted {
  readonly method?: string;
  readonly messages?: number;
  readonly methods?: string;
  readonly tools?: string;
  readonly tool?: string;
  readonly operation?: string;
  readonly guide?: string;
  readonly resource?: string;
  readonly prompt?: string;
  readonly arguments?: string;
  readonly undeclared?: number;
  readonly protocol?: string;
  readonly client?: string;
  readonly client_version?: string;
  readonly unread?: true;
  readonly request_bytes: number;
}

export interface McpAnswerNoted {
  readonly response_bytes?: number;
  readonly errors?: number;
  readonly error_code?: number;
  readonly tool_errors?: number;
  readonly listed?: number;
}

export type McpCallNoted = McpRequestNoted & McpAnswerNoted;

export interface McpAnswerNoting {
  readonly bytes: (count: number) => void;
  readonly heard: (message: unknown) => void;
  readonly noted: () => McpAnswerNoted;
}

export interface McpCallNoting {
  readonly bytes: (count: number) => void;
  readonly heard: (message: unknown) => void;
  readonly ended: () => void;
}

export type McpCallsTold = (noted: Promise<McpCallNoted>) => void;

export const mostMcpNotes: McpNotingBounds = { mostBytes: 256 * 1024, mostNamed: 4 };

const unknownTool = 'unknown';

const otherMethod = 'other';

const guideAddressPrefix = 'guide://';

const knownMethods: ReadonlySet<string> = new Set([
  'initialize',
  'ping',
  'tools/list',
  'tools/call',
  'resources/list',
  'resources/templates/list',
  'resources/read',
  'resources/subscribe',
  'resources/unsubscribe',
  'prompts/list',
  'prompts/get',
  'completion/complete',
  'logging/setLevel',
  'notifications/initialized',
  'notifications/cancelled',
  'notifications/progress',
  'notifications/roots/list_changed',
]);

const aProtocolVersion = /^\d{4}-\d{2}-\d{2}$/u;

const aClientName = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,30}$/u;

const aClientVersion = /^v?\d{1,6}(?:\.\d{1,6}){0,3}(?:[-+][0-9A-Za-z.]{1,16})?$/u;

const tellings = new AsyncLocalStorage<McpCallsTold>();

function fieldOf(value: unknown, name: string): unknown {
  return Predicate.isObject(value) && Predicate.hasProperty(value, name) ? value[name] : undefined;
}

function textOf(value: unknown, name: string): string | undefined {
  const field = fieldOf(value, name);
  return typeof field === 'string' ? field : undefined;
}

function shaped(value: string | undefined, shape: Readonly<RegExp>): string | undefined {
  return value !== undefined && shape.test(value) ? value : undefined;
}

function methodOf(message: unknown): string | undefined {
  const method = textOf(message, 'method');
  if (method === undefined) {
    return undefined;
  }
  return knownMethods.has(method) ? method : otherMethod;
}

function withValue<K extends string, V>(name: K, value: V | undefined): Partial<Record<K, V>> {
  const noted: Partial<Record<K, V>> = {};
  if (value !== undefined) {
    noted[name] = value;
  }
  return noted;
}

function argumentsNoted(given: unknown, tool: McpToolNamed | undefined): Partial<McpRequestNoted> {
  const names = Predicate.isObject(given) ? Object.keys(given) : [];
  const declared = names.filter((name) => tool?.arguments.includes(name) === true);
  const undeclared = names.length - declared.length;
  return {
    ...withValue('arguments', declared.length === 0 ? undefined : declared.join(',')),
    ...withValue('undeclared', undeclared === 0 ? undefined : undeclared),
  };
}

function toolOf(params: unknown, names: McpNames): string {
  const asked = textOf(params, 'name');
  return asked !== undefined && names.tools.has(asked) ? asked : unknownTool;
}

function toolCallNoted(params: unknown, names: McpNames): Partial<McpRequestNoted> {
  const tool = toolOf(params, names);
  const named = names.tools.get(tool);
  const given = fieldOf(params, 'arguments');
  const guide = tool === 'get_guide' ? textOf(given, 'name') : undefined;
  return {
    tool,
    ...withValue('operation', named?.operation === true ? tool : undefined),
    ...withValue('guide', knownIn(names.guides, guide)),
    ...argumentsNoted(given, named),
  };
}

function knownIn(known: ReadonlySet<string>, name: string | undefined): string | undefined {
  return name !== undefined && known.has(name) ? name : undefined;
}

function resourceOf(params: unknown, names: McpNames): string | undefined {
  const address = textOf(params, 'uri');
  const guide = address?.startsWith(guideAddressPrefix) === true ? address.slice(guideAddressPrefix.length) : undefined;
  return knownIn(names.guides, guide);
}

function initializeNoted(params: unknown): Partial<McpRequestNoted> {
  const client = fieldOf(params, 'clientInfo');
  return {
    ...withValue('protocol', shaped(textOf(params, 'protocolVersion'), aProtocolVersion)),
    ...withValue('client', shaped(textOf(client, 'name'), aClientName)),
    ...withValue('client_version', shaped(textOf(client, 'version'), aClientVersion)),
  };
}

function messageNoted(message: unknown, names: McpNames): Partial<McpRequestNoted> {
  const method = methodOf(message);
  const params = fieldOf(message, 'params');
  const detail = new Map<string | undefined, () => Partial<McpRequestNoted>>([
    ['tools/call', () => toolCallNoted(params, names)],
    ['resources/read', () => withValue('resource', resourceOf(params, names))],
    ['prompts/get', () => withValue('prompt', knownIn(names.prompts, textOf(params, 'name')))],
    ['initialize', () => initializeNoted(params)],
  ]).get(method);
  return { ...withValue('method', method), ...detail?.() };
}

function batchNoted(messages: readonly unknown[], names: McpNames, mostNamed: number): Partial<McpRequestNoted> {
  const methods = messages.flatMap((message) => {
    const method = methodOf(message);
    return method === undefined ? [] : [method];
  });
  const tools = messages
    .filter((message) => methodOf(message) === 'tools/call')
    .map((message) => toolOf(fieldOf(message, 'params'), names));
  return {
    method: 'batch',
    messages: messages.length,
    ...withValue('methods', methods.length === 0 ? undefined : methods.slice(0, mostNamed).join(',')),
    ...withValue('tools', tools.length === 0 ? undefined : tools.slice(0, mostNamed).join(',')),
  };
}

export function mcpRequestNoted(
  messages: readonly unknown[],
  bytes: number,
  names: McpNames,
  { mostBytes, mostNamed }: McpNotingBounds = mostMcpNotes,
): McpRequestNoted {
  if (bytes > mostBytes) {
    return { unread: true, request_bytes: bytes };
  }
  const [only] = messages;
  const noted = messages.length === 1 ? messageNoted(only, names) : batchNoted(messages, names, mostNamed);
  return { ...noted, request_bytes: bytes };
}

function errorCodeOf(message: unknown): number | undefined {
  const code = fieldOf(fieldOf(message, 'error'), 'code');
  return typeof code === 'number' && Number.isInteger(code) ? code : undefined;
}

function listedIn(result: unknown): number {
  return ['tools', 'resources', 'resourceTemplates', 'prompts'].reduce((listed, name) => {
    const items = fieldOf(result, name);
    return listed + (Array.isArray(items) ? items.length : 0);
  }, 0);
}

export function mcpAnswerNoting(): McpAnswerNoting {
  const counted: { bytes: number; errors: number; toolErrors: number; listed: number; code?: number } = {
    bytes: 0,
    errors: 0,
    toolErrors: 0,
    listed: 0,
  };
  return {
    bytes: (count) => {
      counted.bytes += count;
    },
    heard: (message) => {
      const code = errorCodeOf(message);
      if (code !== undefined) {
        counted.errors += 1;
        counted.code ??= code;
      }
      const result = fieldOf(message, 'result');
      counted.toolErrors += fieldOf(result, 'isError') === true ? 1 : 0;
      counted.listed += listedIn(result);
    },
    noted: () => ({
      ...withValue('response_bytes', counted.bytes === 0 ? undefined : counted.bytes),
      ...withValue('errors', counted.errors === 0 ? undefined : counted.errors),
      ...withValue('error_code', counted.code),
      ...withValue('tool_errors', counted.toolErrors === 0 ? undefined : counted.toolErrors),
      ...withValue('listed', counted.listed === 0 ? undefined : counted.listed),
    }),
  };
}

export function mcpCallsNotedIn<A>(work: () => A, told: McpCallsTold): A {
  return tellings.run(told, work);
}

export function notedMcpCall(request: McpRequestNoted): McpCallNoting | undefined {
  const told = tellings.getStore();
  if (told === undefined) {
    return undefined;
  }
  const answer = mcpAnswerNoting();
  const ending: { end?: () => void } = {};
  told(
    new Promise<McpCallNoted>((resolve) => {
      ending.end = () => {
        resolve({ ...request, ...answer.noted() });
      };
    }),
  );
  return {
    bytes: answer.bytes,
    heard: answer.heard,
    ended: () => ending.end?.(),
  };
}
