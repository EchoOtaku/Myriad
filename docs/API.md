# API Documentation

Base URL: `http://localhost:3000`

## Table of Contents

- [Health Check](#health-check)
- [Configuration](#configuration)
- [Platforms](#platforms)
- [Profiles](#profiles)
- [Analysis](#analysis)

## Health Check

### GET /health

Check if the API server is running.

**Response:**

```json
{
  "status": "ok",
  "service": "myriad-backend",
  "version": "0.1.0"
}
```

**Status Codes:**

- `200 OK` - Service is healthy

---

## Configuration

### GET /api/config

Retrieve current system configuration.

**Response:**

```json
{
  "platforms": [
    {
      "name": "GitHub",
      "enabled": true,
      "has_token": true
    },
    {
      "name": "Twitter",
      "enabled": false,
      "has_token": false
    }
  ],
  "ai_config": {
    "provider": "Google Gemini",
    "model": "gemini-2.0-flash-exp",
    "enabled": true
  },
  "fetch_config": {
    "auto_fetch": false,
    "interval_hours": 24
  }
}
```

**Status Codes:**

- `200 OK` - Configuration retrieved successfully

### POST /api/config

Update system configuration.

**Request Body:**

```json
{
  "platforms": [
    {
      "name": "GitHub",
      "enabled": true,
      "has_token": true
    }
  ],
  "ai_config": {
    "provider": "Google Gemini",
    "model": "gemini-2.0-flash-exp",
    "enabled": true
  },
  "fetch_config": {
    "auto_fetch": true,
    "interval_hours": 12
  }
}
```

**Response:**

```json
{
  "success": true,
  "message": "Configuration updated successfully"
}
```

**Status Codes:**

- `200 OK` - Configuration updated successfully
- `400 Bad Request` - Invalid configuration data
- `500 Internal Server Error` - Failed to update configuration

---

## Platforms

### GET /api/platforms

List all supported platforms.

**Response:**

```json
{
  "platforms": [
    {
      "id": 1,
      "name": "GitHub",
      "enabled": true,
      "icon": "github"
    },
    {
      "id": 2,
      "name": "Twitter",
      "enabled": false,
      "icon": "twitter"
    }
  ]
}
```

**Status Codes:**

- `200 OK` - Platforms retrieved successfully

---

## Profiles

### GET /api/profiles

Get all fetched user profiles.

**Response:**

```json
{
  "profiles": [
    {
      "id": 1,
      "platform": "GitHub",
      "username": "octocat",
      "display_name": "The Octocat",
      "avatar_url": "https://github.com/images/octocat.png",
      "bio": "GitHub mascot",
      "location": "San Francisco",
      "website": "https://github.com/octocat",
      "fetched_at": "2025-10-30T10:00:00Z",
      "stats": {
        "followers": 1000,
        "following": 100,
        "repositories": 50
      }
    }
  ],
  "total": 1
}
```

**Status Codes:**

- `200 OK` - Profiles retrieved successfully
- `404 Not Found` - No profiles found

### POST /api/fetch

Trigger manual data fetch from platforms.

**Request Body:**

```json
{
  "platforms": ["github", "twitter"],
  "force": false
}
```

**Parameters:**

- `platforms` (optional): Array of platform names to fetch. If omitted, fetches from all enabled platforms.
- `force` (optional): If true, fetches even if recently fetched. Default: false.

**Response:**

```json
{
  "success": true,
  "message": "Fetch triggered successfully",
  "job_id": 123
}
```

**Status Codes:**

- `200 OK` - Fetch triggered successfully
- `400 Bad Request` - Invalid platform names
- `429 Too Many Requests` - Rate limit exceeded
- `500 Internal Server Error` - Fetch failed

---

## Analysis

### GET /api/analysis

Get AI analysis results.

**Query Parameters:**

- `type` (optional): Filter by analysis type (e.g., "profile_summary", "skill_extraction")
- `limit` (optional): Number of results to return. Default: 10
- `offset` (optional): Pagination offset. Default: 0

**Response:**

```json
{
  "analysis": [
    {
      "id": 1,
      "type": "profile_summary",
      "result": {
        "summary": "Active software developer with strong presence on GitHub...",
        "key_skills": ["Python", "JavaScript", "Rust"],
        "activity_level": "high",
        "interests": ["Open Source", "Web Development"]
      },
      "ai_model": "gemini-2.0-flash-exp",
      "created_at": "2025-10-30T12:00:00Z"
    }
  ],
  "total": 1
}
```

**Status Codes:**

- `200 OK` - Analysis results retrieved successfully
- `404 Not Found` - No analysis results found

### POST /api/analysis

Trigger AI analysis of profile data.

**Request Body:**

```json
{
  "type": "profile_summary",
  "profile_ids": [1, 2, 3],
  "options": {
    "detail_level": "comprehensive",
    "include_recommendations": true
  }
}
```

**Parameters:**

- `type`: Type of analysis to perform
  - `profile_summary` - General summary of user's digital presence
  - `skill_extraction` - Extract and categorize skills
  - `personality_analysis` - Analyze personality traits
  - `content_analysis` - Analyze posted content
  - `trend_analysis` - Identify activity trends
- `profile_ids` (optional): Specific profile IDs to analyze. If omitted, analyzes all profiles.
- `options` (optional): Additional options for the analysis

**Response:**

```json
{
  "success": true,
  "message": "Analysis triggered successfully",
  "analysis_id": 456,
  "estimated_time_seconds": 30
}
```

**Status Codes:**

- `200 OK` - Analysis triggered successfully
- `400 Bad Request` - Invalid analysis type or parameters
- `402 Payment Required` - Insufficient API credits
- `429 Too Many Requests` - Rate limit exceeded
- `500 Internal Server Error` - Analysis failed

---

## Error Responses

All endpoints may return error responses in the following format:

```json
{
  "error": "Error message describing what went wrong"
}
```

**Common Status Codes:**

- `400 Bad Request` - Invalid request parameters
- `404 Not Found` - Resource not found
- `429 Too Many Requests` - Rate limit exceeded
- `500 Internal Server Error` - Server error

---

## Rate Limiting

API endpoints are subject to rate limiting to prevent abuse:

- Configuration endpoints: 10 requests per minute
- Fetch endpoints: 5 requests per minute
- Analysis endpoints: 3 requests per minute
- Other endpoints: 60 requests per minute

Rate limit headers are included in responses:

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 59
X-RateLimit-Reset: 1698672000
```

---

## Authentication

Currently, the API does not require authentication as it's designed for single-user deployment. Future versions may include:

- API key authentication
- OAuth 2.0 support
- JWT tokens for multi-user scenarios

---

## Webhooks (Planned)

Future versions will support webhooks for real-time notifications:

- `fetch.completed` - When a data fetch completes
- `analysis.completed` - When an AI analysis completes
- `error.occurred` - When an error occurs in background jobs

---

## CORS

The API supports CORS for frontend access. Default allowed origins:

- `http://localhost:4321` (development)
- `http://localhost:3000` (development)

Configure additional origins in the `.env` file:

```env
CORS_ORIGINS=http://localhost:4321,https://yourdomain.com
```

---

## Development

### Testing with cURL

**Health check:**

```bash
curl http://localhost:3000/health
```

**Get configuration:**

```bash
curl http://localhost:3000/api/config
```

**Trigger fetch:**

```bash
curl -X POST http://localhost:3000/api/fetch \
  -H "Content-Type: application/json" \
  -d '{"platforms": ["github"]}'
```

### Testing with PowerShell

**Health check:**

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/health"
```

**Get configuration:**

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/config"
```

**Trigger fetch:**

```powershell
$body = @{
    platforms = @("github")
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:3000/api/fetch" `
  -Method Post `
  -ContentType "application/json" `
  -Body $body
```

---

## Client Libraries

### TypeScript/JavaScript

The frontend includes a TypeScript client in `frontend/src/lib/api.ts`:

```typescript
import { fetchConfig, triggerFetch, fetchAnalysis } from "@lib/api";

// Get configuration
const config = await fetchConfig();

// Trigger data fetch
await triggerFetch();

// Get analysis results
const analysis = await fetchAnalysis();
```

### Rust

For Rust applications, you can use the `reqwest` crate:

```rust
use reqwest::Client;

let client = Client::new();
let response = client
    .get("http://localhost:3000/api/config")
    .send()
    .await?;

let config: serde_json::Value = response.json().await?;
```

---

## Changelog

### v0.1.0 (2025-10-30)

- Initial API implementation
- Basic CRUD endpoints for configuration
- Platform listing endpoint
- Fetch trigger endpoint
- Analysis endpoints (stubs)
