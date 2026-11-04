export type FunctionType =
  | 'reasoning'
  | 'lookup'
  | 'memory'
  | 'interaction'
  | 'prediction'
  | 'computation'
  | 'generation';

export const functionCategoryLabels = {
  reasoning: 'Reasoning',
  lookup: 'Lookup',
  memory: 'Memory',
  interaction: 'Interaction',
  prediction: 'Prediction',
  computation: 'Computation',
  generation: 'Generation',
} satisfies Record<FunctionType, string>;

export const functionResourceLabels = {
  reasoning: { singular: 'reasoning function', plural: 'reasoning functions' },
  lookup: { singular: 'lookup function', plural: 'lookup functions' },
  memory: { singular: 'memory function', plural: 'memory functions' },
  interaction: { singular: 'interaction function', plural: 'interaction functions' },
  prediction: { singular: 'prediction function', plural: 'prediction functions' },
  computation: { singular: 'computation function', plural: 'computation functions' },
  generation: { singular: 'generation function', plural: 'generation functions' },
} satisfies Record<FunctionType, { readonly singular: string; readonly plural: string }>;

export const functionDescriptions = {
  reasoning: 'Use a prompt, skills, and tools to interpret information or produce a response.',
  lookup: "Obtain information that already exists, through one tool that only reads or from the playbook's own runs.",
  memory: 'Remember what the playbook learns, and recall it later.',
  interaction: 'Exchange information with people or systems.',
  prediction: "Predict a quantity from the playbook's own history, with a likely range.",
  computation: 'Run defined code or expressions to calculate or transform data.',
  generation: 'Produce an asset, such as an image or audio, from a prompt.',
} satisfies Record<FunctionType, string>;

export const functionTypeOrder: readonly FunctionType[] = [
  'reasoning',
  'lookup',
  'memory',
  'interaction',
  'prediction',
  'computation',
  'generation',
];

export const definitionTypeOrder: readonly string[] = [...functionTypeOrder, 'workflow'];

const resourceLabels: ReadonlyMap<string, string> = new Map([
  ...functionTypeOrder.map((type): [string, string] => [type, functionResourceLabels[type].singular]),
  ['workflow', 'workflow'],
]);

export function definitionResourceLabel(type: string): string {
  return resourceLabels.get(type) ?? `${type} definition`;
}
