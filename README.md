# Myriad

> Multi-platform personal information aggregation and AI-powered analysis platform

[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](LICENSE)

## 🌟 Features

- **Multi-Platform Integration**: Connect and aggregate data from GitHub, Twitter/X, LinkedIn, and more
- **AI-Powered Analysis**: Use OpenAI GPT-4 to analyze your digital presence and generate insights
- **Beautiful Visualizations**: Interactive dashboards and charts to visualize your data
- **Unified Database**: PostgreSQL-based centralized storage for all your platform data
- **Modern Tech Stack**: Built with Astro (frontend) and Rust (backend) for maximum performance
- **Easy Deployment**: Docker support for simple containerized deployment

## 🏗️ Architecture

```
Myriad/
├── frontend/          # Astro + React + Tailwind CSS
├── backend/           # Rust + Axum + SeaORM
├── database/          # PostgreSQL schema and migrations
├── scripts/           # Development and build scripts
├── docker/            # Docker configuration files
└── docs/              # Documentation
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
- async-openai - OpenAI API client

**Database:**
- PostgreSQL 16+ - Primary database

**DevOps:**
- Docker & Docker Compose - Containerization
- PowerShell scripts - Automation

## 🚀 Quick Start

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
   Edit `backend/.env` with your API keys and database credentials:
   ```env
   DATABASE_URL=postgres://myriad:password@localhost:5432/myriad
   OPENAI_API_KEY=sk-your-api-key-here
   GITHUB_TOKEN=ghp_your-github-token-here
   # ... other configuration
   ```

4. **Set up the database:**

   **Option A - Using Docker (Recommended):**
   ```powershell
   docker-compose up -d postgres
   ```

   **Option B - Local PostgreSQL:**
   ```powershell
   createdb myriad
   psql myriad < database/schema.sql
   ```

5. **Start development servers:**
   ```powershell
   .\scripts\dev.ps1
   ```

6. **Access the application:**
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
2. **OpenAI**: Get an API key from [OpenAI Platform](https://platform.openai.com/)
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
- AI: [OpenAI](https://openai.com/)

## 📧 Contact

For questions or support, please open an issue on GitHub.

---

**Note**: This project is in active development. Features and documentation may change frequently.
