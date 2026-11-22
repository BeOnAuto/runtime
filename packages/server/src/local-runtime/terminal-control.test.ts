import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { aPortNothingListensOn } from '../testing/processes/free-port.ts';
import { homeOfTheTest, spawnRuntimeCommand } from '../testing/processes/runtime-command.ts';
import { aLedgerOfAnEarlierVersionAt } from '../testing/records/a-ledger-of-another-version.ts';
import { whenHeld } from '../testing/waiting/until.ts';

const homePrefix = 'auto-runtime-terminal-';

const statusOf = Schema.decodeUnknownSync(
  Schema.Struct({
    pid: Schema.Number,
    instance: Schema.String,
    started_at: Schema.String,
    started_by: Schema.String,
    directory: Schema.String,
  }),
);

async function statusAt(port: number): Promise<ReturnType<typeof statusOf>> {
  return statusOf(await (await fetch(`http://127.0.0.1:${port}/runtime`)).json());
}

function readiesIn(text: string): number {
  return text.split('Press Ctrl+C to stop.').length - 1;
}

/*
 * Processes, since what they show is the entry's own: a restart in the same process, and the notice of a failed start
 * written plain to a file that is the process's stderr, with its exit code. The notice's words, and that a server the
 * command starts with keys offers no control and asks for a credential, are rules, proven in process in
 * failure-notice.test.ts and controlled-server.test.ts.
 */
describe('a runtime started in a terminal', () => {
  it('restarts in the same process when asked, and stops when asked', async () => {
    const home = homeOfTheTest(homePrefix);
    const port = await aPortNothingListensOn();
    const runtime = spawnRuntimeCommand([], { home, port });
    await whenHeld(() => {
      expect(readiesIn(runtime.stdout())).toBe(1);
    });
    const before = await statusAt(port);

    await fetch(`http://127.0.0.1:${port}/runtime/restart`, { method: 'POST' });
    await whenHeld(() => {
      expect(readiesIn(runtime.stdout())).toBe(2);
    });
    const after = await statusAt(port);
    await fetch(`http://127.0.0.1:${port}/runtime/stop`, { method: 'POST' });

    expect(before).toMatchObject({ pid: runtime.pid, started_by: 'terminal', directory: home });
    expect(before.instance).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[\da-f]{4}-[\da-f]{12}$/u);
    expect(after.pid).toBe(runtime.pid);
    expect(after.started_at).not.toBe(before.started_at);
    expect(existsSync(join(home, '.auto-runtime', 'restart-mark.json'))).toBe(false);
    expect(await runtime.exited).toBe(0);
  });
});

async function aHomeWithALedgerOfAnotherVersion(): Promise<{ readonly home: string; readonly ledger: string }> {
  const home = homeOfTheTest(homePrefix);
  const ledger = join(home, '.auto-runtime', 'ledger.db');
  mkdirSync(join(home, '.auto-runtime'));
  await aLedgerOfAnEarlierVersionAt(ledger);
  return { home, ledger };
}

describe('a runtime started in a terminal on a ledger made by another version', () => {
  it('writes the notice into a file that stderr is sent to with no color or link code', async () => {
    const { home, ledger } = await aHomeWithALedgerOfAnotherVersion();
    const written = join(home, 'stderr.txt');

    const runtime = spawnRuntimeCommand([], { home, port: await aPortNothingListensOn(), stderrInto: written });
    const exitCode = await runtime.exited;
    const notice = readFileSync(written, 'utf8');

    expect(exitCode).toBe(1);
    expect(notice).toContain('  ✖ Auto Runtime could not start\n\n');
    expect(notice).toContain(`\n      rm -f ${ledger} ${ledger}-wal ${ledger}-shm\n`);
    expect(notice).not.toContain('\u001B');
  });
});
