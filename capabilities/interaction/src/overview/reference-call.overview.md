# read-campaign-costs

Reads the cost rows of every campaign for a month.

It is given the month and asks **ads** with its tool `campaign-costs`, once per run. It answers with what it answered under `rows`: a list of records.

## Details

### Input

| Field | Required | What it is |
| --- | --- | --- |
| **month** | yes | Text. |

### Output

A list of records with: **campaign** (text), **cost_cents** (a whole number), **budget_cents** (a whole number).

### Call

It calls the tool `campaign-costs` of the server **ads**, its answer read at `/rows`, with these arguments, as written:

- `month`: `{{ input.month }}`
