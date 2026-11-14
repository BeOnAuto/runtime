import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildDependenciesOf, cratesCompiledIn, cratesListed, treeArguments } from './crates-listed.ts';

const normalListing = [
  'cedar-wasm v4.14.0 (/work/cedar/cedar-wasm)',
  'cedar-policy-core v4.14.0 (/work/cedar/cedar-policy-core)',
  'serde v1.0.229',
  'serde_derive v1.0.229 (proc-macro)',
  'serde v1.0.229 (*)',
  'lalrpop-util v0.22.2',
  '',
].join('\n');

const builtListing = [normalListing, 'lalrpop v0.22.2', 'petgraph v0.7.1', 'cc v1.6.0', ''].join('\n');

const metadata = JSON.stringify({
  packages: [
    { id: 'core', name: 'cedar-policy-core', version: '4.14.0', source: null },
    { id: 'lalrpop', name: 'lalrpop', version: '0.22.2' },
    { id: 'prost-build', name: 'prost-build', version: '0.14.1' },
    { id: 'petgraph', name: 'petgraph', version: '0.7.1' },
    { id: 'psm', name: 'psm', version: '0.1.32' },
    { id: 'cc', name: 'cc', version: '1.6.0' },
    { id: 'serde', name: 'serde', version: '1.0.229' },
  ],
  resolve: {
    nodes: [
      {
        id: 'core',
        deps: [
          { pkg: 'lalrpop', dep_kinds: [{ kind: 'build', target: null }] },
          { pkg: 'prost-build', dep_kinds: [{ kind: 'build', target: null }] },
          { pkg: 'serde', dep_kinds: [{ kind: null, target: null }] },
        ],
      },
      { id: 'lalrpop', deps: [{ pkg: 'petgraph', dep_kinds: [{ kind: null, target: null }] }] },
      { id: 'psm', deps: [{ pkg: 'cc', dep_kinds: [{ kind: 'build', target: null }] }] },
    ],
  },
});

const answers: Readonly<Record<string, string>> = { metadata, normal: normalListing, 'normal,build': builtListing };

function answerTo(commandArguments: readonly string[]): string {
  const [first = ''] = commandArguments;
  const asked = first === 'tree' ? (commandArguments[commandArguments.indexOf('--edges') + 1] ?? '') : first;
  return answers[asked] ?? '';
}

await test('cargo tree lists each crate once, in order, a path crate with its folder, whatever cargo marks beside it', () => {
  assert.deepEqual(cratesListed(normalListing), [
    { name: 'cedar-policy-core', version: '4.14.0', folder: '/work/cedar/cedar-policy-core' },
    { name: 'cedar-wasm', version: '4.14.0', folder: '/work/cedar/cedar-wasm' },
    { name: 'lalrpop-util', version: '0.22.2', folder: undefined },
    { name: 'serde', version: '1.0.229', folder: undefined },
    { name: 'serde_derive', version: '1.0.229', folder: undefined },
  ]);
  assert.throws(() => cratesListed('a line cargo never prints\n'), /cannot read: a line cargo never prints/u);
});

await test('the listing asks cargo for the root with the features given, or its default features when none are', () => {
  assert.deepEqual(treeArguments({ packageName: 'std', features: ['backtrace', 'panic-unwind'] }, 'normal'), [
    'tree',
    '--frozen',
    '--target',
    'wasm32-unknown-unknown',
    '--package',
    'std',
    '--features',
    'backtrace panic-unwind',
    '--edges',
    'normal',
    '--prefix',
    'none',
    '--no-dedupe',
    '--format',
    '{p}',
  ]);
  assert.ok(!treeArguments({ packageName: 'cedar-wasm', features: [] }, 'normal').includes('--features'));
});

await test('the build dependencies are those of the crates named, never of the crates they reach', () => {
  assert.deepEqual(
    [...buildDependenciesOf(metadata, new Set(['cedar-policy-core 4.14.0']))],
    ['lalrpop 0.22.2', 'prost-build 0.14.1'],
  );
});

await test("the crates compiled in are the normal dependencies and the build dependencies of the root's own crates that its build resolves", () => {
  const asked: string[] = [];
  const compiled = cratesCompiledIn({ packageName: 'cedar-wasm', features: [] }, (commandArguments) => {
    asked.push(commandArguments.join(' '));
    return answerTo(commandArguments);
  });

  assert.deepEqual(compiled.generators, ['lalrpop 0.22.2']);
  assert.deepEqual(
    compiled.crates.map(({ name }) => name),
    ['cedar-policy-core', 'cedar-wasm', 'lalrpop', 'lalrpop-util', 'serde', 'serde_derive'],
  );
  assert.equal(asked.length, 3);
});
