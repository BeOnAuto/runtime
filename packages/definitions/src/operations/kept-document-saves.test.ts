import { describe, expect, it } from 'vitest';

import { definitionFactsOf, keepingPlaybook, keptArmOfText, keptFunctionName } from '../testing/kept-documents.ts';
import { createdAtTheFloor } from '../testing/saved-at-the-floor.ts';
import {
  askingAbout,
  functionDocumentLongerThanAFactHolds,
  savingAFunction,
  savingOperations,
} from '../testing/saved-definitions.ts';

const { createDefinition, updateDefinition, retireDefinition, restoreDefinition } = savingOperations;

const { first, second, small } = savingAFunction;

const long = { source: functionDocumentLongerThanAFactHolds('Hi'), overview: 'Greets each guest', diagram: 'none' };

const overview = String(first.overview);

const recordedAdmin = { id: 'acme-admin', name: 'acme-admin' };

describe('a definition saved while its playbook keeps large texts outside its facts', () => {
  it('keeps its document once, before the fact names it, where it is longer than a fact holds, and answers with it in hand', async () => {
    const { definitions, watched, asked } = keepingPlaybook();
    const kept = keptArmOfText(long.source);

    expect(await asked(createDefinition, long)).toMatchObject({ status: 'succeeded', output: long });
    expect(await definitionFactsOf(definitions)).toMatchObject([
      {
        type: 'definition_created',
        data: {
          content: {
            source_sha256: kept.sha256,
            source_bytes: kept.bytes,
            overview: long.overview,
            diagram: long.diagram,
          },
          created_by: recordedAdmin,
        },
      },
    ]);
    expect(watched.reads()).toBe(0);
  });

  it('keeps a text no longer than a fact holds in its fact', async () => {
    const { definitions, asked } = keepingPlaybook();

    await asked(createDefinition, small);

    expect(await definitionFactsOf(definitions)).toMatchObject([
      { data: { content: { source: small.source, overview: 'Greets briefly', diagram: 'none' } } },
    ]);
  });

  it('records its texts in its fact while the store takes none, so a save is never lost to the store', async () => {
    const { definitions, watched, asked } = keepingPlaybook();
    watched.failPuts();

    expect(await asked(createDefinition, long)).toMatchObject({ status: 'succeeded', output: { version: 1 } });
    expect(await definitionFactsOf(definitions)).toMatchObject([{ data: { content: long } }]);
  });
});

describe('a definition saved again while its playbook keeps large texts outside its facts', () => {
  it('carries the overview it keeps when an update leaves it out, reading it once to answer, and records nothing for the same texts again', async () => {
    const { definitions, watched, asked } = keepingPlaybook();
    await createdAtTheFloor(definitions, first);

    expect(await asked(updateDefinition, second)).toMatchObject({
      status: 'succeeded',
      output: { version: 2, source: second.source, overview, diagram: second.diagram },
    });
    expect(watched.reads()).toBe(1);
    expect(await asked(updateDefinition, { ...second, overview })).toMatchObject({
      status: 'succeeded',
      output: { version: 2 },
    });
    expect(await definitionFactsOf(definitions)).toMatchObject([
      { type: 'definition_created' },
      { type: 'definition_updated', data: { content: { overview_sha256: keptArmOfText(overview).sha256 } } },
    ]);
  });

  it('records nothing for a document saved inline before that is offered again, told the same by its digest', async () => {
    const { definitions, asked } = keepingPlaybook();
    await askingAbout(definitions, savingAFunction.type, keptFunctionName)(createDefinition, long);

    expect(await asked(updateDefinition, long)).toMatchObject({ status: 'succeeded', output: { version: 1 } });
    expect(await definitionFactsOf(definitions)).toHaveLength(1);
  });

  it('restores a retired definition with its texts as they were kept, putting nothing to record it', async () => {
    const { definitions, watched, asked } = keepingPlaybook();
    await asked(createDefinition, long);
    await asked(retireDefinition);
    watched.failPuts();

    expect(await asked(restoreDefinition)).toMatchObject({ status: 'succeeded', output: { source: long.source } });
    const [created, , restored] = await definitionFactsOf(definitions);
    expect(created).toMatchObject({ data: { content: { source_sha256: keptArmOfText(long.source).sha256 } } });
    expect(restored).toEqual({
      type: 'definition_restored',
      data: { content: created?.data['content'], restored_by: recordedAdmin },
    });
  });
});
