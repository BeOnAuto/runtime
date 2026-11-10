import { sha256Of } from '@on.auto/content';
import { payloadMembers, type Payload, type PayloadArm, type PayloadMembers } from '@on.auto/operations/payloads';

export type TextName = 'source' | 'overview' | 'diagram';

export interface DefinitionTexts<Text> {
  readonly source: Text;
  readonly overview?: Text;
  readonly diagram?: Text;
}

export type TextsAsRecorded = DefinitionTexts<Payload<string>>;

export type TextMembers = PayloadArm<'source', string> &
  PayloadMembers<'overview', string> &
  PayloadMembers<'diagram', string>;

export const textMemberNames = [
  'source',
  'source_sha256',
  'source_bytes',
  'overview',
  'overview_sha256',
  'overview_bytes',
  'diagram',
  'diagram_sha256',
  'diagram_bytes',
] as const;

function textIfAny(inline?: string, sha256?: string, bytes?: number): Payload<string> | undefined {
  if (inline !== undefined) {
    return { inline };
  }
  return sha256 === undefined || bytes === undefined ? undefined : { kept: { sha256, bytes } };
}

function sourceOf(members: PayloadArm<'source', string>): Payload<string> {
  return 'source' in members
    ? { inline: members.source }
    : { kept: { sha256: members.source_sha256, bytes: members.source_bytes } };
}

export function textsOf(members: TextMembers): TextsAsRecorded {
  const overview = textIfAny(members.overview, members.overview_sha256, members.overview_bytes);
  const diagram = textIfAny(members.diagram, members.diagram_sha256, members.diagram_bytes);
  return {
    source: sourceOf(members),
    ...(overview === undefined ? {} : { overview }),
    ...(diagram === undefined ? {} : { diagram }),
  };
}

export function textMembersOf({ source, overview, diagram }: TextsAsRecorded): TextMembers {
  return {
    ...payloadMembers('source', source),
    ...(overview === undefined ? {} : payloadMembers('overview', overview)),
    ...(diagram === undefined ? {} : payloadMembers('diagram', diagram)),
  };
}

export function textsAsWritten({ source, overview, diagram }: DefinitionTexts<string>): TextsAsRecorded {
  return {
    source: { inline: source },
    ...(overview === undefined ? {} : { overview: { inline: overview } }),
    ...(diagram === undefined ? {} : { diagram: { inline: diagram } }),
  };
}

function digestOfItsText(text: Payload<string>): string | undefined {
  if ('kept' in text) {
    return text.kept.sha256;
  }
  return text.inline.isWellFormed() ? sha256Of(text.inline) : undefined;
}

export function isTheSameText(one?: Payload<string>, other?: Payload<string>): boolean {
  if (one === undefined || other === undefined) {
    return one === other;
  }
  if ('inline' in one && 'inline' in other) {
    return one.inline === other.inline;
  }
  const digest = digestOfItsText(one);
  return digest !== undefined && digest === digestOfItsText(other);
}
