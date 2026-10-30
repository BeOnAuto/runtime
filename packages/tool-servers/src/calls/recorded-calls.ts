import { sha256Of, type PlaybookAddress } from '@on.auto/operations';
import type { Effect } from 'effect';

import { cutToFailureBound } from '../bounds/call-bounds.ts';
import type { Secrets } from '../bounds/secrets.ts';
import { bytesOf } from '../bounds/text-bytes.ts';
import type { FailureKind } from '../clients/server-failures.ts';
import type { ServerSettings } from '../settings/server-settings.ts';
import type { CallAnswered, CallEnded, CallFailed, CallStarted, SentCallFailedBecause } from './call-facts.ts';

export type StartedFields = Omit<CallStarted, 'call_id' | 'read_only'>;

export type AnsweredFields = Omit<CallAnswered, 'is_error' | 'shown_bytes' | 'duration_ms'>;

export interface CallJournal {
  readonly started: (fact: CallStarted) => Effect.Effect<number | undefined>;
  readonly ended: (number: number, fact: CallEnded) => Effect.Effect<boolean>;
}

export type KeepContent = (text: string) => Promise<string>;

export type KeepIn = (playbook: PlaybookAddress) => KeepContent;

export interface Recording {
  readonly content: boolean;
  readonly requestId: boolean;
  readonly connection: string | null;
  readonly secrets: Pick<Secrets, 'scrub' | 'scrubValue'>;
  readonly keep: KeepContent;
}

export interface StartingCall {
  readonly server: string;
  readonly tool: string;
  readonly input: Readonly<Record<string, unknown>>;
}

export interface CallAnswer {
  readonly keptJson: string;
  readonly jsonrpcId: string | number | null;
  readonly serverRequestId: string | null;
}

export function recordingOf(
  settings: Pick<ServerSettings, 'record_content' | 'request_id' | 'connection'>,
  secrets: Pick<Secrets, 'scrub' | 'scrubValue'>,
  keep: KeepContent,
): Recording {
  return {
    content: settings.record_content,
    requestId: settings.request_id !== null,
    connection: settings.connection,
    secrets,
    keep,
  };
}

export function scrubbedJsonOf(json: string, { secrets }: Pick<Recording, 'secrets'>): string {
  const parsed: unknown = JSON.parse(json);
  return JSON.stringify(secrets.scrubValue(parsed));
}

export function argumentsDigestOf(input: unknown, secrets: Pick<Secrets, 'scrub' | 'scrubValue'>): string {
  return sha256Of(scrubbedJsonOf(JSON.stringify(input), { secrets }));
}

async function keptDigestOf(kept: string, recording: Recording): Promise<string | undefined> {
  if (!recording.content) {
    return undefined;
  }
  const sha256 = await recording.keep(kept);
  return sha256;
}

export async function startedFields(call: StartingCall, recording: Recording): Promise<StartedFields> {
  const kept = scrubbedJsonOf(JSON.stringify(call.input), recording);
  const sha256 = await keptDigestOf(kept, recording);
  return {
    server: call.server,
    ...(recording.connection === null ? {} : { connection_id: recording.connection }),
    tool: call.tool,
    arguments_bytes: bytesOf(kept),
    ...(sha256 === undefined ? {} : { arguments_sha256: sha256 }),
  };
}

function requestIdOf({ serverRequestId }: Pick<CallAnswer, 'serverRequestId'>, { requestId }: Recording) {
  return requestId ? { server_request_id: serverRequestId } : {};
}

export async function answeredFields(answer: CallAnswer, recording: Recording): Promise<AnsweredFields> {
  const sha256 = await keptDigestOf(answer.keptJson, recording);
  return {
    result_bytes: bytesOf(answer.keptJson),
    ...(sha256 === undefined ? {} : { result_sha256: sha256 }),
    jsonrpc_id: answer.jsonrpcId,
    ...requestIdOf(answer, recording),
  };
}

export interface CallFailure {
  readonly because: SentCallFailedBecause;
  readonly message: string;
  readonly jsonrpcId: string | number | null;
  readonly serverRequestId: string | null;
  readonly failure?: FailureKind | null;
}

export function failedData(failure: CallFailure, durationMs: number, recording: Recording): CallFailed {
  const detail = cutToFailureBound(recording.secrets.scrub(failure.message.trim()));
  return {
    because: failure.because,
    ...(detail === '' ? {} : { detail }),
    duration_ms: durationMs,
    jsonrpc_id: failure.jsonrpcId,
    ...requestIdOf(failure, recording),
    ...(failure.failure === 'rate_limited' ? { rate_limited: true } : {}),
  };
}
