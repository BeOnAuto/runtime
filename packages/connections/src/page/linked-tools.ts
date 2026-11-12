import { OrgContext, type OrgReader } from '@on.auto/operations';
import { marksMeant, ToolMarkSchema } from '@on.auto/tool-servers';
import { Effect, Schema } from 'effect';

import { toolsOfTheDocument, type DocumentTool } from '../documents/document-tools.ts';
import type { ConnectionServices } from '../operations/connection-services.ts';
import { providingOf } from '../providers/provider-additions.ts';
import type { RecordedConnection } from '../registry/connection.ts';

export type LinkReading = Pick<
  ConnectionServices,
  'consent' | 'pages' | 'providers' | 'providerValues' | 'modelProviders'
>;

const LinkedToolSchema = Schema.Struct({
  name: Schema.String.annotate({ description: 'The name of the tool, which a function writes after the slash' }),
  summary: Schema.String.annotate({
    description:
      'The first sentence of what the tool does, as the document describes it, at most 300 characters, plain: a control character becomes a space, and the bidirectional formatting characters of Unicode UAX #9 are taken out; empty where it describes nothing',
  }),
  mark: ToolMarkSchema.annotate({
    description: `The mark of the tool, by the HTTP method of its operation as the document declares it: ${marksMeant}`,
  }),
}).annotate({ description: 'A tool the document offers, with its mark' });

export const LinkedToolsField = Schema.optionalKey(
  Schema.NullOr(Schema.Array(LinkedToolSchema)).annotate({
    description:
      'For an HTTP API given its OpenAPI document whole, the tools that document offers that its entry allows, by name, read from the document the runtime keeps for the connection, so the page lists them before the person approves; never the text of the document. Null where that document cannot be read, missing or not the one the connection was added with, so nothing the connection could call is known. Left out for every other connection',
  }),
);

interface LinkedTools {
  readonly tools?: readonly DocumentTool[] | null;
}

export function linkedToolsOf(
  connection: RecordedConnection,
  reading: LinkReading,
): Effect.Effect<LinkedTools, never, OrgContext | OrgReader> {
  const { document } = connection;
  if (document === undefined) {
    return Effect.succeed({});
  }
  return Effect.gen(function* () {
    const { org } = yield* OrgContext;
    const checking = { org, modelProviders: reading.modelProviders, providing: providingOf(connection, reading) };
    return { tools: yield* toolsOfTheDocument(connection, document, checking) };
  });
}
