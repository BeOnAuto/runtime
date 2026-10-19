import { JsonPointer, type Schema } from 'effect';

import { bulletList, paragraph, sectionOf, type OverviewSection, type Paragraph } from '../overview/overview.ts';
import type { JsonSchema } from '../overview/schema-reading.ts';
import { answeredWords, givenClause } from './field-sentences.ts';
import { theToolAsWritten } from './tool-words.ts';

interface ToolCalled {
  readonly server: string;
  readonly tool: string;
  readonly read?: string | undefined;
}

interface SystemAsked extends ToolCalled {
  readonly input?: JsonSchema | undefined;
  readonly output: JsonSchema;
}

interface CallWritten extends ToolCalled {
  readonly arguments?: Readonly<Record<string, Schema.Json>> | undefined;
}

function readWords(read: string | undefined): string {
  const segments = (read ?? '')
    .split('/')
    .slice(1)
    .map((segment) => JsonPointer.unescapeToken(segment));
  return segments.length === 0
    ? 'the whole of what the tool answered'
    : `what it answered under ${segments.join(', then ')}`;
}

export function callSentence({ input, server, tool, read, output }: SystemAsked): Paragraph {
  return paragraph(
    ...givenClause(input),
    ' and asks ',
    { server },
    ` with its tool ${tool}, once per run. It answers with ${readWords(read)}: `,
    ...answeredWords(output),
    '.',
  );
}

function writtenValue(value: Schema.Json): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

export function callSection({ server, tool, read, arguments: written = {} }: CallWritten): OverviewSection {
  const given = Object.entries(written);
  return sectionOf(
    'Call',
    paragraph(
      'It calls ',
      ...theToolAsWritten({ server, tool }),
      ...(read === undefined ? [', its whole answer read'] : [', its answer read at ', { code: read }]),
      given.length === 0 ? ', with no arguments.' : ', with these arguments, as written:',
    ),
    ...(given.length === 0
      ? []
      : [
          bulletList(
            given.map(([name, value]: readonly [string, Schema.Json]) => [
              { code: name },
              ': ',
              { code: writtenValue(value) },
            ]),
          ),
        ]),
  );
}
