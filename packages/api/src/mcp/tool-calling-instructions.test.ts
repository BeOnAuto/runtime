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
  it('take 1,993 characters on /mcp, 1,993 on the org endpoint and 1,575 on the playbook endpoint', () => {
    expect(
      everyEndpoint.map(([endpoint, served]) => instructionsFor(endpoint, served, definitionTypes).length),
    ).toEqual([1993, 1575, 1993]);
  });
});

describe('what the instructions say of calling a tool', () => {
  const reading = {
    orgTools: ['list_playbooks', 'list_models', 'search', 'get_guide'],
    playbookTools: queriesInsideAPlaybook,
  };

  it('leave the model and tools of a reasoning function, a run that finishes later, execute and dry_run to their tools and guides, and keep the closing sentence', () => {
    expect(instructionsFor('own org', ownOrg, definitionTypes)).toContain(
      "Read a definition's format with get_guide; give it an overview. When the person approves",
    );
    expect(instructionsFor('playbook', playbookEndpoint, definitionTypes)).toContain(
      "Read a definition's format with get_guide; give it an overview. When the person approves",
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

    expect(lengths.map(({ length }) => length)).toEqual([1498, 1498, 1615, 1458]);
  });
});

describe('the instructions of an endpoint that lists search and add_connection', () => {
  const connecting = [
    "A service a playbook will use is connected on this server, whatever connector the agent has of its own: asked to connect, link, sign in to or use one, call search with its words, then add_connection with the provider's name, which the person approves on the page it links.",
    'Say a service cannot be connected only when no provider or server matches.',
  ].join(' ');

  it('say after the sentence on the guides that a service is connected through search and add_connection, on /mcp and the org endpoint', () => {
    expect(instructionsFor('own org', withConnections(ownOrg), definitionTypes)).toContain(
      `give it an overview. ${connecting} When the person approves`,
    );
    expect(instructionsFor('org', withConnections(orgEndpoint), definitionTypes)).toContain(
      `how each kind of definition is written. ${connecting} Say what was done`,
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
