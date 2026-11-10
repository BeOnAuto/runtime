import type { Schema } from 'effect';

const noted = { causationId: null, correlationId: null, at: '2026-11-01T09:00:00.000Z', by: 'noter' };

export const recordedPayloadMetadata: readonly Schema.JsonObject[] = [{ ...noted, payloadBytes: 7096 }, noted, noted];
