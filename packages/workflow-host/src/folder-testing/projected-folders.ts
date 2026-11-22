import { appendSignal, type EncodedEvent } from '@on.auto/ledger';
import type { Context } from '@on.auto/operations';

import type { HostDatabase } from '../database/host-database.ts';
import type { HostNote, HostReports } from '../host/host-reports.ts';
import { openWorkflowStore } from '../host/workflow-store.ts';
import { ledgerConnectedOn, type DatabaseSettings } from '../ledger-testing/ledger-connections.ts';
import type { SomeFolder } from '../projector/folder.ts';
import { recordingReports } from '../testing/recording-reports.ts';
import { projectorOf, type Projector, type ProjectingOptions } from './folding-projector.ts';

export type { ProjectingOptions } from './folding-projector.ts';

export interface ProjectedFolders {
  readonly database: HostDatabase;
  readonly notes: () => readonly HostNote[];
  readonly note: HostReports['note'];
  readonly troubles: () => readonly string[];
  readonly append: (stream: string, events: readonly EncodedEvent[], context: Context) => Promise<void>;
  readonly start: (options?: ProjectingOptions) => void;
  readonly stop: () => Promise<void>;
  readonly close: () => Promise<void>;
}

export async function projectedFolders(
  settings: DatabaseSettings,
  folders: readonly SomeFolder[],
): Promise<ProjectedFolders> {
  const reports = recordingReports();
  const appends = appendSignal();
  const ledger = await ledgerConnectedOn(settings);
  const { database } = await openWorkflowStore(ledger.connection, folders);
  const versions = new Map<string, number>();
  const running: Projector[] = [];
  const stop = async (): Promise<void> => {
    await Promise.all(running.splice(0).map((projector) => projector.stop()));
  };
  return {
    database,
    notes: reports.notes,
    note: reports.reports.note,
    troubles: reports.troubles,
    append: async (stream, events, context) => {
      const expectedVersion = versions.get(stream) ?? 0;
      await database.store.append(stream, events, { expectedVersion, context });
      versions.set(stream, expectedVersion + events.length);
      appends.raise(stream);
    },
    start: (options) => {
      running.push(projectorOf({ database, folders, appends, reports: reports.reports }, options));
    },
    stop,
    close: async () => {
      await stop();
      await ledger.close();
    },
  };
}
