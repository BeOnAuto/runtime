import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { servedScopeOf, servesOrg, servesPlaybook } from '../index.ts';

describe('the scope an entry serves', () => {
  it('are its org, whether or not it names playbooks', () => {
    expect(servedScopeOf('EXAMPLE', 'graph', { org: 'acme', playbooks: ['sales'] }, 'server')).toEqual(
      Result.succeed({ orgs: ['acme'] }),
    );
    expect(servedScopeOf('EXAMPLE', 'graph', { org: 'acme' }, 'server')).toEqual(Result.succeed({ orgs: ['acme'] }));
  });

  it('are the orgs of a list, or every org for *', () => {
    expect(servedScopeOf('EXAMPLE', 'graph', { org: ['acme', 'globex'], playbooks: ['sales'] }, 'server')).toEqual(
      Result.succeed({ orgs: ['acme', 'globex'] }),
    );
    expect(servedScopeOf('EXAMPLE', 'graph', { org: '*' }, 'server')).toEqual(Result.succeed({ orgs: null }));
  });

  it('are refused without an org, or with an org or playbook that is not an id, at their places', () => {
    expect(servedScopeOf('EXAMPLE', 'graph', {}, 'endpoint')).toEqual(
      Result.fail([{ setting: 'EXAMPLE', pointer: '/graph', detail: 'Expected the org this endpoint serves' }]),
    );
    expect(servedScopeOf('EXAMPLE', 'graph', { org: 'ac/me', playbooks: ['sales', 'Sales'] }, 'server')).toEqual(
      Result.fail([
        { setting: 'EXAMPLE', pointer: '/graph/org', detail: 'Expected an org id, a list of them, or *' },
        { setting: 'EXAMPLE', pointer: '/graph/playbooks/1', detail: 'Expected a playbook id' },
      ]),
    );
  });
});

describe('the orgs an entry serves, refused', () => {
  it('as an empty list, an entry of a list that is no org id or *, and * beside playbooks', () => {
    expect([
      servedScopeOf('EXAMPLE', 'graph', { org: [] }, 'server'),
      servedScopeOf('EXAMPLE', 'graph', { org: ['acme', 'glo/bex', '*'] }, 'server'),
      servedScopeOf('EXAMPLE', 'graph', { org: '*', playbooks: ['sales'] }, 'server'),
    ]).toEqual([
      Result.fail([{ setting: 'EXAMPLE', pointer: '/graph/org', detail: 'Expected at least one org id' }]),
      Result.fail([
        { setting: 'EXAMPLE', pointer: '/graph/org/1', detail: 'Expected an org id' },
        { setting: 'EXAMPLE', pointer: '/graph/org/2', detail: 'Expected an org id; * stands alone, for every org' },
      ]),
      Result.fail([
        {
          setting: 'EXAMPLE',
          pointer: '/graph/playbooks',
          detail: 'Expected no playbooks beside every org, since a playbook id belongs to one org',
        },
      ]),
    ]);
  });
});

describe('the org and the playbook a call comes from', () => {
  it('decide whether the entry serves them', () => {
    const sales = { orgs: ['acme', 'globex'], playbooks: ['sales'] };
    const every = { orgs: null, playbooks: null };

    expect([
      servesPlaybook(sales, { org: 'acme', playbook: 'sales' }),
      servesPlaybook(sales, { org: 'globex', playbook: 'sales' }),
      servesPlaybook(sales, { org: 'acme', playbook: 'support' }),
      servesPlaybook(sales, { org: 'initech', playbook: 'sales' }),
      servesPlaybook(every, { org: 'initech', playbook: 'support' }),
      servesOrg(sales, 'globex'),
      servesOrg(sales, 'initech'),
      servesOrg(every, 'initech'),
    ]).toEqual([true, true, false, false, true, true, false, true]);
  });
});
