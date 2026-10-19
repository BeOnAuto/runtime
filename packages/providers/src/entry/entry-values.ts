import { credentialProblems, referencedVariablesOf, substituted } from '@on.auto/config';
import { isPinnableUrl } from '@on.auto/tool-servers';
import { JsonPointer, Schema } from 'effect';

import { setCombinationsOf, setNamesOfEach, type Placeholder } from './placeholders.ts';
import { marked, templatedFieldsOf, type TemplatedField } from './templates.ts';

interface Written {
  readonly name: string;
  readonly url?: string;
  readonly document?: string;
  readonly base_url?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly query_params?: Readonly<Record<string, string>>;
  readonly request_id?: string;
  readonly placeholders?: Readonly<Record<string, Placeholder>>;
  readonly credentials: readonly { readonly issuer?: string }[];
}

type EntryIssue = Schema.FilterIssue;

const heldCredential =
  "Looks like a credential, which a provider's entry never holds: the person gives the credential on the page a connection's link opens";

const misplacedReference =
  "Holds a reference, which only a header or a query value of a provider's entry holds, for a value whoever runs Auto sets";

export const pinnedTemplateShape =
  'Expected an https URL, or an http URL on a loopback address, written out up to its host, with each placeholder in its place';

const startsWithItsScheme = /^[a-z][a-z0-9+.-]*:\/\//iu;

const asJson = Schema.decodeUnknownSync(Schema.Json);

type Placed = ReadonlyMap<string, string>;

function localDocumentOf(name: string): string {
  return `documents/${name}.openapi.json`;
}

function documentElsewhere(name: string): string {
  return `${pinnedTemplateShape}, or ${localDocumentOf(name)}, the document beside the entries named for the provider`;
}

function pathOf(pointer: string): readonly string[] {
  return pointer
    .split('/')
    .slice(1)
    .map((token) => JsonPointer.unescapeToken(token));
}

function issuesAt(pointers: readonly string[], issue: string): readonly EntryIssue[] {
  return [...new Set(pointers)].map((pointer) => ({ path: pathOf(pointer), issue }));
}

function serverPartOf({
  url,
  document,
  base_url,
  headers,
  query_params,
  request_id,
  credentials,
}: Written): Schema.Json {
  const fields = { url, document, base_url, headers, query_params, request_id };
  const issuers = credentials.map(({ issuer }) => (issuer === undefined ? {} : { issuer }));
  return asJson({
    ...Object.fromEntries(
      Object.entries(fields).filter(([, value]: readonly [string, unknown]) => value !== undefined),
    ),
    credentials: issuers,
  });
}

function isAValue(pointer: string): boolean {
  return pointer.startsWith('/headers/') || pointer.startsWith('/query_params/');
}

function referenceIssuesOf(written: Written): readonly EntryIssue[] {
  const server = serverPartOf(written);
  const everyVariableSet = Object.fromEntries(referencedVariablesOf(server).map((name) => [name, name]));
  const resolved = substituted(server, '', everyVariableSet);
  return [
    ...resolved.problems.flatMap(({ pointer, detail }) => issuesAt([pointer], detail)),
    ...issuesAt(
      resolved.references.map(({ pointer }) => pointer).filter((pointer) => !isAValue(pointer)),
      misplacedReference,
    ),
  ];
}

function credentialIssuesOf(written: Written): readonly EntryIssue[] {
  const { placeholders = {} } = written;
  const names = [...Object.keys(placeholders), ...setNamesOfEach(placeholders)];
  const pointers = [
    ...credentialProblems('', serverPartOf(written), ''),
    ...credentialProblems('placeholders', asJson(placeholders), '/placeholders', names),
  ].map(({ pointer }) => pointer);
  return issuesAt(pointers, heldCredential);
}

function userInfoOf(url: string): string {
  const { username, password } = new URL(url);
  return `${username}:${password}`;
}

function isWrittenOutUpToItsHost(template: string, placed: Placed): boolean {
  const { text, markers } = marked(template, (name) => placed.get(name));
  return (
    startsWithItsScheme.test(template) &&
    isPinnableUrl(text) &&
    [...markers.keys()].every((marker) => !userInfoOf(text).includes(marker))
  );
}

export function isPinnableTemplate(template: string): boolean {
  return isWrittenOutUpToItsHost(template, new Map());
}

function isTheLocalDocument({ name }: Written, { path, text }: TemplatedField): boolean {
  return path[0] === 'document' && text === localDocumentOf(name);
}

function addressIssuesOf(written: Written): readonly EntryIssue[] {
  const combinations = setCombinationsOf(written.placeholders ?? {});
  return templatedFieldsOf(written)
    .filter((field) => field.holds === 'address' && !isTheLocalDocument(written, field))
    .filter(({ text }) => !combinations.every((placed) => isWrittenOutUpToItsHost(text, placed)))
    .map(({ path }) => ({
      path,
      issue: path[0] === 'document' ? documentElsewhere(written.name) : pinnedTemplateShape,
    }));
}

export function writtenIssuesOf(written: Written): readonly EntryIssue[] {
  return [...addressIssuesOf(written), ...referenceIssuesOf(written), ...credentialIssuesOf(written)];
}
