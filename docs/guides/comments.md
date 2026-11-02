---
description: Comment on a step, a run or a result in Studio, and have your agent act on what you and your teammates said.
---

# Act on comments from Studio

When something in Studio looks wrong, such as a step's prompt, a run that never ended or a figure on a page, comment on it where you see it. Your agent then reads the comments, changes what each is about and resolves it. This guide goes through that loop once.

## Before you start

- Your agent is connected to Auto with permission to change your playbook (`playbook:write`). The [quick start](../get-started/cloud.md) sets this up.
- You can open the playbook in Studio. Anyone who may read a playbook may comment on it.

## 1. Comment where you see it

In Studio, comment on the thing itself: a definition, a step of a workflow, a run, an event in a run's history, a block of a run's result or the playbook. Say what should change, as you would to a colleague, such as "Flag any entry over $10,000 for Priya before the week closes."

The comment keeps the [address](../reference/addresses.md) of what it is about, so you need not say where it is. Your teammates see it too, and you see theirs.

## 2. Read what people said in Studio

Ask your agent:

```text
Read the open comments on my "<playbook name>" playbook in Auto, act on each
where it points, and resolve each one you acted on. Tell me what you changed.
```

You can also copy the comments from Studio and paste them into the conversation.

The agent lists the playbook's open comments with `list_comments`. For each, it reads the thing at the comment's address, such as the workflow with `get_definition` or the run with `get_run`, and changes it as the comment asks, such as with `update_definition`. Then it resolves the comment with `resolve_comment`, `how` `acted`. [From an address to a call](../reference/addresses.md#from-an-address-to-a-call) lists the tools for each kind of address.

You should see the agent name each comment, what it changed for it, and a link to the changed page in Studio. A comment it could not act on stays open, and the agent says why.

## 3. Check the change

Open the link the agent gave you. The new version of the definition is there, and the comment is resolved: it no longer shows among the open comments, or in the organization's activity. Ask your agent to run the workflow again when you want to see the change at work.

## If something goes wrong

- **The agent finds no comments.** It reads the open comments of one playbook. Check that it read the playbook you commented on, and that nobody resolved the comments first.
- **A comment is about an older version.** The definition changed after the comment was made. The agent reads the comment against the current version and acts only where it still applies.
- **The agent cannot change the thing.** Changing a definition needs `playbook:write`, which commenting does not. Connect the agent with a key or a sign-in that may change the playbook.
- **The playbook is retired.** Its comments stay readable, open or resolved, but nothing in it can be changed, and its comments cannot be resolved or added to. Your agent can only read them and report them to you.
- **You want to take a comment back.** Comments cannot be edited. Resolve it in Studio and comment again.

## Next

- [Comments](../reference/http.md#comments) gives the routes, the fields and the limits.
- [Addresses](../reference/addresses.md) sets out what an address names.
