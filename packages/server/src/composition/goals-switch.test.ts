import { openApiPath } from '@on.auto/api';
import { describe, expect, it } from 'vitest';

import { servingReasoning } from '../testing/servers/reasoning-server.ts';
import { servingReasoningWithGoals } from '../testing/settings/goals-kept.ts';

const documented = async (serving: typeof servingReasoning) => {
  const server = await serving([]);
  try {
    const [document, start] = await Promise.all(
      [openApiPath, '/v1/guides/start'].map((path) => fetch(`${server.origin}${path}`)),
    );
    return { document: await document?.text(), start: [start?.status, await start?.text()] };
  } finally {
    await server.stop();
  }
};

describe('a server composed with the goals option', () => {
  it('documents the playbook with its goals, where a server without it documents none, and serves a start guide that names the goals only where it keeps them', async () => {
    const [without, withGoals] = [await documented(servingReasoning), await documented(servingReasoningWithGoals)];

    expect([withGoals.start[0], without.start[0]]).toEqual([200, 200]);
    expect(withGoals.start[1]).toContain('\n## Its goals\n');
    expect(without.start[1]).not.toContain('## Its goals');
    expect(withGoals.document).toContain('`goals` is always the whole list');
    expect(without.document).not.toContain('`goals` is always the whole list');
  });
});
