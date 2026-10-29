import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { foundIn, oldWords } from '@on.auto/api/testing';

const root = resolve(import.meta.dirname, '..');

const frozenFormats: readonly string[] = [
  ...['1', '2', '3', '4', '5', '6', '7'].map((format) => `packages/workflow-engine/corpus/format-${format}.json`),
  ...['one', 'two', 'three', 'four', 'five', 'six', 'six-records', 'seven', 'seven-records'].map(
    (format) => `packages/workflow-engine/src/run-log/formats/format-${format}.ts`,
  ),
  ...['one', 'two', 'four', 'six', 'six-records', 'seven', 'seven-records'].map(
    (format) => `packages/workflow-engine/src/run-log/formats/format-${format}.test.ts`,
  ),
];

const publishedOpenApiSchema = 'packages/api/src/testing/openapi/openapi-3.1-schema-2022-10-07';

const keptFiles: readonly string[] = [
  'CHANGELOG.md',
  'pnpm-lock.yaml',
  'packages/api/src/testing/vocabulary/old-words.ts',
  'packages/api/src/testing/vocabulary/old-words.test.ts',
  'scripts/docs-vocabulary.test.ts',
  `${publishedOpenApiSchema}.json`,
  ...frozenFormats,
];

interface Allowance {
  readonly text: string;
  readonly in: readonly string[];
}

const internalTerms = 'packages/operations/src/plain-language/internal-terms.ts';

const internalTermsTest = 'packages/operations/src/plain-language/internal-terms.test.ts';

const reasoningReference = 'docs/engineering/reference/reasoning-format.md';

const modelSessions = 'packages/prediction-onnx/src/sessions/model-sessions.ts';

const providerDocuments = 'packages/providers/src/entries/documents';

const googleAdsDocument = `${providerDocuments}/google-ads.openapi.json`;

const analyticsDocument = `${providerDocuments}/google-analytics.openapi.json`;

const sheetsDocument = `${providerDocuments}/google-sheets.openapi.json`;

const allowances: readonly Allowance[] = [
  {
    text: 'https://open-workflow-specification.org/spec/1.0.0/errors',
    in: [
      'capabilities/coordination/input-logs/refused-input.json',
      'capabilities/coordination/input-logs/retry-with-backoff.json',
      'capabilities/coordination/input-logs/timeout-fires.json',
      'capabilities/coordination/src/input-logs/input-log-paths.ts',
      'capabilities/coordination/src/workflows/call-results.test.ts',
      'capabilities/coordination/src/workflows/error-tasks.test.ts',
      'docs/reference/workflow-format.md',
      'packages/server/src/computation/computation-workflows.test.ts',
      'packages/workflow-engine/corpus/format-8.json',
      'packages/workflow-engine/corpus/format-9.json',
      'packages/workflow-engine/src/decider/open-calls.test.ts',
      'packages/workflow-engine/src/dsl/raised-error.test.ts',
      'packages/workflow-engine/src/dsl/raised-error.ts',
      'packages/workflow-engine/src/filters/event-filter.test.ts',
      'packages/workflow-engine/src/steps/step-causes.test.ts',
    ],
  },
  {
    text: 'https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md',
    in: ['docs/reference/http.md', 'packages/definitions/README.md'],
  },
  { text: 'https://spec.openapis.org/oas/3.1/schema/2022-10-07', in: [`${publishedOpenApiSchema}.txt`] },
  {
    text: 'inferenceConfig',
    in: [
      'capabilities/reasoning/src/providers/cloud-providers.test.ts',
      'capabilities/reasoning/src/definition/definition-settings.test.ts',
      reasoningReference,
    ],
  },
  { text: 'inferenceGeo', in: ['capabilities/reasoning/src/model/offered-provider-options.ts', reasoningReference] },
  {
    text: 'inference-profile',
    in: [
      'capabilities/reasoning/src/catalog/catalog-leaks.test.ts',
      'capabilities/reasoning/src/catalog/catalog-listing.test.ts',
      'capabilities/reasoning/src/definition/definition-settings.test.ts',
      'capabilities/reasoning/src/settings/catalog-settings.test.ts',
    ],
  },
  { text: 'application inference profile', in: ['docs/self-host/models.md'] },
  { text: 'InferenceSession', in: [modelSessions] },
  { text: 'executionMode', in: [modelSessions] },
  { text: '(.execution // {})', in: ['.github/turbo/show-run-summary.sh'] },
  {
    text: 'toolSpec',
    in: [
      'capabilities/reasoning/src/providers/cloud-providers.test.ts',
      'capabilities/reasoning/src/steps/provider-steps.test.ts',
    ],
  },
  { text: 'code_execution', in: ['capabilities/reasoning/src/provider-testing/model-lists.ts'] },
  {
    text: 'See the Audio Spec for more info: https://advertising.amazon.com/en-us/resources/ad-specs/audio-ads',
    in: [`${providerDocuments}/amazon-ads.openapi.json`],
  },
  { text: 'VAST 4.0 spec', in: [`${providerDocuments}/campaign-manager-360.openapi.json`] },
  ...['ResponsiveDisplayAdControlSpec', 'controlSpec', 'executionLimitSeconds', 'LLM inference'].map((vendorText) => ({
    text: vendorText,
    in: [googleAdsDocument],
  })),
  { text: 'A primitive filter', in: [analyticsDocument, `${providerDocuments}/google-analytics-admin.openapi.json`] },
  { text: 'inferenceClassification', in: [`${providerDocuments}/outlook.openapi.json`] },
  ...['CohortSpec', 'cohortSpec'].map((vendorText) => ({ text: vendorText, in: [analyticsDocument] })),
  ...[
    'ChartSpec',
    'SlicerSpec',
    'SortSpec',
    'sortSpecs',
    'sort spec',
    'FilterSpec',
    'filterSpecs',
    'filter_specs',
    'DataSourceSpec',
    'DatasourceSpec',
    'QuerySpec',
    'querySpec',
    'TableSpec',
    'tableSpec',
    '"spec"',
    'OBJECT_SPEC_INVALID',
    'ExecutionStatus',
    'DATA_EXECUTION_',
    'EXECUTION_NOT_FOUND',
    'QUERY_EXECUTION_COMPLETED',
    'data execution',
    'an execution',
    'execution status',
  ].map((vendorText) => ({ text: vendorText, in: [sheetsDocument] })),
  { text: 'execution-denied', in: ['capabilities/reasoning/src/tools/final-step.test.ts'] },
  ...['primitives?', 'executions?', 'inference', 'orchestration', 'recollection'].map((term) => ({
    text: String.raw`/\b${term}\b/iu`,
    in: [internalTerms],
  })),
  ...[
    "['Created the inference spec.', 'spec']",
    "['The specs of the playbook.', 'specs']",
    "['A primitive of the playbook.', 'primitive']",
    "['The execution started.', 'execution']",
    "['It ran an inference.', 'inference']",
    "['An orchestration started.', 'orchestration']",
    "['It folds a recollection.', 'recollection']",
  ].map((leak) => ({ text: leak, in: [internalTermsTest] })),
  { text: "**inference** names a model call and its provider's terms", in: ['CLAUDE.md'] },
  {
    text: 'toPrimitive',
    in: ['packages/definitions/lib/sandbox.d.ts.txt', 'packages/workflow-engine/src/programs/sandbox-prelude.ts'],
  },
];

const textOnly = new TextDecoder('utf-8', { fatal: true });

function textOf(path: string): string | undefined {
  try {
    return textOnly.decode(readFileSync(join(root, path)));
  } catch {
    return undefined;
  }
}

const listed = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
  cwd: root,
  encoding: 'utf8',
})
  .split('\0')
  .filter((path) => path !== '');

const searched = listed.filter(
  (path) => !keptFiles.includes(path) && existsSync(join(root, path)) && !lstatSync(join(root, path)).isSymbolicLink(),
);

function placeOf(allowance: Allowance, path: string): string {
  return `${path}: ${allowance.text}`;
}

const allowedOccurrences = new Map<string, number>();

function maskedAllowances(path: string, text: string): string {
  return allowances
    .filter((allowance) => allowance.in.includes(path))
    .reduce((masked, allowance) => {
      const pieces = masked.split(allowance.text);
      const place = placeOf(allowance, path);
      allowedOccurrences.set(place, (allowedOccurrences.get(place) ?? 0) + pieces.length - 1);
      return pieces.join(' '.repeat(allowance.text.length));
    }, text);
}

function lineAt(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

function oldWordsIn(path: string, text: string): readonly string[] {
  const masked = maskedAllowances(path, text);
  const found = oldWords
    .flatMap((word) => foundIn(masked, word))
    .toSorted((one, other) => one.index - other.index)
    .map(({ index, word }) => `${path}:${lineAt(masked, index)}: ${word}`);
  return [...new Set(found)];
}

const findings = searched.flatMap((path) => {
  const text = textOf(path);
  return text === undefined ? [] : oldWordsIn(path, text);
});

const allowedButAbsent = allowances
  .flatMap((allowance) => allowance.in.map((path) => placeOf(allowance, path)))
  .filter((place) => (allowedOccurrences.get(place) ?? 0) === 0);

const leftOutButUnlisted = keptFiles.filter((path) => !listed.includes(path));

const pagesOfTheGuides = /^docs\/(?:reference|concepts|tutorials)\/.*\.md$/u;

const oldLanguageOnPages = listed
  .filter((path) => pagesOfTheGuides.test(path))
  .flatMap((path) =>
    foundIn(textOf(path) ?? '', String.raw`\bjq\b`).map(({ index }) => `${path}:${lineAt(textOf(path) ?? '', index)}`),
  );

await test('no file git tracks or would add says an old word, outside the records, the changelog, the lockfile, the frozen formats, the old words themselves and the published schema of OpenAPI documents, but the texts it allows', () => {
  assert.deepEqual(findings, []);
});

await test('no page of the reference, the concepts or the tutorials, the pages the playbook serves as its guides, names the language it no longer runs', () => {
  assert.deepEqual(oldLanguageOnPages, []);
});

await test('every text the search allows still occurs in each file it is allowed in, and every file it leaves out is still there', () => {
  assert.deepEqual([...allowedButAbsent, ...leftOutButUnlisted], []);
});
