import { randomUUID } from 'node:crypto';

import type { Environment } from '@on.auto/config';
import { runKeyCommand, type KeyCommandConsole } from '@on.auto/identity';

import { instanceStartedInBackground } from '../background-start/background-process.ts';
import { release } from '../composition/release.ts';
import type { LocalStarting } from '../local-runtime/local-control.ts';
import { isRuntimeCommand, runRuntimeCommand } from '../local-runtime/runtime-commands.ts';
import { runtimePortOf } from '../local-runtime/runtime-port.ts';
import type { Waiting } from '../local-runtime/runtime-probe.ts';
import { localSettings, type LocalPlace } from './local-settings.ts';

export interface CommandLineHost {
  readonly environment: Environment;
  readonly place: LocalPlace;
  readonly console: KeyCommandConsole;
  readonly waiting: Waiting;
  readonly startServer: (settings: Readonly<Record<string, string>>, starting: LocalStarting) => Promise<unknown>;
  readonly relay: (port: number) => Promise<unknown>;
}

const usage = [
  'Usage: auto-runtime [command]',
  '',
  'Commands:',
  '  start                  Start Auto Runtime on this computer at http://localhost:5555 (the default)',
  '  mcp                    Connect an agent over standard input and output, starting Auto Runtime in the background when it is not running',
  '  status                 Show the Auto Runtime running on this computer: its version, process, start and directory',
  '  stop                   Stop the Auto Runtime running on this computer',
  '  restart                Restart the Auto Runtime running on this computer',
  '  key --org <org id>     Issue an API key for a machine or a pipeline; --help after it lists its options',
  '  --version              Print the version',
  '  --help                 Print this help',
  '',
  'On this computer every request is trusted as you, with no sign-in.',
  'PUBLIC_URL=http://localhost:5555 signs people in through the Auto identity service instead.',
  'Settings are environment variables, read from the shell and from .env in the current directory.',
  'auto-runtime.yaml in the current directory is the configuration file.',
  'The ledger is kept in ~/.auto-runtime/ledger.db unless LEDGER_FILE or DATABASE_URL says otherwise.',
  'Started by mcp, Auto Runtime reads its settings from ~/.auto-runtime and writes its log to ~/.auto-runtime/runtime.log.',
].join('\n');

type Answer = (rest: readonly string[], host: CommandLineHost) => number;

const answers: Readonly<Record<string, Answer>> = {
  key: (rest, host) => runKeyCommand(rest, host.console),
  '--version': (_rest, host) => {
    host.console.log(release.version);
    return 0;
  },
  '--help': (_rest, host) => {
    host.console.log(usage);
    return 0;
  },
};

function answered(args: readonly string[], host: CommandLineHost): number {
  const [name = '', ...rest] = args;
  const answer = Object.hasOwn(answers, name) ? answers[name] : undefined;
  if (answer === undefined) {
    host.console.error(`auto-runtime has no command "${args.join(' ')}"`);
    host.console.error(usage);
    return 1;
  }
  return answer(rest, host);
}

function startingOf(args: readonly string[]): LocalStarting | undefined {
  const given = args.join(' ');
  if (given === '' || given === 'start') {
    return { startedBy: 'terminal', instance: randomUUID() };
  }
  const instance = instanceStartedInBackground(args);
  return instance === undefined ? undefined : { startedBy: 'agent', instance };
}

async function startedServer(host: CommandLineHost, starting: LocalStarting): Promise<undefined> {
  await host.startServer(localSettings(host.environment, host.place), starting);
}

async function relayed(host: CommandLineHost): Promise<number> {
  await host.relay(runtimePortOf(host.environment, host.place.home));
  return 0;
}

export function runCommandLine(args: readonly string[], host: CommandLineHost): Promise<number | undefined> {
  const starting = startingOf(args);
  if (starting !== undefined) {
    return startedServer(host, starting);
  }
  const [name = ''] = args;
  if (args.length === 1 && name === 'mcp') {
    return relayed(host);
  }
  if (args.length === 1 && isRuntimeCommand(name)) {
    return runRuntimeCommand(name, runtimePortOf(host.environment, host.place.home), {
      ...host.waiting,
      console: host.console,
    });
  }
  return Promise.resolve(answered(args, host));
}
