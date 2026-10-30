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
  '  window: 156',
  '---',
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
