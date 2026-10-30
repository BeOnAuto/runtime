import type { Schema } from 'effect';

export const campaignPace = [
  '---',
  'description: Spend, pace and projection per campaign, in cents, for a reporting period',
  'language: typescript',
  'input:',
  '  schema:',
  '    type: object',
  '    required: [rows, period]',
  '    properties:',
  '      rows: { type: array, maxItems: 4000, items: { type: object, required: [campaign, cost_cents, budget_cents], properties: { campaign: { type: string }, cost_cents: { type: integer, minimum: 0, maximum: 5000000 }, budget_cents: { type: integer, minimum: 0, maximum: 1000000000 } } } }',
  '      period: { type: object, required: [days_elapsed, days_total], properties: { days_elapsed: { type: integer, minimum: 1, maximum: 366 }, days_total: { type: integer, minimum: 1, maximum: 366 } } }',
  'output:',
  '  schema:',
  '    type: object',
  '    required: [campaigns, total_spend_cents]',
  '    properties:',
  '      campaigns: { type: array, items: { type: object } }',
  '      total_spend_cents: { type: integer }',
  '---',
  'export default function (input: Input): Output {',
  '  const { days_elapsed, days_total } = input.period;',
  '  if (days_elapsed > days_total) {',
  '    throw new Error(`days_elapsed ${days_elapsed} is past days_total ${days_total}`);',
  '  }',
  '  const campaigns = [...Map.groupBy(input.rows, (row) => row.campaign)]',
  '    .toSorted(([first], [second]) => (first < second ? -1 : 1))',
  '    .map(([campaign, rows]) => {',
  '      const budget_cents = rows[0].budget_cents;',
  '      const spend_cents = rows.reduce((sum, row) => {',
  '        if (row.budget_cents !== budget_cents) {',
  '          throw new Error(`The rows of ${campaign} disagree on its budget: ${budget_cents} and ${row.budget_cents}`);',
  '        }',
  '        return sum + row.cost_cents;',
  '      }, 0);',
  '      const projected_cents = Math.floor((spend_cents * days_total) / days_elapsed);',
  '      const pace_permille = budget_cents === 0 ? null : Math.floor((projected_cents * 1000) / budget_cents);',
  '      return { campaign, spend_cents, budget_cents, projected_cents, pace_permille };',
  '    });',
  '  return { campaigns, total_spend_cents: campaigns.reduce((sum, each) => sum + each.spend_cents, 0) };',
  '}',
].join('\n');

const campaigns = 4;

export function campaignRows(count: number): Schema.JsonObject {
  return {
    rows: Array.from({ length: count }, (_, index) => ({
      campaign: `campaign-${index % campaigns}`,
      cost_cents: 1000 + ((index * 37) % 9000),
      budget_cents: 5_000_000,
    })),
    period: { days_elapsed: 12, days_total: 31 },
  };
}
