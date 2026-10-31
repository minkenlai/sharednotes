#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

// Attempt to load .env if present
const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath) && typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(envPath);
  } catch {
    // Ignore malformed .env or permission issues
  }
}

// Colors for terminal output
const isTTY = process.stdout.isTTY;
const c = {
  reset: isTTY ? "\x1b[0m" : "",
  bold: isTTY ? "\x1b[1m" : "",
  dim: isTTY ? "\x1b[2m" : "",
  red: isTTY ? "\x1b[31m" : "",
  green: isTTY ? "\x1b[32m" : "",
  yellow: isTTY ? "\x1b[33m" : "",
  blue: isTTY ? "\x1b[34m" : "",
  cyan: isTTY ? "\x1b[36m" : "",
  gray: isTTY ? "\x1b[90m" : "",
};

function printHelp() {
  console.log(`
${c.bold}${c.cyan}SharedNotes CLI${c.reset} - CLI tool to interact with Cloudflare SharedNotes service

${c.bold}USAGE${c.reset}
  $ ${c.green}sharednotes${c.reset} <command> [options]

${c.bold}COMMANDS${c.reset}
  ${c.green}health${c.reset}                     Check service health
  ${c.green}list${c.reset}, ${c.green}ls${c.reset}                 List notes (active by default, returns snippet preview)
  ${c.green}get${c.reset} <id>                  Display note details and full body
  ${c.green}create${c.reset}, ${c.green}add${c.reset}               Create a new note
  ${c.green}edit${c.reset}, ${c.green}update${c.reset} <id>          Update note title, body, and/or snippet
  ${c.green}archive${c.reset} <id>              Archive a note
  ${c.green}unarchive${c.reset} <id>            Unarchive a note
  ${c.green}delete${c.reset}, ${c.green}rm${c.reset} <id>            Soft-delete a note
  ${c.green}restore${c.reset} <id>              Restore a deleted note (admin only)
  ${c.green}whoami${c.reset}                    Display current connection and auth status

${c.bold}OPTIONS${c.reset}
  ${c.yellow}--status${c.reset}=<status>         Filter notes by status: active, archived, deleted, all (list)
  ${c.yellow}--since${c.reset}=<timestamp>       Delta sync: list items updated after timestamp (ISO-8601)
  ${c.yellow}-q, --query${c.reset}=<text>       Search query across titles, snippets, and bodies
  ${c.yellow}--full${c.reset}                     Include full body in list response (default: snippets only)
  ${c.yellow}--limit${c.reset}=<number>          Limit number of returned notes (default 50)
  ${c.yellow}-t, --title${c.reset}=<text>        Note title (create / edit)
  ${c.yellow}-b, --body${c.reset}=<text>         Note body (create / edit)
  ${c.yellow}-s, --snippet${c.reset}=<text>      Custom snippet override (first 150ch of body by default)
  ${c.yellow}--permanent${c.reset}              Hard-delete permanently (admin only)
  ${c.yellow}--as${c.reset}=<admin|user>        Select key profile from .env (default: admin or user)
  ${c.yellow}--key${c.reset}=<api-key>          Explicit API key override
  ${c.yellow}--url${c.reset}=<url>              Worker endpoint URL (defaults to WORKER_URL in .env)
  ${c.yellow}--json${c.reset}                   Output raw JSON response
  ${c.yellow}-h, --help${c.reset}               Show this help message

${c.bold}EXAMPLES${c.reset}
  $ sharednotes ls
  $ sharednotes ls -q "grocery"
  $ sharednotes ls --since="2026-10-30T12:00:00Z"
  $ sharednotes ls --full
  $ sharednotes ls --status=archived
  $ sharednotes ls --status=deleted --as=admin
  $ sharednotes create -t "Todo" -b "Buy milk"
  $ sharednotes get 123e4567-e89b-12d3-a456-426614174000
  $ sharednotes archive 123e4567-e89b-12d3-a456-426614174000
  $ sharednotes rm 123e4567-e89b-12d3-a456-426614174000
  $ sharednotes restore 123e4567-e89b-12d3-a456-426614174000 --as=admin
`);
}

function parseCliArgs(args) {
  const parsed = {
    command: "",
    positionals: [],
    flags: {},
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-h" || arg === "--help") {
      parsed.flags.help = true;
    } else if (arg === "--json") {
      parsed.flags.json = true;
    } else if (arg === "--permanent") {
      parsed.flags.permanent = true;
    } else if (arg === "--full") {
      parsed.flags.full = true;
    } else if (arg.startsWith("--as=")) {
      parsed.flags.as = arg.slice(5);
    } else if (arg === "--as" && i + 1 < args.length) {
      parsed.flags.as = args[++i];
    } else if (arg.startsWith("--url=")) {
      parsed.flags.url = arg.slice(6);
    } else if (arg === "--url" && i + 1 < args.length) {
      parsed.flags.url = args[++i];
    } else if (arg.startsWith("--key=")) {
      parsed.flags.key = arg.slice(6);
    } else if (arg === "--key" && i + 1 < args.length) {
      parsed.flags.key = args[++i];
    } else if (arg.startsWith("--status=")) {
      parsed.flags.status = arg.slice(9);
    } else if (arg === "--status" && i + 1 < args.length) {
      parsed.flags.status = args[++i];
    } else if (arg.startsWith("--since=")) {
      parsed.flags.since = arg.slice(8);
    } else if (arg === "--since" && i + 1 < args.length) {
      parsed.flags.since = args[++i];
    } else if (arg.startsWith("-q=") || arg.startsWith("--query=")) {
      parsed.flags.query = arg.slice(arg.indexOf("=") + 1);
    } else if ((arg === "-q" || arg === "--query") && i + 1 < args.length) {
      parsed.flags.query = args[++i];
    } else if (arg.startsWith("--limit=")) {
      parsed.flags.limit = arg.slice(8);
    } else if (arg === "--limit" && i + 1 < args.length) {
      parsed.flags.limit = args[++i];
    } else if (arg.startsWith("-t=") || arg.startsWith("--title=")) {
      parsed.flags.title = arg.slice(arg.indexOf("=") + 1);
    } else if ((arg === "-t" || arg === "--title") && i + 1 < args.length) {
      parsed.flags.title = args[++i];
    } else if (arg.startsWith("-b=") || arg.startsWith("--body=")) {
      parsed.flags.body = arg.slice(arg.indexOf("=") + 1);
    } else if ((arg === "-b" || arg === "--body") && i + 1 < args.length) {
      parsed.flags.body = args[++i];
    } else if (arg.startsWith("-s=") || arg.startsWith("--snippet=")) {
      parsed.flags.snippet = arg.slice(arg.indexOf("=") + 1);
    } else if ((arg === "-s" || arg === "--snippet") && i + 1 < args.length) {
      parsed.flags.snippet = args[++i];
    } else if (arg.startsWith("-")) {
      console.warn(`${c.yellow}Unknown option: ${arg}${c.reset}`);
    } else if (!parsed.command) {
      parsed.command = arg.toLowerCase();
    } else {
      parsed.positionals.push(arg);
    }
  }

  return parsed;
}

// Resolve configuration
function resolveConfig(flags) {
  const url = (
    flags.url ||
    process.env.WORKER_URL ||
    process.env.API_URL ||
    "https://sharednotes.<your-subdomain>.workers.dev"
  ).replace(/\/+$/, "");

  let key = flags.key;
  let role = flags.as;

  if (!key) {
    if (role === "admin") {
      key = process.env.TEST_ADMIN_KEY || process.env.ADMIN_KEY || process.env.API_KEY;
    } else if (role === "user") {
      key = process.env.TEST_USER_KEY || process.env.USER_KEY || process.env.API_KEY;
    } else {
      key =
        process.env.API_KEY ||
        process.env.TEST_ADMIN_KEY ||
        process.env.TEST_USER_KEY;
    }
  }

  return { url, key, json: Boolean(flags.json) };
}

async function apiRequest(config, endpoint, options = {}) {
  const fullUrl = `${config.url}${endpoint}`;
  const headers = { ...options.headers };

  if (config.key) {
    headers["Authorization"] = `Bearer ${config.key}`;
  }

  if (options.body && typeof options.body === "object") {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(options.body);
  }

  try {
    const res = await fetch(fullUrl, { ...options, headers });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    return {
      status: res.status,
      ok: res.ok,
      data,
    };
  } catch (err) {
    console.error(`${c.red}Network error connecting to ${fullUrl}:${c.reset}`, err.message);
    process.exit(1);
  }
}

function formatDate(isoString) {
  if (!isoString) return "";
  try {
    const d = new Date(isoString);
    return d.toLocaleString();
  } catch {
    return isoString;
  }
}

async function main() {
  const { command, positionals, flags } = parseCliArgs(process.argv.slice(2));

  if (flags.help || (!command && positionals.length === 0)) {
    printHelp();
    return;
  }

  const config = resolveConfig(flags);

  switch (command) {
    case "health": {
      const res = await apiRequest(config, "/health");
      if (config.json) {
        console.log(JSON.stringify(res.data, null, 2));
      } else if (res.ok && res.data?.ok) {
        console.log(`${c.green}✔ Service healthy!${c.reset} [${config.url}]`);
      } else {
        console.log(`${c.red}✖ Service unhealthy:${c.reset}`, res.data);
      }
      break;
    }

    case "whoami": {
      console.log(`${c.bold}Endpoint:${c.reset} ${config.url}`);
      console.log(
        `${c.bold}API Key:${c.reset}  ${
          config.key ? `${config.key.slice(0, 8)}... (configured)` : `${c.red}None configured${c.reset}`
        }`
      );
      if (!config.key) {
        console.log(`${c.yellow}Tip: set API_KEY in .env or pass --key=<key> or --as=admin|user${c.reset}`);
        return;
      }
      const testRes = await apiRequest(config, "/notes?limit=1");
      if (testRes.status === 401) {
        console.log(`${c.red}Auth:     Invalid credentials (401 Unauthorized)${c.reset}`);
      } else if (testRes.ok) {
        console.log(`${c.green}Auth:     Authenticated successfully!${c.reset}`);
      } else {
        console.log(`${c.yellow}Auth:     Response status ${testRes.status}${c.reset}`);
      }
      break;
    }

    case "list":
    case "ls": {
      const queryParams = new URLSearchParams();
      if (flags.status) queryParams.set("status", flags.status);
      if (flags.limit) queryParams.set("limit", flags.limit);
      if (flags.since) queryParams.set("since", flags.since);
      if (flags.query) queryParams.set("q", flags.query);
      if (flags.full) queryParams.set("full", "true");

      const qs = queryParams.toString();
      const endpoint = `/notes${qs ? `?${qs}` : ""}`;
      const res = await apiRequest(config, endpoint);

      if (!res.ok) {
        if (config.json) {
          console.log(JSON.stringify(res.data, null, 2));
        } else {
          console.error(`${c.red}Error (${res.status}):${c.reset}`, res.data?.error || res.data?.message || res.data);
          if (res.status === 403) {
            console.error(`${c.yellow}Hint: viewing deleted notes requires an admin key (--as=admin).${c.reset}`);
          }
        }
        process.exit(1);
      }

      if (config.json) {
        console.log(JSON.stringify(res.data, null, 2));
        return;
      }

      const notes = res.data?.notes || [];
      if (notes.length === 0) {
        console.log(`${c.dim}No notes found.${c.reset}`);
        return;
      }

      const filters = [];
      if (flags.status) filters.push(`status: ${flags.status}`);
      if (flags.query) filters.push(`query: "${flags.query}"`);
      if (flags.since) filters.push(`since: ${flags.since}`);
      const filterStr = filters.length > 0 ? ` [${filters.join(", ")}]` : "";

      console.log(`${c.bold}Found ${notes.length} note(s)${filterStr}:${c.reset}\n`);

      for (const note of notes) {
        let tag = "";
        if (note.is_deleted) {
          tag = ` ${c.red}[DELETED]${c.reset}`;
        } else if (note.is_archived) {
          tag = ` ${c.yellow}[ARCHIVED]${c.reset}`;
        }

        console.log(`  ${c.cyan}${note.id}${c.reset}${tag}`);
        console.log(`  ${c.bold}${note.title || "(Untitled)"}${c.reset}`);

        const textContent = flags.full ? (note.body || note.snippet) : note.snippet;
        if (textContent) {
          const preview = textContent.replace(/\n/g, " ");
          const shortText = (!flags.full && preview.length > 90) ? preview.slice(0, 87) + "..." : preview;
          console.log(`  ${c.dim}${shortText}${c.reset}`);
        }
        console.log(
          `  ${c.gray}by ${note.created_by || "unknown"} • updated ${formatDate(note.updated_at)}${c.reset}\n`
        );
      }
      break;
    }

    case "get": {
      const id = positionals[0];
      if (!id) {
        console.error(`${c.red}Error: Note ID required. Example: sharednotes get <id>${c.reset}`);
        process.exit(1);
      }

      const res = await apiRequest(config, `/notes/${encodeURIComponent(id)}`);
      if (!res.ok) {
        if (config.json) {
          console.log(JSON.stringify(res.data, null, 2));
        } else {
          console.error(`${c.red}Error (${res.status}):${c.reset}`, res.data?.error || "Note not found");
        }
        process.exit(1);
      }

      if (config.json) {
        console.log(JSON.stringify(res.data, null, 2));
        return;
      }

      const note = res.data;
      let tag = "";
      if (note.is_deleted) tag = ` ${c.red}[DELETED]${c.reset}`;
      else if (note.is_archived) tag = ` ${c.yellow}[ARCHIVED]${c.reset}`;

      console.log(`\n${c.bold}${c.cyan}${note.title || "(Untitled)"}${c.reset}${tag}`);
      console.log(`${c.gray}ID:         ${note.id}`);
      console.log(`Created by: ${note.created_by}`);
      console.log(`Created at: ${formatDate(note.created_at)}`);
      console.log(`Updated at: ${formatDate(note.updated_at)}${c.reset}`);
      if (note.snippet && note.snippet !== note.body?.slice(0, 150)) {
        console.log(`${c.gray}Snippet:    ${note.snippet}${c.reset}`);
      }
      console.log("\n" + "─".repeat(60));
      console.log(note.body || `${c.dim}(No content)${c.reset}`);
      console.log("─".repeat(60) + "\n");
      break;
    }

    case "create":
    case "add":
    case "new": {
      let title = flags.title || positionals[0] || "";
      let body = flags.body || positionals[1] || "";
      let snippet = flags.snippet;

      if (!title && !body && !snippet) {
        console.error(`${c.red}Error: Note title or body required.${c.reset}`);
        console.error(`Usage: sharednotes create -t "Title" -b "Body" [-s "Custom snippet"]`);
        process.exit(1);
      }

      const payload = { title, body };
      if (snippet) payload.snippet = snippet;

      const res = await apiRequest(config, "/notes", {
        method: "POST",
        body: payload,
      });

      if (!res.ok) {
        console.error(`${c.red}Error creating note (${res.status}):${c.reset}`, res.data);
        process.exit(1);
      }

      if (config.json) {
        console.log(JSON.stringify(res.data, null, 2));
      } else {
        console.log(`${c.green}✔ Note created successfully!${c.reset}`);
        console.log(`ID:      ${c.cyan}${res.data.id}${c.reset}`);
        console.log(`Title:   ${res.data.title}`);
        console.log(`Snippet: ${c.dim}${res.data.snippet}${c.reset}`);
      }
      break;
    }

    case "edit":
    case "update": {
      const id = positionals[0];
      if (!id) {
        console.error(`${c.red}Error: Note ID required. Example: sharednotes edit <id> -t "New Title"${c.reset}`);
        process.exit(1);
      }

      const payload = {};
      if (flags.title !== undefined) payload.title = flags.title;
      if (flags.body !== undefined) payload.body = flags.body;
      if (flags.snippet !== undefined) payload.snippet = flags.snippet;

      if (Object.keys(payload).length === 0) {
        console.error(`${c.yellow}Nothing to update. Specify -t "Title", -b "Body", and/or -s "Snippet"${c.reset}`);
        process.exit(1);
      }

      const res = await apiRequest(config, `/notes/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: payload,
      });

      if (!res.ok) {
        console.error(`${c.red}Error updating note (${res.status}):${c.reset}`, res.data);
        process.exit(1);
      }

      if (config.json) {
        console.log(JSON.stringify(res.data, null, 2));
      } else {
        console.log(`${c.green}✔ Note updated successfully!${c.reset}`);
      }
      break;
    }

    case "archive": {
      const id = positionals[0];
      if (!id) {
        console.error(`${c.red}Error: Note ID required. Example: sharednotes archive <id>${c.reset}`);
        process.exit(1);
      }
      const res = await apiRequest(config, `/notes/${encodeURIComponent(id)}/archive`, {
        method: "POST",
      });
      if (!res.ok) {
        console.error(`${c.red}Error archiving note (${res.status}):${c.reset}`, res.data);
        process.exit(1);
      }
      if (config.json) {
        console.log(JSON.stringify(res.data, null, 2));
      } else {
        console.log(`${c.green}✔ Note archived!${c.reset} [${id}]`);
      }
      break;
    }

    case "unarchive": {
      const id = positionals[0];
      if (!id) {
        console.error(`${c.red}Error: Note ID required. Example: sharednotes unarchive <id>${c.reset}`);
        process.exit(1);
      }
      const res = await apiRequest(config, `/notes/${encodeURIComponent(id)}/unarchive`, {
        method: "POST",
      });
      if (!res.ok) {
        console.error(`${c.red}Error unarchiving note (${res.status}):${c.reset}`, res.data);
        process.exit(1);
      }
      if (config.json) {
        console.log(JSON.stringify(res.data, null, 2));
      } else {
        console.log(`${c.green}✔ Note unarchived!${c.reset} [${id}]`);
      }
      break;
    }

    case "delete":
    case "rm": {
      const id = positionals[0];
      if (!id) {
        console.error(`${c.red}Error: Note ID required. Example: sharednotes rm <id>${c.reset}`);
        process.exit(1);
      }

      const qs = flags.permanent ? "?permanent=true" : "";
      const res = await apiRequest(config, `/notes/${encodeURIComponent(id)}${qs}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        console.error(`${c.red}Error deleting note (${res.status}):${c.reset}`, res.data);
        if (res.status === 403 && flags.permanent) {
          console.error(`${c.yellow}Hint: permanent deletion requires an admin key (--as=admin).${c.reset}`);
        }
        process.exit(1);
      }

      if (flags.permanent) {
        console.log(`${c.red}✔ Note permanently deleted.${c.reset} [${id}]`);
      } else {
        console.log(`${c.green}✔ Note soft-deleted.${c.reset} [${id}] (Admins can restore it)`);
      }
      break;
    }

    case "restore": {
      const id = positionals[0];
      if (!id) {
        console.error(`${c.red}Error: Note ID required. Example: sharednotes restore <id>${c.reset}`);
        process.exit(1);
      }

      const res = await apiRequest(config, `/notes/${encodeURIComponent(id)}/restore`, {
        method: "POST",
      });

      if (!res.ok) {
        console.error(`${c.red}Error restoring note (${res.status}):${c.reset}`, res.data);
        if (res.status === 403) {
          console.error(`${c.yellow}Hint: restoring deleted notes requires an admin key (--as=admin).${c.reset}`);
        }
        process.exit(1);
      }

      if (config.json) {
        console.log(JSON.stringify(res.data, null, 2));
      } else {
        console.log(`${c.green}✔ Note restored!${c.reset} [${id}]`);
      }
      break;
    }

    default:
      console.error(`${c.red}Unknown command:${c.reset} ${command}`);
      printHelp();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`${c.red}Unexpected error:${c.reset}`, err);
  process.exit(1);
});
