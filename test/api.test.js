import { describe, it } from "node:test";
import assert from "node:assert/strict";

const BASE_URL = process.env.BASE_URL || "https://sharednotes.<your-subdomain>.workers.dev";
const ADMIN_KEY = process.env.TEST_ADMIN_KEY || "test-admin-key-12345";
const USER_KEY = process.env.TEST_USER_KEY || "test-user-key-67890";

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

describe("Shared Notes Service API", () => {
  describe("Health Check", () => {
    it("returns 200 and ok: true without auth", async () => {
      const res = await req("/health");
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.ok, true);
      assert.equal(data.service, "sharednotes");
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

    it("creates a new note as regular user", async () => {
      const res = await req("/notes", {
        method: "POST",
        auth: USER_KEY,
        body: { title: "Test Note", body: "Hello World" },
      });
      assert.equal(res.status, 201);
      const note = await res.json();
      assert.ok(note.id);
      assert.equal(note.title, "Test Note");
      assert.equal(note.body, "Hello World");
      assert.equal(note.created_by, "test-user");
      assert.equal(note.is_archived, 0);
      assert.equal(note.is_deleted, 0);
      noteId = note.id;
    });

    it("retrieves the note by ID", async () => {
      const res = await req(`/notes/${noteId}`, { auth: USER_KEY });
      assert.equal(res.status, 200);
      const note = await res.json();
      assert.equal(note.id, noteId);
      assert.equal(note.title, "Test Note");
    });

    it("updates the note", async () => {
      const res = await req(`/notes/${noteId}`, {
        method: "PUT",
        auth: USER_KEY,
        body: { title: "Updated Title", body: "Updated Body" },
      });
      assert.equal(res.status, 200);
      const note = await res.json();
      assert.equal(note.title, "Updated Title");
      assert.equal(note.body, "Updated Body");
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

  describe("Soft Delete, Restore, and RBAC", () => {
    let noteId;

    it("prepares a note for deletion testing", async () => {
      const res = await req("/notes", {
        method: "POST",
        auth: USER_KEY,
        body: { title: "Delete Me", body: "Ephemeral" },
      });
      assert.equal(res.status, 201);
      const note = await res.json();
      noteId = note.id;
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
});
