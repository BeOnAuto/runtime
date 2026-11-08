---
description: A playbook is built around one business responsibility. It holds your team's methods as functions and workflows, with the information and limits they need.
---

# Playbooks and methods

A playbook is a system built around one business responsibility, such as reviewing campaigns or evaluating budget changes. It holds your team's methods as functions and workflows, together with the information they need and limits on what the playbook may do.

A marketing specialist knows what makes a brief ready for review. They [connect their agent to Auto](../get-started/cloud.md), capture those criteria in a function, and use it to review each new brief. Auto hosts the playbook, and the team can inspect its runs in Studio.

## From a method to runs

A method is your approach to a piece of work: the evidence you consider, how you evaluate it and what should happen next. It may be written down, or it may live in your specialists' heads.

A playbook turns a method into definitions it can run:

1. Functions do the individual pieces of work, actions included. For a campaign review, a reasoning function checks that a brief names a specific audience, makes a clear offer and keeps the budget within the agreed limit.
2. Workflows put the pieces in order, such as reviewing the brief and then asking its owner to approve it.
3. Runs carry a function or workflow out once with particular inputs, such as the autumn campaign brief, and record the result.

| Your work                              | In the playbook                                          |
| -------------------------------------- | -------------------------------------------------------- |
| The criteria for a brief that is ready | A reasoning function, such as "Review campaign brief"    |
| Review the brief, then get it approved | A workflow that calls the review, then asks for approval |
| Reviewing this week's autumn brief     | A run, with its result                                   |

One method can involve several functions and workflows. It needs no separate `Method` object or folder. [Terminology](terminology.md) defines each of these words.

## What a playbook contains

A playbook holds functions and workflows. Functions belong to the playbook: they are saved in it, and workflows call them from there. Auto's instructions to your agent call this set of functions the playbook's brain. Runs belong to the playbook too, and each run refers to the function or workflow it carried out.

```text
Auto Runtime
├── Playbooks
│   └── Paid media planning
│       ├── Functions
│       │   ├── Forecast sign-ups (Prediction)
│       │   └── Compare performance (Computation)
│       └── Workflows
│           ├── Monthly plan
│           └── Check outcomes
└── Tool servers
```

Tool servers let a playbook's functions reach other services, such as a CRM or a chat tool. Ask your agent to connect a service and approve the connection in your browser. A self-hosted runtime can also use tool servers configured by its operator. [Give a function tools](../guides/tools.md) explains how a function uses them.

Auto Runtime runs playbooks, and Auto Studio lets you inspect and manage them. Your agent is a separate client. [Functions](functions.md) describes the six function types and when to choose each. [Workflows and runs](workflows.md) explains how workflows coordinate them.

## The agent and the playbook

Your agent helps you create and refine definitions, supplies inputs and calls functions. It can coordinate its own calls to Auto and to other systems.

The agent puts each job you want done again and again into a workflow and shows you its result. Later requests can change that workflow. It uses a connection to reach another service. It can answer a one-off question without saving anything. Testing a function, connecting a service and setting it up for the playbook's runs are the agent's own work, done with its tools, and none of it becomes a workflow.

The playbook keeps the saved definitions and the recorded runs, whatever happens to that conversation. An authorized colleague can use the same function from their own agent. Access to the playbook does not give a colleague access to the accounts anyone else's agent is connected to.

Auto Studio shows running work, history and operating controls. Authoring starts with the agent, and what it makes or runs comes back with a link to its page in Studio, which it gives you.

Comments are the way back. When something in Studio looks wrong, such as a step's prompt, a run's result or a figure on a page, you comment on it where you see it. Your teammates see your comments, and you see theirs. Each comment carries the address of what it is about, so when you tell your agent you left comments, or paste them from Studio, it reads them, opens each place, makes the change and resolves the comment. The agent never comments itself; it tells you what it changed. [Comments](../reference/http.md#comments) gives the routes, and [Addresses](../reference/addresses.md) the forms an address takes.

## Retiring and restoring work

Retire a playbook when you no longer want to change it or start new runs. Its definitions and history remain readable. If you need it again, ask your agent to restore it: it becomes active with its definitions, page and history as they were. [Playbooks](../reference/http.md#playbooks) gives the operations and permissions.

You can also retire an individual function or workflow. Restoring one brings it back paused, so you can review it before resuming it. Its name and history stay with it. [Definitions](../reference/mcp.md#definitions) lists the tools for retiring, restoring and resuming a definition.

## Authority and judgment

A playbook should do only what your team would trust it to do. Decide which actions it may take on its own, and where a person must decide. A review function can recommend a budget change without being allowed to make one.

Where a person must decide, the method includes an interaction function. The workflow asks that person through the connection they chose, such as a chat or their email, or holds the request for an agent they answer through, and waits for their answer. The [Interaction function format](../reference/interaction-format.md) describes how a request is delivered and answered in a runtime that supports interaction functions.

These limits must hold for direct calls as well as for workflows. An approval step cannot protect an action that someone is allowed to run directly. Permissions apply to an [org](terminology.md#orgs-and-callers) and its playbooks; [Requests and access](../reference/http.md#requests-and-access) lists them.

[Build your first playbook](../tutorials/first-playbook.md) puts these ideas into practice with a saved campaign-review function.
