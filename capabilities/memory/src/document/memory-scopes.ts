import { Result } from 'effect';

import type { MemoryScope } from '../facts/memory-facts.ts';

export type RecallScope = MemoryScope | 'both';

const memoryScopes: readonly MemoryScope[] = ['playbook', 'organization'];

const recallScopes: readonly RecallScope[] = [...memoryScopes, 'both'];

function isMemoryScope(written: string): written is MemoryScope {
  return memoryScopes.some((scope) => scope === written);
}

function isRecallScope(written: string): written is RecallScope {
  return recallScopes.some((scope) => scope === written);
}

export function memoryScopeOf(written: string): Result.Result<MemoryScope, string> {
  return isMemoryScope(written)
    ? Result.succeed(written)
    : Result.fail(
        `${JSON.stringify(written)} is no scope: a memory is kept by the playbook, playbook, or by its organization, organization`,
      );
}

export function recallScopeOf(written: string): Result.Result<RecallScope, string> {
  return isRecallScope(written)
    ? Result.succeed(written)
    : Result.fail(
        `${JSON.stringify(written)} is no scope: a recall reads the playbook's memories, playbook, its organization's, organization, or both, both`,
      );
}

export const organizationNotKept =
  'Organization-wide memories are not available here yet: keep it for the playbook, with scope playbook';

export function playbookScopeOf(written: string): Result.Result<MemoryScope, string> {
  return written === 'organization' ? Result.fail(organizationNotKept) : memoryScopeOf(written);
}
