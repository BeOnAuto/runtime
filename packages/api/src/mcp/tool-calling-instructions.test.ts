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
import { instructionsFor } from './instructions.ts';

describe('the length of the instructions with every tool', () => {
  it('take 1,996 characters on /mcp, 1,912 on the org endpoint and 1,621 on the playbook endpoint', () => {
    expect(
      everyEndpoint.map(([endpoint, served]) => instructionsFor(endpoint, served, definitionTypes).length),
    ).toEqual([1912, 1621, 1996]);
  });
});

describe('what the instructions say of calling a tool', () => {
  const reading = {
    orgTools: ['list_playbooks', 'list_models', 'search', 'get_guide'],
    playbookTools: queriesInsideAPlaybook,
  };

  it('end the sentence on tools at what search finds, leaving execute and dry_run to their own descriptions, and keep the closing sentence', () => {
    expect(instructionsFor('own org', ownOrg, definitionTypes)).toContain(
      'A reasoning function names a model that list_models lists and may name tools that search finds. A run of a workflow',
    );
    expect(instructionsFor('playbook', playbookEndpoint, definitionTypes)).toContain(
      'A reasoning function names a model this server can call, as the reasoning-function guide says, and may name tools that search finds. A run of a workflow',
    );
    expect(
      everyEndpoint.filter(([endpoint, served]) =>
        /\b(?:execute|dry_run)\b/u.test(instructionsFor(endpoint, served, definitionTypes)),
      ),
    ).toEqual([]);
    expect(
      everyEndpoint.filter(
        ([endpoint, served]) =>
          !instructionsFor(endpoint, served, definitionTypes).endsWith(
            'A tool that cannot do what was asked says why and what to change.',
          ),
      ),
    ).toEqual([]);
  });

  it('keep within their bound for a key that may only read', () => {
    const lengths = [
      instructionsFor('own org', reading, definitionTypes),
      instructionsFor('own org', { ...reading, orgTools: ['list_playbooks', 'search', 'get_guide'] }, definitionTypes),
      instructionsFor('org', { orgTools: reading.orgTools, playbookTools: [] }, definitionTypes),
      instructionsFor('playbook', { orgTools: [], playbookTools: queriesInsideAPlaybook }, definitionTypes),
    ];

    expect(lengths.map(({ length }) => length)).toEqual([1507, 1544, 1540, 1504]);
  });
});

describe('the instructions of an endpoint that lists search and add_connection', () => {
  const connecting = [
    "Accounts at services are connected through this server: asked to connect, link, sign in to or use a service, call search with its words, which lists the providers that match, then add_connection with a provider's name, which the person approves on the page it links.",
    'Say a service cannot be connected only when no provider or server matches.',
  ].join(' ');

  it('say after the sentence on tools that a service is connected through search and add_connection, on /mcp and the org endpoint', () => {
    expect(instructionsFor('own org', withConnections(ownOrg), definitionTypes)).toContain(
      `may name tools that search finds. ${connecting} A run of a workflow`,
    );
    expect(instructionsFor('org', withConnections(orgEndpoint), definitionTypes)).toContain(
      `may name tools that search finds. ${connecting} Say what was done`,
    );
  });

  it('say nothing of connecting a service where search or add_connection is not listed', () => {
    const notConnecting = [
      instructionsFor('own org', ownOrg, definitionTypes),
      instructionsFor('org', orgEndpoint, definitionTypes),
      instructionsFor('playbook', playbookEndpoint, definitionTypes),
      instructionsFor('org', { orgTools: ['add_connection', 'list_connections'], playbookTools: [] }, definitionTypes),
    ];

    expect(notConnecting.filter((instructions) => /connected|add_connection/u.test(instructions))).toEqual([]);
  });
});
