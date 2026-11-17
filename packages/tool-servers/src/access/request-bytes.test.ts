import { describe, expect, it } from 'vitest';

import { toolBounds } from '../bounds/call-bounds.ts';
import { reportingAccess } from '../testing/index.ts';

describe('the most a call through the tool access may send', () => {
  it('is what the access is given, 16 MiB unless it is given another, and at most 4 MiB to a server started as a program', () => {
    const servers = {
      graph: { url: 'https://graph.example.com/mcp', org: 'acme' },
      local: { command: 'local-mcp-server', org: 'acme' },
    };
    const given = reportingAccess(servers, { mostRequestBytes: 32 * 1_048_576 }).access;
    const unset = reportingAccess(servers).access;

    expect(
      [given, unset].flatMap((access) =>
        ['graph', 'local', 'a-connection'].map((server) => access.mostRequestBytesTo(server)),
      ),
    ).toEqual([
      32 * 1_048_576,
      toolBounds.stdioRequestBytes,
      32 * 1_048_576,
      toolBounds.requestBytes,
      toolBounds.stdioRequestBytes,
      toolBounds.requestBytes,
    ]);
  });

  it('is answered whole, for a server that is not started as a program, as the composition gave it', () => {
    const servers = { local: { command: 'local-mcp-server', org: 'acme' } };

    expect([
      reportingAccess(servers, { mostRequestBytes: 32 * 1_048_576 }).access.mostRequestBytes,
      reportingAccess(servers).access.mostRequestBytes,
    ]).toEqual([32 * 1_048_576, toolBounds.requestBytes]);
  });
});
