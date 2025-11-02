# Deployment Guide

This guide covers different deployment strategies for the Myriad platform.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Development Deployment](#development-deployment)
- [Production Deployment](#production-deployment)
  - [Docker Deployment](#docker-deployment)
  - [Traditional Server Deployment](#traditional-server-deployment)
- [Environment Configuration](#environment-configuration)
- [Database Setup](#database-setup)
- [SSL/TLS Configuration](#ssltls-configuration)
- [Monitoring and Maintenance](#monitoring-and-maintenance)
- [Troubleshooting](#troubleshooting)

## Prerequisites

### For Development
- Windows 10/11 or Linux
- Rust 1.75+
- Node.js 20+
- PostgreSQL 16+ or Docker
- Git

### For Production
- Linux server (Ubuntu 22.04 LTS recommended) or Windows Server
- Docker & Docker Compose (for Docker deployment)
- Minimum 2GB RAM, 2 CPU cores
- 20GB disk space
- Domain name (optional, but recommended)

## Development Deployment

### Quick Start

1. **Clone and setup:**
   ```powershell
   git clone https://github.com/yourusername/Myriad.git
   cd Myriad
   .\scripts\setup.ps1
   ```

2. **Configure environment:**
   Edit `backend/.env` with your settings

3. **Start PostgreSQL:**
   ```powershell
   docker-compose up -d postgres
   ```

4. **Run development servers:**
   ```powershell
   .\scripts\dev.ps1
   ```

Access:
- Frontend: http://localhost:4321
- Backend: http://localhost:3000

## Production Deployment

### Docker Deployment (Recommended)

#### 1. Prepare the Server

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Install Docker Compose
sudo apt install docker-compose-plugin

# Add user to docker group
sudo usermod -aG docker $USER
newgrp docker
```

#### 2. Clone and Configure

```bash
git clone https://github.com/yourusername/Myriad.git
cd Myriad

# Copy and edit environment file
cp backend/.env.example backend/.env
nano backend/.env
```

Update these critical settings:
```env
DATABASE_URL=postgres://myriad:STRONG_PASSWORD@postgres:5432/myriad
OPENAI_API_KEY=sk-your-real-api-key
GITHUB_TOKEN=ghp_your-real-token
SERVER_HOST=0.0.0.0
CORS_ORIGINS=https://yourdomain.com
```

#### 3. Build and Deploy

```bash
# Build images
docker-compose build

# Start services
docker-compose up -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f
```

#### 4. Configure Reverse Proxy (nginx)

Create `/etc/nginx/sites-available/myriad`:

```nginx
server {
    listen 80;
    server_name yourdomain.com;

    # Redirect to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    # Backend API
    location /api/ {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /health {
        proxy_pass http://localhost:3000;
    }

    # Frontend
    location / {
        proxy_pass http://localhost:4321;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Enable and restart:
```bash
sudo ln -s /etc/nginx/sites-available/myriad /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### Traditional Server Deployment

#### 1. Install Dependencies

**On Ubuntu/Debian:**
```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install PostgreSQL
sudo apt install -y postgresql postgresql-contrib

# Install build tools
sudo apt install -y build-essential pkg-config libssl-dev
```

#### 2. Setup Database

```bash
sudo -u postgres psql
```

```sql
CREATE DATABASE myriad;
CREATE USER myriad WITH ENCRYPTED PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE myriad TO myriad;
\q
```

```bash
psql -U myriad -d myriad < database/schema.sql
```

#### 3. Build Application

```bash
cd Myriad

# Build frontend
cd frontend
npm install
npm run build
cd ..

# Build backend
cd backend
cargo build --release
cd ..
```

#### 4. Create Systemd Service

Create `/etc/systemd/system/myriad.service`:

```ini
[Unit]
Description=Myriad Backend Service
After=network.target postgresql.service

[Service]
Type=simple
User=myriad
WorkingDirectory=/opt/myriad/backend
Environment="DATABASE_URL=postgres://myriad:password@localhost/myriad"
Environment="RUST_LOG=info"
ExecStart=/opt/myriad/backend/target/release/myriad-backend
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable myriad
sudo systemctl start myriad
sudo systemctl status myriad
```

## Environment Configuration

### Required Variables

```env
# Database (Required)
DATABASE_URL=postgres://user:password@host:port/database

# Server (Required)
SERVER_HOST=0.0.0.0
SERVER_PORT=3000

# OpenAI (Required for AI features)
OPENAI_API_KEY=sk-your-key
OPENAI_MODEL=gpt-4

# Platform Tokens (At least one required)
GITHUB_TOKEN=ghp_your-token
TWITTER_BEARER_TOKEN=your-token
LINKEDIN_ACCESS_TOKEN=your-token
```

### Optional Variables

```env
# Logging
RUST_LOG=info,myriad_backend=debug

# Frontend
FRONTEND_DIST_PATH=../frontend/dist

# Security
JWT_SECRET=your-secret-key
CORS_ORIGINS=https://yourdomain.com

# Features
ENABLE_AUTO_FETCH=true
FETCH_INTERVAL_HOURS=24
```

## Database Setup

### Backup

```bash
# Backup database
pg_dump -U myriad myriad > backup_$(date +%Y%m%d_%H%M%S).sql

# With Docker
docker exec myriad-postgres pg_dump -U myriad myriad > backup.sql
```

### Restore

```bash
# Restore database
psql -U myriad myriad < backup.sql

# With Docker
docker exec -i myriad-postgres psql -U myriad myriad < backup.sql
```

### Migrations

```bash
cd backend

# Run migrations
cargo run --bin migration

# Or with sea-orm-cli
sea-orm-cli migrate up
```

## SSL/TLS Configuration

### Using Let's Encrypt (Recommended)

```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx

# Obtain certificate
sudo certbot --nginx -d yourdomain.com

# Auto-renewal is configured automatically
sudo certbot renew --dry-run
```

### Using Custom Certificate

Update nginx configuration:
```nginx
ssl_certificate /path/to/certificate.crt;
ssl_certificate_key /path/to/private.key;
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers HIGH:!aNULL:!MD5;
```

## Monitoring and Maintenance

### Health Checks

```bash
# Check backend health
curl http://localhost:3000/health

# Check with systemd
sudo systemctl status myriad
```

### Log Management

```bash
# View backend logs (systemd)
sudo journalctl -u myriad -f

# View Docker logs
docker-compose logs -f backend

# View nginx logs
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

### Database Maintenance

```bash
# Analyze and vacuum
sudo -u postgres psql myriad -c "VACUUM ANALYZE;"

# Check database size
sudo -u postgres psql myriad -c "SELECT pg_size_pretty(pg_database_size('myriad'));"
```

### Updates

```bash
# Pull latest code
git pull origin main

# Rebuild and restart (Docker)
docker-compose down
docker-compose build
docker-compose up -d

# Or rebuild manually
cd frontend && npm install && npm run build && cd ..
cd backend && cargo build --release && cd ..
sudo systemctl restart myriad
```

## Troubleshooting

### Backend Won't Start

1. **Check logs:**
   ```bash
   sudo journalctl -u myriad -n 50
   ```

2. **Verify database connection:**
   ```bash
   psql $DATABASE_URL -c "SELECT 1;"
   ```

3. **Check port availability:**
   ```bash
   sudo netstat -tlnp | grep 3000
   ```

### Frontend Build Errors

1. **Clear cache:**
   ```bash
   cd frontend
   rm -rf node_modules dist .astro
   npm install
   npm run build
   ```

2. **Check Node version:**
   ```bash
   node --version  # Should be 20+
   ```

### Database Connection Issues

1. **Check PostgreSQL status:**
   ```bash
   sudo systemctl status postgresql
   ```

2. **Verify credentials:**
   ```bash
   psql -U myriad -h localhost -d myriad
   ```

3. **Check firewall:**
   ```bash
   sudo ufw status
   sudo ufw allow 5432/tcp
   ```

### Docker Issues

1. **Check container status:**
   ```bash
   docker-compose ps
   docker-compose logs backend
   ```

2. **Restart containers:**
   ```bash
   docker-compose restart
   ```

3. **Clean rebuild:**
   ```bash
   docker-compose down -v
   docker-compose build --no-cache
   docker-compose up -d
   ```

## Performance Tuning

### PostgreSQL

Edit `/etc/postgresql/16/main/postgresql.conf`:

```ini
shared_buffers = 256MB
effective_cache_size = 1GB
maintenance_work_mem = 64MB
checkpoint_completion_target = 0.9
wal_buffers = 16MB
default_statistics_target = 100
random_page_cost = 1.1
work_mem = 4MB
```

Restart PostgreSQL:
```bash
sudo systemctl restart postgresql
```

### Backend

Set environment variables:
```env
RUST_LOG=warn  # Reduce logging in production
```

### Nginx

```nginx
gzip on;
gzip_vary on;
gzip_types text/plain text/css application/json application/javascript text/xml application/xml;
```

## Security Checklist

- [ ] Use strong database passwords
- [ ] Enable firewall (ufw/iptables)
- [ ] Configure SSL/TLS
- [ ] Set appropriate CORS origins
- [ ] Keep dependencies updated
- [ ] Regular database backups
- [ ] Monitor logs for suspicious activity
- [ ] Use environment variables for secrets
- [ ] Restrict database access
- [ ] Keep system packages updated

---

For additional help, please open an issue on GitHub.
