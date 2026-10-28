---
description: Connect your agent to Auto, sign in, and start your first playbook.
---

# Quick start: connect your agent

Add Auto to your agent, then tell it what you want done. Auto hosts your playbooks and keeps them running after you close the conversation.

## 1. Add Auto to your agent {#connect-your-agent}

In your agent's MCP settings, add a remote server named `auto` with this address:

```text
https://mcp.on.auto
```

Choose Streamable HTTP if your agent asks for a transport, and OAuth if it asks for authentication. [Open the agent setup page](https://mcp.on.auto) for instructions for your agent.

## 2. Sign in

Your agent opens Auto in your browser. Sign in or create an account, choose the organization your agent will work in, and allow the connection. You can create an organization during this step.

Return to your agent when sign-in finishes. Auto supplies the models for hosted runs; you do not need to install a runtime or supply a model API key.

## 3. Tell your agent what to do

For example:

```text
Use auto to help me build a playbook for reviewing campaign briefs.
Ask me what a good brief must include, then save the review so my team
can use it again. Show me what you propose before saving it.
```

Your agent asks about the work, creates the playbook and helps you try it. If the work should run on its own, tell it when: for example, every Monday at 9 a.m. in your time zone.

For a guided exercise with sample inputs and results to check, follow [Build your first playbook](../tutorials/first-playbook.md).

## See your work in Studio

Open [Auto Studio](https://studio.on.auto) and select the same organization. You can inspect your playbooks, read their definitions and follow their runs. Use your agent to create and change the work.

## If you cannot connect

- If no Auto tools appear, enable the server in your agent and complete its sign-in step. Some agents need a new conversation after adding a server.
- If your playbooks are missing, check which organization you selected in both your agent and Studio.
- If access has been revoked, connect and sign in again. You can review allowed apps in Studio under Settings, Runtime.

If your team needs Auto on its own infrastructure, [contact us about self-hosting](../self-host.md).
