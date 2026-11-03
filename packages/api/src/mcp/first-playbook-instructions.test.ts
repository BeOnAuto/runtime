import { describe, expect, it } from 'vitest';

import {
  definitionTypes,
  orgEndpoint,
  ownOrg,
  playbookEndpoint,
  queriesInsideAPlaybook,
  recipes,
  signedInAda,
  withConnections,
} from '../testing/served-instructions.ts';
import { instructionsActingAs, instructionsFor } from './instructions.ts';

const whereToStart = 'The guide first-playbook sets out how a playbook is built, and names the guides its steps need.';

describe('what the instructions say of the guide to build a playbook by', () => {
  it('name the guide first-playbook, after the guides, where the connection can follow it', () => {
    expect(instructionsFor('own org', withConnections(ownOrg), definitionTypes, { pages: true, recipes })).toContain(
      `get_guide holds each definition's format; a function or workflow takes an overview. ${whereToStart} search finds`,
    );
  });

  it('name first-playbook nowhere the connection cannot follow it, or where it is not served', () => {
    const notFollowed = [
      instructionsFor('playbook', playbookEndpoint, definitionTypes, { pages: true, recipes }),
      instructionsFor('org', withConnections(orgEndpoint), definitionTypes, { pages: true, recipes }),
      instructionsFor(
        'own org',
        { orgTools: ['list_playbooks'], playbookTools: queriesInsideAPlaybook },
        definitionTypes,
        {
          pages: true,
          recipes,
        },
      ),
      instructionsFor('own org', withConnections(ownOrg), definitionTypes, { pages: true }),
    ];

    expect(notFollowed.filter((instructions) => instructions.includes('first-playbook'))).toEqual([]);
  });

  it('name it in the instructions a person connecting to /mcp is served, opening line and all', () => {
    expect(
      instructionsActingAs({ caller: signedInAda, org: 'acme' }, 'own org', withConnections(ownOrg), {
        definitionTypes,
        pages: true,
        recipes,
      }),
    ).toContain(whereToStart);
  });
});
