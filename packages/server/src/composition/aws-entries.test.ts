import { fileURLToPath } from 'node:url';

import { modulesReachedFrom } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

const sources = fileURLToPath(new URL('..', import.meta.url));

function awsClientsReachedFrom(module: string): readonly string[] {
  return modulesReachedFrom(sources, module).packages.filter((name) => name === '@on.auto/outbound/aws');
}

describe('the AWS clients of the outbound package', () => {
  it('are reached from neither module the server starts with, and load with the first client its settings name', () => {
    expect([
      ...awsClientsReachedFrom('lifecycle/run-server.ts'),
      ...awsClientsReachedFrom('composition/composition-root.ts'),
    ]).toEqual([]);
  });
});
