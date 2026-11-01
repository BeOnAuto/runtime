# @on.auto/phrasing

The English the runtime words its results in: the functions that list, quote, count and bound the plain words a person reads. It is a package of its own because every package that words an outcome, a refusal or a page uses them, and they depend on nothing, neither on the outcomes of the operations nor on any other package.

## Phrasing

`src/plain-language/phrasing.ts` holds them, the lists and the plurals among them in the English of `Intl`:

- `listed(items)` joins items as a list does, `a, b, and c`, and `alternatives(items)` as a choice does, `a, b, or c`.
- `quoted(text)` puts a name between typographic quotes, `“Sales”`.
- `counted(count, noun)` counts a `Noun`, `{ one, other }`, in the number's plain form and the noun's form for that number, `1 reasoning function`, `two hundred and three reasoning functions`; `plainNumber(number)` is that plain form, a whole number from 100 to 599 spelled out, so that no count reads as a status code, and any other number in digits.
- `articled(noun)` gives a noun its indefinite article, `an input`, `a run`.
- `capitalized(text)` puts the first character in capitals, and `asSentence(text)` ends a text with a full stop where it does not end as a sentence already.

## Bounds

`src/plain-language/word-bounds.ts` bounds what a person reads at once: an outcome takes at most `mostOutcomeCharacters`, 400 characters, the words of a refusal at most `mostRefusalCharacters`, 600, and the words an operation relays at most `mostRelayedCharacters`, 1,000. `withinCharacters(text, most)` keeps the whole sentences that fit and ends with "The rest is in the details below.", since the detail is in the structured result beside the words; a first sentence longer than the bound is cut at a word with an ellipsis.
