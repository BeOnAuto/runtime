import { describe, expect, it } from 'vitest';

import { callerTheInstructionsHold } from '../bounds/served-bounds.ts';
import {
  definitionTypes,
  everyEndpoint,
  functionTypesSentence,
  ownOrg,
  playbookEndpoint,
  withConnections,
} from '../testing/served-instructions.ts';
import { instructionsActingAs, instructionsFor, type DefinitionType } from './instructions.ts';

const sevenFunctionTypesSentence =
  'Its function types: reasoning prompts a model, lookup obtains information, interaction exchanges information, prediction forecasts from history, computation runs a program, memory remembers and recalls, and generation produces assets.';

const whatALookupLeavesToReasoning = 'A lookup function fetches what a reasoning function interprets.';

const rememberingWhatThePersonWantsKept = 'Remember what the person wants kept in a memory function, not your notes.';

const sevenServedTypes: readonly DefinitionType[] = [
  ...definitionTypes.filter(({ type }) => type !== 'workflow'),
  { type: 'memory', noun: 'memory function', guide: 'memory-function' },
  { type: 'generation', noun: 'generation function', guide: 'generation-function' },
  { type: 'workflow', noun: 'workflow', guide: 'workflow' },
];

describe('the instructions of a server that runs seven function types', () => {
  it.each(everyEndpoint)(
    'stay within 2,000 characters on the %s endpoint, opening line included, for a server that runs seven function types, lookup, memory and generation functions among them',
    (endpoint, served) => {
      expect(
        instructionsActingAs(callerTheInstructionsHold, endpoint, served, sevenServedTypes).length,
      ).toBeLessThanOrEqual(2000);
    },
  );
});

describe('what the instructions say of the function types', () => {
  it('name every function type the server runs in one sentence, in the order of the terminology, each with what it is for', () => {
    expect(
      everyEndpoint.filter(
        ([endpoint, served]) =>
          !instructionsFor(endpoint, served, definitionTypes).includes(
            `runs belong to the playbook. ${functionTypesSentence} `,
          ),
      ),
    ).toEqual([]);
  });

  it('name a function type the terminology does not yet order after those it does, in the order the server runs them', () => {
    expect(instructionsFor('playbook', playbookEndpoint, sevenServedTypes)).toContain(
      `runs belong to the playbook. ${sevenFunctionTypesSentence} ${whatALookupLeavesToReasoning} ${rememberingWhatThePersonWantsKept} A workflow waits`,
    );
  });

  it('say, where the server runs lookup functions, right after the function types, that a lookup function fetches what a reasoning function interprets', () => {
    expect(
      everyEndpoint.filter(
        ([endpoint, served]) =>
          !instructionsFor(endpoint, served, definitionTypes).includes(
            `${functionTypesSentence} ${whatALookupLeavesToReasoning}`,
          ),
      ),
    ).toEqual([]);
  });

  it('say, where the server runs memory functions, that the agent remembers what the person wants kept in one', () => {
    expect(instructionsFor('own org', withConnections(ownOrg), sevenServedTypes)).toContain(
      rememberingWhatThePersonWantsKept,
    );
  });

  it('say nothing of lookup or memory functions where the server runs neither', () => {
    const neither = definitionTypes.filter(({ type }) => type !== 'lookup');

    expect(
      everyEndpoint.filter(([endpoint, served]) => /lookup|memory/u.test(instructionsFor(endpoint, served, neither))),
    ).toEqual([]);
  });
});

describe('what the instructions say of a prediction function', () => {
  it("say, where the server runs one, that it forecasts from the playbook's history", () => {
    const predicting = definitionTypes.filter(({ type }) => type === 'prediction');

    expect(instructionsFor('playbook', playbookEndpoint, predicting)).toContain(
      'and workflows; runs belong to the playbook. Its function types: prediction forecasts from history. This connection acts inside one playbook.',
    );
    expect(instructionsFor('playbook', playbookEndpoint, definitionTypes.slice(0, 1)).includes('prediction')).toBe(
      false,
    );
  });
});
