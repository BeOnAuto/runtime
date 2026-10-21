import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { aPortNothingListensOn } from '../testing/processes/free-port.ts';
import {
  homeOfTheTest,
  ranToEnd,
  runtimeOnThePortEndedWithTheTest,
  spawnRuntimeCommand,
  type RuntimeCommandRun,
  type RuntimeCommandPlace,
} from '../testing/processes/runtime-command.ts';
import { until } from '../testing/waiting/until.ts';

const homePrefix = 'auto-runtime-agent-';

const statusOf = Schema.decodeUnknownSync(Schema.Struct({ pid: Schema.Number, directory: Schema.String }));

async function statusAt(port: number): Promise<ReturnType<typeof statusOf>> {
  return statusOf(await (await fetch(`http://127.0.0.1:${port}/runtime`)).json());
}

async function placeOfTheTest(): Promise<RuntimeCommandPlace> {
  const home = homeOfTheTest(homePrefix);
  const port = await aPortNothingListensOn();
  runtimeOnThePortEndedWithTheTest(home, port);
  return { home, port };
}

const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'agent', version: '1.0.0' } },
};

function answersIn(stdout: string): readonly unknown[] {
  return stdout
    .split('\n')
    .filter((line) => line !== '')
    .map((line): unknown => JSON.parse(line));
}

function answerWithId(answers: readonly unknown[], id: number): unknown {
  return answers.find((answer) => typeof answer === 'object' && answer !== null && 'id' in answer && answer.id === id);
}

function lineOf(message: object): string {
  return `${JSON.stringify(message)}\n`;
}

async function answered(relay: Readonly<RuntimeCommandRun>, count: number): Promise<readonly unknown[]> {
  await until(() => {
    expect(answersIn(relay.stdout())).toHaveLength(count);
  });
  return answersIn(relay.stdout());
}

function readiesIn(text: string): number {
  return text.split('Press Ctrl+C to stop.').length - 1;
}

function markedAsRestartingBy(home: string, pid: number): void {
  mkdirSync(join(home, '.auto-runtime'), { recursive: true });
  writeFileSync(join(home, '.auto-runtime', 'restart-mark.json'), JSON.stringify({ pid, at: Date.now() }));
}

async function leftAfterItsAgentLeft(relay: Readonly<RuntimeCommandRun>): Promise<unknown> {
  relay.write(lineOf(initialize));
  await answered(relay, 1);
  relay.end();
  return relay.exited;
}

describe('an agent that starts auto-runtime mcp', () => {
  it('starts a runtime in the background, past a restart mark whose process is gone, reaches it, and leaves it running outside its own process group, through the kill of that group and the agents that leave, until it is stopped, and starts one again once it was', async () => {
    const home = homeOfTheTest(homePrefix);
    const port = await aPortNothingListensOn();
    const runtimes = runtimeOnThePortEndedWithTheTest(home, port);
    markedAsRestartingBy(home, spawnSync(process.execPath, ['-e', '']).pid);
    const starting = spawnRuntimeCommand(['mcp'], { home, port, inAGroupOfItsOwn: true });
    const pid = await runtimes.pid();

    starting.write(lineOf(initialize));
    await answered(starting, 1);
    starting.write(lineOf({ jsonrpc: '2.0', method: 'notifications/initialized' }));
    starting.write(lineOf({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }));
    starting.write(
      lineOf({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_models', arguments: {} } }),
    );
    const answers = await answered(starting, 3);
    starting.killGroup();
    await starting.exited;
    const afterTheKill = await ranToEnd(['status'], { home, port });
    const left = await leftAfterItsAgentLeft(spawnRuntimeCommand(['mcp'], { home, port }));
    const afterTheAgentLeft = await ranToEnd(['status'], { home, port });
    const stopped = await ranToEnd(['stop'], { home, port });
    const startingAgain = spawnRuntimeCommand(['mcp'], { home, port });
    const startedAgain = await runtimes.pid();
    const leftAgain = await leftAfterItsAgentLeft(startingAgain);
    const afterItsStarterLeft = await ranToEnd(['status'], { home, port });

    const [initialized, listed, models] = [1, 2, 3].map((id) => answerWithId(answers, id));
    expect(initialized).toMatchObject({ id: 1, result: { serverInfo: { title: 'Auto Runtime' } } });
    expect(JSON.stringify(listed)).toContain('"name":"list_playbooks"');
    expect(JSON.stringify(models)).toContain(`ANTHROPIC_API_KEY=<their key> in ${join(home, '.auto-runtime', '.env')}`);
    expect(afterTheKill.code).toBe(0);
    expect(afterTheKill.stdout).toContain(`Process    ${pid}`);
    expect(afterTheKill.stdout).toContain('by your agent');
    expect(afterTheKill.stdout).toContain(`Directory  ${join(home, '.auto-runtime')}`);
    expect(left).toBe(0);
    expect(afterTheAgentLeft.stdout).toContain(`Process    ${pid}`);
    expect(stopped).toEqual({ code: 0, stdout: 'Auto Runtime has stopped\n' });
    expect(startedAgain).not.toBe(pid);
    expect(leftAgain).toBe(0);
    expect(afterItsStarterLeft.stdout).toContain('by your agent');
    expect(afterItsStarterLeft.stdout).toContain(`Process    ${startedAgain}`);
    expect(await ranToEnd(['stop'], { home, port })).toEqual({ code: 0, stdout: 'Auto Runtime has stopped\n' });
  });
});

describe('an agent whose runtime restarts', () => {
  it('has a request it sends while the runtime is down sent again once the runtime is back', async () => {
    const { home, port } = await placeOfTheTest();
    const runtime = spawnRuntimeCommand([], { home, port });
    await until(() => {
      expect(readiesIn(runtime.stdout())).toBe(1);
    });
    const relay = spawnRuntimeCommand(['mcp'], { home, port });
    relay.write(lineOf(initialize));
    await answered(relay, 1);
    relay.write(lineOf({ jsonrpc: '2.0', method: 'notifications/initialized' }));

    await fetch(`http://127.0.0.1:${port}/runtime/restart`, { method: 'POST' });
    await until(async () => {
      await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow('fetch failed');
    });
    relay.write(lineOf({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }));
    const answers = await answered(relay, 2);
    relay.end();

    expect(JSON.stringify(answerWithId(answers, 2))).toContain('"name":"list_playbooks"');
    expect(await relay.exited).toBe(0);
  });
});

describe('an agent whose runtime was stopped', () => {
  it('has a runtime started again once the grace for the one it heard passed, and its request sent to it', async () => {
    const home = homeOfTheTest(homePrefix);
    const port = await aPortNothingListensOn();
    const runtimes = runtimeOnThePortEndedWithTheTest(home, port);
    const relay = spawnRuntimeCommand(['mcp'], { home, port });
    const first = await runtimes.pid();
    relay.write(lineOf(initialize));
    await answered(relay, 1);
    relay.write(lineOf({ jsonrpc: '2.0', method: 'notifications/initialized' }));
    const stopped = await ranToEnd(['stop'], { home, port });

    relay.write(lineOf({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }));
    const answers = await answered(relay, 2);
    const second = await runtimes.pid();
    relay.end();

    expect(stopped).toEqual({ code: 0, stdout: 'Auto Runtime has stopped\n' });
    expect(JSON.stringify(answerWithId(answers, 2))).toContain('"name":"list_playbooks"');
    expect(second).not.toBe(first);
    expect(await relay.exited).toBe(0);
  });
});

describe('an agent that starts while a runtime restarts', () => {
  it('waits for that runtime to come back instead of starting a second one', async () => {
    const { home, port } = await placeOfTheTest();
    markedAsRestartingBy(home, process.pid);
    const relay = spawnRuntimeCommand(['mcp'], { home, port });
    relay.write(lineOf(initialize));

    const runtime = spawnRuntimeCommand([], { home, port });
    await answered(relay, 1);
    relay.end();
    const status = await ranToEnd(['status'], { home, port });
    runtime.interrupt();

    expect(status.stdout).toContain('in a terminal');
    expect(existsSync(join(home, '.auto-runtime', 'runtime.log'))).toBe(false);
    expect([await relay.exited, await runtime.exited]).toEqual([0, 0]);
  });
});

describe('an agent whose runtime port another program holds', () => {
  it('is told why it cannot reach the runtime, and has its request answered once with what to do', async () => {
    const { home, port } = await placeOfTheTest();
    const other = createServer((_request, response) => {
      response.end('hello');
    }).listen(port, '127.0.0.1');
    onTestFinished(() => {
      other.close();
    });
    const relay = spawnRuntimeCommand(['mcp'], { home, port });

    relay.write(lineOf(initialize));
    const answers = await answered(relay, 1);
    relay.end();

    expect(answers).toEqual([
      {
        jsonrpc: '2.0',
        id: 1,
        error: {
          code: -32_603,
          message: `Another program answers on port ${port}; set PORT to start Auto Runtime on a free port`,
        },
      },
    ]);
    expect(relay.stderr()).toContain(
      `Another program answers on port ${port}; set PORT to start Auto Runtime on a free port\n`,
    );
    expect(await relay.exited).toBe(0);
  });
});

describe('the end of the runtime of a test by its port', () => {
  it('leaves alone a runtime of another home that answers on that port once the test finished', async () => {
    const elsewhere = homeOfTheTest(homePrefix);
    const port = await aPortNothingListensOn();
    const another = spawnRuntimeCommand([], { home: elsewhere, port });
    await until(() => {
      expect(readiesIn(another.stdout())).toBe(1);
    });
    onTestFinished(async () => {
      expect(await statusAt(port)).toEqual({ pid: another.pid, directory: elsewhere });
    });
    runtimeOnThePortEndedWithTheTest(homeOfTheTest(homePrefix), port);

    expect(await statusAt(port)).toEqual({ pid: another.pid, directory: elsewhere });
  });
});
