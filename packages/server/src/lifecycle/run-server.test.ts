import type { Environment } from '@on.auto/config';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { ledgerOfAnotherVersion } from '../database/ledger-of-another-version.ts';
import { servedBy } from '../server-options/server-options.ts';
import { optionsComposing, optionsServing, defaultServerOptions } from '../testing/entries/serving-options.ts';
import { isAcceptingConnections } from '../testing/processes/accepting-connections.ts';
import { exitOnStartupFailure, runServer, type ServerProcess } from './run-server.ts';
import { stopInsistedBy, stopRequestedBy, type StopSignal } from './stop-request.ts';

const loopback = { HOST: '127.0.0.1', PORT: '0' };

interface FakeProcess {
  readonly serverProcess: ServerProcess;
  readonly written: readonly string[];
  readonly errors: readonly string[];
  readonly exited: Promise<number>;
  readonly stopRequested: Promise<void>;
  readonly stopInsisted: Promise<void>;
  readonly send: (signal: StopSignal) => void;
}

function fakeProcess(env: Environment = loopback): FakeProcess {
  const signals = new EventTarget();
  const written: string[] = [];
  const errors: string[] = [];
  const { promise: exited, resolve: exit } = Promise.withResolvers<number>();
  return {
    serverProcess: {
      env,
      stdout: { write: (message) => written.push(message) },
      stderr: {
        write: (message, flushed) => {
          errors.push(message);
          flushed();
        },
      },
      exit,
    },
    written,
    errors,
    exited,
    stopRequested: stopRequestedBy({
      on: (signal, listener) => {
        signals.addEventListener(signal, listener);
      },
    }),
    stopInsisted: stopInsistedBy({
      on: (signal, listener) => {
        signals.addEventListener(signal, listener);
      },
    }),
    send: (signal) => {
      signals.dispatchEvent(new Event(signal));
    },
  };
}

function signalledOnAnnouncement(signal: StopSignal): FakeProcess {
  const fake = fakeProcess();
  const announcements = fake.serverProcess.stdout;
  return {
    ...fake,
    serverProcess: {
      ...fake.serverProcess,
      stdout: {
        write: (message) => {
          announcements.write(message);
          fake.send(signal);
        },
      },
    },
  };
}

function signalledDuringStartUp(signal: StopSignal): { fake: FakeProcess; services: Layer.Layer<never> } {
  const fake = fakeProcess();
  const sendTheSignal = Layer.effectDiscard(
    Effect.sync(() => {
      fake.send(signal);
    }),
  );
  return { fake, services: sendTheSignal };
}

describe('runServer', () => {
  it('announces the port it listens on', async () => {
    const { serverProcess, written, stopRequested, stopInsisted } = fakeProcess();
    const server = await runServer(serverProcess, defaultServerOptions, stopRequested, stopInsisted);

    expect(written).toEqual([`Auto Runtime listening on port ${server.port}\n`]);
    await server.stop();
  });

  it('rejects invalid settings before it listens, with a named error, and announces nothing', async () => {
    const { serverProcess, written, stopRequested, stopInsisted } = fakeProcess({
      ...loopback,
      ALLOWED_ORIGINS: 'app.example.com',
    });

    await expect(runServer(serverProcess, defaultServerOptions, stopRequested, stopInsisted)).rejects.toMatchObject({
      name: 'InvalidSettingsError',
    });
    expect(written).toEqual([]);
  });

  it('rejects invalid API keys before it listens, with a named error, and announces nothing', async () => {
    const { serverProcess, written, stopRequested, stopInsisted } = fakeProcess({
      ...loopback,
      API_KEYS: '[{"id":"ci-1"}]',
    });

    await expect(runServer(serverProcess, defaultServerOptions, stopRequested, stopInsisted)).rejects.toMatchObject({
      name: 'InvalidApiKeysError',
    });
    expect(written).toEqual([]);
  });
});

describe('runServer on a stop signal', () => {
  it.each<StopSignal>(['SIGTERM', 'SIGINT'])(
    'stops accepting connections on %s, before anything else stops it',
    async (signal) => {
      const { serverProcess, stopRequested, stopInsisted, send } = fakeProcess();
      const server = await runServer(serverProcess, defaultServerOptions, stopRequested, stopInsisted);

      send(signal);
      const acceptingAfterSignal = await isAcceptingConnections(server.port);
      await server.stop();

      expect(acceptingAfterSignal).toBe(false);
    },
  );

  it.each<StopSignal>(['SIGTERM', 'SIGINT'])(
    'stops on %s sent the moment it announces the port, because it handles the signal before announcing',
    async (signal) => {
      const { serverProcess, stopRequested, stopInsisted } = signalledOnAnnouncement(signal);
      const server = await runServer(serverProcess, defaultServerOptions, stopRequested, stopInsisted);

      const acceptingAfterSignal = await isAcceptingConnections(server.port);
      await server.stop();

      expect(acceptingAfterSignal).toBe(false);
    },
  );

  it.each<StopSignal>(['SIGTERM', 'SIGINT'])(
    'stops as soon as it has started when %s arrived during start-up',
    async (signal) => {
      const { fake, services } = signalledDuringStartUp(signal);
      const server = await runServer(
        fake.serverProcess,
        optionsComposing(services, () => servedBy([])),
        fake.stopRequested,
        fake.stopInsisted,
      );

      const acceptingAfterStartUp = await isAcceptingConnections(server.port);
      await server.stop();

      expect(acceptingAfterStartUp).toBe(false);
    },
  );
});

const startUpFailures: ReadonlyArray<readonly [Readonly<Record<string, string>>, string]> = [
  [{ API_KEYS: 'abk_ci-1_not-a-list-of-keys' }, 'InvalidApiKeysError: API_KEYS: Expected a valid JSON string'],
  [
    { ALLOWED_ORIGINS: 'app.example.com' },
    'InvalidSettingsError: SchemaError(Expected an origin such as https://app.example.com at ["ALLOWED_ORIGINS"][0] Expected array at ["ALLOWED_ORIGINS"])',
  ],
  [
    { HOST: '0.0.0.0' },
    'ReachableWithoutCredentialsError: A server reachable beyond this computer needs PUBLIC_URL, to sign people in, or API_KEYS, and this one listens on HOST 0.0.0.0; where only this computer reaches its port, ACCESS_MODE=local with a PUBLIC_URL on the loopback declares local mode instead',
  ],
];

describe('a server that cannot start', () => {
  it.each(startUpFailures)(
    'names the error in one line on stderr, announces nothing and exits 1 with %o',
    async (settings, error) => {
      const { serverProcess, written, errors, exited, stopRequested, stopInsisted } = fakeProcess({
        ...loopback,
        ...settings,
      });

      await runServer(serverProcess, defaultServerOptions, stopRequested, stopInsisted).catch(
        exitOnStartupFailure(serverProcess),
      );

      expect(await exited).toBe(1);
      expect({ written, errors }).toEqual({ written: [], errors: [`Auto Runtime could not start: ${error}\n`] });
    },
  );
});

describe('a server that cannot start on a ledger of another version', () => {
  const refused = ledgerOfAnotherVersion(
    { found: 2, kept: 1 },
    { ledger: { store: 'sqlite', file: '/data/ledger.db' }, distribution: 'source' },
  );

  it('says the refusal in its own words on one line of stderr, with no name of an error before them', async () => {
    const { serverProcess, written, errors, exited } = fakeProcess();
    const servicesFailed = new Error("The server's services could not start", { cause: refused });

    exitOnStartupFailure(serverProcess)(servicesFailed);

    expect(await exited).toBe(1);
    expect({ written, errors }).toEqual({
      written: [],
      errors: [`Auto Runtime could not start: ${refused.message}\n`],
    });
    expect(errors[0]).toMatch(/^Auto Runtime could not start: The ledger is kept in the file \/data\/ledger\.db, /u);
  });
});

describe('runServer told to stop twice', () => {
  it('exits 1 at the second signal, saying so, without waiting for its shutdown to finish', async () => {
    const { serverProcess, stopRequested, stopInsisted, send, exited, errors } = fakeProcess();
    const neverStops = Promise.withResolvers<void>().promise;
    await runServer(
      serverProcess,
      optionsServing(() => ({ routes: [], stopWork: () => neverStops })),
      stopRequested,
      stopInsisted,
    );

    send('SIGTERM');
    send('SIGINT');

    expect(await exited).toBe(1);
    expect(errors).toEqual(['Auto Runtime was told to stop again, so it exits now without finishing its shutdown\n']);
  });
});

describe('runServer after it stopped', () => {
  it('exits 0 at the exit deadline, saying why, when the process is still running', async () => {
    const { serverProcess, stopRequested, stopInsisted, send, exited, errors } = fakeProcess();
    await runServer(serverProcess, { ...defaultServerOptions, exitDeadlineMs: 10 }, stopRequested, stopInsisted);

    send('SIGTERM');

    expect(await exited).toBe(0);
    expect(errors).toEqual(['Auto Runtime was still running 10 ms after it stopped, so it exits now\n']);
  });
});
