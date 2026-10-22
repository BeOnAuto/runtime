import { readFileSync } from 'node:fs';

import { internalTermsIn } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

import {
  playbookEndpoint,
  definitionTypes,
  everyEndpoint,
  orgEndpoint,
  ownOrg,
  queriesInsideAPlaybook,
  withConnections,
} from '../testing/served-instructions.ts';
import { instructionsFor, type ServedTools } from './instructions.ts';

const servedOnMcp =
  "Whatever the person wants done that should keep working after this conversation, however they put it and in any line of business, is a playbook on this server, not a document, a plan, a note or a one-off answer. Auto Runtime makes and runs playbooks; Studio manages them; your agent is a separate client. A playbook contains one brain (its reusable functions) and workflows. The brain shares its lifecycle. Functions run directly or in workflows; runs belong to the playbook. A reasoning function has a prompt and calls a language model. An interaction function asks a system and answers at once, or a person and answers started. A computation function runs a program whose output is the same for the same input. Recall retrieves run results, definitions and events, never run inputs or tool calls. What the person wants kept goes in a recall function, for anyone or a workflow to ask later, not your notes. A prediction function answers from a model trained on the playbook's history. A workflow runs functions in steps, waits for input and can start on a schedule or an event. This connection acts in the caller's own org: list_playbooks shows its playbooks and create_playbook makes one. Read a definition's format with get_guide; give it an overview. A service a playbook will use is connected on this server, whatever connector the agent has of its own: asked to connect, link, sign in to or use one, call search with its words, then add_connection with the provider's name, which the person approves on the page it links. Say a service cannot be connected only when no provider or server matches. When the person approves, rejects or otherwise answers what a run waits on, answer its request with answer_interaction, not a new run. Say what was done and what the person can do next, in the words of playbooks, functions, workflows and runs, not the tools' names, fields or rules; an id or status only where needed to act. A tool that cannot do what was asked says why and what to change.";

const servedOnAnOrg =
  "Whatever the person wants done that should keep working after this conversation, however they put it and in any line of business, is a playbook on this server, not a document, a plan, a note or a one-off answer. Auto Runtime makes and runs playbooks; Studio manages them; your agent is a separate client. A playbook contains one brain (its reusable functions) and workflows. The brain shares its lifecycle. Functions run directly or in workflows; runs belong to the playbook. A reasoning function has a prompt and calls a language model. An interaction function asks a system and answers at once, or a person and answers started. A computation function runs a program whose output is the same for the same input. Recall retrieves run results, definitions and events, never run inputs or tool calls. What the person wants kept goes in a recall function, for anyone or a workflow to ask later, not your notes. A prediction function answers from a model trained on the playbook's history. A workflow runs functions in steps, waits for input and can start on a schedule or an event. This connection manages the playbooks of one org: list_playbooks shows them and create_playbook makes one, and a playbook's functions and workflows are made on the playbook's own connection, /orgs/{org}/playbooks/{playbook}/mcp. get_guide holds what these words mean and how each kind of definition is written. A service a playbook will use is connected on this server, whatever connector the agent has of its own: asked to connect, link, sign in to or use one, call search with its words, then add_connection with the provider's name, which the person approves on the page it links. Say a service cannot be connected only when no provider or server matches. Say what was done and what the person can do next, in the words of playbooks, functions, workflows and runs, not the tools' names, fields or rules; an id or status only where needed to act. A tool that cannot do what was asked says why and what to change.";

const servedOnAPlaybook =
  "Whatever the person wants done that should keep working after this conversation, however they put it and in any line of business, is a playbook on this server, not a document, a plan, a note or a one-off answer. Auto Runtime makes and runs playbooks; Studio manages them; your agent is a separate client. A playbook contains one brain (its reusable functions) and workflows. The brain shares its lifecycle. Functions run directly or in workflows; runs belong to the playbook. A reasoning function has a prompt and calls a language model. An interaction function asks a system and answers at once, or a person and answers started. A computation function runs a program whose output is the same for the same input. Recall retrieves run results, definitions and events, never run inputs or tool calls. What the person wants kept goes in a recall function, for anyone or a workflow to ask later, not your notes. A prediction function answers from a model trained on the playbook's history. A workflow runs functions in steps, waits for input and can start on a schedule or an event. This connection acts inside one playbook. Read a definition's format with get_guide; give it an overview. When the person approves, rejects or otherwise answers what a run waits on, answer its request with answer_interaction, not a new run. Say what was done and what the person can do next, in the words of playbooks, functions, workflows and runs, not the tools' names, fields or rules; an id or status only where needed to act. A tool that cannot do what was asked says why and what to change.";

const interactionSentence =
  'An interaction function asks a system and answers at once, or a person and answers started.';

const answeringSentence =
  'When the person approves, rejects or otherwise answers what a run waits on, answer its request with answer_interaction, not a new run.';

const recallSentence = 'Recall retrieves run results, definitions and events, never run inputs or tool calls.';

const whatThePersonWantsKept =
  'What the person wants kept goes in a recall function, for anyone or a workflow to ask later, not your notes.';

const predictionSentence = "A prediction function answers from a model trained on the playbook's history.";

const claim =
  'Whatever the person wants done that should keep working after this conversation, however they put it and in any line of business, is a playbook on this server, not a document, a plan, a note or a one-off answer.';

function asServedWithFourTypes(servedText: string): string {
  return [interactionSentence, predictionSentence, answeringSentence].reduce(
    (text, sentence) => text.replace(` ${sentence}`, ''),
    servedText,
  );
}

const typesAfterTheFirstFour: ReadonlySet<string> = new Set(['interaction', 'prediction']);

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
    'read on the %s endpoint of a server that runs neither interaction nor prediction functions without their sentences',
    (endpoint, served, servedText) => {
      const fourTypes = definitionTypes.filter(({ type }) => !typesAfterTheFirstFour.has(type));

      expect(instructionsFor(endpoint, withoutInteraction(served), fourTypes)).toBe(asServedWithFourTypes(servedText));
    },
  );

  it.each(everyEndpoint)('stay under 2,000 characters on the %s endpoint', (endpoint, served) => {
    expect(instructionsFor(endpoint, served, definitionTypes).length).toBeLessThan(2000);
  });
});

describe('what the instructions say of what the person wants kept', () => {
  it("say on every endpoint, after what recall retrieves, that it goes in a recall function and not in the agent's own notes", () => {
    expect(
      everyEndpoint.filter(
        ([endpoint, served]) =>
          !instructionsFor(endpoint, served, definitionTypes).includes(`${recallSentence} ${whatThePersonWantsKept}`),
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
    expect(reading).toContain("This connection acts in the caller's own org: list_playbooks shows its playbooks.");
    expect(reading).toContain('get_guide holds what these words mean and how each kind of definition is written.');
  });
});

describe('instructions scoped to a playbook endpoint', () => {
  it('on a playbook endpoint, leave the model and the tools of a reasoning function to the guide of its format', () => {
    const reading = instructionsFor(
      'playbook',
      { orgTools: [], playbookTools: queriesInsideAPlaybook },
      definitionTypes,
    );

    expect(reading).toContain(
      'get_guide holds what these words mean and how each kind of definition is written. Say what was done',
    );
  });

  it('on an org endpoint that lists the models and no tool servers, say which models a reasoning function names', () => {
    const served = { orgTools: ['list_playbooks', 'list_models', 'get_guide'], playbookTools: [] };

    expect(instructionsFor('org', served, definitionTypes)).toContain(
      'list_models lists the models this server can call, which a reasoning function names. get_guide holds',
    );
  });

  it('on an org endpoint that only creates playbooks, say that it makes a playbook', () => {
    expect(instructionsFor('org', { orgTools: ['create_playbook'], playbookTools: [] }, definitionTypes)).toContain(
      "This connection manages the playbooks of one org: create_playbook makes a playbook, and a playbook's functions and workflows are made on the playbook's own connection, /orgs/{org}/playbooks/{playbook}/mcp.",
    );
  });
});

describe('what the instructions say of a prediction function', () => {
  it("say, where the server runs one, that it answers from a model trained on the playbook's history", () => {
    const predicting = definitionTypes.filter(({ type }) => type === 'prediction');

    expect(instructionsFor('playbook', playbookEndpoint, predicting)).toContain(
      `Functions run directly or in workflows; runs belong to the playbook. ${predictionSentence} This connection acts inside one playbook.`,
    );
    expect(
      instructionsFor('playbook', playbookEndpoint, definitionTypes.slice(0, 1)).includes(predictionSentence),
    ).toBe(false);
  });
});

describe('what the instructions say of the definition types', () => {
  it('give a sentence only to a type the server runs', () => {
    const reasoningAlone = definitionTypes.slice(0, 1);
    const instructions = instructionsFor('playbook', playbookEndpoint, reasoningAlone);

    expect(instructions).toContain('A reasoning function has a prompt and calls a language model.');
    expect(
      ['computation function', 'recall function', 'A workflow runs'].filter((words) => instructions.includes(words)),
    ).toEqual([]);
    expect(instructions).toContain("This connection acts inside one playbook. Read a definition's format");
  });

  it('give no sentence to a type they have no words for', () => {
    const drafting = [{ type: 'drafting', noun: 'draft', guide: 'drafting' }];

    expect(instructionsFor('playbook', playbookEndpoint, drafting)).toContain(
      `${claim} Auto Runtime makes and runs playbooks; Studio manages them; your agent is a separate client. A playbook contains one brain (its reusable functions) and workflows. The brain shares its lifecycle. Functions run directly or in workflows; runs belong to the playbook. This connection acts inside one playbook. Read a definition's format`,
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

describe('what the instructions say of the guides', () => {
  it("point to get_guide for a definition's format and ask for its overview on every endpoint that writes one, and name no recipe, which get_guide names", () => {
    const writing = everyEndpoint.filter(([endpoint]) => endpoint !== 'org');

    expect(
      writing.filter(
        ([endpoint, served]) =>
          !instructionsFor(endpoint, served, definitionTypes).includes(
            "Read a definition's format with get_guide; give it an overview.",
          ),
      ),
    ).toEqual([]);
    expect(
      everyEndpoint.filter(([endpoint, served]) =>
        instructionsFor(endpoint, served, definitionTypes).includes('recipe'),
      ),
    ).toEqual([]);
  });
});

describe('what the instructions say of a run that waits', () => {
  it('say how to answer what a run waits on only where answer_interaction is listed', () => {
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
  it('teaches the same ownership and lifecycle as the terminology page', () => {
    expect(terminology).toContain('A playbook contains one brain and its workflows.');
    for (const [endpoint, served] of everyEndpoint) {
      const words = instructionsFor(endpoint, served, definitionTypes);
      expect(words).toContain('A playbook contains one brain (its reusable functions) and workflows.');
      expect(words).toContain('The brain shares its lifecycle.');
      expect(words).toContain('runs belong to the playbook');
    }
  });

  it('name as function types and resources only those on the terminology page', () => {
    expect(definitionTypes.filter(({ noun }) => !resourcesOnTheTerminologyPage.has(noun))).toEqual([]);
  });

  it('open with the claim that whatever the person wants kept working is a playbook here, and then name the runtime', () => {
    expect(
      everyEndpoint.filter(
        ([endpoint, served]) =>
          !instructionsFor(endpoint, served, definitionTypes).startsWith(
            `${claim} Auto Runtime makes and runs playbooks;`,
          ),
      ),
    ).toEqual([]);
  });

  it('use no term of the internal vocabulary once the address of a playbook is taken out', () => {
    const instructions = everyEndpoint.map(([endpoint, served]) =>
      instructionsFor(endpoint, served, definitionTypes).replace(', /orgs/{org}/playbooks/{playbook}/mcp.', '.'),
    );

    expect(instructions.flatMap((text) => internalTermsIn(text))).toEqual([]);
  });
});
