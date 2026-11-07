# Refusal in the browser

This records why hosted Auto's browser connection refuses a high-impact action at once, and what the runtime does with the refusal. The runtime does nothing of its own for it: a refusal is a tool error, and the model reads it as it reads any tool error.

## The decision

The browser refuses an action that may pay or buy something, send a message, post publicly, delete something, change account settings or a password, or accept terms. It also refuses a script that can act on the page. A script that only reads runs. A refused call does nothing, asks nobody, and keeps nothing. The browser stays open for the run's next call.

The browser decides, never the model and never a person:

- A page the model reads can steer the model, so nothing the model writes decides whether an action is taken.
- A person who approves in a test run hides what the same definition meets when a schedule runs it with nobody watching. A definition is reusable, so it meets the same rule in every run.
- The browser reads the target of a call in the page with its own code before the call acts, so text in the page does not change the judgement.

A playbook that must pay, send, post or delete does it through a connection, as an explicit step. Where a person should approve that step, an interaction function asks them first.

## What a refusal looks like

A refusal is a result marked `isError: true`. Its text, under a `Refused` heading, says what the call would have done, why that counts, and that nothing was done. Its structured content names the same parts:

```json
{
  "isError": true,
  "content": [
    {
      "type": "text",
      "text": "### Refused\nClick \"Place order\" on shop.example may pay or buy something. Auto Browser doesn't pay, send, post, delete, change account settings or accept terms. Use a connection for that. Nothing was done.\n"
    }
  ],
  "structuredContent": {
    "refused": { "kind": "pay", "action": "Click \"Place order\"", "site": "shop.example", "tool": "browser_click" }
  }
}
```

The kind is one of `pay`, `send`, `post`, `delete`, `account`, `terms` and `script`.

## What the runtime does with it

The runtime records the call as it records every call: `tool_call_answered` with `is_error: true`, its result kept beside the run where the server keeps content. The model reads the text and goes on in the same attempt. Nothing waits, so a refusal adds no request, no answer and no wait to the run, and the run's bounds are those of any run that calls tools.

## What this replaced

Before this decision, the browser held such an action until the person the run acted for approved it. A reasoning run then waited with an approval request, went on once the person answered, and sent the call again with an approval the host signed. That path is gone: the runtime no longer reads a tool's request for an approval, makes no approval request and goes on with no run after a request. A request recorded with an approval before then is still read as a request, with nothing of the approval shown.
