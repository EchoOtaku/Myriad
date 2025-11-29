# 📚 Myriad Documentation Portal

Welcome to Myriad documentation! This is your central hub for all project documentation, scripts, and resources.

## 🎯 Quick Navigation

| I want to...              | Go to                                                     |
| ------------------------- | --------------------------------------------------------- |
| **Deploy Myriad now!**    | [Quick Start →](../QUICKSTART.md)                         |
| **Understand the system** | [Architecture →](../development/ARCHITECTURE.md)          |
| **Use the API**           | [API Docs →](../API.md)                                   |
| **Deploy with Docker**    | [Docker Deployment →](../deployment/DOCKER_DEPLOYMENT.md) |
| **Build from source**     | [Build Guide →](../development/BUILD.md)                  |
| **See what changed**      | [Changelog →](../CHANGELOG.md)                            |

---

## 📖 Documentation Structure

```
docs/
├── API.md                    # Complete API reference with examples
├── CHANGELOG.md              # Version history and release notes
├── QUICKSTART.md             # ⭐ Quick start guide (START HERE)
│
├── deployment/               # Deployment Documentation
│   ├── DOCKER_DEPLOYMENT.md # Docker deployment & configuration
│   └── DEPLOYMENT_1PANEL.md # 1Panel deployment guide
│
├── development/              # Development Documentation
│   ├── ARCHITECTURE.md      # System architecture & design
│   └── BUILD.md             # Build from source instructions
│
├── features/                 # Feature Documentation
│   └── LIBRARY.md           # Library feature guide
│
├── guides/                   # User Guides
│   ├── EXTENSIONS.md        # Browser extensions
│   └── SECURITY_HEADERS.md  # Security configuration
│
└── quick-reference/          # THIS FILE - Documentation portal
    └── INDEX.md              # Main documentation index
```

---

## 🚀 Getting Started Paths

### Path 1: New User (5 minutes)

**Goal:** Get Myriad running quickly

```
1. Install Docker Desktop
2. Read: QUICKSTART.md
3. Run: scripts/docker/deploy.ps1 -Mode prebuilt
4. Visit: http://localhost:4321
5. Complete setup wizard
```

### Path 2: Developer (30 minutes)

**Goal:** Understand codebase and contribute

```
1. Read: development/ARCHITECTURE.md
2. Read: development/BUILD.md
3. Clone repository
4. Run development scripts
5. Explore: backend/src/ and frontend/src/
```

### Path 3: DevOps Engineer (20 minutes)

**Goal:** Deploy and manage in production

```
1. Read: deployment/DOCKER_DEPLOYMENT.md
2. Set up CI/CD with GitHub Actions
3. Configure monitoring and backups
4. Review: guides/SECURITY_HEADERS.md
```

### Path 4: API Consumer (15 minutes)

**Goal:** Integrate with Myriad API

```
1. Read: API.md
2. Test endpoints with curl/Postman
3. Review JavaScript/Python examples
4. Implement client integration
5. Handle errors and rate limits
```

---

## 📂 Project Structure

### Root Directory

```
Myriad/
├── README.md                    # Project overview
├── LICENSE                      # GPL-3.0 license
├── Makefile                     # Quick commands (Linux/Mac)
├── docker-compose.yml           # Local build config
├── docker-compose.prebuilt.yml  # Pre-built images config
├── .env.docker                  # Environment template (local build)
└── .env.prebuilt                # Environment template (pre-built)
```

### Scripts Directory

```
scripts/
├── docker/                      # Docker Deployment Scripts
│   ├── deploy.ps1              # Unified deployment (Windows)
│   ├── deploy.sh               # Unified deployment (Linux/Mac)
│   ├── build-and-push.ps1      # Build & push images to registry (Windows)
│   └── build-and-push.sh       # Build & push images to registry (Linux/Mac)
│
└── dev/                         # Development Scripts
    ├── dev.ps1                 # Unified dev tool (Windows)
    ├── dev.sh                  # Unified dev tool (Linux/Mac)
    └── build.sh                # Build backend (Linux/Mac)
```

**Total Scripts:** 7 (4 Docker + 3 Development)

### Backend Structure

```
backend/
├── src/
│   ├── main.rs                 # Entry point
│   ├── config.rs               # Configuration management
│   ├── api/                    # API endpoints
│   │   ├── auth.rs            # Authentication
│   │   ├── profile.rs         # User profiles
│   │   ├── platforms.rs       # Platform integrations
│   │   ├── analysis.rs        # AI analysis
│   │   └── ...
│   ├── db/                     # Database layer
│   ├── models/                 # Data models
│   └── services/               # Business logic
│       ├── analyzer.rs        # AI service
│       ├── fetcher.rs         # Data fetching
│       └── ...
├── migrations/                  # Database migrations
├── cache/                       # Runtime cache
└── Cargo.toml                   # Rust dependencies
```

### Frontend Structure

```
frontend/
├── src/
│   ├── pages/                  # Astro pages
│   │   ├── index.astro        # Homepage
│   │   ├── setup.astro        # Setup wizard
│   │   ├── dashboard.astro    # Dashboard
│   │   └── ...
│   ├── components/             # React/Astro components
│   │   ├── LoginForm.tsx
│   │   ├── ConfigForm.tsx
│   │   ├── PlatformStats.astro
│   │   └── ...
│   ├── layouts/                # Page layouts
│   ├── lib/                    # Utilities & API client
│   └── styles/                 # CSS styles
├── public/                      # Static assets
└── package.json                 # Node.js dependencies
```

### Documentation Structure

```
docs/
├── API.md                      # 📡 Complete API reference
├── CHANGELOG.md                # 📝 Version history
├── QUICKSTART.md               # ⭐ Quick start guide
│
├── deployment/                 # 🚀 Deployment Guides
│   ├── DOCKER_DEPLOYMENT.md   # Docker deployment
│   └── DEPLOYMENT_1PANEL.md   # 1Panel guide
│
├── development/                # 💻 Developer Guides
│   ├── ARCHITECTURE.md        # System design
│   └── BUILD.md               # Build instructions
│
├── features/                   # 📖 Feature Docs
│   └── LIBRARY.md             # Library feature
│
├── guides/                     # 📚 User Guides
│   ├── EXTENSIONS.md          # Browser extensions
│   └── SECURITY_HEADERS.md    # Security setup
│
└── quick-reference/            # 📖 Quick Reference
    └── INDEX.md               # This file
```

---

## 🎮 Scripts Quick Reference

### Docker Deployment Scripts

| Task                         | Windows                                                    | Linux/Mac                                           |
| ---------------------------- | ---------------------------------------------------------- | --------------------------------------------------- |
| **Quick Deploy (Pre-built)** | `.\scripts\docker\deploy.ps1 -Mode prebuilt`               | `./scripts/docker/deploy.sh --mode prebuilt`        |
| **Local Build Deploy**       | `.\scripts\docker\deploy.ps1 -Mode build`                  | `./scripts/docker/deploy.sh --mode build`           |
| **Rebuild & Deploy**         | `.\scripts\docker\deploy.ps1 -Mode build -Rebuild`         | `./scripts/docker/deploy.sh --mode build --rebuild` |
| **Build & Push Images**      | `.\scripts\docker\build-and-push.ps1 -Username USER -Push` | `./scripts/docker/build-and-push.sh -u USER -p`     |
| **View Status**              | `.\scripts\docker\deploy.ps1 -Mode build -Status`          | `./scripts/docker/deploy.sh --mode build --status`  |
| **View Logs**                | `.\scripts\docker\deploy.ps1 -Mode build -Logs`            | `./scripts/docker/deploy.sh --mode build --logs`    |
| **Stop Services**            | `.\scripts\docker\deploy.ps1 -Mode build -Stop`            | `./scripts/docker/deploy.sh --mode build --stop`    |
| **Clean Up**                 | `.\scripts\docker\deploy.ps1 -Mode build -Clean`           | `./scripts/docker/deploy.sh --mode build --clean`   |

### Development Scripts

| Task                   | Windows                         | Linux/Mac                      |
| ---------------------- | ------------------------------- | ------------------------------ |
| **Start Dev Services** | `.\scripts\dev\dev.ps1 start`   | `./scripts/dev/dev.sh start`   |
| **Stop Services**      | `.\scripts\dev\dev.ps1 stop`    | `./scripts/dev/dev.sh stop`    |
| **Restart Services**   | `.\scripts\dev\dev.ps1 restart` | `./scripts/dev/dev.sh restart` |
| **Clean Everything**   | `.\scripts\dev\dev.ps1 clean`   | `./scripts/dev/dev.sh clean`   |
| **View Status**        | `.\scripts\dev\dev.ps1 status`  | `./scripts/dev/dev.sh status`  |
| **Build Backend**      | N/A                             | `./scripts/dev/build.sh`       |

**Advanced Options:**

```powershell
# Windows - Manage specific services
.\scripts\dev\dev.ps1 start -Service backend
.\scripts\dev\dev.ps1 stop -Service frontend
.\scripts\dev\dev.ps1 clean -Force  # Skip confirmation
```

```bash
# Linux/Mac - Manage specific services
./scripts/dev/dev.sh start backend
./scripts/dev/dev.sh stop frontend
```

### Makefile Commands (Linux/Mac)

```bash
make deploy      # One-click deployment
make start       # Start services
make stop        # Stop services
make restart     # Restart services
make logs        # View logs
make status      # View status
make build       # Rebuild images
make clean       # Full cleanup
make backup      # Backup database
```

---

## 📊 Documentation by Category

### 🚀 Deployment

| Document                                                   | Description                | Audience              |
| ---------------------------------------------------------- | -------------------------- | --------------------- |
| [QUICKSTART.md](../QUICKSTART.md)                          | Quick start guide          | Everyone              |
| [DOCKER_DEPLOYMENT.md](../deployment/DOCKER_DEPLOYMENT.md) | Docker deployment & config | DevOps, System Admins |
| [DEPLOYMENT_1PANEL.md](../DEPLOYMENT_1PANEL.md)            | 1Panel deployment guide    | 1Panel Users          |

**Start with:** QUICKSTART.md

### 💻 Development

| Document                                          | Description                  | Audience   |
| ------------------------------------------------- | ---------------------------- | ---------- |
| [ARCHITECTURE.md](../development/ARCHITECTURE.md) | System architecture & design | Developers |
| [BUILD.md](../development/BUILD.md)               | Build from source            | Developers |

**Start with:** ARCHITECTURE.md

### 📡 API

| Document            | Description                          | Audience                |
| ------------------- | ------------------------------------ | ----------------------- |
| [API.md](../API.md) | Complete API reference with examples | Developers, Integrators |

**Includes:** Endpoints, request/response formats, code examples in JavaScript, Python, cURL

### 📚 Guides

| Document                                             | Description                | Audience      |
| ---------------------------------------------------- | -------------------------- | ------------- |
| [EXTENSIONS.md](../guides/EXTENSIONS.md)             | Browser extension features | End Users     |
| [SECURITY_HEADERS.md](../guides/SECURITY_HEADERS.md) | Security configuration     | System Admins |

### 📝 Reference

| Document                        | Description                     | Audience |
| ------------------------------- | ------------------------------- | -------- |
| [CHANGELOG.md](../CHANGELOG.md) | Version history & release notes | Everyone |
| [LICENSE](../../LICENSE)        | GPL-3.0 license terms           | Everyone |

---

## 🔍 Find What You Need

### "How do I deploy Myriad?"

→ [QUICKSTART.md](../QUICKSTART.md)

### "I want to use pre-built Docker images"

→ [deployment/DOCKER_DEPLOYMENT.md](../deployment/DOCKER_DEPLOYMENT.md) - Quick Start section

### "How do I build Docker images?"

→ [deployment/DOCKER_DEPLOYMENT.md](../deployment/DOCKER_DEPLOYMENT.md) - Building section

### "What configuration options are available?"

→ [deployment/DOCKER_DEPLOYMENT.md](../deployment/DOCKER_DEPLOYMENT.md) - Configuration section

### "How do I use the API?"

→ [API.md](../API.md)

### "What's the system architecture?"

→ [development/ARCHITECTURE.md](../development/ARCHITECTURE.md)

### "How do I build from source?"

→ [development/BUILD.md](../development/BUILD.md)

### "What changed in the latest version?"

→ [CHANGELOG.md](../CHANGELOG.md)

### "How do I contribute?"

→ [development/BUILD.md](../development/BUILD.md) + [development/ARCHITECTURE.md](../development/ARCHITECTURE.md)

### "How do I secure my deployment?"

→ [guides/SECURITY_HEADERS.md](../guides/SECURITY_HEADERS.md)

### "Where are all the scripts?"

→ See [Scripts Quick Reference](#-scripts-quick-reference) above

---

## 💡 Documentation Tips

### For New Users

1. **Start simple:** Read [QUICKSTART.md](../QUICKSTART.md)
2. **Try it:** Run deployment script
3. **Explore:** Use the application
4. **Deep dive:** Read other docs as needed

### For Developers

1. **Understand design:** [ARCHITECTURE.md](../development/ARCHITECTURE.md)
2. **Set up environment:** [BUILD.md](../development/BUILD.md)
3. **Learn API:** [API.md](../API.md)
4. **Start coding:** Explore `backend/src/` and `frontend/src/`

### For DevOps

1. **Quick deploy:** [QUICKSTART.md](../QUICKSTART.md)
2. **Production setup:** [DOCKER_DEPLOYMENT.md](../deployment/DOCKER_DEPLOYMENT.md)
3. **Security:** [SECURITY_HEADERS.md](../guides/SECURITY_HEADERS.md)

---

## 🆘 Getting Help

### Documentation Issues

- **Outdated info?** Check [CHANGELOG.md](../CHANGELOG.md) for recent changes
- **Missing details?** Search within documents (Ctrl+F)
- **Need examples?** See [API.md](../API.md) for code samples

### Technical Issues

1. Check relevant troubleshooting section in docs
2. View logs: `docker-compose logs`
3. Search [GitHub Issues](https://github.com/mirai-mamori/Myriad/issues)
4. Open new issue with details

### Contributing to Docs

Found an error or want to improve documentation?

1. All docs are in Markdown format
2. Follow existing style and structure
3. Test all commands before documenting
4. Include examples for both Windows and Linux
5. Submit pull request on GitHub

---

## 📈 Documentation Statistics

| Category        | Files | Total Lines     |
| --------------- | ----- | --------------- |
| **Deployment**  | 2     | ~1200           |
| **Development** | 2     | ~800            |
| **API**         | 1     | ~700            |
| **Guides**      | 2     | ~400            |
| **Reference**   | 2     | ~500            |
| **Total**       | **9** | **~3600 lines** |

---

## 🌟 Quick Start Checklist

- [ ] Docker Desktop installed
- [ ] Repository cloned
- [ ] Read [QUICKSTART.md](../QUICKSTART.md)
- [ ] Run deployment script
- [ ] Access http://localhost:4321
- [ ] Complete setup wizard
- [ ] Configure platform integrations
- [ ] Explore dashboard
- [ ] Read [API.md](../API.md) for integrations

---

**Documentation Version:** 1.1  
**Last Updated:** 2025-01-05  
**Maintainer:** Myriad Team

**Have questions?** Open an issue on [GitHub](https://github.com/mirai-mamori/Myriad/issues)
