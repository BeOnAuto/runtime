# review-and-approve

Reviews a campaign brief, then asks its owner to approve the review.

## What starts it

- By a call of `run_definition`, from a caller or from a step of another workflow

## What it needs

| Field | Required | What it is |
| --- | --- | --- |
| **brief** | yes | Text. |
| **owner** | yes | Text. |

## What it produces

It produces any output, which its document does not describe.

## What it does

```mermaid
flowchart LR
  subgraph g1["1. Try"]
    n2["2. Run review-campaign-brief"]
  end
  subgraph g2["4. Try"]
    n4["5. Run approve-campaign-brief"]
  end
  n1(["By a call"])
  n3(["3. Raise “The review could not be run”"])
  n5["6. Set verdict and note"]
  n1 --> n2
  n2 --> n4
  n2 -.->|"on error 503, after retries"| n3
  n4 -.->|"on an error"| n5
```

Its steps, numbered as in the diagram:

1. **review** tries step 2; on an error with status 503, it tries again under the retry policy **patient**, and once no retry is left, it does step 3.
2. **review-brief** runs the reasoning function **review-campaign-brief**.
3. **give-up** raises the error *The review could not be run*, with status 503.
4. **approval** tries step 5; on an error whose type is `https://on.auto/problems/unanswered`, it does step 6.
5. **ask-for-approval** runs the interaction function **approve-campaign-brief**.
6. **no-answer** sets **verdict** and **note**.

## What it calls

It calls the reasoning function **Review campaign brief**: Reviews a campaign brief against four criteria and recommends Ready or Revise.

It calls the interaction function **Approve campaign brief**: Asks the campaign owner to approve a reviewed brief.

## Details

### What it calls

- `review-campaign-brief`, a reasoning function
- `approve-campaign-brief`, an interaction function
