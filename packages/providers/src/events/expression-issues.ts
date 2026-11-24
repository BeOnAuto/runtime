import { transportOf, type Destination, type DestinationIssue } from './destination-fields.ts';
import { provesTheBodyAndATime } from './event-proofs.ts';
import { expressionIssueOf, type ExpressionPlace } from './runtime-expressions.ts';

export type Path = readonly (string | number)[];

export function expressionIssuesAt(
  path: Path,
  expression: string | undefined,
  place: ExpressionPlace,
): readonly DestinationIssue[] {
  const issue = expression === undefined ? undefined : expressionIssueOf(expression, place);
  return issue === undefined ? [] : [{ path, issue }];
}

const noConditions = 'Expected at least one runtime expression with the values it may equal';

export type Conditions = Readonly<Record<string, readonly (string | null)[]>>;

export function conditionIssuesOf(path: Path, when: Conditions, place: ExpressionPlace): readonly DestinationIssue[] {
  const expressions = Object.keys(when);
  return expressions.length === 0
    ? [{ path, issue: noConditions }]
    : expressions.flatMap((expression) => expressionIssuesAt([...path, expression], expression, place));
}

export function replyPlaceOf(destination: Destination): ExpressionPlace {
  return transportOf(destination) === 'request'
    ? {
        transport: 'request',
        sources: ['body'],
        because: 'since a reply is read from the body alone, which the proof covers',
      }
    : { transport: 'message', sources: ['payload'], because: "since a reply is read from the message's payload alone" };
}

export function provesAReply({ type, verify }: Destination): boolean {
  return type === 'websocket' || (verify !== undefined && provesTheBodyAndATime(verify));
}
