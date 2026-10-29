import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { alpha, servingReasoning } from '../testing/servers/reasoning-server.ts';

const AnswerSchema = Schema.Struct({ cursor: Schema.String });

function elapsed(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe('a held request for the changes of a playbook, when the server stops', () => {
  it('is answered at once with the cursor it was given and no changes, and the stop does not wait for it', async () => {
    const server = await servingReasoning([]);
    await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
    const now = Schema.decodeUnknownSync(AnswerSchema)((await server.call('GET', `${alpha}/changes`)).body).cursor;

    const held = server.call('GET', `${alpha}/changes?since=${now}&wait=25`);
    await elapsed(200);
    const started = performance.now();
    await server.stop();

    expect(await held).toMatchObject({ status: 200, body: { cursor: now, changes: [], more: false } });
    expect(performance.now() - started).toBeLessThan(5000);
  });
});
