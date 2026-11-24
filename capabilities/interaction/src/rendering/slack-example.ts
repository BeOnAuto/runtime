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
    props: { label: Open the report, url: { $state: /input/reportUrl }, style: primary }
`;

export const slackAskExample = `---
description: Ask the owner to approve or reject the logo and the palette of a brand
to: '{{ input.channel }}'
from: '{{ input.owner }}'
expires: P2D
render: slack
deliver:
  server: chat
  tool: post_message
  with: { channel: '{{ to }}', blocks: '{{ rendered }}', text: '{{ message }}' }
  sent: { conversation: /channel, id: /ts }
replies:
  tool: thread_replies
  with: { channel: '{{ sent.conversation }}', ts: '{{ sent.id }}', oldest: '{{ since | default: "0" }}' }
  read:
    list: /messages
    order: oldest_first
    each: { id: /ts, sender: /user, text: /text, to: /thread_ts }
input:
  schema:
    type: object
    required: [channel, owner, brand]
    properties:
      channel: { type: string }
      owner: { type: string }
      brand: { type: string }
output:
  schema:
    type: object
    required: [logo, palette]
    properties:
      logo: { type: string, enum: [approve, reject] }
      palette: { type: string, enum: [approve, reject] }
---
root: card
elements:
  card:
    type: Card
    props: { title: { $template: 'Brand review for \${/input/brand}' }, subtitle: Approve or reject each part }
    children: [logo, palette, everything, footnote]
  logo:
    type: Section
    children: [logoName, logoRow]
  logoName:
    type: Text
    props: { content: The logo }
  logoRow:
    type: Actions
    children: [approveLogo, rejectLogo]
  approveLogo:
    type: Button
    props: { label: Approve, style: primary, once: true, sets: [{ at: /logo, value: approve }] }
  rejectLogo:
    type: Button
    props: { label: Reject, once: true, sets: [{ at: /logo, value: reject }] }
  palette:
    type: Section
    children: [paletteName, paletteRow]
  paletteName:
    type: Text
    props: { content: The palette }
  paletteRow:
    type: Actions
    children: [approvePalette, rejectPalette]
  approvePalette:
    type: Button
    props: { label: Approve, style: primary, once: true, sets: [{ at: /palette, value: approve }] }
  rejectPalette:
    type: Button
    props: { label: Reject, once: true, sets: [{ at: /palette, value: reject }] }
  everything:
    type: Actions
    children: [approveAll]
  approveAll:
    type: Button
    props:
      label: Approve all
      once: true
      sets: [{ at: /logo, value: approve }, { at: /palette, value: approve }]
  footnote:
    type: Text
    props: { content: Click a button, or reply in the thread., style: muted }
`;
