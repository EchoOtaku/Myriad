#!/bin/bash
# ============================================
# Myriad Build Script (Linux/macOS)
# ============================================
# Description: Build backend and frontend for production
# Usage: ./scripts/dev/build.sh

set -e

echo "================================"
echo "  Myriad Production Build"
echo "================================"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Build Backend (virtual workspace root: single Cargo.lock + target/)
echo -e "${YELLOW}[1/2] Building Rust backend...${NC}"
cargo build -p myriad-backend --release
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Backend built successfully${NC}"
else
    echo -e "${RED}✗ Backend build failed${NC}"
    exit 1
fi

echo ""

# Build Frontend
echo -e "${YELLOW}[2/2] Building Astro frontend...${NC}"
cd frontend
pnpm run build
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Frontend built successfully${NC}"
else
    echo -e "${RED}✗ Frontend build failed${NC}"
    exit 1
fi
cd ..

echo ""
echo "================================"
echo -e "${GREEN}  Build Complete!${NC}"
echo "================================"
echo ""
echo -e "Backend binary: ${CYAN}target/release/myriad-backend${NC}"
echo -e "Frontend dist: ${CYAN}frontend/dist/${NC}"
echo ""
echo -e "${YELLOW}For production stack:${NC}"
echo -e "  ${CYAN}bash scripts/docker/deploy.sh up${NC}"
