import { homedir } from 'node:os';
import { setTimeout } from 'node:timers/promises';

import { relayedAgent } from './src/agent-relay/agent-relay.ts';
import { runCommandLine } from './src/command-line/command-line.ts';
import { restartIn } from './src/local-runtime/local-control.ts';
import { overTheNetwork } from './src/local-runtime/runtime-probe.ts';
import { colorDepthOf } from './src/logging/terminal.ts';

const environmentAtStart = { ...process.env };

const home = homedir();

const waiting = { fetch: overTheNetwork, sleep: (milliseconds: number) => setTimeout(milliseconds) };

const terminal = {
  depth: colorDepthOf(process.stdout),
  write: (text: string) => {
    process.stdout.write(text);
  },
  clock: () => performance.now(),
  tickEvery: (milliseconds: number, tick: () => void) => {
    const timer = setInterval(tick, milliseconds);
    return () => {
      clearInterval(timer);
    };
  },
};

process.exitCode =
  (await runCommandLine(process.argv.slice(2), {
    environment: process.env,
    place: { directory: process.cwd(), home },
    console: {
      log: (line) => {
        process.stdout.write(`${line}\n`);
      },
      error: (line) => {
        process.stderr.write(`${line}\n`);
      },
    },
    waiting,
    startServer: async (settings, starting) => {
      const { startedLocally } = await import('./src/local-runtime/local-start.ts');
      if ((await startedLocally(settings, starting, { home, terminal })) === 'restart') {
        restartIn(process, environmentAtStart);
      }
    },
    relay: (port) => relayedAgent(port, { home, environment: environmentAtStart, waiting }),
  })) ?? process.exitCode;
