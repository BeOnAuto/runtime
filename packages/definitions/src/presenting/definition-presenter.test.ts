import { presentationOf, type Context, type RecordedEvent } from '@on.auto/operations';
import { nothingKept } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

import { makeDefinitionPresenters } from '../index.ts';
import type { DefinitionEvent } from '../registry/definition-events.ts';
import { echo } from '../testing/echo.ts';
import { overviewTitled } from '../testing/overview-sections.ts';

const { present } = presentationOf(makeDefinitionPresenters([echo]));

function recordOf(stream: string, type: string, data: unknown, context: Context): RecordedEvent {
  return {
    id: '5c6f1a43-0d6e-5b2a-9c1e-7e3f2a1b0c9d',
    cursor: 'c-1',
    causationId: null,
    correlationId: null,
    stream,
    version: 1,
    globalPosition: 1,
    type,
    data,
    context,
    recordedAt: '2026-10-01T09:00:02.000Z',
  };
}

const showing = { streamPrefix: 'playbook/acme/alpha/', content: nothingKept, view: 'page' } as const;

function presented(event: DefinitionEvent, version?: number, type = 'echo') {
  const context = {
    at: '2026-10-01T09:00:00.000Z',
    by: 'acme-admin',
    definitionType: type,
    definitionName: 'greet',
    ...(version === undefined ? {} : { definitionVersion: version }),
  };
  return present(recordOf(`definitions/${type}`, event.type, event.data, context), showing).at(0);
}

describe('the presenter of the definitions of a capability', () => {
  it('presents a definition created with the size of its document, of its overview as written and what its capability said of it', () => {
    const content = {
      source: '{"greeting":"Hé"}',
      overview: overviewTitled('greet', 'Greets é'),
      description: 'Greets',
      input_schema: { type: 'object' },
      output_schema: { type: 'string' },
      warnings: ['one', 'two'],
    };

    expect(presented({ type: 'definition_created', data: { content } }, 1)).toMatchObject({
      type: 'definition_created',
      summary: 'The greeting “greet” was created.',
      data: {
        source_bytes: 18,
        overview_bytes: 19,
        description: 'Greets',
        input_schema_bytes: 17,
        output_schema_bytes: 17,
        warning_count: 2,
      },
      metadata: { by: 'acme-admin', definition: { type: 'echo', name: 'greet', version: 1 } },
    });
  });
});

describe('the presenter of the changes to a definition', () => {
  it('presents an update with its version, and a document its capability said little of', () => {
    expect(
      presented(
        { type: 'definition_updated', data: { content: { source: 'Hi', overview: overviewTitled('greet') } } },
        150,
      ),
    ).toMatchObject({
      type: 'definition_updated',
      summary: 'The greeting “greet” was updated to version one hundred and fifty.',
      data: { source_bytes: 2, overview_bytes: 10, warning_count: 0 },
    });
  });

  it('presents a retirement with no data, and names a definition of a capability the server does not offer as an item', () => {
    expect(presented({ type: 'definition_retired', data: {} }, 4, 'gone')).toMatchObject({
      type: 'definition_retired',
      summary: 'The item “greet” was retired.',
      data: {},
      metadata: { definition: { type: 'gone', name: 'greet', version: 4 } },
    });
  });

  it('shows the first three hundred characters of a description', () => {
    const description = `${'😀'.repeat(299)}ab`;

    expect(
      presented(
        {
          type: 'definition_created',
          data: { content: { source: 'Hi', overview: overviewTitled('greet'), description } },
        },
        1,
      ),
    ).toMatchObject({ data: { description: `${'😀'.repeat(299)}a` } });
  });

  it('fails on an update recorded without its version, which a presenter never hides', () => {
    expect(() =>
      presented({ type: 'definition_updated', data: { content: { source: 'Hi', overview: overviewTitled('greet') } } }),
    ).toThrow('definitionVersion');
  });
});
