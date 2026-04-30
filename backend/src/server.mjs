import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createServer } from 'node:http';
import { URL } from 'node:url';
import { CommentStore } from './store.mjs';

loadLocalEnv();

const PORT = Number(process.env.PORT || 4010);
const COOKIE_NAME = 'hf_comments_session';
const OAUTH_STATE_COOKIE = 'hf_comments_oauth_state';
const OAUTH_RETURN_TO_COOKIE = 'hf_comments_return_to';
const FRONTEND_ORIGIN = process.env.COMMENTS_WEB_ORIGIN || 'http://localhost:3000';
const GITEA_BASE_URL = process.env.GITEA_BASE_URL || '';
const GITEA_CLIENT_ID = process.env.GITEA_CLIENT_ID || '';
const GITEA_CLIENT_SECRET = process.env.GITEA_CLIENT_SECRET || '';
const GITEA_REDIRECT_URI =
  process.env.GITEA_REDIRECT_URI || `http://localhost:${PORT}/auth/gitea/callback`;
const GITEA_SCOPES = process.env.GITEA_SCOPES || 'openid profile email';
const authEnabled = Boolean(GITEA_BASE_URL && GITEA_CLIENT_ID && GITEA_CLIENT_SECRET);

const store = new CommentStore();

function loadLocalEnv() {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) {
    return;
  }

  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const index = trimmed.indexOf('=');
    if (index <= 0) {
      continue;
    }

    const key = trimmed.slice(0, index).trim();
    const rawValue = trimmed.slice(index + 1).trim();
    const value = rawValue.replace(/^['"]|['"]$/g, '');

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function getCorsHeaders(req) {
  const origin = req.headers.origin;
  const allowOrigin = origin && (origin === FRONTEND_ORIGIN || origin.startsWith('http://localhost:'))
    ? origin
    : FRONTEND_ORIGIN;

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    Vary: 'Origin',
  };
}

function json(req, res, status, data, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...getCorsHeaders(req),
    ...extraHeaders,
  });
  res.end(JSON.stringify(data, null, 2));
}

function redirect(req, res, location, extraHeaders = {}) {
  res.writeHead(302, {
    Location: location,
    ...getCorsHeaders(req),
    ...extraHeaders,
  });
  res.end();
}

async function readJson(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const cookies = {};

  for (const item of header.split(';')) {
    const [name, ...rest] = item.trim().split('=');
    if (!name) {
      continue;
    }

    cookies[name] = decodeURIComponent(rest.join('='));
  }

  return cookies;
}

function createCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path || '/'}`);

  if (options.httpOnly !== false) {
    parts.push('HttpOnly');
  }

  if (options.sameSite) {
    parts.push(`SameSite=${options.sameSite}`);
  } else {
    parts.push('SameSite=Lax');
  }

  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${options.maxAge}`);
    if (options.maxAge === 0) {
      parts.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
    }
  }

  return parts.join('; ');
}

function clearCookie(name) {
  return createCookie(name, '', { maxAge: 0 });
}

function getCurrentUser(req) {
  const cookies = parseCookies(req);
  const sessionId = cookies[COOKIE_NAME];

  if (!sessionId) {
    return null;
  }

  const session = store.getSession(sessionId);
  return session?.user ?? null;
}

function requireCurrentUser(req) {
  const user = getCurrentUser(req);
  if (!user && authEnabled) {
    return { error: 'authentication required', user: null };
  }

  return { error: null, user };
}

function validateCommentInput(input) {
  if (!input || typeof input !== 'object') {
    return 'request body must be a JSON object';
  }

  if (!input.pagePath || typeof input.pagePath !== 'string') {
    return 'pagePath is required';
  }

  if (!input.body || typeof input.body !== 'string') {
    return 'body is required';
  }

  if (
    input.quoteText !== undefined &&
    input.quoteText !== null &&
    typeof input.quoteText !== 'string'
  ) {
    return 'quoteText must be a string';
  }

  if (
    input.selectionMeta !== undefined &&
    input.selectionMeta !== null &&
    typeof input.selectionMeta !== 'object'
  ) {
    return 'selectionMeta must be an object';
  }

  return null;
}

async function exchangeCodeForToken(code) {
  const response = await fetch(new URL('/login/oauth/access_token', GITEA_BASE_URL), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: GITEA_CLIENT_ID,
      client_secret: GITEA_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: GITEA_REDIRECT_URI,
    }),
  });

  if (!response.ok) {
    throw new Error(`token exchange failed: ${response.status}`);
  }

  return response.json();
}

async function fetchGiteaUser(accessToken) {
  const response = await fetch(new URL('/api/v1/user', GITEA_BASE_URL), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`failed to fetch Gitea user: ${response.status}`);
  }

  const data = await response.json();
  return {
    id: String(data.id ?? data.login),
    login: data.login,
    name: data.full_name || data.login,
    avatarUrl: data.avatar_url || null,
  };
}

const server = createServer(async (req, res) => {
  if (!req.url || !req.method) {
    return json(req, res, 400, { error: 'invalid request' });
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, getCorsHeaders(req));
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/api/health') {
    return json(req, res, 200, {
      ok: true,
      service: 'rspress-plugin-comments-backend',
      database: store.dbPath,
      authEnabled,
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/auth/me') {
    return json(req, res, 200, {
      authEnabled,
      user: getCurrentUser(req),
    }, {
      'Cache-Control': 'no-store',
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    const cookies = parseCookies(req);
    if (cookies[COOKIE_NAME]) {
      store.deleteSession(cookies[COOKIE_NAME]);
    }

    return json(
      req,
      res,
      200,
      { ok: true },
      {
        'Cache-Control': 'no-store',
        'Set-Cookie': clearCookie(COOKIE_NAME),
      },
    );
  }

  if (req.method === 'GET' && url.pathname === '/auth/gitea/login') {
    if (!authEnabled) {
      return json(req, res, 400, { error: 'Gitea auth is not configured' });
    }

    const state = crypto.randomUUID();
    const returnTo = url.searchParams.get('returnTo') || '/';
    const authorizeUrl = new URL('/login/oauth/authorize', GITEA_BASE_URL);
    authorizeUrl.search = new URLSearchParams({
      client_id: GITEA_CLIENT_ID,
      redirect_uri: GITEA_REDIRECT_URI,
      response_type: 'code',
      scope: GITEA_SCOPES,
      state,
    }).toString();

    return redirect(req, res, authorizeUrl.toString(), {
      'Set-Cookie': [
        createCookie(OAUTH_STATE_COOKIE, state),
        createCookie(OAUTH_RETURN_TO_COOKIE, returnTo),
      ],
    });
  }

  if (req.method === 'GET' && url.pathname === '/auth/gitea/callback') {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const cookies = parseCookies(req);

    if (!authEnabled) {
      return json(req, res, 400, { error: 'Gitea auth is not configured' });
    }

    if (!code || !state || cookies[OAUTH_STATE_COOKIE] !== state) {
      return json(req, res, 400, { error: 'invalid oauth callback' });
    }

    try {
      const token = await exchangeCodeForToken(code);
      const user = await fetchGiteaUser(token.access_token);
      const sessionId = store.createSession(user);
      const returnTo = cookies[OAUTH_RETURN_TO_COOKIE] || '/';

      return redirect(req, res, `${FRONTEND_ORIGIN}${returnTo}`, {
        'Set-Cookie': [
          clearCookie(OAUTH_STATE_COOKIE),
          clearCookie(OAUTH_RETURN_TO_COOKIE),
          createCookie(COOKIE_NAME, sessionId),
        ],
      });
    } catch (error) {
      return json(req, res, 400, {
        error: error instanceof Error ? error.message : 'oauth callback failed',
      });
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/comments') {
    const pagePath = url.searchParams.get('pagePath');
    const blockId = url.searchParams.get('blockId');
    const page = Number(url.searchParams.get('page') || '1');
    const pageSize = Number(url.searchParams.get('pageSize') || '20');

    if (!pagePath) {
      return json(req, res, 400, { error: 'pagePath is required' });
    }

    return json(req, res, 200, store.list({ pagePath, blockId, page, pageSize }));
  }

  if (req.method === 'GET' && url.pathname === '/api/comment-counts') {
    const pagePath = url.searchParams.get('pagePath');

    if (!pagePath) {
      return json(req, res, 400, { error: 'pagePath is required' });
    }

    return json(req, res, 200, store.summarize(pagePath));
  }

  if (req.method === 'POST' && url.pathname === '/api/comments') {
    try {
      const input = await readJson(req);
      const error = validateCommentInput(input);

      if (error) {
        return json(req, res, 400, { error });
      }

      const { error: authError, user } = requireCurrentUser(req);
      if (authError) {
        return json(req, res, 401, { error: authError });
      }

      const comment = store.create({
        ...input,
        authorId: user?.id ?? input.authorId,
        authorName: user?.name ?? input.authorName,
        authorLogin: user?.login ?? input.authorLogin ?? null,
        authorAvatarUrl: user?.avatarUrl ?? input.authorAvatarUrl ?? null,
      });
      return json(req, res, 201, { item: comment });
    } catch (error) {
      return json(req, res, 400, {
        error: error instanceof Error ? error.message : 'invalid JSON body',
      });
    }
  }

  if (req.method === 'DELETE' && url.pathname.startsWith('/api/comments/')) {
    const commentId = decodeURIComponent(url.pathname.replace('/api/comments/', ''));
    const existing = store.find(commentId);

    if (!existing) {
      return json(req, res, 404, { error: 'comment not found' });
    }

    if (authEnabled) {
      const { error: authError, user } = requireCurrentUser(req);
      if (authError) {
        return json(req, res, 401, { error: authError });
      }

      if (existing.authorId !== user.id) {
        return json(req, res, 403, { error: 'forbidden' });
      }
    }

    const item = store.remove(commentId);
    return json(req, res, 200, { item });
  }

  return json(req, res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  console.log(`[rspress-plugin-comments-backend] listening on http://localhost:${PORT}`);
});
