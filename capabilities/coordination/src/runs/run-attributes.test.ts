import { Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { attributesOfRun, type RunAttributes } from './run-attributes.ts';

const attributes: RunAttributes = {
  org: 'acme',
  playbook: 'accounts',
  run_id: 'run-1',
  definition: { name: 'payment', version: 2 },
  caller: {
    id: 'operator',
    name: 'operator',
    org: 'acme',
    permissions: ['org:read', 'org:write', 'playbook:read', 'playbook:write'],
    playbooks: ['accounts'],
  },
};

describe('the attributes of a workflow run', () => {
  it('reads the attributes the run was started with, its caller with them', () => {
    expect(attributesOfRun(attributes)).toEqual(Option.some(attributes));
  });

  it('refuses a caller with an unknown permission or without its playbooks instead of granting access', () => {
    expect(attributesOfRun({ ...attributes, caller: { ...attributes.caller, permissions: ['admin'] } })).toEqual(
      Option.none(),
    );
    expect(attributesOfRun({ ...attributes, caller: { ...attributes.caller, playbooks: undefined } })).toEqual(
      Option.none(),
    );
    expect(attributesOfRun(null)).toEqual(Option.none());
  });
});
