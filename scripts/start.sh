#!/bin/bash
# ============================================
# Myriad Start Script (Linux/macOS)
# ============================================
# Description: Start backend and frontend services
# Usage: ./scripts/start.sh

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
GRAY='\033[0;37m'
NC='\033[0m'

echo "================================"
echo "  Starting Myriad Services"
echo "================================"
echo ""

# Get project root
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"

# Check if services are already running
BACKEND_RUNNING=$(pgrep -f "myriad-backend|cargo run" | wc -l)
FRONTEND_RUNNING=$(pgrep -f "astro dev|vite" | wc -l)

if [ "$BACKEND_RUNNING" -gt 0 ] || [ "$FRONTEND_RUNNING" -gt 0 ]; then
    echo -e "${YELLOW}⚠️  Warning: Some services are already running${NC}"
    echo ""
    echo -e "${YELLOW}Do you want to stop existing services and restart? (y/N)${NC}"
    read -r response
    if [[ "$response" =~ ^[Yy]$ ]]; then
        echo -e "${YELLOW}Stopping existing services...${NC}"
        pkill -f "myriad-backend" || true
        pkill -f "cargo run" || true
        pkill -f "astro dev" || true
        pkill -f "vite" || true
        sleep 2
    else
        echo -e "${RED}Cancelled. Existing services still running.${NC}"
        exit 0
    fi
fi

# Create logs directory
mkdir -p "$PROJECT_ROOT/logs"

# Start Backend
echo -e "${YELLOW}[1/2] Starting Backend...${NC}"
cd "$PROJECT_ROOT/backend"
nohup cargo run > "$PROJECT_ROOT/logs/backend.log" 2>&1 &
BACKEND_PID=$!
echo -e "${GREEN}✓ Backend started (PID: $BACKEND_PID)${NC}"
sleep 2

# Start Frontend
echo -e "${YELLOW}[2/2] Starting Frontend...${NC}"
cd "$PROJECT_ROOT/frontend"
nohup npm run dev > "$PROJECT_ROOT/logs/frontend.log" 2>&1 &
FRONTEND_PID=$!
echo -e "${GREEN}✓ Frontend started (PID: $FRONTEND_PID)${NC}"

echo ""
echo "================================"
echo -e "${GREEN}  Services Started!${NC}"
echo "================================"
echo ""
echo -e "${CYAN}Process IDs:${NC}"
echo -e "  Backend:  ${WHITE}$BACKEND_PID${NC}"
echo -e "  Frontend: ${WHITE}$FRONTEND_PID${NC}"
echo ""
echo -e "${YELLOW}URLs (wait ~10 seconds for startup):${NC}"
echo -e "  Frontend: ${WHITE}http://localhost:4321${NC}"
echo -e "  Backend:  ${WHITE}http://localhost:3000${NC}"
echo -e "  Health:   ${WHITE}http://localhost:3000/health${NC}"
echo ""
echo -e "${CYAN}Logs:${NC}"
echo -e "  Backend:  ${GRAY}tail -f logs/backend.log${NC}"
echo -e "  Frontend: ${GRAY}tail -f logs/frontend.log${NC}"
echo ""
echo -e "${YELLOW}To stop all services:${NC}"
echo -e "  ${WHITE}./scripts/stop.sh${NC}"
echo ""
echo -e "${GREEN}Services running in background!${NC}"
