# Doomscroller — Setup

## Quick Start

```bash
# 1. Start everything (models download automatically on first run)
make up

# 2. Open
open http://localhost:6767
```

First boot downloads ~5.3GB of models into a Docker volume. Subsequent starts are instant.

## Fever API (for mobile RSS clients)

Your Fever API key is generated on first boot and printed to logs:

```bash
docker compose logs doomscroller | grep "Fever API key"
```

Configure your RSS client:

- **Server:** `http://YOUR_IP:6767/fever/`
- **Username:** `doomscroller`
- **Password:** (the API key from logs)

Tested with: Reeder, NetNewsWire, Unread, ReadKit.

## Development

```bash
# Install dependencies
bun install

# Run server (with hot reload)
bun run dev:server

# Run web UI (Vite dev server with proxy)
bun run dev:web

# Type check
bun run check
```

## Architecture

Two containers. One SQLite file. See `CLAUDE.md` for conventions.
