import { describe, expect, it, onTestFinished } from 'vitest';

import { stamped } from '../testing/happenings.ts';
import type { LedgerEntry } from '../testing/ledger-entry.ts';

const created = [{ type: 'definition_created', data: { name: 'reviews' } }];

export function definitionStreamsBehaviour(entry: LedgerEntry): void {
  describe('the definition streams of a type', () => {
    it('are the streams of that type of definition in every playbook, each with its version, read through an index of their own', async () => {
      const database = await entry.aDatabase();
      const store = entry.storeOn(database);
      onTestFinished(() => store.close());
      await store.migrate();
      await store.append('playbook/acme/alpha/definitions/recall', [...created, ...created], {
        expectedVersion: 0,
        context: stamped,
      });
      await store.append('playbook/acme/beta/definitions/recall', created, { expectedVersion: 0, context: stamped });
      await store.append('playbook/acme/alpha/definitions/reasoning', created, {
        expectedVersion: 0,
        context: stamped,
      });
      await store.append('playbook/acme/alpha/runs/run-1', created, { expectedVersion: 0, context: stamped });
      await store.append('playbook/acme/gamma/notes/definitions/recall', created, {
        expectedVersion: 0,
        context: stamped,
      });
      await store.append('playbook/acme/gamma/definitions/recall/nested', created, {
        expectedVersion: 0,
        context: stamped,
      });
      await store.append('org/acme/definitions', created, { expectedVersion: 0, context: stamped });

      expect(await store.definitionStreams('recall')).toEqual([
        { stream: 'playbook/acme/alpha/definitions/recall', version: 2 },
        { stream: 'playbook/acme/beta/definitions/recall', version: 1 },
      ]);
      expect(await store.definitionStreams('computation')).toEqual([]);
      expect(await entry.definitionStreamsIndexed(database)).toBe(true);
    });
  });
}
