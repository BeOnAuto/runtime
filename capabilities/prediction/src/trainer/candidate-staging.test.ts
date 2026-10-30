import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { testPorts } from '../testing/prediction-ports.ts';
import { staged } from './candidate-staging.ts';

const address = { org: 'acme', playbook: 'stores', id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7f' };

const bytes = new TextEncoder().encode('a candidate');

const sha256 = createHash('sha256').update(bytes).digest('hex');

describe('the staging of a candidate under its build', () => {
  it('tells a trainer the build has ended when its run ended before the candidate was staged', async () => {
    const { ports, directory } = testPorts({ processes: 1 });
    const path = join(directory, 'candidate.scripted');
    await writeFile(path, bytes);
    await Effect.runPromise(ports.ledger.content.unstage({ org: address.org, playbook: address.playbook }, address.id));

    const refused = await Effect.runPromise(Effect.flip(staged(ports, { address }, path, sha256)));

    expect(refused).toMatchObject({ kind: 'build_ended', detail: 'The build has ended' });
  });
});
