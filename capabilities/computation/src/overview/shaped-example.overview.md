# monthly-sign-ups

Monthly sign-ups, with their monthly average marked.

It is given the months, and a program works out the answer, the same every time for the same input: a series over time.

## Details

### Input

| Field | Required | What it is |
| --- | --- | --- |
| **months** | yes | A list of 1 to 120 records with: **month** (text), **signups** (a whole number, at least 0). |

### Output

It answers a series over time, in **unit**: 1 to 20 lines, one for each **name**, of at most 2,000 **points** in all, each a **value** at its **at**, with a **low** and a **high** where given, and at most 8 **marks**, each a **value** with a **label**. Each **at** is a day, week, month, quarter or year, as **period** names, or a date and time where it names none, and **origin** is the last one observed.

### Program

TypeScript, in the definition's document.
