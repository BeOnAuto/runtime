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
  it('take 1,869 characters on /mcp, 1,866 on the org endpoint and 1,502 on the playbook endpoint after their opening line', () => {
    expect(
      everyEndpoint.map(([endpoint, served]) => instructionsFor(endpoint, served, definitionTypes).length),
    ).toEqual([1866, 1502, 1869]);
  });

  it('take 1,999, 1,996 and 1,632 with the opening line of the person the bound holds, which takes 130 of them', () => {
    expect(
      everyEndpoint.map(
        ([endpoint, served]) =>
          instructionsActingAs(callerTheInstructionsHold, endpoint, served, definitionTypes).length,
      ),
    ).toEqual([1996, 1632, 1999]);
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

    expect(lengths.map(({ length }) => length)).toEqual([1412, 1412, 1522, 1389]);
  });
});

describe('the instructions of an endpoint that lists search and add_connection', () => {
  const connecting = [
    "A service a playbook will use is connected here, whatever connector you have: asked to connect, link, sign in to or use one, call search with its words, then add_connection with the provider's name; the person approves on the page it links.",
    'Say a service cannot be connected only if no provider or server matches.',
  ].join(' ');

  it('say after the sentence on the guides that a service is connected through search and add_connection, on /mcp and the org endpoint', () => {
    expect(instructionsFor('own org', withConnections(ownOrg), definitionTypes)).toContain(
      `give it an overview. ${connecting} When the person approves`,
    );
    expect(instructionsFor('org', withConnections(orgEndpoint), definitionTypes)).toContain(
      `the format of each definition. ${connecting} Say what was done`,
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
