import { createServer } from 'node:http';

import { createApiKey } from '@on.auto/identity';
import { Function } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { ranToEnd, spawnRuntimeCommand } from '../testing/processes/runtime-command.ts';
import {
  answered,
  answerWithId,
  initializedLine,
  initializeLine,
  lineOf,
  placeOfTheTest,
  readiesIn,
} from '../testing/relays/relayed-processes.ts';
import { until } from '../testing/waiting/until.ts';
import { processesOfThisComputer } from './background-process.ts';
import { restartWaitMs } from './background-start.ts';

const homePrefix = 'auto-runtime-recovery-';

const listPlaybooks = {
  jsonrpc: '2.0',
  id: 2,
  method: 'tools/call',
  params: { name: 'list_playbooks', arguments: {} },
};

const listTools = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} };

describe('an agent whose runtime in a terminal is stopped', () => {
  it('has its next tool call answered by a runtime the relay starts, without waiting as long as a restart can take', async () => {
    const { home, port } = await placeOfTheTest(homePrefix);
    const terminal = spawnRuntimeCommand([], { home, port });
    await until(() => {
      expect(readiesIn(terminal.stdout())).toBe(1);
    });
    const relay = spawnRuntimeCommand(['mcp'], { home, port });
    relay.write(lineOf(initializeLine));
    await answered(relay, 1);
    relay.write(lineOf(initializedLine));
    terminal.interrupt();
    await terminal.exited;

    const asked = performance.now();
    relay.write(lineOf(listPlaybooks));
    const answers = await answered(relay, 2);
    const tookMs = performance.now() - asked;
    const status = await ranToEnd(['status'], { home, port });
    relay.end();

    expect(answerWithId(answers, 2)).toMatchObject({ id: 2, result: { structuredContent: { playbooks: [] } } });
    expect(tookMs).toBeLessThan(restartWaitMs);
    expect(status.stdout).toContain('by your agent');
    expect(await relay.exited).toBe(0);
  });
});

describe('an agent whose runtime, which it started, stops answering', () => {
  it('has the runtime stopped and another started, and its request answered by that one', async () => {
    const { home, port, runtimes } = await placeOfTheTest(homePrefix);
    const relay = spawnRuntimeCommand(['mcp'], { home, port });
    relay.write(lineOf(initializeLine));
    await answered(relay, 1);
    relay.write(lineOf(initializedLine));
    const frozen = await runtimes.pid();
    onTestFinished(() => {
      processesOfThisComputer.signal(frozen, 'SIGKILL');
    });
    process.kill(frozen, 'SIGSTOP');

    relay.write(lineOf(listTools));
    const answers = await answered(relay, 2);
    const replacing = await runtimes.pid();
    relay.end();

    expect(JSON.stringify(answerWithId(answers, 2))).toContain('"name":"list_playbooks"');
    expect(replacing).not.toBe(frozen);
    expect(relay.stderr()).toContain(`process ${frozen}, did not answer, so it was stopped and another started`);
    expect(await relay.exited).toBe(0);
  });
});

describe('an agent whose runtime port a program holds that never answers', () => {
  it('is told so, and that it can stop that program or set PORT, and nothing is started', async () => {
    const { home, port } = await placeOfTheTest(homePrefix);
    const silent = createServer(Function.constVoid).listen(port, '127.0.0.1');
    onTestFinished(() => {
      silent.closeAllConnections();
      silent.close();
    });
    const relay = spawnRuntimeCommand(['mcp'], { home, port });

    relay.write(lineOf(initializeLine));
    const answers = await answered(relay, 1);
    relay.end();

    expect(answers).toEqual([
      {
        jsonrpc: '2.0',
        id: 1,
        error: {
          code: -32_603,
          message: `The program on port ${port} does not answer; stop it, or set PORT to a free port, and this MCP entry starts Auto Runtime`,
        },
      },
    ]);
    expect(await relay.exited).toBe(0);
  });
});

describe('an agent whose runtime asks for a credential', () => {
  it('is told that this entry sends none, and how to reach it instead', async () => {
    const { home, port } = await placeOfTheTest(homePrefix);
    const { entry } = createApiKey({ id: 'ci-1', org: 'acme', permissions: ['org:read'], playbooks: '*' });
    const guarded = spawnRuntimeCommand([], {
      home,
      port,
      settings: { HOST: '0.0.0.0', API_KEYS: JSON.stringify([entry]) },
    });
    await until(() => {
      expect(readiesIn(guarded.stdout())).toBe(1);
    });
    const relay = spawnRuntimeCommand(['mcp'], { home, port });

    relay.write(lineOf(initializeLine));
    const answers = await answered(relay, 1);
    relay.end();
    guarded.interrupt();

    expect(answers).toEqual([
      {
        jsonrpc: '2.0',
        id: 1,
        error: {
          code: -32_603,
          message: `Auto Runtime on port ${port} asks for a credential, which this MCP entry does not send; stop it, and this entry starts one, or connect your agent to http://localhost:${port}/mcp over HTTP`,
        },
      },
    ]);
    expect([await relay.exited, await guarded.exited]).toEqual([0, 0]);
  });
});
