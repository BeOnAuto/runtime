import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

const repository = fileURLToPath(new URL('../../../../', import.meta.url));

const dockerfile = readFileSync(join(repository, 'packages/server/Dockerfile'), 'utf8');

const manifestOf = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      name: Schema.String,
      dependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
    }),
  ),
);

type Manifest = ReturnType<typeof manifestOf>;

const workspace: ReadonlyMap<string, { readonly directory: string; readonly manifest: Manifest }> = new Map(
  ['packages', 'capabilities'].flatMap((group) =>
    readdirSync(join(repository, group))
      .map((name) => join(group, name))
      .filter((directory) => existsSync(join(repository, directory, 'package.json')))
      .map((directory): readonly [string, { readonly directory: string; readonly manifest: Manifest }] => {
        const manifest = manifestOf(readFileSync(join(repository, directory, 'package.json'), 'utf8'));
        return [manifest.name, { directory, manifest }];
      }),
  ),
);

function workspaceDependenciesOf(name: string): readonly string[] {
  const dependencies = workspace.get(name)?.manifest.dependencies ?? {};
  return Object.entries(dependencies)
    .filter(([, specification]: readonly [string, string]) => specification.startsWith('workspace:'))
    .map(([dependency]: readonly [string, string]) => dependency);
}

function reachedFrom(name: string, reached: ReadonlySet<string> = new Set()): ReadonlySet<string> {
  if (reached.has(name)) {
    return reached;
  }
  return workspaceDependenciesOf(name).reduce<ReadonlySet<string>>(
    (known, dependency) => reachedFrom(dependency, known),
    new Set([...reached, name]),
  );
}

function directoryOf(name: string): string {
  const found = workspace.get(name);
  if (found === undefined) {
    throw new Error(`No workspace package is named ${name}`);
  }
  return found.directory;
}

const shippedDirectories = [...reachedFrom('@on.auto/server')].map((name) => directoryOf(name)).toSorted();

describe('the image', () => {
  it('installs the manifest and copies the sources of every workspace package the server reaches', () => {
    const missingManifests = shippedDirectories.filter(
      (directory) => !dockerfile.includes(`COPY ${directory}/package.json ${directory}/\n`),
    );
    const missingSources = shippedDirectories.filter(
      (directory) => !dockerfile.includes(`COPY ${directory}/src ${directory}/src\n`),
    );
    expect(shippedDirectories.length).toBeGreaterThan(15);
    expect({ missingManifests, missingSources }).toEqual({ missingManifests: [], missingSources: [] });
  });
});
