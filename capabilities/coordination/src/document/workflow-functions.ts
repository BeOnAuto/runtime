import {
  definitionResourceLabel,
  emittedEventsOf,
  isReservedSource,
  type CalledDefinition,
  type PlaybookOwnNames,
} from '@on.auto/definitions';
import { InvalidInputKindSchema, refusalInWords, type RejectedCall } from '@on.auto/operations';
import {
  allTaskEntries,
  type CallFunctions,
  enclosedBody,
  field,
  isObject,
  type Json,
  type JsonObject,
  pointerTo,
  policyOf,
  type Rejection,
  rejection,
  textField,
} from '@on.auto/workflow-engine';
import { Schema } from 'effect';

import { outputRefusalOf } from './workflow-output.ts';
import { scheduleRejections } from './workflow-schedule.ts';

export const runDefinitionFunction = 'run_definition';

const workflowType = 'workflow';

const runDefinitionArguments = new Set(['type', 'name', 'input']);

export interface RunDefinitionCall {
  readonly type: string;
  readonly name: string;
  readonly given: JsonObject;
}

function literalOf(value: Json | undefined): string | undefined {
  return typeof value === 'string' && enclosedBody(value) === undefined ? value : undefined;
}

export function definitionCallOf(task: JsonObject): RunDefinitionCall | undefined {
  const given = field(task, 'with');
  if (field(task, 'call') !== runDefinitionFunction || !isObject(given)) {
    return undefined;
  }
  const type = literalOf(field(given, 'type'));
  const name = literalOf(field(given, 'name'));
  return type === undefined || name === undefined ? undefined : { type, name, given };
}

export function definitionsCalledIn(document: JsonObject): readonly CalledDefinition[] {
  const calls: readonly CalledDefinition[] = allTaskEntries(field(document, 'do'), '/do').flatMap(({ task }) => {
    const call = definitionCallOf(task);
    return call === undefined ? [] : [{ type: call.type, name: call.name }];
  });
  return calls.filter(
    ({ type, name }, index) => calls.findIndex((call) => call.type === type && call.name === name) === index,
  );
}

function runDefinitionRejections(arguments_: Json | undefined, pointer: string): readonly Rejection[] {
  if (!isObject(arguments_)) {
    return [rejection(pointer, `${runDefinitionFunction} takes with: { type, name, input }`)];
  }
  const unknown = Object.keys(arguments_)
    .filter((key) => !runDefinitionArguments.has(key))
    .map((key) => rejection(pointerTo(pointer, key), `${runDefinitionFunction} takes no argument ${key}`));
  const missing = ['type', 'name']
    .filter((key) => typeof field(arguments_, key) !== 'string')
    .map((key) => rejection(pointerTo(pointer, key), `${runDefinitionFunction} needs a string ${key}`));
  return unknown.concat(missing);
}

function definitionDescribed(name: string, arguments_: Json): string {
  const type = isObject(arguments_) ? textField(arguments_, 'type') : undefined;
  const definition = isObject(arguments_) ? textField(arguments_, 'name') : undefined;
  return type === undefined || definition === undefined ? name : `the ${definitionResourceLabel(type)} ${definition}`;
}

const refusedByItsSteps: ReadonlySet<string> = new Set(['invalid_input', 'unavailable', 'conflict', 'unanswered']);

const refusedTheInputItWasGiven = Schema.is(InvalidInputKindSchema);

function refusalOfACall(_name: string, arguments_: Json, { reason, kind }: RejectedCall): string {
  const type = isObject(arguments_) ? textField(arguments_, 'type') : undefined;
  const stoppedAtAStep = type === workflowType && refusedByItsSteps.has(reason) && !refusedTheInputItWasGiven(kind);
  return stoppedAtAStep ? 'stopped' : refusalInWords(reason);
}

function emitRejectionsOf({ types }: PlaybookOwnNames) {
  return (attributes: JsonObject, pointer: string): readonly Rejection[] => {
    const type = field(attributes, 'type');
    const source = field(attributes, 'source');
    const reservedType =
      typeof type === 'string' && types.has(type)
        ? [
            rejection(
              `${pointer}/type`,
              `The type ${type} is one the playbook records itself; give the event a type of your own`,
            ),
          ]
        : [];
    const reservedSource =
      typeof source === 'string' && isReservedSource(source)
        ? [
            rejection(
              `${pointer}/source`,
              `The source ${source} is one the playbook records itself; give the event a source of your own`,
            ),
          ]
        : [];
    return reservedType.concat(reservedSource);
  };
}

function emitRefusalOf(names: PlaybookOwnNames) {
  const { refusalOf } = emittedEventsOf(names);
  return (event: JsonObject): string | undefined => {
    const refusal = refusalOf(event);
    return refusal === undefined ? undefined : `The event to emit is not one the playbook takes: ${refusal}`;
  };
}

export function workflowFunctionsOf(names: PlaybookOwnNames): CallFunctions {
  return {
    argumentChecks: { [runDefinitionFunction]: runDefinitionRejections },
    describe: definitionDescribed,
    refusal: refusalOfACall,
    emitRejections: emitRejectionsOf(names),
    emitRefusal: emitRefusalOf(names),
    outputRefusal: outputRefusalOf,
    scheduleRejections,
    howAWorkflowReachesTheWorld: 'a workflow reaches the world only through its playbook functions',
    howAWorkflowStarts: 'run the workflow with run_definition',
  };
}

export type WorkflowPolicy = ReturnType<typeof policyOf>;

export function workflowPolicyOf(names: PlaybookOwnNames): WorkflowPolicy {
  return policyOf(workflowFunctionsOf(names));
}
