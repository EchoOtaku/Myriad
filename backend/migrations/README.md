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

1. `m20240101_000001_create_platforms` - Creates platforms table
2. `m20240101_000002_create_user_profiles` - Creates user_profiles table
3. `m20240101_000003_create_user_activities` - Creates user_activities table
4. `m20240101_000004_create_analysis_results` - Creates analysis_results table
5. `m20240101_000005_create_configurations` - Creates configurations table
6. `m20240101_000006_create_api_keys` - Creates api_keys table
7. `m20240101_000007_create_fetch_jobs` - Creates fetch_jobs table

## Manual SQL Migration

Alternatively, you can apply the SQL schema directly:

```bash
psql -U myriad -d myriad -f ../database/schema.sql
```
