# rspress-plugin-comments

[中文说明](./README.zh-CN.md)

Rspress plugin for self-hosted comments, with:

- page-level comments rendered after the document footer
- text-selection comments inside markdown content
- current-page comment aggregation at the bottom of the page
- optional Gitea OAuth login for user identity, name, and avatar
- optional Logto login through `@logto/react`

This repository also contains a standalone `backend/` service used by the plugin runtime.

## Current Interaction Model

- Page comments are shown at the bottom of each document.
- Block comments are selection-based: users select text, then open a nearby comment panel.
- Existing selection comments are restored as inline highlighted ranges after page refresh.
- Replies are rendered as a conversation-style thread with avatar, author name, and timestamp.

## Install

```bash
npm install rspress-plugin-comments
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
      logto: {
        endpoint: 'https://your-logto-endpoint.example.com/',
        appId: 'your-logto-app-id',
      },
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
- `logto`: Optional Logto frontend login config.
- `logto.endpoint`: Logto endpoint.
- `logto.appId`: Logto application ID.
- `logto.callbackPath`: Sign-in callback path. Defaults to `/callback`.
- `logto.postSignOutRedirectUri`: Post sign-out redirect URI. Defaults to the current site origin.

When Logto is enabled, configure these URIs in the Logto Console for local development:

- Redirect URI: `http://localhost:3000/callback`
- Post sign-out redirect URI: `http://localhost:3000/`

## Backend

The original Node.js backend is in [backend/README.md](/Users/kalicyh/Documents/GitHub/rspress-plugin-comments/backend/README.md).
The Rust rewrite is in [backend-rust/README.md](/Users/kalicyh/Documents/GitHub/rspress-plugin-comments/backend-rust/README.md).

It currently provides:

- SQLite storage
- page and selection comment APIs
- delete support
- session-based login state
- optional Gitea OAuth login

## Docker

The repository root now includes a minimal Alpine-based container for the Rust backend.

Start it locally with:

```bash
mkdir -p ./data
chown -R 1000:1000 ./data
chmod 755 ./data
docker compose pull
docker compose up -d
```

Default service:

- `http://localhost:4010`
- database file mounted at `./data/comments.sqlite`
- image name: `ghcr.io/kalicyh/rspress-plugin-comments:latest`

Notes:

- The container runs as uid/gid `1000:1000` (`appuser`).
- If you bind-mount `./data:/app/data`, the host `./data` directory must be writable by `1000:1000`, otherwise SQLite cannot create `comments.sqlite`.
- If you mount a custom CA file, keep it read-only, for example `./custom-ca.pem:/app/custom-ca.pem:ro`.

## Release

Pushing a tag like `v1.0.0` triggers `.github/workflows/release.yml` to:

- create a GitHub Release
- build the Alpine image from the root `Dockerfile`
- push `ghcr.io/kalicyh/rspress-plugin-comments:<tag>`
- update `ghcr.io/kalicyh/rspress-plugin-comments:latest`

## Notes

- The plugin injects stable `data-comment-id` values into supported markdown blocks.
- Selection comments are bound to `pagePath + blockId + selected text metadata`.
- The visual UI is optimized for Rspress documentation layouts rather than general discussion forums.
