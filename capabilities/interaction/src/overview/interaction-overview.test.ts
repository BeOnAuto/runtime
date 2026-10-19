import { readFileSync } from 'node:fs';

import { markdownOf } from '@on.auto/definitions';
import { sectionIn } from '@on.auto/definitions/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { callDocument, interactionHarness } from '../testing/index.ts';

const { capability } = interactionHarness();

function examplesOf(page: string): readonly string[] {
  const text = readFileSync(new URL(`../../../../docs/reference/${page}`, import.meta.url), 'utf8');
  return [...text.matchAll(/```markdown\n([\s\S]*?)```/gu)].map(([, body = '']: readonly string[]) => body);
}

function goldenOf(file: string): string {
  return readFileSync(new URL(file, import.meta.url), 'utf8');
}

function overviewOf(source: string, name = 'read-thread'): string {
  return markdownOf(Effect.runSync(capability.prepare(source)).overview(name));
}

const [inboxExample = '', chatExample = ''] = examplesOf('interaction-format.md');

const callExample = examplesOf('computation-format.md').find((example) => example.includes('\ncall:\n')) ?? '';

describe('the overviews of the examples of the reference of interaction functions', () => {
  it('are, byte for byte, the overviews pinned beside this test, of a request to the inbox and through a chat', () => {
    expect(overviewOf(inboxExample, 'approve-brief')).toBe(goldenOf('reference-inbox.overview.md'));
    expect(overviewOf(chatExample, 'approve-draft')).toBe(goldenOf('reference-chat.overview.md'));
  });

  it('is, byte for byte for the function that asks a system, the overview pinned beside this test', () => {
    expect(overviewOf(callExample, 'read-campaign-costs')).toBe(goldenOf('reference-call.overview.md'));
  });
});

describe('the overview of an interaction function that asks a system', () => {
  it('names the tool it calls, what it sends and where in the answer it reads', () => {
    const overview = overviewOf(callDocument({ read: '/data/items~1all~0x' }));

    expect(sectionIn(overview, 'Who it asks')).toBe(
      'It asks a system: each run calls the tool **thread** of **chat** once.',
    );
    expect(sectionIn(overview, 'What it sends')).toContain('| **channel** | yes | Text. |');
    expect(sectionIn(overview, 'What it reads')).toBe(
      [
        'It answers with what the tool answered under **data**, then **items/all~x**:',
        'A list of at most 100 records with: **user** (text), **text** (text), **ts** (text).\n',
      ].join('\n\n'),
    );
  });

  it('answers with the whole answer without read, and says so of an input its document does not describe', () => {
    const overview = overviewOf(callDocument({ read: null, input: [], with: ['    limit: 100'] }));

    expect(sectionIn(overview, 'What it sends')).toBe(
      [
        "It sends the tool the arguments its document writes, from each run's input:",
        'It takes any input, which its document does not describe.',
      ].join('\n\n'),
    );
    expect(sectionIn(overview, 'What it reads')).toMatch(/^It answers with the whole of what the tool answered:\n\n/u);
  });
});
