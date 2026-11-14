import { describe, expect, it } from 'vitest';

import { makeDefinitionOperations } from '../operations/definition-operations.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { runContentHolders } from '../testing/harness.ts';
import { uncheckedPages } from '../testing/page-ports.ts';

function namesOf(goals: boolean): readonly string[] {
  return makeDefinitionOperations(
    [echo],
    uncheckedPages,
    { holders: runContentHolders },
    { goals, messages: false },
  ).map(({ registration }) => registration.name);
}

describe('the export of a playbook', () => {
  it('is served beside the definitions only where goals are kept', () => {
    expect(namesOf(true)).toContain('export_playbook');
    expect(namesOf(false)).not.toContain('export_playbook');
  });
});
