# Codebase AI — Codebase RAG Assistant

Paste a Git repository URL. Codebase AI clones it, parses it into functions, classes, routes and dependencies with Tree-sitter, indexes it in PostgreSQL + pgvector, and answers natural-language questions with exact, clickable source citations.

## Quick start

```bash
npm install
cp .env.example .env.local   # then fill in LLM_API_KEY
npm run dev
```

Open http://localhost:3000, paste a repository (e.g. `https://github.com/gothinkster/node-express-realworld-example-app`) and click **Analyze**.

Requirements: Node 20+, `git` on PATH. No database or Docker needed. The embedding model (~35 MB) downloads on first index into `.data/models`.

### LLM configuration (`.env.local`)

Any OpenAI-compatible Chat Completions endpoint works. The default setup is OpenRouter:

```
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_API_KEY=sk-or-...
LLM_MODEL=openai/gpt-5.6-luna                       # fast, grounded, ~$0.003 per question
LLM_FALLBACK_MODELS=cohere/north-mini-code:free     # OpenRouter falls back automatically (errors, rate limits, credits)
LLM_MAX_TOKENS=2000                                 # cap on answer length (keeps credit reservations small)
MAX_CONTEXT_CHARS=24000                             # retrieved code sent per question
```

| Provider | `LLM_BASE_URL` | `LLM_MODEL` example |
|---|---|---|
| OpenRouter | `https://openrouter.ai/api/v1` | `openai/gpt-5.6-luna`, `google/gemini-3.8-flash`, `anthropic/claude-sonnet-5` |
| Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.5-flash` |
| Groq | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` |

`LLM_FALLBACK_MODELS` is OpenRouter-specific; leave it empty for other providers. Without a key, indexing, search, the graph, and impact analysis all still work, and chat returns the retrieved evidence instead of a written answer.

Free OpenRouter models may be served by providers that log prompts. For sensitive code, use a paid model with a no-logging provider policy.

### GitHub integration

- The landing page searches real repositories through the GitHub search API. It defaults to popular RealWorld apps, with a language filter matching the supported parsers.
- Submitting a GitHub URL, including `/tree/<branch>` links, first checks the GitHub API that the repository exists and is accessible. It also rejects repositories over 250 MB and uses the default branch unless you pick one.
- Repository metadata (description, stars, topics) is shown on the overview.
- Unauthenticated limits are 60 requests/hour and 10 searches/minute. Add `GITHUB_TOKEN` (no scopes needed) to `.env.local` for more.

### GitHub sign-in (private and organization repositories)

Signing in is optional. Public repositories, Git URLs and local folders keep working without it.

Codebase AI uses a **GitHub App** rather than a classic OAuth App. Classic OAuth Apps can only read private repositories through the `repo` scope, which also grants push access. A GitHub App can be limited to read-only permissions.

1. Go to GitHub → **Settings → Developer settings → GitHub Apps → New GitHub App**.
   - **Homepage URL:** `http://localhost:3000`
   - **Callback URL:** `http://localhost:3000/api/auth/github/callback`
   - **Webhook:** uncheck *Active*.
   - **Repository permissions:** *Contents: Read-only* (*Metadata: Read-only* is added automatically). Grant nothing else.
   - **Where can this GitHub App be installed:** *Any account* if you need organization repositories.
2. Generate a **client secret**, then add these to `.env.local`:
   ```
   GITHUB_CLIENT_ID=Iv1....
   GITHUB_CLIENT_SECRET=...
   GITHUB_CALLBACK_URL=http://localhost:3000/api/auth/github/callback
   GITHUB_APP_SLUG=<the app's URL name>
   ```
3. **Install** the app on your account or organization and pick repositories: `https://github.com/apps/<slug>/installations/new`. Organization owners may need to approve it.
4. Restart the server and click **Continue with GitHub**. **Your repositories** lists everything GitHub authorizes for you: private and public, personal and organization. Click **Analyze** to index a repository with the existing pipeline.

How access works:
- GitHub remains the source of truth for access. Opening an indexed private repository re-checks your access with GitHub (cached for 5 minutes). Revoked access, expired authorization and missing sign-in each show a clear message.
- Private repositories are cloned with the user's token, passed to git as a one-time HTTP header through environment config. The token is never in the clone URL, `.git/config`, the process arguments or a credential helper.
- **Re-index** on the overview fetches the latest commit and rebuilds the index.
- **Disconnect GitHub** in the account menu revokes the token and removes the connection and all sessions.

## How it works

```
Repository URL
  → git clone --depth 1
  → file discovery (skips vendor/build/lockfiles/minified)
  → Tree-sitter AST parsing (TS, TSX, JS, Python, Java, Go)
      functions · methods · classes · interfaces · React components · data models
      API routes (Express/Fastify/Koa, Next.js route handlers, FastAPI/Flask, Spring, NestJS, Go routers)
      imports · call sites
  → dependency graph (import resolution + call resolution scoped by same file → imported files → unique global)
  → local embeddings (bge-small-en-v1.5, 384d) + weighted full-text vectors on split identifiers
  → PostgreSQL + pgvector (PGlite, stored in .data/pg)
```

Other files (docs, config, unsupported languages) are indexed as small text chunks, so they remain searchable.

**Question answering**

1. **Query understanding.** The question is classified as location, flow, dependency, impact, implementation, debugging, architecture, or routes.
2. **Hybrid retrieval.** Results from pgvector cosine search, Postgres full-text search, and exact symbol-name matching are combined with Reciprocal Rank Fusion. Metadata filters then down-weight docs for code questions and down-weight tests and generated code.
3. **Dependency expansion.** The callers and callees of the top hits are added to the context.
4. **Question-specific context.**
   - Impact and dependency questions resolve the target symbol and traverse the call graph (HIGH, MEDIUM, and LOW by hop distance).
   - Architecture questions include module statistics.
   - Routes questions include the route index.
5. **Grounded generation.** Evidence is numbered `[S1]…[Sn]` with file paths and line numbers. The model must cite sources, admit missing evidence, and separate what the code shows from what it infers.
6. **Hallucination guard.** After the answer streams, file paths that don't exist in the repository and citations to non-existent sources are flagged in the UI.

## Features

- **Overview:** languages, frameworks, entry points, largest and most-connected modules, complex files, tailored starter questions, and repository deletion.
- **Ask AI:** streaming answers with clickable `[S#]` citations and `path:lines` references that open the code viewer at the exact lines. Also shows the evidence strength and query type.
- **Architecture:** interactive module graph (zoom, pan, search, click to highlight dependencies and dependents). Double-click a module to drill into its files.
- **Files:** file tree, Monaco viewer with line highlighting, symbol outline, go-to-symbol, and a dependency explorer (depends on, used by, importers).
- **API Routes:** every detected endpoint with its source.
- **Dependencies & Impact:** change-impact analysis with reasons, plus "Explain impact with AI".

## VS Code extension

The extension lives in [`extension/`](extension). It talks to your Codebase AI server (`codebaseAI.serverUrl`, default `http://localhost:3000`) and reuses the same index, retrieval and answers.

```bash
cd extension && npm install && npm run compile
```

Open the `extension` folder in VS Code and press **F5** (*Run Codebase AI Extension*). To install it permanently, package it with `npx @vscode/vsce package`.

| Command | What it does |
|---|---|
| Codebase AI: Ask About This Codebase | Opens the chat panel. Answers stream in, and citations open the file at the cited lines in your editor. |
| Codebase AI: Analyze Repository | Indexes the open folder locally (includes uncommitted changes, no account needed). If the folder has a GitHub remote, you can choose the GitHub copy instead. |
| Codebase AI: Select Repository | Links this window to any Codebase AI project, including your private GitHub projects when signed in. |
| Codebase AI: Re-index Repository | Rebuilds the linked project's index. |
| Codebase AI: Sign In / Sign Out | Signs in through the browser (see below). |
| Codebase AI: Connect GitHub | Opens GitHub sign-in in the web app. |
| Codebase AI: Open Dashboard | Opens the linked project in the web app. |

**Local workspaces work without signing in.** GitLab, Bitbucket, self-hosted Git and uncommitted projects are analyzed from the folder on disk.

How the extension connects:
- **Recognizing projects:** the extension reads the folder's `origin` remote (read-only) and normalizes `git@github.com:owner/repo.git` and `https://github.com/owner/repo.git`. It links the workspace to a matching local-path or GitHub project automatically.
- **Sign-in:** *Sign In* opens `/extension/auth` in the browser, where you continue with GitHub if needed and click **Authorize VS Code**. The server issues a one-time, 5-minute code, delivered only to `vscode://codebase-ai.codebase-ai/auth` and bound to a random state the extension generated. The extension exchanges it for a Codebase AI session token and stores it in VS Code SecretStorage. The GitHub token never leaves the server.
- **Web → VS Code:** **Open in VS Code** on the overview opens `vscode://codebase-ai.codebase-ai/project?id=<id>`. The extension links the matching open folder. Otherwise it offers to clone (using VS Code's Git and your own credentials), open a folder, or ask questions without a local copy.
- **VS Code → Web:** *Open Dashboard* opens the linked project in the web app.

## API

```
GET    /api/auth/github/login?returnTo=           start GitHub sign-in (CSRF state cookie)
GET    /api/auth/github/callback                  GitHub redirect target → httpOnly session cookie
GET    /api/auth/session                          current user (cookie or Bearer), never tokens
POST   /api/auth/logout                           { disconnect? } end session / revoke GitHub connection
GET    /api/github/repositories                   repositories the signed-in user may access + index status
POST   /api/extension/authorize                   { state, redirectUri } one-time code for the VS Code extension
POST   /api/extension/token                       { code, state } → extension session token
POST   /api/repositories/:id/index                manual re-index
GET    /api/github/search?q=&language=           real repositories from the GitHub search API
POST   /api/repositories                         { url, branch? } | { github: "owner/repo" } → { id }   (GitHub repos validated via GitHub API; indexing runs in background)
GET    /api/repositories                         list
GET    /api/repositories/:id                     status, progress, stats, suggested questions
DELETE /api/repositories/:id                     removes clone, entities, embeddings, graph
GET    /api/repositories/:id/files[?path=]       file list | file content + symbols
GET    /api/repositories/:id/entities[?q=|?routes=1]
GET    /api/repositories/:id/entities/:entityId  entity + dependencies
POST   /api/repositories/:id/query               { question, entityId?, history? } → NDJSON stream
GET    /api/repositories/:id/architecture[?module=]
POST   /api/repositories/:id/impact-analysis     { entityId }
```

## Project layout

```
app/                 pages (landing, /repo/[id]/{chat,architecture,files,routes,impact}) and API routes
components/          repo shell + ingestion progress, Monaco code viewer
lib/db               PGlite + pgvector schema and query helper
lib/repository       GitHub API client, repository sources (local / git / GitHub), discovery, ingestion pipeline
lib/auth             GitHub sign-in, encrypted connections, sessions, repository access control
extension/           VS Code extension (commands, URI handler, Ask panel)
tests/               npm test — parsing, security guards, auth + access + VS Code handoff integration
lib/parser           Tree-sitter entity extraction per language
lib/graph            import and call resolution
lib/embeddings       local embedding model
lib/retrieval        query classification, hybrid search, dependencies, impact, architecture graph
lib/ai               OpenAI-compatible LLM client, grounded answer pipeline
```

## Data & security

- Repositories are cloned into `.data/repos/<id>` and indexed into `.data/pg`. They persist until deleted from the UI, and deleting removes all related data (cascading deletes plus clone removal).
- Embeddings are computed locally. Only the snippets retrieved for a question go to the configured LLM.
- Source code is never written to logs.
- The file API only serves files that were indexed, and resolved paths must stay inside the clone.
- **Tokens and sessions:**
  - GitHub tokens are encrypted at rest with AES-256-GCM, using `CODEBASE_AI_SECRET` or a generated `.data/secret.key`.
  - They are never sent to the browser or the VS Code extension, and never logged.
  - Browser and extension sessions are random tokens stored only as SHA-256 hashes.
- **GitHub permissions:** repository access is read-only (Contents and Metadata). Codebase AI cannot push, delete or change settings.
- **Private repository indexes:**
  - They're listed only for the GitHub connection that indexed them.
  - Every read re-checks access with GitHub, so collaborators work and revoked access is enforced.
- **Retention:** there is no temporary server-side analysis. Indexes are stored on this machine until you delete them, so the 60-minute retention rule for temporary cloud storage does not apply.
- **Local network:** `next dev` also listens on your network address. On shared networks, run `next dev -H 127.0.0.1` so only this machine can reach the API.
- **Scope:** full re-index per repository; incremental commit-based sync is not implemented.
