import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { reportedOnStderr } from '../background-start/agent-starting.ts';
import { restartMarkIn } from '../local-runtime/local-control.ts';
import { aGoneProcess } from '../testing/processes/awaited-children.ts';
import { runtimesStartedInTheBackgroundEndedWithTheTest } from '../testing/processes/background-runtimes.ts';
import { aPortNothingListensOn } from '../testing/processes/free-port.ts';
import { homeOfTheTest, spawnRuntimeCommand, type RuntimeCommandRun } from '../testing/processes/runtime-command.ts';
import { whenHeld } from '../testing/waiting/until.ts';

const homePrefix = 'auto-runtime-agent-';

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
  await whenHeld(() => {
    expect(answersIn(relay.stdout())).toHaveLength(count);
  });
  return answersIn(relay.stdout());
}

function markedAsRestartingBy(home: string, pid: number, port: number): void {
  restartMarkIn(home).leave(pid, port);
}

async function leftAfterItsAgentLeft(relay: Readonly<RuntimeCommandRun>): Promise<unknown> {
  relay.write(lineOf(initialize));
  await answered(relay, 1);
  relay.end();
  return relay.exited;
}

/** What the runtime on the port says of itself, as `auto-runtime status` reads it. */
async function statusOn(port: number): Promise<unknown> {
  return (await fetch(`http://127.0.0.1:${port}/runtime`)).json();
}

describe('an agent that starts auto-runtime mcp', () => {
  /*
   * The one case on processes, since only processes show it: a relay in a process group of its own is killed with its
   * group, and the runtime it started in the background outlives it, outside that group; the next relay an agent
   * starts reaches that runtime over the entry's stdio and exits 0 once its agent leaves. The test reads the runtime's
   * status over HTTP, as the status command does, rather than through a process of its own, and the test's end stops
   * the runtime. What a relay does when its agent leaves, starting a runtime when none runs and relaying to one that
   * does, restart marks, and stopping a runtime are rules, proven in process: mcp-relay.test.ts,
   * background-start.test.ts, local-control.test.ts and runtime-commands.test.ts.
   */
  it('starts a runtime in the background, past a restart mark whose process is gone, reaches it, and leaves it running outside its own process group through the kill of that group, for the next relay to reach', async () => {
    const home = homeOfTheTest(homePrefix);
    const port = await aPortNothingListensOn();
    const runtimes = runtimesStartedInTheBackgroundEndedWithTheTest(home);
    markedAsRestartingBy(home, aGoneProcess(), port);
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
    const afterTheKill = await statusOn(port);
    const left = await leftAfterItsAgentLeft(spawnRuntimeCommand(['mcp'], { home, port }));
    const afterTheAgentLeft = await statusOn(port);

    const [initialized, listed, models] = [1, 2, 3].map((id) => answerWithId(answers, id));
    expect(initialized).toMatchObject({ id: 1, result: { serverInfo: { title: 'Auto Runtime' } } });
    expect(JSON.stringify(listed)).toContain('"name":"list_playbooks"');
    expect(JSON.stringify(models)).toContain(`ANTHROPIC_API_KEY=<their key> in ${join(home, '.auto-runtime', '.env')}`);
    expect(afterTheKill).toMatchObject({ pid, started_by: 'agent', directory: join(home, '.auto-runtime') });
    expect(left).toBe(0);
    expect(afterTheAgentLeft).toMatchObject({ pid });
  });
});

describe('a report of a relay', () => {
  it('goes to stderr, a line of its own, since stdout carries what the relay says to its agent', () => {
    const written: unknown[] = [];
    const stderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((text: Readonly<Uint8Array> | string) => written.push(text) > 0);
    const stdout = vi.spyOn(process.stdout, 'write');
    try {
      reportedOnStderr('a report');
    } finally {
      stderr.mockRestore();
    }

    expect(written).toEqual(['a report\n']);
    expect(stdout).not.toHaveBeenCalled();
    stdout.mockRestore();
  });
});
