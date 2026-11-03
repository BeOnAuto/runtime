export const oldWords: readonly RegExp[] = [
  /[pP]rimitive|PRIMITIVE/gu,
  /(?<![A-Za-z])[sS]pecs?(?![a-z])|(?<=[a-z])Specs?(?![a-z])|(?<![A-Za-z])SPECS?(?![A-Z])/gu,
  /[eE]xecution|EXECUTION/gu,
  /[iI]nference|INFERENCE/gu,
  /[oO]rchestrat|ORCHESTRAT/gu,
  /[rR]ecollection|RECOLLECTION/gu,
  /execute_spec/gu,
  /\/execute(?![\w./-])(?<!\/tools\/[^/\s]+\/execute)/gu,
  /[eE]xecuteSpec/gu,
  /language: jq/gu,
  /evaluate\.language: jq/gu,
  /jq-ts/gu,
  /delivery_ended/gu,
  /telling_ended/gu,
  /arguments_json/gu,
  /result_json/gu,
  /(?<![\w-])brain\\?\//gu,
  /brain_key/gu,
  /brain:read|brain:write/gu,
  /(?<![\w-])brain:(?=\S)/gu,
  /brain_(?:created|updated|retired)/gu,
  /\/brains(?![\w-])/gu,
  /(?i:@beonauto)/gu,
  /workflow_followed_brains/gu,
  /_by_brain/gu,
  /RECALL_BRAINS_AT_ONCE/gu,
  /(?:[{,]\s*|\n\s*|["'])brains?["']?\s*:/gu,
  /(?i:auto[-_ ]?brain)/gu,
  /(?i:beonauto\/auto-runtime)/gu,
  /(?i:com\.beonauto\/)/gu,
  /mcp_server_failed/gu,
  /mcp_server_not_configured/gu,
  /mcp__/gu,
  /RecallFunction/gu,
  /recall-format/gu,
  /recall_views/gu,
  /RECALL_MAX_FUNCTIONS/gu,
  /RECALL_MAX_REBUILDS/gu,
  /RECALL_PLAYBOOKS_AT_ONCE/gu,
];

interface Found {
  readonly index: number;
  readonly word: string;
}

export function foundIn(text: string, word: Readonly<RegExp>): readonly Found[] {
  const found: Found[] = [];
  for (const match of text.matchAll(word)) {
    found.push({ index: match.index, word: match[0] });
  }
  return found;
}

export function oldWordsIn(text: string): readonly string[] {
  return oldWords.flatMap((word: Readonly<RegExp>) => foundIn(text, word)).map(({ word }) => word);
}
