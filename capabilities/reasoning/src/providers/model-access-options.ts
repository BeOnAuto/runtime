import type { ProxySettings } from '@on.auto/outbound';
import type { Telemetry } from 'ai';
import type { Effect } from 'effect';

import type { CredentialSources } from './credential-sources.ts';
import type { EntraIdentityLoader } from './entra-id.ts';
import type { Fetch } from './sdk-model.ts';

export interface ProviderMessageReport {
  readonly provider: string;
  readonly model: string | null;
  readonly status: number | null;
  readonly message: string;
  readonly run_id: string | null;
}

export type ReportProviderMessage = (report: ProviderMessageReport) => Effect.Effect<void>;

export interface OperatorHintReport {
  readonly provider: string;
  readonly model: string | null;
  readonly hint: string;
  readonly run_id: string | null;
}

export type ReportOperatorHint = (report: OperatorHintReport) => Effect.Effect<void>;

export interface ModelTelemetry {
  readonly integrations: readonly Readonly<Telemetry>[];
  readonly recordContent: boolean;
}

export interface ModelAccessOptions {
  readonly fetch?: Fetch;
  readonly credentials?: CredentialSources;
  readonly proxy?: ProxySettings;
  readonly loadEntraIdentity?: EntraIdentityLoader;
  readonly reportProviderMessage?: ReportProviderMessage;
  readonly reportOperatorHint?: ReportOperatorHint;
  readonly telemetry?: ModelTelemetry | undefined;
}
