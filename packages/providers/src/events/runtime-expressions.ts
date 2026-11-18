import { alternatives } from '@on.auto/phrasing';
import { headerNamePattern } from '@on.auto/tool-servers';

type RequestSource = 'header' | 'query' | 'body';

type MessageSource = 'header' | 'payload';

export type ExpressionPlace =
  | { readonly transport: 'request'; readonly sources: readonly RequestSource[]; readonly because?: string }
  | { readonly transport: 'message'; readonly sources: readonly MessageSource[]; readonly because?: string };

export type RequestReference =
  | { readonly transport: 'request'; readonly source: 'header' | 'query'; readonly name: string }
  | { readonly transport: 'request'; readonly source: 'body'; readonly pointer: string };

export interface MessageReference {
  readonly transport: 'message';
  readonly source: MessageSource;
  readonly pointer: string;
}

const jsonPointer = String.raw`(?:/(?:[^~/]|~[01])*)+`;

const requestExpression = new RegExp(
  String.raw`^\$request\.(?:header\.(?<header>\S+)|query\.(?<query>\S+)|body#(?<body>${jsonPointer}))$`,
  'u',
);

const messageExpression = new RegExp(
  String.raw`^\$message\.(?<source>header|payload)#(?<pointer>${jsonPointer})$`,
  'u',
);

const requestShapes: Readonly<Record<RequestSource, string>> = {
  header: '$request.header.<name>',
  query: '$request.query.<name>',
  body: '$request.body#/<pointer>',
};

const messageShapes: Readonly<Record<MessageSource, string>> = {
  header: '$message.header#/<pointer>',
  payload: '$message.payload#/<pointer>',
};

export function requestReferenceOf(expression: string): RequestReference | undefined {
  const found = requestExpression.exec(expression)?.groups ?? {};
  const header = found['header'];
  if (header !== undefined) {
    return headerNamePattern.test(header) ? { transport: 'request', source: 'header', name: header } : undefined;
  }
  const query = found['query'];
  if (query !== undefined) {
    return { transport: 'request', source: 'query', name: query };
  }
  const body = found['body'];
  return body === undefined ? undefined : { transport: 'request', source: 'body', pointer: body };
}

export function messageReferenceOf(expression: string): MessageReference | undefined {
  const found = messageExpression.exec(expression)?.groups ?? {};
  const source = found['source'];
  const pointer = found['pointer'];
  return (source === 'header' || source === 'payload') && pointer !== undefined
    ? { transport: 'message', source, pointer }
    : undefined;
}

function expectedOf(place: ExpressionPlace): string {
  const expected =
    place.transport === 'request'
      ? `Expected ${alternatives(place.sources.map((source) => requestShapes[source]))}, a runtime expression of OpenAPI into the request`
      : `Expected ${alternatives(place.sources.map((source) => messageShapes[source]))}, a runtime expression of AsyncAPI into the message`;
  return place.because === undefined ? expected : `${expected}, ${place.because}`;
}

function isOfItsPlace(expression: string, place: ExpressionPlace): boolean {
  if (place.transport === 'request') {
    const reference = requestReferenceOf(expression);
    return reference !== undefined && place.sources.includes(reference.source);
  }
  const reference = messageReferenceOf(expression);
  return reference !== undefined && place.sources.includes(reference.source);
}

export function expressionIssueOf(expression: string, place: ExpressionPlace): string | undefined {
  return isOfItsPlace(expression, place) ? undefined : expectedOf(place);
}

export function inEveryPlaceOf(transport: ExpressionPlace['transport']): ExpressionPlace {
  return transport === 'request'
    ? { transport, sources: ['header', 'query', 'body'] }
    : { transport, sources: ['header', 'payload'] };
}
