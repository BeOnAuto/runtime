<div v-pre>

# Templates

These are [Liquid](https://shopify.github.io/liquid/) templates:

- a reasoning function's prompt;
- a lookup function's texts in `call.with`;
- an interaction function's `to`, `from` and message, and the templates of the tools it names;
- a generation function's prompt;
- a page's `result` and `runs`, which render Markdown; see [Page format](page-format.md#the-templates).

Each format says which variables its templates read. Every template may use the same filters.

## Filters

Liquid's standard data and string filters are available: `abs`, `append`, `array_to_sentence_string`, `at_least`, `at_most`, `base64_decode`, `base64_encode`, `capitalize`, `ceil`, `compact`, `concat`, `default`, `divided_by`, `downcase`, `escape`, `escape_once`, `find`, `find_index`, `first`, `floor`, `group_by`, `has`, `join`, `json`, `last`, `lstrip`, `map`, `minus`, `modulo`, `newline_to_br`, `normalize_whitespace`, `number_of_words`, `plus`, `pop`, `prepend`, `push`, `raw`, `reject`, `remove`, `remove_first`, `remove_last`, `replace`, `replace_first`, `replace_last`, `reverse`, `round`, `rstrip`, `shift`, `size`, `slice`, `slugify`, `sort`, `sort_natural`, `split`, `squish`, `strip`, `strip_newlines`, `sum`, `times`, `to_integer`, `truncate`, `truncatewords`, `uniq`, `unshift`, `upcase`, `where` and `xml_escape`.

`divided_by` keeps the fraction, even of two whole numbers: `{{ 13857781 | divided_by: 100 }}` is `138577.81`, where Shopify's Liquid gives `138577`. Add `| floor` for a whole number.

The runtime adds three filters:

| Filter  | What it does                                                                                                                                                                           | Example                                                        |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `money` | Formats a number, or a string holding a decimal number, as US dollars with thousands separators: no cents for a whole amount, two decimals otherwise. Any other value stops the render | `{{ 364028 \| money }}` is `$364,028`; `1234.5` is `$1,234.50` |
| `clip`  | Cuts text to a number of characters, 400 by default, and appends an ellipsis (`…`) when it cuts. Characters are counted as Unicode code points                                         | `{{ input.notes \| clip: 200 }}`                               |
| `words` | Counts the words in a string, where a word is a run of characters between whitespace                                                                                                   | `{% assign n = input.notes \| words %}`                        |

A template that names any other filter is refused when it is saved. Not available:

- The date filters. They read the server's clock and time zone, so the same template would render differently on another server. Templates read `today` and `now` instead, except those of an interaction function's `replies`, `tell` included, which read neither; [Templates and pointers](interaction-format.md#templates-and-pointers) lists the names each place reads.
- `sample`, which is random.
- The digest filters, `strip_html` and the URL encoders.
- The filters that evaluate an expression given as text, such as `where_exp`.
- `inspect` and `jsonify`, which duplicate `json`.

The repository's [engineering reference](https://github.com/BeOnAuto/runtime/blob/main/docs/engineering/reference/reasoning-format.md#filters) explains, for contributors, why each left-out filter is withheld.

</div>
