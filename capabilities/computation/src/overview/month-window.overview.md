# month-window

Turns a month such as 2026-04 or "April 2026" into its date range, the previous month's date range and readable labels.

It is given the month to report on, as 2026-04 or April 2026, and a program works out the answer, the same every time for the same input: the month, the label, the start, the end, the prev label, the prev start and the prev end.

## Used by

- The workflow **Monthly website report** calls it in step 1, **Work out month**.

## Details

### Input

| Field | Required | What it is |
| --- | --- | --- |
| **month** | yes | The month to report on, as 2026-04 or April 2026. Text, 6 to 20 characters. |

### Output

| Field | Required | What it is |
| --- | --- | --- |
| **month** | yes | Text. |
| **label** | yes | Text. |
| **start** | yes | Text. |
| **end** | yes | Text. |
| **prev_label** | yes | Text. |
| **prev_start** | yes | Text. |
| **prev_end** | yes | Text. |

### Program

TypeScript, in the definition's document.

### Used by

- `monthly-website-report`, a workflow
