import { connectionPolicyOf, type ConnectionPolicy, type ConnectionPolicyFields } from '../policy/connection-policy.ts';

const fakeServersHost = '127.0.0.1';

export function loopbackPolicyOf(fields: ConnectionPolicyFields = {}): ConnectionPolicy {
  return connectionPolicyOf({ private_hosts: [fakeServersHost], ...fields });
}
