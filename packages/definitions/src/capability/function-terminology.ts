export type FunctionType = 'reasoning' | 'lookup' | 'interaction' | 'prediction' | 'computation';

export const functionCategoryLabels = {
  reasoning: 'Reasoning',
  lookup: 'Lookup',
  interaction: 'Interaction',
  prediction: 'Prediction',
  computation: 'Computation',
} satisfies Record<FunctionType, string>;

export const functionResourceLabels = {
  reasoning: { singular: 'reasoning function', plural: 'reasoning functions' },
  lookup: { singular: 'lookup function', plural: 'lookup functions' },
  interaction: { singular: 'interaction function', plural: 'interaction functions' },
  prediction: { singular: 'prediction function', plural: 'prediction functions' },
  computation: { singular: 'computation function', plural: 'computation functions' },
} satisfies Record<FunctionType, { readonly singular: string; readonly plural: string }>;

export const functionDescriptions = {
  reasoning: 'Use a prompt, skills, and tools to interpret information or produce a response.',
  lookup: 'Obtain information that already exists outside the playbook, through one tool that only reads.',
  interaction: 'Exchange information with people or systems.',
  prediction: "Predict a quantity from the playbook's own history, with a likely range.",
  computation: 'Run defined code or expressions to calculate or transform data.',
} satisfies Record<FunctionType, string>;

export const functionTypeOrder: readonly FunctionType[] = [
  'reasoning',
  'lookup',
  'interaction',
  'prediction',
  'computation',
];

const resourceLabels: ReadonlyMap<string, string> = new Map([
  ...functionTypeOrder.map((type): [string, string] => [type, functionResourceLabels[type].singular]),
  ['workflow', 'workflow'],
  ['page', 'page'],
]);

export function definitionResourceLabel(type: string): string {
  return resourceLabels.get(type) ?? `${type} definition`;
}
