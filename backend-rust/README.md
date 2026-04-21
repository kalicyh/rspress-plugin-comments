# Rust Backend

This directory contains a Rust rewrite of the standalone backend used by `rspress-plugin-comments`.

It keeps the same HTTP API shape as the existing Node.js backend:

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

## Run

```bash
cd backend-rust
cargo run
```

Default server:

- `http://localhost:4010`

## Local Environment

Startup reads `backend-rust/.env.local`.

Typical local configuration:

```env
GITEA_BASE_URL=https://gitea.example.com
GITEA_CLIENT_ID=...
GITEA_CLIENT_SECRET=...
GITEA_REDIRECT_URI=http://localhost:4010/auth/gitea/callback
COMMENTS_WEB_ORIGIN=http://localhost:3000
COMMENTS_DB_PATH=/absolute/path/to/comments.sqlite
GITEA_CA_CERT_PATH=/absolute/path/to/custom-ca.pem
```

## Storage

- Storage backend: SQLite
- Default database path: `backend-rust/data/comments.sqlite`

Pagination is applied to root comments. Replies are returned together with the current page of root comments.
