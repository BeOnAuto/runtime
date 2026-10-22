import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { endWithTheTest, spawnForTheTest } from '@on.auto/operations/testing';
import { Function } from 'effect';
import { describe, expect, it } from 'vitest';

import { loggedTo, startInBackgroundOf } from '../../background-start/background-process.ts';
import { logFileIn, runtimeHomeIn } from '../../local-runtime/local-control.ts';
import { until } from '../waiting/until.ts';
import theFolderOfTheServersTestRun from './test-run-folder.ts';

const stayingEntry = join(import.meta.dirname, '../entries/stay-until-signalled.ts');

const run = { name: 'probe' };

const anInstanceThatEnded = '5c8e2a0f-3d14-4b6e-9a7c-1f2b3c4d5e6f';

const anInstanceNoProcessRunsAs = '9d0c1b2a-4e3f-4a5b-8c6d-7e8f9a0b1c2d';

const leftWords = 'The tests of the run did not remove what they left in its temporary folder:';

function aHomeLeftIn(folder: string): string {
  return realpathSync(mkdtempSync(join(folder, 'auto-runtime-left-')));
}

describe("the teardown of the temporary folder of a run of the server's tests", () => {
  it('ends a runtime a test left running in the background in a home it left there, and names the runtime with the home', async () => {
    const teardown = theFolderOfTheServersTestRun(run);
    const home = aHomeLeftIn(tmpdir());
    const started = startInBackgroundOf({
      execPath: process.execPath,
      execArgv: [],
      entry: stayingEntry,
      home,
      environment: { PATH: process.env['PATH'], NODE_V8_COVERAGE: process.env['NODE_V8_COVERAGE'] },
      report: Function.constVoid,
      log: loggedTo(home, Function.constVoid),
    })();
    const pid = Number(started.pid);
    endWithTheTest(pid);
    await until(() => existsSync(join(runtimeHomeIn(home), 'started.json')), Boolean);

    await expect(teardown()).rejects.toThrow(
      new Error(
        `${leftWords} ${basename(home)}. The teardown ended Auto Runtime, process ${pid}, instance ${started.instance}, which still ran in ${basename(home)}.`,
      ),
    );
    await started.ended;

    expect(started.endedAt()).toBeGreaterThanOrEqual(started.startedAt);
  });

  it('signals no process that a log names as ended, or that runs as another than the instance it names, and names what was left alone', async () => {
    const another = spawnForTheTest(process.execPath, ['--eval', 'setInterval(() => {}, 1000);']);
    const teardown = theFolderOfTheServersTestRun(run);
    const home = aHomeLeftIn(tmpdir());
    mkdirSync(runtimeHomeIn(home));
    writeFileSync(
      logFileIn(home),
      [
        `Auto Runtime was started in the background as process ${process.pid}, instance ${anInstanceThatEnded}`,
        `Auto Runtime, process ${process.pid}, ended`,
        `Auto Runtime was started in the background as process ${Number(another.pid)}, instance ${anInstanceNoProcessRunsAs}`,
      ].join('\n'),
    );
    writeFileSync(join(tmpdir(), 'a-file-left'), '');

    await expect(teardown()).rejects.toThrow(new Error(`${leftWords} a-file-left, ${basename(home)}.`));

    expect([another.exitCode, another.signalCode]).toEqual([null, null]);
  });
});
