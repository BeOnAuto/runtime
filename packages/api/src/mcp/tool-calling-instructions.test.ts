import { describe, expect, it } from 'vitest';

import { callerTheInstructionsHold } from '../bounds/served-bounds.ts';
import {
  playbookEndpoint,
  definitionTypes,
  everyEndpoint,
  orgEndpoint,
  ownOrg,
  queriesInsideAPlaybook,
  withConnections,
} from '../testing/served-instructions.ts';
import { instructionsActingAs, instructionsFor } from './instructions.ts';

describe('the length of the instructions with every tool', () => {
  it('take 1,365 characters on /mcp, 1,366 on the org endpoint and 994 on the playbook endpoint after their opening line', () => {
    expect(
      everyEndpoint.map(([endpoint, served]) => instructionsFor(endpoint, served, definitionTypes).length),
    ).toEqual([1366, 994, 1365]);
  });

  it('take 1,495, 1,496 and 1,124 with the opening line of the person the bound holds, which takes 130 of them', () => {
    expect(
      everyEndpoint.map(
        ([endpoint, served]) =>
          instructionsActingAs(callerTheInstructionsHold, endpoint, served, { definitionTypes, pages: false }).length,
      ),
    ).toEqual([1496, 1124, 1495]);
  });
});

describe('what the instructions say of calling a tool', () => {
  const reading = {
    orgTools: ['list_playbooks', 'list_models', 'search', 'get_guide'],
    playbookTools: queriesInsideAPlaybook,
  };

  it('leave the model and tools of a reasoning function, a run that finishes later, query_connection, execute_connection and dry_run to their tools and guides, and keep the closing sentence', () => {
    expect(instructionsFor('own org', ownOrg, definitionTypes)).toContain(
      "get_guide holds each definition's format; a definition takes an overview. answer_interaction answers",
    );
    expect(instructionsFor('playbook', playbookEndpoint, definitionTypes)).toContain(
      "get_guide holds each definition's format; a definition takes an overview. answer_interaction answers",
    );
    expect(
      everyEndpoint.filter(([endpoint, served]) =>
        /\b(?:query_connection|execute_connection|dry_run)\b/u.test(instructionsFor(endpoint, served, definitionTypes)),
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

    expect(lengths.map(({ length }) => length)).toEqual([933, 933, 1018, 910]);
  });
});

describe('the instructions of an endpoint that lists search and add_connection', () => {
  const connecting = [
    "search finds the provider of a service by its words, and add_connection connects it to the org's playbooks; the person approves on the page it links.",
    "Where no provider or server matches, add_connection can still take the service's own MCP server or HTTP API, given by hand; a service with neither cannot be connected.",
  ].join(' ');

  it('say after the sentence on the guides that search finds the provider of a service and add_connection connects it, on /mcp and the org endpoint', () => {
    expect(instructionsFor('own org', withConnections(ownOrg), definitionTypes)).toContain(
      `a definition takes an overview. ${connecting} answer_interaction answers`,
    );
    expect(instructionsFor('org', withConnections(orgEndpoint), definitionTypes)).toContain(
      `the format of each definition. ${connecting} A tool that cannot`,
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

describe('what the instructions say of the guides', () => {
  it("say that get_guide holds a definition's format and that a definition takes an overview on every endpoint that writes one, and name no recipe, which get_guide names", () => {
    const writing = everyEndpoint.filter(([endpoint]) => endpoint !== 'org');

    expect(
      writing.filter(
        ([endpoint, served]) =>
          !instructionsFor(endpoint, served, definitionTypes).includes(
            "get_guide holds each definition's format; a definition takes an overview.",
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
