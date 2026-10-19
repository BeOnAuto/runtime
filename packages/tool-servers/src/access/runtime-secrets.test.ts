import { keptTextOf } from '@on.auto/operations/testing';
import { Effect, Redacted } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { reportingAccess, serveFakeMcp } from '../testing/index.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const runtimeSecret = 'registered-client-secret-7e1d';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

describe('the secrets of the runtime an access is given beside those of its servers', () => {
  it('are scrubbed from the recorded start of a call made by hand, as a secret of the settings is', async () => {
    const fake = await serveFakeMcp({ bearer: apiKey });
    closing.push(fake.close);
    const graph = { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' };
    const { access, content } = reportingAccess(
      { graph },
      { environment: { GRAPH_API_KEY: apiKey }, runtimeSecrets: [Redacted.make(runtimeSecret)] },
    );
    closing.push(access.close);

    const { fields: started } = await Effect.runPromise(
      access.preparedCall({
        org: 'acme',
        playbook: 'alpha',
        reference: { server: 'graph', tool: 'echo' },
        input: { said: `${runtimeSecret} and ${apiKey}` },
        meta: {},
      }),
    );

    await expect(
      keptTextOf(content, { org: 'acme', playbook: 'alpha' }, String(started.arguments_sha256)),
    ).resolves.toBe(JSON.stringify({ said: '[redacted] and [redacted]' }));
  });
});
