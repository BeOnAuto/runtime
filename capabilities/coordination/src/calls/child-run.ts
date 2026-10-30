import { nestedRunId } from '@on.auto/definitions';
import { textField, type ChildCall } from '@on.auto/workflow-engine';

import { isArgumentsProblem, definitionArgumentsOf } from '../document/definition-arguments.ts';
import { runDefinitionFunction } from '../document/workflow-functions.ts';

export function childRunOf({
  function: name,
  reference,
  run,
  arguments: given,
  attributes,
}: ChildCall): string | undefined {
  const workflow = textField(attributes, 'run_id');
  if (name !== runDefinitionFunction || workflow === undefined || isArgumentsProblem(definitionArgumentsOf(given))) {
    return undefined;
  }
  return nestedRunId(workflow, reference, run);
}
