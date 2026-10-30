import { describe, expect, it } from 'vitest';

import { definitionStreamsStatement, postgresqlDefinitionStreams } from './postgresql-definition-streams.ts';

describe('the definition streams of a type on PostgreSQL', () => {
  it('are read from the table of streams by the type in their name, in the default partition, with their versions', async () => {
    const asked: { readonly text: string; readonly values: readonly unknown[] }[] = [];
    const store = postgresqlDefinitionStreams((text, values) => {
      asked.push({ text, values });
      return Promise.resolve([{ stream: 'playbook/acme/alpha/definitions/recall', version: '3' }]);
    });

    const streams = await store.definitionStreams('recall');

    expect(streams).toEqual([{ stream: 'playbook/acme/alpha/definitions/recall', version: 3 }]);
    expect(asked).toEqual([{ text: definitionStreamsStatement, values: ['recall', 'emt:default'] }]);
  });
});
