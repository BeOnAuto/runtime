import { readFileSync } from 'node:fs';

import { internalTermsIn } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

import {
  buildBot,
  everyEndpoint,
  localDeveloper,
  orgEndpoint,
  ownOrg,
  playbookEndpoint,
  queriesInsideAPlaybook,
  signedInAda,
  withConnections,
} from '../testing/served-instructions.ts';
import { instructionsActingAs, instructionsFor } from './instructions.ts';

const whatAPlaybookHolds = 'A playbook holds work that keeps running after a conversation, in any line of business.';

const whatThisServerIsFor = `${whatAPlaybookHolds} Auto Runtime makes and runs playbooks; Studio manages them; the agent is a separate client. A playbook contains one brain (its reusable functions) and workflows; runs belong to the playbook.`;

const whereToBegin =
  'Before anything else, read the guide start with get_guide: it says what a playbook is made of, what a workflow owns, what you do yourself, and which guide each task needs.';

const closing = 'A tool that cannot do what was asked says why and what to change.';

const servedOnMcp = `${whatThisServerIsFor} The org is the caller's own: list_playbooks shows its playbooks and create_playbook makes one. ${whereToBegin} ${closing}`;

const servedOnAnOrg = `${whatThisServerIsFor} This connection manages the org's playbooks: list_playbooks shows them and create_playbook makes one; each playbook's definitions are made on /orgs/{org}/playbooks/{playbook}/mcp. ${whereToBegin} ${closing}`;

const servedOnAPlaybook = `${whatThisServerIsFor} This connection acts inside one playbook. ${whereToBegin} ${closing}`;

const terminology = readFileSync(new URL('../../../../docs/concepts/terminology.md', import.meta.url), 'utf8');

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
      expect(instructionsActingAs({ caller, org }, 'own org', withConnections(ownOrg))).toBe(
        `${opening} ${servedOnMcp}`,
      );
    },
  );
});

describe('the instructions of each endpoint, for a key that may call every tool', () => {
  it.each([
    ['own org', withConnections(ownOrg), servedOnMcp],
    ['org', withConnections(orgEndpoint), servedOnAnOrg],
    ['playbook', playbookEndpoint, servedOnAPlaybook],
  ] as const)(
    'say on the %s endpoint what a playbook is, what the connection acts on, and, before anything else, to read the guide start',
    (endpoint, served, servedText) => {
      expect(instructionsFor(endpoint, served)).toBe(servedText);
    },
  );

  it('read the same on the directory listing as on /mcp', () => {
    expect(instructionsFor('directory', withConnections(ownOrg))).toBe(servedOnMcp);
  });
});

describe('the instructions of a key that may only read', () => {
  it('name no command, and send it to the guide start all the same', () => {
    const reading = instructionsFor('own org', {
      orgTools: ['list_playbooks', 'list_models', 'get_guide'],
      playbookTools: queriesInsideAPlaybook,
    });

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
    expect(reading).toBe(
      `${whatThisServerIsFor} The org is the caller's own: list_playbooks shows its playbooks. ${whereToBegin} ${closing}`,
    );
  });
});

describe('what the instructions say of the connection', () => {
  it('on an org endpoint that only creates playbooks, say that it makes a playbook', () => {
    expect(instructionsFor('org', { orgTools: ['create_playbook'], playbookTools: [] })).toContain(
      "This connection manages the org's playbooks: create_playbook makes a playbook; each playbook's definitions are made on /orgs/{org}/playbooks/{playbook}/mcp.",
    );
  });

  it('on an org endpoint that neither lists nor creates playbooks, say only what it manages', () => {
    expect(instructionsFor('org', { orgTools: ['get_guide'], playbookTools: [] })).toContain(
      "This connection manages the org's playbooks; each playbook's definitions are made on /orgs/{org}/playbooks/{playbook}/mcp. Before anything else, read the guide start",
    );
  });
});

describe('the instructions of every endpoint', () => {
  it('teach the same ownership as the terminology page', () => {
    expect(terminology).toContain('A playbook contains one brain and its workflows.');
    for (const [endpoint, served] of everyEndpoint) {
      const words = instructionsFor(endpoint, served);
      expect(words).toContain('A playbook contains one brain (its reusable functions) and workflows;');
      expect(words).toContain('runs belong to the playbook');
    }
  });

  it('open with what a playbook holds, work that keeps running after a conversation, and then name the runtime', () => {
    expect(
      everyEndpoint.filter(
        ([endpoint, served]) =>
          !instructionsFor(endpoint, served).startsWith(`${whatAPlaybookHolds} Auto Runtime makes and runs playbooks;`),
      ),
    ).toEqual([]);
  });

  it('leave the function types, the workflows, the pages, the connections and the recipes to the guide start, and end with what a tool that cannot says', () => {
    for (const [endpoint, served] of everyEndpoint) {
      const words = instructionsFor(endpoint, served);
      expect(words).not.toMatch(
        /reasoning|lookup|interaction|prediction|computation|generation|page|recipe|first-playbook|search|add_connection|answer_interaction|list_models|query_connection|execute_connection|dry_run/u,
      );
      expect(words.endsWith(`${whereToBegin} ${closing}`)).toBe(true);
    }
  });

  it('use no term of the internal vocabulary once the address of a playbook is taken out', () => {
    const instructions = everyEndpoint.map(([endpoint, served]) =>
      instructionsFor(endpoint, served).replace(' on /orgs/{org}/playbooks/{playbook}/mcp.', ' there.'),
    );

    expect(instructions.flatMap((text) => internalTermsIn(text))).toEqual([]);
  });

  it('take under 700 characters with every tool, so a client that shows little of them shows them whole', () => {
    expect(everyEndpoint.map(([endpoint, served]) => instructionsFor(endpoint, served).length)).toEqual([
      servedOnAnOrg.length,
      servedOnAPlaybook.length,
      servedOnMcp.length,
    ]);
    expect([servedOnAnOrg, servedOnAPlaybook, servedOnMcp].filter(({ length }) => length >= 700)).toEqual([]);
  });
});
