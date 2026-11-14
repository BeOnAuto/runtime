import { Result } from 'effect';
import { parseDocument } from 'yaml';

import { splitDocument } from '../document/document-split.ts';
import { subjectOf, textsOfPackage } from './package-texts.ts';
import { packageDigest, portablePackageOf, type PortableDefinition, type PortablePackage } from './portable-package.ts';
import { findingsIn, type Finding } from './value-scan.ts';

export interface NeededConnection {
  readonly server: string;
  readonly used_by: readonly string[];
}

export interface PortableNeeds {
  readonly connections: readonly NeededConnection[];
  readonly types: readonly string[];
  readonly models: readonly string[];
}

function fieldOf(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const found: unknown = Object.getOwnPropertyDescriptor(value, key)?.value;
  return found;
}

function yamlOf(text: string): unknown {
  const document = parseDocument(text);
  if (document.errors.length > 0) return undefined;
  const read: unknown = document.toJS();
  return read;
}

function frontMatterOf(definition: PortableDefinition): unknown {
  if (definition.type === 'workflow') return yamlOf(definition.source);
  const parts = splitDocument(definition.source, 'The definition');
  return Result.isSuccess(parts) ? yamlOf(parts.success.frontMatter) : undefined;
}

function textsIn(value: unknown): string[] {
  return typeof value === 'string' && value.length > 0 ? [value] : [];
}

function serversNamedIn(front: unknown): string[] {
  const tools = fieldOf(front, 'tools');
  return [
    ...['call', 'deliver', 'replies'].flatMap((block) => textsIn(fieldOf(fieldOf(front, block), 'server'))),
    ...(Array.isArray(tools) ? tools : []).flatMap((tool) =>
      textsIn(tool).flatMap((written) => textsIn(written.split('/')[0])),
    ),
  ];
}

interface Use {
  readonly server: string;
  readonly subject: string;
}

interface Read {
  readonly subject: string;
  readonly front: unknown;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].toSorted((left, right) => (left < right ? -1 : 1));
}

export function needsOf(definitions: readonly PortableDefinition[]): PortableNeeds {
  const fronts = definitions.map((definition): Read => ({
    subject: subjectOf(definition),
    front: frontMatterOf(definition),
  }));
  const uses = fronts.flatMap(({ subject, front }: Read) =>
    serversNamedIn(front).map((server): Use => ({ server, subject })),
  );
  const models = fronts.flatMap(({ front }: Read) => textsIn(fieldOf(front, 'model')));
  return {
    connections: sortedUnique(uses.map(({ server }: Use) => server)).map((server) => ({
      server,
      used_by: sortedUnique(uses.filter((use: Use) => use.server === server).map(({ subject }: Use) => subject)),
    })),
    types: sortedUnique(definitions.map(({ type }) => type)),
    models: sortedUnique(models),
  };
}

export interface PortableExport extends PortablePackage {
  readonly digest: string;
  readonly needs: PortableNeeds;
  readonly findings: readonly Finding[];
}

export function portableExportOf(written: PortablePackage): PortableExport {
  const portable = portablePackageOf(written);
  return {
    ...portable,
    digest: packageDigest(portable),
    needs: needsOf(portable.definitions),
    findings: findingsIn(textsOfPackage(portable)),
  };
}
