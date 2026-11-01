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
  'Its function types: reasoning prompts a model, interaction exchanges information, prediction forecasts from history, computation runs a program, lookup obtains information, memory remembers and recalls, and generation produces assets.';

const whatThePersonWantsKept =
  'What the person wants kept goes in a recall function for anyone or a workflow to ask later, not your notes.';

const whatALookupLeavesToReasoning =
  'A lookup function fetches and a reasoning function interprets, never fetching its own input.';

const rememberingWhatThePersonWantsKept = 'Remember what the person wants kept in a memory function, not your notes.';

const sevenServedTypes: readonly DefinitionType[] = [
  ...definitionTypes.filter(({ type }) => type !== 'recall' && type !== 'workflow'),
  { type: 'lookup', noun: 'lookup function', guide: 'lookup-function' },
  { type: 'memory', noun: 'memory function', guide: 'memory-function' },
  { type: 'generation', noun: 'generation function', guide: 'generation-function' },
  { type: 'workflow', noun: 'workflow', guide: 'workflow' },
];

describe('the instructions of a server that runs seven function types', () => {
  it.each(everyEndpoint)(
    'stay within 2,000 characters on the %s endpoint, opening line included, for a server that runs seven function types, lookup, memory and generation functions among them and no recall function',
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

  it('say, where the server runs lookup functions, that a lookup fetches and a reasoning function interprets without fetching', () => {
    expect(
      everyEndpoint.filter(
        ([endpoint, served]) =>
          !instructionsFor(endpoint, served, sevenServedTypes).includes(whatALookupLeavesToReasoning),
      ),
    ).toEqual([]);
  });

  it('say, where the server runs memory functions, that the agent remembers what the person wants kept in one, and not that it goes in a recall function', () => {
    const served = instructionsFor('own org', withConnections(ownOrg), sevenServedTypes);

    expect(served).toContain(rememberingWhatThePersonWantsKept);
    expect(served).not.toContain(whatThePersonWantsKept);
  });

  it('say nothing of lookup or memory functions where the server runs neither', () => {
    expect(
      everyEndpoint.filter(([endpoint, served]) =>
        /lookup|memory/u.test(instructionsFor(endpoint, served, definitionTypes)),
      ),
    ).toEqual([]);
  });
});

describe('what the instructions say of what the person wants kept', () => {
  it("say on every endpoint, after the function types, that it goes in a recall function and not in the agent's own notes", () => {
    expect(
      everyEndpoint.filter(
        ([endpoint, served]) =>
          !instructionsFor(endpoint, served, definitionTypes).includes(
            `${functionTypesSentence} ${whatThePersonWantsKept}`,
          ),
      ),
    ).toEqual([]);
  });

  it('say nothing of it where the server runs no recall function to keep it in', () => {
    const withoutRecall = definitionTypes.filter(({ type }) => type !== 'recall');

    expect(
      everyEndpoint.filter(([endpoint, served]) =>
        instructionsFor(endpoint, served, withoutRecall).includes('wants kept'),
      ),
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
