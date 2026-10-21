import { describe, expect, it } from 'vitest';

import type { RuntimeFetch } from '../local-runtime/runtime-probe.ts';
import { throughARestart } from '../local-runtime/runtime-restarts.ts';
import { computerWith, startedForAnAgent, startingOn, type Computer } from '../testing/relays/fake-starting.ts';
import { impatient, runningRuntime } from './background-start.ts';

function refusingToStop(fetch: RuntimeFetch): RuntimeFetch {
  return (address, request) =>
    request.method === 'POST' ? Promise.reject(new TypeError('fetch failed')) : fetch(address, request);
}

function stayingUp(computer: Computer): RuntimeFetch {
  return (address, { method }) => {
    if (method === 'POST') {
      computer.record(`asked ${address.slice(address.lastIndexOf('/') + 1)}`);
      return Promise.resolve(Response.json({ status: 'stopping' }, { status: 202 }));
    }
    return Promise.resolve(Response.json(computer.answering()));
  };
}

describe('making sure the runtime runs before an agent talks to it', () => {
  it('leaves a runtime that already runs alone', async () => {
    const computer = computerWith(startedForAnAgent);

    await expect(runningRuntime(5555, startingOn(computer), impatient)).resolves.toBeUndefined();
    expect(computer.events()).toEqual([]);
  });

  it('starts one in the background when none runs, holding the lock while it starts', async () => {
    const computer = computerWith();

    await expect(runningRuntime(5555, startingOn(computer), impatient)).resolves.toBeUndefined();
    expect(computer.events()).toEqual(['locked', 'started', 'unlocked']);
  });

  it('waits for the one another agent is starting instead of starting a second', async () => {
    const computer = computerWith();

    await expect(
      runningRuntime(5555, startingOn(computer, { lockTaken: true, comesBackAfter: 3 }), impatient),
    ).resolves.toBeUndefined();
    expect(computer.events()).toEqual(['locked']);
  });

  it('says where its log is when the one it starts does not answer within the wait for a start', async () => {
    const computer = computerWith();

    await expect(runningRuntime(5555, startingOn(computer, { startsAs: undefined }), impatient)).resolves.toEqual({
      words:
        'Auto Runtime did not answer on port 5555 within 60 s of its start; its log is /Users/ada/.auto-runtime/runtime.log',
    });
    expect(computer.events()).toEqual(['locked', 'started', 'unlocked']);
  });
});

describe('the runtime an agent finds on the port', () => {
  it('waits for a runtime that is restarting before it starts another', async () => {
    const computer = computerWith();

    await expect(
      runningRuntime(5555, startingOn(computer, { comesBackAfter: 5 }), throughARestart),
    ).resolves.toBeUndefined();
    expect(computer.events()).toEqual([]);
  });

  it('waits through a restart a runtime marked, as long as a restart can take, without taking the lock', async () => {
    const computer = computerWith();
    const starting = startingOn(computer, { restarting: true, comesBackAfter: throughARestart.attempts - 1 });

    await expect(runningRuntime(5555, starting, impatient)).resolves.toBeUndefined();
    expect(computer.events()).toEqual([]);
  });

  it('connects to a runtime that runs without the controls of the auto-runtime command', async () => {
    const computer = computerWith({ status: 'ok' });

    await expect(runningRuntime(5555, startingOn(computer), impatient)).resolves.toBeUndefined();
    expect(computer.events()).toEqual([]);
  });

  it('says another program holds the port', async () => {
    const computer = computerWith({ hello: 'world' });

    await expect(runningRuntime(3000, startingOn(computer), impatient)).resolves.toEqual({
      words: 'Another program answers on port 3000; set PORT to start Auto Runtime on a free port',
    });
  });
});

describe('a newer release of the runtime for an agent', () => {
  it('replaces the older one an agent started', async () => {
    const computer = computerWith(startedForAnAgent);

    await expect(runningRuntime(5555, startingOn(computer, { version: '0.10.0' }), impatient)).resolves.toBeUndefined();
    expect(computer.events()).toEqual(['asked stop', 'locked', 'started', 'unlocked']);
  });

  it('leaves one started in a terminal alone', async () => {
    const computer = computerWith({ ...startedForAnAgent, started_by: 'terminal' });

    await runningRuntime(5555, startingOn(computer, { version: '0.10.0' }), impatient);

    expect(computer.events()).toEqual([]);
  });

  it('never replaces a newer one with an older one', async () => {
    const computer = computerWith(startedForAnAgent);

    await runningRuntime(5555, startingOn(computer, { version: '0.8.2' }), impatient);

    expect(computer.events()).toEqual([]);
  });

  it('says so when the older one does not stop', async () => {
    const computer = computerWith(startedForAnAgent);
    const starting = startingOn(computer, { version: '0.10.0' });

    await expect(
      runningRuntime(5555, { ...starting, fetch: refusingToStop(starting.fetch) }, impatient),
    ).resolves.toEqual({
      words: 'Auto Runtime 0.9.1 on port 5555 did not stop, so Auto Runtime 0.10.0 could not replace it',
    });
    expect(computer.events()).toEqual([]);
  });

  it('says so when the older one does not go down once asked to stop', async () => {
    const computer = computerWith(startedForAnAgent);
    const starting = startingOn(computer, { version: '0.10.0' });

    await expect(runningRuntime(5555, { ...starting, fetch: stayingUp(computer) }, impatient)).resolves.toEqual({
      words: 'Auto Runtime 0.9.1 on port 5555 did not stop, so Auto Runtime 0.10.0 could not replace it',
    });
    expect(computer.events()).toEqual(['asked stop']);
  });
});

describe('a newer release of the runtime for an agent, while the older one has runs in flight', () => {
  it('leaves the older one running, relays to it, and says that it waits for it to be idle', async () => {
    const computer = computerWith({ ...startedForAnAgent, runs_in_flight: 2 });

    await expect(runningRuntime(5555, startingOn(computer, { version: '0.10.0' }), impatient)).resolves.toBeUndefined();
    expect(computer.events()).toEqual([
      'noticed Auto Runtime 0.10.0 waits for Auto Runtime 0.9.1 on port 5555 to be idle before it replaces it, and relays to 0.9.1 until then',
    ]);
  });
});
