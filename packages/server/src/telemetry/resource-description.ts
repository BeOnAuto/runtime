import { randomUUID } from 'node:crypto';

import * as Resource from '@effect/opentelemetry/Resource';
import type { ServerInfo } from '@on.auto/api';
import { resourceFromAttributes, type Resource as OtelResource } from '@opentelemetry/resources';
import { Redacted, type Layer } from 'effect';

import type { NameValues } from './name-value-lists.ts';
import type { SignalExport, TelemetrySettings } from './telemetry-settings.ts';

export interface ResourceDescription {
  readonly serviceName: string;
  readonly serviceVersion: string;
  readonly attributes: NameValues;
}

export interface ExporterOptions {
  readonly url: string;
  readonly headers: Record<string, string>;
}

export function resourceDescriptionOf(settings: TelemetrySettings, release: ServerInfo): ResourceDescription {
  const serviceVersion = settings.resourceAttributes['service.version'] ?? release.version;
  return {
    serviceName: settings.serviceName,
    serviceVersion,
    attributes: {
      'service.instance.id': randomUUID(),
      ...settings.resourceAttributes,
      'service.name': settings.serviceName,
      'service.version': serviceVersion,
    },
  };
}

export function otelResourceOf({ attributes }: ResourceDescription): OtelResource {
  return resourceFromAttributes(attributes);
}

export function effectResourceOf({
  serviceName,
  serviceVersion,
  attributes,
}: ResourceDescription): Layer.Layer<Resource.Resource> {
  return Resource.layer({ serviceName, serviceVersion, attributes });
}

export function exporterOptionsOf({ url, headers }: SignalExport): ExporterOptions {
  return { url, headers: { ...Redacted.value(headers) } };
}
