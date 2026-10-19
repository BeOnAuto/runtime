# next-week-orders

Forecasts a region's orders for next week, or returns none while no version is active.

## What starts it

- By a call of `run_definition`, from a caller or from a step of another workflow

## What it needs

| Field | Required | What it is |
| --- | --- | --- |
| **region** | yes | Text. |
| **promotion** | yes | A number. |

## What it produces

It produces any output, which its document does not describe.

## What it does

```mermaid
flowchart LR
  subgraph g1["1. Try"]
    n2["2. Run weekly-orders"]
  end
  n1(["By a call"])
  n3["3. Set forecast"]
  n1 --> n2
  n2 -.->|"on error 409"| n3
```

Its steps, numbered as in the diagram:

1. **forecast** tries step 2; on an error with status 409, when `$error.kind == "no_active_version"`, it does step 3.
2. **ask** runs the prediction function **weekly-orders**.
3. **none** sets **forecast**.

## What it calls

It calls the prediction function **Weekly orders**: Predicts the orders of each region one and four weeks ahead.

## Details

### What it calls

- `weekly-orders`, a prediction function
