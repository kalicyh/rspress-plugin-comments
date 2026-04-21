# Backend

This directory contains the standalone backend used by `rspress-plugin-comments`.

It is responsible for:

- serving page-level comments
- serving selection-comment threads
- creating comments and replies
- deleting comments
- storing data in SQLite
- handling optional Gitea OAuth login and session cookies

## Run

```bash
cd backend
pnpm dev
```

Default server:

- `http://localhost:4010`

## Local Environment

Startup now reads `backend/.env.local` before launching the actual Node process.

Typical local configuration:

```env
GITEA_BASE_URL=https://gitea.nz.com
GITEA_CLIENT_ID=...
GITEA_CLIENT_SECRET=...
GITEA_REDIRECT_URI=http://localhost:4010/auth/gitea/callback
COMMENTS_WEB_ORIGIN=http://localhost:3000
NODE_OPTIONS=--use-system-ca
NODE_EXTRA_CA_CERTS=./custom-ca.pem
```

Notes:

- `backend/.env.local` is intended for local-only secrets and TLS settings.
- `NODE_EXTRA_CA_CERTS` should point to your local PEM file if your Gitea instance requires a custom CA chain.
- If your Gitea TLS chain changes, replace your local PEM file and keep the path in `.env.local` in sync.

## Endpoints

- `GET /api/health`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `GET /api/comment-counts?pagePath=/docs/page`
- `GET /api/comments?pagePath=/docs/page&page=1&pageSize=20`
- `GET /api/comments?pagePath=/docs/page&blockId=some-block-id&page=1&pageSize=20`
- `POST /api/comments`
- `DELETE /api/comments/:id`
- `GET /auth/gitea/login`
- `GET /auth/gitea/callback`

## Storage

- Storage backend: SQLite
- Default database path: `backend/data/comments.sqlite`
- Override with `COMMENTS_DB_PATH=/absolute/path/to/comments.sqlite`

Pagination is applied to root comments. Replies are returned together with the current page of root comments.

## Auth Behavior

When Gitea OAuth variables are configured:

- unauthenticated users can read comments
- authenticated users can create comments
- users can only delete their own comments
- current user info is exposed through `/api/auth/me`

When Gitea OAuth variables are not configured:

- the backend falls back to anonymous author names

## Troubleshooting

- If `better-sqlite3` reports a Node ABI mismatch, run `pnpm rebuild-native`.
- If OAuth callback returns `fetch failed`, verify Node trusts your Gitea TLS chain and that `NODE_EXTRA_CA_CERTS` points to the correct PEM file.
