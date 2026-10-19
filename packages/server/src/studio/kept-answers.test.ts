import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, onTestFinished } from 'vitest';

import { keptAnswersIn, markerName, type KeptAnswer, type KeptAnswers } from './kept-answers.ts';

interface Reported {
  readonly problems: readonly string[];
  readonly report: (problem: string) => void;
}

function aFolder(): string {
  const folder = mkdtempSync(join(tmpdir(), 'auto-runtime-studio-'));
  onTestFinished(() => {
    chmodSync(folder, 0o700);
    rmSync(folder, { recursive: true, force: true });
  });
  return folder;
}

function reporting(): Reported {
  const problems: string[] = [];
  return {
    problems,
    report: (problem) => {
      problems.push(problem);
    },
  };
}

function answerAt(key: string, text: string, keptAt = 1): KeptAnswer {
  return {
    key,
    contentType: 'text/javascript',
    etag: '"e1"',
    lastModified: undefined,
    keptAt,
    freshUntil: keptAt + 60_000,
    body: new TextEncoder().encode(text),
  };
}

function sha256Of(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function headedFile(key: string, sha256: string): string {
  return `${JSON.stringify({ key, keptAt: 1, freshUntil: 2, sha256 })}\nexport {};`;
}

function keptAtOf(answers: KeptAnswers, keys: readonly string[]): Promise<readonly (number | undefined)[]> {
  return Promise.all(keys.map(async (key) => (await answers.answerAt(key))?.keptAt));
}

const script = 'https://studio.example.com/assets/index-4f2a9c.js';

describe('the answers of the Studio host a runtime keeps', () => {
  it('are kept in memory and in a folder it makes, marked as its own, which only its owner may read, where another runtime finds them', async () => {
    const folder = join(aFolder(), 'auto-runtime-studio');
    const { problems, report } = reporting();
    const kept = answerAt(script, 'export {};');

    await keptAnswersIn(folder, { mostBytes: 1024, report }).keep(kept);

    expect(await keptAnswersIn(folder, { mostBytes: 1024, report }).answerAt(script)).toEqual(kept);
    expect(readdirSync(folder).toSorted()).toEqual([markerName, sha256Of(script)].toSorted());
    expect([statSync(folder).mode & 0o777, statSync(join(folder, sha256Of(script))).mode & 0o777]).toEqual([
      0o700, 0o600,
    ]);
    expect(problems).toEqual([]);
  });

  it('are kept in memory alone where the runtime has no folder for them', async () => {
    const { report } = reporting();
    const answers = keptAnswersIn(undefined, { mostBytes: 1024, report });

    await answers.keep(answerAt('https://studio.example.com/', '<p>page</p>'));

    expect([
      (await answers.answerAt('https://studio.example.com/'))?.key,
      await keptAnswersIn(undefined, { mostBytes: 1024, report }).answerAt('https://studio.example.com/'),
    ]).toEqual(['https://studio.example.com/', undefined]);
  });
});

describe('the bound of the answers a runtime keeps', () => {
  it('lets the oldest leave first once they hold more bytes than it, from memory and from disk', async () => {
    const folder = join(aFolder(), 'auto-runtime-studio');
    const { report } = reporting();
    const answers = keptAnswersIn(folder, { mostBytes: 10, report });

    await answers.keep(answerAt('/a.js', 'aaaa', 1));
    await answers.keep(answerAt('/b.js', 'bbbb', 2));
    await answers.keep(answerAt('/a.js', 'AAAA', 3));
    await answers.keep(answerAt('/c.js', 'cccc', 4));

    const keys = ['/a.js', '/b.js', '/c.js'];
    expect(await keptAtOf(answers, keys)).toEqual([3, undefined, 4]);
    expect(await keptAtOf(keptAnswersIn(folder, { mostBytes: 10, report }), keys)).toEqual([3, undefined, 4]);
    expect(readdirSync(folder).toSorted()).toEqual([markerName, sha256Of('/a.js'), sha256Of('/c.js')].toSorted());
  });

  it('holds for the answers read again from disk, the oldest leaving first', async () => {
    const folder = join(aFolder(), 'auto-runtime-studio');
    const { report } = reporting();
    const generous = keptAnswersIn(folder, { mostBytes: 1024, report });
    await generous.keep(answerAt('/a.js', 'aaaa', 1));
    await generous.keep(answerAt('/b.js', 'bbbb', 2));

    expect(await keptAtOf(keptAnswersIn(folder, { mostBytes: 4, report }), ['/a.js', '/b.js'])).toEqual([undefined, 2]);
    expect(readdirSync(folder).toSorted()).toEqual([markerName, sha256Of('/b.js')].toSorted());
  });
});

describe('what a runtime finds in the folder it made', () => {
  it('is removed, a regular file at a time, when it is a file the runtime writes that is not an answer kept whole', async () => {
    const folder = join(aFolder(), 'auto-runtime-studio');
    const { problems, report } = reporting();
    await keptAnswersIn(folder, { mostBytes: 1024, report }).keep(answerAt(script, 'export {};'));
    writeFileSync(join(folder, '.0f3e2d1c-4b5a-4c6d-8e7f-9a0b1c2d3e4f'), 'partial');
    writeFileSync(join(folder, sha256Of('/garbled.js')), 'no head at all');
    writeFileSync(join(folder, sha256Of('/altered.js')), headedFile('/altered.js', sha256Of('another body')));
    writeFileSync(join(folder, sha256Of('/moved.js')), headedFile('/elsewhere.js', sha256Of('export {};')));

    const answers = keptAnswersIn(folder, { mostBytes: 1024, report });
    const found = await Promise.all(
      [script, '/garbled.js', '/altered.js', '/moved.js', '/elsewhere.js'].map(
        async (key) => (await answers.answerAt(key))?.key,
      ),
    );

    expect(found).toEqual([script, undefined, undefined, undefined, undefined]);
    expect(readdirSync(folder).toSorted()).toEqual([markerName, sha256Of(script)].toSorted());
    expect(problems).toEqual([]);
  });
});

const notTheRuntimes: ReadonlyArray<readonly [string, (folder: string) => void, string]> = [
  [
    'a file the runtime did not write',
    (folder) => {
      writeFileSync(join(folder, markerName), '');
      writeFileSync(join(folder, 'notes.txt'), 'the notes of the operator');
    },
    'holds notes.txt, which Auto Runtime did not write there',
  ],
  [
    'a folder under a name the runtime writes',
    (folder) => {
      writeFileSync(join(folder, markerName), '');
      mkdirSync(join(folder, sha256Of('/folder.js')));
    },
    `holds ${sha256Of('/folder.js')}, which Auto Runtime did not write there`,
  ],
  [
    'no mark of the runtime',
    (folder) => {
      writeFileSync(join(folder, sha256Of('/a.js')), headedFile('/a.js', sha256Of('export {};')));
    },
    `holds no ${markerName}, which Auto Runtime writes in the folders it makes`,
  ],
];

describe('a folder the runtime finds that is not all its own', () => {
  it.each(notTheRuntimes)(
    'is left as it is when it holds %s, and the answers are kept in memory alone, saying why',
    async (_case, fill, why) => {
      const folder = join(aFolder(), 'auto-runtime-studio');
      mkdirSync(folder, { mode: 0o700 });
      fill(folder);
      const before = readdirSync(folder).toSorted();
      const { problems, report } = reporting();
      const answers = keptAnswersIn(folder, { mostBytes: 1024, report });

      await answers.keep(answerAt(script, 'export {};'));

      expect([(await answers.answerAt(script))?.key, readdirSync(folder).toSorted()]).toEqual([script, before]);
      expect(problems).toEqual([`the folder ${folder} ${why}`]);
    },
  );
});

describe('a folder the runtime cannot trust or use', () => {
  it('keeps the answers in memory alone when other users may write to it, saying why', async () => {
    const folder = join(aFolder(), 'auto-runtime-studio');
    mkdirSync(folder);
    chmodSync(folder, 0o777);
    const { problems, report } = reporting();
    const answers = keptAnswersIn(folder, { mostBytes: 1024, report });

    await answers.keep(answerAt(script, 'export {};'));

    expect([(await answers.answerAt(script))?.key, readdirSync(folder)]).toEqual([script, []]);
    expect(problems).toEqual([`the folder ${folder} may be written by users other than its owner`]);
  });

  it('keeps the answers in memory alone when it cannot be made, or a file in it cannot be read, saying why', async () => {
    const parent = aFolder();
    writeFileSync(join(parent, 'a-file'), 'not a folder');
    const unreadable = join(aFolder(), 'auto-runtime-studio');
    await keptAnswersIn(unreadable, { mostBytes: 1024, report: reporting().report }).keep(
      answerAt(script, 'export {};'),
    );
    chmodSync(join(unreadable, sha256Of(script)), 0o000);
    const { problems, report } = reporting();

    const unmade = keptAnswersIn(join(parent, 'a-file', 'auto-runtime-studio'), { mostBytes: 4, report });
    await unmade.keep(answerAt('/a.js', 'aaaa', 1));
    await unmade.keep(answerAt('/b.js', 'bbbb', 2));
    const unread = await keptAnswersIn(unreadable, { mostBytes: 1024, report }).answerAt(script);

    expect([await keptAtOf(unmade, ['/a.js', '/b.js']), unread]).toEqual([[undefined, 2], undefined]);
    expect(problems[0]).toBe(`the folder ${join(parent, 'a-file', 'auto-runtime-studio')} could not be made`);
    expect(problems[1]).toMatch(`the folder ${unreadable} could not be read: Error: EACCES`);
    expect(problems).toHaveLength(2);
  });
});
