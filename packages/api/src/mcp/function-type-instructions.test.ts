import { describe, expect, it } from 'vitest';

import { callerTheInstructionsHold } from '../bounds/served-bounds.ts';
import {
  definitionTypes,
  everyEndpoint,
  functionTypesSentence,
  ownOrg,
  playbookEndpoint,
  recipes,
  withConnections,
} from '../testing/served-instructions.ts';
import { instructionsActingAs, instructionsFor, type DefinitionType } from './instructions.ts';

const sevenFunctionTypesSentence =
  'Its function types: reasoning prompts a model, lookup obtains information, memory remembers and recalls, interaction exchanges information, prediction forecasts from history, computation runs a program, and generation produces assets.';

const whatALookupLeavesToReasoning = 'A lookup function fetches what a reasoning function interprets.';

const whatAMemoryFunctionKeeps = 'A memory function keeps what the playbook recalls later.';

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
        instructionsActingAs(callerTheInstructionsHold, endpoint, served, {
          definitionTypes: sevenServedTypes,
          pages: false,
        }).length,
      ).toBeLessThanOrEqual(2000);
    },
  );
});

describe('the instructions of a server that runs seven function types, keeps pages and carries the recipes', () => {
  it('take 1,611 characters on the org endpoint, 1,249 on the playbook endpoint and 1,716 on /mcp, where the connection can follow first-playbook, with the opening line of the person the bound holds, within 2,000', () => {
    const opened = everyEndpoint.map(
      ([endpoint, served]) =>
        instructionsActingAs(callerTheInstructionsHold, endpoint, served, {
          definitionTypes: sevenServedTypes,
          pages: true,
          recipes,
        }).length,
    );

    expect(opened).toEqual([1611, 1249, 1716]);
    expect(opened.filter((length) => length > 2000)).toEqual([]);
  });
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
      `runs belong to the playbook. ${sevenFunctionTypesSentence} ${whatALookupLeavesToReasoning} ${whatAMemoryFunctionKeeps} A workflow waits`,
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

  it('say, where the server runs memory functions, that a memory function keeps what the playbook recalls later', () => {
    expect(instructionsFor('own org', withConnections(ownOrg), sevenServedTypes)).toContain(whatAMemoryFunctionKeeps);
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
