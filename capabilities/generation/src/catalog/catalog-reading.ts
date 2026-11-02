import { placeIn, pointerOf, readYaml, type Position, type YamlKind } from '@on.auto/config';
import {
  shippedFileIn,
  shippedFileName,
  type ShippedFile,
  type ShippedFiles,
  type ShippedRoots,
} from '@on.auto/shipped-files';
import { Data, Result, Schema, SchemaIssue, type StandardSchema } from 'effect';

import { entrySchemas, fileNameOf, KindOfAnEntrySchema, type CatalogEntry } from './catalog-entry.ts';
import { catalogOf, type GenerationCatalog } from './generation-catalog.ts';

export class CatalogInvalid extends Data.TaggedError('generation_catalog_invalid')<{ readonly message: string }> {}

interface Problem {
  readonly pointer: string;
  readonly detail: string;
}

interface Located {
  readonly place: string;
  readonly detail: string;
}

type PathSegment = PropertyKey | StandardSchema.StandardSchemaV1.PathSegment;

const generationPackage = '@on.auto/generation';

export function generationShippedRoots(): ShippedRoots {
  return { [generationPackage]: new URL('../../', import.meta.url) };
}

export const shippedCatalog: ShippedFile = { package: generationPackage, path: 'src/catalog' };

const entryYaml: YamlKind = {
  noun: "a model's entry",
  mapping: "A model's entry is a mapping of its fields",
  mostDepth: 8,
  emptyIsMapping: false,
};

const strictly = { errors: 'all', onExcessProperty: 'error' } as const;

const decodeKind = Schema.decodeUnknownResult(KindOfAnEntrySchema, { errors: 'all' });

const decoders = {
  image: Schema.decodeUnknownResult(entrySchemas.image, strictly),
  audio: Schema.decodeUnknownResult(entrySchemas.audio, strictly),
  video: Schema.decodeUnknownResult(entrySchemas.video, strictly),
};

const formatIssues = SchemaIssue.makeFormatterStandardSchemaV1();

function isPropertyKey(segment: PathSegment): segment is PropertyKey {
  return typeof segment !== 'object';
}

function problemsOf({ issue }: { readonly issue: SchemaIssue.Issue }): readonly Problem[] {
  return formatIssues(issue).issues.map(({ message, path = [] }) => ({
    pointer: pointerOf(path.filter((segment) => isPropertyKey(segment))),
    detail: message,
  }));
}

function entryOf(value: unknown): Result.Result<CatalogEntry, readonly Problem[]> {
  const kind = decodeKind(value);
  if (Result.isFailure(kind)) {
    return Result.fail(problemsOf(kind.failure));
  }
  const decoded: Result.Result<CatalogEntry, Schema.SchemaError> = decoders[kind.success.kind](value);
  return Result.mapError(decoded, problemsOf);
}

function namedForItsFile(entry: CatalogEntry, file: string): Result.Result<CatalogEntry, readonly Problem[]> {
  const named = fileNameOf(entry.model);
  return file === named
    ? Result.succeed(entry)
    : Result.fail([{ pointer: '/model', detail: `Expected the model the file is named for, as in ${named}` }]);
}

interface Reading {
  readonly shippedFiles: ShippedFiles;
  readonly folder: ShippedFile;
}

async function readEntry({ shippedFiles, folder }: Reading, file: string) {
  const at = shippedFileIn(folder, file);
  const name = shippedFileName(at);
  const reading = readYaml(await shippedFiles.text(at), entryYaml);
  if ('problems' in reading) {
    return Result.fail(
      reading.problems.map(({ position, detail }): Located => ({ place: placeIn(name, position, ''), detail })),
    );
  }
  const { document } = reading;
  const located = ({ pointer, detail }: Problem): Located => {
    const position: Position = document.locate(pointer);
    return { place: placeIn(name, position, pointer), detail };
  };
  return Result.mapError(
    Result.flatMap(entryOf(document.value), (entry) => namedForItsFile(entry, file)),
    (problems) => problems.map((problem) => located(problem)),
  );
}

function byModel(one: CatalogEntry, other: CatalogEntry): number {
  return one.model < other.model ? -1 : 1;
}

function placeOfTheEntry(folder: ShippedFile, model: string): string {
  return shippedFileName(shippedFileIn(folder, fileNameOf(model)));
}

function invalid(located: readonly Located[]): CatalogInvalid {
  const listed = located.map(({ place, detail }) => `${place}: ${detail}`).join('; ');
  return new CatalogInvalid({ message: `The catalogue of generation models is invalid: ${listed}` });
}

export async function readGenerationCatalog(
  shippedFiles: ShippedFiles,
  folder: ShippedFile = shippedCatalog,
): Promise<Result.Result<GenerationCatalog, CatalogInvalid>> {
  const files = (await shippedFiles.list(folder)).filter((file) => file.endsWith('.yaml'));
  const read = await Promise.all(files.map((file) => readEntry({ shippedFiles, folder }, file)));
  const located: Located[] = [];
  const entries: CatalogEntry[] = [];
  for (const each of read) {
    if (Result.isFailure(each)) {
      located.push(...each.failure);
    } else {
      entries.push(each.success);
    }
  }
  if (located.length > 0) {
    return Result.fail(invalid(located));
  }
  return Result.mapError(catalogOf(entries.toSorted(byModel)), (problems) =>
    invalid(problems.map(({ model, detail }) => ({ place: placeOfTheEntry(folder, model), detail }))),
  );
}
