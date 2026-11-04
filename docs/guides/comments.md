---
description: Comment on anything in Studio, where you see it, and have your agent act on what you and your teammates said.
---

# Act on comments from Studio

When something in Studio looks wrong, such as a step's prompt, a run that never ended, a figure on a page or a connection that stopped working, comment on it where you see it. Your agent then reads the comments, changes what each is about and resolves it. This guide goes through that loop once.

## Before you start

- Your agent is connected to Auto with permission to change your playbook (`playbook:write`). The [quick start](../get-started/cloud.md) sets this up. To act on the organization's connections, it also needs `org:write`.
- You can open the playbook in Studio. Anyone who may read a playbook may comment on it, and anyone in the organization may comment on its connections, members and settings.

## 1. Comment where you see it

Every page of Studio has one Edit with agent button, in the top-right corner of the page. Press it, then click the thing you mean: a section of the dashboard, the Ledger, a step in the diagram, an event in a run's history, a block of a run's result, a connection, a member, a card in Settings, or anywhere else on the page. A pin with your initials drops where you clicked, and a field opens under it. Say what should change, as you would to a colleague, such as "Flag any entry over $10,000 for Priya before the week closes." Press Escape to put the pin away without commenting.

Where the runtime has a [voice model](../self-host/models.md#a-voice-model), the field has a mic: press it, or hold Alt+V, and speak for up to two minutes. What you said is written into the field, for you to read before you send it.

The comment keeps the [address](../reference/addresses.md) of what it is about, and the pin stays where you dropped it as the page scrolls or resizes. Click a pin to open its thread: the comments on that thing, oldest first, where you and your teammates reply. A reply joins the thread and drops no pin of its own.

The button's menu holds Show all requests, which opens the list of every comment, with where each is; click one to go to it. A dot on the button says the page has open comments.

## 2. Hand the comments to your agent

From the button's menu, choose Copy all requests for agent, and paste the line into the conversation. It reads:

```text
Read the open comments in Auto, the organization's and each playbook's, with
list_comments, act on each where its address says, and resolve each with
resolve_comment.
```

Copy page requests for agent copies a line about the open comments on the page alone, by their ids, and a comment's own menu, Copy request for agent, a line about that comment alone.

The agent lists the open comments with `list_comments`: a playbook's with its `playbook`, and the organization's own without one. For each, it reads the thing at the comment's address, such as the workflow with `get_definition`, the run with `get_run` or the connection with `list_connections`, and changes it as the comment asks, such as with `update_definition` or `reconnect_connection`. Then it resolves the comment with `resolve_comment`, `how` `acted`. [From an address to a call](../reference/addresses.md#from-an-address-to-a-call) lists the tools for each kind of address. What no tool changes, such as a member's role or the organization's plan, the agent tells you to change in Studio.

You should see the agent name each comment, what it changed for it, and a link to the place in Studio. A comment it could not act on stays open, and the agent says why.

## 3. Check the change

Open the link the agent gave you. The new version of the definition is there, and the comment is resolved: its pin is gone, and it no longer shows among the open comments or in the organization's activity. Ask your agent to run the workflow again when you want to see the change at work.

If the change doesn't do what the comment asked, reopen it: in Show all requests, turn on Show resolved and choose Reopen on the comment, or Reopen in its thread. It is open again, back among the open comments and new again in your teammates' activity, for your agent to act on.

## If something goes wrong

- **The agent finds no comments.** It reads the comments of one playbook, or the organization's own, at a time. Check that it read the playbook you commented on, or the organization's comments for a connection, a member or a page of Settings, and that nobody resolved the comments first.
- **A comment is about an older version.** The definition changed after the comment was made. The agent reads the comment against the current version and acts only where it still applies.
- **A pin is not where you left it.** A pin is drawn on the thing it was dropped on. When that thing is not on the page, as a block of a result that changed, the pin is not drawn, and the comment is still listed in Show all requests.
- **The agent cannot change the thing.** Changing a definition needs `playbook:write`, and changing a connection `org:write`, which commenting does not. Connect the agent with a key or a sign-in that may change it.
- **The playbook is retired.** Its comments stay readable, open or resolved, but nothing in it can be changed, and its comments cannot be resolved or added to. Your agent can only read them and report them to you.
- **You want to take a comment back.** Comments cannot be edited. Mark it resolved in Studio and comment again.

## Next

- [Comments](../reference/http.md#comments) gives the routes, the fields and the limits.
- [Addresses](../reference/addresses.md) sets out what an address names.
