# approve-brief

Asks the campaign owner to approve a reviewed brief.

It is given the owner and the review. It sends the owner this message, with the run's values in place of the words in brackets:

> The review of your campaign brief is ready:
>
> \[the review\]
>
> Approve the brief as it stands, or ask for a revision.

It leaves the message in the playbook's inbox, where whoever may write to the playbook answers it. If nobody answers within 2 days, the request ends unanswered.

It answers with the verdict, one of approve and revise, and the note, when there is one.

## Details

### Input

| Field | Required | What it is |
| --- | --- | --- |
| **owner** | yes | Text. |
| **review** | yes | Text. |

### Answer

| Field | Required | What it is |
| --- | --- | --- |
| **verdict** | yes | One of: approve, revise. |
| **note** | no | Text, at most 2,000 characters. |

### Where

To `{{ input.owner }}`. Left in the playbook's inbox; expires after `P2D`.
