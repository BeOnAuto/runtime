# campaign-pace

Spend, pace and projection per campaign, in cents, for a reporting period.

It is given the rows and the period, and a program works out the answer, the same every time for the same input: the campaigns and the total spend cents.

## Details

### Input

| Field | Required | What it is |
| --- | --- | --- |
| **rows** | yes | A list of at most 4,000 records with: **campaign** (text), **cost_cents** (a whole number, from 0 to 5,000,000), **budget_cents** (a whole number, from 0 to 1,000,000,000). |
| **period** | yes | A record with: **days_elapsed** (a whole number, from 1 to 366), **days_total** (a whole number, from 1 to 366). |

### Output

| Field | Required | What it is |
| --- | --- | --- |
| **campaigns** | yes | A list of records. |
| **total_spend_cents** | yes | A whole number. |

### Program

TypeScript, in the definition's document.
