import type { CrateNotice, PackageFile, TakenLicence } from './crate-notices.ts';
import { crateKey } from './crates-listed.ts';
import type { InTreeNotice } from './rust-library.ts';

export interface LibraryNotice {
  readonly crates: readonly CrateNotice[];
  readonly inTreeCrates: readonly string[];
  readonly declared: readonly string[];
  readonly notice: InTreeNotice;
  readonly texts: readonly PackageFile[];
}

export interface NoticesFile {
  readonly cedarVersion: string;
  readonly commit: string;
  readonly compiler: string;
  readonly cargoAbout: string;
  readonly ownCrates: readonly string[];
  readonly generators: readonly string[];
  readonly crates: readonly CrateNotice[];
  readonly library: LibraryNotice;
}

const rule = '-'.repeat(80);

function inTurn(names: readonly string[]): string {
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;
}

interface Count {
  readonly id: string;
  readonly crates: number;
}

function counted(crates: readonly CrateNotice[]): string {
  const counts = new Map<string, number>();
  for (const id of crates.flatMap(({ taken }) => [...new Set(taken.map((licence) => licence.id))])) {
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const inOrder = [...counts.entries()]
    .map((entry: readonly [string, number]): Count => ({ id: entry[0], crates: entry[1] }))
    .toSorted((one: Readonly<Count>, other: Readonly<Count>) =>
      one.crates === other.crates ? one.id.localeCompare(other.id) : other.crates - one.crates,
    );
  return inOrder.map(({ id, crates: count }: Readonly<Count>) => `${id}, ${count}`).join('; ');
}

function headerOf(notices: Readonly<NoticesFile>): string {
  const { library } = notices;
  const unique = new Map([...notices.crates, ...library.crates].map((crate) => [crateKey(crate), crate]));
  return [
    "Third-party notices of Cedar's WebAssembly",
    '',
    `Auto's runtime loads web/cedar_wasm_bg.wasm of the npm package @cedar-policy/cedar-wasm ${notices.cedarVersion}. Cedar's own licence and notice, which cover Cedar's own crates (${inTurn(notices.ownCrates)}), are Cedar-LICENSE.txt and Cedar-NOTICE.txt beside this file. This file gives the notices of every other crate compiled into that WebAssembly, in two parts.`,
    '',
    `1. The crates of Cedar's build: the source of github.com/cedar-policy/cedar at the tag v${notices.cedarVersion}, commit ${notices.commit}, the crate cedar-wasm with its default features for the target wasm32-unknown-unknown, as Cedar's cedar-wasm/build-wasm.sh builds the package, resolved from Cedar's Cargo.lock unchanged: its normal dependencies, and the build dependencies of Cedar's own crates, whose output is compiled in (${inTurn(notices.generators)}). The other build dependencies of the graph run only while it builds and leave no code in it, and development dependencies are not built.`,
    '',
    `2. The Rust standard library, as rustc ${notices.compiler}, the compiler the WebAssembly's producers section names, builds it for that target with the features backtrace and panic-unwind, from its own sources and the crates they vendor.`,
    '',
    `Each licence text and copyright line comes from the crate's own published package, gathered with ${notices.cargoAbout}. Where a crate offers a choice of licences, MIT is taken, as its text in each package carries the crate's copyright line; where a crate declares more than one licence together, each is given. A text printed once is named again below rather than repeated.`,
    '',
    `${unique.size} crates, beside the ${library.inTreeCrates.length} the Rust standard library holds in its own tree. Licences taken, with the number of crates: ${counted([...unique.values()])}.`,
    '',
    'scripts/cedar-notices/cedar-notices.ts of the runtime writes this file; the README of @on.auto/access-control says how.',
  ].join('\n');
}

function takenLine(licence: Readonly<TakenLicence>, sameAs: string | undefined): string {
  const source =
    licence.file === undefined
      ? "its package carries no file for this licence, so this is the licence's standard text"
      : `from its file ${licence.file}`;
  return `Licence taken: ${licence.id}, ${source}${sameAs === undefined ? '' : `, the same text as for ${sameAs} above`}`;
}

const authorAddress = /\s*<[^<>]*>/gu;

function nameOf(author: string): string {
  return author.replace(authorAddress, '').trim();
}

function attributionLine({ copyright, authors }: Readonly<CrateNotice>): string {
  if (copyright.length > 0) {
    return `Copyright lines in its licence files: ${copyright.join(' | ')}`;
  }
  const named = authors.map((author) => nameOf(author)).filter((name) => name.length > 0);
  return named.length > 0
    ? `No copyright line in its package. Authors, by name, as its package declares them: ${named.join(', ')}`
    : 'No copyright line in its package, and it declares no author by name';
}

function crateSection(crate: Readonly<CrateNotice>, printed: Map<string, string>): string {
  const lines = [rule, crateKey(crate), `Licence declared: ${crate.declared}`];
  const texts: string[] = [];
  for (const licence of crate.taken) {
    const sameAs = printed.get(licence.text);
    lines.push(takenLine(licence, sameAs));
    if (sameAs === undefined) {
      printed.set(licence.text, crateKey(crate));
      texts.push(licence.text.trim());
    }
  }
  lines.push(attributionLine(crate));
  const notices = crate.notices.map(({ name, text }) => `Its ${name}:\n\n${text.trim()}`);
  return [lines.join('\n'), ...texts, ...notices].join('\n\n');
}

function librarySection({ library, compiler }: Readonly<NoticesFile>): string {
  return [
    [
      rule,
      `The Rust standard library of rustc ${compiler}, its crates in the Rust tree: ${inTurn(library.inTreeCrates)}`,
      `Licence declared: ${inTurn(library.declared)}`,
      'Licence taken: each licence that Rust\'s own notice names for these files, share/doc/rust/COPYRIGHT-library.html of that release, under "In-tree files":',
    ].join('\n'),
    library.notice.lines.join('\n'),
    ...library.texts.map(
      ({ name, text }) => `${name}, from share/doc/rust/licenses of that release:\n\n${text.trim()}`,
    ),
  ].join('\n\n');
}

export function noticesText(notices: Readonly<NoticesFile>): string {
  const printed = new Map<string, string>();
  const listed = new Set<string>();
  const sectionOf = (crate: Readonly<CrateNotice>) => {
    const key = crateKey(crate);
    const section = listed.has(key) ? `${rule}\n${key}: as in part 1` : crateSection(crate, printed);
    listed.add(key);
    return section;
  };
  return `${[
    headerOf(notices),
    `${'='.repeat(80)}\n1. The crates of Cedar's build`,
    ...notices.crates.map((crate) => sectionOf(crate)),
    `${'='.repeat(80)}\n2. The Rust standard library`,
    ...notices.library.crates.map((crate) => sectionOf(crate)),
    librarySection(notices),
  ].join('\n\n')}\n`;
}
