# Database Schema Documentation

## Overview

This directory contains the database schema for the Myriad platform. The application uses PostgreSQL as the primary database.

## Schema Design

### Core Tables

#### 1. **platforms**

Stores configuration for supported social platforms.

- `id`: Primary key
- `name`: Unique platform identifier (e.g., 'github', 'twitter')
- `display_name`: Human-readable name
- `enabled`: Whether the platform is currently active

#### 2. **user_profiles**

Stores fetched user profile data from different platforms.

- `id`: Primary key
- `platform_id`: References platforms
- `username`: Platform-specific username
- `raw_data`: Complete JSON response from platform API
- `fetched_at`: Last fetch timestamp

#### 3. **user_activities**

Stores user activities and posts across platforms.

- `id`: Primary key
- `profile_id`: References user_profiles
- `activity_type`: Type of activity (post, commit, tweet, etc.)
- `metadata`: Additional activity data (likes, stars, etc.)

#### 4. **analysis_results**

Stores AI-generated analysis results.

- `id`: Primary key
- `analysis_type`: Type of analysis performed
- `result`: JSON analysis output
- `ai_model`: Model used (gemini-2.0-flash-exp, gemini-pro, etc.)

#### 5. **configurations**

System and user configuration storage.

- `id`: Primary key
- `key`: Configuration key
- `value`: JSON configuration value
- `is_public`: Whether to expose to frontend

#### 6. **api_keys**

Encrypted storage for API keys and tokens.

- `id`: Primary key
- `service_name`: Service identifier
- `key_encrypted`: Encrypted key data
- `is_active`: Whether the key is currently valid

#### 7. **fetch_jobs**

Tracks background data fetching jobs.

- `id`: Primary key
- `platform_id`: References platforms
- `status`: Job status (pending, running, completed, failed)
- `items_fetched`: Number of items fetched

## Setup Instructions

### Using PostgreSQL directly:

```bash
# Create database
createdb myriad

# Run schema
psql myriad < schema.sql
```

### Using Docker:

```bash
docker-compose up -d postgres
docker exec -i myriad-postgres psql -U myriad -d myriad < schema.sql
```

### Using SeaORM migrations:

```bash
cd backend
sea-orm-cli migrate up
```

## Indexes

The schema includes several indexes for performance optimization:

- Platform-based queries
- Username lookups
- Activity timeline queries
- Analysis type filtering

## Future Enhancements

- [ ] Add support for user authentication and multi-user mode
- [ ] Implement data retention policies
- [ ] Add audit logging tables
- [ ] Support for custom platform plugins
