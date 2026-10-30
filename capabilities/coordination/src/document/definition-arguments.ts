import { type ErrorKind, field, isObject, type Json, jsonBytesOf, textField } from '@on.auto/workflow-engine';

import { runDefinitionFunction } from './workflow-functions.ts';

export interface DefinitionArguments {
  readonly type: string;
  readonly name: string;
  readonly input: Json;
}

export interface ArgumentsProblem {
  readonly kind: ErrorKind;
  readonly title: string;
}

const mostDefinitionInputBytes = 262_144;

export function definitionArgumentsOf(arguments_: Json): DefinitionArguments | ArgumentsProblem {
  if (!isObject(arguments_)) {
    return { kind: 'validation', title: `${runDefinitionFunction} takes with: { type, name, input }` };
  }
  const type = textField(arguments_, 'type');
  const name = textField(arguments_, 'name');
  if (type === undefined || name === undefined) {
    return { kind: 'validation', title: `${runDefinitionFunction} needs a string type and a string name` };
  }
  const input = field(arguments_, 'input') ?? {};
  const bytes = jsonBytesOf(input);
  return bytes > mostDefinitionInputBytes
    ? {
        kind: 'validation',
        title: `The input of ${runDefinitionFunction} takes ${bytes} bytes as JSON, more than the ${mostDefinitionInputBytes} a run takes`,
      }
    : { type, name, input };
}

export function isArgumentsProblem(value: DefinitionArguments | ArgumentsProblem): value is ArgumentsProblem {
  return 'title' in value;
}

export function failureChain(error: unknown): string {
  return error instanceof Error && error.cause !== undefined
    ? `${String(error)}: ${failureChain(error.cause)}`
    : String(error);
}
