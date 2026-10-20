import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { createApiKey } from '@on.auto/identity';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { aPortNothingListensOn } from '../testing/processes/free-port.ts';
import { homeOfTheTest, spawnRuntimeCommand } from '../testing/processes/runtime-command.ts';
import { aLedgerOfAnotherVersionAt } from '../testing/records/ledger-of-another-version.ts';
import { until } from '../testing/waiting/until.ts';

const homePrefix = 'auto-runtime-terminal-';

const statusOf = Schema.decodeUnknownSync(
  Schema.Struct({ pid: Schema.Number, started_at: Schema.String, started_by: Schema.String, directory: Schema.String }),
);

async function statusAt(port: number): Promise<ReturnType<typeof statusOf>> {
  return statusOf(await (await fetch(`http://127.0.0.1:${port}/runtime`)).json());
}

function readiesIn(text: string): number {
  return text.split('Press Ctrl+C to stop.').length - 1;
}

describe('a runtime started in a terminal', () => {
  it('restarts in the same process when asked, and stops when asked', async () => {
    const home = homeOfTheTest(homePrefix);
    const port = await aPortNothingListensOn();
    const runtime = spawnRuntimeCommand([], { home, port });
    await until(() => {
      expect(readiesIn(runtime.stdout())).toBe(1);
    });
    const before = await statusAt(port);

    await fetch(`http://127.0.0.1:${port}/runtime/restart`, { method: 'POST' });
    await until(() => {
      expect(readiesIn(runtime.stdout())).toBe(2);
    });
    const after = await statusAt(port);
    await fetch(`http://127.0.0.1:${port}/runtime/stop`, { method: 'POST' });

    expect(before).toMatchObject({ pid: runtime.pid, started_by: 'terminal', directory: home });
    expect(after.pid).toBe(runtime.pid);
    expect(after.started_at).not.toBe(before.started_at);
    expect(existsSync(join(home, '.auto-runtime', 'restart-mark.json'))).toBe(false);
    expect(await runtime.exited).toBe(0);
  });

  it('offers no control, and asks for a credential there as anywhere, when it listens where other computers reach it', async () => {
    const home = homeOfTheTest(homePrefix);
    const port = await aPortNothingListensOn();
    const { entry } = createApiKey({ id: 'ci-1', org: 'acme', permissions: ['org:read'], playbooks: '*' });
    const runtime = spawnRuntimeCommand([], {
      home,
      port,
      settings: { HOST: '0.0.0.0', API_KEYS: JSON.stringify([entry]) },
    });
    await until(() => {
      expect(readiesIn(runtime.stdout())).toBe(1);
    });

    const answer = await fetch(`http://127.0.0.1:${port}/runtime`);
    runtime.interrupt();

    expect(answer.status).toBe(401);
    expect(await runtime.exited).toBe(0);
  });
});

describe('a runtime started in a terminal on a taken port', () => {
  it('says why it could not start, and exits', async () => {
    const home = homeOfTheTest(homePrefix);
    const port = await aPortNothingListensOn();
    const first = spawnRuntimeCommand([], { home, port });
    await until(() => {
      expect(readiesIn(first.stdout())).toBe(1);
    });

    const second = spawnRuntimeCommand([], { home, port });

    expect(await second.exited).toBe(1);
    expect(second.stderr()).toContain('Auto Runtime could not start');
  });
});

describe('a runtime started in a terminal on a ledger made by another version', () => {
  it('says on stderr, in a notice of its own, where the ledger is, what to do and where to ask, and exits', async () => {
    const home = homeOfTheTest(homePrefix);
    const ledger = join(home, '.auto-runtime', 'ledger.db');
    mkdirSync(join(home, '.auto-runtime'));
    aLedgerOfAnotherVersionAt(ledger);

    const runtime = spawnRuntimeCommand([], { home, port: await aPortNothingListensOn() });

    expect(await runtime.exited).toBe(1);
    expect(runtime.stderr()).toContain('  ✖ Auto Runtime could not start\n\n');
    expect(runtime.stderr()).toContain(`\n      rm -f ${ledger}{,-wal,-shm}\n`);
    expect(runtime.stderr()).toContain('\n  Need a hand? Ask us on Discord: https://discord.gg/B8BKcKMRm8\n');
  });
});
