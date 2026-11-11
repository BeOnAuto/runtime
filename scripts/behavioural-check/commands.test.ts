import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import type { ServedSurface } from '@on.auto/api/testing';

import { runBehaviouralCheck, type Parts } from './commands.ts';
import { rowsIn } from './record.ts';

type Model = Parts['models'][number];

type Answer = Awaited<ReturnType<Parts['ask']>>;

type Brief = Parts['briefs']['briefs'][number];

const welcome = 'No playbooks yet. {origin}/studio/?server=%7Borigin%7D&src=agent';

const startGuide = '# Start\n\nBuild from the job.\n';

interface Serving {
  readonly guides?: readonly string[];
  readonly answered?: boolean;
  readonly own?: boolean;
}

function listed(name: string) {
  return { name, title: name, description: `The tool ${name}.`, inputSchema: { type: 'object' } };
}

function surfaceWith({
  guides = ['start', 'first-playbook'],
  answered = true,
  own = true,
}: Serving = {}): ServedSurface {
  return {
    connections: [
      {
        endpoint: own ? 'own org' : 'directory',
        path: own ? '/mcp' : '/directory',
        instructions: 'Read the guide start first.',
        listing: [listed('create_playbook'), listed('get_guide')],
        tools: [listed('create_playbook'), listed('get_guide')],
        prompts: [],
        guides: guides.map((name) => ({ name, text: name === 'start' ? startGuide : `# ${name}\n` })),
      },
    ],
    answers: answered ? [{ tool: 'list_playbooks', arguments: {}, path: '/mcp', text: welcome }] : [],
  };
}

const briefs: readonly Brief[] = [
  { id: 'J1', shape: 'J', business: 'a', held_out: false, search: false, text: 'Judge what I paste.' },
  { id: 'R1', shape: 'R', business: 'b', held_out: false, search: true, text: 'Read, total and write.' },
  { id: 'J2', shape: 'J', business: 'c', held_out: true, search: false, text: 'Mark what I paste.' },
];

const model: Model = { name: 'claude', command: ['claude', '-p'], prompt: 'stdin', version: ['claude', '--version'] };

const judgedPlan = '{"definitions":[{"type":"reasoning","tools":[]},{"type":"workflow","calls":["judge"]}]}';

interface Fakes {
  readonly parts: Parts;
  readonly asked: readonly string[];
  readonly printed: readonly string[];
  readonly folder: string;
}

function withFakes(
  answers: (prompt: string) => string,
  verify: (fakes: Fakes) => Promise<void>,
  surface: ServedSurface = surfaceWith(),
): Promise<void> {
  const folder = mkdtempSync(join(tmpdir(), 'behavioural-check-commands-'));
  const asked: string[] = [];
  const printed: string[] = [];
  const parts: Parts = {
    served: () => Promise.resolve({ surface, page: '' }),
    ask: (_model, prompt): Promise<Answer> => {
      asked.push(prompt);
      return Promise.resolve({ exit: 0, stdout: answers(prompt), stderr: '', seconds: 1 });
    },
    models: [model, { ...model, name: 'codex' }],
    versionOf: ({ name }) => `${name} 1.0.0`,
    now: () => new Date('2026-11-11T12:00:00.000Z'),
    briefs: { briefs, search_answer: { tools: [{ server: 'records', tool: 'list_records', mark: 'reads' }] } },
    record: join(folder, 'results.jsonl'),
    print: (line) => {
      printed.push(line);
    },
  };
  return verify({ parts, asked, printed, folder: join(folder, 'run') }).finally(() => {
    rmSync(folder, { recursive: true });
  });
}

const promptsFor = (folder: string, profile: string, ids: string) => [
  'prompts',
  folder,
  '--profile',
  profile,
  '--briefs',
  ids,
  '--server-name',
  'auto',
  '--starter',
  'Use auto to list my playbooks.',
];

function digestOf(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

await test('prompts are written for each brief with what a client shows, and the run notes the texts they hold', async () => {
  await withFakes(
    () => judgedPlan,
    async ({ parts, printed, folder }) => {
      await runBehaviouralCheck(promptsFor(folder, 'listing', 'J1,R1'), parts);
      const judged = readFileSync(join(folder, 'prompts', 'J1.txt'), 'utf8');
      const read = readFileSync(join(folder, 'prompts', 'R1.txt'), 'utf8');
      const run: unknown = JSON.parse(readFileSync(join(folder, 'run.json'), 'utf8'));

      assert.ok(
        judged.includes(
          'No playbooks yet. http://localhost:5555/studio/?server=http%3A%2F%2Flocalhost%3A5555&src=agent',
        ),
      );
      assert.ok(read.includes('You called search {}. It answered:\n{"tools":[{"server":"records"'));
      assert.deepEqual(
        printed.map((line) => line.replace(/\d+ bytes$/u, 'N bytes')),
        ['J1: N bytes', 'R1: N bytes'],
      );
      assert.partialDeepStrictEqual(run, {
        profile: 'listing',
        briefs: ['J1', 'R1'],
        server_name: 'auto',
        starter: 'Use auto to list my playbooks.',
        prompts: { J1: digestOf(judged), R1: digestOf(read) },
      });
      assert.ok(JSON.stringify(run).includes(digestOf(welcome)));
      assert.ok(JSON.stringify(run).includes(digestOf(startGuide)));
      assert.ok(JSON.stringify(run).includes(digestOf('The tool get_guide.')));
      assert.ok(!JSON.stringify(run).includes(digestOf('Read the guide start first.')));
    },
  );
});

await test('each model is asked each prompt once, and a run asked again reuses what was answered', async () => {
  await withFakes(
    () => judgedPlan,
    async ({ parts, asked, folder }) => {
      await runBehaviouralCheck(promptsFor(folder, 'listing', 'J1,R1'), parts);
      await runBehaviouralCheck(['run', folder], parts);
      await runBehaviouralCheck(['run', folder, 'codex'], parts);

      assert.equal(asked.length, 4);
      assert.ok(existsSync(join(folder, 'answers', 'claude', 'J1.json')));
      assert.deepEqual(JSON.parse(readFileSync(join(folder, 'answers', 'codex', 'model.json'), 'utf8')), {
        command: ['claude', '-p'],
        version: 'codex 1.0.0',
      });
    },
  );
});

function planningOnlyTheJudgement(prompt: string): string {
  return prompt.includes('Judge what I paste.') ? judgedPlan : 'I would make one reasoning function.';
}

function loadingTheGuideToolFirst(prompt: string): string {
  return prompt.includes('=== Tools your client loaded ===') ? judgedPlan : '{"load":["get_guide"]}';
}

await test('the record gains one row of outcomes for the run, and the table shows it', async () => {
  await withFakes(planningOnlyTheJudgement, async ({ parts, printed, folder }) => {
    await runBehaviouralCheck(promptsFor(folder, 'listing', 'J1,R1'), parts);
    await runBehaviouralCheck(['run', folder, 'claude'], parts);
    await runBehaviouralCheck(['record', folder, '--label', 'before', '--note', 'One model.'], parts);
    await runBehaviouralCheck(['table', 'before'], parts);
    const [row] = rowsIn(parts.record);

    assert.partialDeepStrictEqual(row, {
      label: 'before',
      date: '2026-11-11T12:00:00.000Z',
      models: { claude: { command: ['claude', '-p'], version: 'claude 1.0.0' } },
      results: { claude: { J1: { outcome: 'right' }, R1: { outcome: 'no answer' } } },
      note: 'One model.',
    });
    assert.equal(printed.filter((line) => line.startsWith('before (listing, 2026-11-11T12:00:00.000Z)')).length, 2);
  });
});

await test('a client that shows tools by name may load some, and is asked again with their entries', async () => {
  await withFakes(loadingTheGuideToolFirst, async ({ parts, asked, folder }) => {
    await runBehaviouralCheck(promptsFor(folder, 'names', 'J1'), parts);
    await runBehaviouralCheck(['run', folder, 'claude'], parts);
    await runBehaviouralCheck(['record', folder, '--label', 'names'], parts);
    const run: unknown = JSON.parse(readFileSync(join(folder, 'run.json'), 'utf8'));

    assert.equal(asked.length, 2);
    assert.ok(String(asked[0]).includes('This connection acts as Alex Doe (person:user_1) in the org org_1.'));
    assert.ok(String(asked[1]).includes('"description":"The tool get_guide."'));
    assert.partialDeepStrictEqual(rowsIn(parts.record)[0], {
      results: { claude: { J1: { loaded: ['get_guide'], outcome: 'right' } } },
    });
    assert.ok(JSON.stringify(run).includes(digestOf('Read the guide start first.')));
    assert.ok(!JSON.stringify(run).includes(digestOf('The tool get_guide.')));
  });
});

await test('a held-out brief runs only when the run says it is on a finished change', async () => {
  await withFakes(
    () => judgedPlan,
    async ({ parts, folder }) => {
      await assert.rejects(
        runBehaviouralCheck(promptsFor(folder, 'listing', 'J2'), parts),
        /The brief J2 is held out: it runs only on a finished change, given --held-out/u,
      );
      await runBehaviouralCheck([...promptsFor(folder, 'listing', 'J2'), '--held-out'], parts);

      assert.ok(existsSync(join(folder, 'prompts', 'J2.txt')));
    },
  );
});

await test('a command that is not one of the four, or that lacks what it needs, says how each is given', async () => {
  await withFakes(
    () => judgedPlan,
    async ({ parts, folder }) => {
      await assert.rejects(runBehaviouralCheck([], parts), /Usage:\n {2}pnpm behavioural-check prompts FOLDER/u);
      await assert.rejects(runBehaviouralCheck(['prompts', folder, '--profile', 'listing'], parts), /Usage:/u);
      await assert.rejects(runBehaviouralCheck(promptsFor(folder, 'listing', 'X1'), parts), /There is no brief X1/u);
      await assert.rejects(
        runBehaviouralCheck(promptsFor(folder, 'everything', 'J1'), parts),
        /There is no profile everything: a profile is listing, first-512 or names/u,
      );
    },
  );
});

async function refusedWith(surface: ServedSurface, refusal: Readonly<RegExp>): Promise<void> {
  await withFakes(
    () => judgedPlan,
    async ({ parts, folder }) => {
      await assert.rejects(runBehaviouralCheck(promptsFor(folder, 'listing', 'J1'), parts), refusal);
    },
    surface,
  );
}

await test('a server that does not serve what the first minute needs is named in the refusal', async () => {
  await refusedWith(surfaceWith({ own: false }), /The server serves no connection to the caller’s own org/u);
  await refusedWith(surfaceWith({ guides: ['start'] }), /The server serves no guide first-playbook/u);
  await refusedWith(surfaceWith({ answered: false }), /The server gave no answer to list_playbooks on a new org/u);
});
