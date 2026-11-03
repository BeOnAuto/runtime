import { describe, expect, it } from 'vitest';

import { noDefinitions } from '../projector/playbook-definitions.ts';
import { pageKeeping } from './page-keeping.ts';

describe('the pages saved as definitions of their own that the views keep', () => {
  it('pass over a record of their stream that is no definition’s, counting it as a version of the stream', () => {
    const kept = pageKeeping.keptAfter(noDefinitions, 'page', [
      { type: 'definition_renamed', data: {}, context: { by: 'acme-admin', at: '2026-10-06T09:00:00.000Z' } },
    ]);

    expect([kept.version, kept.savedAsDefinitions?.size]).toEqual([1, 0]);
  });
});

describe('the pages the views keep', () => {
  it('pass over a record of a subject’s stream they cannot read, counting it as a version of the stream', () => {
    const kept = pageKeeping.keptAfter(noDefinitions, 'workflow', [{ type: 'page_saved', data: {}, context: {} }]);
    const ofThePlaybook = pageKeeping.keptAfter(noDefinitions, 'playbook', [{ type: 'page_removed', data: {} }]);

    expect([kept.version, kept.functions.size, ofThePlaybook.functions.size]).toEqual([1, 0, 0]);
  });

  it('are none before any stream is read', () => {
    expect(pageKeeping.together('playbook/acme/alpha/', new Map()).functions.size).toBe(0);
  });
});
