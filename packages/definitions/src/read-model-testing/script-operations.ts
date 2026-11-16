import { savedGoals, savedPage, savePlaybook } from '../exporting/playbook-saving.ts';
import { experiments } from '../goals/goal-examples.ts';
import type { Capability } from '../index.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';

export const weeklyContributes = [
  {
    goal: experiments.id,
    purpose: 'Measures what each experiment brought in.',
    per_id: '/id',
    marks: 'measured',
    measures: '/customers',
    final: '/closed',
  },
];

export const playbookWithGoals = { page: savedPage, goals: savedGoals };

export function scriptOperationsFor(workflow: Capability, goals: boolean) {
  return {
    savePlaybook,
    ...definitionOperationsFor([echo, workflow], undefined, undefined, { goals, messages: goals }),
  };
}
