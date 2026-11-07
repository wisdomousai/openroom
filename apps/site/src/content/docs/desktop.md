---
title: OpenRoom Desktop and local files
description: Open, save, present, and synchronize portable .openroom decks.
section: Desktop and PowerPoint
order: 200
related: [deck-editor, media, desktop-agents, powerpoint]
---

## Open a deck

Install the OpenRoom Desktop build supplied for your computer. Open the application, then choose **File → Open** or open an `.openroom` file from your file manager. **File → New** starts a blank deck.

The deck editor uses the same slide, question, design, and presentation tools as the browser editor. The Desktop **File** ribbon adds local file and synchronization controls.

An `.openroom` file contains the deck and its packaged resources. Copy or send the file to another computer to continue editing there. External links keep their original addresses.

## Run Desktop from the repository

For the current source build, install dependencies and build the repository, then start Desktop:

```sh
bun install
bun run build
bun run desktop
```

The launcher builds the Desktop shell, applies local database migrations, and starts or reuses the local server. It prints the server and participant addresses. Keep it running while using that local environment. Devices on the same network can use the printed participant address when the network permits access.

Repository launches use local configuration and storage. Use the account and server intended for your teaching material, and check the printed origin before signing in or sharing a join address.

## Save your work

| Control | Action |
| --- | --- |
| Save | Write changes to the current file. Choose a destination when saving a new file. |
| Save as… | Save a copy at a chosen path. |
| Open… | Choose another `.openroom` file. |
| Show in folder | Reveal the saved file in the operating system's file manager. |

The application's **File** menu has **Save** (Command+S or Ctrl+S), **Save As…** and **Present**. Each file window is titled with its file name.

Use **Save** before closing or moving a file. Closing a changed file asks **Do you want to save the changes to {file}?**: choose **Save**, **Don't Save** or **Cancel**. Until you save, Desktop keeps a recovery copy of your changes. If Desktop closed without saving, it offers that copy when it starts (**Unsaved changes found**, with **Recover** and **Discard**) or when you open the file again (**{file} has changes that were not saved to the file.**). A recovered window says **Recovered changes that had not been saved to the file.** Save it to keep the changes; **Don't Save** deletes the recovery copy.

A file that is not an OpenRoom deck shows **{file} could not be opened. The file is damaged or is not an OpenRoom deck.**

Keep one writer in charge of a local file. A file already open elsewhere can be locked against writes; finish or close the other editing session before retrying.

## Work offline

Open, edit, save, and present local decks while offline. Embed the pictures, audio, and extracted PDF pages needed for the lesson and test the file with the network disconnected before teaching offline.

Cloud synchronization, live participant sessions, stock search, web embeds, external media, and model-provider requests require their respective online services. **Present** is useful for rehearsing or displaying a local deck on the same computer.

## Save a file to a workspace

1. Sign in to OpenRoom through the system browser when prompted.
2. Open **File → Save to workspace…**.
3. Choose the space and folder.
4. Select a student or class only when the deck belongs to that context; otherwise keep **No student**.
5. Confirm and wait for the deck and its resources to finish uploading.

The local file becomes linked to that cloud deck. Use **Open online** to open its workspace copy. Shared-space roles apply to cloud reads and writes.

## Synchronize changes

Use **Sync now** for a linked file. Keep the network available until synchronization finishes.

If both the file and its online copy changed, review the conflict before selecting a resolution:

- **Use online copy** loads the current online content into the file.
- **Keep this file** uses the local content for the cloud update.

Save a separate copy first if you need to retain both variants. A conflict requires an explicit choice; retrying a stale write does not resolve it.

## Start an online session

Select **Start session** from the local deck. OpenRoom uploads the material required for the session before opening participation.

A live session needs a sign-in or your own live server. Signed out with no live server, the file window says **Live sessions need a sign-in or a live server.** with **Sign in** and **Live server…**, and **Start session** is off. **Live server…** sets the address and key of an OpenRoom relay; signed out, Desktop then starts sessions there. **Save to workspace…** asks you to sign in first.

Continue with the same presenter and participant controls described in [running a live session](/docs/live-session/). End the session before returning to local editing when the audience has finished.

## Prepare with an agent

Open the Desktop **Agent** pane to work with your own model subscription or provider key. The agent works against the deck open in Desktop. See [Desktop agents](/docs/desktop-agents/) for sign-in, attachments, conversations, and provider settings.
