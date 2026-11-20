import { defaultStudioOrigin } from '@on.auto/identity';
import { describe, expect, it } from 'vitest';

import { interactionServerOn } from '../testing/interaction-servers/interaction-server.ts';
import { issuerOverHttps } from './issuer-over-https.ts';

const aKeyNoListHolds = `abk_acme-admin_${'A'.repeat(43)}`;

function createdWith(server: string, session: string, presentedFrom: string | undefined): Promise<Response> {
  return fetch(`${server}/v1/orgs/acme/playbooks`, {
    method: 'POST',
    headers: {
      ...(presentedFrom === undefined ? {} : { origin: presentedFrom }),
      authorization: `Bearer ${session}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ playbook: 'alpha', name: 'Alpha' }),
  });
}

describe('a server in local mode', () => {
  it('takes a page that sends its session, and a key where no key is set, as the local developer', async () => {
    const issuer = await issuerOverHttps();
    const server = await interactionServerOn({});
    const session = await issuer.session(defaultStudioOrigin, { sub: 'user|ada' });

    const fromThePage = await createdWith(server.origin, session, defaultStudioOrigin);
    const withAKey = await server.call('POST', '/v1/orgs/acme/playbooks', {
      key: aKeyNoListHolds,
      body: { playbook: 'beta', name: 'Beta' },
    });

    expect([fromThePage.status, await fromThePage.json()]).toMatchObject([201, { created_by: { id: 'local' } }]);
    expect(withAKey).toMatchObject({ status: 201, body: { created_by: { id: 'local' } } });
  });
});
