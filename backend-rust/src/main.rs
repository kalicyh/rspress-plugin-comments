use std::{
    collections::HashMap,
    env, fs,
    net::SocketAddr,
    path::{Path, PathBuf},
    sync::Arc,
};

use axum::{
    Json, Router,
    extract::{Path as AxumPath, Query, State},
    http::{
        HeaderMap, HeaderValue, Method, StatusCode,
        header::{CACHE_CONTROL, CONTENT_TYPE, LOCATION, SET_COOKIE},
    },
    response::{IntoResponse, Response},
    routing::{delete, get, post},
};
use chrono::Utc;
use reqwest::Client;
use rusqlite::{Connection, OptionalExtension, params, params_from_iter};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tower_http::cors::{AllowOrigin, CorsLayer};
use url::Url;
use uuid::Uuid;

#[derive(Clone)]
struct AppState {
    config: Arc<Config>,
    http_client: Client,
}

#[derive(Clone)]
struct Config {
    port: u16,
    db_path: PathBuf,
    frontend_origin: String,
    gitea_base_url: String,
    gitea_client_id: String,
    gitea_client_secret: String,
    gitea_redirect_uri: String,
    gitea_scopes: String,
    auth_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AuthUser {
    id: String,
    login: Option<String>,
    name: String,
    #[serde(rename = "avatarUrl")]
    avatar_url: Option<String>,
}

#[derive(Debug, Serialize)]
struct HealthResponse {
    ok: bool,
    service: &'static str,
    database: String,
    #[serde(rename = "authEnabled")]
    auth_enabled: bool,
}

#[derive(Debug, Serialize)]
struct AuthStateResponse {
    #[serde(rename = "authEnabled")]
    auth_enabled: bool,
    user: Option<AuthUser>,
}

#[derive(Debug, Serialize)]
struct Envelope<T> {
    item: T,
}

#[derive(Debug, Serialize)]
struct ErrorResponse {
    error: String,
}

#[derive(Debug, Serialize)]
struct CommentsResponse {
    items: Vec<CommentRecord>,
    pagination: Pagination,
}

#[derive(Debug, Serialize)]
struct Pagination {
    page: i64,
    #[serde(rename = "pageSize")]
    page_size: i64,
    #[serde(rename = "totalRootComments")]
    total_root_comments: i64,
    #[serde(rename = "totalPages")]
    total_pages: i64,
    #[serde(rename = "hasMore")]
    has_more: bool,
}

#[derive(Debug, Serialize)]
struct CommentCountsResponse {
    #[serde(rename = "pagePath")]
    page_path: String,
    #[serde(rename = "pageCount")]
    page_count: i64,
    blocks: Vec<BlockSummary>,
}

#[derive(Debug, Serialize)]
struct BlockSummary {
    #[serde(rename = "blockId")]
    block_id: String,
    #[serde(rename = "quoteText")]
    quote_text: Option<String>,
    #[serde(rename = "selectionMeta")]
    selection_meta: Option<String>,
    count: i64,
}

#[derive(Debug, Clone, Serialize)]
struct CommentRecord {
    id: String,
    #[serde(rename = "parentId")]
    parent_id: Option<String>,
    #[serde(rename = "targetType")]
    target_type: String,
    #[serde(rename = "pagePath")]
    page_path: String,
    #[serde(rename = "blockId")]
    block_id: Option<String>,
    #[serde(rename = "quoteText")]
    quote_text: Option<String>,
    #[serde(rename = "selectionMeta")]
    selection_meta: Option<String>,
    #[serde(rename = "authorId")]
    author_id: String,
    #[serde(rename = "authorName")]
    author_name: String,
    #[serde(rename = "authorLogin")]
    author_login: Option<String>,
    #[serde(rename = "authorAvatarUrl")]
    author_avatar_url: Option<String>,
    body: String,
    #[serde(rename = "createdAt")]
    created_at: String,
    #[serde(rename = "updatedAt")]
    updated_at: String,
    status: String,
}

#[derive(Debug, Deserialize)]
struct ListCommentsQuery {
    #[serde(rename = "pagePath")]
    page_path: Option<String>,
    #[serde(rename = "blockId")]
    block_id: Option<String>,
    page: Option<i64>,
    #[serde(rename = "pageSize")]
    page_size: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct CommentCountsQuery {
    #[serde(rename = "pagePath")]
    page_path: Option<String>,
}

#[derive(Debug, Deserialize)]
struct LoginQuery {
    #[serde(rename = "returnTo")]
    return_to: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OAuthCallbackQuery {
    code: Option<String>,
    state: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CreateCommentInput {
    #[serde(rename = "pagePath")]
    page_path: Option<String>,
    #[serde(rename = "blockId")]
    block_id: Option<String>,
    #[serde(rename = "parentId")]
    parent_id: Option<String>,
    #[serde(rename = "authorName")]
    author_name: Option<String>,
    #[serde(rename = "authorId")]
    author_id: Option<String>,
    body: Option<String>,
    #[serde(rename = "quoteText")]
    quote_text: Option<String>,
    #[serde(rename = "selectionMeta")]
    selection_meta: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct OAuthTokenResponse {
    access_token: String,
}

const COOKIE_NAME: &str = "hf_comments_session";
const OAUTH_STATE_COOKIE: &str = "hf_comments_oauth_state";
const OAUTH_RETURN_TO_COOKIE: &str = "hf_comments_return_to";

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    load_local_env();

    let config = Arc::new(Config::from_env()?);
    init_db(&config.db_path)?;
    let http_client = build_http_client()?;

    let app_state = AppState {
        config: config.clone(),
        http_client,
    };

    let frontend_origin = config.frontend_origin.clone();
    let cors = CorsLayer::new()
        .allow_credentials(true)
        .allow_methods([Method::GET, Method::POST, Method::DELETE, Method::OPTIONS])
        .allow_headers([CONTENT_TYPE])
        .allow_origin(AllowOrigin::predicate(move |origin: &HeaderValue, _| {
            origin
                .to_str()
                .map(|value| value == frontend_origin || value.starts_with("http://localhost:"))
                .unwrap_or(false)
        }));

    let app = Router::new()
        .route("/api/health", get(get_health))
        .route("/api/auth/me", get(get_auth_me))
        .route("/api/auth/logout", post(post_logout))
        .route("/auth/gitea/login", get(get_gitea_login))
        .route("/auth/gitea/callback", get(get_gitea_callback))
        .route("/api/comments", get(get_comments).post(post_comment))
        .route("/api/comment-counts", get(get_comment_counts))
        .route("/api/comments/{comment_id}", delete(delete_comment))
        .fallback(not_found)
        .layer(cors)
        .with_state(app_state);

    let addr = SocketAddr::from(([0, 0, 0, 0], config.port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    println!(
        "[rspress-plugin-comments-backend-rust] listening on http://0.0.0.0:{}",
        config.port
    );
    axum::serve(listener, app).await?;
    Ok(())
}

impl Config {
    fn from_env() -> Result<Self, Box<dyn std::error::Error>> {
        let port = env::var("PORT")
            .ok()
            .and_then(|value| value.parse::<u16>().ok())
            .unwrap_or(4010);
        let cwd = env::current_dir()?;
        let db_path = env::var("COMMENTS_DB_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|_| cwd.join("data").join("comments.sqlite"));
        let frontend_origin =
            env::var("COMMENTS_WEB_ORIGIN").unwrap_or_else(|_| "http://localhost:3000".to_string());
        let gitea_base_url = env::var("GITEA_BASE_URL").unwrap_or_default();
        let gitea_client_id = env::var("GITEA_CLIENT_ID").unwrap_or_default();
        let gitea_client_secret = env::var("GITEA_CLIENT_SECRET").unwrap_or_default();
        let gitea_redirect_uri = env::var("GITEA_REDIRECT_URI")
            .unwrap_or_else(|_| format!("http://localhost:{port}/auth/gitea/callback"));
        let gitea_scopes =
            env::var("GITEA_SCOPES").unwrap_or_else(|_| "openid profile email".to_string());
        let auth_enabled = !gitea_base_url.is_empty()
            && !gitea_client_id.is_empty()
            && !gitea_client_secret.is_empty();

        Ok(Self {
            port,
            db_path,
            frontend_origin,
            gitea_base_url,
            gitea_client_id,
            gitea_client_secret,
            gitea_redirect_uri,
            gitea_scopes,
            auth_enabled,
        })
    }
}

fn build_http_client() -> Result<Client, Box<dyn std::error::Error>> {
    let mut builder = Client::builder();
    if let Ok(path) = env::var("GITEA_CA_CERT_PATH") {
        let pem = fs::read(path)?;
        let cert = reqwest::Certificate::from_pem(&pem)?;
        builder = builder.add_root_certificate(cert);
    }
    Ok(builder.build()?)
}

fn load_local_env() {
    let _ = dotenvy::from_filename(".env.local");
}

fn ensure_parent_dir(file_path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent)?;
    }
    Ok(())
}

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn init_db(db_path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    ensure_parent_dir(db_path)?;
    let conn = Connection::open(db_path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.execute_batch(
        r#"
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
        "#,
    )?;

    let columns: Vec<String> = conn
        .prepare("PRAGMA table_info(comments)")?
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<_, _>>()?;

    for (name, sql) in [
        (
            "quote_text",
            "ALTER TABLE comments ADD COLUMN quote_text TEXT",
        ),
        (
            "selection_meta",
            "ALTER TABLE comments ADD COLUMN selection_meta TEXT",
        ),
        (
            "author_login",
            "ALTER TABLE comments ADD COLUMN author_login TEXT",
        ),
        (
            "author_avatar_url",
            "ALTER TABLE comments ADD COLUMN author_avatar_url TEXT",
        ),
    ] {
        if !columns.iter().any(|column| column == name) {
            conn.execute(sql, [])?;
        }
    }

    let count: i64 = conn.query_row("SELECT COUNT(*) FROM comments", [], |row| row.get(0))?;
    if count == 0 {
        seed_db(&conn)?;
    }
    Ok(())
}

fn seed_db(conn: &Connection) -> Result<(), Box<dyn std::error::Error>> {
    let now = now_iso();
    let mut stmt = conn.prepare(
        r#"
        INSERT INTO comments (
          id, parent_id, target_type, page_path, block_id, quote_text, selection_meta,
          author_id, author_name, author_login, author_avatar_url, body, created_at,
          updated_at, status
        ) VALUES (
          ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15
        )
        "#,
    )?;

    stmt.execute(params![
        Uuid::new_v4().to_string(),
        Option::<String>::None,
        "page",
        "/hscp-user-guide",
        Option::<String>::None,
        Option::<String>::None,
        Option::<String>::None,
        "system",
        "System",
        "system",
        Option::<String>::None,
        "这是后端目录创建后的初始整页评论示例。",
        now,
        now_iso(),
        "published"
    ])?;

    stmt.execute(params![
        Uuid::new_v4().to_string(),
        Option::<String>::None,
        "block",
        "/hscp-user-guide",
        "它现在能做什么",
        "它现在能做什么",
        Option::<String>::None,
        "system",
        "System",
        "system",
        Option::<String>::None,
        "这是一个绑定到 blockId 的段评示例。",
        now_iso(),
        now_iso(),
        "published"
    ])?;
    Ok(())
}

fn open_db(path: &Path) -> Result<Connection, rusqlite::Error> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    Ok(conn)
}

fn parse_cookies(headers: &HeaderMap) -> HashMap<String, String> {
    let mut cookies = HashMap::new();
    let Some(value) = headers.get(axum::http::header::COOKIE) else {
        return cookies;
    };
    let Ok(raw) = value.to_str() else {
        return cookies;
    };

    for item in raw.split(';') {
        let trimmed = item.trim();
        if trimmed.is_empty() {
            continue;
        }
        let mut parts = trimmed.splitn(2, '=');
        let Some(name) = parts.next() else {
            continue;
        };
        let value = parts.next().unwrap_or_default();
        cookies.insert(name.to_string(), value.to_string());
    }
    cookies
}

fn create_cookie(name: &str, value: &str, max_age: Option<u64>) -> String {
    let mut cookie = format!("{name}={value}; Path=/; HttpOnly; SameSite=Lax");
    if let Some(seconds) = max_age {
        cookie.push_str(&format!("; Max-Age={seconds}"));
        if seconds == 0 {
            cookie.push_str("; Expires=Thu, 01 Jan 1970 00:00:00 GMT");
        }
    }
    cookie
}

fn clear_cookie(name: &str) -> String {
    create_cookie(name, "", Some(0))
}

fn json_response<T: Serialize>(status: StatusCode, data: T) -> Response {
    (status, Json(data)).into_response()
}

fn redirect_response(location: String, cookies: &[String]) -> Response {
    let mut response = StatusCode::FOUND.into_response();
    response.headers_mut().insert(
        LOCATION,
        HeaderValue::from_str(&location).unwrap_or_else(|_| HeaderValue::from_static("/")),
    );
    for cookie in cookies {
        if let Ok(value) = HeaderValue::from_str(cookie) {
            response.headers_mut().append(SET_COOKIE, value);
        }
    }
    response
}

fn get_current_user(config: &Config, headers: &HeaderMap) -> Result<Option<AuthUser>, String> {
    let cookies = parse_cookies(headers);
    let Some(session_id) = cookies.get(COOKIE_NAME) else {
        return Ok(None);
    };
    let conn = open_db(&config.db_path).map_err(|error| error.to_string())?;
    let user_json: Option<String> = conn
        .query_row(
            "SELECT user_json FROM sessions WHERE id = ?1",
            [session_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    match user_json {
        Some(payload) => serde_json::from_str::<AuthUser>(&payload)
            .map(Some)
            .map_err(|error| error.to_string()),
        None => Ok(None),
    }
}

async fn get_health(State(state): State<AppState>) -> Response {
    json_response(
        StatusCode::OK,
        HealthResponse {
            ok: true,
            service: "rspress-plugin-comments-backend-rust",
            database: state.config.db_path.display().to_string(),
            auth_enabled: state.config.auth_enabled,
        },
    )
}

async fn get_auth_me(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let user = match get_current_user(&state.config, &headers) {
        Ok(user) => user,
        Err(error) => {
            return json_response(StatusCode::INTERNAL_SERVER_ERROR, ErrorResponse { error });
        }
    };

    let mut response = json_response(
        StatusCode::OK,
        AuthStateResponse {
            auth_enabled: state.config.auth_enabled,
            user,
        },
    );
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

async fn post_logout(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Some(session_id) = parse_cookies(&headers).get(COOKIE_NAME).cloned() {
        let db_path = state.config.db_path.clone();
        let _ = tokio::task::spawn_blocking(move || -> Result<(), String> {
            let conn = open_db(&db_path).map_err(|error| error.to_string())?;
            conn.execute("DELETE FROM sessions WHERE id = ?1", [session_id])
                .map_err(|error| error.to_string())?;
            Ok(())
        })
        .await;
    }

    let mut response = json_response(StatusCode::OK, json!({ "ok": true }));
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response.headers_mut().append(
        SET_COOKIE,
        HeaderValue::from_str(&clear_cookie(COOKIE_NAME)).unwrap(),
    );
    response
}

async fn get_gitea_login(
    State(state): State<AppState>,
    Query(query): Query<LoginQuery>,
) -> Response {
    if !state.config.auth_enabled {
        return json_response(
            StatusCode::BAD_REQUEST,
            ErrorResponse {
                error: "Gitea auth is not configured".to_string(),
            },
        );
    }

    let oauth_state = Uuid::new_v4().to_string();
    let return_to = query.return_to.unwrap_or_else(|| "/".to_string());
    let mut authorize_url = match Url::parse(&format!(
        "{}/login/oauth/authorize",
        state.config.gitea_base_url.trim_end_matches('/')
    )) {
        Ok(url) => url,
        Err(error) => {
            return json_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                ErrorResponse {
                    error: error.to_string(),
                },
            );
        }
    };

    authorize_url
        .query_pairs_mut()
        .append_pair("client_id", &state.config.gitea_client_id)
        .append_pair("redirect_uri", &state.config.gitea_redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", &state.config.gitea_scopes)
        .append_pair("state", &oauth_state);

    redirect_response(
        authorize_url.to_string(),
        &[
            create_cookie(OAUTH_STATE_COOKIE, &oauth_state, None),
            create_cookie(OAUTH_RETURN_TO_COOKIE, &return_to, None),
        ],
    )
}

async fn get_gitea_callback(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<OAuthCallbackQuery>,
) -> Response {
    if !state.config.auth_enabled {
        return json_response(
            StatusCode::BAD_REQUEST,
            ErrorResponse {
                error: "Gitea auth is not configured".to_string(),
            },
        );
    }

    let cookies = parse_cookies(&headers);
    let Some(code) = query.code else {
        return json_response(
            StatusCode::BAD_REQUEST,
            ErrorResponse {
                error: "invalid oauth callback".to_string(),
            },
        );
    };
    let Some(state_param) = query.state else {
        return json_response(
            StatusCode::BAD_REQUEST,
            ErrorResponse {
                error: "invalid oauth callback".to_string(),
            },
        );
    };

    if cookies.get(OAUTH_STATE_COOKIE) != Some(&state_param) {
        return json_response(
            StatusCode::BAD_REQUEST,
            ErrorResponse {
                error: "invalid oauth callback".to_string(),
            },
        );
    }

    let token = match exchange_code_for_token(&state, &code).await {
        Ok(token) => token,
        Err(error) => {
            return json_response(StatusCode::BAD_REQUEST, ErrorResponse { error });
        }
    };
    let user = match fetch_gitea_user(&state, &token.access_token).await {
        Ok(user) => user,
        Err(error) => {
            return json_response(StatusCode::BAD_REQUEST, ErrorResponse { error });
        }
    };

    let db_path = state.config.db_path.clone();
    let user_for_db = user.clone();
    let session_id =
        match tokio::task::spawn_blocking(move || create_session(&db_path, &user_for_db)).await {
            Ok(Ok(session_id)) => session_id,
            Ok(Err(error)) => {
                return json_response(StatusCode::INTERNAL_SERVER_ERROR, ErrorResponse { error });
            }
            Err(error) => {
                return json_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    ErrorResponse {
                        error: error.to_string(),
                    },
                );
            }
        };

    let return_to = cookies
        .get(OAUTH_RETURN_TO_COOKIE)
        .cloned()
        .unwrap_or_else(|| "/".to_string());
    redirect_response(
        format!("{}{}", state.config.frontend_origin, return_to),
        &[
            clear_cookie(OAUTH_STATE_COOKIE),
            clear_cookie(OAUTH_RETURN_TO_COOKIE),
            create_cookie(COOKIE_NAME, &session_id, None),
        ],
    )
}

async fn get_comments(
    State(state): State<AppState>,
    Query(query): Query<ListCommentsQuery>,
) -> Response {
    let Some(page_path) = query.page_path else {
        return json_response(
            StatusCode::BAD_REQUEST,
            ErrorResponse {
                error: "pagePath is required".to_string(),
            },
        );
    };

    let db_path = state.config.db_path.clone();
    let block_id = query.block_id.clone();
    let page = query.page.unwrap_or(1);
    let page_size = query.page_size.unwrap_or(20);

    match tokio::task::spawn_blocking(move || {
        list_comments(&db_path, &page_path, block_id, page, page_size)
    })
    .await
    {
        Ok(Ok(data)) => json_response(StatusCode::OK, data),
        Ok(Err(error)) => json_response(StatusCode::INTERNAL_SERVER_ERROR, ErrorResponse { error }),
        Err(error) => json_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            ErrorResponse {
                error: error.to_string(),
            },
        ),
    }
}

async fn get_comment_counts(
    State(state): State<AppState>,
    Query(query): Query<CommentCountsQuery>,
) -> Response {
    let Some(page_path) = query.page_path else {
        return json_response(
            StatusCode::BAD_REQUEST,
            ErrorResponse {
                error: "pagePath is required".to_string(),
            },
        );
    };

    let db_path = state.config.db_path.clone();
    match tokio::task::spawn_blocking(move || summarize_comments(&db_path, &page_path)).await {
        Ok(Ok(data)) => json_response(StatusCode::OK, data),
        Ok(Err(error)) => json_response(StatusCode::INTERNAL_SERVER_ERROR, ErrorResponse { error }),
        Err(error) => json_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            ErrorResponse {
                error: error.to_string(),
            },
        ),
    }
}

async fn post_comment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<CreateCommentInput>,
) -> Response {
    let validation_error = validate_comment_input(&input);
    if let Some(error) = validation_error {
        return json_response(StatusCode::BAD_REQUEST, ErrorResponse { error });
    }

    let user = match get_current_user(&state.config, &headers) {
        Ok(user) => user,
        Err(error) => {
            return json_response(StatusCode::INTERNAL_SERVER_ERROR, ErrorResponse { error });
        }
    };

    if state.config.auth_enabled && user.is_none() {
        return json_response(
            StatusCode::UNAUTHORIZED,
            ErrorResponse {
                error: "authentication required".to_string(),
            },
        );
    }

    let payload = CreateCommentPayload {
        page_path: input.page_path.unwrap(),
        block_id: input.block_id,
        parent_id: input.parent_id,
        quote_text: input.quote_text,
        selection_meta: input.selection_meta,
        author_id: user
            .as_ref()
            .map(|current| current.id.clone())
            .or(input.author_id)
            .unwrap_or_else(|| "anonymous".to_string()),
        author_name: user
            .as_ref()
            .map(|current| current.name.clone())
            .or(input.author_name)
            .unwrap_or_else(|| "Anonymous".to_string()),
        author_login: user.as_ref().and_then(|current| current.login.clone()),
        author_avatar_url: user.as_ref().and_then(|current| current.avatar_url.clone()),
        body: input.body.unwrap(),
    };

    let db_path = state.config.db_path.clone();
    match tokio::task::spawn_blocking(move || create_comment(&db_path, payload)).await {
        Ok(Ok(item)) => json_response(StatusCode::CREATED, Envelope { item }),
        Ok(Err(error)) => json_response(StatusCode::INTERNAL_SERVER_ERROR, ErrorResponse { error }),
        Err(error) => json_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            ErrorResponse {
                error: error.to_string(),
            },
        ),
    }
}

async fn delete_comment(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(comment_id): AxumPath<String>,
) -> Response {
    let db_path = state.config.db_path.clone();
    let existing = match tokio::task::spawn_blocking({
        let db_path = db_path.clone();
        let comment_id = comment_id.clone();
        move || find_comment(&db_path, &comment_id)
    })
    .await
    {
        Ok(Ok(comment)) => comment,
        Ok(Err(error)) => {
            return json_response(StatusCode::INTERNAL_SERVER_ERROR, ErrorResponse { error });
        }
        Err(error) => {
            return json_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                ErrorResponse {
                    error: error.to_string(),
                },
            );
        }
    };

    let Some(existing) = existing else {
        return json_response(
            StatusCode::NOT_FOUND,
            ErrorResponse {
                error: "comment not found".to_string(),
            },
        );
    };

    if state.config.auth_enabled {
        let user = match get_current_user(&state.config, &headers) {
            Ok(user) => user,
            Err(error) => {
                return json_response(StatusCode::INTERNAL_SERVER_ERROR, ErrorResponse { error });
            }
        };
        let Some(user) = user else {
            return json_response(
                StatusCode::UNAUTHORIZED,
                ErrorResponse {
                    error: "authentication required".to_string(),
                },
            );
        };
        if existing.author_id != user.id {
            return json_response(
                StatusCode::FORBIDDEN,
                ErrorResponse {
                    error: "forbidden".to_string(),
                },
            );
        }
    }

    match tokio::task::spawn_blocking(move || remove_comment(&db_path, &comment_id)).await {
        Ok(Ok(Some(item))) => json_response(StatusCode::OK, Envelope { item }),
        Ok(Ok(None)) => json_response(
            StatusCode::NOT_FOUND,
            ErrorResponse {
                error: "comment not found".to_string(),
            },
        ),
        Ok(Err(error)) => json_response(StatusCode::INTERNAL_SERVER_ERROR, ErrorResponse { error }),
        Err(error) => json_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            ErrorResponse {
                error: error.to_string(),
            },
        ),
    }
}

async fn not_found() -> Response {
    json_response(
        StatusCode::NOT_FOUND,
        ErrorResponse {
            error: "not found".to_string(),
        },
    )
}

fn validate_comment_input(input: &CreateCommentInput) -> Option<String> {
    if input.page_path.as_deref().is_none_or(str::is_empty) {
        return Some("pagePath is required".to_string());
    }
    if input.body.as_deref().is_none_or(str::is_empty) {
        return Some("body is required".to_string());
    }
    if input
        .selection_meta
        .as_ref()
        .is_some_and(|value| !value.is_object())
    {
        return Some("selectionMeta must be an object".to_string());
    }
    None
}

async fn exchange_code_for_token(
    state: &AppState,
    code: &str,
) -> Result<OAuthTokenResponse, String> {
    let url = format!(
        "{}/login/oauth/access_token",
        state.config.gitea_base_url.trim_end_matches('/')
    );
    let response = state
        .http_client
        .post(url)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .json(&json!({
            "client_id": state.config.gitea_client_id,
            "client_secret": state.config.gitea_client_secret,
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": state.config.gitea_redirect_uri,
        }))
        .send()
        .await
        .map_err(|error| error.to_string())?;

    if !response.status().is_success() {
        return Err(format!("token exchange failed: {}", response.status()));
    }

    response.json().await.map_err(|error| error.to_string())
}

async fn fetch_gitea_user(state: &AppState, access_token: &str) -> Result<AuthUser, String> {
    let url = format!(
        "{}/api/v1/user",
        state.config.gitea_base_url.trim_end_matches('/')
    );
    let response = state
        .http_client
        .get(url)
        .bearer_auth(access_token)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|error| error.to_string())?;

    if !response.status().is_success() {
        return Err(format!("failed to fetch Gitea user: {}", response.status()));
    }

    let data: Value = response.json().await.map_err(|error| error.to_string())?;
    Ok(AuthUser {
        id: data
            .get("id")
            .and_then(Value::as_i64)
            .map(|value| value.to_string())
            .or_else(|| {
                data.get("login")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .unwrap_or_else(|| "unknown".to_string()),
        login: data
            .get("login")
            .and_then(Value::as_str)
            .map(str::to_string),
        name: data
            .get("full_name")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .or_else(|| {
                data.get("login")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .unwrap_or_else(|| "unknown".to_string()),
        avatar_url: data
            .get("avatar_url")
            .and_then(Value::as_str)
            .map(str::to_string),
    })
}

#[derive(Debug)]
struct CreateCommentPayload {
    page_path: String,
    block_id: Option<String>,
    parent_id: Option<String>,
    quote_text: Option<String>,
    selection_meta: Option<Value>,
    author_id: String,
    author_name: String,
    author_login: Option<String>,
    author_avatar_url: Option<String>,
    body: String,
}

fn create_session(db_path: &Path, user: &AuthUser) -> Result<String, String> {
    let conn = open_db(db_path).map_err(|error| error.to_string())?;
    let session_id = Uuid::new_v4().to_string();
    let now = now_iso();
    conn.execute(
        "INSERT INTO sessions (id, user_json, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
        params![
            session_id,
            serde_json::to_string(user).map_err(|error| error.to_string())?,
            now,
            now_iso()
        ],
    )
    .map_err(|error| error.to_string())?;
    Ok(session_id)
}

fn row_to_comment(row: &rusqlite::Row<'_>) -> rusqlite::Result<CommentRecord> {
    Ok(CommentRecord {
        id: row.get("id")?,
        parent_id: row.get("parentId")?,
        target_type: row.get("targetType")?,
        page_path: row.get("pagePath")?,
        block_id: row.get("blockId")?,
        quote_text: row.get("quoteText")?,
        selection_meta: row.get("selectionMeta")?,
        author_id: row.get("authorId")?,
        author_name: row.get("authorName")?,
        author_login: row.get("authorLogin")?,
        author_avatar_url: row.get("authorAvatarUrl")?,
        body: row.get("body")?,
        created_at: row.get("createdAt")?,
        updated_at: row.get("updatedAt")?,
        status: row.get("status")?,
    })
}

fn list_comments(
    db_path: &Path,
    page_path: &str,
    block_id: Option<String>,
    page: i64,
    page_size: i64,
) -> Result<CommentsResponse, String> {
    let conn = open_db(db_path).map_err(|error| error.to_string())?;
    let safe_page = page.max(1);
    let safe_page_size = page_size.clamp(1, 100);
    let offset = (safe_page - 1) * safe_page_size;

    let total_root_comments: i64 = if let Some(block_id) = block_id.as_deref() {
        conn.query_row(
            r#"
            SELECT COUNT(*)
            FROM comments
            WHERE page_path = ?1
              AND block_id = ?2
              AND parent_id IS NULL
            "#,
            params![page_path, block_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?
    } else {
        conn.query_row(
            r#"
            SELECT COUNT(*)
            FROM comments
            WHERE page_path = ?1
              AND block_id IS NULL
              AND parent_id IS NULL
            "#,
            [page_path],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?
    };

    let root_ids: Vec<String> = if let Some(block_id) = block_id.as_deref() {
        let mut stmt = conn
            .prepare(
                r#"
                SELECT id
                FROM comments
                WHERE page_path = ?1
                  AND block_id = ?2
                  AND parent_id IS NULL
                ORDER BY created_at DESC
                LIMIT ?3 OFFSET ?4
                "#,
            )
            .map_err(|error| error.to_string())?;
        stmt.query_map(
            params![page_path, block_id, safe_page_size, offset],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|error| error.to_string())?
    } else {
        let mut stmt = conn
            .prepare(
                r#"
                SELECT id
                FROM comments
                WHERE page_path = ?1
                  AND block_id IS NULL
                  AND parent_id IS NULL
                ORDER BY created_at DESC
                LIMIT ?2 OFFSET ?3
                "#,
            )
            .map_err(|error| error.to_string())?;
        stmt.query_map(params![page_path, safe_page_size, offset], |row| row.get(0))
            .map_err(|error| error.to_string())?
            .collect::<Result<_, _>>()
            .map_err(|error| error.to_string())?
    };

    let pagination = Pagination {
        page: safe_page,
        page_size: safe_page_size,
        total_root_comments,
        total_pages: ((total_root_comments + safe_page_size - 1) / safe_page_size).max(1),
        has_more: safe_page * safe_page_size < total_root_comments,
    };

    if root_ids.is_empty() {
        return Ok(CommentsResponse {
            items: Vec::new(),
            pagination,
        });
    }

    let placeholders = (0..root_ids.len())
        .map(|_| "?".to_string())
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        r#"
        WITH RECURSIVE subtree AS (
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
          WHERE id IN ({placeholders})
          UNION ALL
          SELECT
            c.id,
            c.parent_id AS parentId,
            c.target_type AS targetType,
            c.page_path AS pagePath,
            c.block_id AS blockId,
            c.quote_text AS quoteText,
            c.selection_meta AS selectionMeta,
            c.author_id AS authorId,
            c.author_name AS authorName,
            c.author_login AS authorLogin,
            c.author_avatar_url AS authorAvatarUrl,
            c.body,
            c.created_at AS createdAt,
            c.updated_at AS updatedAt,
            c.status
          FROM comments c
          INNER JOIN subtree s ON c.parent_id = s.id
        )
        SELECT *
        FROM subtree
        ORDER BY createdAt ASC
        "#
    );
    let mut stmt = conn.prepare(&sql).map_err(|error| error.to_string())?;
    let items = stmt
        .query_map(params_from_iter(root_ids.iter()), row_to_comment)
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;

    Ok(CommentsResponse { items, pagination })
}

fn summarize_comments(db_path: &Path, page_path: &str) -> Result<CommentCountsResponse, String> {
    let conn = open_db(db_path).map_err(|error| error.to_string())?;
    let page_count = conn
        .query_row(
            r#"
            SELECT COUNT(*)
            FROM comments
            WHERE page_path = ?1
              AND block_id IS NULL
              AND status != 'deleted'
            "#,
            [page_path],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;

    let mut stmt = conn
        .prepare(
            r#"
            SELECT
              block_id AS blockId,
              MAX(quote_text) AS quoteText,
              MAX(selection_meta) AS selectionMeta,
              COUNT(*) AS count
            FROM comments
            WHERE page_path = ?1
              AND block_id IS NOT NULL
              AND status != 'deleted'
            GROUP BY block_id
            "#,
        )
        .map_err(|error| error.to_string())?;
    let blocks = stmt
        .query_map([page_path], |row| {
            Ok(BlockSummary {
                block_id: row.get("blockId")?,
                quote_text: row.get("quoteText")?,
                selection_meta: row.get("selectionMeta")?,
                count: row.get("count")?,
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;

    Ok(CommentCountsResponse {
        page_path: page_path.to_string(),
        page_count,
        blocks,
    })
}

fn create_comment(db_path: &Path, payload: CreateCommentPayload) -> Result<CommentRecord, String> {
    let conn = open_db(db_path).map_err(|error| error.to_string())?;
    let now = now_iso();
    let comment = CommentRecord {
        id: Uuid::new_v4().to_string(),
        parent_id: payload.parent_id,
        target_type: if payload.block_id.is_some() {
            "block".to_string()
        } else {
            "page".to_string()
        },
        page_path: payload.page_path,
        block_id: payload.block_id,
        quote_text: payload.quote_text,
        selection_meta: payload.selection_meta.map(|value| value.to_string()),
        author_id: payload.author_id,
        author_name: payload.author_name,
        author_login: payload.author_login,
        author_avatar_url: payload.author_avatar_url,
        body: payload.body,
        created_at: now.clone(),
        updated_at: now,
        status: "published".to_string(),
    };

    conn.execute(
        r#"
        INSERT INTO comments (
          id, parent_id, target_type, page_path, block_id, quote_text, selection_meta,
          author_id, author_name, author_login, author_avatar_url, body, created_at,
          updated_at, status
        ) VALUES (
          ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15
        )
        "#,
        params![
            comment.id,
            comment.parent_id,
            comment.target_type,
            comment.page_path,
            comment.block_id,
            comment.quote_text,
            comment.selection_meta,
            comment.author_id,
            comment.author_name,
            comment.author_login,
            comment.author_avatar_url,
            comment.body,
            comment.created_at,
            comment.updated_at,
            comment.status,
        ],
    )
    .map_err(|error| error.to_string())?;

    Ok(comment)
}

fn find_comment(db_path: &Path, comment_id: &str) -> Result<Option<CommentRecord>, String> {
    let conn = open_db(db_path).map_err(|error| error.to_string())?;
    conn.query_row(
        r#"
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
        WHERE id = ?1
        "#,
        [comment_id],
        row_to_comment,
    )
    .optional()
    .map_err(|error| error.to_string())
}

fn remove_comment(db_path: &Path, comment_id: &str) -> Result<Option<CommentRecord>, String> {
    let conn = open_db(db_path).map_err(|error| error.to_string())?;
    let Some(existing) = find_comment(db_path, comment_id)? else {
        return Ok(None);
    };

    let updated_at = now_iso();
    conn.execute(
        r#"
        UPDATE comments
        SET status = 'deleted', body = '', updated_at = ?1
        WHERE id = ?2
        "#,
        params![updated_at, comment_id],
    )
    .map_err(|error| error.to_string())?;

    Ok(Some(CommentRecord {
        body: String::new(),
        status: "deleted".to_string(),
        updated_at,
        ..existing
    }))
}
