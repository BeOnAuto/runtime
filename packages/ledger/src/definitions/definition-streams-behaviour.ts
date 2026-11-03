import { describe, expect, it, onTestFinished } from 'vitest';

import { stamped } from '../testing/happenings.ts';
import type { LedgerEntry } from '../testing/ledger-entry.ts';

const created = [{ type: 'definition_created', data: { name: 'reviews' } }];

export function definitionStreamsBehaviour(entry: LedgerEntry): void {
  describe('the definition streams of a type', () => {
    it("are the streams of that type of definition in every playbook, the playbook's own page among them, each with its version, read through an index of their own", async () => {
      const database = await entry.aDatabase();
      const store = entry.storeOn(database);
      onTestFinished(() => store.close());
      await store.migrate();
      await store.append('playbook/acme/alpha/definitions/page', [...created, ...created], {
        expectedVersion: 0,
        context: stamped,
      });
      await store.append('playbook/acme/beta/definitions/page', created, { expectedVersion: 0, context: stamped });
      await store.append('playbook/acme/alpha/definitions/reasoning', created, {
        expectedVersion: 0,
        context: stamped,
      });
      await store.append('playbook/acme/alpha/runs/run-1', created, { expectedVersion: 0, context: stamped });
      await store.append('playbook/acme/gamma/notes/definitions/page', created, {
        expectedVersion: 0,
        context: stamped,
      });
      await store.append('playbook/acme/gamma/definitions/page/nested', created, {
        expectedVersion: 0,
        context: stamped,
      });
      await store.append('org/acme/definitions', created, { expectedVersion: 0, context: stamped });
      await store.append(
        'playbook/acme/alpha/definitions/playbook',
        [{ type: 'playbook_page_saved', data: { page: null } }],
        {
          expectedVersion: 0,
          context: stamped,
        },
      );

      expect(await store.definitionStreams('page')).toEqual([
        { stream: 'playbook/acme/alpha/definitions/page', version: 2 },
        { stream: 'playbook/acme/beta/definitions/page', version: 1 },
      ]);
      expect(await store.definitionStreams('computation')).toEqual([]);
      expect(await store.definitionStreams('playbook')).toEqual([
        { stream: 'playbook/acme/alpha/definitions/playbook', version: 1 },
      ]);
      expect(await entry.definitionStreamsIndexed(database)).toBe(true);
    });
  });
}
