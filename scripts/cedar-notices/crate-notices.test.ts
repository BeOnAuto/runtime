import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { copyrightLinesIn, crateNotices, gatheredByCargoAbout, licenceFilesIn } from './crate-notices.ts';

const mitText = 'MIT License\n\nCopyright (c) 2015 Andrew Gallant\n\nPermission is hereby granted, free of charge.\n';

const apacheText = [
  '                                 Apache License',
  '   copyright notice that is included in or attached to the work',
  '   (c) You must retain, in the Source form of any Derivative Works',
  '   Copyright [yyyy] [name of copyright owner]',
  '',
].join('\n');

const unicodeText = 'COPYRIGHT AND PERMISSION NOTICE\n\nCopyright © 1991-2023 Unicode, Inc.\n';

function withPackages(verify: (folder: string) => void): void {
  const folder = mkdtempSync(join(tmpdir(), 'cedar-notices-crates-'));
  try {
    mkdirSync(join(folder, 'memchr-2.8.3'));
    writeFileSync(join(folder, 'memchr-2.8.3', 'LICENSE-MIT'), mitText);
    writeFileSync(join(folder, 'memchr-2.8.3', 'LICENSE-APACHE'), apacheText);
    writeFileSync(join(folder, 'memchr-2.8.3', 'LICENSE-UNICODE'), unicodeText);
    writeFileSync(join(folder, 'memchr-2.8.3', 'NOTICE'), 'This product includes software by Andrew Gallant.\n');
    writeFileSync(join(folder, 'memchr-2.8.3', 'README.md'), 'Copyright (c) 2015 Andrew Gallant\n');
    mkdirSync(join(folder, 'memchr-2.8.3', 'LICENSES'));
    mkdirSync(join(folder, 'gloo-utils-0.2.0'));
    verify(folder);
  } finally {
    rmSync(folder, { recursive: true });
  }
}

function aboutOutput(folder: string): string {
  const memchr = {
    name: 'memchr',
    version: '2.8.3',
    license: 'Unlicense OR MIT',
    authors: ['Andrew Gallant'],
    manifest_path: join(folder, 'memchr-2.8.3', 'Cargo.toml'),
  };
  const glooUtils = {
    name: 'gloo-utils',
    version: '0.2.0',
    license: 'MIT OR Apache-2.0',
    authors: ['Rust and WebAssembly Working Group'],
    manifest_path: join(folder, 'gloo-utils-0.2.0', 'Cargo.toml'),
  };
  return JSON.stringify({
    overview: [],
    crates: [],
    licenses: [
      { id: 'MIT', name: 'MIT License', text: mitText, source_path: null, used_by: [{ crate: memchr, path: null }] },
      {
        id: 'MIT',
        name: 'MIT License',
        text: 'MIT License\n\nCopyright (c) <year> <copyright holders>\n',
        source_path: null,
        used_by: [{ crate: glooUtils, path: null }],
      },
      { id: 'Unicode-3.0', name: 'Unicode', text: unicodeText, source_path: null, used_by: [{ crate: memchr }] },
    ],
  });
}

await test("a package's licence files are its files named for a licence, a copyright or a notice, never a folder or a readme", () => {
  withPackages((folder) => {
    assert.deepEqual(
      licenceFilesIn(join(folder, 'memchr-2.8.3')).map(({ name }) => name),
      ['LICENSE-APACHE', 'LICENSE-MIT', 'LICENSE-UNICODE', 'NOTICE'],
    );
  });
});

await test("the copyright lines are the statements of a copyright, not a licence's words about copyright or its template", () => {
  assert.deepEqual(
    copyrightLinesIn([
      { name: 'LICENSE-APACHE', text: apacheText },
      { name: 'LICENSE-MIT', text: mitText },
      { name: 'COPYRIGHT', text: `${mitText}${unicodeText}Copyright 2018 Developers of the Rand project\n` },
    ]),
    [
      'Copyright (c) 2015 Andrew Gallant',
      'Copyright © 1991-2023 Unicode, Inc.',
      'Copyright 2018 Developers of the Rand project',
    ],
  );
});

await test('each crate takes the licences cargo-about gathered for it, named by its own file that holds the text, its copyright lines and its notice', () => {
  withPackages((folder) => {
    const gathered = gatheredByCargoAbout(aboutOutput(folder));
    const [memchr, glooUtils] = crateNotices(
      [
        { name: 'memchr', version: '2.8.3', folder: undefined },
        { name: 'gloo-utils', version: '0.2.0', folder: undefined },
      ],
      gathered,
    );

    assert.deepEqual(
      memchr?.taken.map(({ id, file }) => [id, file]),
      [
        ['MIT', 'LICENSE-MIT'],
        ['Unicode-3.0', 'LICENSE-UNICODE'],
      ],
    );
    assert.equal(memchr?.declared, 'Unlicense OR MIT');
    assert.deepEqual(memchr?.copyright, ['Copyright (c) 2015 Andrew Gallant', 'Copyright © 1991-2023 Unicode, Inc.']);
    assert.deepEqual(
      memchr?.notices.map(({ name }) => name),
      ['NOTICE'],
    );
    assert.deepEqual(
      glooUtils?.taken.map(({ file }) => file),
      [undefined],
    );
    assert.deepEqual(glooUtils?.authors, ['Rust and WebAssembly Working Group']);
    assert.throws(
      () => crateNotices([{ name: 'regex', version: '1.13.1', folder: undefined }], gathered),
      /cargo-about gathered no licence for regex 1\.13\.1/u,
    );
  });
});

await test('a crate that declares no licence is named so', () => {
  withPackages((folder) => {
    const output = aboutOutput(folder).replace('"license":"MIT OR Apache-2.0"', '"license":null');
    assert.equal(gatheredByCargoAbout(output).get('gloo-utils 0.2.0')?.declared, 'none declared');
  });
});

await test('a crate whose package carries a licence file that holds none of the texts taken stops the script, until a clarification names its file', () => {
  withPackages((folder) => {
    writeFileSync(
      join(folder, 'gloo-utils-0.2.0', 'LICENSE_MIT'),
      'Copyright (c) 2018 Madono Haru\n\nPermission is hereby\ngranted.\n',
    );

    assert.throws(
      () =>
        crateNotices(
          [{ name: 'gloo-utils', version: '0.2.0', folder: undefined }],
          gatheredByCargoAbout(aboutOutput(folder)),
        ),
      /gloo-utils 0\.2\.0 carries LICENSE_MIT, but none holds the text cargo-about took for MIT: name its licence file in a clarification/u,
    );
  });
});
