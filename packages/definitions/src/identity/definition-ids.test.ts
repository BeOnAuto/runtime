import { describe, expect, it } from 'vitest';

import { definitionKeyOfId, earlierDefinitionIdOf } from './definition-ids.ts';

describe('the id of a definition made before definitions had ids of their own', () => {
  it('is a version 5 UUID of the org, the playbook, the type and the name its creation was recorded under, fixed for ever', () => {
    const closing = { org: 'acme', playbook: 'alpha', type: 'workflow', name: 'close-the-week' };

    expect([earlierDefinitionIdOf(closing), earlierDefinitionIdOf({ ...closing, playbook: 'beta' })]).toEqual([
      '129b8fef-e8c0-5a85-914a-f139cfd61d86',
      'd7126a43-3768-5f58-b497-6924bb0a96c1',
    ]);
  });

  it("gives the key of the definition's streams under its org", () => {
    expect(definitionKeyOfId('acme', '129b8fef-e8c0-5a85-914a-f139cfd61d86')).toBe(
      'definition/acme/129b8fef-e8c0-5a85-914a-f139cfd61d86/',
    );
  });
});
