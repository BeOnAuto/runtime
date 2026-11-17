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
import { typeByEachPartsJob } from './function-terminology.ts';

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
      'Produce an asset, such as an image, audio or a video, from a prompt.',
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

function everySetOf(types: readonly string[]): readonly (readonly string[])[] {
  return types.reduce<readonly (readonly string[])[]>(
    (sets, type) => sets.concat(sets.map((set) => [...set, type])),
    [[]],
  );
}

describe('the words of the type a definition is created with', () => {
  it('say first that the workflow is the job, then by the job of a step that does work which function type takes it, one clause for each function type in the product order, in 299 characters', () => {
    const words = typeByEachPartsJob(definitionTypeOrder);

    expect(words).toBe(
      'workflow is the job; each working step, by its job: reasoning interprets, judges or writes; lookup reads a service or earlier runs; interaction asks a person or has a service act; prediction forecasts a quantity; computation calculates or transforms exactly; generation makes images, audio or video.',
    );
    expect(words?.length).toBe(299);
  });

  it("say by each part's job which function type takes it where the server runs no workflow, and that the workflow is the job where it runs workflows alone", () => {
    expect(typeByEachPartsJob(['reasoning', 'computation'])).toBe(
      "By each part's job: reasoning interprets, judges or writes; computation calculates or transforms exactly.",
    );
    expect(typeByEachPartsJob(['workflow'])).toBe('workflow is the job.');
  });

  it('take at most 300 characters, the bound of an argument, whichever types a server serves', () => {
    expect(everySetOf(definitionTypeOrder).filter((types) => String(typeByEachPartsJob(types)).length > 300)).toEqual(
      [],
    );
  });

  it('give every type its clause, so that no type arrives unnamed, and name no type a server does not serve', () => {
    expect(
      definitionTypeOrder.filter(
        (type) => !new RegExp(`(?:^|: )${type} `, 'u').test(String(typeByEachPartsJob([type]))),
      ),
    ).toEqual([]);
    expect(
      everySetOf(definitionTypeOrder).flatMap((types) =>
        definitionTypeOrder
          .filter((type) => !types.includes(type))
          .filter((type) => new RegExp(`\\b${type}\\b`, 'u').test(String(typeByEachPartsJob(types)))),
      ),
    ).toEqual([]);
  });

  it('are none for a server whose types are its own', () => {
    expect(typeByEachPartsJob(['echo', 'agent'])).toBeUndefined();
  });
});
