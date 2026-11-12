import { credentialShapesIn } from '@on.auto/config';
import { documentInText } from '@on.auto/tool-servers';
import { Option, Result, Schema } from 'effect';

import {
  ConnectionEntrySchema,
  bytesOfText,
  mostDocumentTextBytes,
  type ConnectionType,
} from '../registry/connection-entry.ts';

export const AddedEntrySchema = Schema.Struct({
  ...ConnectionEntrySchema.fields,
  document_text: Schema.optionalKey(
    Schema.String.annotate({
      description: `The OpenAPI document itself, version 3.0 or 3.1, as JSON or YAML of at most ${mostDocumentTextBytes.toLocaleString('en-US')} bytes, in place of document; its calls go to base_url alone, never to an address inside it; never a secret`,
    }),
  ),
}).annotate({ description: 'The tool server, without its credential' });

type AddedEntry = typeof AddedEntrySchema.Type;

interface DocumentGiven {
  readonly type?: ConnectionType;
  readonly entry?: AddedEntry;
}

const theDocumentText = ['entry', 'document_text'];

const documentWords = {
  missing:
    'Expected document, the https URL of the OpenAPI document of the HTTP API, or document_text, the document itself, one of the two',
  both: 'Expected document or document_text, not both: document is the address of the OpenAPI document, document_text the document itself',
  unbased:
    'Expected base_url, which an HTTP API given its document in document_text takes: every call goes there, since no address written inside the document is taken',
  notWellFormed: 'Expected text of well-formed Unicode, which UTF-8 carries',
  ofAnMcpServer: 'Not a field of an mcp server',
  heldCredential: (pointer: string) =>
    `At ${pointer} of the document: Looks like a credential, which a document given in document_text never holds: the person gives it on the page the link opens`,
  tooLarge: (bytes: number) =>
    `The document takes ${bytes.toLocaleString('en-US')} bytes, more than the ${mostDocumentTextBytes.toLocaleString('en-US')} a document given in document_text may take; describe only the calls the job needs`,
} as const;

const proseOfAnOpenApiDocument = ['description', 'summary', 'title'];

const asJson = Schema.decodeUnknownOption(Schema.Json);

function heldCredentialIssuesOf(text: string): readonly Schema.FilterIssue[] {
  return Option.toArray(asJson(Result.getOrUndefined(documentInText(text))))
    .flatMap((value) => credentialShapesIn(value, '', proseOfAnOpenApiDocument))
    .map(({ pointer }) => ({ path: theDocumentText, issue: documentWords.heldCredential(pointer) }));
}

function documentTextIssuesOf(text: string): readonly Schema.FilterIssue[] {
  if (!text.isWellFormed()) {
    return [{ path: theDocumentText, issue: documentWords.notWellFormed }];
  }
  const bytes = bytesOfText(text);
  return bytes > mostDocumentTextBytes
    ? [{ path: theDocumentText, issue: documentWords.tooLarge(bytes) }]
    : heldCredentialIssuesOf(text);
}

export function documentIssuesOf({ type, entry }: DocumentGiven): readonly Schema.FilterIssue[] {
  if (entry === undefined || type === undefined) {
    return [];
  }
  const { document, document_text: text, base_url: baseUrl } = entry;
  if (type === 'mcp') {
    return text === undefined ? [] : [{ path: theDocumentText, issue: documentWords.ofAnMcpServer }];
  }
  if (text === undefined) {
    return document === undefined ? [{ path: ['entry'], issue: documentWords.missing }] : [];
  }
  return [
    ...(document === undefined ? [] : [{ path: theDocumentText, issue: documentWords.both }]),
    ...(baseUrl === undefined ? [{ path: ['entry', 'base_url'], issue: documentWords.unbased }] : []),
    ...documentTextIssuesOf(text),
  ];
}
