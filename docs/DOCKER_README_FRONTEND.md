# Myriad Frontend

Official Docker image for the Myriad frontend application - a modern web interface for personal data analytics.

## Quick Start

```bash
docker pull miraimamori/myriad-frontend:latest
docker run -p 4321:4321 miraimamori/myriad-frontend:latest
```

## Supported Tags

- `latest` - Latest stable release
- `preview` - Preview/development build
- `v*.*.*` - Specific version tags

## What is Myriad?

Myriad is a unified personal data analytics platform that helps you aggregate and analyze data from multiple platforms. The frontend provides an intuitive web interface built with Astro, React, and TailwindCSS.

## Features

- 🎨 Modern, responsive UI
- 📊 Interactive data visualizations
- 🔐 Secure authentication
- 📱 Mobile-friendly design
- ⚡ Fast static site generation with Astro
- 🎯 Real-time data updates

## Environment Variables

### Optional

- `PUBLIC_API_URL` - Backend API URL (build-time only, default: `http://localhost:3000`)

**Note:** The `PUBLIC_API_URL` must be set at build time. Use Docker build args to customize:

```bash
docker build --build-arg BACKEND_URL=https://api.example.com -t myriad-frontend .
```

## Docker Compose Example

```yaml
version: "3.8"
services:
  frontend:
    image: miraimamori/myriad-frontend:latest
    ports:
      - "4321:4321"
    depends_on:
      - backend

  backend:
    image: miraimamori/myriad-backend:latest
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgres://user:password@db:5432/myriad
      JWT_SECRET: your-secret-key
```

## Health Check

The container includes a health check that verifies the service is responding:

```bash
curl http://localhost:4321
```

## Port

The frontend service listens on port `4321` by default.

## Security

- Runs as non-root user (`myriad`)
- Minimal Alpine-based image
- Static file serving with `serve`
- Regular security updates

## Building with Custom Backend URL

To build the frontend with a custom backend URL:

```bash
docker build \
  --build-arg BACKEND_URL=https://api.example.com \
  -t myriad-frontend:custom \
  -f docker/Dockerfile.frontend .
```

## Technology Stack

- **Astro** - Static site generator
- **React** - UI components
- **TailwindCSS** - Styling
- **TypeScript** - Type safety
- **Serve** - Static file server

## Documentation

- [Full Documentation](https://github.com/mirai-mamori/Myriad)
- [Getting Started](https://github.com/mirai-mamori/Myriad/blob/main/docs/deployment/GETTING_STARTED.md)
- [Deployment Guide](https://github.com/mirai-mamori/Myriad/blob/main/docs/deployment/DOCKER_GUIDE.md)

## Source Code

https://github.com/mirai-mamori/Myriad

## License

MIT License - see LICENSE file for details

## Support

- Issues: https://github.com/mirai-mamori/Myriad/issues
- Discussions: https://github.com/mirai-mamori/Myriad/discussions
