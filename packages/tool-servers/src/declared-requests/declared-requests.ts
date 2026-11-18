import type { FetchOfACall } from '@on.auto/operations';
import type { Reaches } from '@on.auto/outbound';
import type { Schema } from 'effect';

import type { NotOfferedBecause } from '../access/tool-not-offered.ts';
import type { CredentialRefused } from '../clients/server-links.ts';
import type { TokenSource } from '../clients/token-source.ts';
import type { UnavailableBecause } from '../listing/tool-server.ts';

export type RequestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface DeclaredRequest {
  readonly method: RequestMethod;
  readonly url: string;
  readonly body?: Schema.Json;
}

export interface ConnectionRequest extends DeclaredRequest {
  readonly org: string;
  readonly playbook: string;
  readonly server: string;
}

export type RequestedOnce =
  | { readonly kind: 'unopened'; readonly because: NotOfferedBecause | UnavailableBecause | 'too_large' }
  | { readonly kind: 'answered'; readonly outcome: 'result'; readonly answer?: Schema.Json }
  | { readonly kind: 'answered'; readonly outcome: 'tool_error' | 'timed_out' | 'too_large' }
  | { readonly kind: 'answered'; readonly outcome: 'server_failure'; readonly because: UnavailableBecause };

export type Unopened = Extract<RequestedOnce, { readonly kind: 'unopened' }>;

export interface ConnectionRequests {
  readonly origins: readonly string[];
  readonly tokens: TokenSource | undefined;
  readonly fetch: FetchOfACall;
  readonly reaches: Reaches;
  readonly refused: CredentialRefused;
}
