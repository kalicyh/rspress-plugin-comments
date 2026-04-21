FROM rust:1.85-alpine AS builder

WORKDIR /app

RUN apk add --no-cache build-base

COPY backend-rust/Cargo.toml backend-rust/Cargo.lock ./backend-rust/
RUN mkdir -p backend-rust/src && \
  printf 'fn main() {}\n' > backend-rust/src/main.rs && \
  cargo build --manifest-path backend-rust/Cargo.toml --release && \
  rm -rf backend-rust/src

COPY backend-rust ./backend-rust
RUN cargo build --manifest-path backend-rust/Cargo.toml --release

FROM alpine:3.22.4

WORKDIR /app

RUN apk add --no-cache ca-certificates && \
  adduser -D -h /app appuser && \
  mkdir -p /app/data && \
  chown -R appuser:appuser /app

COPY --from=builder /app/backend-rust/target/release/rspress-plugin-comments-backend-rust /usr/local/bin/rspress-plugin-comments

ENV PORT=4010
ENV COMMENTS_DB_PATH=/app/data/comments.sqlite

VOLUME ["/app/data"]

EXPOSE 4010

USER appuser

CMD ["rspress-plugin-comments"]
