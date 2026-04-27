# Doomscroller

Doomscroller (sarcastic) self-hosted RSS reader that helps you cut through the noise.

* You pick your specific interests:

  * `baseball` and `volleyball` instead of `sports`
  * `rust` and `malware research` instead of `programming`
  * You can also create your own custom tags

* You mute tags you don't care about
* Articles are automatically scored for **content depth** (noise → shallow → standard → substantive → dense). Press releases, hiring ads, and marketing copy are filtered out by default.
* You naturally build a "user preference" profile by voting 👍 or 👎 on individual articles.

## Architectural Decisions

* Local-first, single-user, no telemetry, no data leaves your machine
* RSS as the main content stream. Everyone supports it — and if they don't, there is an X to RSS converter
* Web UI or bring-your-own RSS client
* No complex stochastic models, simple filtering (you see the outliers and can adjust your filters)
* SQLite for the maximum performance
* Docker-first

## How the algorithm works

Doomscroller relies on a tagging and scoring system driven by local vector embeddings:

1. **Tag Filtering:** Each incoming article is batched and embedded via `nomic-embed-text-v1.5`. The article's embedding vector is compared against a hierarchical taxonomy — 22 categories and ~750 topic tags — using a two-pass cosine similarity approach. This categorizes the feed without manual rules and disambiguates overlapping terms (like Apple the fruit versus Apple the company).

2. **Depth Scoring:** Every article is scored against five content-depth anchors (noise, shallow, standard, substantive, dense) via softmax-weighted cosine similarity. This outputs a continuous `depth_score` (0.0–1.0). Low-scoring items like press releases, hiring ads, and marketing copy skip your main feed entirely and go straight to the Noise view.

3. **Preference Scoring (Thumbs Up / Thumbs Down):** Your reading habits build a persistent "user preference vector." When you star or hide articles, the system shifts your baseline vector.

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
* **Tags:** Adjust the base taxonomy by modifying `server/src/taxonomy.ts`.
* **Jobs:** The application relies on an internal SQLite-backed job queue for everything from fetching feeds to generating tags. Check out `server/src/jobs/`.
