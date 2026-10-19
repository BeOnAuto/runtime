import { JsonPointer, type Schema } from 'effect';

import {
  bulletList,
  paragraph,
  sectionOf,
  type OverviewSection,
  type Paragraph,
  type Phrases,
} from '../overview/overview.ts';
import { valueText, type JsonSchema } from '../overview/schema-reading.ts';
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

function readWords(read: string | undefined): Phrases {
  const segments = (read ?? '')
    .split('/')
    .slice(1)
    .map((segment) => JsonPointer.unescapeToken(segment));
  if (segments.length === 0) {
    return ['the whole of what the tool answered'];
  }
  const under = segments.flatMap((segment, index): Phrases =>
    index === 0 ? [{ code: segment }] : [', then ', { code: segment }],
  );
  return ['what it answered under ', ...under];
}

export function callSentence({ input, server, tool, read, output }: SystemAsked): Paragraph {
  return paragraph(
    ...givenClause(input),
    ' and asks ',
    { server },
    ' with its tool ',
    { code: tool },
    ', once per run. It answers with ',
    ...readWords(read),
    ': ',
    ...answeredWords(output),
    '.',
  );
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
              { code: valueText(value) },
            ]),
          ),
        ]),
  );
}
