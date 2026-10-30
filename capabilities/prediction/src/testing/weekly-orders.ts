export const weeklyOrdersLines: readonly string[] = [
  '---',
  'description: Predicts the orders of each region one and four weeks ahead',
  'predicts:',
  '  target: orders',
  '  period: week',
  '  season: 52',
  '  horizons: [1, 4]',
  '  unit: orders',
  'data:',
  '  events:',
  '    - type: order.placed',
  '  time: /placed_at',
  '  series: /region',
  '  target: { as: count }',
  '  features:',
  '    - { name: basket, of: /total, as: mean }',
  '    - { name: promotion, of: /promotion, as: last }',
  '  given: [promotion]',
  '  window: 156',
  'evaluation:',
  '  holdout: 12',
  '  activate: automatic',
  'source:',
  '  expires: P7D',
  'rules:',
  '  - Train on the rows given and on nothing else',
  '---',
  'Fit a model of the weekly {{ function.target }} of each of {{ dataset.series }} regions, in {{ function.unit }},',
  'over {{ dataset.window }} weeks from {{ dataset.periods.first }} to {{ dataset.periods.last }}.',
  'Predict {{ dataset.horizons | join: " and " }} weeks ahead. The features are',
  '{% for feature in dataset.features %}{{ feature.name }} ({{ feature.as }}){% unless forloop.last %}, {% endunless %}{% endfor %}.',
  '{% for rule in function.rules %}- {{ rule }}',
  '{% endfor %}',
];

export const weeklyOrders = weeklyOrdersLines.join('\n');

export function documentWith(lines: readonly string[], ...replaced: readonly (readonly [string, string])[]): string {
  return replaced
    .reduce<readonly string[]>((kept, [from, to]) => {
      const at = kept.indexOf(from);
      if (at === -1) {
        throw new Error(`The example has no line ${from}`);
      }
      return [...kept.slice(0, at), ...(to === '' ? [] : to.split('\n')), ...kept.slice(at + 1)];
    }, lines)
    .join('\n');
}

export function weeklyOrdersWith(...replaced: readonly (readonly [string, string])[]): string {
  return documentWith(weeklyOrdersLines, ...replaced);
}

export const basketLine = '    - { name: basket, of: /total, as: mean }';

export const promotionLine = '    - { name: promotion, of: /promotion, as: last }';

export function uploadedWeeklyOrders(sha256: string): string {
  return weeklyOrdersWith(
    ['  events:', `  dataset: ${sha256}`],
    ['    - type: order.placed', ''],
    ['  time: /placed_at', ''],
    ['  series: /region', ''],
    ['  target: { as: count }', ''],
    [basketLine, '    - basket'],
    [promotionLine, '    - promotion'],
  );
}
