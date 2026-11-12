import type { OrgReader } from '@on.auto/operations';
import {
  allowsTool,
  describedToolServers,
  markedTool,
  summaryOf,
  type ServerSettings,
  type ToolMark,
  type ToolServers,
} from '@on.auto/tool-servers';
import { Effect, Function, Option, Order } from 'effect';

import { apiOf } from '../entries/described-entries.ts';
import { readWithAStandIn, type EntryChecking } from '../entries/entry-checks.ts';
import type { ConnectionDocument } from '../registry/connection-entry.ts';
import type { RecordedConnection } from '../registry/connection.ts';
import { readableDocumentText } from './kept-documents.ts';

export interface DocumentTool {
  readonly name: string;
  readonly summary: string;
  readonly mark: ToolMark;
}

const byName = Order.mapInput(Order.String, ({ name }: DocumentTool) => name);

const controlCharacters = /\p{Cc}+/gu;

const bidirectionalFormatting = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu;

function plainSummaryOf(description: string): string {
  return summaryOf(description).replaceAll(controlCharacters, ' ').replaceAll(bidirectionalFormatting, '').trim();
}

function toolsOf(servers: ToolServers, settings: ServerSettings): readonly DocumentTool[] {
  return apiOf(servers)
    .operations.filter(({ tool }) => allowsTool(settings.allowed, tool.name))
    .map(({ tool }): DocumentTool => {
      const { name, mark } = markedTool(tool, settings);
      return { name, summary: plainSummaryOf(tool.description ?? ''), mark };
    })
    .toSorted(byName);
}

function toolsOfTheText(
  connection: RecordedConnection,
  text: string,
  checking: EntryChecking,
): Effect.Effect<readonly DocumentTool[] | null> {
  const offered = Effect.flatMap(
    Effect.fromResult(readWithAStandIn({ ...connection, documentText: text }, checking)),
    (settings) =>
      Effect.map(
        describedToolServers({ servers: [settings], referencedVariables: [] }, { reportLeftOut: Function.constVoid }),
        (servers) => toolsOf(servers, settings),
      ),
  );
  return Effect.map(Effect.option(offered), Option.getOrNull);
}

export function toolsOfTheDocument(
  connection: RecordedConnection,
  document: ConnectionDocument,
  checking: EntryChecking,
): Effect.Effect<readonly DocumentTool[] | null, never, OrgReader> {
  return Effect.flatMap(readableDocumentText(document), (text) =>
    text === undefined ? Effect.succeed(null) : toolsOfTheText(connection, text, checking),
  );
}
