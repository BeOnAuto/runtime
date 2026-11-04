import { readFileSync } from 'node:fs';

import { internalTermsIn } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

import { callerTheInstructionsHold } from '../bounds/served-bounds.ts';
import {
  buildBot,
  localDeveloper,
  playbookEndpoint,
  signedInAda,
  definitionTypes,
  everyEndpoint,
  functionTypesSentence,
  orgEndpoint,
  ownOrg,
  queriesInsideAPlaybook,
  withConnections,
} from '../testing/served-instructions.ts';
import { instructionsActingAs, instructionsFor, type ServedTools } from './instructions.ts';

const servedOnMcp =
  "A playbook holds work that keeps running after a conversation, in any line of business. Auto Runtime makes and runs playbooks; Studio manages them; your agent is a separate client. A playbook contains one brain (its reusable functions) and workflows; runs belong to the playbook. Its function types: reasoning prompts a model, lookup obtains information, interaction exchanges information, prediction forecasts from history, and computation runs a program. A lookup function fetches what a reasoning function interprets. What the person wants kept is the output of a run, read back with a lookup of that definition's runs. A workflow waits for input and can start on a schedule or event. A workflow's steps use the playbook's functions, and run_definition runs it. The org is the caller's own: list_playbooks shows its playbooks and create_playbook makes one. get_guide holds each definition's format; a definition takes an overview. search finds the provider of a service by its words, and add_connection connects it to the org's playbooks; the person approves on the page it links. Where no provider or server matches, add_connection can still take the service's own MCP server or HTTP API, given by hand; a service with neither cannot be connected. A playbook's runs expect what they act on at a service, such as statuses or channels, to be there already: set it up with the person before the first run, and ask for the access that setup takes when you add the connection. answer_interaction answers what a run waits on. A tool that cannot do what was asked says why and what to change.";

const servedOnAnOrg =
  "A playbook holds work that keeps running after a conversation, in any line of business. Auto Runtime makes and runs playbooks; Studio manages them; your agent is a separate client. A playbook contains one brain (its reusable functions) and workflows; runs belong to the playbook. Its function types: reasoning prompts a model, lookup obtains information, interaction exchanges information, prediction forecasts from history, and computation runs a program. A lookup function fetches what a reasoning function interprets. What the person wants kept is the output of a run, read back with a lookup of that definition's runs. A workflow waits for input and can start on a schedule or event. A workflow's steps use the playbook's functions. This connection manages the org's playbooks: list_playbooks shows them and create_playbook makes one; each playbook's definitions are made on /orgs/{org}/playbooks/{playbook}/mcp. get_guide explains these words and the format of each definition. search finds the provider of a service by its words, and add_connection connects it to the org's playbooks; the person approves on the page it links. Where no provider or server matches, add_connection can still take the service's own MCP server or HTTP API, given by hand; a service with neither cannot be connected. A playbook's runs expect what they act on at a service, such as statuses or channels, to be there already: set it up with the person before the first run, and ask for the access that setup takes when you add the connection. A tool that cannot do what was asked says why and what to change.";

const servedOnAPlaybook =
  "A playbook holds work that keeps running after a conversation, in any line of business. Auto Runtime makes and runs playbooks; Studio manages them; your agent is a separate client. A playbook contains one brain (its reusable functions) and workflows; runs belong to the playbook. Its function types: reasoning prompts a model, lookup obtains information, interaction exchanges information, prediction forecasts from history, and computation runs a program. A lookup function fetches what a reasoning function interprets. What the person wants kept is the output of a run, read back with a lookup of that definition's runs. A workflow waits for input and can start on a schedule or event. A workflow's steps use the playbook's functions, and run_definition runs it. This connection acts inside one playbook. get_guide holds each definition's format; a definition takes an overview. answer_interaction answers what a run waits on. A tool that cannot do what was asked says why and what to change.";

const threeFunctionTypesSentence =
  'Its function types: reasoning prompts a model, lookup obtains information, and computation runs a program.';

const answeringSentence = 'answer_interaction answers what a run waits on.';

const whatAPlaybookHolds = 'A playbook holds work that keeps running after a conversation, in any line of business.';

function asServedWithThreeTypes(servedText: string): string {
  return servedText.replace(functionTypesSentence, threeFunctionTypesSentence).replace(` ${answeringSentence}`, '');
}

const typesAfterTheFirstThree: ReadonlySet<string> = new Set(['interaction', 'prediction']);

function withoutInteraction({ orgTools, playbookTools }: ServedTools): ServedTools {
  return {
    orgTools,
    playbookTools: playbookTools.filter((name) => !name.endsWith('_interaction') && !name.endsWith('_interactions')),
  };
}

const terminology = readFileSync(new URL('../../../../docs/concepts/terminology.md', import.meta.url), 'utf8');

const resourcesOnTheTerminologyPage: ReadonlySet<string> = new Set(
  [...terminology.matchAll(/^\| \w+ +\| ([A-Z][a-z]+(?: function)?) +\| /gmu)].map(
    ([, resource = '']: readonly string[]) => resource.toLowerCase(),
  ),
);

const openings = [
  [
    'a signed-in person',
    signedInAda,
    'acme',
    'This connection acts as Ada Lovelace (person:user_2ada) in the org acme.',
  ],
  ['a key', buildBot, 'acme', 'This connection acts as the key build-bot in the org acme.'],
  [
    'the local developer, in the org it acts in',
    localDeveloper,
    'globex',
    'This connection acts as ada (local) in the org globex.',
  ],
] as const;

describe('the instructions a connection is served', () => {
  it.each(openings)(
    'open, for %s, with whom it acts as, by name and id, and in which org',
    (_case, caller, org, opening) => {
      expect(
        instructionsActingAs({ caller, org }, 'own org', withConnections(ownOrg), { definitionTypes, pages: false }),
      ).toBe(`${opening} ${servedOnMcp}`);
    },
  );
});

describe('the instructions of each endpoint, for a key that may call every tool', () => {
  it.each([
    ['own org', withConnections(ownOrg), servedOnMcp],
    ['org', withConnections(orgEndpoint), servedOnAnOrg],
    ['playbook', playbookEndpoint, servedOnAPlaybook],
  ] as const)(
    'read on the %s endpoint with a sentence per type the server runs and a sentence per tool it lists that needs one',
    (endpoint, served, servedText) => {
      expect(instructionsFor(endpoint, served, definitionTypes)).toBe(servedText);
    },
  );

  it.each([
    ['own org', withConnections(ownOrg), servedOnMcp],
    ['org', withConnections(orgEndpoint), servedOnAnOrg],
    ['playbook', playbookEndpoint, servedOnAPlaybook],
  ] as const)(
    'read on the %s endpoint of a server that runs neither interaction nor prediction functions without their words',
    (endpoint, served, servedText) => {
      const threeTypes = definitionTypes.filter(({ type }) => !typesAfterTheFirstThree.has(type));

      expect(instructionsFor(endpoint, withoutInteraction(served), threeTypes)).toBe(
        asServedWithThreeTypes(servedText),
      );
    },
  );

  it.each(everyEndpoint)(
    'stay within 2,000 characters on the %s endpoint, opening line included, for a person named in 20 characters, of a user id of 32 and an org id of 30',
    (endpoint, served) => {
      const opened = instructionsActingAs(callerTheInstructionsHold, endpoint, served, {
        definitionTypes,
        pages: false,
      });

      expect(opened.length).toBeLessThanOrEqual(2000);
      expect(opened).toMatch(/^This connection acts as n{20} \(person:u{32}\) in the org o{30}\. /u);
    },
  );
});

describe('the instructions of a key that may only read', () => {
  it('name no command, and point to the guides for what the words mean', () => {
    const reading = instructionsFor(
      'own org',
      {
        orgTools: ['list_playbooks', 'list_models', 'get_guide'],
        playbookTools: queriesInsideAPlaybook,
      },
      definitionTypes,
    );

    expect(
      [
        'create_playbook',
        'create_definition',
        'run_definition',
        'send_run_event',
        'answer_interaction',
        'add_connection',
      ].filter((name) => reading.includes(name)),
    ).toEqual([]);
    expect(reading).toContain("The org is the caller's own: list_playbooks shows its playbooks.");
    expect(reading).toContain('get_guide explains these words and the format of each definition.');
  });
});

describe('instructions scoped to a playbook endpoint', () => {
  it('on a playbook endpoint, leave the model and the tools of a reasoning function to the guide of its format', () => {
    const reading = instructionsFor(
      'playbook',
      { orgTools: [], playbookTools: queriesInsideAPlaybook },
      definitionTypes,
    );

    expect(reading).toContain('get_guide explains these words and the format of each definition. A tool that cannot');
  });

  it('on an org endpoint that lists the models and no tool servers, say which models a reasoning function names', () => {
    const served = { orgTools: ['list_playbooks', 'list_models', 'get_guide'], playbookTools: [] };

    expect(instructionsFor('org', served, definitionTypes)).toContain(
      'list_models lists the models this server can call, which a reasoning function names. get_guide explains',
    );
  });

  it('on an org endpoint that only creates playbooks, say that it makes a playbook', () => {
    expect(instructionsFor('org', { orgTools: ['create_playbook'], playbookTools: [] }, definitionTypes)).toContain(
      "This connection manages the org's playbooks: create_playbook makes a playbook; each playbook's definitions are made on /orgs/{org}/playbooks/{playbook}/mcp.",
    );
  });
});

describe('what the instructions say of the definition types', () => {
  it('give a sentence only to a type the server runs', () => {
    const reasoningAlone = definitionTypes.slice(0, 1);
    const instructions = instructionsFor('playbook', playbookEndpoint, reasoningAlone);

    expect(instructions).toContain('runs belong to the playbook. Its function types: reasoning prompts a model. This');
    expect(['computation', 'A workflow waits'].filter((words) => instructions.includes(words))).toEqual([]);
    expect(instructions).toContain(
      "This connection acts inside one playbook. get_guide holds each definition's format",
    );
  });

  it('give no sentence to a type they have no words for', () => {
    const drafting = [{ type: 'drafting', noun: 'draft', guide: 'drafting' }];

    expect(instructionsFor('playbook', playbookEndpoint, drafting)).toContain(
      `${whatAPlaybookHolds} Auto Runtime makes and runs playbooks; Studio manages them; your agent is a separate client. A playbook contains one brain (its reusable functions) and workflows; runs belong to the playbook. This connection acts inside one playbook. get_guide holds each definition's format`,
    );
  });

  it('say, where the server keeps pages, that every workflow and function takes one, and ask an overview of the functions and workflows alone', () => {
    const instructions = instructionsFor('playbook', playbookEndpoint, definitionTypes, { pages: true });

    expect(instructions).toContain(
      'and run_definition runs it. Every workflow and function takes a page that shows the person its results, run by run and over time. This connection acts inside one playbook.',
    );
    expect(instructions).toContain(
      "get_guide holds each definition's format; a function or workflow takes an overview.",
    );
  });

  it('say nothing of the models where the server runs no reasoning function', () => {
    const withoutReasoning = definitionTypes.slice(1);
    const listingTheModels = { orgTools: ['list_playbooks', 'list_models', 'get_guide'], playbookTools: [] };

    expect(
      [
        instructionsFor('own org', listingTheModels, withoutReasoning),
        instructionsFor('org', listingTheModels, withoutReasoning),
      ].filter((instructions) => instructions.includes('list_models')),
    ).toEqual([]);
  });
});

describe('what the instructions say of a run that waits', () => {
  it('say that answer_interaction answers what a run waits on only where it is listed', () => {
    const answering = instructionsFor('playbook', playbookEndpoint, definitionTypes);
    const reading = instructionsFor(
      'playbook',
      { orgTools: [], playbookTools: queriesInsideAPlaybook },
      definitionTypes,
    );

    expect(answering).toContain(answeringSentence);
    expect(reading).not.toContain('answer_interaction');
  });
});

describe('the instructions of every endpoint', () => {
  it('teaches the same ownership as the terminology page', () => {
    expect(terminology).toContain('A playbook contains one brain and its workflows.');
    for (const [endpoint, served] of everyEndpoint) {
      const words = instructionsFor(endpoint, served, definitionTypes);
      expect(words).toContain('A playbook contains one brain (its reusable functions) and workflows;');
      expect(words).toContain('runs belong to the playbook');
    }
  });

  it('name as function types and resources only those on the terminology page', () => {
    expect(definitionTypes.filter(({ noun }) => !resourcesOnTheTerminologyPage.has(noun))).toEqual([]);
  });

  it('open with what a playbook holds, work that keeps running after a conversation, and then name the runtime', () => {
    expect(
      everyEndpoint.filter(
        ([endpoint, served]) =>
          !instructionsFor(endpoint, served, definitionTypes).startsWith(
            `${whatAPlaybookHolds} Auto Runtime makes and runs playbooks;`,
          ),
      ),
    ).toEqual([]);
  });

  it('use no term of the internal vocabulary once the address of a playbook is taken out', () => {
    const instructions = everyEndpoint.map(([endpoint, served]) =>
      instructionsFor(endpoint, served, definitionTypes).replace(
        ' on /orgs/{org}/playbooks/{playbook}/mcp.',
        ' there.',
      ),
    );

    expect(instructions.flatMap((text) => internalTermsIn(text))).toEqual([]);
  });
});
