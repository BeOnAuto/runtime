import { rejected, type Rejected } from '@on.auto/operations';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { ProblemSchema } from '../problem/problem-document.ts';
import { unsuccessfulResultOf } from './tool-result.ts';

const unlicensed: Rejected = {
  ...rejected('conflict', 'This runtime has used its 100 free runs.', undefined, 'license_required'),
  resolve_at: 'https://studio.on.auto/licenses?installation=0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  runtime_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
};

const exhausted: Rejected = {
  ...rejected('conflict', 'The org acme has no credits left.', undefined, 'credits_exhausted'),
  because: 'none_left',
  resolve_at: 'https://studio.on.auto/billing',
};

const textsIn = Schema.decodeUnknownSync(
  Schema.Array(Schema.Struct({ type: Schema.Literal('text'), text: Schema.String })),
);

function textsOf(rejection: Rejected): readonly string[] {
  const { content } = unsuccessfulResultOf(rejection, false, { kind: 'command', attempt: 'run the workflow “tally”' });
  return textsIn(content).map(({ text }) => text);
}

const problemIn = Schema.decodeUnknownSync(Schema.fromJsonString(ProblemSchema));

describe('the tool result of a refusal of the meter', () => {
  it('carries where a person resolves it and the id of the runtime in its problem, which its words point at', () => {
    const [words = '', problem = ''] = textsOf(unlicensed);

    expect(words).toContain('at the resolve_at link in the details below');
    expect(problemIn(problem)).toEqual({
      type: 'https://on.auto/problems/license_required',
      title: 'License required',
      status: 409,
      detail: 'This runtime has used its 100 free runs.',
      reason: 'conflict',
      kind: 'license_required',
      resolve_at: 'https://studio.on.auto/licenses?installation=0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
      runtime_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
    });
  });

  it('carries the case of a refusal for credits, and leaves out a runtime id it was not given', () => {
    const [, problem = ''] = textsOf(exhausted);

    expect(problemIn(problem)).toMatchObject({
      kind: 'credits_exhausted',
      because: 'none_left',
      resolve_at: 'https://studio.on.auto/billing',
    });
    expect(problemIn(problem)).not.toHaveProperty('runtime_id');
  });
});
