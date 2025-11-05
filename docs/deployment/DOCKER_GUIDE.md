# 🐳 Docker Images Guide

Complete guide for building, publishing, and using Myriad Docker images.

## 📚 Table of Contents

- [For Users: Using Pre-built Images](#for-users-using-pre-built-images)
- [For Maintainers: Building & Publishing](#for-maintainers-building--publishing)
- [GitHub Actions Automation](#github-actions-automation)
- [Image Information](#image-information)

---

## 🚀 For Users: Using Pre-built Images

### Quick Deploy (Recommended)

**Windows:**

```powershell
.\scripts\docker\docker-deploy-prebuilt.ps1
```

**Linux/Mac:**

```bash
./scripts\docker/docker-deploy-prebuilt.sh
```

### Manual Deployment

**1. Create configuration:**

```bash
cp .env.prebuilt .env
nano .env  # Edit passwords and keys
```

**2. Start services:**

```bash
docker-compose -f docker-compose.prebuilt.yml up -d
```

**3. Access application:**

- Frontend: http://localhost:4321
- Backend: http://localhost:3000

### Update Images

```bash
# Pull latest images
docker-compose -f docker-compose.prebuilt.yml pull

# Restart services
docker-compose -f docker-compose.prebuilt.yml up -d
```

---

## 🛠️ For Maintainers: Building & Publishing

### Prerequisites

1. **Docker Hub Account**

   - Register: https://hub.docker.com/signup
   - Create Access Token: Account Settings → Security → New Access Token

2. **Local Setup**
   ```bash
   docker login
   # Enter username and password/token
   ```

### Build & Push Images

**Windows:**

```powershell
# Build and push to Docker Hub
.\scripts\docker\build-and-push.ps1 -Username YOUR_USERNAME -Push

# Build specific version
.\scripts\docker\build-and-push.ps1 -Username YOUR_USERNAME -Tag v1.0.0 -Push

# Build without pushing (testing)
.\scripts\docker\build-and-push.ps1 -Username YOUR_USERNAME
```

**Linux/Mac:**

```bash
# Add execute permission
chmod +x scripts/docker/build-and-push.sh

# Build and push
./scripts/docker/build-and-push.sh -u YOUR_USERNAME -p

# Build specific version
./scripts/docker/build-and-push.sh -u YOUR_USERNAME -t v1.0.0 -p
```

### Script Options

| Option             | Description                    |
| ------------------ | ------------------------------ |
| `-Username` / `-u` | Docker Hub username (required) |
| `-Tag` / `-t`      | Image tag (default: `latest`)  |
| `-Push` / `-p`     | Push to registry after build   |
| `-BuildBackend`    | Build backend only (Windows)   |
| `-BuildFrontend`   | Build frontend only (Windows)  |
| `-NoBuildCache`    | Build without cache            |

### Build Process

The script automatically:

1. ✅ Detects version from `backend/Cargo.toml`
2. ✅ Builds multi-stage Docker images
3. ✅ Tags images with version and `latest`
4. ✅ Pushes to Docker Hub (if `-Push` specified)
5. ✅ Shows pull commands for users

### Verify Published Images

Visit Docker Hub to confirm:

- https://hub.docker.com/r/YOUR_USERNAME/myriad-backend
- https://hub.docker.com/r/YOUR_USERNAME/myriad-frontend

---

## 🤖 GitHub Actions Automation

### Setup

**1. Configure Secrets** in GitHub repository settings:

- `DOCKERHUB_USERNAME` - Your Docker Hub username
- `DOCKERHUB_TOKEN` - Access Token from Docker Hub

**2. Workflow File:** `.github/workflows/docker-publish.yml`

### Automatic Triggers

GitHub Actions builds and pushes images when:

| Event             | Tag Generated      |
| ----------------- | ------------------ |
| Push to `main`    | `latest`, `main`   |
| Push to `preview` | `preview`          |
| Git tag `v*`      | `v1.0.0`, `latest` |
| Release created   | `v1.0.0`, `latest` |
| Manual dispatch   | Custom tag         |

### Multi-Architecture Build

GitHub Actions builds for:

- `linux/amd64` (Intel/AMD)
- `linux/arm64` (Apple Silicon, ARM servers)

### Manual Trigger

1. Go to GitHub Actions tab
2. Select "Build and Push Docker Images"
3. Click "Run workflow"
4. Choose branch and optional custom tag
5. Run

### Workflow Features

- ✅ Multi-architecture support (amd64, arm64)
- ✅ Layer caching for faster builds
- ✅ Automatic version detection
- ✅ Semantic version tagging
- ✅ Latest tag management

---

## 📊 Image Information

### Official Images

| Image        | Docker Hub                       |
| ------------ | -------------------------------- |
| **Backend**  | `somekawahitomi/myriad-backend`  |
| **Frontend** | `somekawahitomi/myriad-frontend` |

### Available Tags

| Tag       | Description           | Update Frequency     |
| --------- | --------------------- | -------------------- |
| `latest`  | Latest stable release | On release           |
| `v1.0.0`  | Specific version      | Fixed                |
| `main`    | Main branch build     | On commit to main    |
| `preview` | Preview branch        | On commit to preview |

### Image Sizes

| Image     | Compressed  | Uncompressed |
| --------- | ----------- | ------------ |
| Backend   | ~100 MB     | ~250 MB      |
| Frontend  | ~50 MB      | ~150 MB      |
| **Total** | **~150 MB** | **~400 MB**  |

### Image Layers

**Backend (Rust):**

```dockerfile
FROM rust:1.75 AS builder       # Build stage
FROM debian:bookworm-slim       # Runtime stage
# Optimized with cargo chef for caching
```

**Frontend (Node.js):**

```dockerfile
FROM node:20-alpine AS builder  # Build stage
FROM nginx:alpine               # Runtime stage with nginx
```

### Health Checks

Both images include health checks:

**Backend:**

```dockerfile
HEALTHCHECK --interval=30s --timeout=3s \
  CMD curl -f http://localhost:3000/health || exit 1
```

**Frontend:**

```dockerfile
HEALTHCHECK --interval=30s --timeout=3s \
  CMD curl -f http://localhost:4321 || exit 1
```

---

## 🔐 Security Best Practices

### For Image Publishers

1. **Use Access Tokens** instead of passwords
2. **Enable 2FA** on Docker Hub account
3. **Scan images** for vulnerabilities:
   ```bash
   docker scan somekawahitomi/myriad-backend:latest
   ```
4. **Sign images** with Docker Content Trust (optional)
5. **Keep base images updated** regularly

### For Image Users

1. **Verify image signatures** before deployment
2. **Use specific version tags** in production (not `latest`)
3. **Regularly update** to latest versions
4. **Scan pulled images** for vulnerabilities
5. **Review Dockerfile** for transparency

---

## 🐛 Troubleshooting

### Build Failures

**Issue: Out of memory during build**

```bash
# Increase Docker memory limit
# Docker Desktop → Settings → Resources → Memory: 8GB+
```

**Issue: Layer caching not working**

```bash
# Use no-cache flag
./build-and-push.ps1 -Username YOUR_USER -NoBuildCache -Push
```

### Push Failures

**Issue: Authentication required**

```bash
# Re-login to Docker Hub
docker login
```

**Issue: Rate limit exceeded**

```bash
# Docker Hub has pull rate limits
# Solution: Use authenticated pulls or wait
```

### Pull Failures

**Issue: Image not found**

```bash
# Verify image name and tag
docker pull somekawahitomi/myriad-backend:latest

# Check Docker Hub for available tags
```

**Issue: Network timeout**

```bash
# Try using a Docker mirror or VPN
# Or build locally instead
```

---

## 📈 Advanced Topics

### Custom Registry

To use a private registry instead of Docker Hub:

**1. Update scripts:**

```powershell
# Windows
.\build-and-push.ps1 -Registry registry.example.com -Username YOUR_USER -Push
```

**2. Update docker-compose.prebuilt.yml:**

```yaml
services:
  backend:
    image: registry.example.com/YOUR_USER/myriad-backend:latest
```

### Multi-Stage Build Optimization

**Backend Dockerfile** uses `cargo-chef` for dependency caching:

```dockerfile
FROM rust:1.75 AS chef
RUN cargo install cargo-chef

FROM chef AS planner
COPY . .
RUN cargo chef prepare

FROM chef AS builder
COPY --from=planner /app/recipe.json recipe.json
RUN cargo chef cook --release  # Cached layer
COPY . .
RUN cargo build --release      # Only rebuilds when code changes
```

### Version Management

**Semantic Versioning:**

- Major: Breaking changes (v2.0.0)
- Minor: New features (v1.1.0)
- Patch: Bug fixes (v1.0.1)

**Tag Strategy:**

```bash
# Version from Cargo.toml
VERSION=$(grep '^version' backend/Cargo.toml | cut -d'"' -f2)

# Tag images
docker tag myriad-backend:latest user/myriad-backend:$VERSION
docker tag myriad-backend:latest user/myriad-backend:latest
```

### CI/CD Integration

**GitLab CI Example:**

```yaml
build_images:
  stage: build
  script:
    - docker build -t $CI_REGISTRY_IMAGE/backend -f docker/Dockerfile.backend .
    - docker push $CI_REGISTRY_IMAGE/backend
```

**Jenkins Example:**

```groovy
pipeline {
  agent any
  stages {
    stage('Build') {
      steps {
        sh './scripts/docker/build-and-push.sh -u $DOCKER_USER -p'
      }
    }
  }
}
```

---

## 📚 Additional Resources

### Documentation

- [Getting Started Guide](GETTING_STARTED.md)
- [Docker Deployment (Advanced)](DOCKER_DEPLOYMENT.md)
- [Architecture Overview](../development/ARCHITECTURE.md)

### External Links

- [Docker Hub Documentation](https://docs.docker.com/docker-hub/)
- [Dockerfile Best Practices](https://docs.docker.com/develop/dev-best-practices/)
- [Multi-stage Builds](https://docs.docker.com/build/building/multi-stage/)

### Image Repositories

- [Backend Image](https://hub.docker.com/r/somekawahitomi/myriad-backend)
- [Frontend Image](https://hub.docker.com/r/somekawahitomi/myriad-frontend)

---

## ✨ Quick Reference

### Build & Push Commands

```bash
# Full workflow
docker login
./scripts/docker/build-and-push.sh -u YOUR_USER -t v1.0.0 -p

# Build locally
./scripts/docker/build-and-push.sh -u YOUR_USER

# Push existing images
docker push YOUR_USER/myriad-backend:latest
docker push YOUR_USER/myriad-frontend:latest
```

### Deploy Pre-built Images

```bash
# Quick deploy
./scripts/docker/docker-deploy-prebuilt.sh

# Manual
docker-compose -f docker-compose.prebuilt.yml up -d
```

### Update Workflow

```bash
# Pull latest
docker-compose -f docker-compose.prebuilt.yml pull

# Restart
docker-compose -f docker-compose.prebuilt.yml up -d

# Verify
docker-compose -f docker-compose.prebuilt.yml ps
```

---

**Questions?** Open an issue on [GitHub](https://github.com/mirai-mamori/Myriad/issues)
