import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath) && typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(envPath);
  } catch {}
}

const configuredKeys = (process.env.API_KEYS || "").split(",").map((s) => s.trim()).filter(Boolean);
const configuredOwners = (process.env.KEY_OWNERS || "").split(",").map((s) => s.trim()).filter(Boolean);
const BASE_URL = process.env.BASE_URL || process.env.WORKER_URL || "http://localhost:8787";
const ADMIN_KEY = process.env.TEST_ADMIN_KEY || configuredKeys[0] || "test-admin-key-12345";
const USER_KEY = process.env.TEST_USER_KEY || configuredKeys[1] || "test-user-key-67890";
const EXPECTED_USER = process.env.TEST_USER_OWNER || configuredOwners[1] || "test-user";

const req = (path, options = {}) => {
  const url = `${BASE_URL}${path}`;
  const headers = { ...options.headers };
  if (options.auth) {
    headers["Authorization"] = `Bearer ${options.auth}`;
  }
  if (options.body && typeof options.body === "object") {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(options.body);
  }
  return fetch(url, { ...options, headers });
};

// Track test-created notes so only test data is cleaned up
const TEST_PREFIX = "*TEST* ";
const createdTestNoteIds = new Set();

describe("Shared Notes Service API", () => {
  describe("Health & Self-Documentation", () => {
    it("returns 200 and ok: true without auth", async () => {
      const res = await req("/health");
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.ok, true);
      assert.equal(data.service, "sharednotes");
    });

    it("serves agent manual at /", async () => {
      const res = await req("/");
      assert.equal(res.status, 200);
      const text = await res.text();
      assert.ok(text.includes("# SharedNotes Service"));
      assert.ok(res.headers.get("content-type").includes("text/markdown"));
    });

    it("serves agent manual at /instructions", async () => {
      const res = await req("/instructions");
      assert.equal(res.status, 200);
      const text = await res.text();
      assert.ok(text.includes("# SharedNotes Service"));
    });

    it("serves agent manual at /docs", async () => {
      const res = await req("/docs");
      assert.equal(res.status, 200);
      const text = await res.text();
      assert.ok(text.includes("# SharedNotes Service"));
    });

    it("serves static Muse connector at /connector.zip", async () => {
      const res = await req("/connector.zip");
      assert.equal(res.status, 200);
      assert.ok(res.headers.get("content-type").includes("zip"));
      const buffer = await res.arrayBuffer();
      assert.ok(buffer.byteLength > 1000);
    });

    it("serves agent manual at /llms.txt without admin section by default", async () => {
      const res = await req("/llms.txt");
      assert.equal(res.status, 200);
      const text = await res.text();
      assert.ok(text.includes("# SharedNotes Service"));
      assert.ok(!text.includes("Admin Operations"));
    });

    it("serves scrubbed manual to regular user", async () => {
      const res = await req("/llms.txt", { auth: USER_KEY });
      assert.equal(res.status, 200);
      const text = await res.text();
      assert.ok(!text.includes("Admin Operations"));
    });

    it("dynamically appends admin operations when accessed by admin", async () => {
      const res = await req("/llms.txt", { auth: ADMIN_KEY });
      assert.equal(res.status, 200);
      const text = await res.text();
      assert.ok(text.includes("Admin Operations (Privileged Mode)"));
      assert.ok(text.includes("Restore Soft-Deleted Note"));
    });
  });

  describe("Authentication", () => {
    it("returns 401 when no credentials are provided", async () => {
      const res = await req("/notes");
      assert.equal(res.status, 401);
      const data = await res.json();
      assert.equal(data.error, "unauthorized");
    });

    it("returns 401 with invalid credentials", async () => {
      const res = await req("/notes", { auth: "wrong-key" });
      assert.equal(res.status, 401);
      const data = await res.json();
      assert.equal(data.error, "unauthorized");
    });

    it("accepts valid Bearer token for user", async () => {
      const res = await req("/notes", { auth: USER_KEY });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(Array.isArray(data.notes));
    });

    it("accepts valid X-API-Key header", async () => {
      const res = await req("/notes", {
        headers: { "X-API-Key": ADMIN_KEY },
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(Array.isArray(data.notes));
    });
  });

  describe("CRUD & Flag Operations", () => {
    let noteId;
    const longBody = "A".repeat(300);

    it("creates a new note with auto-generated 150ch snippet", async () => {
      const res = await req("/notes", {
        method: "POST",
        auth: USER_KEY,
        body: { title: `${TEST_PREFIX}Test Note`, body: longBody },
      });
      assert.equal(res.status, 201);
      const note = await res.json();
      assert.ok(note.id);
      noteId = note.id;
      createdTestNoteIds.add(note.id);
      assert.equal(note.title, `${TEST_PREFIX}Test Note`);
      assert.equal(note.body, longBody);
      assert.equal(note.snippet, "A".repeat(150));
      assert.equal(note.created_by, EXPECTED_USER);
      assert.equal(note.is_archived, 0);
      assert.equal(note.is_deleted, 0);
    });

    it("retrieves the note by ID with full body and snippet", async () => {
      const res = await req(`/notes/${noteId}`, { auth: USER_KEY });
      assert.equal(res.status, 200);
      const note = await res.json();
      assert.equal(note.id, noteId);
      assert.equal(note.title, `${TEST_PREFIX}Test Note`);
      assert.equal(note.body, longBody);
      assert.equal(note.snippet, "A".repeat(150));
    });

    it("updates note with custom snippet override", async () => {
      const res = await req(`/notes/${noteId}`, {
        method: "PUT",
        auth: USER_KEY,
        body: {
          title: `${TEST_PREFIX}Updated Title`,
          body: "Updated Body Content",
          snippet: "Custom Blurb Override",
        },
      });
      assert.equal(res.status, 200);
      const note = await res.json();
      assert.equal(note.title, `${TEST_PREFIX}Updated Title`);
      assert.equal(note.body, "Updated Body Content");
      assert.equal(note.snippet, "Custom Blurb Override");
    });

    it("list by default excludes body and includes snippet", async () => {
      const res = await req("/notes", { auth: USER_KEY });
      assert.equal(res.status, 200);
      const data = await res.json();
      const note = data.notes.find((n) => n.id === noteId);
      assert.ok(note);
      assert.equal(note.snippet, "Custom Blurb Override");
      assert.equal(note.body, undefined);
    });

    it("list with ?full=true includes full body", async () => {
      const res = await req("/notes?full=true", { auth: USER_KEY });
      assert.equal(res.status, 200);
      const data = await res.json();
      const note = data.notes.find((n) => n.id === noteId);
      assert.ok(note);
      assert.equal(note.snippet, "Custom Blurb Override");
      assert.equal(note.body, "Updated Body Content");
    });

    it("archives the note", async () => {
      const res = await req(`/notes/${noteId}/archive`, {
        method: "POST",
        auth: USER_KEY,
      });
      assert.equal(res.status, 200);
      const note = await res.json();
      assert.equal(note.is_archived, 1);
    });

    it("does not include archived note in active notes list", async () => {
      const res = await req("/notes", { auth: USER_KEY });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(!data.notes.some((n) => n.id === noteId));
    });

    it("includes archived note when filtering ?status=archived", async () => {
      const res = await req("/notes?status=archived", { auth: USER_KEY });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(data.notes.some((n) => n.id === noteId));
    });

    it("unarchives the note", async () => {
      const res = await req(`/notes/${noteId}/unarchive`, {
        method: "POST",
        auth: USER_KEY,
      });
      assert.equal(res.status, 200);
      const note = await res.json();
      assert.equal(note.is_archived, 0);

      // Verify it is back in active list
      const listRes = await req("/notes", { auth: USER_KEY });
      const listData = await listRes.json();
      assert.ok(listData.notes.some((n) => n.id === noteId));
    });
  });

  describe("Search (?q=) and Delta Sync (?since=)", () => {
    let searchableNoteId;
    let baselineTimestamp;

    it("prepares a searchable note", async () => {
      baselineTimestamp = new Date(Date.now() - 2000).toISOString();
      const res = await req("/notes", {
        method: "POST",
        auth: USER_KEY,
        body: {
          title: `${TEST_PREFIX}UniquePineappleProject`,
          body: "TopSecretDragonFormula in body",
          snippet: "GoldenPineappleSummary",
        },
      });
      assert.equal(res.status, 201);
      const note = await res.json();
      searchableNoteId = note.id;
      createdTestNoteIds.add(note.id);
    });

    it("searches by title keyword with ?q=", async () => {
      const res = await req("/notes?q=UniquePineapple", { auth: USER_KEY });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(data.notes.some((n) => n.id === searchableNoteId));
    });

    it("searches by body keyword with ?q=", async () => {
      const res = await req("/notes?q=DragonFormula", { auth: USER_KEY });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(data.notes.some((n) => n.id === searchableNoteId));
    });

    it("returns empty when query does not match", async () => {
      const res = await req("/notes?q=NonExistentSuperStringZzz", { auth: USER_KEY });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.notes.length, 0);
    });

    it("filters notes updated after a timestamp with ?since=", async () => {
      const res = await req(`/notes?since=${encodeURIComponent(baselineTimestamp)}`, {
        auth: USER_KEY,
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(data.notes.some((n) => n.id === searchableNoteId));
    });

    it("returns empty when ?since= is in the future", async () => {
      const futureTimestamp = new Date(Date.now() + 100000).toISOString();
      const res = await req(`/notes?since=${encodeURIComponent(futureTimestamp)}`, {
        auth: USER_KEY,
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.notes.length, 0);
    });
  });

  describe("Soft Delete, Restore, and RBAC", () => {
    let noteId;

    it("prepares a note for deletion testing", async () => {
      const res = await req("/notes", {
        method: "POST",
        auth: USER_KEY,
        body: { title: `${TEST_PREFIX}Delete Me`, body: "Ephemeral" },
      });
      assert.equal(res.status, 201);
      const note = await res.json();
      noteId = note.id;
      createdTestNoteIds.add(note.id);
    });

    it("regular user can soft-delete the note", async () => {
      const res = await req(`/notes/${noteId}`, {
        method: "DELETE",
        auth: USER_KEY,
      });
      assert.equal(res.status, 204);
    });

    it("soft-deleted note is not visible in user active list", async () => {
      const res = await req("/notes", { auth: USER_KEY });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(!data.notes.some((n) => n.id === noteId));
    });

    it("regular user receives 404 when directly fetching soft-deleted note", async () => {
      const res = await req(`/notes/${noteId}`, { auth: USER_KEY });
      assert.equal(res.status, 404);
    });

    it("regular user receives 403 when trying to list deleted notes", async () => {
      const res = await req("/notes?status=deleted", { auth: USER_KEY });
      assert.equal(res.status, 403);
      const data = await res.json();
      assert.equal(data.error, "forbidden");
    });

    it("regular user receives 403 when trying to restore deleted note", async () => {
      const res = await req(`/notes/${noteId}/restore`, {
        method: "POST",
        auth: USER_KEY,
      });
      assert.equal(res.status, 403);
      const data = await res.json();
      assert.equal(data.error, "forbidden");
    });

    it("admin CAN view deleted notes list", async () => {
      const res = await req("/notes?status=deleted", { auth: ADMIN_KEY });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(data.notes.some((n) => n.id === noteId && n.is_deleted === 1));
    });

    it("admin CAN fetch soft-deleted note by ID", async () => {
      const res = await req(`/notes/${noteId}`, { auth: ADMIN_KEY });
      assert.equal(res.status, 200);
      const note = await res.json();
      assert.equal(note.id, noteId);
      assert.equal(note.is_deleted, 1);
    });

    it("admin CAN restore the soft-deleted note", async () => {
      const res = await req(`/notes/${noteId}/restore`, {
        method: "POST",
        auth: ADMIN_KEY,
      });
      assert.equal(res.status, 200);
      const note = await res.json();
      assert.equal(note.id, noteId);
      assert.equal(note.is_deleted, 0);
    });

    it("regular user can fetch restored note again", async () => {
      const res = await req(`/notes/${noteId}`, { auth: USER_KEY });
      assert.equal(res.status, 200);
      const note = await res.json();
      assert.equal(note.id, noteId);
      assert.equal(note.is_deleted, 0);
    });

    it("regular user is forbidden from permanent deletion", async () => {
      const res = await req(`/notes/${noteId}?permanent=true`, {
        method: "DELETE",
        auth: USER_KEY,
      });
      assert.equal(res.status, 403);
    });

    it("admin CAN permanently delete the note", async () => {
      const res = await req(`/notes/${noteId}?permanent=true`, {
        method: "DELETE",
        auth: ADMIN_KEY,
      });
      assert.equal(res.status, 204);

      // Verify note is gone even for admin
      const fetchRes = await req(`/notes/${noteId}`, { auth: ADMIN_KEY });
      assert.equal(fetchRes.status, 404);
    });
  });

  describe("Content-Type & Raw Output", () => {
    let jsonNoteId;
    let mdNoteId;

    it("defaults content_type to text/markdown when unspecified", async () => {
      const res = await req("/notes", {
        method: "POST",
        auth: USER_KEY,
        body: { title: `${TEST_PREFIX}Markdown Default`, body: "# Heading" },
      });
      assert.equal(res.status, 201);
      const note = await res.json();
      mdNoteId = note.id;
      createdTestNoteIds.add(note.id);
      assert.equal(note.content_type, "text/markdown");
    });

    it("creates note with explicit custom content_type", async () => {
      const jsonContent = JSON.stringify({ state: "active", counter: 42 });
      const res = await req("/notes", {
        method: "POST",
        auth: USER_KEY,
        body: {
          title: `${TEST_PREFIX}JSON Data Note`,
          body: jsonContent,
          content_type: "application/json",
        },
      });
      assert.equal(res.status, 201);
      const note = await res.json();
      jsonNoteId = note.id;
      createdTestNoteIds.add(note.id);
      assert.equal(note.content_type, "application/json");
      assert.equal(note.body, jsonContent);
    });

    it("filters notes list by ?type=application/json", async () => {
      const res = await req("/notes?type=application/json", { auth: USER_KEY });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(data.notes.some((n) => n.id === jsonNoteId));
      assert.ok(!data.notes.some((n) => n.id === mdNoteId));
    });

    it("filters notes list by ?content_type=text/markdown", async () => {
      const res = await req("/notes?content_type=text/markdown", { auth: USER_KEY });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(data.notes.some((n) => n.id === mdNoteId));
      assert.ok(!data.notes.some((n) => n.id === jsonNoteId));
    });

    it("updates content_type on existing note", async () => {
      const res = await req(`/notes/${jsonNoteId}`, {
        method: "PUT",
        auth: USER_KEY,
        body: {
          content_type: "text/plain",
        },
      });
      assert.equal(res.status, 200);
      const note = await res.json();
      assert.equal(note.content_type, "text/plain");

      // Verify fetch reflects change
      const fetchRes = await req(`/notes/${jsonNoteId}`, { auth: USER_KEY });
      const fetched = await fetchRes.json();
      assert.equal(fetched.content_type, "text/plain");
    });

    it("serves raw note body with note content-type via ?raw=true", async () => {
      const res = await req(`/notes/${mdNoteId}?raw=true`, { auth: USER_KEY });
      assert.equal(res.status, 200);
      assert.ok(res.headers.get("content-type").includes("text/markdown"));
      const text = await res.text();
      assert.equal(text, "# Heading");
    });

    it("rejects oversized content_type (>100 chars)", async () => {
      const res = await req("/notes", {
        method: "POST",
        auth: USER_KEY,
        body: {
          title: `${TEST_PREFIX}Invalid Content Type`,
          body: "Hello",
          content_type: "x".repeat(101),
        },
      });
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.error, "invalid_payload");
    });
  });

  describe("Security & Input Validation", () => {
    it("handles CORS OPTIONS preflight request", async () => {
      const res = await req("/notes", { method: "OPTIONS" });
      assert.equal(res.status, 204);
      assert.equal(res.headers.get("access-control-allow-origin"), "*");
      assert.ok(res.headers.get("access-control-allow-methods").includes("POST"));
    });

    it("includes CORS headers on standard API responses", async () => {
      const res = await req("/health");
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("access-control-allow-origin"), "*");
    });

    it("rejects malformed percent-encoded URI gracefully", async () => {
      const res = await req("/notes/%E0%A4%A", { auth: USER_KEY });
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.error, "invalid_id");
    });

    it("rejects oversized title (>500 chars)", async () => {
      const res = await req("/notes", {
        method: "POST",
        auth: USER_KEY,
        body: { title: "X".repeat(501), body: "Valid body" },
      });
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.error, "invalid_payload");
    });
  });

  // Automated cleanup: permanently remove ONLY test notes created by this test run
  after(async () => {
    // 1. Delete notes tracked by this test run
    for (const id of createdTestNoteIds) {
      try {
        await req(`/notes/${encodeURIComponent(id)}?permanent=true`, {
          method: "DELETE",
          auth: ADMIN_KEY,
        });
      } catch {
        // Ignore cleanup errors
      }
    }

    // 2. Safety net: clean up any orphaned notes explicitly prefixed with *TEST*
    try {
      const leftoverRes = await req("/notes?q=*TEST*&status=all&limit=200", { auth: ADMIN_KEY });
      if (leftoverRes.ok) {
        const leftover = await leftoverRes.json();
        for (const note of leftover.notes || []) {
          if (note.title.startsWith(TEST_PREFIX)) {
            await req(`/notes/${encodeURIComponent(note.id)}?permanent=true`, {
              method: "DELETE",
              auth: ADMIN_KEY,
            });
          }
        }
      }
    } catch {
      // Ignore safety net sweep errors
    }
  });
});
