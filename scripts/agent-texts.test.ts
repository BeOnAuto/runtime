import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import type { ServedGuide, ServedPrompt, ServedSurface } from '@on.auto/api/testing';
import type { ServedToAnAgent } from '@on.auto/server/served-to-an-agent';

import {
  checkAgentTexts,
  onboardingPath,
  requireTheOnboardingPathServed,
  runAgentTexts,
  servedDocument,
  writeAgentTexts,
} from './agent-texts.ts';

function guideNamed(name: string): ServedGuide {
  return { name, text: `# ${name}\n\nWhat ${name} says.\n` };
}

const getStarted: ServedPrompt = {
  name: 'get-started',
  title: 'Get started',
  description: 'Starts.',
  arguments: [],
  messages: [{ kind: 'text', text: 'Start with me.' }],
};

function surfaceServing(guides: readonly string[]): ServedSurface {
  return {
    connections: [
      {
        endpoint: 'own org',
        path: '/mcp',
        instructions: 'Read the guide start first.',
        listing: [],
        tools: [
          {
            name: 'tally',
            title: 'Tally',
            description: 'Counts. Use it to count. It answers the count.',
            inputSchema: { type: 'object', properties: { since: { type: 'string', description: 'The first day' } } },
          },
        ],
        prompts: [getStarted],
        guides: guides.map((name) => guideNamed(name)),
      },
    ],
    answers: [{ tool: 'list_playbooks', arguments: {}, path: '/mcp', text: 'Nothing yet. {origin}/studio/' }],
  };
}

const everyGuide = ['start', 'first-playbook', 'give-tools', 'terminology'];

function servedWith(guides: readonly string[]): () => Promise<ServedToAnAgent> {
  return () => Promise.resolve({ surface: surfaceServing(guides), page: '' });
}

function digestOf(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function withTemporaryList(verify: (path: string) => Promise<void>): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'auto-runtime-agent-texts-'));
  return verify(join(directory, 'agent-texts.json')).finally(() => {
    rmSync(directory, { recursive: true });
  });
}

await test('the onboarding path is the guide start, the recipes first-playbook and give-tools, and the prompt get-started', () => {
  assert.deepEqual(onboardingPath, ['start', 'first-playbook', 'give-tools', 'get-started']);
});

await test('the list gives each text its tier, every place it is received and its SHA-256, two spaces deep, with a final newline', async () => {
  const document = await servedDocument(servedWith(everyGuide));
  const parsed: unknown = JSON.parse(document);

  assert.ok(document.endsWith('}\n'));
  assert.ok(document.includes('\n  "texts": [\n    {\n      "sha256": '));
  assert.partialDeepStrictEqual(parsed, {
    tiers: {
      '2': 'The onboarding path, what an agent reads from its first call to its first saved definition: the answers to the first calls on a new org, and the guides and prompts start, first-playbook, give-tools and get-started.',
    },
    texts: [
      {
        sha256: digestOf('Nothing yet. {origin}/studio/'),
        tier: 2,
        received: [{ as: 'first answer of list_playbooks {}', on: ['/mcp'] }],
        lines: ['Nothing yet. {origin}/studio/'],
      },
      { tier: 1, received: [{ as: 'instructions', on: ['/mcp'] }], lines: ['Read the guide start first.'] },
      { tier: 1, received: [{ as: 'tool tally: title', on: ['/mcp'] }] },
      { tier: 1, received: [{ as: 'tool tally: description', on: ['/mcp'] }] },
      { tier: 1, received: [{ as: 'tool tally: argument since', on: ['/mcp'] }], lines: ['The first day'] },
      { tier: 2, received: [{ as: 'prompt get-started: title', on: ['/mcp'] }] },
      { tier: 2, received: [{ as: 'prompt get-started: description', on: ['/mcp'] }] },
      { tier: 2, received: [{ as: 'prompt get-started: message', on: ['/mcp'] }] },
      {
        sha256: digestOf(guideNamed('start').text),
        tier: 2,
        received: [{ as: 'guide start', on: ['/mcp'] }],
        lines: ['# start', '', 'What start says.', ''],
      },
      { tier: 2, received: [{ as: 'guide first-playbook', on: ['/mcp'] }] },
      { tier: 2, received: [{ as: 'guide give-tools', on: ['/mcp'] }] },
      { tier: 3, received: [{ as: 'guide terminology', on: ['/mcp'] }] },
    ],
  });
});

await test('a name on the onboarding path that the server does not serve stops the list', async () => {
  await assert.rejects(
    servedDocument(servedWith(['start', 'terminology'])),
    /^Error: The onboarding path names first-playbook, give-tools, which the server does not serve$/u,
  );
  assert.doesNotThrow(() => {
    requireTheOnboardingPathServed(surfaceServing(everyGuide));
  });
});

await test('writing keeps a list that has not changed, so that a watcher sees nothing', async () => {
  await withTemporaryList(async (path) => {
    const document = await servedDocument(servedWith(everyGuide));
    assert.equal(writeAgentTexts(path, document), 'updated');
    utimesSync(path, 100, 100);
    const modified = statSync(path).mtimeMs;
    assert.equal(writeAgentTexts(path, document), 'unchanged');
    assert.equal(statSync(path).mtimeMs, modified);
    writeFileSync(path, '{}\n');
    assert.equal(writeAgentTexts(path, document), 'updated');
    checkAgentTexts(path, document);
  });
});

await test('checking refuses a missing or stale list without writing it, and names the one command that writes it again', async () => {
  await withTemporaryList(async (path) => {
    const document = await servedDocument(servedWith(everyGuide));
    assert.throws(() => {
      checkAgentTexts(path, document);
    }, /is missing or stale at .+agent-texts\.json\. Run pnpm agent-texts\.$/u);
    assert.equal(existsSync(path), false);
    writeFileSync(path, '{}\n');
    assert.throws(() => {
      checkAgentTexts(path, document);
    }, /Run pnpm agent-texts\./u);
    assert.equal(readFileSync(path, 'utf8'), '{}\n');
  });
});

await test('the command writes the list, checks it, and refuses any other argument', async () => {
  await withTemporaryList(async (path) => {
    await runAgentTexts([], path, servedWith(everyGuide));
    await runAgentTexts(['--check'], path, servedWith(everyGuide));
    await assert.rejects(runAgentTexts(['--check'], path, servedWith([...everyGuide, 'triggers'])), /stale/u);
    await Promise.all(
      [['--write'], ['--check', '--check']].map((commandArguments: readonly string[]) =>
        assert.rejects(runAgentTexts(commandArguments, path, servedWith(everyGuide)), /Usage: pnpm agent-texts/u),
      ),
    );
  });
});

await test('the committed list is what a throwaway server of this release serves', () => {
  execFileSync(process.execPath, [resolve(import.meta.dirname, 'agent-texts.ts'), '--check']);
});
