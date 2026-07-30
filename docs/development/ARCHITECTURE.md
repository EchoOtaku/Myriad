# Architecture Overview

## System Architecture

Myriad is built as a modern full-stack application with a clear separation between frontend and backend, communicating via RESTful APIs.

There are two runtime topologies:

- **Development**: Astro dev server on `1102` and Axum backend on `1103`; `/api/*`
  is forwarded by the Astro dev proxy.
- **Production**: `proxy` is the only host-facing service. It forwards page
  traffic to `frontend`, API traffic to `backend`, and shows the maintenance page
  while `updater` is changing image tags or restoring a snapshot.

The updater is not an A/B dual-live partition system. It uses one running
business slot plus immutable image tags and `pgdata` snapshots.

```
Production:

client ─► proxy(:80) ─┬─► frontend(:1102, internal)
                      └─► backend(:1103, internal) ─► postgres

updater(internal) ─► docker compose / .env tag switch / pgdata snapshot

Development:

browser ─► astro dev(:1102) ─► /api/* proxy ─► backend(:1103) ─► dev postgres
```

```
┌─────────────────────────────────────────────────────────────┐
│                         Frontend                             │
│              Astro + React + Tailwind CSS                    │
│                   (Port 1102)                                │
└────────────────────┬────────────────────────────────────────┘
                     │ HTTP/REST API
                     │
┌────────────────────▼────────────────────────────────────────┐
│                         Backend                              │
│                  Rust + Axum + SeaORM                        │
│                    (Port 1103)                               │
└────────┬──────────────────────────┬────────────────────┬────┘
         │                          │                    │
         │                          │                    │
    ┌────▼────┐              ┌──────▼──────┐      ┌────▼────┐
    │  GitHub │              │   Twitter   │      │ LinkedIn│
    │   API   │              │     API     │      │   API   │
    └─────────┘              └─────────────┘      └─────────┘
         │                          │                    │
         └──────────────────────────┴────────────────────┘
                                   │
                          ┌────────▼─────────┐
                          │   PostgreSQL     │
                          │    Database      │
                          └──────────────────┐
                                   │
                          ┌────────▼─────────┐
                          │ Google Gemini  │
                          │  (AI Analysis)  │
                          └──────────────────┘
```

## Components

### Tapp extension runtime

Tapp 是 Myriad 内的第三方应用运行时，不是普通 React 组件或后端插件。安装资源由后端
校验并按 owner 持久化，前端按 Page、Widget 或 headless 场景创建隔离 iframe，Tapp
只能通过带权限检查的 Bridge 与宿主/后端交互。完整边界、安装链路、生命周期、调度器、
声明式 API 与性能约束见 [Tapp 架构](tapp/ARCHITECTURE.md)。

### Frontend (Astro + React)

**Location**: `frontend/`

The frontend is built with Astro, a modern static site generator that allows for fast, content-focused websites with minimal JavaScript. React is used for interactive components.

**Key Features:**

- Server-side rendering for fast initial loads
- React islands for interactive components
- Tailwind CSS for styling
- TypeScript for type safety
- Vite as the build tool

**Structure:**

```
frontend/
├── src/
│   ├── pages/           # Route-based pages
│   ├── components/      # React/Astro components
│   ├── layouts/         # Page layouts
│   ├── lib/             # Utilities and API client
│   └── styles/          # Global styles
├── public/              # Static assets
└── astro.config.mjs     # Astro configuration
```

### Backend (Rust + Axum)

**Location**: `backend/`

The backend is built with Rust for performance, safety, and reliability. Axum provides a modern async web framework, while SeaORM handles database operations.

**Key Features:**

- Async/await for concurrent operations
- Type-safe database queries with SeaORM
- RESTful API design
- CORS support for frontend communication
- Structured error handling
- Comprehensive logging with tracing

**Structure:**

```
backend/
├── src/
│   ├── main.rs          # Application entry point
│   ├── api/             # API route handlers
│   │   ├── config.rs    # Configuration endpoints
│   │   ├── platforms.rs # Platform management
│   │   └── analysis.rs  # AI analysis endpoints
│   ├── services/        # Business logic
│   │   ├── fetcher.rs   # Platform data fetching
│   │   ├── analyzer.rs  # AI analysis
│   │   └── generator.rs # Content generation
│   ├── models/          # Data models & entities
│   ├── db/              # Database connection
│   ├── config.rs        # Configuration management
│   └── error.rs         # Error types
└── migrations/          # Database migrations
```

### Database (PostgreSQL)

**Location**: `database/`

PostgreSQL is used for its reliability, advanced features (JSONB, full-text search), and excellent support for complex queries.

**Core Tables:**

- `platforms` - Supported social platforms
- `user_profiles` - User profile data from platforms
- `user_activities` - User activities and posts
- `analysis_results` - AI-generated analyses
- `configurations` - System configuration
- `api_keys` - Encrypted API key storage
- `fetch_jobs` - Background job tracking

**Schema Management:**

- SQL schema in `database/schema.sql`
- SeaORM migrations in `backend/migrations/`
- Automated migration runner

## Data Flow

### 1. Platform Data Fetching

```
User → Frontend → Backend API → Platform Fetcher Service
                                        ↓
                                  External API
                                  (GitHub, etc.)
                                        ↓
                                  Parse & Store
                                        ↓
                                   Database
```

### 2. AI Analysis

```
User → Frontend → Backend API → Analyzer Service
                                        ↓
                                   Fetch Data
                                   from Database
                                        ↓
                              Google Gemini API
                                        ↓
                                  Store Results
                                        ↓
                                   Database
```

### 3. Data Display

```
User → Frontend → Backend API → Database Query
                                        ↓
                                  Format Response
                                        ↓
                    Frontend Renders Components
```

## Security Considerations

### API Key Management

- API keys stored encrypted in database
- Environment variables for sensitive data
- Never exposed to frontend
- Rotation support

### Data Privacy

- User data stored locally or in controlled environment
- No third-party analytics by default
- Optional **first-party** site analytics (settings → Data & stats): pageviews, engagement, custom events; visitor id stays in the browser; server stores path templates + salted hashes only (no raw IP). Admin/owner sessions are excluded. Calendar “today” follows the **server process local clock** (no product-default +8/+9); set host/`TZ` as you like. Prefer `ANALYTICS_SALT` in production. Admins can **export/import** a JSON backup (`GET/POST /api/analytics/export|import`; default import mode replaces all rows in one DB transaction; merge adds counts then recomputes UV/engaged_views from detail tables).
- Configurable data retention

### Network Security

- CORS configuration for API access
- HTTPS recommended for production
- Rate limiting on API endpoints (planned)

## Scalability

### Current Design

- Monolithic architecture suitable for single-user or small team use
- Single PostgreSQL instance
- All services run on same machine/container

### Future Scaling Options

1. **Horizontal Scaling**

   - Multiple backend instances behind load balancer
   - Shared PostgreSQL database
   - Redis for session/cache (if needed)

2. **Microservices**

   - Separate services for each platform integration
   - Message queue for async processing
   - Service mesh for inter-service communication

3. **Database Optimization**
   - Read replicas for queries
   - Connection pooling
   - Query optimization with indexes

## Performance Considerations

### Backend

- Async I/O for concurrent API calls
- Connection pooling for database
- Efficient serialization with serde
- Release builds with LTO optimization

### Frontend

- Static generation for fast loads
- Code splitting for smaller bundles
- Image optimization
- CDN for static assets (production)

### Database

- Indexed columns for frequent queries
- JSONB for flexible schema
- Regular VACUUM and ANALYZE
- Query plan analysis

## Deployment Architecture

### Development

```
Local Machine
├── PostgreSQL (Docker or local)
├── Backend (cargo run)
└── Frontend (pnpm run dev)
```

### Production (Docker)

```
Docker Host
├── proxy Container (only published port)
├── frontend Container (internal 1102)
├── backend Container (internal 1103)
├── PostgreSQL Container (internal 5432, ./pgdata bind mount)
└── updater Container (internal 1101, tag switch + snapshots)
```

Production Docker is managed by `scripts/docker/deploy.sh` or
`scripts/docker/deploy.ps1`. Updates normally run from `/config` -> About/关于 ->
Update Management/更新管理.

### Traditional / Source Deployment

```
Server
├── PostgreSQL Service
├── Backend Binary (systemd or equivalent)
└── Frontend Static Build (served by an external web server)
```

This path is for development or custom operators. The documented production path
is the Docker proxy + updater stack.

## Technology Choices Rationale

### Why Rust?

- Memory safety without garbage collection
- Excellent performance
- Strong type system prevents many bugs
- Great ecosystem for web development
- Efficient resource usage

### Why Astro?

- Fast by default (minimal JS)
- Flexible (supports multiple frameworks)
- Great developer experience
- SEO-friendly
- Modern build tools

### Why PostgreSQL?

- ACID compliance
- JSONB for flexible data storage
- Rich query capabilities
- Proven reliability
- Excellent documentation

### Why SeaORM?

- Async from ground up
- Type-safe queries
- Migration management
- Multi-database support
- Active development

## Development Workflow

1. **Local Development**

   - Use `./scripts/dev/dev.sh` or `.\scripts\dev\dev.ps1` to start services
   - The Astro dev server proxies `/api/*` to the backend in development
   - Hot reload for both frontend and backend

2. **Testing**

   - Unit tests for backend services
   - Integration tests for API endpoints
   - Frontend component tests (planned)

3. **Building**

   - `pnpm run build` creates the frontend static build
   - `cargo build --release` creates the backend binary
   - `scripts/docker/build-and-push.*` can build component images locally

4. **Deployment**
   - `scripts/docker/deploy.sh up` for production bootstrap
   - Admin UI updater for normal version changes
   - Database migrations run automatically

## Future Enhancements

- [ ] GraphQL API option
- [ ] WebSocket for real-time updates
- [ ] Background job queue (e.g., with Tokio tasks)
- [ ] Plugin system for custom platforms
- [ ] Multi-user support with authentication
- [ ] API rate limiting and caching
- [ ] Comprehensive monitoring and metrics
- [ ] Automated backups
