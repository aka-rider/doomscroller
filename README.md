# Doomscroller

Doomscroller (sarcastic) is a self-hosted reader that cuts through the noise.

* You pick your interests:

  * `baseball` and `volleyball` not `sports`
  * `rust`, and `malware research` not `programming`
  * also, create your own

* You mute tags you don't like
* Articles are automatically scored for **content depth** (noise → shallow → standard → substantive → dense) — press releases, hiring ads, and marketing copy are filtered out by default
* You also may gradually create a "user preference" by voting 👍 or 👎 on individual articles

## Every architectural decision

* Local-first, single-user, no telemetry, no data leaves your machine
* RSS as the main content stream, everyone supports it, if not — there is an X to RSS converter
* Web UI or bring-your-own RSS client
* No complex stochastic models, few "moving parts"
* Docker-first

## How the algorithm works

Doomscroller relies on a two-axis tagging and scoring system entirely driven by local vector embeddings:

1. **Tag Filtering:** Each incoming article is batched and embedded via `nomic-embed-text-v1.5`. The article's embedding vector is compared against ~300 topic tags using cosine similarity. Strong matches are assigned to the article, automatically categorizing your feeds.

2. **Depth Scoring:** Each article is also scored against five content-depth anchor descriptions (noise, shallow, standard, substantive, dense) via softmax-weighted cosine similarity, producing a continuous `depth_score` (0.0–1.0). Low-scoring articles (press releases, hiring ads, marketing copy) are automatically hidden from Your Feed. A dedicated Noise view lets you review them.

3. **Preference Scoring (Thumbs Up / Thumbs Down):** As you read, your interactions (starring or hiding) contribute to a persistent "user preference vector". New articles are scored against this vector, allowing the system to learn what you enjoy and what you typically ignore.

## How to run

The application consists of two Docker containers (the main application and the embedding model sidecar) powered by a single SQLite database.

1. Ensure Docker is installed and running, then start the stack:

   ```bash
   make up
   # Models download automatically on first run
   ```

2. Access the web interface on your host machine:

   ```bash
   open http://localhost:6767
   ```

3. Connect your mobile RSS client over the local network:
   * Your local network IP address (e.g., `http://192.168.1.X:6767/fever/`)
   * **Username:** `doomscroller`
   * **Password:** The API key generated on first boot. Find it by running:

     ```bash
     docker compose logs doomscroller | grep "Fever API key"
     ```

## How to hack

Want to dive into the codebase and tweak it? The stack is minimal: Bun + Hono (API) and SolidJS + Vite (Web UI).

```bash
# Install dependencies
bun install

# Run server (with hot reload)
bun run dev:server

# Run web UI (Vite dev server with proxy to localhost:6767)
bun run dev:web

# Type check
bun run check
```

* **SQLite Database:** The database (with WAL mode enabled) lives at `data/doomscroller.sqlite`. You can run queries directly for metrics or debugging.
* **Tags:** Adjust the base tags by modifying the initial embedding tags setup in `server/src/tagger/batch.ts` or related files.
* **Jobs:** The application relies on an internal SQLite-backed job queue for everything from fetching feeds to generating tags. Check out `server/src/jobs/`.
