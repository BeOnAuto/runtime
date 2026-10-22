import { readFileSync } from 'node:fs';

import { shippedFilesOnDisk } from '@on.auto/operations/shipped-files-on-disk';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  documentsBesideTheEntries,
  manifestIn,
  manifestNamesIn,
  type DocumentManifest,
} from '../translating/document-manifests.ts';

const RequirementsSchema = Schema.Array(Schema.Record(Schema.String, Schema.Unknown));

const OperationSchema = Schema.Struct({
  operationId: Schema.String,
  security: Schema.optionalKey(RequirementsSchema),
});

const decodeOperations = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      security: RequirementsSchema,
      paths: Schema.Record(Schema.String, Schema.Record(Schema.String, OperationSchema)),
      components: Schema.Struct({ securitySchemes: Schema.Record(Schema.String, Schema.Unknown) }),
    }),
  ),
);

type Held = ReturnType<typeof heldBy>;

function heldBy(name: string) {
  const { security, paths, components } = decodeOperations(
    readFileSync(new URL(`${name}.openapi.json`, documentsBesideTheEntries), 'utf8'),
  );
  const operations = Object.values(paths).flatMap((methods) => Object.values(methods));
  const requirements = [...security, ...operations.flatMap((operation) => operation.security ?? [])];
  return {
    operations: operations.map(({ operationId }) => operationId).toSorted(),
    schemes: Object.keys(components.securitySchemes),
    required: [...new Set(requirements.flatMap((requirement) => Object.keys(requirement)))],
  };
}

interface Named {
  readonly kept: readonly string[];
  readonly scheme: string;
  readonly sources: readonly string[];
}

function namesOf(manifest: DocumentManifest): Named {
  if (manifest.type === 'discovery') {
    return { kept: manifest.methods, scheme: 'oauth2', sources: [manifest.discovery] };
  }
  if (manifest.type === 'openapi') {
    return { kept: manifest.operations, scheme: manifest.scheme.name, sources: manifest.sources };
  }
  return {
    kept: manifest.sources.flatMap(({ operations }) => operations),
    scheme: 'oauth2',
    sources: manifest.sources.map(({ address }) => address),
  };
}

interface Kept {
  readonly name: string;
  readonly manifest: DocumentManifest;
}

const manifests: readonly Kept[] = await Promise.all(
  (await manifestNamesIn(shippedFilesOnDisk, documentsBesideTheEntries)).map(async (name) => ({
    name,
    manifest: await manifestIn(shippedFilesOnDisk, documentsBesideTheEntries, name),
  })),
);

function namedBy(manifest: DocumentManifest): Held {
  const { kept, scheme } = namesOf(manifest);
  return { operations: kept.toSorted(), schemes: [scheme], required: [scheme] };
}

function addressesOf(manifest: DocumentManifest): readonly string[] {
  return [...namesOf(manifest).sources, manifest.authorization_server];
}

describe('the manifests beside the entries', () => {
  it('are each one the command reads, of one of its kinds, keeping each operation once, at https addresses', () => {
    const kept: readonly (readonly string[])[] = manifests.map(({ manifest }) => namedBy(manifest).operations);

    expect(kept.map(({ length }) => length)).toEqual(kept.map((operations) => new Set(operations).size));
    expect(
      manifests.flatMap(({ manifest }) => addressesOf(manifest)).filter((address) => !address.startsWith('https://')),
    ).toEqual([]);
    expect(manifests.map(({ manifest }) => manifest.type).toSorted()).toEqual([
      ...Array.from({ length: manifests.length - 3 }, () => 'discovery'),
      'openapi',
      'openapi',
      'swagger',
    ]);
  });

  it('each have their document beside them, whose operations are those they keep, all requiring the one scheme they name', () => {
    expect(manifests.map(({ name }) => heldBy(name))).toEqual(manifests.map(({ manifest }) => namedBy(manifest)));
  });
});
