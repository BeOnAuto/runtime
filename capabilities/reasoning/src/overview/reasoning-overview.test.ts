import { readFileSync } from 'node:fs';

import { markdownOf, overviewAtRead, type DefinitionUser } from '@on.auto/definitions';
import { mostReadCharacters } from '@on.auto/definitions/template';
import { sectionIn } from '@on.auto/definitions/testing';
import { describe, expect, it } from 'vitest';

import { reasoningWith } from '../testing/reasoning-runs.ts';

const page = readFileSync(new URL('../../../../docs/reference/reasoning-format.md', import.meta.url), 'utf8');

const [, example = ''] = /```markdown\n([\s\S]*?)```/u.exec(page) ?? [];

const [, toolsOfTheReference = ''] = /```yaml\n(tools: .+)\n```/u.exec(page) ?? [];

const exampleWithTools = example.replace(/^model: .+$/mu, (modelLine) => `${modelLine}\n${toolsOfTheReference}`);

const shapesPage = readFileSync(new URL('../../../../docs/reference/output-shapes.md', import.meta.url), 'utf8');

const [, shapedExample = ''] = /```markdown\n([\s\S]*?)```/u.exec(shapesPage) ?? [];

const { prepared } = reasoningWith();

const counted = new Intl.NumberFormat('en');

function overviewOf(...lines: readonly string[]): string {
  return markdownOf(prepared(lines.join('\n')).overview('review-brief'));
}

function goldenOf(file: string): string {
  return readFileSync(new URL(file, import.meta.url), 'utf8');
}

function modelAndToolsOf(...tools: readonly string[]): string {
  const overview = overviewOf('---', 'model: openai/gpt-5', `tools: [${tools.join(', ')}]`, '---', 'Find it.');
  return sectionIn(overview, 'Which model and tools');
}

describe('the overviews of the example of the reference of reasoning functions', () => {
  it('are, byte for byte, the overviews pinned beside this test, without tools and with the tools of the reference', () => {
    expect(markdownOf(prepared(example).overview('review-brief'))).toBe(goldenOf('reference-example.overview.md'));
    expect(markdownOf(prepared(exampleWithTools).overview('review-brief'))).toBe(
      goldenOf('reference-tools.overview.md'),
    );
  });
});

describe('the overview of the reasoning function of the reference of output shapes', () => {
  it('is, byte for byte, the overview pinned beside this test', () => {
    expect(markdownOf(prepared(shapedExample).overview('queue-hours'))).toBe(
      readFileSync(new URL('shaped-example.overview.md', import.meta.url), 'utf8'),
    );
  });
});

describe('the reference of reasoning functions', () => {
  it('gives the bound of the instructions and the message an overview shows', () => {
    expect(page).toContain(`each cut past ${counted.format(mostReadCharacters)} characters`);
  });
});

describe('the overview of a reasoning function whose document has an about', () => {
  it('writes the about as its author wrote it, after the description and before what the function needs', () => {
    const overview = overviewOf(
      '---',
      'description: Reviews a campaign brief',
      'model: openai/gpt-5',
      'about: |',
      '  The **campaign team** uses it to check each brief before it goes to a client.',
      '',
      '  - It runs when someone asks for a review.',
      '  - It answers with the evidence the brief lacks.',
      '---',
      'Review {{ input.brief }}',
    );

    expect(overview.split('\n\n').slice(0, 5)).toEqual([
      '# review-brief',
      'Reviews a campaign brief',
      'The **campaign team** uses it to check each brief before it goes to a client.',
      '- It runs when someone asks for a review.\n- It answers with the evidence the brief lacks.',
      '## What it needs',
    ]);
  });
});

describe('the overview of a reasoning function', () => {
  it('says the fields of a JSON answer, and the defaults its input takes in place of what a run leaves out', () => {
    const overview = overviewOf(
      '---',
      'model: openai/gpt-5',
      'input:',
      '  schema: {type: object, properties: {brief: {type: string}, tone: {type: string}, max: true}}',
      '  default: {tone: warm, max: 3, other: 1}',
      'output:',
      '  format: json',
      '  schema: {type: object, properties: {score: {type: integer, maximum: 10}}, required: [score]}',
      '---',
      'Score {{ input.brief }}',
    );

    expect(sectionIn(overview, 'What it needs')).toContain('| **tone** | no | Text, “warm” when left out. |');
    expect(sectionIn(overview, 'What it needs')).toContain('| **max** | no | Any value. |');
    expect(sectionIn(overview, 'What it produces')).toContain('| **score** | yes | A whole number, at most 10. |');
  });
});

describe('the overview of a reasoning function whose output names a shape', () => {
  it('says the shape in what it produces, in place of the fields of its schema', () => {
    const overview = overviewOf('---', 'model: openai/gpt-5', 'output: {shape: text}', '---', 'Write it.');

    expect(sectionIn(overview, 'What it produces')).toBe('It answers a **text**: Markdown of at most 65,536 bytes.');
  });
});

describe('the model and tools of a reasoning function in its overview', () => {
  it('say the model and that it calls no tools, with nothing drawn, when its document names none', () => {
    const overview = overviewOf('---', 'model: openai/gpt-5', '---', 'Find it.');

    expect(sectionIn(overview, 'Which model and tools')).toBe(
      ['It reasons with the model `openai/gpt-5`.', 'It calls no tools.'].join('\n\n'),
    );
  });

  it('name each tool with its server, and every tool of a server named with a star', () => {
    const [model, mayCall, tools] = modelAndToolsOf('graph/search', 'notes/*').split('\n\n');

    expect([model, mayCall, tools]).toEqual([
      'It reasons with the model `openai/gpt-5`.',
      'It may call these tools:',
      '- the tool **search** of **graph**\n- every tool of **notes**',
    ]);
  });

  it('draw the function, the model it reasons with and each tool the model may call, then say how it calls them', () => {
    const [, , , diagram, howItCalls] = modelAndToolsOf('graph/search', 'notes/*').split('\n\n');

    expect(diagram).toBe(
      [
        '```mermaid',
        'flowchart LR',
        '  n1["review-brief"]',
        '  n2["openai/gpt-5"]',
        '  n3["graph/search"]',
        '  n4["every tool of notes"]',
        '  n1 -->|"reasons with"| n2',
        '  n2 -->|"may call"| n3',
        '  n2 -->|"may call"| n4',
        '```',
      ].join('\n'),
    );
    expect(howItCalls).toBe(
      "The model may call these tools before it answers, several in one step and over several steps, within a run's limits on calls, time and failures.",
    );
  });
});

describe('the overview a read writes of a reasoning function whose prompt holds what an overview reads as its own', () => {
  const fence = '`'.repeat(3);
  const lead = 'Its message, with the values of each run in place of the names in bold:';
  const users: readonly DefinitionUser[] = [
    { type: 'workflow', name: 'weekly-review', relation: 'calls', steps: [{ number: 2, name: 'review' }] },
  ];

  function partsOf(...prompt: readonly string[]): readonly unknown[] {
    const overview = prepared(['---', 'model: openai/gpt-5', '---', ...prompt].join('\n')).overview('review-brief');
    const [story = '', ...details] = overviewAtRead(overview, { users, called: [] }).split('\n## Details\n');
    return [sectionIn(story, 'What it is told'), sectionIn(story, 'Used by'), details];
  }

  const usedBy = '- The workflow **Weekly review** calls it in step 2, **Review**.\n';

  const detailsOfUsedBy = ['\n### Used by\n\n- `weekly-review`, a workflow\n'];

  it('writes a line ## Details of the prompt with its first character escaped, so the page splits it at its own alone', () => {
    expect(partsOf('Review the brief.', '## Details', 'Name what it lacks.')).toEqual([
      `${lead}\n\nReview the brief.\n\\## Details\nName what it lacks.`,
      usedBy,
      detailsOfUsedBy,
    ]);
  });

  it('closes a fence the prompt leaves open at its end, so what follows is read as the overview', () => {
    expect(partsOf('Review the brief as in:', fence, 'an example')).toEqual([
      `${lead}\n\nReview the brief as in:\n${fence}\nan example\n${fence}`,
      usedBy,
      detailsOfUsedBy,
    ]);
  });
});

describe('the overview of a reasoning function without an input schema or instructions', () => {
  it('says what it takes and what it is told', () => {
    const overview = overviewOf(
      '---',
      'model: openai/gpt-5',
      '---',
      '{% if input.vip %}Treat them as a VIP.{% endif %} Hello {{ input.name | default: "friend" }}.',
    );

    expect(sectionIn(overview, 'What it needs')).toBe('It takes any input, which its document does not describe.');
    expect(sectionIn(overview, 'What it is told')).toBe(
      [
        'Its message, with the values of each run in place of the names in bold:',
        'Treat them as a VIP when input.vip. Hello **name**.\n',
      ].join('\n\n'),
    );
  });
});
