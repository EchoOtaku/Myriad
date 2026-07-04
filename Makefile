# Myriad Docker deployment shortcuts.
# The canonical production entrypoint is scripts/docker/deploy.sh.

.PHONY: help deploy start stop restart logs status ps pull upgrade build clean backup shell-backend shell-db shell-frontend

.DEFAULT_GOAL := help

DEPLOY := bash scripts/docker/deploy.sh

help:
	@echo "Myriad Docker Deployment Commands"
	@echo ""
	@echo "Usage: make [command]"
	@echo ""
	@echo "Available commands:"
	@echo "  deploy   - Bootstrap and start the proxy + updater stack"
	@echo "  start    - Start the stack"
	@echo "  stop     - Stop containers (volumes preserved)"
	@echo "  restart  - Restart the stack"
	@echo "  logs     - View stack logs"
	@echo "  status   - View service status and image versions"
	@echo "  pull     - Pull images pinned by .env tags"
	@echo "  upgrade  - Pull and recreate after editing .env tags"
	@echo "  build    - Build all component images locally"
	@echo "  backup   - Dump PostgreSQL into ./backups"
	@echo "  clean    - Delete containers, volumes, pgdata, state, and backups"

deploy start:
	$(DEPLOY) up

stop:
	$(DEPLOY) down

restart:
	$(DEPLOY) restart

logs:
	$(DEPLOY) logs

status ps:
	$(DEPLOY) status

pull:
	$(DEPLOY) pull

upgrade:
	$(DEPLOY) upgrade

build:
	bash scripts/docker/build-and-push.sh --all

clean:
	@echo "This will delete containers, Docker volumes, ./pgdata, ./state, and ./backups."
	@read -p "Type yes to continue: " confirm; \
	if [ "$$confirm" = "yes" ]; then \
		$(DEPLOY) down; \
		docker compose down -v; \
		rm -rf pgdata state backups; \
		echo "Cleanup complete"; \
	else \
		echo "Cancelled"; \
	fi

backup:
	@mkdir -p backups
	@ts=$$(date +%Y%m%d_%H%M%S); \
	docker compose exec -T postgres pg_dump -U myriad -d myriad > "backups/backup_$$ts.sql"; \
	echo "Backup complete: backups/backup_$$ts.sql"

shell-backend:
	docker exec -it myriad-backend sh

shell-db:
	docker exec -it myriad-postgres psql -U myriad -d myriad

shell-frontend:
	docker exec -it myriad-frontend sh
