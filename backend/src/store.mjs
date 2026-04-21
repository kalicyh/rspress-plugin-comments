import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';

const DEFAULT_DB_PATH = path.resolve(process.cwd(), 'data', 'comments.sqlite');

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export class CommentStore {
  constructor(dbPath = process.env.COMMENTS_DB_PATH || DEFAULT_DB_PATH) {
    ensureParentDir(dbPath);
    this.dbPath = dbPath;
    this.db = new Database(dbPath);
    this.init();
  }

  init() {
    this.db.pragma('journal_mode = WAL');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS comments (
        id TEXT PRIMARY KEY,
        parent_id TEXT,
        target_type TEXT NOT NULL CHECK(target_type IN ('page', 'block')),
        page_path TEXT NOT NULL,
        block_id TEXT,
        quote_text TEXT,
        selection_meta TEXT,
        author_id TEXT NOT NULL,
        author_name TEXT NOT NULL,
        author_login TEXT,
        author_avatar_url TEXT,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('published', 'pending', 'deleted'))
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_comments_page_block
      ON comments (page_path, block_id, created_at);
    `);

    const columns = this.db
      .prepare(`PRAGMA table_info(comments)`)
      .all()
      .map(column => column.name);

    if (!columns.includes('quote_text')) {
      this.db.exec(`ALTER TABLE comments ADD COLUMN quote_text TEXT`);
    }

    if (!columns.includes('selection_meta')) {
      this.db.exec(`ALTER TABLE comments ADD COLUMN selection_meta TEXT`);
    }

    if (!columns.includes('author_login')) {
      this.db.exec(`ALTER TABLE comments ADD COLUMN author_login TEXT`);
    }

    if (!columns.includes('author_avatar_url')) {
      this.db.exec(`ALTER TABLE comments ADD COLUMN author_avatar_url TEXT`);
    }

    const count = this.db.prepare('SELECT COUNT(*) AS count FROM comments').get().count;

    if (count === 0) {
      this.seed();
    }
  }

  seed() {
    const insert = this.db.prepare(`
      INSERT INTO comments (
        id,
        parent_id,
        target_type,
        page_path,
        block_id,
        quote_text,
        selection_meta,
        author_id,
        author_name,
        author_login,
        author_avatar_url,
        body,
        created_at,
        updated_at,
        status
      ) VALUES (
        @id,
        @parentId,
        @targetType,
        @pagePath,
        @blockId,
        @quoteText,
        @selectionMeta,
        @authorId,
        @authorName,
        @authorLogin,
        @authorAvatarUrl,
        @body,
        @createdAt,
        @updatedAt,
        @status
      )
    `);

    const now = new Date().toISOString();
    insert.run({
      id: randomUUID(),
      parentId: null,
      targetType: 'page',
      pagePath: '/hscp-user-guide',
      blockId: null,
      quoteText: null,
      selectionMeta: null,
      authorId: 'system',
      authorName: 'System',
      authorLogin: 'system',
      authorAvatarUrl: null,
      body: '这是后端目录创建后的初始整页评论示例。',
      createdAt: now,
      updatedAt: now,
      status: 'published',
    });
    insert.run({
      id: randomUUID(),
      parentId: null,
      targetType: 'block',
      pagePath: '/hscp-user-guide',
      blockId: '它现在能做什么',
      quoteText: '它现在能做什么',
      selectionMeta: null,
      authorId: 'system',
      authorName: 'System',
      authorLogin: 'system',
      authorAvatarUrl: null,
      body: '这是一个绑定到 blockId 的段评示例。',
      createdAt: now,
      updatedAt: now,
      status: 'published',
    });
  }

  list({ pagePath, blockId = null, page = 1, pageSize = 20 }) {
    const safePage = Number.isFinite(page) ? Math.max(1, page) : 1;
    const safePageSize = Number.isFinite(pageSize)
      ? Math.max(1, Math.min(100, pageSize))
      : 20;
    const offset = (safePage - 1) * safePageSize;

    const countQuery = blockId
      ? this.db.prepare(`
          SELECT COUNT(*) AS count
          FROM comments
          WHERE page_path = ?
            AND block_id = ?
            AND parent_id IS NULL
        `)
      : this.db.prepare(`
          SELECT COUNT(*) AS count
          FROM comments
          WHERE page_path = ?
            AND block_id IS NULL
            AND parent_id IS NULL
        `);

    const rootQuery = blockId
      ? this.db.prepare(`
          SELECT id
          FROM comments
          WHERE page_path = ?
            AND block_id = ?
            AND parent_id IS NULL
          ORDER BY created_at DESC
          LIMIT ? OFFSET ?
        `)
      : this.db.prepare(`
          SELECT id
          FROM comments
          WHERE page_path = ?
            AND block_id IS NULL
            AND parent_id IS NULL
          ORDER BY created_at DESC
          LIMIT ? OFFSET ?
        `);

    const totalRootComments = blockId
      ? countQuery.get(pagePath, blockId).count
      : countQuery.get(pagePath).count;
    const roots = blockId
      ? rootQuery.all(pagePath, blockId, safePageSize, offset)
      : rootQuery.all(pagePath, safePageSize, offset);
    const rootIds = roots.map(item => item.id);

    if (rootIds.length === 0) {
      return {
        items: [],
        pagination: {
          page: safePage,
          pageSize: safePageSize,
          totalRootComments,
          totalPages: Math.max(1, Math.ceil(totalRootComments / safePageSize)),
          hasMore: safePage * safePageSize < totalRootComments,
        },
      };
    }

    const placeholders = rootIds.map(() => '?').join(', ');
    const query = this.db.prepare(`
      WITH RECURSIVE subtree AS (
        SELECT
          id,
          parent_id,
          target_type,
          page_path,
          block_id,
          quote_text,
          selection_meta,
          author_id,
          author_name,
          author_login,
          author_avatar_url,
          body,
          created_at,
          updated_at,
          status
        FROM comments
        WHERE id IN (${placeholders})

        UNION ALL

        SELECT
          c.id,
          c.parent_id,
          c.target_type,
          c.page_path,
          c.block_id,
          c.quote_text,
          c.selection_meta,
          c.author_id,
          c.author_name,
          c.author_login,
          c.author_avatar_url,
          c.body,
          c.created_at,
          c.updated_at,
          c.status
        FROM comments c
        INNER JOIN subtree s ON c.parent_id = s.id
      )
      SELECT
        id,
        parent_id AS parentId,
        target_type AS targetType,
        page_path AS pagePath,
        block_id AS blockId,
        quote_text AS quoteText,
        selection_meta AS selectionMeta,
        author_id AS authorId,
        author_name AS authorName,
        author_login AS authorLogin,
        author_avatar_url AS authorAvatarUrl,
        body,
        created_at AS createdAt,
        updated_at AS updatedAt,
        status
      FROM subtree
      ORDER BY created_at ASC
    `);

    return {
      items: query.all(...rootIds),
      pagination: {
        page: safePage,
        pageSize: safePageSize,
        totalRootComments,
        totalPages: Math.max(1, Math.ceil(totalRootComments / safePageSize)),
        hasMore: safePage * safePageSize < totalRootComments,
      },
    };
  }

  create(input) {
    const now = new Date().toISOString();
    const comment = {
      id: randomUUID(),
      parentId: input.parentId ?? null,
      targetType: input.blockId ? 'block' : 'page',
      pagePath: input.pagePath,
      blockId: input.blockId ?? null,
      quoteText: input.quoteText ?? null,
      selectionMeta: input.selectionMeta ? JSON.stringify(input.selectionMeta) : null,
      authorId: input.authorId ?? 'anonymous',
      authorName: input.authorName ?? 'Anonymous',
      authorLogin: input.authorLogin ?? null,
      authorAvatarUrl: input.authorAvatarUrl ?? null,
      body: input.body,
      createdAt: now,
      updatedAt: now,
      status: 'published',
    };

    this.db
      .prepare(`
        INSERT INTO comments (
          id,
          parent_id,
          target_type,
          page_path,
          block_id,
          quote_text,
          selection_meta,
          author_id,
          author_name,
          author_login,
          author_avatar_url,
          body,
          created_at,
          updated_at,
          status
        ) VALUES (
          @id,
          @parentId,
          @targetType,
          @pagePath,
          @blockId,
          @quoteText,
          @selectionMeta,
          @authorId,
          @authorName,
          @authorLogin,
          @authorAvatarUrl,
          @body,
          @createdAt,
          @updatedAt,
          @status
        )
      `)
      .run(comment);

    return comment;
  }

  summarize(pagePath) {
    const pageRow = this.db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM comments
        WHERE page_path = ?
          AND block_id IS NULL
          AND status != 'deleted'
      `)
      .get(pagePath);

    const blocks = this.db
      .prepare(`
        SELECT
          block_id AS blockId,
          MAX(quote_text) AS quoteText,
          MAX(selection_meta) AS selectionMeta,
          COUNT(*) AS count
        FROM comments
        WHERE page_path = ?
          AND block_id IS NOT NULL
          AND status != 'deleted'
        GROUP BY block_id
      `)
      .all(pagePath);

    return {
      pagePath,
      pageCount: pageRow.count,
      blocks,
    };
  }

  find(commentId) {
    return this.db
      .prepare(`
        SELECT
          id,
          parent_id AS parentId,
          target_type AS targetType,
          page_path AS pagePath,
          block_id AS blockId,
          quote_text AS quoteText,
          selection_meta AS selectionMeta,
          author_id AS authorId,
          author_name AS authorName,
          author_login AS authorLogin,
          author_avatar_url AS authorAvatarUrl,
          body,
          created_at AS createdAt,
          updated_at AS updatedAt,
          status
        FROM comments
        WHERE id = ?
      `)
      .get(commentId);
  }

  remove(commentId) {
    const existing = this.find(commentId);

    if (!existing) {
      return null;
    }

    const updatedAt = new Date().toISOString();
    this.db
      .prepare(`
        UPDATE comments
        SET
          status = 'deleted',
          body = '',
          updated_at = ?
        WHERE id = ?
      `)
      .run(updatedAt, commentId);

    return {
      ...existing,
      body: '',
      status: 'deleted',
      updatedAt,
    };
  }

  createSession(user) {
    const now = new Date().toISOString();
    const session = {
      id: randomUUID(),
      userJson: JSON.stringify(user),
      createdAt: now,
      updatedAt: now,
    };

    this.db
      .prepare(`
        INSERT INTO sessions (id, user_json, created_at, updated_at)
        VALUES (@id, @userJson, @createdAt, @updatedAt)
      `)
      .run(session);

    return session.id;
  }

  getSession(sessionId) {
    const row = this.db
      .prepare(`
        SELECT id, user_json AS userJson
        FROM sessions
        WHERE id = ?
      `)
      .get(sessionId);

    if (!row) {
      return null;
    }

    try {
      return {
        id: row.id,
        user: JSON.parse(row.userJson),
      };
    } catch {
      return null;
    }
  }

  deleteSession(sessionId) {
    this.db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sessionId);
  }
}
