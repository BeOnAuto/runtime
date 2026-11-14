import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { Schema } from 'effect';

import {
  copyrightLinesIn,
  crateNotices,
  gatheredByCargoAbout,
  type CrateNotice,
  type Gathered,
} from './crate-notices.ts';
import { cratesCompiledIn, crateKey, wasmTarget, type Cargo, type ListedCrate } from './crates-listed.ts';
import { noticesText, type LibraryNotice } from './notices-text.ts';
import { compilerVersionOf, inTreeNoticeOf, licenceTextsIn, ownLicenceFiles, producersOf } from './rust-library.ts';

export interface Place {
  readonly folder: string;
  readonly environment: Readonly<Record<string, string>>;
}

export type Run = (command: string, commandArguments: readonly string[], place: Readonly<Place>) => string;

const runtimeFolder = resolve(import.meta.dirname, '../..');

const cedarPackage = join(runtimeFolder, 'packages/access-control/node_modules/@cedar-policy/cedar-wasm');

export const noticesPath = join(runtimeFolder, 'packages/access-control/src/engine/Cedar-THIRD-PARTY-NOTICES.txt');

const aboutConfig = join(import.meta.dirname, 'about.toml');

const libraryFeatures = ['backtrace', 'panic-unwind'];

const decodePackage = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ version: Schema.String })));

function gatheredBy(cargo: Cargo, manifest: string, features: readonly string[]): ReadonlyMap<string, Gathered> {
  const chosen = features.length === 0 ? [] : ['--features', features.join(' ')];
  return gatheredByCargoAbout(
    cargo([
      'about',
      'generate',
      '--fail',
      '--format',
      'json',
      '--frozen',
      '--manifest-path',
      manifest,
      '--target',
      wasmTarget,
      '--config',
      aboutConfig,
      ...chosen,
    ]),
  );
}

function withOwnLicenceFiles(
  inTree: readonly ListedCrate[],
  library: string,
  gathered: ReadonlyMap<string, Gathered>,
): readonly CrateNotice[] {
  return inTree.flatMap((crate) => {
    const found = gathered.get(crateKey(crate));
    const declared = found?.declared ?? 'none declared';
    const files = ownLicenceFiles(crate.folder ?? library, library);
    const taken = files.map(({ name, text }) => ({ id: declared, file: name, text }));
    const copyright = copyrightLinesIn(files);
    const authors = found?.authors ?? [];
    return files.length === 0
      ? []
      : [{ name: crate.name, version: crate.version, declared, taken, copyright, authors, notices: [] }];
  });
}

function libraryNotice(sysroot: string, cargo: Cargo): LibraryNotice {
  const library = join(sysroot, 'lib/rustlib/src/rust/library');
  const { crates } = cratesCompiledIn({ packageName: 'std', features: libraryFeatures }, cargo);
  const gathered = gatheredBy(cargo, 'std/Cargo.toml', libraryFeatures);
  const inTree = crates.filter(({ folder }) => folder !== undefined);
  const ownFiles = withOwnLicenceFiles(inTree, library, gathered);
  const underRustNotice = inTree.filter((crate) => !ownFiles.some(({ name }) => name === crate.name));
  const notice = inTreeNoticeOf(readFileSync(join(sysroot, 'share/doc/rust/COPYRIGHT-library.html'), 'utf8'));
  return {
    crates: [
      ...crateNotices(
        crates.filter(({ folder }) => folder === undefined),
        gathered,
      ),
      ...ownFiles,
    ],
    inTreeCrates: underRustNotice.map(({ name }) => name),
    declared: [...new Set(underRustNotice.map((crate) => gathered.get(crateKey(crate))?.declared ?? 'none declared'))],
    notice,
    texts: licenceTextsIn(join(sysroot, 'share/doc/rust/licenses'), notice.licenceIds),
  };
}

function checkedCommit(cedarFolder: string, cedarVersion: string, run: Run): string {
  const place = { folder: cedarFolder, environment: {} };
  const commit = run('git', ['rev-parse', 'HEAD'], place).trim();
  const tagged = run('git', ['rev-parse', `v${cedarVersion}^{commit}`], place).trim();
  if (commit !== tagged) {
    throw new Error(`${cedarFolder} is at ${commit}, not at the tag v${cedarVersion} (${tagged})`);
  }
  return commit;
}

export function cedarNoticesText(cedarFolder: string, run: Run): string {
  const cedarVersion = decodePackage(readFileSync(join(cedarPackage, 'package.json'), 'utf8')).version;
  const commit = checkedCommit(cedarFolder, cedarVersion, run);
  const compiler = compilerVersionOf(producersOf(readFileSync(join(cedarPackage, 'web/cedar_wasm_bg.wasm'))));
  const toolchain = { RUSTUP_TOOLCHAIN: compiler.split(' ')[0] ?? compiler };
  const sysroot = run('rustc', ['--print', 'sysroot'], { folder: runtimeFolder, environment: toolchain }).trim();
  if (!existsSync(join(sysroot, 'lib/rustlib/src/rust/library'))) {
    throw new Error(
      `The WebAssembly was compiled by rustc ${compiler}: rustup toolchain install ${toolchain.RUSTUP_TOOLCHAIN} --profile minimal --component rust-src`,
    );
  }
  const inCedar: Cargo = (commandArguments) =>
    run('cargo', commandArguments, { folder: cedarFolder, environment: toolchain });
  const inLibrary: Cargo = (commandArguments) =>
    run('cargo', commandArguments, {
      folder: join(sysroot, 'lib/rustlib/src/rust/library'),
      environment: { ...toolchain, RUSTC_BOOTSTRAP: '1' },
    });
  inCedar(['fetch', '--locked']);
  const cedar = cratesCompiledIn({ packageName: 'cedar-wasm', features: [] }, inCedar);
  return noticesText({
    cedarVersion,
    commit,
    compiler,
    cargoAbout: inCedar(['about', '--version']).trim(),
    ownCrates: cedar.crates.filter(({ folder }) => folder !== undefined).map(({ name }) => name),
    generators: cedar.generators,
    crates: crateNotices(
      cedar.crates.filter(({ folder }) => folder === undefined),
      gatheredBy(inCedar, 'cedar-wasm/Cargo.toml', []),
    ),
    library: libraryNotice(sysroot, inLibrary),
  });
}

function runInPlace(command: string, commandArguments: readonly string[], place: Readonly<Place>): string {
  return execFileSync(command, commandArguments, {
    cwd: place.folder,
    encoding: 'utf8',
    env: { ...process.env, CARGO_TERM_COLOR: 'never', ...place.environment },
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

if (import.meta.main) {
  const [cedarFolder] = process.argv.slice(2);
  if (cedarFolder === undefined) {
    throw new Error('Name the folder of a clone of github.com/cedar-policy/cedar at the tag of the version in use');
  }
  const text = cedarNoticesText(resolve(cedarFolder), runInPlace);
  writeFileSync(noticesPath, text);
  process.stdout.write(`Wrote ${noticesPath}, ${text.length} characters\n`);
}
