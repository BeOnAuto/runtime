import { capitalized } from '@on.auto/operations';

import { durationInWords } from '../overview/duration-words.ts';
import { plainTextOf } from '../overview/markdown-text.ts';
import type { Diagram, DiagramNode, Phrases } from '../overview/overview.ts';
import type { JsonSchema } from '../overview/schema-reading.ts';
import { diagramLabel } from './diagram-labels.ts';
import { givenWords } from './field-sentences.ts';
import { firstWordsOf, type ValueWords } from './request-words.ts';

interface ReplyFlow {
  readonly input?: JsonSchema | undefined;
  readonly party: Phrases;
  readonly server: string;
  readonly expiresMs: number;
  readonly verdicts: ValueWords;
  readonly told: boolean;
}

export function replyDiagram({ input, party, server, expiresMs, verdicts, told }: ReplyFlow): Diagram {
  const values = Object.entries(verdicts);
  const decision = 3;
  return {
    kind: 'diagram',
    nodes: [
      { label: diagramLabel(capitalized(plainTextOf(givenWords(input)))) },
      { label: diagramLabel(`A message to ${plainTextOf(party)} through ${server}`) },
      { label: diagramLabel(`Waits up to ${durationInWords(expiresMs)} for a reply`) },
      { label: 'The first word of the reply', shape: 'decision' },
      ...values.map(([value]: readonly [string, readonly string[]]): DiagramNode => ({
        label: diagramLabel(value),
        shape: 'terminal',
      })),
      { label: 'unanswered', shape: 'terminal' },
    ],
    edges: [
      { from: 0, to: 1 },
      { from: 1, to: 2 },
      { from: 2, to: decision },
      ...values.map(([value, words]: readonly [string, readonly string[]], index) => ({
        from: decision,
        to: decision + 1 + index,
        label: diagramLabel(firstWordsOf(value, words)),
      })),
      { from: decision, to: 2, label: told ? 'any other word, told how to answer' : 'any other word', dashed: true },
      { from: 2, to: decision + 1 + values.length, label: 'no reply', dashed: true },
    ],
  };
}
