# Myriad

> Multi-platform personal information aggregation and AI-powered analysis platform

[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](LICENSE)

## 🚀 Quick Start

### Option 1: Pre-built Docker Images (Fastest, Recommended ⭐)

Deploy in 2-3 minutes using pre-built images from Docker Hub:

```powershell
# Windows
.\scripts\docker\deploy.ps1 -Mode prebuilt

# Linux/Mac
./scripts/docker/deploy.sh --mode prebuilt
```

### Option 2: Local Build (For Development)

```powershell
# Windows
.\scripts\docker\deploy.ps1 -Mode build

# Linux/Mac
./scripts/docker/deploy.sh --mode build
```

### 📚 Documentation

- 📖 **[Documentation Portal](./docs/quick-reference/INDEX.md)** - Central documentation hub
- 🚀 **[Getting Started](./docs/deployment/GETTING_STARTED.md)** - Deploy in 5 minutes
- 🌐 **[Production Deployment](./docs/deployment/PRODUCTION_DEPLOY.md)** - Complete production setup guide
- 🐳 **[Docker Guide](./docs/deployment/DOCKER_GUIDE.md)** - Build & publish images
- 📡 **[API Documentation](./docs/API.md)** - Complete API reference
- 🏗️ **[Architecture](./docs/development/ARCHITECTURE.md)** - System design
- 🔧 **[Advanced Deployment](./docs/deployment/DOCKER_DEPLOYMENT.md)** - Production configuration
- 📝 **[Changelog](./docs/CHANGELOG.md)** - Version history

---

## 🌟 Features

- **Multi-Platform Integration**: Connect and aggregate data from GitHub, Twitter/X, LinkedIn, and more
- **AI-Powered Analysis**: Use Google Gemini to analyze your digital presence and generate insights
- **Beautiful Visualizations**: Interactive dashboards and charts to visualize your data
- **Unified Database**: PostgreSQL-based centralized storage for all your platform data
- **Modern Tech Stack**: Built with Astro (frontend) and Rust (backend) for maximum performance
- **Easy Deployment**: Docker support for simple containerized deployment

## 🏗️ Architecture

```
Myriad/
├── frontend/               # Astro + React + Tailwind CSS
├── backend/                # Rust + Axum + SeaORM
├── database/               # PostgreSQL schema
├── docker/                 # Docker configuration
├── scripts/                # Automation scripts
│   ├── docker/            # Docker deployment scripts
│   └── dev/               # Development scripts
└── docs/                   # Documentation
    ├── deployment/        # Deployment guides
    ├── development/       # Development guides
    ├── guides/            # User guides
    └── API.md             # API documentation
```

### Technology Stack

**Frontend:**

- Astro 4.x - Static site generator
- React 18 - UI components
- Tailwind CSS - Styling
- TypeScript - Type safety
- Chart.js - Data visualization

**Backend:**

- Rust 1.75+ - Systems programming language
- Axum 0.7 - Web framework
- SeaORM 0.12 - Database ORM
- Tokio - Async runtime
- google-generativeai - Google Gemini API client

**Database:**

- PostgreSQL 16+ - Primary database

**DevOps:**

- Docker & Docker Compose - Containerization
- Multi-platform scripts (PowerShell & Bash)

## 💻 Manual Setup (Advanced Users)

For development or manual setup without Docker, see [docs/development/BUILD.md](./docs/development/BUILD.md).

### Prerequisites

- [Rust](https://rustup.rs/) (1.75 or later)
- [Node.js](https://nodejs.org/) (20 or later)
- [PostgreSQL](https://www.postgresql.org/) (16 or later) or Docker
- Git

### Installation

1. **Clone the repository:**

   ```powershell
   git clone https://github.com/yourusername/Myriad.git
   cd Myriad
   ```

2. **Run the setup script:**

   ```powershell
   .\scripts\setup.ps1
   ```

3. **Configure environment variables:**
   Copy the example file and edit with your credentials:

   ```powershell
   # Copy template
   cp backend/.env.example backend/.env

   # Edit backend/.env with required values
   ```

   Minimum required configuration:

   ```env
   # Database
   DATABASE_URL=postgres://myriad:password@localhost:5432/myriad

   # Server
   SERVER_HOST=127.0.0.1
   SERVER_PORT=3000
   RUST_LOG=info

   # Security
   JWT_SECRET=your-secret-key-here  # Generate with: openssl rand -hex 32
   ```

   Optional GitHub OAuth configuration:

   ```env
   # GitHub OAuth (可选 - 用于额外用户登录和管理员账户绑定)
   GITHUB_CLIENT_ID=your_github_client_id
   GITHUB_CLIENT_SECRET=your_github_client_secret
   GITHUB_REDIRECT_URL=http://localhost:3000/api/auth/github/callback
   FRONTEND_URL=http://localhost:4321
   ```

4. **Initialize the system:**

   Visit `http://localhost:4321/setup` and follow the guided setup:

   - **Step 1: Database Initialization** - Set up PostgreSQL tables
   - **Step 2: Create Admin Account** - Create your local administrator account

   After setup, login at `http://localhost:4321/login`

   # GitHub OAuth (required for login)

   GITHUB_CLIENT_ID=your_client_id
   GITHUB_CLIENT_SECRET=your_client_secret
   GITHUB_REDIRECT_URL=http://localhost:3000/api/auth/github/callback
   FRONTEND_URL=http://localhost:4321

   # AI Service (required for analysis)

   GEMINI_API_KEY=your_api_key_here
   GEMINI_MODEL=gemini-2.0-flash-exp

   ```

   ```

5. **Set up the database:**

   **Option A - Using Docker (Recommended):**

   ```powershell
   docker-compose up -d postgres
   ```

   **Option B - Local PostgreSQL:**

   ```powershell
   createdb myriad
   psql myriad < database/schema.sql
   ```

6. **Start development servers:**

   ```powershell
   .\scripts\dev.ps1
   ```

7. **Access the application:**
   - Frontend: http://localhost:4321
   - Backend API: http://localhost:3000
   - Health Check: http://localhost:3000/health

## 📖 Documentation

- [Architecture Overview](docs/ARCHITECTURE.md)
- [API Documentation](docs/API.md)
- [Deployment Guide](docs/DEPLOYMENT.md)
- [Database Schema](database/README.md)

## 🔧 Development

### Available Scripts

```powershell
# Setup development environment
.\scripts\setup.ps1

# Start development servers (backend + frontend)
.\scripts\dev.ps1

# Build for production
.\scripts\build.ps1
```

### Backend Development

```powershell
cd backend

# Run backend
cargo run

# Run tests
cargo test

# Check for errors
cargo check

# Run with release optimizations
cargo run --release
```

### Frontend Development

```powershell
cd frontend

# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## 🐳 Docker Deployment

### Full Stack Deployment

```powershell
# Build and start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop all services
docker-compose down
```

### Individual Services

```powershell
# Start only PostgreSQL
docker-compose up -d postgres

# Start backend
docker-compose up -d backend

# Start frontend
docker-compose up -d frontend
```

## 🔑 Configuration

### Platform API Keys

To use platform integrations, you need to obtain API keys:

1. **GitHub**: Create a [Personal Access Token](https://github.com/settings/tokens)
2. **Google Gemini**: Get an API key from [Google AI Studio](https://makersuite.google.com/app/apikey)
3. **Twitter/X**: Apply for [Developer Access](https://developer.twitter.com/)
4. **LinkedIn**: Create an app in [LinkedIn Developers](https://www.linkedin.com/developers/)

Add these keys to `backend/.env`.

## 📊 Features Roadmap

- [x] Basic project structure
- [x] Database schema design
- [x] Backend API framework
- [x] Frontend UI components
- [ ] GitHub integration
- [ ] Twitter/X integration
- [ ] LinkedIn integration
- [ ] AI analysis engine
- [ ] Data visualization dashboards
- [ ] User authentication (optional)
- [ ] Export functionality
- [ ] Scheduled data fetching
- [ ] Custom platform plugins

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the GNU General Public License v3.0 - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built with [Astro](https://astro.build/)
- Powered by [Rust](https://www.rust-lang.org/)
- Styled with [Tailwind CSS](https://tailwindcss.com/)
- Database: [PostgreSQL](https://www.postgresql.org/)
- AI: [Google Gemini](https://ai.google.dev/)

## 📧 Contact

For questions or support, please open an issue on GitHub.

---

**Note**: This project is in active development. Features and documentation may change frequently.
