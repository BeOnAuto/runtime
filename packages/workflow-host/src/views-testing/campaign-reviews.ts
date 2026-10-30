import { detailsOf } from './view-documents.ts';

export const reviewsFold = [
  'function fieldOf(value, name) {',
  "  return typeof value === 'object' && value !== null && !Array.isArray(value) ? Reflect.get(value, name) : undefined;",
  '}',
  '',
  'function lastAt(reviews) {',
  "  return reviews.at(-1)?.at ?? '';",
  '}',
  '',
  'export function fold(view, event) {',
  "  const output = fieldOf(event.data, 'output');",
  "  const named = fieldOf(output, 'campaign');",
  "  const campaign = typeof named === 'string' ? named : 'unknown';",
  "  const verdict = String(fieldOf(output, 'verdict') ?? 'none').slice(0, 200);",
  "  const reviews = [...(view[campaign] ?? []), { at: event.time ?? '', verdict, run: event.source }].slice(-20);",
  '  const latest = Object.entries({ ...view, [campaign]: reviews })',
  '    .toSorted(([, first], [, second]) => (lastAt(first) < lastAt(second) ? -1 : lastAt(first) > lastAt(second) ? 1 : 0))',
  '    .slice(-50);',
  '  return Object.fromEntries(latest);',
  '}',
  '',
  'export function answer(view, input) {',
  '  return (view[input.campaign] ?? []).slice(-(input.last ?? 5));',
  '}',
].join('\n');

const reviewFilters = [{ type: 'run_succeeded', subject: 'reasoning/review-brief' }];

const reviewsSchema = {
  type: 'object',
  maxProperties: 50,
  additionalProperties: { type: 'array', maxItems: 20 },
};

export const campaignReviews = detailsOf(reviewsFold, reviewFilters, { schema: reviewsSchema });
