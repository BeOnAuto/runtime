import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  isPlaybookFunctionDefinition,
  isWorkflowDefinition,
  type PlaybookFunctionDefinition,
  type Definition,
  type WorkflowDefinition,
} from '../index.ts';

const reasoningFunction: Definition = {
  type: 'reasoning',
  name: 'review-campaign',
  version: 3,
  status: 'active',
  media_type: 'text/markdown',
  source: 'Review the brief against the criteria.',
  overview: 'Reviews each campaign against its criteria before it goes out.',
  created_at: '2026-09-01T00:00:00.000Z',
  created_by: { id: 'author', name: 'author' },
  updated_at: '2026-09-02T00:00:00.000Z',
};

const interactionFunction: Definition = { ...reasoningFunction, type: 'interaction', source: 'Approve?' };

const predictionFunction: Definition = { ...reasoningFunction, type: 'prediction', source: 'Fit the weekly orders.' };

const computationFunction: Definition = { ...reasoningFunction, type: 'computation', source: '.a + 1' };

const recallFunction: Definition = { ...reasoningFunction, type: 'recall', source: '. + 1' };

const workflow: Definition = { ...reasoningFunction, type: 'workflow', media_type: 'application/yaml' };

describe('a saved definition', () => {
  it('is a playbook function when it is a reasoning, an interaction, a prediction, a recall or a computation function, and a workflow when it is a workflow', () => {
    const definitions = [
      reasoningFunction,
      interactionFunction,
      predictionFunction,
      recallFunction,
      computationFunction,
      workflow,
    ];

    const functions = definitions.filter((definition) => isPlaybookFunctionDefinition(definition));
    const workflows = definitions.filter((definition) => isWorkflowDefinition(definition));

    expectTypeOf(functions).toEqualTypeOf<PlaybookFunctionDefinition[]>();
    expectTypeOf(workflows).toEqualTypeOf<WorkflowDefinition[]>();
    expect([functions, workflows]).toEqual([
      [reasoningFunction, interactionFunction, predictionFunction, recallFunction, computationFunction],
      [workflow],
    ]);
  });

  it.each(['echo', 'reason', 'interact', 'predict', 'compute'])(
    'is neither of a custom adapter or a name that is not a function type: %s',
    (type) => {
      const definition = { ...reasoningFunction, type };

      expect([isPlaybookFunctionDefinition(definition), isWorkflowDefinition(definition)]).toEqual([false, false]);
    },
  );
});
