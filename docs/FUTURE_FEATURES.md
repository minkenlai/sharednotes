# Future Features & Edge Cases

This document details future architectural expansions, storage limits, and design considerations for SharedNotes.

---

## 1. Photos & File Attachments

### Storage Limits & Constraints
- **Cloudflare D1 (SQLite)**:
  - 1 MB maximum statement/query size.
  - 500 MB free storage limit (10 GB on paid).
  - SQLite BLOBs are not suitable for media files at the edge due to query memory overhead and row size limits.
- **Solution: Cloudflare R2 Object Storage**:
  - Native integration with Cloudflare Workers via R2 bindings.
  - 10 GB free storage per month with zero egress charges.
  - High performance file streaming for images, documents, and audio.

### Recommended Architecture
1. **D1 Table (`attachments`)**:
   ```sql
   CREATE TABLE IF NOT EXISTS attachments (
     id TEXT PRIMARY KEY,
     note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
     filename TEXT NOT NULL,
     content_type TEXT NOT NULL,
     size_bytes INTEGER NOT NULL,
     r2_key TEXT NOT NULL,
     uploaded_by TEXT NOT NULL,
     created_at TEXT NOT NULL
   );
   CREATE INDEX IF NOT EXISTS idx_attachments_note ON attachments(note_id);
   ```
2. **Endpoints**:
   - `POST /notes/:id/attachments`: Upload attachment (multipart or binary stream).
   - `GET /notes/:id/attachments/:attachment_id`: Serve/stream attachment with appropriate `Content-Type`.
   - `DELETE /notes/:id/attachments/:attachment_id`: Delete attachment from R2 and D1.

---

## 2. Dynamic Content-Type Support

### Concept
Allow notes to store structured JSON, code, or plaintext in addition to Markdown.

### Schema Addition
```sql
ALTER TABLE notes ADD COLUMN content_type TEXT NOT NULL DEFAULT 'text/markdown';
```

### Supported Types
- `text/markdown` (default)
- `text/plain`
- `application/json` (allows agents to persist structured state or key-value data)
- `text/csv` / `text/html` / `text/x-code`

---

## 3. Pinned & Read-Only Notes (House Rules & System Norms)

### Concept
Allow specific notes to act as team "handbooks", convention guides, or shared agent norms.

### Schema Addition
```sql
ALTER TABLE notes ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE notes ADD COLUMN is_readonly INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_notes_pinned ON notes(is_pinned DESC, updated_at DESC);
```

### Behavior
- **Pinned Notes**: Float to the top of note lists (`ORDER BY is_pinned DESC, updated_at DESC`).
- **Read-Only Notes**: Regular users and agents can read, but modifications (`PUT`, `DELETE`) require `admin` permissions.

---

## 4. Hot / Cold Timeline Architecture & Temporal Modeling

### Concept
Separate hot operational reads from the cold historical ledger for sub-millisecond edge performance.

```text
       ┌────────────────────────┐
       │     Incoming Write     │
       └───────────┬────────────┘
                   │
         ┌─────────┴─────────┐
         ▼                   ▼
┌──────────────────┐  ┌───────────────────┐
│   notes (Hot)    │  │notes_timeline(Cold│
│ (Current State)  │  │ (Append-Only Log) │
└──────────────────┘  └─────────┬─────────┘
                                │
                    (Periodic Worker Cron)
                                │
                                ▼
                      ┌───────────────────┐
                      │ Cloudflare R2 / DW│
                      │ (Compressed .gz)  │
                      └───────────────────┘
```

### Schema

#### 1. Hot Operational Table (`notes`)
Stores only the current active state:
```sql
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  snippet TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  is_archived INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT, -- NULL = active, Past = deleted, Future = TTL expiration
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_active ON notes(deleted_at, is_archived, updated_at DESC);
```

#### 2. Cold Timeline Ledger (`notes_timeline`)
Append-only changelog capturing state across time:
```sql
CREATE TABLE IF NOT EXISTS notes_timeline (
  timeline_id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  snippet TEXT NOT NULL,
  body TEXT NOT NULL,
  author TEXT NOT NULL,
  action TEXT NOT NULL, -- create, update, archive, unarchive, delete, restore
  recorded_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_timeline_note ON notes_timeline(note_id, recorded_at ASC);
CREATE INDEX IF NOT EXISTS idx_timeline_cull ON notes_timeline(recorded_at);
```

### Dual-Purpose `deleted_at` (Soft-Delete + Future TTL)
- **`deleted_at IS NULL`**: Active, persistent note.
- **`deleted_at <= NOW()`**: Soft-deleted at that historical moment.
- **`deleted_at > NOW()`**: **Scheduled TTL Expiration** (e.g. ephemeral agent task that automatically disappears after 24h without needing a background job).

---

## 5. Timeline Culling, Compression & Data Warehouse Offloading

### High Compressibility of Note History
Text revision history is largely repetitive string mutations. Compressing sequential note bodies with **gzip**, **Brotli**, or **zstandard (zstd)** achieves **80–90% compression ratios**.

### Offloading Pipeline (Cloudflare Worker Cron + R2)
1. **Worker Cron Trigger**: Run a scheduled task once a month (or weekly):
   ```toml
   [triggers]
   crons = ["0 0 1 * *"] # Midnight on the 1st of every month
   ```
2. **Batch & Extract**:
   ```sql
   SELECT * FROM notes_timeline WHERE recorded_at < datetime('now', '-90 days');
   ```
3. **Compress & Ship to R2**:
   - Stream rows into compressed JSONL: `archive/2026/timeline-2026-Q3.jsonl.gz`.
   - Store in Cloudflare R2 ($0.015/GB/mo, 10 GB free tier, zero egress fees).
4. **Prune D1**:
   ```sql
   DELETE FROM notes_timeline WHERE recorded_at < datetime('now', '-90 days');
   ```
5. **Analytics & Data Warehouse Querying**:
   - The compressed archives in R2 can be queried directly in-place using **DuckDB**:
     ```sql
     SELECT * FROM read_ndjson('s3://sharednotes-archive/2026/*.jsonl.gz') WHERE author = 'alice';
     ```
   - Can also be loaded effortlessly into BigQuery, Snowflake, or ClickHouse.

---

## 6. SQLite FTS5 (Full-Text Search) Indexing for D1

### Concept
Currently, keyword search across notes (`GET /notes?q=<search_text>`) performs a substring match using SQL `LIKE '%<query>%'` across `title`, `snippet`, and `body`. While lightweight and fast for small personal stores, `LIKE '%...%'` requires a full table scan and does not support stemming, word tokenization, or relevance scoring.

Cloudflare D1 natively supports the SQLite **FTS5 (Full-Text Search 5)** extension. Adding an external-content FTS5 virtual table allows sub-millisecond full-text searches with BM25 ranking without duplicating body storage.

### Schema & Triggers
```sql
-- 1. Create FTS5 virtual table referencing the notes table
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
  title,
  snippet,
  body,
  content='notes',
  content_rowid='rowid'
);

-- 2. Triggers to automatically keep the FTS index in sync with notes
CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts(rowid, title, snippet, body) VALUES (new.rowid, new.title, new.snippet, new.body);
END;

CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, snippet, body) VALUES ('delete', old.rowid, old.title, old.snippet, old.body);
END;

CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, snippet, body) VALUES ('delete', old.rowid, old.title, old.snippet, old.body);
  INSERT INTO notes_fts(rowid, title, snippet, body) VALUES (new.rowid, new.title, new.snippet, new.body);
END;
```

### Search Query with BM25 Ranking
```sql
SELECT n.id, n.title, n.snippet, n.content_type, n.created_by, n.created_at, n.updated_at,
       bm25(notes_fts) AS rank
FROM notes_fts
JOIN notes n ON notes_fts.rowid = n.rowid
WHERE notes_fts MATCH ? AND n.is_deleted = 0 AND n.is_archived = 0
ORDER BY rank
LIMIT ?;
```

### Benefits
- **Sub-millisecond query execution**: Eliminates full-table text scans as note counts grow.
- **BM25 Relevance Scoring**: Returns the most relevant notes at the top rather than solely ordering by `updated_at`.
- **Advanced Query Syntax**: Supports Boolean operators (`AND`, `OR`, `NOT`), prefix queries (`meet*`), and phrase queries (`"product sync"`).

---

## 7. Dynamic Self-Signup & Multi-Notebook Access Control

Detailed architectural RFC: [AUTH_AND_NOTEBOOKS_RFC.md](./AUTH_AND_NOTEBOOKS_RFC.md)

### Concept
Transition from static Worker secret auth (`API_KEYS`) to dynamic, database-backed authentication in Cloudflare D1 with self-service registration and scoped multi-tenant notebooks.

### Key Pillars
1. **Database-Backed API Keys (`users` & `api_keys`)**:
   - Secure token hashing with SHA-256 (`sn_live_...`), prefix auditing, and instant revocation.
   - Backward-compatible fallback to legacy Worker secrets for bootstrap/root access.
2. **Self-Service Registration (`POST /auth/register`)**:
   - Allows new users or AI agents to sign up directly via API or CLI (`sharednotes signup`).
   - Automatically provisions a personal default notebook.
3. **Notebook Isolation Boundaries & Membership Controls**:
   - Notebooks as first-class entities with granular access roles:
     - `owner`: full administrative and membership control.
     - `editor`: create, update, archive, and soft-delete notes.
     - `viewer`: read-only access.
   - Owners can add and remove members by `user_id` / username (Phase 1) and email invites with auto-linking on signup (Phase 2).
4. **Context-Preserving Routing for Agents**:
   - Transparent notebook routing via `X-Notebook-ID` header, `?notebook_id=<id>`, or default notebook fallback to maintain token-efficient prompt contexts.

