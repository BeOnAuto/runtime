import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { runtimesStartedInTheBackgroundEndedWithTheTest } from '../testing/processes/background-runtimes.ts';
import { aPortNothingListensOn } from '../testing/processes/free-port.ts';
import {
  homeOfTheTest,
  spawnRelayWithShortBounds,
  spawnRuntimeCommand,
  type RuntimeCommandPlace,
  type RuntimeCommandRun,
} from '../testing/processes/runtime-command.ts';
import { until } from '../testing/waiting/until.ts';

const homePrefix = 'auto-runtime-agent-';

const statusOf = Schema.decodeUnknownSync(
  Schema.Struct({ pid: Schema.Number, instance: Schema.String, started_by: Schema.String }),
);

async function statusAt(port: number): Promise<ReturnType<typeof statusOf>> {
  return statusOf(await (await fetch(`http://127.0.0.1:${port}/runtime`)).json());
}

async function placeOfTheTest(): Promise<RuntimeCommandPlace> {
  const home = homeOfTheTest(homePrefix);
  const port = await aPortNothingListensOn();
  runtimesStartedInTheBackgroundEndedWithTheTest(home);
  return { home, port };
}

function lineOf(message: object): string {
  return `${JSON.stringify(message)}\n`;
}

const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'an-agent', version: '1.0.0' } },
};

function answersIn(stdout: string): readonly unknown[] {
  return stdout
    .split('\n')
    .filter((line) => line !== '')
    .map((line): unknown => JSON.parse(line));
}

function answeredWithId(relay: Readonly<RuntimeCommandRun>, id: number): Promise<unknown> {
  return until(
    () =>
      answersIn(relay.stdout()).find(
        (answer) => typeof answer === 'object' && answer !== null && 'id' in answer && answer.id === id,
      ),
    (answer) => answer !== undefined,
  );
}

function readiesIn(text: string): number {
  return text.split('Press Ctrl+C to stop.').length - 1;
}

function logOf(home: string): string {
  return readFileSync(join(home, '.auto-runtime', 'runtime.log'), 'utf8');
}

describe('an agent whose runtime in a terminal is stopped', () => {
  it('has its next request answered by a runtime its relay starts in the background in its place', async () => {
    const { home, port } = await placeOfTheTest();
    const runtime = spawnRuntimeCommand([], { home, port });
    await until(() => {
      expect(readiesIn(runtime.stdout())).toBe(1);
    });
    const relay = spawnRuntimeCommand(['mcp'], { home, port });
    relay.write(lineOf(initialize));
    await answeredWithId(relay, 1);

    runtime.interrupt();
    await runtime.exited;
    relay.write(lineOf({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }));
    const listed = await answeredWithId(relay, 2);
    const replaced = await statusAt(port);
    relay.end();

    expect(JSON.stringify(listed)).toContain('"name":"list_playbooks"');
    expect(replaced.started_by).toBe('agent');
    expect(logOf(home)).toContain(`Auto Runtime was started in the background as process ${replaced.pid}`);
    expect(await relay.exited).toBe(0);
  });
});

describe('an agent whose runtime, started by its relay, stops answering during a call', () => {
  it('has the call answered once its runtime was stopped and replaced, with words to check whether it took effect and that the runtime runs again', async () => {
    const { home, port } = await placeOfTheTest();
    const relay = spawnRelayWithShortBounds({ home, port });
    relay.write(lineOf(initialize));
    await answeredWithId(relay, 1);
    const frozen = await statusAt(port);

    process.kill(frozen.pid, 'SIGSTOP');
    relay.write(
      lineOf({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_models', arguments: {} } }),
    );
    const called = await answeredWithId(relay, 2);
    relay.write(lineOf({ jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} }));
    const listed = await answeredWithId(relay, 3);
    const replaced = await statusAt(port);
    relay.end();

    expect(JSON.stringify(called)).toContain(
      'stopped answering while it handled this request, so it may or may not have taken effect. Look at the playbook, its definitions and its runs to see whether it did before you send it again. Auto Runtime runs again.',
    );
    expect(JSON.stringify(listed)).toContain('"name":"list_playbooks"');
    expect(replaced.pid).not.toBe(frozen.pid);
    expect(logOf(home)).toContain(
      `Auto Runtime, process ${frozen.pid}, did not answer 3 pings, so this connection, which started it, sent it SIGTERM`,
    );
    expect(logOf(home)).toContain(
      `Auto Runtime, process ${frozen.pid}, did not end within 0.5 s of SIGTERM, so this connection sent it SIGKILL`,
    );
    expect(logOf(home)).toContain(`Auto Runtime, process ${frozen.pid}, ended`);
    expect(await relay.exited).toBe(0);
  });
});

describe('an agent whose runtime in a terminal stops answering during a call', () => {
  it('has the call answered once with words to check whether it took effect, and that this connection did not start the runtime, which it leaves running', async () => {
    const { home, port } = await placeOfTheTest();
    const runtime = spawnRuntimeCommand([], { home, port });
    await until(() => {
      expect(readiesIn(runtime.stdout())).toBe(1);
    });
    const relay = spawnRelayWithShortBounds({ home, port });
    relay.write(lineOf(initialize));
    await answeredWithId(relay, 1);
    const frozen = await statusAt(port);

    process.kill(frozen.pid, 'SIGSTOP');
    relay.write(
      lineOf({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_models', arguments: {} } }),
    );
    const called = await answeredWithId(relay, 2);
    process.kill(frozen.pid, 'SIGCONT');
    const after = await statusAt(port);
    relay.end();
    runtime.interrupt();

    expect(JSON.stringify(called)).toContain(
      `Look at the playbook, its definitions and its runs to see whether it did before you send it again. Auto Runtime on port ${port} does not answer, and this connection did not start it, so it leaves it alone.`,
    );
    expect(after.pid).toBe(frozen.pid);
    expect([await relay.exited, await runtime.exited]).toEqual([0, 0]);
  });
});
