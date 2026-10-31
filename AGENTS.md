# Agent Guidelines & Guardrails for SharedNotes Repository

This document defines repository-level instructions, workflows, and guardrails for AI coding assistants working in this repository.

---

## 1. Secrets & Confidentiality Guardrails

> [!IMPORTANT]
> **Strict Secrets Protection**
> - **NEVER print or echo raw API keys or secrets** from `.env`, `.dev.vars`, or memory into chat responses or artifacts.
> - **Always mask keys** (e.g. `9c656b••••••••` or `[CONFIGURED]`).
> - Do not commit `.env`, `.dev.vars`, or actual keys to Git.
> - Ensure all local secrets remain listed in `.gitignore`.

---

## 2. Environment & Key Management Workflow

- **Local Development**: Uses `.dev.vars` and local SQLite via `npm run dev`.
- **Key Generation & Rotation**: Use the CLI tool:
  - `./bin/cli.js keys rotate --owners="alice,bob" --roles="admin,user" --upload`
- **Cloudflare Secrets**:
  - `API_KEYS`: Comma-separated API keys.
  - `KEY_OWNERS`: Parallel owner usernames.
  - `KEY_ROLES`: Parallel roles (`admin` or `user`).

---

## 3. Testing Guidelines

- Default test suite (isolated in-runtime tests with in-memory D1): `npm test`
- Interactive watch mode: `npm run test:watch`
- When running tests locally against `http://localhost:8787`, use `npm run test:local`.
- When running tests specifically against remote deployment, use `npm run test:remote`.
- Clean up any test records created in the database after remote/local test suites finish.
