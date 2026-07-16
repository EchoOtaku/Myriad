# Migration CLI

Run database migrations for Myriad backend.

## Usage

```bash
# From backend directory
cd backend

# Run all pending migrations
cargo run --manifest-path migrations/Cargo.toml

# Or create a new migration
sea-orm-cli migrate generate create_new_table
```

## Available Migrations

1. `001_initial_schema` - Core users, platforms, profiles, reports, activity events and configuration
2. `002_tapp_system` - Tapp installations, storage, widgets, quota, scheduler and shared runtime state
3. `003_brew_system` - Brew sources, items and annotations
4. `004_agent_system` - Agent tasks, memory and notification state
5. `005_federation` - Federation identities and messages
6. `006_oauth_identities` - OAuth/OIDC identity bindings
7. `007_notification_preferences` - Per-user notification preferences

The former runtime/activity migrations are folded into the owning base migrations.
Existing deployments receive missing tables, columns, indexes and quota enforcement
through the backend's independent startup schema reconciliation.

## Manual SQL Migration

Alternatively, you can apply the SQL schema directly:

```bash
psql -U myriad -d myriad -f ../database/schema.sql
```
