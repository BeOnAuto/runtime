import { namesOf, type CallFunctions } from './call-functions.ts';
import {
  entriesOf,
  field,
  isObject,
  objectField,
  textField,
  type Json,
  type JsonEntry,
  type JsonObject,
} from './json.ts';
import { nestingRejections } from './nesting.ts';
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
import { commonRejections, ownRejections } from './task-policy.ts';
import { referenceRejections } from './task-references.ts';
import { kindOf, pointerTo, taskEntries, type TaskEntry } from './tasks.ts';

type Policy = (document: JsonObject) => readonly Rejection[];

function rejectedComponents(functions: CallFunctions): Readonly<Record<string, string>> {
  return {
    authentications: 'authentications are not supported in this version: a workflow reaches nothing that needs them',
    secrets: 'secrets are not supported in this version: a workflow reaches nothing that needs them',
    catalogs: `catalogs are not supported in this version: a workflow calls only ${namesOf(functions)}`,
    extensions: 'extensions are not supported in this version',
    functions: `reusable functions are not supported in this version: call ${namesOf(functions)} directly`,
  };
}

const flowDirectives = new Set(['continue', 'exit', 'end']);

export const oneLanguage = "The playbook's one language is TypeScript; write the program as a TypeScript function";

const strictMode = 'An expression that fails must fail, so evaluate.mode is strict, the default';

export function policyOf(functions: CallFunctions): Policy {
  return (document) => {
    const nesting = nestingRejections(document);
    return nesting.length > 0 ? nesting : walkedRejectionsOf(document, functions);
  };
}

function walkedRejectionsOf(document: JsonObject, functions: CallFunctions): readonly Rejection[] {
  const use = objectField(document, 'use') ?? {};
  const components = {
    errors: objectField(use, 'errors') ?? {},
    retries: objectField(use, 'retries') ?? {},
    timeouts: objectField(use, 'timeouts') ?? {},
  };
  const schedule = scheduleRejectionsOf(field(document, 'schedule'), functions);
  return versionRejections(document).concat(
    evaluateRejections(objectField(document, 'evaluate')),
    componentRejections(use, components, functions),
    schedule,
    workflowDataRejections(document),
    timeoutRejections(field(document, 'timeout'), '/timeout', components),
    taskListRejections(field(document, 'do'), '/do', components, functions),
  );
}

function scheduleRejectionsOf(schedule: Json | undefined, functions: CallFunctions): readonly Rejection[] {
  if (schedule === undefined) {
    return [];
  }
  return functions.scheduleRejections === undefined
    ? [forbidden('/schedule', `schedules are not supported in this version: ${functions.howAWorkflowStarts}`)]
    : functions.scheduleRejections(schedule, '/schedule');
}

function versionRejections(document: JsonObject): readonly Rejection[] {
  const dsl = textField(objectField(document, 'document') ?? {}, 'dsl');
  return dsl !== undefined && /^1\.0\.\d+$/u.test(dsl)
    ? []
    : [forbidden('/document/dsl', `This runtime runs documents of DSL 1.0.x, not ${dsl ?? 'an unnamed version'}`)];
}

function evaluateRejections(evaluate: JsonObject | undefined): readonly Rejection[] {
  const language = field(evaluate ?? {}, 'language');
  const mode = field(evaluate ?? {}, 'mode');
  return [
    ...(language === undefined || language === 'typescript' ? [] : [forbidden('/evaluate/language', oneLanguage)]),
    ...(mode === undefined || mode === 'strict' ? [] : [forbidden('/evaluate/mode', strictMode)]),
  ];
}

function componentRejections(use: JsonObject, components: Components, functions: CallFunctions): readonly Rejection[] {
  const rejected = Object.entries(rejectedComponents(functions))
    .filter(([name]: readonly [string, string]) => field(use, name) !== undefined)
    .map(([name, detail]: readonly [string, string]) => forbidden(`/use/${name}`, detail));
  const retries = entriesOf(components.retries).flatMap(([name, policy]: JsonEntry) =>
    isObject(policy) ? retryPolicyRejections(policy, pointerTo('/use/retries', name)) : [],
  );
  const timeouts = entriesOf(components.timeouts).flatMap(([name, timeout]: JsonEntry) =>
    isObject(timeout) ? durationRejections(field(timeout, 'after'), `${pointerTo('/use/timeouts', name)}/after`) : [],
  );
  return rejected.concat(retries, timeouts);
}

function workflowDataRejections(document: JsonObject): readonly Rejection[] {
  const input = objectField(document, 'input') ?? {};
  const output = objectField(document, 'output') ?? {};
  return schemaRejections(objectField(input, 'schema'), '/input/schema').concat(
    schemaRejections(objectField(output, 'schema'), '/output/schema'),
  );
}

function schemaRejections(schema: JsonObject | undefined, pointer: string): readonly Rejection[] {
  if (schema === undefined) {
    return [];
  }
  if (field(schema, 'resource') !== undefined) {
    return [forbidden(`${pointer}/resource`, 'External schemas are not fetched: write the schema inline as document')];
  }
  const format = textField(schema, 'format') ?? 'json';
  return format === 'json' || format.startsWith('json:')
    ? []
    : [forbidden(`${pointer}/format`, `Schemas are JSON Schema in this version, not ${format}`)];
}

function taskListRejections(
  list: Json | undefined,
  pointer: string,
  components: Components,
  functions: CallFunctions,
): readonly Rejection[] {
  const entries = taskEntries(list, pointer);
  const names = new Set(entries.map(({ name }) => name));
  return entries.flatMap((entry) =>
    taskRejections(entry, components, functions).concat(
      jumpRejections(field(entry.task, 'then'), `${entry.reference}/then`, names),
    ),
  );
}

function taskRejections(entry: TaskEntry, components: Components, functions: CallFunctions): readonly Rejection[] {
  return referenceRejections(entry).concat(
    ownRejections(entry, components, functions),
    commonRejections(entry, components),
    nestedRejections(entry, components, functions),
  );
}

function jumpRejections(then: Json | undefined, pointer: string, siblings: ReadonlySet<string>): readonly Rejection[] {
  return typeof then !== 'string' || flowDirectives.has(then) || siblings.has(then)
    ? []
    : [rejection(pointer, `then: ${then} names no task in the same list`)];
}

function nestedRejections(
  { task, reference }: TaskEntry,
  components: Components,
  functions: CallFunctions,
): readonly Rejection[] {
  const kind = kindOf(task);
  if (kind === 'fork') {
    const branches = field(objectField(task, 'fork') ?? {}, 'branches');
    const pointer = `${reference}/fork/branches`;
    return taskEntries(branches, pointer).flatMap((branch) =>
      taskRejections(branch, components, functions).concat(
        branchJumpRejections(field(branch.task, 'then'), `${branch.reference}/then`),
      ),
    );
  }
  const lists: readonly Located[] = [
    [kind === 'do' || kind === 'for' ? field(task, 'do') : undefined, `${reference}/do`],
    [kind === 'try' ? field(task, 'try') : undefined, `${reference}/try`],
    [kind === 'try' ? field(objectField(task, 'catch') ?? {}, 'do') : undefined, `${reference}/catch/do`],
  ];
  return lists.flatMap(([list, pointer]: Located) => taskListRejections(list, pointer, components, functions));
}

function branchJumpRejections(then: Json | undefined, pointer: string): readonly Rejection[] {
  return typeof then === 'string' && !flowDirectives.has(then)
    ? [rejection(pointer, 'A branch of a fork cannot jump to another task')]
    : [];
}
