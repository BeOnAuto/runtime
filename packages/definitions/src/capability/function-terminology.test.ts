import { describe, expect, it } from 'vitest';

import {
  definitionResourceLabel,
  definitionTypeOrder,
  functionCategoryLabels,
  functionDescriptions,
  functionTypeOrder,
  functionResourceLabels,
  inDefinitionTypeOrder,
} from '../index.ts';

describe('playbook function terminology', () => {
  it('keeps the six function types in product order, without coordination or Dream', () => {
    expect(functionTypeOrder).toEqual([
      'reasoning',
      'lookup',
      'interaction',
      'prediction',
      'computation',
      'generation',
    ]);
    expect(functionTypeOrder.map((type) => functionCategoryLabels[type])).toEqual([
      'Reasoning',
      'Lookup',
      'Interaction',
      'Prediction',
      'Computation',
      'Generation',
    ]);
    expect(Object.keys(functionCategoryLabels)).toEqual(functionTypeOrder);
    expect(Object.keys(functionResourceLabels)).toEqual(functionTypeOrder);
    expect(Object.keys(functionDescriptions)).toEqual(functionTypeOrder);
    expect(definitionTypeOrder).toEqual([...functionTypeOrder, 'workflow']);
  });

  it('uses countable resource names and describes each declared responsibility', () => {
    expect(functionTypeOrder.map((type) => functionResourceLabels[type])).toEqual([
      { singular: 'reasoning function', plural: 'reasoning functions' },
      { singular: 'lookup function', plural: 'lookup functions' },
      { singular: 'interaction function', plural: 'interaction functions' },
      { singular: 'prediction function', plural: 'prediction functions' },
      { singular: 'computation function', plural: 'computation functions' },
      { singular: 'generation function', plural: 'generation functions' },
    ]);
    expect(functionTypeOrder.map((type) => functionDescriptions[type])).toEqual([
      'Use a prompt and tools to interpret information or produce a response.',
      "Obtain information that already exists, through one tool that only reads or from the playbook's own runs.",
      'Exchange information with people or systems.',
      "Predict a quantity from the playbook's own history, with a likely range.",
      'Run defined code or expressions to calculate or transform data.',
      'Produce an asset, such as an image or audio, from a prompt.',
    ]);
  });
});

describe('the resource label of a definition', () => {
  it('labels known resources without reclassifying custom runtime adapters as functions', () => {
    expect(definitionResourceLabel('reasoning')).toBe('reasoning function');
    expect(definitionResourceLabel('lookup')).toBe('lookup function');
    expect(definitionResourceLabel('interaction')).toBe('interaction function');
    expect(definitionResourceLabel('computation')).toBe('computation function');
    expect(definitionResourceLabel('prediction')).toBe('prediction function');
    expect(definitionResourceLabel('generation')).toBe('generation function');
    expect(definitionResourceLabel('workflow')).toBe('workflow');
    expect(definitionResourceLabel('echo')).toBe('echo definition');
    expect(definitionResourceLabel('agent')).toBe('agent definition');
  });
});

describe('the order of the types of definition', () => {
  it('puts the function types in product order, then workflows, then any other type in the order it is given', () => {
    const given: readonly Readonly<{ type: string }>[] = [
      'echo',
      'workflow',
      'generation',
      'computation',
      'prediction',
      'agent',
      'lookup',
      'reasoning',
    ].map((type) => ({ type }));

    expect(inDefinitionTypeOrder(given).map(({ type }) => type)).toEqual([
      'reasoning',
      'lookup',
      'prediction',
      'computation',
      'generation',
      'workflow',
      'echo',
      'agent',
    ]);
  });
});
