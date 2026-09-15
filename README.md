# Codebase AI

**AI code intelligence for any Git repository.** Codebase AI parses a repository into functions, classes, API routes and a dependency graph. It indexes that locally with embeddings and PostgreSQL + pgvector, then answers architecture, flow, dependency and change-impact questions with **exact file and line citations**. You can use it in the web app or inside **VS Code**.

**[Website](https://codebaseee.netlify.app)** · **[VS Code extension](#vs-code-extension)** · **[Project analysis](docs/PROJECT_ANALYSIS.md)** · **[Quick start](#quick-start)**

---

## What you can ask

> *Where is authentication handled?*
> *How does a user registration request flow through the system?*
> *What would be affected if I changed `createUser`?*
> *Show me all API routes.* · *Explain the architecture.* · *What should I understand first as a new developer?*

Every answer cites numbered sources (`[S1]`, `[S2]`, …) that open the code at the exact lines. Answers say plainly when the evidence is insufficient, and any file paths that don't exist in the repository are flagged automatically.

## Highlights

- **Structure-aware indexing.** Tree-sitter parsing for TypeScript, TSX, JavaScript, Python, Java and Go. API routes are detected automatically across Express, Koa, Fastify, Hono, Next.js, FastAPI, Flask, Spring, NestJS, net/http, Gin, Echo, Chi and Fiber.
- **Hybrid retrieval.**
  - Search: pgvector semantic search, PostgreSQL full-text search over split identifiers, and exact symbol matching, fused with Reciprocal Rank Fusion.
  - Context: results are expanded through the call graph.
  - Query understanding: questions are classified by type to pick the right context.
- **Grounded answers.** Answers stream from any OpenAI-compatible LLM (OpenRouter, OpenAI, Gemini, Groq, local servers). Only the retrieved snippets are sent to the model.
- **Architecture and impact.**
  - An interactive module and file graph.
  - A dependency explorer.
  - HIGH / MEDIUM / LOW change-impact analysis with reasons.
- **Any repository source.**
  - Local folders, with no account needed.
  - Public Git URLs.
  - Private and organization GitHub repositories through a read-only GitHub App.
- **VS Code extension.** Ask questions, analyze your local workspace (including uncommitted changes), and jump from citations straight to the code.

---

## Quick start

Requirements: **Node.js 20+** and **git**.

```bash
git clone https://github.com/vidyaasagaar/codebase-ai.git
cd codebase-ai
npm install
cp .env.example .env.local   # add your LLM endpoint + API key
npm run dev
```

1. Open **http://localhost:3000**.
2. Paste a repository URL or an absolute local folder path, or pick a repository from the built-in GitHub search, then click **Analyze**.
3. Watch the live analysis. When it finishes, the Overview, Ask AI, Architecture, Files, API Routes and Dependencies & Impact pages all open.

The embedding model (~35 MB) downloads once into `.data/models` on first use. No database server or Docker is required; the database is embedded PostgreSQL (PGlite) stored in `.data/`.

### Minimal `.env.local`

```bash
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_API_KEY=sk-or-...
LLM_MODEL=openai/gpt-5.6-luna
LLM_FALLBACK_MODELS=cohere/north-mini-code:free
```

Without an LLM key, indexing, search, graphs and impact analysis still work, and chat shows the retrieved evidence instead of a written answer.

---

## VS Code extension

The extension brings Codebase AI into your editor. It connects to your Codebase AI server and reuses the same index, retrieval and grounded answers.

### Install

```bash
cd extension
npm install
npm run compile
```

- **Run it from source:** open the `extension/` folder in VS Code and press **F5** (*Run Codebase AI Extension*).
- **Install it permanently:** `npx @vscode/vsce package`, then *Extensions → … → Install from VSIX*.
- **Point it at a server:** set `codebaseAI.serverUrl` (default `http://localhost:3000`) if your server runs elsewhere.

### Commands

| Command | What it does |
|---|---|
| **Codebase AI: Ask About This Codebase** | Chat panel with streaming answers. Citations open the file at the cited lines in your editor. |
| **Codebase AI: Analyze Repository** | Indexes the open folder locally, including uncommitted changes, with no account needed. If the folder has a GitHub remote you can choose the GitHub copy instead. |
| **Codebase AI: Select Repository** | Links this window to any Codebase AI project, including your private GitHub projects when signed in. |
| **Codebase AI: Re-index Repository** | Rebuilds the linked project's index. |
| **Codebase AI: Sign In / Sign Out** | Browser-based sign-in to your Codebase AI account. |
| **Codebase AI: Connect GitHub** | Opens GitHub sign-in in the web app. |
| **Codebase AI: Open Dashboard** | Opens the linked project in the web app. |

### How it fits together

- **Works offline from GitHub.** Local folders, GitLab, Bitbucket, self-hosted Git and uncommitted projects are analyzed straight from disk.
- **Recognizes your workspace.** The extension reads the folder's `origin` remote (read-only; it never changes your git config). Remotes like `git@github.com:owner/repo.git` or `https://github.com/owner/repo.git` link to the matching project automatically.
- **Status bar.** Shows the linked project, its visibility and indexing status. Click it to ask a question.
- **Secure sign-in.**
  - *Sign In* opens the browser, where you continue with GitHub and click **Authorize VS Code**.
  - VS Code receives a one-time code through its own URI handler, bound to a state value the extension generated.
  - It exchanges that code for a Codebase AI session token, stored in VS Code **SecretStorage**.
  - Your GitHub token never leaves the server.
- **Web → VS Code.** **Open in VS Code** on a project's overview page opens the project in your editor. If it isn't open locally, the extension offers to clone it (with your own Git credentials), open a folder, or ask questions without a local copy.
- **VS Code → Web.** *Open Dashboard* opens the linked project in the web app.

---

## Private and organization repositories (GitHub)

Signing in is optional. It unlocks private and organization repositories through a **GitHub App with read-only permissions**, so Codebase AI can never push code, delete repositories or change settings.

1. **Create the app.** GitHub → **Settings → Developer settings → GitHub Apps → New GitHub App**:
   - **Homepage URL:** your Codebase AI URL (e.g. `http://localhost:3000`).
   - **Callback URL:** `<your URL>/api/auth/github/callback`.
   - **Webhook:** uncheck *Active*.
   - **Repository permissions:** **Contents: Read-only** (Metadata: Read-only is added automatically).
   - **Where can this GitHub App be installed:** *Any account* if you need organization repositories.
2. **Configure the server.** Generate a client secret and add to `.env.local`:
   ```bash
   GITHUB_CLIENT_ID=Iv1....
   GITHUB_CLIENT_SECRET=...
   GITHUB_CALLBACK_URL=http://localhost:3000/api/auth/github/callback
   GITHUB_APP_SLUG=your-app-slug
   ```
3. **Install the app** on your account or organization and choose repositories: `https://github.com/apps/<slug>/installations/new`.
4. **Sign in.** Restart, then click **Continue with GitHub**. **Your repositories** lists every repository GitHub authorizes for you, marked Private/Public and Organization/Personal. Click **Analyze** on one.

How access is enforced:
- **GitHub decides who can read an index.** Opening an indexed private repository re-checks access with GitHub, so collaborators work and revoked access is enforced.
- **Tokens stay on the server.** GitHub tokens are encrypted at rest (AES-256-GCM) and never sent to the browser or the extension.
- **Clones never store the token.** Private repositories are cloned with a one-time credential passed through git's environment config; it never appears in URLs, `.git/config` or process arguments.
- **Disconnect cleans up.** *Disconnect GitHub* revokes the token and removes the connection and every session.

---

## Configuration

| Variable | Purpose |
|---|---|
| `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` | Any OpenAI-compatible Chat Completions endpoint |
| `LLM_FALLBACK_MODELS` | OpenRouter fallback models (errors, rate limits, credits) |
| `LLM_MAX_TOKENS`, `MAX_CONTEXT_CHARS` | Answer length cap and retrieved-context budget |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_CALLBACK_URL`, `GITHUB_APP_SLUG` | GitHub App sign-in for private and organization repositories |
| `GITHUB_TOKEN` | Optional; raises limits for public GitHub API calls |
| `CODEBASE_AI_SECRET` | Optional encryption key for stored tokens (otherwise generated into `.data/secret.key`) |
| `CODEBASE_AI_DATA_DIR` | Optional data directory (database, clones, model cache) |
| `CODEBASE_AI_MODE` | `full` or `hosted`; auto-detected by default |
| `NEXT_PUBLIC_SITE_URL` | Public URL used for canonical links and the sitemap |

---

## Deployment

Indexing needs a **long-running Node.js process with Git and persistent disk**: your machine, a VM, or any host that runs `npm run build && npm start` with a persistent volume.

Serverless platforms such as Netlify and Vercel freeze functions after every response and reset their storage. Codebase AI detects this and runs as a **hosted preview**: the site, product pages and GitHub search work, while analysis shows a clear message pointing to local or self-hosted use. The website at [codebaseee.netlify.app](https://codebaseee.netlify.app) runs in this preview mode.

---

## How it works

```
Repository (local folder · Git URL · GitHub)
  → discovery (skips vendor, build output, lockfiles)
  → Tree-sitter parsing → functions, classes, components, models, routes, imports, calls
  → dependency graph (import + call resolution)
  → local embeddings (bge-small-en-v1.5) + weighted full-text vectors
  → PostgreSQL + pgvector

Question
  → query classification → hybrid retrieval (vector + full-text + symbol, RRF)
  → metadata filtering → call-graph expansion → numbered evidence
  → LLM (streamed, citation-constrained) → grounding verification
```

The full breakdown lives in **[docs/PROJECT_ANALYSIS.md](docs/PROJECT_ANALYSIS.md)**: architecture diagrams, the ingestion pipeline with measured results on real repositories, retrieval parameters, data model, API reference, security review, test results, limitations and roadmap.

## Project structure

```
app/            Next.js pages (landing, /repo/[id]/{chat,architecture,files,routes,impact}, /extension/auth) and API routes
components/     repository shell, Monaco code viewer, GitHub account controls
lib/db          PGlite + pgvector schema (additive migrations)
lib/repository  repository sources (local / git / GitHub), GitHub API client, discovery, ingestion
lib/parser      Tree-sitter entity extraction
lib/graph       import and call resolution
lib/embeddings  local embedding model
lib/retrieval   query classification, hybrid search, dependencies, impact, architecture graphs
lib/ai          OpenAI-compatible streaming client, grounded answer pipeline
lib/auth        GitHub sign-in, encryption, sessions, repository access control
extension/      VS Code extension
tests/          unit and integration tests
docs/           project analysis
```

## Security and privacy

- **Local processing.** Parsing, embeddings and the vector index run where Codebase AI runs. Only retrieved snippets reach the LLM provider.
- **Read-only GitHub access.** Private-repository indexes are listed only for their owner and re-verified with GitHub on access.
- **Tokens and sessions.** Tokens are encrypted at rest; browser and extension sessions are random tokens stored only as SHA-256 hashes; nothing sensitive is logged.
- **Deletion.** Deleting a project removes its clone, entities, embeddings and dependency graph.
- **Shared networks.** `next dev` listens on your network address; run `next dev -H 127.0.0.1` so only your machine can reach the API.

## Testing

```bash
npm test          # unit + integration tests (node:test via tsx)
npx tsc --noEmit  # type check
npm run lint
npm run build
```

The tests cover:
- URL and remote parsing.
- Token encryption and tamper detection.
- Redirect guards.
- Git credential isolation.
- Sessions, and GitHub-decided access to private repositories: collaborator, revoked and expired token.
- The VS Code sign-in handoff: single-use codes, state binding, token isolation.
- Hosted-preview behavior.

The extension also ships a smoke test that runs inside a real VS Code extension host.

## Roadmap

- **Faster re-indexing:** incremental re-indexing by commit SHA, plus GitHub webhooks.
- **Retrieval evaluation:** a benchmark set with recall@k tracking.
- **Precise call graphs:** symbol resolution via LSP/SCIP indexes.
- **More sources:** GitLab and Bitbucket.
- **Team deployments:** hosted indexing workers and a PostgreSQL server mode.
- **Distribution:** publish the extension to the VS Code Marketplace.
