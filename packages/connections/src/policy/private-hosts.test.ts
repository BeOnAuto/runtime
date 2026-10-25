import { describe, expect, it } from 'vitest';

import { adding, billing, notes, statusesOf } from '../testing/additions.ts';
import { harness } from '../testing/harness.ts';
import { connectionPolicyOf } from './connection-policy.ts';

function reaching(name: string, url: string) {
  return { ...notes, name, entry: { url } };
}

const insideTheNetwork = [
  reaching('metadata', 'https://169.254.169.254/latest/meta-data'),
  reaching('google-metadata', 'https://metadata.google.internal/computeMetadata/v1'),
  reaching('loopback', 'http://localhost:8080/mcp'),
  reaching('loopback-decimal', 'http://2130706433/mcp'),
  reaching('loopback-hex', 'http://0x7f.0.0.2/mcp'),
  reaching('loopback-mapped', 'http://[::ffff:127.0.0.1]/mcp'),
  reaching('private', 'https://10.0.0.5/mcp'),
  reaching('shared', 'https://100.64.0.1/mcp'),
  reaching('unique-local', 'https://[fd00::1]/mcp'),
  reaching('one-label', 'https://kubernetes/mcp'),
];

describe('the policy of the runtime, of the hosts inside its network', () => {
  it('refuses a loopback, private, link-local or reserved address, a local name or a metadata service, however written, where it lists none', async () => {
    const h = harness({ policy: connectionPolicyOf({}) });

    expect(await statusesOf(h, insideTheNetwork)).toEqual(insideTheNetwork.map(() => 'rejected'));
    expect(await adding(h, insideTheNetwork[0])).toMatchObject({
      reason: 'forbidden',
      detail:
        'A connection may not reach the host 169.254.169.254 on this runtime: it is a loopback, private, link-local or reserved address, a local name or a metadata service, of which the runtime allows none',
    });
  });

  it('refuses the issuer of a credential inside the network, where the client secret would go', async () => {
    const h = harness({ policy: connectionPolicyOf({}) });
    const issuedInside = { ...billing, credential: { ...billing.credential, issuer: 'https://169.254.169.254' } };

    expect(await adding(h, issuedInside)).toMatchObject({ reason: 'forbidden' });
  });

  it('takes a host inside the network that private_hosts lists, alone or under a *. pattern, and no other', async () => {
    const h = harness({ policy: connectionPolicyOf({ private_hosts: ['localhost', '10.0.0.5', '*.corp.internal'] }) });
    const listed = [
      reaching('loopback', 'http://localhost:8080/mcp'),
      reaching('private', 'https://10.0.0.5/mcp'),
      reaching('internal', 'https://wiki.corp.internal/mcp'),
      reaching('another', 'https://10.0.0.6/mcp'),
      reaching('loopback-address', 'http://127.0.0.1/mcp'),
    ];

    expect(await statusesOf(h, listed)).toEqual(['succeeded', 'succeeded', 'succeeded', 'rejected', 'rejected']);
    expect(await adding(h, reaching('metadata', 'https://169.254.169.254/'))).toMatchObject({
      detail:
        'A connection may not reach the host 169.254.169.254 on this runtime: it is a loopback, private, link-local or reserved address, a local name or a metadata service, of which the runtime allows localhost, 10.0.0.5, and *.corp.internal',
    });
  });

  it('still holds a host private_hosts lists to allowed_hosts', async () => {
    const h = harness({
      policy: connectionPolicyOf({ private_hosts: ['10.0.0.5'], allowed_hosts: ['*.example.com'] }),
    });

    expect(await adding(h, reaching('private', 'https://10.0.0.5/mcp'))).toMatchObject({
      reason: 'forbidden',
      detail: 'A connection may not reach the host 10.0.0.5 on this runtime, which allows *.example.com',
    });
  });
});
