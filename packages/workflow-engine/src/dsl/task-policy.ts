import { namesOf, theFunctions, type CallFunctions } from './call-functions.ts';
import { field, isList, isObject, listField, objectField, textField, type Json, type JsonObject } from './json.ts';
import {
  durationRejections,
  forbidden,
  rejection,
  retryPolicyRejections,
  timeoutRejections,
  type Components,
  type Located,
  type Rejection,
} from './policy-checks.ts';
import { kindOf, pointerTo, type TaskEntry, type TaskKind } from './tasks.ts';

type OwnRejections = (task: JsonObject, reference: string, components: Components) => readonly Rejection[];

const mostForkBranches = 32;

const outboundCalls = new Set(['http', 'grpc', 'openapi', 'asyncapi', 'a2a', 'mcp']);

const rejectionsByKind: Readonly<Record<Exclude<TaskKind, 'call' | 'emit'>, OwnRejections>> = {
  run: (_task, reference) => [
    forbidden(`${reference}/run`, 'run tasks (shell, script, container, workflow) are not allowed'),
  ],
  listen: (task, reference) => listenRejections(task, reference),
  raise: (task, reference, components) => raiseRejections(task, reference, components),
  wait: (task, reference) => durationRejections(field(task, 'wait'), `${reference}/wait`),
  set: () => [],
  switch: () => [],
  for: (task, reference) => {
    const loop = objectField(task, 'for') ?? {};
    return boundNameRejections(field(loop, 'each'), `${reference}/for/each`).concat(
      boundNameRejections(field(loop, 'at'), `${reference}/for/at`),
    );
  },
  try: (task, reference, components) =>
    catchRejections(objectField(task, 'catch') ?? {}, `${reference}/catch`, components),
  fork: (task, reference) => forkRejections(task, reference),
  do: () => [],
};

export function ownRejections(
  { task, reference }: TaskEntry,
  components: Components,
  functions: CallFunctions,
): readonly Rejection[] {
  const kind = kindOf(task);
  if (kind === undefined) {
    return [rejection(reference, 'The task has no type this runtime knows')];
  }
  if (kind === 'call') {
    return callRejections(task, reference, functions);
  }
  return kind === 'emit'
    ? emitRejections(task, reference, functions)
    : rejectionsByKind[kind](task, reference, components);
}

const emittedEventIdRefused =
  'An emitted event takes no id: the runtime gives it one of its own, so that a run that resumes emits it once';

function emitRejections(task: JsonObject, reference: string, functions: CallFunctions): readonly Rejection[] {
  const attributes = objectField(objectField(objectField(task, 'emit') ?? {}, 'event') ?? {}, 'with');
  if (attributes === undefined) {
    return [rejection(`${reference}/emit`, 'emit takes event.with, a mapping of the attributes of the event to emit')];
  }
  const pointer = `${reference}/emit/event/with`;
  const missing = ['type', 'source']
    .filter((name) => field(attributes, name) === undefined)
    .map((name) => rejection(pointerTo(pointer, name), `The event to emit needs a ${name}`));
  const id = field(attributes, 'id') === undefined ? [] : [rejection(pointerTo(pointer, 'id'), emittedEventIdRefused)];
  return missing.concat(id, functions.emitRejections?.(attributes, pointer) ?? []);
}

export function commonRejections({ task, reference }: TaskEntry, components: Components): readonly Rejection[] {
  return dataRejections(task, reference, 'input').concat(
    dataRejections(task, reference, 'output'),
    dataRejections(task, reference, 'export'),
    timeoutRejections(field(task, 'timeout'), `${reference}/timeout`, components),
  );
}

export const runtimeNames: readonly string[] = ['data', 'input', 'output', 'context', 'task', 'workflow', 'runtime'];

const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/u;

function boundNameRejections(name: Json | undefined, pointer: string): readonly Rejection[] {
  if (name === undefined) {
    return [];
  }
  if (typeof name !== 'string' || !identifier.test(name)) {
    return [
      rejection(pointer, 'A name a task binds is an identifier of letters, digits and underscores, such as line'),
    ];
  }
  return runtimeNames.includes(name)
    ? [
        forbidden(
          pointer,
          `$${name} is a name the runtime gives every expression; bind a name of your own, such as line`,
        ),
      ]
    : [];
}

export type LocatedFilter = readonly [Json, string];

export function eventFiltersOf(to: JsonObject, pointer: string): readonly LocatedFilter[] {
  const one = field(to, 'one');
  if (one !== undefined) {
    return [[one, `${pointer}/one`]];
  }
  const strategy = field(to, 'all') === undefined ? 'any' : 'all';
  return (listField(to, strategy) ?? []).map((filter, index): LocatedFilter => [
    filter,
    `${pointer}/${strategy}/${index}`,
  ]);
}

function dataRejections(task: JsonObject, reference: string, part: string): readonly Rejection[] {
  const data = objectField(task, part) ?? {};
  return field(data, 'schema') === undefined
    ? []
    : [forbidden(`${reference}/${part}/schema`, 'Task schemas are not checked in this version; leave them out')];
}

function callRejections(task: JsonObject, reference: string, functions: CallFunctions): readonly Rejection[] {
  const name = textField(task, 'call') ?? '';
  if (outboundCalls.has(name)) {
    return [
      forbidden(
        `${reference}/call`,
        `call: ${name} is not allowed: ${functions.howAWorkflowReachesTheWorld}; call ${namesOf(functions)}`,
      ),
    ];
  }
  const argumentChecks = Object.hasOwn(functions.argumentChecks, name) ? functions.argumentChecks[name] : undefined;
  return argumentChecks === undefined
    ? [forbidden(`${reference}/call`, `call: ${name} names no function; ${theFunctions(functions)}`)]
    : argumentChecks(field(task, 'with'), `${reference}/with`);
}

function listenRejections(task: JsonObject, reference: string): readonly Rejection[] {
  const to = objectField(objectField(task, 'listen') ?? {}, 'to') ?? {};
  const pointer = `${reference}/listen/to`;
  const until =
    field(to, 'until') === undefined
      ? []
      : [forbidden(`${pointer}/until`, 'listen until is not supported in this version')];
  const foreach =
    field(task, 'foreach') === undefined
      ? []
      : [forbidden(`${reference}/foreach`, 'listen foreach is not supported in this version')];
  return until.concat(
    foreach,
    eventFiltersOf(to, pointer).flatMap(([filter, at]: Located) => eventFilterRejections(filter, at)),
  );
}

export function eventFilterRejections(filter: Json | undefined, pointer: string): readonly Rejection[] {
  if (!isObject(filter)) {
    return [];
  }
  return field(filter, 'correlate') === undefined
    ? []
    : [forbidden(`${pointer}/correlate`, 'Correlating events is not supported in this version')];
}

function raiseRejections(task: JsonObject, reference: string, components: Components): readonly Rejection[] {
  const error = field(objectField(task, 'raise') ?? {}, 'error');
  const pointer = `${reference}/raise/error`;
  return typeof error === 'string' && field(components.errors, error) === undefined
    ? [rejection(pointer, `use.errors has no error ${error}`)]
    : [];
}

function catchRejections(handler: JsonObject, pointer: string, components: Components): readonly Rejection[] {
  return boundNameRejections(field(handler, 'as'), `${pointer}/as`).concat(
    retryRejections(field(handler, 'retry'), `${pointer}/retry`, components),
  );
}

function retryRejections(retry: Json | undefined, pointer: string, components: Components): readonly Rejection[] {
  if (typeof retry === 'string') {
    return field(components.retries, retry) === undefined
      ? [rejection(pointer, `use.retries has no retry policy ${retry}`)]
      : [];
  }
  return isObject(retry) ? retryPolicyRejections(retry, pointer) : [];
}

function forkRejections(task: JsonObject, reference: string): readonly Rejection[] {
  const branches = field(objectField(task, 'fork') ?? {}, 'branches');
  return isList(branches) && branches.length > mostForkBranches
    ? [
        forbidden(
          `${reference}/fork/branches`,
          `A fork may have at most ${mostForkBranches} branches, not ${branches.length}`,
        ),
      ]
    : [];
}
