---
title: Pictures, audio, and embedded material
description: Add media and reading material, prepare listening activities, and make portable copies.
section: Prepare a deck
order: 80
related: [design, present, desktop, limits]
---

## Insert a picture

Select **Picture** from the editor's insert controls. Choose a source:

| Source | Procedure |
| --- | --- |
| Stock photos | Enter a search term, select a result, and insert it. Stock search requires the service to be configured and reachable. |
| This space | Select an existing uploaded image from the space's media library. |
| Upload | Choose a file to upload to the current space. Requires editor or owner access. |
| From a link | Enter the picture address, load it, and insert it. |
| This computer | In Desktop, choose an image to embed in the local file. |

Select the inserted picture to change or remove it, set its size and placement, adjust the focal point, and edit **Alt text** and **Caption**. Use meaningful alt text for information conveyed by the image.

Supported uploaded images are PNG, JPEG, WebP, GIF, and AVIF. Individual uploaded media files are limited to 20 MiB.

## Prepare listening audio

Insert an **Audio** slide. In **Design → Audio**, select **Choose audio file** or enter an **Audio address**. Supported recordings are MP3, WAV, and M4A. Enter a **Recording label**, optional caption, and transcript.

Choose the listening mode:

- **Room audio:** playback comes from the presenter's device. Connect that device to the room speakers.
- **Individual listening:** participants receive their own playback controls.

Use the preview player to test the file. Transcripts are withheld from learners until **Show transcript** is selected while presenting. During live delivery, use play, pause, seek, transcript, and retry controls as needed. A browser may require a user gesture before it can play audio.

## Insert video

Choose the video/media insertion option and set its address and descriptive text. Preview the result in the presentation view before the session. Linked services can require internet access and allow or deny embedding according to their own policies.

For portable offline material, use resources supported by the `.openroom` package. An external video address remains dependent on its source service and connection.

## Add reading material and Markdown

Use the reading/Markdown insertion controls for passages, lists, and structured explanatory text. Edit the Markdown, preview it, and save it into the selected box or reading area.

Reading content can scroll inside its own area. Give the passage a clear title and check its phone presentation through **Reading** view. For a long passage, use a reading document instead of reducing the entire text to a small slide font.

## Embed a website

Choose **Insert → Web page**. Enter the **Web address** and an **Accessible title**, then insert it. The destination must permit embedding.

If the page refuses to load inside the slide, use the provided open-page action or **Import as reading** where offered. Importing as reading converts available page text into editable reading material. Check the imported wording and formatting before presenting.

## Insert a PDF

Choose **PDF**. For a linked document, select **From a link**, enter its **PDF address**, add an accessible title, and insert it.

In Desktop, select **From this computer → Choose PDF…**. Choose an inclusive page range, give the extracted document an accessible title, and insert it. The source PDF can be up to 100 MiB; the extracted embedded resource must fit the 20 MiB per-resource package limit.

Only the selected pages are copied into the file. Review them in the deck before sharing or starting an online session.

## Add HTML or SVG content

Choose **HTML**, enter markup in **HTML or SVG**, and optional styles in **CSS for this box**. Review the preview and save it. Use this for a self-contained diagram or formatted visual.

Embedded markup is sanitized. Script execution, unsafe links, and disallowed resources are removed or rejected according to the supported content contract. Keep the visual self-contained and test the sanitized preview rather than relying on an external page's scripts.

## Store and share media

Uploaded media is accessible through an unguessable asset address. Anyone who receives that address can retrieve the file. Choose teaching material appropriate for that sharing boundary.

Desktop embeds supported local resources in the `.openroom` file. A package supports up to 100 resources, 20 MiB per resource, and 50 MiB combined. Linked web pages and external services still require connectivity.

When downloading a cloud deck, OpenRoom resolves and packages referenced resources. If a resource cannot be retrieved, correct its address or access and retry the export. Starting an online session from a local file uploads the resources needed by participants before the session starts.
