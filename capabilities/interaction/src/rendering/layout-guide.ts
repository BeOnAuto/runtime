export const layoutGuide = `## Lay the card out

Decide what the reader must know, decide or do. Build the card around that one thing, and leave out what does not serve it.

**Order.** Use these zones in this order. Skip a zone that would be empty or padding.

1. Title: what happened or what is needed, with the number or state that matters. Subtitle: one short fact that places it, such as who or when. A notification shows the top of the card, so these two must stand alone. Do not repeat them below.
2. Lead: one plain Text, only for a reason or a consequence the title cannot carry.
3. Facts: one Fields block of two to six pairs, the one the reader acts on first.
4. Body: what the reader must read, look at or compare, in that order: a Text of input prose, an Image, up to two Charts, one Table.
5. Ask, when the card asks something: a Divider, one bold Text with the question, then the replies. It comes after everything the reader needs to answer. When the title is the question and nothing sits between, skip the Divider and the bold Text.
6. Links: one Actions row.
7. Footnote: one muted Text. When the reader need do nothing, it says so.

**Component by content.**

- Pairs whose labels you know now: Fields. A lone fact goes in the title or subtitle.
- An input list with one value per item, bounded by the input schema to ten or fewer: repeated Fields. More values per item, or no bound: a Table of at most four columns, numbers aligned right.
- Values across categories or time: a Chart, only when the input always holds the same points. Line for time, bar for categories, pie for shares of a whole. A single number goes in the title or a Field.
- Input text of unknown length: its own plain Text in the body, whole, never in the title, the subtitle or a Field.
- A picture the reader must judge: an Image whose alt says what it shows.
- A link: a LinkButton labelled with what it opens, never an address or a link in a Text. Give the one link the reader most likely needs \`style: primary\`, which shows it in colour, and leave the others plain. Use \`style: danger\` only for a link to something that cannot be undone. Links from an input list: repeated LinkButtons.

**Replies.** The reader answers by replying in the thread, so say exactly what to reply. For yes or no, one muted Text is enough. For several answers, write one Field per answer, its label the exact word to reply and its value what happens next, then one muted Text that says to reply with one of them. Show an answer that takes a note as the word, then what to add.

**Emphasis.** The title is the entry point. Only the ask is bold, so a card that asks nothing has no bold Text. Only the footnote and the reply instructions are muted. Use a Divider only before the ask, or between two groups the reader handles separately. Use a Section to repeat a group once for each input item.

**Data you cannot see.** The card cannot count, cut, sort or hide. Have the step before it pass what the card shows: a summary line that reads right at zero and at many, for the subtitle or the lead; at most ten rows, sorted, with a link to the rest; and a Table caption that says what was left out or that there is nothing, since an empty Table still shows its headers.

**Small stays small.** A reminder may be a title, one Text and one LinkButton.

**Fix these.**

- One long Text: split it into title, lead, Fields and links.
- "Label: value" in a sentence: make it a Field.
- More than six Fields: drop what nobody acts on, or use a Table.
- The question in the title and again in the body: keep it once.
- The ask before what the reader must read: move it after.

**Check before saving.**

- Do the title and subtitle alone say what this is and what is needed?
- Is at most one Text bold, and is it the ask?
- Does the card read right with no items and with a very long text?
- Can the reader tell exactly what to reply, or that nothing is needed?
`;
