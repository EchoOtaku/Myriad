#!/bin/bash
# ============================================
# Myriad Stop Script (Linux/macOS)
# ============================================
# Description: Stop all Myriad services
# Usage: ./scripts/stop.sh

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
GRAY='\033[0;37m'
NC='\033[0m'

echo "================================"
echo "  Stopping Myriad Services"
echo "================================"
echo ""

# Stop Backend
echo -e "${YELLOW}Stopping backend services...${NC}"
BACKEND_COUNT=$(pgrep -f "myriad-backend|cargo run" | wc -l)
pkill -f "myriad-backend" || true
pkill -f "cargo run" || true

if [ "$BACKEND_COUNT" -gt 0 ]; then
    echo -e "${GREEN}✓ Backend stopped ($BACKEND_COUNT processes)${NC}"
else
    echo -e "${GRAY}✓ No backend processes running${NC}"
fi

# Stop Frontend
echo -e "${YELLOW}Stopping frontend services...${NC}"
FRONTEND_COUNT=$(pgrep -f "astro dev|vite" | wc -l)
pkill -f "astro dev" || true
pkill -f "vite" || true

if [ "$FRONTEND_COUNT" -gt 0 ]; then
    echo -e "${GREEN}✓ Frontend stopped ($FRONTEND_COUNT processes)${NC}"
else
    echo -e "${GRAY}✓ No frontend processes running${NC}"
fi

echo ""
echo "================================"
echo -e "${GREEN}  All Services Stopped${NC}"
echo "================================"
