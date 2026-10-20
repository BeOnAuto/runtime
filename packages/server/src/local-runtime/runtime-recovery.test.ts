import { describe, expect, it } from 'vitest';

import { longestStopMs } from '../lifecycle/shutdown.ts';
import { computerWith, startedForAnAgent, startingOn } from '../testing/relays/fake-computers.ts';
import { briefly, impatient, runningRuntime, throughARestart } from './background-start.ts';
import { probeEveryMs } from './runtime-probe.ts';

describe('making sure the runtime runs again for an agent whose request did not reach it', () => {
  it('waits a moment for it to come back, then starts one without waiting through a restart', async () => {
    const computer = computerWith();
    const starting = startingOn(computer);

    await expect(runningRuntime(5555, starting, briefly)).resolves.toBeUndefined();
    expect(computer.events()).toEqual(['locked', 'started', 'unlocked']);
    expect(starting.naps()).toBe(briefly.attempts);
  });

  it('takes the one that comes back within that moment', async () => {
    const computer = computerWith();

    await expect(runningRuntime(5555, startingOn(computer, { comesBackAfter: 4 }), briefly)).resolves.toBeUndefined();
    expect(computer.events()).toEqual([]);
  });

  it('waits through a restart a runtime marked, as long as a restart can take', async () => {
    const computer = computerWith();
    const starting = startingOn(computer, { restarting: true, comesBackAfter: throughARestart.attempts - 1 });

    await expect(runningRuntime(5555, starting, briefly)).resolves.toBeUndefined();
    expect(computer.events()).toEqual([]);
  });
});

describe('a runtime on the port that asks for a credential', () => {
  it('is not one this entry can reach, and is left running', async () => {
    const computer = computerWith('guards');

    await expect(runningRuntime(5555, startingOn(computer), briefly)).resolves.toBe(
      'Auto Runtime on port 5555 asks for a credential, which this MCP entry does not send; stop it, and this entry starts one, or connect your agent to http://localhost:5555/mcp over HTTP',
    );
    expect(computer.events()).toEqual([]);
  });
});

describe('a runtime on the port that does not answer', () => {
  it('is asked twice more, and taken when it answers', async () => {
    const computer = computerWith('hangs');
    const starting = startingOn(computer, { comesBackAfter: 1 });

    await expect(runningRuntime(5555, starting, briefly)).resolves.toBeUndefined();
    expect(computer.events()).toEqual([]);
  });

  it('is stopped and started again when an agent started it, as this relay saw it answer before', async () => {
    const computer = computerWith(startedForAnAgent);
    const starting = startingOn(computer);
    await runningRuntime(5555, starting, impatient);
    computer.answerWith('hangs');

    await expect(runningRuntime(5555, starting, briefly)).resolves.toBeUndefined();
    expect(computer.events()).toEqual([
      'noticed Auto Runtime 0.9.1 on port 5555, process 4242, did not answer, so it was stopped and another started',
      'SIGTERM 4242',
      'locked',
      'started',
      'unlocked',
    ]);
  });
});

describe('a runtime on the port that does not answer, which this relay started', () => {
  it('is killed when it outlives the time a stop can take, then started again', async () => {
    const computer = computerWith('hangs');
    const starting = startingOn(computer, { sawBefore: startedForAnAgent, outlivesSigterm: true });

    await expect(runningRuntime(5555, starting, briefly)).resolves.toBeUndefined();
    expect(computer.events().slice(1)).toEqual(['SIGTERM 4242', 'SIGKILL 4242', 'locked', 'started', 'unlocked']);
    expect(starting.naps()).toBeGreaterThanOrEqual(longestStopMs / probeEveryMs);
  });

  it('is remembered from the start of the one this relay started, to be stopped once it hangs', async () => {
    const computer = computerWith();
    const starting = startingOn(computer);
    await runningRuntime(5555, starting, impatient);
    computer.answerWith('hangs');

    await runningRuntime(5555, starting, briefly);

    expect(computer.events()).toEqual([
      'locked',
      'started',
      'unlocked',
      'noticed Auto Runtime 0.9.1 on port 5555, process 4242, did not answer, so it was stopped and another started',
      'SIGTERM 4242',
      'locked',
      'started',
      'unlocked',
    ]);
  });
});

describe('a runtime on the port that does not answer, which this relay did not start', () => {
  it('is left alone when it runs in a terminal, naming its process', async () => {
    const computer = computerWith('hangs');
    const starting = startingOn(computer, { sawBefore: { ...startedForAnAgent, started_by: 'terminal' } });

    await expect(runningRuntime(5555, starting, briefly)).resolves.toBe(
      'Auto Runtime on port 5555, which runs in a terminal as process 4242, does not answer; stop it there, and this MCP entry starts another',
    );
    expect(computer.events()).toEqual([]);
  });

  it('is left alone when this relay never saw it answer', async () => {
    const computer = computerWith('hangs');

    await expect(runningRuntime(5555, startingOn(computer), briefly)).resolves.toBe(
      'The program on port 5555 does not answer; stop it, or set PORT to a free port, and this MCP entry starts Auto Runtime',
    );
    expect(computer.events()).toEqual([]);
  });
});
