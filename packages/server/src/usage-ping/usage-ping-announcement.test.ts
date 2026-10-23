import { Function } from 'effect';
import { describe, expect, it } from 'vitest';

import { runServer } from '../lifecycle/run-server.ts';
import { answered, folderOfTheTest, optionsPingingThrough, settingsIn } from '../testing/records/server-pings.ts';
import { firstStartNotice } from './usage-ping.ts';

async function announced(folder: string): Promise<readonly string[]> {
  const written: string[] = [];
  const never = Promise.withResolvers<void>().promise;
  const serverProcess = {
    env: settingsIn(folder),
    stdout: {
      write: (message: string) => {
        written.push(message);
      },
    },
    stderr: {
      write: (_message: string, flushed: () => void) => {
        flushed();
      },
    },
    exit: Function.constVoid,
  };
  const server = await runServer(serverProcess, optionsPingingThrough(answered(), folder), never, never);
  await server.stop();
  return written;
}

describe('the announcement of a server whose usage ping is on', () => {
  it('says after the port, at the first start alone, that it sends an anonymous usage ping', async () => {
    const folder = folderOfTheTest();

    const first = await announced(folder);
    const second = await announced(folder);

    expect(first.slice(1)).toEqual([`${firstStartNotice}\n`]);
    expect(second).toHaveLength(1);
    expect(first[0]).toMatch(/^Auto Runtime listening on port \d+\n$/u);
  });
});
