import { sha256Of, textToKeep, type RecordedContent } from '@on.auto/operations';
import { Effect, type Redacted } from 'effect';

import { secretsOfServers, type Secrets } from '../bounds/secrets.ts';
import { recordingOf, startedFields, type KeepIn, type StartedFields } from '../calls/recorded-calls.ts';
import type { OneCall } from '../one-call/one-call.ts';
import type { Served } from '../org-servers/org-servers.ts';
import type { ServerSettings } from '../settings/server-settings.ts';

export type StartingCall = Pick<OneCall, 'org' | 'playbook' | 'reference' | 'input'>;

export type ContentStore = Pick<RecordedContent, 'put'>;

function keepingIn(content: ContentStore): KeepIn {
  return ({ org, playbook }) =>
    (text) =>
      Effect.runPromise(
        content
          .put({ org, playbook }, { ...textToKeep(text, 'application/json'), expected: { sha256: sha256Of(text) } })
          .pipe(
            Effect.map(({ sha256 }) => sha256),
            Effect.orDie,
          ),
      );
}

export type SecretValues = readonly Redacted.Redacted[];

export interface RecordingParts {
  readonly keepIn: KeepIn;
  readonly secrets: Secrets;
}

export function recordingPartsOf(
  servers: readonly ServerSettings[],
  content: ContentStore,
  besides: SecretValues,
): RecordingParts {
  return { keepIn: keepingIn(content), secrets: secretsOfServers(servers, besides) };
}

const nothingKept: Pick<Served, 'record_content' | 'connection'> = { record_content: false, connection: null };

export function startedOn(
  served: Pick<Served, 'record_content' | 'connection'> | undefined,
  { org, playbook, reference, input }: StartingCall,
  { keepIn, secrets }: RecordingParts,
): Promise<StartedFields> {
  const recording = recordingOf({ ...(served ?? nothingKept), request_id: null }, secrets, keepIn({ org, playbook }));
  return startedFields({ ...reference, input }, recording);
}
