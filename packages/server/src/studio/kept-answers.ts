import { createHash, randomUUID } from 'node:crypto';
import { lstat, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { cacheFolderProblem } from '@on.auto/operations';
import { Function, Option, Schema } from 'effect';

export interface KeptAnswer {
  readonly key: string;
  readonly contentType: string | undefined;
  readonly etag: string | undefined;
  readonly lastModified: string | undefined;
  readonly keptAt: number;
  readonly freshUntil: number;
  readonly body: Readonly<Uint8Array>;
}

export interface KeptAnswers {
  readonly answerAt: (key: string) => Promise<KeptAnswer | undefined>;
  readonly keep: (answer: KeptAnswer) => Promise<void>;
}

export interface Keeping {
  readonly mostBytes: number;
  readonly report: (problem: string) => void;
}

const KeptHeadSchema = Schema.fromJsonString(
  Schema.Struct({
    key: Schema.String,
    contentType: Schema.optionalKey(Schema.String),
    etag: Schema.optionalKey(Schema.String),
    lastModified: Schema.optionalKey(Schema.String),
    keptAt: Schema.Number,
    freshUntil: Schema.Number,
    sha256: Schema.String,
  }),
);

const headOf = Schema.decodeUnknownOption(KeptHeadSchema);

export const markerName = '.kept-by-auto-runtime';

const markerText = 'Auto Runtime keeps here the files of the Studio it serves, and may remove them.\n';

const keptName = /^[0-9a-f]{64}$/u;

const partialName = /^\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

const fileMode = 0o600;

const endOfHead = 0x0a;

function sha256Of(bytes: Readonly<Uint8Array> | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function attempted(work: Promise<unknown>): Promise<void> {
  return work.then(Function.constVoid, Function.constVoid);
}

function fileOf(directory: string, key: string): string {
  return join(directory, sha256Of(key));
}

function fileBytesOf({ body, ...answer }: KeptAnswer): Buffer {
  const head = JSON.stringify({ ...answer, sha256: sha256Of(body) });
  return Buffer.concat([Buffer.from(`${head}\n`), body]);
}

function readBack(name: string, bytes: Readonly<Buffer>): KeptAnswer | undefined {
  const end = bytes.indexOf(endOfHead);
  const head = Option.getOrUndefined(headOf(bytes.subarray(0, Math.max(end, 0)).toString()));
  const body = new Uint8Array(bytes.subarray(end + 1));
  if (head === undefined || sha256Of(head.key) !== name || sha256Of(body) !== head.sha256) {
    return undefined;
  }
  const { key, contentType, etag, lastModified, keptAt, freshUntil } = head;
  return { key, contentType, etag, lastModified, keptAt, freshUntil, body };
}

type Entry = 'kept' | 'partial' | 'foreign';

async function entryOf(directory: string, name: string): Promise<Entry> {
  const found = await lstat(join(directory, name));
  if (!found.isFile()) {
    return 'foreign';
  }
  if (keptName.test(name)) {
    return 'kept';
  }
  return partialName.test(name) ? 'partial' : 'foreign';
}

async function keptIn(directory: string, name: string): Promise<readonly KeptAnswer[]> {
  const file = join(directory, name);
  const kept = readBack(name, await readFile(file));
  if (kept === undefined) {
    await attempted(unlink(file));
    return [];
  }
  return [kept];
}

type Opening = { readonly kept: readonly KeptAnswer[] } | { readonly problem: string };

async function openedFrom(directory: string, names: readonly string[]): Promise<Opening> {
  const ours = names.filter((name) => name !== markerName);
  const entries = await Promise.all(ours.map((name) => entryOf(directory, name)));
  const foreign = ours.find((_name, index) => entries[index] === 'foreign');
  if (foreign !== undefined) {
    return { problem: `the folder ${directory} holds ${foreign}, which Auto Runtime did not write there` };
  }
  await Promise.all(
    ours.flatMap((name, index) => (entries[index] === 'partial' ? [attempted(unlink(join(directory, name)))] : [])),
  );
  const kept = await Promise.all(
    ours.flatMap((name, index) => (entries[index] === 'kept' ? [keptIn(directory, name)] : [])),
  );
  return { kept: kept.flat().toSorted((one, other) => one.keptAt - other.keptAt) };
}

async function opened(directory: string): Promise<Opening> {
  const existed = await lstat(directory).then(
    () => true,
    () => false,
  );
  const problem = await cacheFolderProblem(directory);
  if (problem !== undefined) {
    return { problem: `the folder ${directory} ${problem}` };
  }
  if (!existed) {
    await writeFile(join(directory, markerName), markerText, { mode: fileMode });
    return { kept: [] };
  }
  const names = await readdir(directory);
  return names.includes(markerName)
    ? openedFrom(directory, names)
    : { problem: `the folder ${directory} holds no ${markerName}, which Auto Runtime writes in the folders it makes` };
}

async function writtenIn(directory: string, answer: KeptAnswer): Promise<void> {
  const partial = join(directory, `.${randomUUID()}`);
  await writeFile(partial, fileBytesOf(answer), { mode: fileMode });
  await rename(partial, fileOf(directory, answer.key));
}

interface Shelf {
  readonly write: (answer: KeptAnswer) => Promise<void>;
  readonly remove: (keys: readonly string[]) => Promise<void>;
}

const inMemoryAlone: Shelf = {
  write: () => Promise.resolve(),
  remove: () => Promise.resolve(),
};

function shelfIn(directory: string): Shelf {
  return {
    write: (answer) => attempted(writtenIn(directory, answer)),
    remove: (keys) => attempted(Promise.all(keys.map((key) => unlink(fileOf(directory, key))))),
  };
}

async function shelfOf(
  directory: string | undefined,
  report: Keeping['report'],
): Promise<{ readonly shelf: Shelf; readonly kept: readonly KeptAnswer[] }> {
  if (directory === undefined) {
    return { shelf: inMemoryAlone, kept: [] };
  }
  const opening = await opened(directory).catch((failure: unknown) => ({
    problem: `the folder ${directory} could not be read: ${String(failure)}`,
  }));
  if ('problem' in opening) {
    report(opening.problem);
    return { shelf: inMemoryAlone, kept: [] };
  }
  return { shelf: shelfIn(directory), kept: opening.kept };
}

function oldestBeyond(answers: ReadonlyMap<string, KeptAnswer>, mostBytes: number): readonly string[] {
  let left = [...answers.values()].reduce((sum, { body }) => sum + body.byteLength, 0);
  const gone: string[] = [];
  for (const [key, { body }] of answers) {
    if (left > mostBytes) {
      gone.push(key);
      left -= body.byteLength;
    }
  }
  return gone;
}

export function keptAnswersIn(directory: string | undefined, { mostBytes, report }: Keeping): KeptAnswers {
  const answers = new Map<string, KeptAnswer>();
  const shelving: { shelf: Shelf } = { shelf: inMemoryAlone };
  const leaving = async () => {
    const gone = oldestBeyond(answers, mostBytes);
    for (const key of gone) {
      answers.delete(key);
    }
    await shelving.shelf.remove(gone);
  };
  const openedShelf = async () => {
    const { shelf, kept } = await shelfOf(directory, report);
    shelving.shelf = shelf;
    for (const answer of kept) {
      answers.set(answer.key, answer);
    }
    await leaving();
  };
  const opening: { ready?: Promise<void> } = {};
  const ready = () => (opening.ready ??= openedShelf());
  return {
    answerAt: async (key) => {
      await ready();
      return answers.get(key);
    },
    keep: async (answer) => {
      await ready();
      answers.delete(answer.key);
      answers.set(answer.key, answer);
      await shelving.shelf.write(answer);
      await leaving();
    },
  };
}
