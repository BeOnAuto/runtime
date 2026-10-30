# Build your first workflow

In this tutorial you connect two functions: one reviews a campaign brief, and another drafts feedback from that review. A workflow runs them in order and keeps both results.

The campaign and figures below are sample data. This exercise sends no messages and changes no advertising accounts.

## Before you start

Finish [Build your first playbook](first-playbook.md). You need its "Campaign review tutorial" playbook and "Review campaign brief" function, with your agent connected to the same organization.

## 1. Check the review function

Send your agent this message:

> In my "Campaign review tutorial" playbook, show me "Review campaign brief" and what it needs as input. Don't change it.

Your agent should show the four review criteria and say that the function takes a brief as text. If the function is missing, finish the first tutorial before continuing.

## 2. Create the feedback function

Send this message:

> In that playbook, create a reasoning function called "Draft brief feedback". It takes the review as text and writes a short message to the brief's author. It lists the changes the review asks for, without adding facts or requirements. If the review recommends Ready, it says the brief meets the review criteria. It only drafts the message; it sends nothing. Use one of the models Auto offers. Show me the function before saving it.

Your agent should show a function that takes a review and returns a draft message. Check that it uses the review as its source and has no tool for sending messages. Then ask the agent to save it.

## 3. Save the workflow

> Create a workflow called "Review and draft feedback" in the same playbook. It takes a campaign brief, runs "Review campaign brief", then passes that function's answer to "Draft brief feedback". Return both the review and the draft, under the names review and feedback. Show me the steps before saving it. Run it only when I ask; do not add a schedule.

Check the order before you approve it:

1. The first function receives your brief.
2. The second function receives the first function's answer.
3. The workflow returns both answers.

The agent saves the workflow at version 1. If Auto rejects the definition, the agent gets the validation error and can correct it.

## 4. Run it on an incomplete brief

Send this message with the sample below:

> Run "Review and draft feedback" on this brief. Show me the workflow's result, and keep its run id so we can inspect it.

```text
Campaign: Autumn reporting trial
Audience: Businesses that need better reporting
Offer: A 30-day trial
Channel: Paid LinkedIn ads
Total budget: USD 8,000
Success measure: Generate interest in the product
```

The workflow starts in the background. Your agent may first see `status: started`; it reads the run again to get the finished result.

When it finishes, expect `status: succeeded` and two outputs:

| Output     | What to check                                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `review`   | Recommends Revise because the audience lacks a specific role and company type, and the success measure lacks a numeric target. |
| `feedback` | Asks the author to supply those missing details, without inventing them.                                                       |

Both answers come from models, so their wording varies. The workflow's success means its steps finished; you still need to judge the answers.

## 5. Inspect the steps

> Show me the history of that workflow run. Which version of each function ran? Show what "Draft brief feedback" received and compare it with the first function's answer. Don't run anything again.

Your agent should find two function runs under the workflow run. The second function's input should contain the review, and the workflow should keep the review and feedback together.

Open [Auto Studio](https://studio.on.auto) in the same organization. Select the workflow in "Campaign review tutorial" and open its run to follow the recorded steps.

## 6. Run it with a complete brief

> Run the same workflow on this revised brief, without changing either function. Compare the results with the previous run.

```text
Campaign: Autumn reporting trial
Audience: Finance directors at UK manufacturing companies with 50 to 250 employees
Offer: A 30-day trial
Channel: Paid LinkedIn ads
Total budget: USD 8,000
Success measure: 100 trial registrations
```

This review should recommend Ready. The feedback should say the brief meets the criteria, without treating that finding as approval to launch a campaign.

The two workflow runs have different run ids and use the same saved definitions.

## If something goes wrong

- If the second step gets the brief instead of the review, ask your agent to fix how the workflow passes the first answer to it.
- If a step fails, inspect its error and input before starting a new run. Check that each function works on its own.
- If the agent cannot find the workflow, check the organization and playbook it is using.

[Run a workflow on a schedule or event](../guides/triggers.md) shows how to start work automatically. [Workflows and runs](../concepts/workflows.md) explains how Auto records its progress.
