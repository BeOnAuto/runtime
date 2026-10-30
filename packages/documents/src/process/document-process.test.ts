import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

import { spawnForTheTest } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

import { documentProcessModule } from './pooled-documents.ts';

describe('the module a process that reads documents runs', () => {
  it('says it is ready to its server, and ends of itself when its server lets it go', async () => {
    const child = spawnForTheTest(process.execPath, [...process.execArgv, fileURLToPath(documentProcessModule())], {
      serialization: 'json',
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    const heard: readonly unknown[] = await once(child, 'message');
    const ended = once(child, 'exit');
    child.disconnect();

    expect([heard[0], await ended]).toEqual([{ ready: true }, [0, null]]);
  });
});
