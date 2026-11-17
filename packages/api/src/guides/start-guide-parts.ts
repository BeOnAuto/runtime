import type { FunctionType } from '@on.auto/definitions';

export const whatEachPartDoes: Readonly<Record<string, string>> = {
  reasoning: 'it interprets, judges or writes',
  lookup: 'it reads or searches what a connected service holds, or reads what earlier runs of the playbook produced',
  interaction: 'it asks a person and takes their answer, or has a service act',
  prediction: "it forecasts a quantity from the playbook's own history",
  computation: 'it calculates or transforms data exactly',
  generation: 'it makes an image, audio or a video',
} satisfies Record<FunctionType, string>;

export const theWorkflowFirst = [
  'Start from what the person wants the playbook to achieve, not from a function. Once they agree what it should achieve, design the workflow that achieves it:',
  '',
  '- what starts it, and what one run handles, such as an item, a case or a period',
  '- its steps in order, and what each hands the next',
  '- where it branches, loops or waits, and which decisions stay with a person',
  '- which result shows the person it worked',
  '',
  'In the design, give each step that does work the function type its work needs, by what the step does, not by how it is done:',
];

const exampleSteps: Readonly<Record<string, string>> = {
  lookup: 'read each new item (lookup)',
  reasoning: 'judge each item (reasoning)',
  computation: 'total the amounts (computation)',
  interaction: 'ask the owner to approve (interaction)',
  prediction: 'forecast next week (prediction)',
  generation: 'make the image (generation)',
} satisfies Record<FunctionType, string>;

export function theDesignShown(served: readonly string[]): string {
  const example = Object.keys(exampleSteps).find((type) => served.includes(type));
  return `Show the person that design in a message of its own, in their words: what starts it, and each step in order with its function type${example === undefined ? '' : `, such as "${String(exampleSteps[example])}"`}. Ask whether it is right, and write no function or workflow before their yes. A yes to what the playbook should achieve, or an answer about a service, a trigger or a model, is not a yes to its design.`;
}

export const theJobInParts =
  'Start from the job the person wants done again and again, not from a function. Break the job into its parts and give each part a function of the type its work needs, by what the part does, not by how it is done:';
