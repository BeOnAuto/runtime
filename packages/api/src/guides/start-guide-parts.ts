import type { FunctionType } from '@on.auto/definitions';

export const whatEachPartDoes: Readonly<Record<string, string>> = {
  reasoning: 'it interprets, judges or writes',
  lookup: 'it reads what a connected service holds, or what earlier runs of the playbook produced',
  interaction: 'it asks a person and takes their answer, or has a service act',
  prediction: "it forecasts a quantity from the playbook's own history",
  computation: 'it calculates or transforms data exactly',
  generation: 'it makes an image or audio',
} satisfies Record<FunctionType, string>;
