export type FunctionType = 'reasoning' | 'interaction' | 'prediction' | 'recall' | 'computation';

export const functionCategoryLabels = {
  reasoning: 'Reasoning',
  interaction: 'Interaction',
  prediction: 'Prediction',
  recall: 'Recall',
  computation: 'Computation',
} satisfies Record<FunctionType, string>;

export const functionResourceLabels = {
  reasoning: { singular: 'reasoning function', plural: 'reasoning functions' },
  interaction: { singular: 'interaction function', plural: 'interaction functions' },
  prediction: { singular: 'prediction function', plural: 'prediction functions' },
  recall: { singular: 'recall function', plural: 'recall functions' },
  computation: { singular: 'computation function', plural: 'computation functions' },
} satisfies Record<FunctionType, { readonly singular: string; readonly plural: string }>;

export const functionDescriptions = {
  reasoning: 'Use a prompt, skills, and tools to interpret information or produce a response.',
  interaction: 'Exchange information with people or systems.',
  prediction: "Predict a quantity from the playbook's own history with a model a trainer builds.",
  recall: 'Answer from what the playbook keeps of its own history.',
  computation: 'Run defined code or expressions to calculate or transform data.',
} satisfies Record<FunctionType, string>;

export const functionTypeOrder: readonly FunctionType[] = [
  'reasoning',
  'interaction',
  'prediction',
  'recall',
  'computation',
];

const resourceLabels: ReadonlyMap<string, string> = new Map([
  ...functionTypeOrder.map((type): [string, string] => [type, functionResourceLabels[type].singular]),
  ['workflow', 'workflow'],
]);

export function definitionResourceLabel(type: string): string {
  return resourceLabels.get(type) ?? `${type} definition`;
}
