import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { noticesPath } from './cedar-notices.ts';
import type { CrateNotice } from './crate-notices.ts';
import { noticesText, type NoticesFile } from './notices-text.ts';

const mit = 'MIT License\n\nCopyright (c) 2015 Andrew Gallant\n\nPermission is hereby granted.\n';

function crate(name: string, notice: Partial<CrateNotice>): CrateNotice {
  return {
    name,
    version: '1.0.0',
    declared: 'MIT OR Apache-2.0',
    taken: [{ id: 'MIT', file: 'LICENSE-MIT', text: mit }],
    copyright: ['Copyright (c) 2015 Andrew Gallant'],
    authors: ['Andrew Gallant'],
    notices: [],
    ...notice,
  };
}

const memchr = crate('memchr', { declared: 'Unlicense OR MIT' });

const notices: NoticesFile = {
  cedarVersion: '4.14.0',
  commit: '5e54be8a16f3f346eb542e4feca587bfb962ebd1',
  compiler: '1.99.1 (58cf8f9c3 2026-10-13)',
  cargoAbout: 'cargo-about 0.9.3',
  ownCrates: ['cedar-policy', 'cedar-wasm'],
  generators: ['lalrpop 0.22.2'],
  crates: [
    crate('aho-corasick', {}),
    memchr,
    crate('gloo-utils', {
      taken: [{ id: 'MIT', file: undefined, text: 'MIT License\n\nCopyright (c) <year> <copyright holders>\n' }],
      copyright: [],
      authors: ['Rust and WebAssembly Working Group'],
    }),
    crate('miette', {
      declared: 'Apache-2.0',
      taken: [{ id: 'Apache-2.0', file: 'LICENSE', text: 'Apache License\nVersion 2.0, January 2004\n' }],
      copyright: [],
      authors: [],
      notices: [{ name: 'NOTICE', text: 'This product includes software by Kat Marchán.\n' }],
    }),
  ],
  library: {
    crates: [
      memchr,
      crate('compiler_builtins', { declared: 'MIT AND Apache-2.0 WITH LLVM-exception AND (MIT OR Apache-2.0)' }),
    ],
    inTreeCrates: ['alloc', 'core', 'std'],
    declared: ['MIT OR Apache-2.0'],
    notice: { lines: ['File/Directory: .', 'License: Apache-2.0 OR MIT'], licenceIds: ['Apache-2.0', 'MIT'] },
    texts: [{ name: 'MIT', text: 'The MIT text of the release\n' }],
  },
};

const text = noticesText(notices);

await test('the header names the package, the tag and its commit, the compiler, the tool, and counts the crates and their licences once each', () => {
  assert.match(text, /^Third-party notices of Cedar's WebAssembly\n/u);
  assert.match(
    text,
    /@cedar-policy\/cedar-wasm 4\.14\.0\. Cedar's own licence and notice, which cover Cedar's own crates \(cedar-policy and cedar-wasm\)/u,
  );
  assert.match(text, /at the tag v4\.14\.0, commit 5e54be8a16f3f346eb542e4feca587bfb962ebd1/u);
  assert.match(text, /whose output is compiled in \(lalrpop 0\.22\.2\)/u);
  assert.match(text, /as rustc 1\.99\.1 \(58cf8f9c3 2026-10-13\), the compiler/u);
  assert.match(text, /gathered with cargo-about 0\.9\.3/u);
  assert.match(
    text,
    /5 crates, beside the 3 the Rust standard library holds in its own tree\. Licences taken, with the number of crates: MIT, 4; Apache-2\.0, 1\./u,
  );
  assert.ok(text.endsWith('\n'));
});

await test('each crate gives what it declares and what is taken from which file, and a text already printed is named, not repeated', () => {
  assert.match(
    text,
    /aho-corasick 1\.0\.0\nLicence declared: MIT OR Apache-2\.0\nLicence taken: MIT, from its file LICENSE-MIT\nCopyright lines in its licence files: Copyright \(c\) 2015 Andrew Gallant\n\nMIT License/u,
  );
  assert.match(
    text,
    /memchr 1\.0\.0\nLicence declared: Unlicense OR MIT\nLicence taken: MIT, from its file LICENSE-MIT, the same text as for aho-corasick 1\.0\.0 above\n/u,
  );
  assert.equal(text.split('Permission is hereby granted.').length, 2);
});

await test('a crate without a licence file or a copyright line says so, names its authors, and gives its notice', () => {
  assert.match(
    text,
    /Licence taken: MIT, its package carries no file for this licence, so this is the licence's standard text\nNo copyright line in its package\. Authors, by name, as its package declares them: Rust and WebAssembly Working Group/u,
  );
  assert.match(text, /No copyright line in its package, and it declares no author by name\n\nApache License/u);
  assert.match(text, /Its NOTICE:\n\nThis product includes software by Kat Marchán\./u);
});

function attributionWritten(authors: readonly string[]): string {
  const written = noticesText({
    ...notices,
    crates: [crate('serde', { copyright: [], authors })],
    library: { ...notices.library, crates: [] },
  });
  return written.split('\n').find((line) => line.startsWith('No copyright line in its package')) ?? '';
}

await test('an author is named without the address a package may declare beside the name, and one declared by an address alone is left out', () => {
  assert.equal(
    attributionWritten(['Ada Lovelace <ada@example.com>', 'Rust and WebAssembly Working Group', '<build@example.com>']),
    'No copyright line in its package. Authors, by name, as its package declares them: Ada Lovelace, Rust and WebAssembly Working Group',
  );
  assert.equal(
    attributionWritten(['<build@example.com>']),
    'No copyright line in its package, and it declares no author by name',
  );
});

await test('the notices the repository ships name each author as the writer does, whatever address the package declares beside the name', () => {
  const shipped = readFileSync(noticesPath, 'utf8')
    .split('\n')
    .filter((line) => line.startsWith('No copyright line in its package'));
  const rewritten = shipped.map((line) => {
    const names = line.split(' as its package declares them: ').slice(1).join('').split(', ');
    return attributionWritten(names.map((name) => `${name} <someone@example.com>`));
  });

  assert.ok(shipped.length > 0);
  assert.deepEqual(rewritten, shipped);
});

await test("the standard library's part names a crate of part 1 once, then gives Rust's own notice for its tree and the texts it names", () => {
  assert.match(text, /memchr 1\.0\.0: as in part 1/u);
  assert.match(
    text,
    /compiler_builtins 1\.0\.0\nLicence declared: MIT AND Apache-2\.0 WITH LLVM-exception AND \(MIT OR Apache-2\.0\)/u,
  );
  assert.match(text, /its crates in the Rust tree: alloc, core and std\nLicence declared: MIT OR Apache-2\.0\n/u);
  assert.match(
    text,
    /under "In-tree files":\n\nFile\/Directory: \.\nLicense: Apache-2\.0 OR MIT\n\nMIT, from share\/doc\/rust\/licenses of that release:\n\nThe MIT text of the release\n$/u,
  );
});
