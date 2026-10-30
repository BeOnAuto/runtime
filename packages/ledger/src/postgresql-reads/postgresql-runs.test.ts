import { describe, expect, it } from 'vitest';

import { postgresqlRecordedStore, type Query } from './postgresql-recorded.ts';

interface Asked {
  readonly text: string;
  readonly values: readonly unknown[];
}

function answeringNothing(): { readonly query: Query; readonly asked: Asked[] } {
  const asked: Asked[] = [];
  return {
    asked,
    query: (text, values) => {
      asked.push({ text, values });
      return Promise.resolve([]);
    },
  };
}

const alpha = 'playbook/acme/alpha/';

describe('a read of the runs of one definition on PostgreSQL', () => {
  it('reads the definition type and name from the metadata of the first message as plain jsonb, among a thousand runs', async () => {
    const { query, asked } = answeringNothing();
    const ofOneDefinition = { kind: 'runs', definitionType: 'workflow', name: 'qualify-enquiry' } as const;

    await postgresqlRecordedStore(query).readRecorded(alpha, ofOneDefinition, { order: 'desc', limit: 5 });

    expect(asked[0]?.text).toContain(
      "message_metadata ->> 'definitionType' = $2 AND message_metadata ->> 'definitionName' = $3 AS of_the_definition",
    );
    expect(asked[0]?.text).toContain('TRUE AND f.of_the_definition AS wanted');
    expect(asked[0]?.text).not.toContain('strpos');
    expect(asked[0]?.text).not.toContain('regexp_replace');
    expect(asked[0]?.values).toEqual(['emt:default', 'workflow', 'qualify-enquiry', [`${alpha}runs/`], 1001, 1000, 7]);
  });
});
