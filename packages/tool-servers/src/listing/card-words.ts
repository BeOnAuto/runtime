import { quoted } from '@on.auto/phrasing';

export const rendersDescription =
  'The render target a message through it can be written for, as a card; the guide render-<name> says how; absent where it renders nothing';

export function cardWords(server: string, renders: string): string {
  return `A message sent through ${quoted(server)} can be a card with fields, a table, a chart and link buttons: write it in an interaction function with render: ${renders}, and read the guide render-${renders}.`;
}
