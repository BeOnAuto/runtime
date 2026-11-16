import type { ShippedFiles } from '@on.auto/shipped-files';
import { describe, expect, it } from 'vitest';

import { guideFiles } from '../testing/guide-shelves.ts';
import { guideShelfFrom, type ServedType } from './served-guides.ts';

function withChanged(path: string, changed: (text: string) => string): ShippedFiles {
  return {
    text: (file) => guideFiles.text(file).then((text) => (file.path === `docs/${path}` ? changed(text) : text)),
    bytes: (file) => guideFiles.bytes(file),
    list: (folder) => guideFiles.list(folder),
  };
}

const workflowType: ServedType = {
  type: 'workflow',
  noun: { one: 'workflow', other: 'workflows' },
  guide: { name: 'workflow' },
};

function servedFrom(files: ShippedFiles): ReturnType<typeof guideShelfFrom> {
  return guideShelfFrom(files, [workflowType], { pages: false });
}

function withPassagesMarked(text: string): string {
  return text
    .replace('through steps.', 'through steps<span data-audience="developer">, as the HTTP reference sets out</span>.')
    .replace(
      '## Document fields',
      '<div data-audience="operator">\n\nWhoever runs the server sets the most a workflow may hold.\n\n</div>\n\n## Document fields',
    );
}

const operatorsTable = [
  '| Term          | Meaning                                    |',
  '| ------------- | ------------------------------------------ |',
  '| Settings file | Where whoever runs the server sets it up. |',
];

function withATable(marked: boolean): (text: string) => string {
  const table = marked ? ['<div data-audience="operator">', '', ...operatorsTable, '', '</div>'] : operatorsTable;
  return (text) => text.replace('## Definitions and runs\n', ['## Definitions and runs', '', ...table, ''].join('\n'));
}

function withABrokenMarking(text: string): string {
  return text.replace('through steps.', 'through steps<span data-audience="admin"> too</span>.');
}

describe('a page that marks a passage for another reader', () => {
  it('serves its type the guide of the page as it was before the passage was written', async () => {
    const plain = await servedFrom(guideFiles);
    const marked = await servedFrom(withChanged('reference/workflow-format.md', withPassagesMarked));

    expect(marked.named('workflow')?.text).toBe(plain.named('workflow')?.text);
    expect(
      withPassagesMarked(
        await guideFiles.text({ package: '@on.auto/runtime', path: 'docs/reference/workflow-format.md' }),
      ).match(/data-audience/gu)?.length,
    ).toBe(2);
  });

  it('serves the terminology without the rows of a marked table, which it would serve unmarked', async () => {
    const plain = await servedFrom(guideFiles);
    const marked = await servedFrom(withChanged('concepts/terminology.md', withATable(true)));
    const unmarked = await servedFrom(withChanged('concepts/terminology.md', withATable(false)));

    expect(marked.named('terminology')?.text).toBe(plain.named('terminology')?.text);
    expect(unmarked.named('terminology')?.text).toContain('- Settings file: Where whoever runs the server sets it up.');
  });

  it('cannot be served when its marking is broken', async () => {
    await expect(servedFrom(withChanged('reference/workflow-format.md', withABrokenMarking))).rejects.toThrow(
      /^The page reference\/workflow-format\.md cannot be served as a guide\. The line "A workflow coordinates a playbook's functions through steps<span data-audience="…" names no audience a page may name in data-audience="admin"/u,
    );
  });
});
