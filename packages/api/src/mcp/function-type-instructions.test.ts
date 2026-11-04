import { describe, expect, it } from 'vitest';

import { callerTheInstructionsHold } from '../bounds/served-bounds.ts';
import {
  definitionTypes,
  everyEndpoint,
  functionTypesSentence,
  playbookEndpoint,
  recipes,
} from '../testing/served-instructions.ts';
import { instructionsActingAs, instructionsFor, type DefinitionType } from './instructions.ts';

const sixFunctionTypesSentence =
  'Its function types: reasoning prompts a model, lookup obtains information, interaction exchanges information, prediction forecasts from history, computation runs a program, and generation produces assets.';

const whatALookupLeavesToReasoning = 'A lookup function fetches what a reasoning function interprets.';

const whereWhatIsKeptIsReadBack =
  "What the person wants kept is the output of a run, read back with a lookup of that definition's runs.";

const sixServedTypes: readonly DefinitionType[] = [
  ...definitionTypes.filter(({ type }) => type !== 'workflow'),
  { type: 'generation', noun: 'generation function', guide: 'generation-function' },
  { type: 'workflow', noun: 'workflow', guide: 'workflow' },
];

describe('the instructions of a server that runs six function types', () => {
  it.each(everyEndpoint)(
    'stay within 2,000 characters on the %s endpoint, opening line included, for a server that runs six function types, lookup and generation functions among them',
    (endpoint, served) => {
      expect(
        instructionsActingAs(callerTheInstructionsHold, endpoint, served, {
          definitionTypes: sixServedTypes,
          pages: false,
        }).length,
      ).toBeLessThanOrEqual(2000);
    },
  );
});

describe('the instructions of a server that runs six function types, keeps pages and carries the recipes', () => {
  it('take 1,850 characters on the org endpoint, 1,264 on the playbook endpoint and 1,997 on /mcp, where the connection can follow first-playbook and connect-a-service, with the opening line of the person the bound holds, within 2,000', () => {
    const opened = everyEndpoint.map(
      ([endpoint, served]) =>
        instructionsActingAs(callerTheInstructionsHold, endpoint, served, {
          definitionTypes: sixServedTypes,
          pages: true,
          recipes,
        }).length,
    );

    expect(opened).toEqual([1850, 1264, 1997]);
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

  it('name the six function types in the order of the terminology, whatever order the server runs them in', () => {
    expect(instructionsFor('playbook', playbookEndpoint, sixServedTypes)).toContain(
      `runs belong to the playbook. ${sixFunctionTypesSentence} ${whatALookupLeavesToReasoning} ${whereWhatIsKeptIsReadBack} A workflow waits`,
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

  it("say, where the server runs lookup functions, right after what a lookup fetches, that what the person wants kept is the output of a run, read back with a lookup of that definition's runs", () => {
    expect(
      everyEndpoint.filter(
        ([endpoint, served]) =>
          !instructionsFor(endpoint, served, definitionTypes).includes(
            `${whatALookupLeavesToReasoning} ${whereWhatIsKeptIsReadBack}`,
          ),
      ),
    ).toEqual([]);
  });

  it('say nothing of lookup functions, nor of what is kept, where the server runs none', () => {
    const withoutLookup = definitionTypes.filter(({ type }) => type !== 'lookup');

    expect(
      everyEndpoint.filter(([endpoint, served]) =>
        /lookup|kept/u.test(instructionsFor(endpoint, served, withoutLookup)),
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
