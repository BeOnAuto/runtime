import { shapeNamed } from '@on.auto/definitions/testing';
import { describe, expect, it } from 'vitest';

import { documentOf, reasoningExample } from '../testing/definition-documents.ts';
import { reasoningWith } from '../testing/reasoning-runs.ts';

const { prepared } = reasoningWith();

describe('the summary of a reasoning function whose output names a shape', () => {
  it('publishes the schema of the shape as its output schema, and the shape in its details', () => {
    const { summary } = prepared(documentOf('model: openai/gpt-5\noutput: {shape: table}'));

    expect(summary).toMatchObject({ outputSchema: shapeNamed('table').schema, details: { shape: 'table' } });
    expect(prepared(reasoningExample).summary).not.toHaveProperty('details');
  });
});
