# Build Instructions

This document provides detailed build and compilation instructions for the Myriad project.

## Prerequisites

### Required Tools
- **Rust**: 1.75 or later ([install](https://rustup.rs/))
- **Node.js**: 20 or later ([install](https://nodejs.org/))
- **PostgreSQL**: 16 or later ([install](https://www.postgresql.org/download/))
- **Git**: Latest version

### Optional Tools
- **Docker**: For containerized development
- **sea-orm-cli**: For database migrations
  ```bash
  cargo install sea-orm-cli
  ```

## Backend Build

### Development Build

```powershell
cd backend

# First time setup - download dependencies
cargo fetch

# Build in debug mode (faster compilation, slower runtime)
cargo build

# Run directly
cargo run

# Or run the built binary
.\target\debug\myriad-backend.exe
```

### Release Build

```powershell
cd backend

# Build with optimizations (slower compilation, faster runtime)
cargo build --release

# Run the optimized binary
.\target\release\myriad-backend.exe
```

### Build Options

**Debug Build:**
- Fast compilation
- Includes debug symbols
- No optimizations
- Larger binary size
- Good for development

**Release Build:**
- Slower compilation
- Optimized for speed
- Smaller binary (with strip)
- Link-time optimization (LTO)
- Best for production

### Common Build Issues

**Issue: OpenSSL not found**
```powershell
# Windows: Install OpenSSL via vcpkg or use rustls feature
cargo build --no-default-features --features rustls
```

**Issue: Out of memory during compilation**
```powershell
# Reduce parallel compilation
cargo build -j 2
```

**Issue: Linker errors**
```powershell
# Ensure Visual Studio C++ Build Tools are installed
# Or install via: https://visualstudio.microsoft.com/downloads/
```

## Frontend Build

### Development Build

```powershell
cd frontend

# Install dependencies
pnpm install

# Start development server (with hot reload)
pnpm run dev

# The server will be available at http://localhost:4321
```

### Production Build

```powershell
cd frontend

# Build static site
pnpm run build

# Preview the build
pnpm run preview

# Output will be in: frontend/dist/
```

### Build Configuration

Edit `astro.config.mjs` to customize:

```javascript
export default defineConfig({
  output: 'static',  // or 'server' for SSR
  build: {
    assets: 'assets',
    format: 'directory',
  },
  // ... more options
});
```

### Common Build Issues

**Issue: Node Sass errors**
```powershell
# Clear node_modules and reinstall
rm -r node_modules
pnpm install
```

**Issue: TypeScript errors**
```powershell
# Check types without building
pnpm astro check
```

**Issue: Memory issues during build**
```powershell
# Increase Node.js memory limit
$env:NODE_OPTIONS="--max-old-space-size=4096"
pnpm run build
```

## Full Stack Build

Use the provided build script:

```powershell
# From project root
.\scripts\build.ps1
```

This will:
1. Build the frontend (static site)
2. Build the backend (release mode)
3. Backend will serve frontend files from `frontend/dist/`

## Database Setup

### Option 1: SQL Schema

```powershell
# Create database
createdb myriad

# Apply schema
psql -U myriad -d myriad -f database\schema.sql
```

### Option 2: SeaORM Migrations

```powershell
cd backend

# Run migrations
sea-orm-cli migrate up

# Or using cargo
cargo run --manifest-path migrations/Cargo.toml
```

## Docker Build

### Build Images

```powershell
# Build all services
.\scripts\docker\build-and-push.ps1 -All

# Build specific service
.\scripts\docker\build-and-push.ps1 -BackendOnly
.\scripts\docker\build-and-push.ps1 -FrontendOnly
```

### Multi-stage Build Details

**Backend Dockerfile:**
- Stage 1: Build Rust binary
- Stage 2: Minimal runtime image with Debian slim

**Frontend Dockerfile:**
- Stage 1: Build static site with Node.js
- Stage 2: Serve with lightweight Node.js

### Docker Build Options

```powershell
# Build without cache
.\scripts\docker\build-and-push.ps1 -All -NoBuildCache

# Build with specific Docker file
docker build -f docker/Dockerfile.backend -t myriad-backend .

# Build and push to registry
.\scripts\docker\build-and-push.ps1 -All -Push -Username your-registry-user
```

## Optimization Tips

### Backend

1. **Use release profile**
   ```toml
   [profile.release]
   opt-level = 3
   lto = true
   codegen-units = 1
   strip = true
   ```

2. **Enable CPU features**
   ```powershell
   $env:RUSTFLAGS="-C target-cpu=native"
   cargo build --release
   ```

3. **Reduce binary size**
   ```toml
   [profile.release]
   opt-level = "z"  # Optimize for size
   lto = true
   strip = true
   ```

### Frontend

1. **Optimize images**
   - Use WebP format
   - Compress before adding to `public/`

2. **Code splitting**
   - Astro automatically splits by page
   - Use dynamic imports for large components

3. **Minimize JavaScript**
   - Already done by Vite/Rollup
   - Check output with `pnpm run build`

## Build Times (Reference)

### Development Machine (Example: Ryzen 7 5800X, 32GB RAM, NVMe SSD)

**Backend:**
- First build (debug): ~3-5 minutes
- Incremental build (debug): ~10-30 seconds
- Release build: ~5-10 minutes

**Frontend:**
- pnpm install: ~1-2 minutes
- Development build: ~5-15 seconds
- Production build: ~30-60 seconds

**Full Docker build:**
- All services: ~10-15 minutes

## CI/CD Considerations

### GitHub Actions Example

```yaml
name: Build

on: [push, pull_request]

jobs:
  backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions-rs/toolchain@v1
        with:
          toolchain: stable
      - run: cd backend && cargo build --release

  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 20
      - run: cd frontend && corepack enable && pnpm install --frozen-lockfile && pnpm run build
```

## Troubleshooting

### General Issues

1. **Clean build**
   ```powershell
   # Backend
   cd backend
   cargo clean
   
   # Frontend
   cd frontend
   rm -r node_modules dist .astro
   ```

2. **Update dependencies**
   ```powershell
   # Backend
   cargo update
   
   # Frontend
   npm update
   ```

3. **Check versions**
   ```powershell
   rustc --version
   cargo --version
   node --version
   npm --version
   ```

## Next Steps

After building:
1. Configure `.env` files
2. Set up database
3. Run tests: `cargo test` (backend), `npm test` (frontend)
4. Start development: `.\scripts\dev.ps1`

For deployment instructions, see [docs/DEPLOYMENT.md](DEPLOYMENT.md).
