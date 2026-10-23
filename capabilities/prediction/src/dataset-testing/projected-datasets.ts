import { shippedFilesOnDisk } from '@on.auto/operations/shipped-files-on-disk';
import { filterSandboxOf, freshInstances, sandboxModuleIn, sandboxShippedRoots } from '@on.auto/workflow-engine/dsl';
import { someFolder } from '@on.auto/workflow-host';
import { projectedFolders, type DatabaseSettings, type ProjectedFolders } from '@on.auto/workflow-host/testing';
import { Effect, Option, Result, type Schema } from 'effect';
import { expect, onTestFinished, vi } from 'vitest';

import { datasetDetailsOf } from '../capability/prediction-definitions.ts';
import { datasetFolder, datasetsOf, type DatasetFolding } from '../dataset/dataset-folder.ts';
import type { DatasetRow } from '../dataset/dataset-rows.ts';
import { parsePredictionDocument } from '../document/document-parsing.ts';

const sandboxFiles = shippedFilesOnDisk(sandboxShippedRoots);

const sandboxModule = await sandboxModuleIn(sandboxFiles);

export const alphaKey = 'playbook/acme/alpha/';

const savedAt = '2026-10-06T09:00:00.000Z';

const waiting = { timeout: 25_000, interval: 20 };

const eventsInAnAppend = 1000;

type Document = ReturnType<typeof documentOf>;

export interface ProjectedDatasets extends ProjectedFolders {
  readonly saved: (name: string, source: string) => Promise<Document>;
  readonly retired: (name: string) => Promise<void>;
  readonly published: (events: readonly Schema.JsonObject[]) => Promise<void>;
  readonly datasets: () => Promise<readonly DatasetRow[]>;
  readonly until: (dataSha256: string, holds: (row: DatasetRow) => boolean) => Promise<DatasetRow>;
  readonly gone: (dataSha256: string) => Promise<void>;
  readonly noted: (count: number) => Promise<ReturnType<ProjectedFolders['notes']>>;
}

function documentOf(source: string) {
  return Result.getOrThrow(parsePredictionDocument(source));
}

function contextOf(name: string, version: number) {
  return {
    by: 'acme-admin',
    at: savedAt,
    definitionType: 'prediction',
    definitionName: name,
    definitionVersion: version,
  };
}

function definitionsOf(folders: ProjectedFolders): Pick<ProjectedDatasets, 'saved' | 'retired'> {
  const versions = new Map<string, number>();
  const stream = `${alphaKey}definitions/prediction`;
  return {
    saved: async (name, source) => {
      const document = documentOf(source);
      const version = (versions.get(name) ?? 0) + 1;
      versions.set(name, version);
      const content = { source, details: datasetDetailsOf(document) };
      const type = version === 1 ? 'definition_created' : 'definition_updated';
      await folders.append(stream, [{ type, data: { content } }], contextOf(name, version));
      return document;
    },
    retired: async (name) => {
      const ended = [{ type: 'definition_retired', data: {} }];
      await folders.append(stream, ended, contextOf(name, Number(versions.get(name))));
    },
  };
}

function readingOf(folders: ProjectedFolders): Pick<ProjectedDatasets, 'datasets' | 'until' | 'gone'> {
  const datasets = () => Effect.runPromise(datasetsOf(folders.database, alphaKey));
  const named = async (dataSha256: string) => (await datasets()).filter((row) => row.dataSha256 === dataSha256);
  return {
    datasets,
    until: (dataSha256, holds) =>
      vi.waitFor(async () => {
        const held = (await named(dataSha256)).filter((row) => holds(row));
        expect(held).toHaveLength(1);
        return Option.getOrThrow(Option.fromNullishOr(held[0]));
      }, waiting),
    gone: (dataSha256) =>
      vi.waitFor(async () => {
        expect(await named(dataSha256)).toEqual([]);
      }, waiting),
  };
}

type Folding = Partial<Omit<DatasetFolding, 'filters'>>;

export function testDatasetFolder(folding: Folding = {}): ReturnType<typeof datasetFolder> {
  return datasetFolder({
    filters: filterSandboxOf(freshInstances(sandboxModule)),
    triesBeforeStall: Number.POSITIVE_INFINITY,
    ...folding,
  });
}

export async function projectedDatasets(settings: DatabaseSettings, folding: Folding = {}): Promise<ProjectedDatasets> {
  const folder = testDatasetFolder(folding);
  const folders = await projectedFolders(settings, [someFolder(folder)]);
  onTestFinished(folders.close);
  return {
    ...folders,
    ...definitionsOf(folders),
    ...readingOf(folders),
    noted: (count) =>
      vi.waitFor(() => {
        expect(folders.notes().length).toBeGreaterThanOrEqual(count);
        return folders.notes();
      }, waiting),
    published: async (events) => {
      const published = events.map((event) => ({ type: 'event_published', data: { event, filled: [] } }));
      const firsts = Array.from(
        { length: Math.ceil(published.length / eventsInAnAppend) },
        (_, index) => index * eventsInAnAppend,
      );
      await firsts.reduce<Promise<unknown>>(
        (before, first) =>
          before.then(() =>
            folders.append(
              `${alphaKey}events/${crypto.randomUUID()}`,
              published.slice(first, first + eventsInAnAppend),
              {
                by: 'acme-admin',
                at: savedAt,
              },
            ),
          ),
        Promise.resolve(),
      );
    },
  };
}
