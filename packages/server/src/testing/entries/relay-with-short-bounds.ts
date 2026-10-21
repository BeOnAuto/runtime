import { homedir } from 'node:os';
import { setTimeout } from 'node:timers/promises';

import { relayedAgent } from '../../agent-relay/agent-relay.ts';
import { relayBounds } from '../../agent-relay/relay-bounds.ts';
import { runtimePortOf } from '../../local-runtime/runtime-port.ts';
import { overTheNetwork } from '../../local-runtime/runtime-probe.ts';

const home = homedir();

const shortBounds = { ...relayBounds, silenceMs: 1000, stopWithinMs: 500 };

await relayedAgent(
  runtimePortOf(process.env, home),
  {
    home,
    environment: { ...process.env },
    waiting: { fetch: overTheNetwork, sleep: (milliseconds: number) => setTimeout(milliseconds) },
  },
  shortBounds,
);
