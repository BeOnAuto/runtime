import type { CallerIdentity, Outcome } from '@on.auto/operations';
import type { FakeMcpServer } from '@on.auto/tool-servers/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { added, crm, notes } from '../testing/additions.ts';
import {
  consentedOf,
  consentFake,
  consentHarnessAt,
  theOrgsOAuthClient,
  underTheOrgsOAuthClient,
} from '../testing/consents.ts';
import {
  acmePlaybookWriter,
  acmeReader,
  acmeViewer,
  acmeWriter,
  connectionsManagedBy,
  grace,
  harness,
  operationNamed,
  type Harness,
  type HarnessOptions,
} from '../testing/harness.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

type Calling = (caller: CallerIdentity) => Promise<Outcome>;

function callingOn(h: Harness, operation: string, input: unknown): Calling {
  return (caller) => h.call(operationNamed(h.operations, operation), caller, input);
}

function consentServed(): FakeMcpServer {
  const fake = consentFake();
  closing.push(fake.close);
  return fake;
}

const locally: HarnessOptions = { access: 'local' };

const openLinks: Readonly<Record<string, (options?: HarnessOptions) => Promise<Calling>>> = {
  read_link: async (options = locally) => {
    const h = harness(options);
    const { id, token } = await added(h, crm);
    return callingOn(h, 'read_link', { id, token });
  },
  approve: async (options = locally) => {
    const h = harness(options);
    const { id, token } = await added(h, notes);
    return callingOn(h, 'approve', { id, token });
  },
  give_credential: async (options = locally) => {
    const h = harness(options);
    const { id, token } = await added(h, crm);
    return callingOn(h, 'give_credential', { id, token, value: 'Bearer crm-0f3c' });
  },
  give_client: async (options = locally) => {
    const h = consentHarnessAt(consentServed(), options);
    const { id, token } = await added(h, underTheOrgsOAuthClient);
    return callingOn(h, 'give_client', { id, token, ...theOrgsOAuthClient });
  },
  start: async (options = locally) => {
    const h = consentHarnessAt(consentServed(), options);
    const { id, token } = await added(h, { provider: 'files' });
    return callingOn(h, 'start', { id, token });
  },
  finish: async (options = locally) => {
    const h = consentHarnessAt(consentServed(), options);
    const link = await added(h, { provider: 'files' });
    const { code, state, iss } = await consentedOf(h, link);
    return callingOn(h, 'finish', { id: link.id, token: link.token, code, state, iss });
  },
};

const callersWithoutOrgWrite: readonly (readonly [string, CallerIdentity])[] = [
  ['playbook:read', acmeViewer],
  ['playbook:write', acmePlaybookWriter],
  ['org:read', acmeReader],
];

describe.each(Object.entries(openLinks))('the page operation %s', (_operation, open) => {
  it.each(callersWithoutOrgWrite)(
    'refuses a caller whose only permission is %s, and leaves the link open to a caller who holds org:write',
    async (_permission, caller) => {
      const calling = await open();

      const refused = await calling(caller);
      const accepted = await calling(acmeWriter);

      expect(refused).toMatchObject({ status: 'rejected', reason: 'forbidden' });
      expect(JSON.stringify(refused)).toContain('org:write');
      expect(accepted).toMatchObject({ status: 'succeeded' });
    },
  );

  it('accepts a caller whose only permission is org:write', async () => {
    const calling = await open();

    expect(await calling(acmeWriter)).toMatchObject({ status: 'succeeded' });
  });
});

describe.each(Object.entries(openLinks))('the page operation %s, where people sign in', (_operation, open) => {
  it('refuses a person the decision point does not let manage the connections of the org, for their role', async () => {
    const calling = await open({ access: 'people', decidedBy: connectionsManagedBy('ada') });

    expect(await calling(grace)).toMatchObject({ status: 'rejected', reason: 'forbidden', kind: 'permission_denied' });
  });

  it('is taken from another person who may manage the connections of the org, whoever added the connection', async () => {
    const calling = await open({ access: 'people', decidedBy: connectionsManagedBy('ada', 'grace') });

    expect(await calling(grace)).toMatchObject({ status: 'succeeded' });
  });
});

const pageOperations = ['read_link', 'approve', 'give_credential', 'give_client', 'start', 'finish'];

describe('what the operations of the page declare about themselves', () => {
  it('say that start and finish reach the authorization server and may change something there, a client registered or tokens revoked, and that the others keep what they are given here alone', () => {
    const { operations } = harness();

    expect(
      pageOperations.map((name) => {
        const { reachesOutside, mayChangeOutside } = operationNamed(operations, name).registration;
        return { name, reachesOutside, mayChangeOutside };
      }),
    ).toEqual([
      { name: 'read_link', reachesOutside: false, mayChangeOutside: false },
      { name: 'approve', reachesOutside: false, mayChangeOutside: false },
      { name: 'give_credential', reachesOutside: false, mayChangeOutside: false },
      { name: 'give_client', reachesOutside: false, mayChangeOutside: false },
      { name: 'start', reachesOutside: true, mayChangeOutside: true },
      { name: 'finish', reachesOutside: true, mayChangeOutside: true },
    ]);
  });
});
