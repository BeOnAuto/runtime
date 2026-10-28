import { Buffer } from 'node:buffer';

import { cutAtCodePoint } from '@on.auto/definitions';
import type { Schema } from 'effect';

import { childIdOf, requestReference } from '../build-work/child-runs.ts';
import { predictionBounds } from '../capability/prediction-bounds.ts';
import type { BuildSource } from '../document/prediction-document.ts';
import type { Assembled } from '../facts/build-facts.ts';
import { candidateFilesOf } from '../runtimes/format-words.ts';
import type { KeptBrief } from './build-brief.ts';

const mostMessageBytes = 8192;

export const mostNoteBytes = 8192;

export interface Requesting {
  readonly run: { readonly org: string; readonly playbook: string; readonly id: string };
  readonly name: string;
  readonly source: BuildSource;
  readonly assembled: Assembled;
  readonly brief: KeptBrief;
  readonly requestedAt: number;
}

const buildAnswerSchema: Schema.JsonObject = {
  type: 'object',
  required: ['candidates'],
  additionalProperties: false,
  properties: {
    candidates: {
      type: 'array',
      maxItems: predictionBounds.candidatesInABuild,
      items: { type: 'string', minLength: 64, maxLength: 64 },
      description: 'The SHA-256 of each candidate uploaded to the build, as the upload answered it',
    },
    recipe: { type: 'string', description: 'How the candidates were trained, in words, at most 8 KiB' },
    limitations: { type: 'string', description: 'What the candidates do not do well, in words, at most 8 KiB' },
  },
};

export interface BuildRoutes {
  readonly brief: string;
  readonly rows: string;
  readonly candidates: string;
}

export function routesOf({ org, playbook, id }: Requesting['run']): BuildRoutes {
  const base = `/v1/orgs/${org}/playbooks/${playbook}/runs/${id}/build`;
  return { brief: `${base}/brief`, rows: `${base}/rows`, candidates: `${base}/candidates` };
}

function messageOf(requesting: Requesting, expiresAt: string): string {
  const { run, name, brief } = requesting;
  const routes = routesOf(run);
  const opening = [
    `Build ${run.id} of the prediction function ${name} waits for its trainer until ${expiresAt}.`,
    `Read the brief with GET ${routes.brief} and the training rows with GET ${routes.rows}.`,
    `Upload each candidate model with POST ${routes.candidates}, which takes ${candidateFilesOf(brief.formats)}, then answer this request with { "candidates": [the SHA-256 of each] }.`,
    '',
    '',
  ].join('\n');
  const room = mostMessageBytes - Buffer.byteLength(opening, 'utf8');
  return `${opening}${cutAtCodePoint(brief.text, room)}`;
}

export function buildRecordOf(requesting: Requesting): Schema.JsonObject {
  const { run, source, assembled, brief, requestedAt } = requesting;
  const expiresAt = new Date(requestedAt + source.expiresMs).toISOString();
  const build = {
    brief_sha256: brief.sha256,
    brief_bytes: brief.bytes,
    training_sha256: assembled.training_sha256,
    training_bytes: assembled.training_bytes,
    routes: { ...routesOf(run) },
    formats: [...brief.formats],
  };
  if (source.through !== undefined) {
    return { waiting_for: { run: childIdOf(run.id, requestReference) }, expires_at: expiresAt, build };
  }
  return {
    to: source.to,
    message: messageOf(requesting, expiresAt),
    answer_schema: buildAnswerSchema,
    expires_at: expiresAt,
    requested_at: new Date(requestedAt).toISOString(),
    build,
  };
}

export function trainerlessRecordOf({ training_sha256, training_bytes }: Assembled): Schema.JsonObject {
  return { trainer: null, build: { training_sha256, training_bytes } };
}
