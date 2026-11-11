import { describe, expect, it } from 'vitest';

import { isStreamProjectionRefused, StreamProjectionRefused } from './stream-projection-refused.ts';

describe('a read model refused', () => {
  it('names its read model and playbook, and is told apart from any other defect', () => {
    const refused = new StreamProjectionRefused('definitions', 'playbook/acme/alpha');

    expect([
      refused.message,
      refused.projection,
      isStreamProjectionRefused(refused),
      isStreamProjectionRefused(new Error('x')),
    ]).toEqual([
      'The rows of the read model definitions of playbook/acme/alpha disagree with its facts after it was built again',
      'definitions',
      true,
      false,
    ]);
  });
});
