# 🚀 Myriad - Getting Started Guide

Complete guide to deploy Myriad in minutes using Docker.

## 📋 Prerequisites

- **Docker Desktop** (Windows/Mac) or **Docker Engine** (Linux) 20.10+
- **Docker Compose** 2.0+
- **4GB RAM** minimum
- **10GB disk space** minimum

### Install Docker

- [Windows/Mac - Docker Desktop](https://www.docker.com/products/docker-desktop)
- [Linux - Docker Engine](https://docs.docker.com/engine/install/)

## ⚡ Quick Start

### Option 1: Pre-built Images (Recommended, 2-3 minutes)

Use pre-built images from Docker Hub for fastest deployment:

**Windows:**

```powershell
cd C:\path\to\Myriad
.\scripts\docker\deploy.ps1 -Mode prebuilt
```

**Linux/Mac:**

```bash
cd /path/to/Myriad
chmod +x scripts/docker/deploy.sh
./scripts/docker/deploy.sh --mode prebuilt
```

### Option 2: Local Build (10-20 minutes)

Build images locally for development:

**Windows:**

```powershell
.\scripts\docker\deploy.ps1 -Mode build
```

**Linux/Mac:**

```bash
chmod +x scripts/docker/deploy.sh
./scripts/docker/deploy.sh --mode build
```

Or use Makefile:

```bash
make deploy
```

## 🌐 Access the Application

After deployment completes:

- **Frontend**: http://localhost:4321
- **Backend API**: http://localhost:3000
- **Health Check**: http://localhost:3000/health
- **Database**: localhost:5432 (username: myriad)

## 🎯 What the Scripts Do

The deployment scripts automatically:

1. ✅ Check Docker environment
2. ✅ Create `.env` configuration file
3. ✅ Prompt you to set secure passwords
4. ✅ Build/pull Docker images
5. ✅ Start all services (database, backend, frontend)
6. ✅ Wait for health checks to pass
7. ✅ Display access URLs

## 🔧 Common Commands

### Windows (PowerShell)

```powershell
# View service status
.\scripts\docker\deploy.ps1 -Mode build -Status

# View real-time logs
.\scripts\docker\deploy.ps1 -Mode build -Logs

# Stop all services
.\scripts\docker\deploy.ps1 -Mode build -Stop

# Rebuild and restart
.\scripts\docker\deploy.ps1 -Mode build -Rebuild

# Full cleanup (removes data!)
.\scripts\docker\deploy.ps1 -Mode build -Clean
```

### Linux/Mac (Shell Script)

```bash
# View service status
./scripts/docker/deploy.sh --mode build --status

# View real-time logs
./scripts/docker/deploy.sh --mode build --logs

# Stop all services
./scripts/docker/deploy.sh --mode build --stop

# Rebuild and restart
./scripts/docker/deploy.sh --mode build --rebuild

# Full cleanup (removes data!)
./scripts/docker/deploy.sh --mode build --clean
```

### Using Makefile (Linux/Mac)

```bash
make status    # View status
make logs      # View logs
make stop      # Stop services
make restart   # Restart services
make build     # Rebuild images
make clean     # Full cleanup
make backup    # Backup database
```

### Using Docker Compose Directly

```bash
# Start services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down

# View status
docker-compose ps
```

## 📝 First Time Setup

### 1. Clone the Repository

```bash
git clone https://github.com/mirai-mamori/Myriad.git
cd Myriad
```

### 2. Run Deployment Script

The script will guide you through configuration:

```powershell
# Windows
.\scripts\docker\deploy.ps1 -Mode build

# Linux/Mac
./scripts/docker/deploy.sh --mode build
```

### 3. Configure Environment

When prompted, edit the `.env` file to set:

**Required Settings:**

- `POSTGRES_PASSWORD` - Database password (change from default!)
- `JWT_SECRET` - JWT signing key (generate with `openssl rand -base64 32`)

**Optional Settings:**

- `BACKEND_PORT` - Backend port (default: 3000)
- `FRONTEND_PORT` - Frontend port (default: 4321)
- `POSTGRES_PORT` - Database port (default: 5432)

### 4. Wait for Startup

Services will start in order:

1. PostgreSQL database (initializes schema)
2. Backend API (connects to database)
3. Frontend (connects to backend)

### 5. Complete Setup Wizard

Visit http://localhost:4321/setup to:

- Create admin user
- Configure AI settings (Gemini/OpenAI)
- Set up platform integrations

## 🔐 Security Checklist

Before production deployment:

- [ ] Change `POSTGRES_PASSWORD` from default
- [ ] Generate unique `JWT_SECRET` (`openssl rand -base64 32`)
- [ ] Configure `CORS_ORIGINS` for your domain
- [ ] Review and set `RUST_LOG` level (use `info` for production)
- [ ] Enable HTTPS with reverse proxy (nginx/traefik)
- [ ] Set up regular database backups

## 🐛 Troubleshooting

### Docker Not Running

**Error:** Cannot connect to Docker daemon

**Solution:**

```bash
# Windows/Mac: Start Docker Desktop
# Linux: Start Docker service
sudo systemctl start docker
```

### Port Already in Use

**Error:** Port 3000/4321/5432 is already allocated

**Solution:** Edit `.env` file and change port numbers:

```bash
BACKEND_PORT=3001
FRONTEND_PORT=4322
POSTGRES_PORT=5433
```

### Services Not Starting

**Check logs:**

```bash
docker-compose logs backend
docker-compose logs frontend
docker-compose logs postgres
```

**Common issues:**

- Database not ready: Wait 30 seconds, services auto-retry
- Memory issues: Ensure Docker has at least 4GB RAM
- Disk space: Need at least 10GB free

### Database Connection Failed

**Check database:**

```bash
docker exec -it myriad-postgres psql -U myriad -d myriad
```

**Reset database:**

```bash
docker-compose down -v  # Warning: Deletes all data!
docker-compose up -d
```

### Clean Start

Remove everything and start fresh:

```powershell
# Windows
.\scripts\docker\deploy.ps1 -Mode build -Clean

# Linux/Mac
./scripts/docker/deploy.sh --mode build --clean
# or
make clean
```

## 📊 Verify Deployment

### Check Services

```bash
docker-compose ps
```

Expected output:

```
NAME                IMAGE                    STATUS
myriad-backend      myriad-backend:latest   Up (healthy)
myriad-frontend     myriad-frontend:latest  Up (healthy)
myriad-postgres     postgres:16-alpine      Up (healthy)
```

### Test Endpoints

```bash
# Health check
curl http://localhost:3000/health

# Frontend
curl http://localhost:4321

# Database
docker exec -it myriad-postgres psql -U myriad -c "\l"
```

## 🎓 Next Steps

1. **Complete Setup Wizard**: http://localhost:4321/setup

   - Create admin account
   - Configure AI provider (Gemini or OpenAI)
   - Add platform API keys

2. **Read Documentation**:

   - [API Documentation](../API.md)
   - [Docker Deployment Guide](DOCKER_DEPLOYMENT.md)
   - [Architecture Overview](../development/ARCHITECTURE.md)

3. **Configure Platforms**:

   - GitHub: Generate personal access token
   - Steam: Get Steam Web API key
   - Bilibili: Get SESSDATA cookie

4. **Explore Features**:
   - Fetch data from platforms
   - Generate AI analysis reports
   - View dashboard visualizations

## 🔄 Update & Maintenance

### Update to Latest Version

```bash
# Pull latest code
git pull origin main

# Rebuild and restart
docker-compose down
docker-compose up -d --build
```

### Backup Database

```bash
# Using Makefile
make backup

# Manual backup
docker exec myriad-postgres pg_dump -U myriad myriad > backup_$(date +%Y%m%d).sql
```

### Restore Database

```bash
# Stop services
docker-compose down

# Remove old data
docker volume rm myriad_postgres_data

# Start database only
docker-compose up -d postgres

# Wait 10 seconds, then restore
docker exec -i myriad-postgres psql -U myriad -d myriad < backup_20250105.sql

# Start all services
docker-compose up -d
```

### View Resource Usage

```bash
# CPU and memory usage
docker stats

# Disk usage
docker system df
```

### Clean Up Old Images

```bash
# Remove unused images
docker image prune -a

# Remove unused volumes
docker volume prune
```

## 💡 Tips & Best Practices

### Development vs Production

**Development:**

- Use local build: `deploy.ps1 -Mode build` or `deploy.sh --mode build`
- Keep `RUST_LOG=debug` for detailed logs
- Mount volumes for hot reload (if needed)

**Production:**

- Use pre-built images: `deploy.ps1 -Mode prebuilt` or `deploy.sh --mode prebuilt`
- Set `RUST_LOG=info` or `warn`
- Enable HTTPS with reverse proxy
- Set up automated backups
- Monitor with external tools

### Performance Tuning

**Increase Docker Resources:**

- Docker Desktop → Settings → Resources
- CPU: 4+ cores recommended
- Memory: 8GB+ recommended
- Swap: 2GB+

**Database Optimization:**
Edit `docker-compose.yml`:

```yaml
postgres:
  command: postgres -c max_connections=200 -c shared_buffers=256MB
```

### Multiple Environments

Run different environments side by side:

```bash
# Production
docker-compose -f docker-compose.yml -p myriad-prod up -d

# Staging
docker-compose -f docker-compose.yml -p myriad-staging up -d
```

## 🆘 Getting Help

If you encounter issues:

1. Check logs: `docker-compose logs -f`
2. Review [Troubleshooting](#troubleshooting) section above
3. Search existing [GitHub Issues](https://github.com/mirai-mamori/Myriad/issues)
4. Create new issue with:
   - Docker version: `docker --version`
   - Compose version: `docker-compose --version`
   - Error logs
   - Steps to reproduce

## 📚 Related Documentation

- [Docker Deployment Guide (Advanced)](DOCKER_DEPLOYMENT.md)
- [Docker Image Build & Publish](DOCKER_GUIDE.md)
- [API Documentation](../API.md)
- [Architecture Overview](../development/ARCHITECTURE.md)
- [Build from Source](../development/BUILD.md)

---

**Quick Start Summary:**

1. Install Docker
2. Run `scripts/docker/deploy.ps1 -Mode prebuilt` (or `deploy.sh --mode prebuilt`)
3. Visit http://localhost:4321
4. Complete setup wizard
5. Start analyzing your digital presence! 🚀
