import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { cedarNoticesText, type Place, type Run } from './cedar-notices.ts';

interface Packaged {
  readonly name: string;
  readonly version: string;
  readonly license: string;
  readonly folder: string;
  readonly text: string;
}

interface Asked {
  readonly command: string;
  readonly commandArguments: readonly string[];
  readonly place: Place;
}

const inTreeHtml = [
  '<h2 id="in-tree-files">In-tree files</h2>',
  '<div><p><b>File/Directory:</b> <code>.</code></p><p><b>License:</b> Apache-2.0 OR MIT</p></div>',
  '<h2 id="out-of-tree-dependencies">Out-of-tree dependencies</h2>',
].join('\n');

function written(folder: string, files: Readonly<Record<string, string>>): string {
  mkdirSync(folder, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(folder, name), text);
  }
  return folder;
}

function aboutJson(packaged: readonly Packaged[]): string {
  return JSON.stringify({
    licenses: packaged.map(({ name, version, license, folder, text }) => ({
      id: 'MIT',
      name: 'MIT License',
      text,
      source_path: null,
      used_by: [{ crate: { name, version, license, authors: [], manifest_path: join(folder, 'Cargo.toml') } }],
    })),
  });
}

function metadataJson(packages: readonly string[], buildDependencies: Readonly<Record<string, string>>): string {
  return JSON.stringify({
    packages: packages.map((key) => ({ id: key, name: key.split(' ')[0], version: key.split(' ')[1] })),
    resolve: {
      nodes: Object.entries(buildDependencies).map((edge: readonly [string, string]) => ({
        id: edge[0],
        deps: [{ pkg: edge[1], dep_kinds: [{ kind: 'build' }] }],
      })),
    },
  });
}

function withWork(verify: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'cedar-notices-work-'));
  try {
    verify(root);
  } finally {
    rmSync(root, { recursive: true });
  }
}

function fakeCargo(root: string): Run {
  const cedar = join(root, 'cedar');
  const library = join(root, 'sysroot/lib/rustlib/src/rust/library');
  const serde = written(join(root, 'registry/serde-1.0.229'), { 'LICENSE-MIT': 'serde MIT\n' });
  const lalrpop = written(join(root, 'registry/lalrpop-0.22.2'), { 'LICENSE-MIT': 'lalrpop MIT\n' });
  const dlmalloc = written(join(library, 'vendor/dlmalloc-0.2.14'), { 'LICENSE-MIT': 'dlmalloc MIT\n' });
  written(join(library, 'compiler-builtins'), { 'LICENSE.txt': 'Copyright (c) 2009-2016 by the contributors\n' });
  const cedarListing = `cedar-wasm v4.14.0 (${cedar}/cedar-wasm)\nserde v1.0.229\n`;
  const libraryListing = `std v0.0.0 (${library}/std)\ncore v0.0.0 (${library}/core)\ncompiler_builtins v0.1.160 (${library}/compiler-builtins/compiler-builtins)\ndlmalloc v0.2.14\n`;
  const answers: Readonly<Record<string, Readonly<Record<string, string>>>> = {
    cedar: {
      normal: cedarListing,
      'normal,build': `${cedarListing}lalrpop v0.22.2\ncc v1.6.0\n`,
      metadata: metadataJson(['cedar-wasm 4.14.0', 'lalrpop 0.22.2'], { 'cedar-wasm 4.14.0': 'lalrpop 0.22.2' }),
      about: aboutJson([
        { name: 'serde', version: '1.0.229', license: 'MIT OR Apache-2.0', folder: serde, text: 'serde MIT\n' },
        { name: 'lalrpop', version: '0.22.2', license: 'Apache-2.0 OR MIT', folder: lalrpop, text: 'lalrpop MIT\n' },
      ]),
    },
    library: {
      normal: libraryListing,
      'normal,build': libraryListing,
      metadata: metadataJson([], {}),
      about: aboutJson([
        { name: 'std', version: '0.0.0', license: 'MIT OR Apache-2.0', folder: join(library, 'std'), text: 'MIT\n' },
        { name: 'core', version: '0.0.0', license: 'MIT OR Apache-2.0', folder: join(library, 'core'), text: 'MIT\n' },
        {
          name: 'compiler_builtins',
          version: '0.1.160',
          license: 'MIT AND Apache-2.0 WITH LLVM-exception AND (MIT OR Apache-2.0)',
          folder: join(library, 'compiler-builtins/compiler-builtins'),
          text: 'MIT\n',
        },
        { name: 'dlmalloc', version: '0.2.14', license: 'MIT OR Apache-2.0', folder: dlmalloc, text: 'dlmalloc MIT\n' },
      ]),
    },
  };
  return (_command, commandArguments, { folder }) => {
    const [first = '', second = ''] = commandArguments;
    if (second === '--version') {
      return 'cargo-about 0.9.3\n';
    }
    const asked = first === 'tree' ? (commandArguments[commandArguments.indexOf('--edges') + 1] ?? '') : first;
    return answers[folder === library ? 'library' : 'cedar']?.[asked] ?? '';
  };
}

function preparedSysroot(root: string): string {
  const sysroot = join(root, 'sysroot');
  written(join(sysroot, 'share/doc/rust'), { 'COPYRIGHT-library.html': inTreeHtml });
  written(join(sysroot, 'share/doc/rust/licenses'), { 'Apache-2.0.txt': 'Apache text\n', 'MIT.txt': 'MIT text\n' });
  for (const crate of ['std', 'core', 'compiler-builtins/compiler-builtins']) {
    mkdirSync(join(sysroot, 'lib/rustlib/src/rust/library', crate), { recursive: true });
  }
  return sysroot;
}

interface Answering {
  readonly run: Run;
  readonly asked: readonly Asked[];
}

function answering(root: string, tag: string): Answering {
  const cargo = fakeCargo(root);
  const sysroot = preparedSysroot(root);
  const asked: Asked[] = [];
  const run: Run = (command, commandArguments, place) => {
    asked.push({ command, commandArguments, place });
    if (command === 'git') {
      return commandArguments[1] === 'HEAD' ? 'a1b2c3\n' : `${tag}\n`;
    }
    return command === 'rustc' ? `${sysroot}\n` : cargo(command, commandArguments, place);
  };
  return { run, asked };
}

function withSysrootAt(sysroot: string, run: Run): Run {
  return (command, commandArguments, place) =>
    command === 'rustc' ? `${sysroot}\n` : run(command, commandArguments, place);
}

function compilersAsked(asked: readonly Asked[]): readonly string[] {
  return [
    ...new Set(
      asked
        .filter(({ command }) => command === 'cargo' || command === 'rustc')
        .map(({ place }) => place.environment['RUSTUP_TOOLCHAIN'] ?? 'none'),
    ),
  ];
}

function foldersLetReadUnstableManifests(asked: readonly Asked[]): readonly string[] {
  return [
    ...new Set(
      asked.filter(({ place }) => place.environment['RUSTC_BOOTSTRAP'] === '1').map(({ place }) => place.folder),
    ),
  ];
}

await test("the notices list the crates of Cedar's build and of the standard library, each from its own package, with the compiler the module names", () => {
  withWork((root) => {
    const text = cedarNoticesText(join(root, 'cedar'), answering(root, 'a1b2c3').run);

    assert.match(text, /Cedar's own crates \(cedar-wasm\)/u);
    assert.match(text, /whose output is compiled in \(lalrpop 0\.22\.2\)/u);
    assert.match(text, /commit a1b2c3, the crate cedar-wasm/u);
    assert.match(text, /as rustc \d+\.\d+\.\d+ \([0-9a-f]+ \d{4}-\d{2}-\d{2}\), the compiler/u);
    assert.match(
      text,
      /serde 1\.0\.229\nLicence declared: MIT OR Apache-2\.0\nLicence taken: MIT, from its file LICENSE-MIT/u,
    );
    assert.match(text, /lalrpop 0\.22\.2\nLicence declared: Apache-2\.0 OR MIT/u);
    assert.doesNotMatch(text, /cc 1\.6\.0/u);
    assert.match(text, /dlmalloc 0\.2\.14\n/u);
    assert.match(
      text,
      /compiler_builtins 0\.1\.160\n.*\nLicence taken: .*, from its file \.\.\/LICENSE\.txt\nCopyright lines in its licence files: Copyright \(c\) 2009-2016 by the contributors/u,
    );
    assert.match(text, /its crates in the Rust tree: core and std\n/u);
    assert.match(text, /Apache-2\.0, from share\/doc\/rust\/licenses of that release:\n\nApache text/u);
  });
});

await test("only the cargo run in the Rust library is let read its unstable manifest, and every cargo run uses the module's compiler", () => {
  withWork((root) => {
    const { run, asked } = answering(root, 'a1b2c3');
    cedarNoticesText(join(root, 'cedar'), run);

    assert.equal(compilersAsked(asked).length, 1);
    assert.match(compilersAsked(asked).join(''), /^\d+\.\d+\.\d+$/u);
    assert.deepEqual(foldersLetReadUnstableManifests(asked), [join(root, 'sysroot/lib/rustlib/src/rust/library')]);
    assert.ok(asked.some(({ commandArguments }) => commandArguments.join(' ') === 'fetch --locked'));
  });
});

await test("without the library sources of the module's compiler, the script names the toolchain to install", () => {
  withWork((root) => {
    assert.throws(
      () =>
        cedarNoticesText(join(root, 'cedar'), withSysrootAt(join(root, 'no-sysroot'), answering(root, 'a1b2c3').run)),
      /rustup toolchain install \d+\.\d+\.\d+ --profile minimal --component rust-src/u,
    );
  });
});

await test('a clone of Cedar that is not at the tag of the version in use is refused', () => {
  withWork((root) => {
    assert.throws(
      () => cedarNoticesText(join(root, 'cedar'), answering(root, 'ffffff').run),
      /is at a1b2c3, not at the tag v/u,
    );
  });
});
