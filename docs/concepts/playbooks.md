# Playbooks and methods

A playbook is a system built around one business responsibility, such as reviewing campaigns or evaluating budget changes. It holds your team's methods as functions and workflows, together with the information they need and limits on what the playbook may do.

A marketing specialist knows what makes a brief ready for review. Working with an agent, they capture those criteria in a function and run it against each new brief. Someone comfortable with a terminal installs and runs Auto Runtime once, and sets up the services it may reach. After that, people work through their agent.

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

Tool servers are how a playbook's functions reach other services, such as a CRM or a chat tool. They are set up once, by whoever runs Auto, and can serve several playbooks. [Give a function tools](../guides/tools.md) explains how a function uses them.

Auto Runtime runs playbooks, and Auto Studio inspects and manages them. Your agent is a separate client. A client learns of changes by asking what changed and waiting for the answer, rather than polling ([Changes](../reference/http.md#changes)). [Functions](functions.md) describes the five function types and when to choose each, and [Workflows and runs](workflows.md) describes how workflows coordinate them.

## The agent and the playbook

Your agent helps you create and refine definitions, supplies inputs and calls functions. It can coordinate its own calls to Auto and to other systems. The kind of ask decides the shape: what you ask the playbook to do is a workflow, its functions the steps, run and shown as one result, and a later ask changes the workflow; what you ask it to remember is a recall function; what you ask it to connect is a connection; and a question for right now is answered now, with nothing saved.

The playbook keeps the saved definitions and the recorded runs, whatever happens to that conversation. An authorized colleague can use the same function from their own agent. Access to the playbook does not give a colleague access to the accounts anyone else's agent is connected to.

Auto Studio shows running work, history and operating controls. Authoring starts with the agent.

## Authority and judgment

A playbook should do only what your team would trust it to do. Decide which actions it may take on its own, and where a person must decide. A review function can recommend a budget change without being allowed to make one.

Where a person must decide, the method includes an interaction function. The workflow asks that person through the connection they chose, such as a chat or their email, or holds the request for an agent they answer through, and waits for their answer. The [Interaction function format](../reference/interaction-format.md) describes how a request is delivered and answered in a runtime that supports interaction functions.

These limits must hold for direct calls as well as for workflows. An approval step cannot protect an action that someone is allowed to run directly. Permissions apply to an [org](terminology.md#orgs-and-callers) and its playbooks; [Requests and access](../reference/http.md#requests-and-access) lists them.

[Build your first playbook](../tutorials/first-playbook.md) puts these ideas into practice with a saved campaign-review function.
