import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { Schema } from 'effect';

import { crateKey, type ListedCrate } from './crates-listed.ts';

const AboutSchema = Schema.Struct({
  licenses: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      text: Schema.String,
      used_by: Schema.Array(
        Schema.Struct({
          crate: Schema.Struct({
            name: Schema.String,
            version: Schema.String,
            license: Schema.NullOr(Schema.String),
            authors: Schema.Array(Schema.String),
            manifest_path: Schema.String,
          }),
        }),
      ),
    }),
  ),
});

const decodeAbout = Schema.decodeUnknownSync(Schema.fromJsonString(AboutSchema));

export interface PackageFile {
  readonly name: string;
  readonly text: string;
}

export interface TakenLicence {
  readonly id: string;
  readonly file: string | undefined;
  readonly text: string;
}

export interface CrateNotice {
  readonly name: string;
  readonly version: string;
  readonly declared: string;
  readonly taken: readonly TakenLicence[];
  readonly copyright: readonly string[];
  readonly authors: readonly string[];
  readonly notices: readonly PackageFile[];
}

export interface Gathered {
  readonly name: string;
  readonly version: string;
  readonly declared: string;
  readonly authors: readonly string[];
  readonly folder: string;
  readonly licences: readonly { readonly id: string; readonly text: string }[];
}

const licenceFileName = /^(?:licen[cs]e|copying|copyright|notice|unlicense)/iu;

const noticeFileName = /^notice/iu;

const licenceTextFileName = /^(?:licen[cs]e|copying|unlicense)/iu;

const copyrightLine = /^\s*(?:Copyright|COPYRIGHT|©)(?:\s*(?:\(c\)|\(C\)|©))?\s+(?!AND\b)(?=[\d\p{Lu}])/u;

export function licenceFilesIn(folder: string): readonly PackageFile[] {
  return readdirSync(folder)
    .filter((name) => licenceFileName.test(name) && statSync(join(folder, name)).isFile())
    .toSorted()
    .map((name) => ({ name, text: readFileSync(join(folder, name), 'utf8') }));
}

export function copyrightLinesIn(files: readonly PackageFile[]): readonly string[] {
  const lines = files.flatMap(({ text }) => text.split('\n').filter((line) => copyrightLine.test(line)));
  return [...new Set(lines.map((line) => line.trim()))];
}

export function gatheredByCargoAbout(json: string): ReadonlyMap<string, Gathered> {
  const gathered = new Map<string, Gathered>();
  for (const { id, text, used_by: usedBy } of decodeAbout(json).licenses) {
    for (const { crate } of usedBy) {
      const key = crateKey(crate);
      const known = gathered.get(key);
      gathered.set(key, {
        name: crate.name,
        version: crate.version,
        declared: crate.license ?? 'none declared',
        authors: crate.authors,
        folder: dirname(crate.manifest_path),
        licences: [...(known?.licences ?? []), { id, text }],
      });
    }
  }
  return gathered;
}

function requireTheTextsHeld(
  gathered: Readonly<Gathered>,
  taken: readonly TakenLicence[],
  files: readonly PackageFile[],
) {
  const licenceFiles = files.filter(({ name }) => licenceTextFileName.test(name)).map(({ name }) => name);
  const unheld = taken.filter(({ file }) => file === undefined).map(({ id }) => id);
  if (licenceFiles.length > 0 && unheld.length > 0) {
    throw new Error(
      `${crateKey(gathered)} carries ${licenceFiles.join(', ')}, but none holds the text cargo-about took for ${unheld.join(', ')}: name its licence file in a clarification of scripts/cedar-notices/about.toml`,
    );
  }
}

function crateNoticeOf(gathered: Readonly<Gathered>, files: readonly PackageFile[]): CrateNotice {
  const taken = gathered.licences.map(({ id, text }) => ({
    id,
    file: files.find((file) => file.text === text)?.name,
    text,
  }));
  requireTheTextsHeld(gathered, taken, files);
  return {
    name: gathered.name,
    version: gathered.version,
    declared: gathered.declared,
    taken,
    copyright: copyrightLinesIn(files),
    authors: gathered.authors,
    notices: files.filter(({ name }) => noticeFileName.test(name)),
  };
}

export function crateNotices(
  listed: readonly ListedCrate[],
  gathered: ReadonlyMap<string, Gathered>,
): readonly CrateNotice[] {
  return listed.map((crate) => {
    const found = gathered.get(crateKey(crate));
    if (found === undefined) {
      throw new Error(`cargo-about gathered no licence for ${crateKey(crate)}, which cargo tree lists`);
    }
    return crateNoticeOf(found, licenceFilesIn(found.folder));
  });
}
