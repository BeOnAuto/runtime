import { execFileSync } from 'node:child_process';

import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

const nodeServing = ['node:http', 'node:stream'];

const theNodeModulesItLoads = `
import { registerHooks } from 'node:module';
const loaded = new Set();
registerHooks({
  resolve: (specifier, context, nextResolve) => {
    const answer = nextResolve(specifier, context);
    if (answer.url.startsWith('node:')) {
      loaded.add(answer.url);
    }
    return answer;
  },
});
await import(process.argv[1]);
process.stdout.write(JSON.stringify([...loaded].sort()));
`;

const decodeLoaded = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.String)));

function nodeModulesLoadedBy(entry: string): readonly string[] {
  const href = new URL(entry, import.meta.url).href;
  return decodeLoaded(
    execFileSync(process.execPath, ['--input-type=module', '--eval', theNodeModulesItLoads, href], {
      encoding: 'utf8',
    }),
  );
}

describe('the testing entries, each loaded in a process of its own', () => {
  it('leave the HTTP server and the streams of Node to the served fakes, whatever imports them, a module of the runtime or a package it takes, so the testing entry checks under web-standard types', () => {
    const [ofTheTesting, ofTheServed] = [nodeModulesLoadedBy('./index.ts'), nodeModulesLoadedBy('./served-fakes.ts')];

    expect(nodeServing.filter((name) => ofTheTesting.includes(name))).toEqual([]);
    expect(nodeServing.filter((name) => ofTheServed.includes(name))).toEqual(nodeServing);
  });
});
