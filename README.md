# rspress-plugin-comments

Rspress plugin for self-hosted comments, with:

- page-level comments rendered after the document footer
- text-selection comments inside markdown content
- current-page comment aggregation at the bottom of the page
- optional Gitea OAuth login for user identity, name, and avatar

This repository also contains a standalone `backend/` service used by the plugin runtime.

## Current Interaction Model

- Page comments are shown at the bottom of each document.
- Block comments are selection-based: users select text, then open a nearby comment panel.
- Existing selection comments are restored as inline highlighted ranges after page refresh.
- Replies are rendered as a conversation-style thread with avatar, author name, and timestamp.

## Install

```bash
pnpm add rspress-plugin-comments
```

## Usage

```ts
import { defineConfig } from '@rspress/core';
import { pluginComments } from 'rspress-plugin-comments';

export default defineConfig({
  plugins: [
    pluginComments({
      apiBase: 'http://localhost:4010',
      pageComments: true,
      blockComments: true,
    }),
  ],
});
```

## Options

- `enabled`: Enable or disable the plugin. Defaults to `true`.
- `pageComments`: Enable full page comments. Defaults to `true`.
- `blockComments`: Enable selection comments. Defaults to `true`.
- `blockSelectorTags`: Override the set of commentable HTML tags used for selection anchoring.
- `apiBase`: Backend API base URL. Defaults to `http://localhost:4010`.
- `pageSize`: Root comments per page. Defaults to `20`.
- `defaultAuthorName`: Fallback author name when backend auth is disabled.

## Backend

The bundled backend is in [backend/README.md](/Users/kalicyh/Documents/GitHub/rspress-plugin-comments/backend/README.md).

It currently provides:

- SQLite storage
- page and selection comment APIs
- delete support
- session-based login state
- optional Gitea OAuth login

## Notes

- The plugin injects stable `data-comment-id` values into supported markdown blocks.
- Selection comments are bound to `pagePath + blockId + selected text metadata`.
- The visual UI is optimized for Rspress documentation layouts rather than general discussion forums.
