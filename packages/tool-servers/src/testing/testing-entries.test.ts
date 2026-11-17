import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { importedWithoutAnAddress } from '@on.auto/operations/testing';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { fakeStdioServerPath } from './served-fakes.ts';

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

describe('the testing entries of the tool servers', () => {
  it('load where import.meta.url names no file, and name the stdio server a test runs only when it asks', async () => {
    const [testing, served] = await Promise.all([
      importedWithoutAnAddress(new URL('./index.ts', import.meta.url)),
      importedWithoutAnAddress(new URL('./served-fakes.ts', import.meta.url)),
    ]);

    expect(Object.keys(testing)).toContain('fakeMcpAnswers');
    expect(Object.keys(served)).toContain('fakeStdioServerPath');
    expect(fakeStdioServerPath()).toBe(fileURLToPath(new URL('../mcp-testing/fake-stdio-server.ts', import.meta.url)));
  });
});
