# Myriad Backend

Official Docker image for the Myriad backend service - a unified personal data analytics platform.

## Quick Start

```bash
docker pull miraimamori/myriad-backend:latest
docker run -p 3000:3000 miraimamori/myriad-backend:latest
```

## Supported Tags

- `latest` - Latest stable release
- `preview` - Preview/development build
- `v*.*.*` - Specific version tags

## What is Myriad?

Myriad is a unified personal data analytics platform that helps you aggregate and analyze data from multiple platforms including Steam, Bilibili, and more. The backend service provides a REST API for data fetching, analysis, and user management.

## Features

- 🔐 Authentication with local and OAuth2 support
- 📊 Multi-platform data aggregation
- 🤖 AI-powered data analysis
- 📈 Comprehensive analytics and reporting
- 🗃️ PostgreSQL database with migration support
- 🔒 Secure configuration management

## Environment Variables

### Required

- `DATABASE_URL` - PostgreSQL connection string
- `JWT_SECRET` - Secret key for JWT tokens
- `OPENAI_API_KEY` - OpenAI API key for analysis features

### Optional

- `RUST_LOG` - Log level (default: `info`)
- `PORT` - Server port (default: `3000`)
- `FRONTEND_URL` - Frontend URL for CORS (default: `http://localhost:4321`)

## Docker Compose Example

```yaml
version: "3.8"
services:
  backend:
    image: miraimamori/myriad-backend:latest
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgres://user:password@db:5432/myriad
      JWT_SECRET: your-secret-key
      OPENAI_API_KEY: your-openai-key
    depends_on:
      - db

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: myriad
      POSTGRES_USER: user
      POSTGRES_PASSWORD: password
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

## Health Check

The container includes a health check endpoint:

```bash
curl http://localhost:3000/api/health
```

## Volumes

- `/app/cache` - Cache directory for platform data and reports

## Security

- Runs as non-root user (`myriad`)
- Minimal Alpine-based image
- Security headers enabled
- Regular security updates

## Documentation

- [Full Documentation](https://github.com/mirai-mamori/Myriad)
- [API Reference](https://github.com/mirai-mamori/Myriad/blob/main/docs/API.md)
- [Deployment Guide](https://github.com/mirai-mamori/Myriad/blob/main/docs/deployment/DOCKER_GUIDE.md)

## Source Code

https://github.com/mirai-mamori/Myriad

## License

MIT License - see LICENSE file for details

## Support

- Issues: https://github.com/mirai-mamori/Myriad/issues
- Discussions: https://github.com/mirai-mamori/Myriad/discussions
