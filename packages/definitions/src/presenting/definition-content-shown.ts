import { Buffer } from 'node:buffer';

import { textsOf, type TextsAsRecorded } from '../payloads/definition-texts.ts';
import { firstCharacters } from '../plain-language/characters.ts';
import type { DefinitionContent, DefinitionPaused } from '../registry/definition-events.ts';
import { jsonBytesOf } from '../runs/recorded-size.ts';
import { cutAtCodePoint, mostDescriptionCharacters, mostDetailBytes } from './event-data.ts';

function sourceShown({ source }: TextsAsRecorded) {
  return 'inline' in source
    ? { source_bytes: Buffer.byteLength(source.inline, 'utf8') }
    : { source_sha256: source.kept.sha256, source_bytes: source.kept.bytes };
}

function overviewShown({ overview }: TextsAsRecorded) {
  if (overview === undefined) {
    return {};
  }
  return 'inline' in overview
    ? { overview_bytes: Buffer.byteLength(overview.inline, 'utf8') }
    : { overview_sha256: overview.kept.sha256, overview_bytes: overview.kept.bytes };
}

export function contentShown(content: DefinitionContent) {
  const { description, input_schema, output_schema, warnings = [] } = content;
  const texts = textsOf(content);
  return {
    ...sourceShown(texts),
    ...overviewShown(texts),
    ...(description === undefined ? {} : { description: firstCharacters(description, mostDescriptionCharacters) }),
    ...(input_schema === undefined ? {} : { input_schema_bytes: jsonBytesOf(input_schema) }),
    ...(output_schema === undefined ? {} : { output_schema_bytes: jsonBytesOf(output_schema) }),
    warning_count: warnings.length,
  };
}

export function pauseShown({ paused_by, reason }: DefinitionPaused['data']) {
  return { paused_by, ...(reason === undefined ? {} : { reason: cutAtCodePoint(reason, mostDetailBytes) }) };
}
