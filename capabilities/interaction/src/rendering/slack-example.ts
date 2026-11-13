export const slackExample = `---
description: Tell a team how the week's orders went
to: '{{ input.channel }}'
expires: P1D
render: slack
deliver:
  server: chat
  tool: post_message
  with: { channel: '{{ to }}', blocks: '{{ rendered }}', text: '{{ message }}' }
input:
  schema:
    type: object
    required: [channel, week, summary, totals, lateOrders, reportUrl]
    properties:
      channel: { type: string }
      week: { type: string }
      summary: { type: string }
      totals:
        type: array
        items:
          type: object
          required: [label, value]
          properties: { label: { type: string }, value: { type: string } }
      lateOrders: { type: array, items: { type: array, items: { type: string } } }
      reportUrl: { type: string }
---
root: card
elements:
  card:
    type: Card
    props: { title: { $template: 'Orders, week of \${/input/week}' } }
    children: [summary, totals, late, links]
  summary:
    type: Text
    props: { content: { $state: /input/summary } }
  totals:
    type: Fields
    repeat: { statePath: /input/totals }
    children: [total]
  total:
    type: Field
    props: { label: { $item: label }, value: { $item: value } }
  late:
    type: Table
    props: { headers: [Order, Customer, Days late], rows: { $state: /input/lateOrders } }
  links:
    type: Actions
    children: [report]
  report:
    type: LinkButton
    props: { label: Open the report, url: { $state: /input/reportUrl } }
`;
