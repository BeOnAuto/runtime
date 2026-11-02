import type { Redacted } from 'effect';

import type { GenerationParameters } from '../document/generation-document.ts';

export interface GenerationGateway {
  readonly name: string;
  readonly base_url: string;
  readonly api_key: Redacted.Redacted | null;
  readonly headers: ReadonlyMap<string, Redacted.Redacted>;
  readonly query_params: ReadonlyMap<string, Redacted.Redacted>;
  readonly cost_header: string | null;
}

export type GatewayFetch = (request: Readonly<Request>) => Promise<Response>;

export interface ReferenceContent {
  readonly mediaType: string;
  readonly bytes: Readonly<Uint8Array<ArrayBuffer>>;
}

export interface GenerationRequest {
  readonly kind: 'image' | 'audio';
  readonly model: string;
  readonly prompt: string;
  readonly parameters: GenerationParameters;
  readonly references: readonly ReferenceContent[];
}

export interface Generated {
  readonly bytes: Readonly<Uint8Array>;
  readonly mediaType: string;
  readonly costUsd?: number;
}

export const gatewayAnswerMs = 240_000;

export const mostRefusalBytes = 65_536;
