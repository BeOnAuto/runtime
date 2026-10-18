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
  recipes,
} from '../testing/served-instructions.ts';
import { instructionsFor, type ServedTools } from './instructions.ts';

const servedOnMcp =
  "Auto Runtime executes playbooks; Studio manages them; your agent is a separate client. A playbook contains one brain (its reusable functions) and workflows. The brain shares its lifecycle. Functions run directly or through workflows; runs belong to the playbook. A reasoning function has a prompt and calls a language model. An interaction function asks a system and answers at once, or asks a person and answers started. A computation function runs a program on its input and gives the same output every time. Recall retrieves retained run results, definitions and events, never run inputs or tool calls. What the person wants kept goes in a recall function, for anyone or a workflow to ask later, not your own notes. A prediction function answers from a model trained on the playbook's history; a build, the input { build: {} }, answers started. A workflow runs functions in steps, waits for input and can start on a schedule or on an event. This connection acts in the caller's own org: list_playbooks shows its playbooks and create_playbook makes one. Before writing a definition, read its format with get_guide, which also holds the recipes: first-playbook, remember, give-tools and schedule. A reasoning function names a model that list_models lists and may name tools that search finds; execute calls one and shows its answer, and dry_run what it would check. A run of a workflow answers started; get_run shows whether it ended or still waits. When the person approves, rejects or otherwise answers what a run waits on, answer its request with answer_interaction, not a new run. Runs, events and requests come in pages; read on only when the person needs more. Say what was done and what the person can do next in the words of playbooks, functions, workflows and runs, not the tools' names, fields or rules, and an id or status only when needed to act. A tool that cannot do what was asked says why and what to change.";

const servedOnAnOrg =
  "Auto Runtime executes playbooks; Studio manages them; your agent is a separate client. A playbook contains one brain (its reusable functions) and workflows. The brain shares its lifecycle. Functions run directly or through workflows; runs belong to the playbook. A reasoning function has a prompt and calls a language model. An interaction function asks a system and answers at once, or asks a person and answers started. A computation function runs a program on its input and gives the same output every time. Recall retrieves retained run results, definitions and events, never run inputs or tool calls. What the person wants kept goes in a recall function, for anyone or a workflow to ask later, not your own notes. A prediction function answers from a model trained on the playbook's history; a build, the input { build: {} }, answers started. A workflow runs functions in steps, waits for input and can start on a schedule or on an event. This connection manages the playbooks of one org: list_playbooks shows them and create_playbook makes one, and a playbook's functions and workflows are made on the playbook's own connection, /orgs/{org}/playbooks/{playbook}/mcp. get_guide holds what these words mean and how each kind of definition is written. A reasoning function names a model that list_models lists and may name tools that search finds. Say what was done and what the person can do next in the words of playbooks, functions, workflows and runs, not the tools' names, fields or rules, and an id or status only when needed to act. A tool that cannot do what was asked says why and what to change.";

const servedOnAPlaybook =
  "Auto Runtime executes playbooks; Studio manages them; your agent is a separate client. A playbook contains one brain (its reusable functions) and workflows. The brain shares its lifecycle. Functions run directly or through workflows; runs belong to the playbook. A reasoning function has a prompt and calls a language model. An interaction function asks a system and answers at once, or asks a person and answers started. A computation function runs a program on its input and gives the same output every time. Recall retrieves retained run results, definitions and events, never run inputs or tool calls. What the person wants kept goes in a recall function, for anyone or a workflow to ask later, not your own notes. A prediction function answers from a model trained on the playbook's history; a build, the input { build: {} }, answers started. A workflow runs functions in steps, waits for input and can start on a schedule or on an event. This connection acts inside one playbook. Before writing a definition, read its format with get_guide, which also holds the recipes: remember, give-tools and schedule. A reasoning function names a model this server can call, as the reasoning-function guide says, and may name tools that search finds; execute calls one and shows its answer, and dry_run what it would check. A run of a workflow answers started; get_run shows whether it ended or still waits. When the person approves, rejects or otherwise answers what a run waits on, answer its request with answer_interaction, not a new run. Runs, events and requests come in pages; read on only when the person needs more. Say what was done and what the person can do next in the words of playbooks, functions, workflows and runs, not the tools' names, fields or rules, and an id or status only when needed to act. A tool that cannot do what was asked says why and what to change.";

const interactionSentence =
  'An interaction function asks a system and answers at once, or asks a person and answers started.';

const answeringSentence =
  'When the person approves, rejects or otherwise answers what a run waits on, answer its request with answer_interaction, not a new run.';

const recallSentence = 'Recall retrieves retained run results, definitions and events, never run inputs or tool calls.';

const whatThePersonWantsKept =
  'What the person wants kept goes in a recall function, for anyone or a workflow to ask later, not your own notes.';

const predictionSentence =
  "A prediction function answers from a model trained on the playbook's history; a build, the input { build: {} }, answers started.";

function asServedWithFourTypes(servedText: string): string {
  return [interactionSentence, predictionSentence, answeringSentence]
    .reduce((text, sentence) => text.replace(` ${sentence}`, ''), servedText)
    .replace('Runs, events and requests come', 'Runs and events come');
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
    ['own org', ownOrg, servedOnMcp],
    ['org', orgEndpoint, servedOnAnOrg],
    ['playbook', playbookEndpoint, servedOnAPlaybook],
  ] as const)(
    'read on the %s endpoint with a sentence per type the server runs and a sentence per tool it lists that needs one',
    (endpoint, served, servedText) => {
      expect(instructionsFor(endpoint, served, definitionTypes, recipes)).toBe(servedText);
    },
  );

  it.each([
    ['own org', ownOrg, servedOnMcp],
    ['org', orgEndpoint, servedOnAnOrg],
    ['playbook', playbookEndpoint, servedOnAPlaybook],
  ] as const)(
    'read on the %s endpoint of a server that runs neither interaction nor prediction functions without their sentences',
    (endpoint, served, servedText) => {
      const fourTypes = definitionTypes.filter(({ type }) => !typesAfterTheFirstFour.has(type));

      expect(instructionsFor(endpoint, withoutInteraction(served), fourTypes, recipes)).toBe(
        asServedWithFourTypes(servedText),
      );
    },
  );

  it.each(everyEndpoint)('stay under 2,000 characters on the %s endpoint', (endpoint, served) => {
    expect(instructionsFor(endpoint, served, definitionTypes, recipes).length).toBeLessThan(2000);
  });
});

describe('what the instructions say of what the person wants kept', () => {
  it("say on every endpoint, after what recall retrieves, that it goes in a recall function and not in the agent's own notes", () => {
    expect(
      everyEndpoint.filter(
        ([endpoint, served]) =>
          !instructionsFor(endpoint, served, definitionTypes, recipes).includes(
            `${recallSentence} ${whatThePersonWantsKept}`,
          ),
      ),
    ).toEqual([]);
  });

  it('say nothing of it where the server runs no recall function to keep it in', () => {
    const withoutRecall = definitionTypes.filter(({ type }) => type !== 'recall');

    expect(
      everyEndpoint.filter(([endpoint, served]) =>
        instructionsFor(endpoint, served, withoutRecall, recipes).includes('wants kept'),
      ),
    ).toEqual([]);
  });
});

describe('the instructions of a key that may only read', () => {
  it('name no command, and point to the guides without the recipes the key could not follow', () => {
    const reading = instructionsFor(
      'own org',
      {
        orgTools: ['list_playbooks', 'list_models', 'get_guide'],
        playbookTools: queriesInsideAPlaybook,
      },
      definitionTypes,
      recipes,
    );

    expect(
      [
        'create_playbook',
        'create_definition',
        'run_definition',
        'send_run_event',
        'answer_interaction',
        'first-playbook',
      ].filter((name) => reading.includes(name)),
    ).toEqual([]);
    expect(reading).toContain("This connection acts in the caller's own org: list_playbooks shows its playbooks.");
    expect(reading).toContain('get_guide holds what these words mean and how each kind of definition is written.');
  });
});

describe('instructions scoped to a playbook endpoint', () => {
  it('on a playbook endpoint, say how a reasoning function names its tools without naming the models it cannot list', () => {
    const reading = instructionsFor(
      'playbook',
      { orgTools: [], playbookTools: queriesInsideAPlaybook },
      definitionTypes,
      recipes,
    );

    expect(reading).toContain(
      'get_guide holds what these words mean and how each kind of definition is written. A reasoning function names a model this server can call, as the reasoning-function guide says,',
    );
  });

  it('on an org endpoint that lists the models and no tool servers, say which models a reasoning function names', () => {
    const served = { orgTools: ['list_playbooks', 'list_models', 'get_guide'], playbookTools: [] };

    expect(instructionsFor('org', served, definitionTypes, recipes)).toContain(
      'list_models lists the models this server can call, which a reasoning function names. get_guide holds',
    );
  });

  it('on an org endpoint that only creates playbooks, say that it makes a playbook', () => {
    expect(
      instructionsFor('org', { orgTools: ['create_playbook'], playbookTools: [] }, definitionTypes, recipes),
    ).toContain(
      "This connection manages the playbooks of one org: create_playbook makes a playbook, and a playbook's functions and workflows are made on the playbook's own connection, /orgs/{org}/playbooks/{playbook}/mcp.",
    );
  });
});

describe('what the instructions say of a prediction function', () => {
  it('say, where the server runs one, that it answers a question and that its build answers started', () => {
    const predicting = definitionTypes.filter(({ type }) => type === 'prediction');

    expect(instructionsFor('playbook', playbookEndpoint, predicting, recipes)).toContain(
      `Functions run directly or through workflows; runs belong to the playbook. ${predictionSentence} This connection acts inside one playbook.`,
    );
    expect(
      instructionsFor('playbook', playbookEndpoint, definitionTypes.slice(0, 1), recipes).includes(predictionSentence),
    ).toBe(false);
  });
});

describe('what the instructions say of the definition types', () => {
  it('give a sentence only to a type the server runs', () => {
    const reasoningAlone = definitionTypes.slice(0, 1);
    const instructions = instructionsFor('playbook', playbookEndpoint, reasoningAlone, recipes);

    expect(instructions).toContain('A reasoning function has a prompt and calls a language model.');
    expect(
      ['computation function', 'recall function', 'A workflow runs'].filter((words) => instructions.includes(words)),
    ).toEqual([]);
    expect(instructions).toContain('This connection acts inside one playbook. Before writing a definition');
  });

  it('give no sentence to a type they have no words for', () => {
    const drafting = [{ type: 'drafting', noun: 'draft', guide: 'drafting' }];

    expect(instructionsFor('playbook', playbookEndpoint, drafting, recipes)).toContain(
      'Auto Runtime executes playbooks; Studio manages them; your agent is a separate client. A playbook contains one brain (its reusable functions) and workflows. The brain shares its lifecycle. Functions run directly or through workflows; runs belong to the playbook. This connection acts inside one playbook. Before writing a definition',
    );
  });

  it('say nothing of models and tools where the server runs no reasoning function', () => {
    const withoutReasoning = definitionTypes.slice(1);

    expect(
      ['list_models', 'search'].filter((name) =>
        [
          instructionsFor('own org', ownOrg, withoutReasoning, recipes),
          instructionsFor('org', orgEndpoint, withoutReasoning, recipes),
        ].some((instructions) => instructions.includes(name)),
      ),
    ).toEqual([]);
  });

  it('point to get_guide without recipes where no recipe can be followed', () => {
    expect(instructionsFor('playbook', playbookEndpoint, definitionTypes, [])).toContain(
      'Before writing a definition, read its format with get_guide. A reasoning function',
    );
  });

  it('name the one recipe that can be followed without a list', () => {
    expect(instructionsFor('playbook', playbookEndpoint, definitionTypes, recipes.slice(1, 2))).toContain(
      'read its format with get_guide, which also holds the recipes: remember.',
    );
  });
});

describe('what the instructions say of a run that waits', () => {
  it('say how to answer what a run waits on only where answer_interaction is listed', () => {
    const answering = instructionsFor('playbook', playbookEndpoint, definitionTypes, recipes);
    const reading = instructionsFor(
      'playbook',
      { orgTools: [], playbookTools: queriesInsideAPlaybook },
      definitionTypes,
      recipes,
    );

    expect(answering).toContain(answeringSentence);
    expect(reading).not.toContain('answer_interaction');
  });
});

describe('the instructions of every endpoint', () => {
  it('teaches the same ownership and lifecycle as the terminology page', () => {
    expect(terminology).toContain('A playbook contains one brain and its workflows.');
    for (const [endpoint, served] of everyEndpoint) {
      const words = instructionsFor(endpoint, served, definitionTypes, recipes);
      expect(words).toContain('A playbook contains one brain (its reusable functions) and workflows.');
      expect(words).toContain('The brain shares its lifecycle.');
      expect(words).toContain('runs belong to the playbook');
    }
  });

  it('name as function types and resources only those on the terminology page', () => {
    expect(definitionTypes.filter(({ noun }) => !resourcesOnTheTerminologyPage.has(noun))).toEqual([]);
  });

  it('use no term of the internal vocabulary once the address of a playbook is taken out, and identifies the runtime', () => {
    const instructions = everyEndpoint.map(([endpoint, served]) =>
      instructionsFor(endpoint, served, definitionTypes, recipes).replace(
        ', /orgs/{org}/playbooks/{playbook}/mcp.',
        '.',
      ),
    );

    expect(instructions.flatMap((text) => internalTermsIn(text))).toEqual([]);
    expect(instructions.every((text) => text.startsWith('Auto Runtime executes playbooks;'))).toBe(true);
  });
});
