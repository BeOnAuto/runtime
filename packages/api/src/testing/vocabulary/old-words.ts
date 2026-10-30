export const oldWords: readonly string[] = [
  '[pP]rimitive|PRIMITIVE',
  '(?<![A-Za-z])[sS]pecs?(?![a-z])|(?<=[a-z])Specs?(?![a-z])|(?<![A-Za-z])SPECS?(?![A-Z])',
  '[eE]xecution|EXECUTION',
  '[iI]nference|INFERENCE',
  '[oO]rchestrat|ORCHESTRAT',
  '[rR]ecollection|RECOLLECTION',
  'execute_spec',
  String.raw`/execute(?![\w./-])(?<!/tools/[^/\s]+/execute)`,
  '[eE]xecuteSpec',
  'language: jq',
  String.raw`evaluate\.language: jq`,
  'jq-ts',
  'delivery_ended',
  'telling_ended',
  'arguments_json',
  'result_json',
  String.raw`(?<![\w-])brain\\?/`,
  'brain_key',
  'brain:read|brain:write',
  String.raw`(?<![\w-])brain:(?=\S)`,
  'brain_(?:created|updated|retired)',
  String.raw`/brains(?![\w-])`,
  '(?i:@beonauto)',
  'workflow_followed_brains',
  '_by_brain',
  'RECALL_BRAINS_AT_ONCE',
  String.raw`(?:[{,]\s*|\n\s*|["'])brains?["']?\s*:`,
  '(?i:auto[-_ ]?brain)',
  '(?i:beonauto/auto-runtime)',
  String.raw`(?i:com\.beonauto/)`,
  'mcp_server_failed',
  'mcp_server_not_configured',
  'mcp__',
];

interface Found {
  readonly index: number;
  readonly word: string;
}

export function foundIn(text: string, word: string): readonly Found[] {
  const found: Found[] = [];
  for (const match of text.matchAll(new RegExp(word, 'gu'))) {
    found.push({ index: match.index, word: match[0] });
  }
  return found;
}

export function oldWordsIn(text: string): readonly string[] {
  return oldWords.flatMap((word) => foundIn(text, word)).map(({ word }) => word);
}
