import { describe, expect, it } from 'vitest';

import {
  definitionResourceLabel,
  functionCategoryLabels,
  functionDescriptions,
  functionTypeOrder,
  functionResourceLabels,
} from '../index.ts';

describe('playbook function terminology', () => {
  it('keeps the five function types in product order, without coordination or Dream', () => {
    expect(functionTypeOrder).toEqual(['reasoning', 'interaction', 'prediction', 'recall', 'computation']);
    expect(functionTypeOrder.map((type) => functionCategoryLabels[type])).toEqual([
      'Reasoning',
      'Interaction',
      'Prediction',
      'Recall',
      'Computation',
    ]);
    expect(Object.keys(functionCategoryLabels)).toEqual(functionTypeOrder);
    expect(Object.keys(functionResourceLabels)).toEqual(functionTypeOrder);
    expect(Object.keys(functionDescriptions)).toEqual(functionTypeOrder);
  });

  it('uses countable resource names and describes each declared responsibility', () => {
    expect(functionTypeOrder.map((type) => functionResourceLabels[type])).toEqual([
      { singular: 'reasoning function', plural: 'reasoning functions' },
      { singular: 'interaction function', plural: 'interaction functions' },
      { singular: 'prediction function', plural: 'prediction functions' },
      { singular: 'recall function', plural: 'recall functions' },
      { singular: 'computation function', plural: 'computation functions' },
    ]);
    expect(functionTypeOrder.map((type) => functionDescriptions[type])).toEqual([
      'Use a prompt, skills, and tools to interpret information or produce a response.',
      'Exchange information with people or systems.',
      "Predict a quantity from the playbook's own history, with a likely range.",
      'Answer from what the playbook keeps of its own history.',
      'Run defined code or expressions to calculate or transform data.',
    ]);
  });

  it('labels known resources without reclassifying custom runtime adapters as functions', () => {
    expect(definitionResourceLabel('reasoning')).toBe('reasoning function');
    expect(definitionResourceLabel('interaction')).toBe('interaction function');
    expect(definitionResourceLabel('computation')).toBe('computation function');
    expect(definitionResourceLabel('recall')).toBe('recall function');
    expect(definitionResourceLabel('prediction')).toBe('prediction function');
    expect(definitionResourceLabel('workflow')).toBe('workflow');
    expect(definitionResourceLabel('echo')).toBe('echo definition');
    expect(definitionResourceLabel('agent')).toBe('agent definition');
  });
});
