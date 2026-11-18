import { once } from 'node:events';
import { createServer } from 'node:net';

const portsBelowTheEphemeralRanges = { first: 20_000, last: 32_767 };

function aPortBelowTheEphemeralRanges(): number {
  const { first, last } = portsBelowTheEphemeralRanges;
  return first + Math.floor(Math.random() * (last - first + 1));
}

async function nothingListensOn(port: number): Promise<boolean> {
  const probe = createServer();
  const listening = await new Promise<boolean>((settle) => {
    probe.once('error', () => {
      settle(false);
    });
    probe.listen(port, '0.0.0.0', () => {
      settle(true);
    });
  });
  if (listening) {
    probe.close();
    await once(probe, 'close');
  }
  return listening;
}

export async function aPortNothingListensOn(candidate: () => number = aPortBelowTheEphemeralRanges): Promise<number> {
  const port = candidate();
  return (await nothingListensOn(port)) ? port : aPortNothingListensOn(candidate);
}
