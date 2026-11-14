import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { compilerVersionOf, inTreeNoticeOf, licenceTextsIn, ownLicenceFiles, producersOf } from './rust-library.ts';

function named(text: string): readonly number[] {
  const bytes = new TextEncoder().encode(text);
  return [bytes.length, ...bytes];
}

function section(id: number, content: readonly number[]): readonly number[] {
  const size =
    content.length < 0x80 ? [content.length] : [0x80 + (content.length % 0x80), Math.floor(content.length / 0x80)];
  return [id, ...size, ...content];
}

const producers = [
  ...named('producers'),
  2,
  ...named('language'),
  1,
  ...named('Rust'),
  ...named(''),
  ...named('processed-by'),
  2,
  ...named('rustc'),
  ...named('1.99.1 (58cf8f9c3 2026-10-13)'),
  ...named('walrus'),
  ...named('0.26.1'),
];

const module = new Uint8Array([
  0x00,
  0x61,
  0x73,
  0x6d,
  0x01,
  0x00,
  0x00,
  0x00,
  ...section(
    1,
    Array.from({ length: 200 }, () => 0),
  ),
  ...section(0, [...named('target_features'), 0]),
  ...section(0, producers),
]);

const inTreeHtml = [
  '<li><a href="#in-tree-files">In-tree files</a></li>',
  '<h2 id="in-tree-files">In-tree files</h2>',
  '<p>The following licenses cover the in-tree source files that were used in this release:</p>',
  '<div style="border:1px solid black; padding: 5px;">',
  '  <p><b>File/Directory:</b> <code>.</code></p>',
  '  <p><b>License:</b> Apache-2.0 OR MIT</p>',
  '  <p><b>Copyright:</b> The Rust Project Developers (see https://thanks.rust-lang.org)</p>',
  '  <p><b>Exceptions:</b></p>',
  '  <div style="border:1px solid black; padding: 5px;">',
  '    <p><b>File/Directory:</b> <code>library/std/src/sys/sync/mutex/fuchsia.rs</code></p>',
  '    <p><b>License:</b> BSD-2-Clause AND (Apache-2.0 OR MIT)</p>',
  '    <p><b>Copyright:</b> 2016 The Fuchsia Authors &amp; &quot;others&quot;</p>',
  '  </div>',
  '</div>',
  '<h2 id="out-of-tree-dependencies">Out-of-tree dependencies</h2>',
].join('\n');

function withFolder(verify: (folder: string) => void): void {
  const folder = mkdtempSync(join(tmpdir(), 'cedar-notices-library-'));
  try {
    verify(folder);
  } finally {
    rmSync(folder, { recursive: true });
  }
}

await test('the producers of a WebAssembly module are read from its custom section of that name, past sections of any size', () => {
  assert.deepEqual(producersOf(module), ['Rust', 'rustc 1.99.1 (58cf8f9c3 2026-10-13)', 'walrus 0.26.1']);
  assert.deepEqual(producersOf(module.subarray(0, 8)), []);
  assert.equal(compilerVersionOf(producersOf(module)), '1.99.1 (58cf8f9c3 2026-10-13)');
  assert.throws(() => compilerVersionOf(['walrus 0.26.1']), /names no rustc/u);
});

await test("Rust's notice of its in-tree files is read as its page shows it, each exception under its file, with the licences it names", () => {
  assert.deepEqual(inTreeNoticeOf(inTreeHtml), {
    lines: [
      'The following licenses cover the in-tree source files that were used in this release:',
      'File/Directory: .',
      'License: Apache-2.0 OR MIT',
      'Copyright: The Rust Project Developers (see https://thanks.rust-lang.org)',
      'Exceptions:',
      '  File/Directory: library/std/src/sys/sync/mutex/fuchsia.rs',
      '  License: BSD-2-Clause AND (Apache-2.0 OR MIT)',
      '  Copyright: 2016 The Fuchsia Authors & "others"',
    ],
    licenceIds: ['Apache-2.0', 'BSD-2-Clause', 'MIT'],
  });
  assert.throws(() => inTreeNoticeOf('<h2>Out-of-tree dependencies</h2>'), /no part for its in-tree files/u);
});

await test('the licence texts are the files of the licences named, as the release ships them', () => {
  withFolder((folder) => {
    writeFileSync(join(folder, 'MIT.txt'), 'MIT License\n');
    assert.deepEqual(licenceTextsIn(folder, ['MIT']), [{ name: 'MIT', text: 'MIT License\n' }]);
  });
});

await test("an in-tree crate's own licence files are the nearest above it inside the workspace, never the workspace's own", () => {
  withFolder((workspace) => {
    mkdirSync(join(workspace, 'compiler-builtins', 'compiler-builtins'), { recursive: true });
    mkdirSync(join(workspace, 'core'));
    writeFileSync(join(workspace, 'compiler-builtins', 'LICENSE.txt'), 'compiler-builtins licence\n');
    writeFileSync(join(workspace, 'LICENSE'), 'the workspace licence\n');

    assert.deepEqual(ownLicenceFiles(join(workspace, 'compiler-builtins', 'compiler-builtins'), workspace), [
      { name: '../LICENSE.txt', text: 'compiler-builtins licence\n' },
    ]);
    assert.deepEqual(ownLicenceFiles(join(workspace, 'core'), workspace), []);
  });
});
