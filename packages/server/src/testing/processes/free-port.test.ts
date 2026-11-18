import { once } from 'node:events';
import { createServer } from 'node:net';

import { describe, expect, it, onTestFinished } from 'vitest';

import { aPortNothingListensOn } from './free-port.ts';

const firstEphemeralPortOfLinux = 32_768;

describe('a port nothing listens on', () => {
  it('lies below the ports the system hands to a server that asks for any port, and can be listened on', async () => {
    const port = await aPortNothingListensOn();
    const server = createServer().listen(port, '0.0.0.0');
    await once(server, 'listening');
    server.close();

    expect(port).toBeLessThan(firstEphemeralPortOfLinux);
    expect(port).toBeGreaterThan(1023);
  });

  it('is never one something already listens on', async () => {
    const taken = await aPortNothingListensOn();
    const holder = createServer().listen(taken, '0.0.0.0');
    await once(holder, 'listening');
    onTestFinished(() => {
      holder.close();
    });
    const free = await aPortNothingListensOn();
    const candidates = [taken, free];

    expect(await aPortNothingListensOn(() => Number(candidates.shift()))).toBe(free);
  });
});
