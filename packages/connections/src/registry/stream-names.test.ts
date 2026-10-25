import { describe, expect, it } from 'vitest';

import { clientRegistrationsStream, connectionsStream, connectionsStreamOfOrg } from '../index.ts';

describe('the names of the streams of connections', () => {
  it("are the stream of an org's connections, relative to the org and in full, and the stream of the runtime's client registrations, which a shell routes by them", () => {
    expect([connectionsStream, connectionsStreamOfOrg('acme'), clientRegistrationsStream]).toEqual([
      'connections',
      'org/acme/connections',
      'runtime/client-registrations',
    ]);
  });
});
