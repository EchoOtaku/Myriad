#!/bin/bash
# ============================================
# Myriad Restart Script (Linux/macOS)
# ============================================
# Description: Restart backend and frontend services
# Usage: ./scripts/restart.sh [backend|frontend|all]

set -e

SERVICE="${1:-all}"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo "================================"
echo "  Myriad Restart Service"
echo "================================"
echo ""

stop_backend() {
    echo -e "${YELLOW}Stopping backend services...${NC}"
    pkill -f "myriad-backend" || true
    pkill -f "cargo run" || true
    echo -e "${GREEN}✓ Backend stopped${NC}"
}

stop_frontend() {
    echo -e "${YELLOW}Stopping frontend services...${NC}"
    pkill -f "astro dev" || true
    pkill -f "vite" || true
    echo -e "${GREEN}✓ Frontend stopped${NC}"
}

start_backend() {
    echo -e "${YELLOW}Starting backend...${NC}"
    cd backend
    nohup cargo run > ../logs/backend.log 2>&1 &
    cd ..
    echo -e "${GREEN}✓ Backend starting...${NC}"
}

start_frontend() {
    echo -e "${YELLOW}Starting frontend...${NC}"
    cd frontend
    nohup npm run dev > ../logs/frontend.log 2>&1 &
    cd ..
    echo -e "${GREEN}✓ Frontend starting...${NC}"
}

# Create logs directory if it doesn't exist
mkdir -p logs

# Execute restart based on service parameter
case "$SERVICE" in
    backend)
        stop_backend
        sleep 1
        start_backend
        ;;
    frontend)
        stop_frontend
        sleep 1
        start_frontend
        ;;
    all)
        stop_backend
        stop_frontend
        sleep 2
        start_backend
        start_frontend
        ;;
    *)
        echo "Usage: $0 [backend|frontend|all]"
        exit 1
        ;;
esac

echo ""
echo "================================"
echo -e "${GREEN}  Restart Complete!${NC}"
echo "================================"
echo ""
echo -e "Services restarted: ${CYAN}$SERVICE${NC}"
echo -e "Backend: ${CYAN}http://localhost:3000${NC}"
echo -e "Frontend: ${CYAN}http://localhost:4321${NC}"
echo ""
echo -e "${YELLOW}Logs:${NC}"
echo -e "  Backend: ${CYAN}logs/backend.log${NC}"
echo -e "  Frontend: ${CYAN}logs/frontend.log${NC}"
