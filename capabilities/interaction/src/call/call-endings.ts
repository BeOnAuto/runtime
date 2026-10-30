import { Buffer } from 'node:buffer';

import { mostResultBytes } from '@on.auto/definitions';
import { issuesDetail } from '@on.auto/json-schema';
import { capitalized, Conflict, Unavailable } from '@on.auto/operations';
import { answerDocument, isReadOnly, toolInWords, type AnsweredOnce, type CalledOnce } from '@on.auto/tool-servers';
import { measureOf, mostValueDepth } from '@on.auto/workflow-engine/dsl';
import { Effect, Result, Schema } from 'effect';

import type { CallDocument } from '../document/interaction-document.ts';
import { valueAt } from '../tool-blocks/json-pointers.ts';

const isJson = Schema.is(Schema.Json);

interface CallFinished {
  readonly output: Schema.Json;
  readonly record: Schema.JsonObject;
}

type Ending = Effect.Effect<CallFinished, Unavailable | Conflict>;

function unworkable(detail: string): Ending {
  return Effect.fail(new Conflict({ detail, kind: 'unworkable' }));
}

function recordOf({ call }: CallDocument): Schema.JsonObject {
  const { server, tool, read } = call;
  return read === undefined ? { server, tool } : { server, tool, read };
}

const mayHaveActed = 'The tool ran and may have changed something; a run again calls it again';

type Answered = Extract<AnsweredOnce, { readonly outcome: 'result' }>;

interface Reading {
  readonly named: string;
  readonly at: string;
  readonly unreadable: (detail: string) => Ending;
}

function unreadableAfter({ annotations }: Answered): (detail: string) => Ending {
  return (detail) => unworkable(isReadOnly(annotations) ? detail : `${detail}. ${mayHaveActed}`);
}

function checkedValue(document: CallDocument, value: Schema.Json, { named, at, unreadable }: Reading): Ending {
  const what = `What ${named} answered${at}`;
  const bytes = Buffer.byteLength(JSON.stringify({ output: value, record: recordOf(document) }), 'utf8');
  if (bytes > mostResultBytes) {
    return unreadable(
      `${what} takes ${bytes} bytes as JSON with the record of the run, more than the ${mostResultBytes} a run may record`,
    );
  }
  if (measureOf(value) === undefined) {
    return unreadable(`${what} nests deeper than the ${mostValueDepth} levels a value may`);
  }
  return Result.match(document.output.schema.validate(value), {
    onSuccess: (output) => Effect.succeed({ output, record: recordOf(document) }),
    onFailure: (issues) => unreadable(`${what} does not match the output schema: ${issuesDetail(issues, 'answer')}`),
  });
}

function answeredWith(document: CallDocument, answer: Answered): Ending {
  const named = toolInWords(document.call);
  const read = document.call.read ?? '';
  const unreadable = unreadableAfter(answer);
  const found = answerDocument(answer.answer);
  if (found === undefined) {
    return unreadable(
      `${capitalized(named)} answered neither structured content nor text, so there is nothing to read`,
    );
  }
  const value = valueAt(found, read);
  if (!isJson(value)) {
    return unreadable(
      typeof found === 'string'
        ? `${capitalized(named)} answered text that is not JSON, which holds nothing at ${read}`
        : `The answer of ${named} holds nothing at ${read}`,
    );
  }
  return checkedValue(document, value, { named, at: read === '' ? '' : ` at ${read}`, unreadable });
}

function afterSending(called: AnsweredOnce, because: 'tool_error' | 'server_failed', detail: string): Ending {
  const ending = {
    detail,
    because,
    ...(called.retryAfterMs === null ? {} : { record: { retry_after_ms: called.retryAfterMs } }),
  };
  return Effect.fail(
    isReadOnly(called.annotations)
      ? new Unavailable({ ...ending, kind: 'tools_unfinished' })
      : new Conflict({ ...ending, kind: 'effect_unknown' }),
  );
}

function endedWith(document: CallDocument, called: AnsweredOnce): Ending {
  const named = toolInWords(document.call);
  if (called.outcome === 'result') {
    return answeredWith(document, called);
  }
  if (called.outcome === 'arguments_refused') {
    return unworkable(`${capitalized(named)} refused the arguments: ${called.detail}`);
  }
  return called.outcome === 'tool_error'
    ? afterSending(called, 'tool_error', `${capitalized(named)} answered an error: ${called.detail}`)
    : afterSending(
        called,
        'server_failed',
        `The tool server ${document.call.server} failed: ${called.detail}, after the run called ${named}`,
      );
}

export function endingOf(document: CallDocument, called: CalledOnce): Ending {
  if (called.kind === 'unopened') {
    const { refused, because, detail } = called;
    return Effect.fail(new Unavailable({ detail, kind: refused, because }));
  }
  return endedWith(document, called);
}
