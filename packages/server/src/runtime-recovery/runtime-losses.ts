import { SdkError, SdkErrorCode, SdkHttpError } from '@modelcontextprotocol/client';
import { isJSONRPCErrorResponse, type JSONRPCErrorResponse } from '@modelcontextprotocol/server';
import { serverStopping, stoppedWords } from '@on.auto/api';
import { Option, Schema } from 'effect';

export type Loss = 'refused' | 'turned away' | 'stopped' | 'unanswered';

const firstStatusOfAFailingServer = 500;

const internalError = -32_603;

const RefusalSchema = Schema.Union([
  Schema.Struct({ detail: Schema.String }),
  Schema.Struct({ error: Schema.Struct({ message: Schema.String }) }),
]);

const refusalIn = Schema.decodeUnknownOption(Schema.fromJsonString(RefusalSchema));

const unreadableWords = 'Auto Runtime answered this request with content that is no MCP answer';

function couldNotConnect(cause: unknown): boolean {
  return typeof cause === 'object' && cause !== null && 'syscall' in cause && cause.syscall === 'connect';
}

function isUnreadable(failure: unknown): boolean {
  return failure instanceof SdkError && failure.code === SdkErrorCode.ClientHttpUnexpectedContent;
}

function isTurnedAway(failure: unknown): boolean {
  return failure instanceof SdkHttpError ? failure.status < firstStatusOfAFailingServer : isUnreadable(failure);
}

function wordsOfTheRefusal(text: unknown): string | undefined {
  return Option.getOrUndefined(
    Option.map(refusalIn(text), (refusal) => ('detail' in refusal ? refusal.detail : refusal.error.message)),
  );
}

function isRefusedWhileItStops(failure: unknown): boolean {
  return (
    failure instanceof SdkHttpError &&
    failure.status === serverStopping.status &&
    wordsOfTheRefusal(failure.data['text']) === serverStopping.detail
  );
}

function neverArrived(failure: unknown): boolean {
  return (failure instanceof TypeError && couldNotConnect(failure.cause)) || isRefusedWhileItStops(failure);
}

export function lossOf(failure: unknown): Loss {
  if (neverArrived(failure)) {
    return 'refused';
  }
  return isTurnedAway(failure) ? 'turned away' : 'stopped';
}

export function isTheStopAnswer(message: unknown): message is JSONRPCErrorResponse {
  return (
    isJSONRPCErrorResponse(message) && message.error.code === internalError && message.error.message === stoppedWords
  );
}

function refusalWordsOf(status: number, text: unknown): string {
  const words = wordsOfTheRefusal(text);
  return words === undefined
    ? `Auto Runtime turned this request away with HTTP ${status}`
    : `Auto Runtime turned this request away: ${words}`;
}

export function saidOf(failure: unknown): string {
  if (failure instanceof SdkHttpError) {
    return refusalWordsOf(failure.status, failure.data['text']);
  }
  return isUnreadable(failure) ? unreadableWords : String(failure);
}
