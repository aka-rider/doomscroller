.PHONY: up down build logs dev clean

# Start everything — this is the only command you need
# Models are downloaded automatically on first run via the model-init container.
up:
	docker compose up --build -d
	@echo ""
	@echo "  Doomscroller running at http://localhost:6767"
	@echo "  Fever API (mobile): http://localhost:6767/fever/"
	@echo ""
	@echo "  Logs: make logs"
	@echo ""

down:
	docker compose down

build:
	docker compose build

logs:
	docker compose logs -f

# Local dev (no Docker, no LLM)
dev:
	cd server && bun install && cd ../web && bun install
	@echo "Starting server + web dev in parallel..."
	cd server && bun run dev & cd web && bun run dev & wait

clean:
	docker compose down -v
	rm -rf data/
