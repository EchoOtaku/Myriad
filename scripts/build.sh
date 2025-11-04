#!/bin/bash
# ============================================
# Myriad Build Script (Linux/macOS)
# ============================================
# Description: Build backend and frontend for production
# Usage: ./scripts/build.sh

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

# Build Backend
echo -e "${YELLOW}[1/2] Building Rust backend...${NC}"
cd backend
cargo build --release
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Backend built successfully${NC}"
else
    echo -e "${RED}✗ Backend build failed${NC}"
    exit 1
fi
cd ..

echo ""

# Build Frontend
echo -e "${YELLOW}[2/2] Building Astro frontend...${NC}"
cd frontend
npm run build
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
echo -e "Backend binary: ${CYAN}backend/target/release/myriad-backend${NC}"
echo -e "Frontend dist: ${CYAN}frontend/dist/${NC}"
echo ""
echo -e "${YELLOW}To start production server:${NC}"
echo -e "  ${CYAN}./scripts/start-prod.sh${NC}"
