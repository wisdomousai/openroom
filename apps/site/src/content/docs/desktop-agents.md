---
title: Prepare a deck with a Desktop agent
description: Connect your own model account, attach source material, and review changes in the editor.
section: Desktop and PowerPoint
order: 210
related: [desktop, agents, deck-editor, limits]
---

## Choose an agent

Open a deck in OpenRoom Desktop and open **Agent**. Use the agent settings to choose **Claude**, **ChatGPT**, or **API key**.

| Choice | Requirement |
| --- | --- |
| Claude | The local Claude harness and a signed-in account with access to it. Follow the installation or sign-in action if offered. |
| ChatGPT | The local Codex harness and a signed-in account with access to it. Follow the installation or sign-in action if offered. |
| API key | Your own account and key for a supported provider. |

Agent turns run on your computer through the selected harness. Model requests use your subscription or provider account. Your provider's limits and billing apply.

The in-app conversation is available in Desktop. For browser decks, use an [external agent connection](/docs/agents/).

## Configure a provider key

Select **API key**, then choose a provider: OpenAI, Google, Anthropic, Mistral, Groq, OpenRouter, or Cloudflare. Enter the key and select **Save key**. Cloudflare also requires the account identifier shown in its configuration form.

Choose a model from the available list, or retain the default. Model availability depends on the provider and account. Change provider or model before starting the next request.

Keys saved through Desktop are stored in the operating system's keychain and sent to their selected provider. Use **Remove** to delete a saved key. A key supplied by the launch environment is marked **From environment**; change that environment configuration to replace or remove it.

## Give a concrete preparation request

Describe the audience, objective, available time, and material to use. For example:

> Prepare a B1 French lesson on explaining a missed connection. Use the attached passage. Include a short reading, three comprehension questions, a gap exercise on past tenses, and a writing task. Keep each slide readable on a phone.

Select **Send**. Answer any questions the agent presents. Use **Stop** to interrupt a running turn. Review the deck as changes appear in the editor, then refine the request or edit the content directly.

Check factual statements, task instructions, accepted answers, reveal order, and homework before presenting. Use **Present** to rehearse and save the file when satisfied.

## Add reference material

Use **Attach files**, drag a supported file into the pane, or paste an image. Attached items appear as chips; remove a chip before sending to exclude it from that request.

Use **Reference folder** when the agent needs to read files from a local directory. Choose a folder containing only the material needed for the task.

Desktop gives the local agent access to the selected material. Temporary attachment copies belong to the conversation's working directory; referenced folders are read in place. Original school documents stay outside OpenRoom's servers. The selected model provider may receive content used in model requests, under that provider's account terms. Check the requested material before sending.

## Manage conversations

Use **Chats for this deck** to reopen a conversation. Select **New chat** for a new preparation task. Changing the agent host begins a new conversation.

Conversation history is stored locally. Temporary attachment workspaces are cleaned up with the conversation lifecycle; keep original files in your own folders. Reattach needed material when beginning a fresh conversation.

When available, **Open in Codex** continues the selected conversation in the signed-in Codex application. Check the active deck and working directory before asking for further changes.

## Recover from a failed turn

Check the error in the pane and the provider configuration. For an expired login, sign in again. For provider quota or rate limits, wait or choose an available model/account. For a missing attachment, attach it again.

Inspect the deck before retrying: a failed or interrupted turn may already have completed some edits. Save a useful intermediate file or use editor history before requesting the remaining changes.
