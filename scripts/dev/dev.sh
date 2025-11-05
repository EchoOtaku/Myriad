#!/bin/bash
# ============================================
# Myriad Development Script (Linux/macOS)
# ============================================
# Unified script for all development operations
# Usage: ./dev.sh <command> [options]

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
GRAY='\033[0;37m'
NC='\033[0m'

# Get project root
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Helper functions
print_header() {
    echo ""
    echo -e "${CYAN}================================${NC}"
    echo -e "${CYAN}  $1${NC}"
    echo -e "${CYAN}================================${NC}"
    echo ""
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_info() {
    echo -e "${YELLOW}→ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

# ====================
# START Command
# ====================
start_services() {
    local service="${1:-all}"
    print_header "Starting Myriad Services"
    
    # Check if services are running
    local backend_running=$(pgrep -f "myriad-backend|cargo run" || true)
    local frontend_running=$(pgrep -f "astro dev|vite" || true)
    
    if [[ (-n "$backend_running" && ("$service" == "all" || "$service" == "backend")) || \
          (-n "$frontend_running" && ("$service" == "all" || "$service" == "frontend")) ]]; then
        echo -e "${YELLOW}⚠️  Warning: Some services are already running${NC}"
        read -p "Stop and restart them? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            return
        fi
        stop_services "$service"
        sleep 2
    fi
    
    # Start Backend
    if [[ "$service" == "all" || "$service" == "backend" ]]; then
        print_info "Starting Backend..."
        cd "$PROJECT_ROOT/backend"
        
        # Start in new terminal
        if command -v gnome-terminal &> /dev/null; then
            gnome-terminal -- bash -c "echo '🦀 Myriad Backend'; cargo run; exec bash"
        elif command -v konsole &> /dev/null; then
            konsole -e bash -c "echo '🦀 Myriad Backend'; cargo run; exec bash" &
        elif [[ "$OSTYPE" == "darwin"* ]]; then
            osascript -e 'tell application "Terminal" to do script "cd '"$PROJECT_ROOT/backend"' && echo \"🦀 Myriad Backend\" && cargo run"'
        else
            # Fallback: run in background
            nohup cargo run > "$PROJECT_ROOT/backend.log" 2>&1 &
            echo "Backend started in background. Logs: $PROJECT_ROOT/backend.log"
        fi
        
        print_success "Backend starting"
        sleep 2
    fi
    
    # Start Frontend
    if [[ "$service" == "all" || "$service" == "frontend" ]]; then
        print_info "Starting Frontend..."
        cd "$PROJECT_ROOT/frontend"
        
        # Start in new terminal
        if command -v gnome-terminal &> /dev/null; then
            gnome-terminal -- bash -c "echo '⚡ Myriad Frontend'; npm run dev; exec bash"
        elif command -v konsole &> /dev/null; then
            konsole -e bash -c "echo '⚡ Myriad Frontend'; npm run dev; exec bash" &
        elif [[ "$OSTYPE" == "darwin"* ]]; then
            osascript -e 'tell application "Terminal" to do script "cd '"$PROJECT_ROOT/frontend"' && echo \"⚡ Myriad Frontend\" && npm run dev"'
        else
            # Fallback: run in background
            nohup npm run dev > "$PROJECT_ROOT/frontend.log" 2>&1 &
            echo "Frontend started in background. Logs: $PROJECT_ROOT/frontend.log"
        fi
        
        print_success "Frontend starting"
    fi
    
    echo ""
    print_success "Services Started!"
    echo -e "\nURLs (wait ~10 seconds for startup):"
    echo "  Frontend: http://localhost:4321"
    echo "  Backend:  http://localhost:3000"
    echo "  Health:   http://localhost:3000/health"
    echo ""
}

# ====================
# STOP Command
# ====================
stop_services() {
    local service="${1:-all}"
    print_header "Stopping Myriad Services"
    
    local stopped_count=0
    
    # Stop Backend
    if [[ "$service" == "all" || "$service" == "backend" ]]; then
        print_info "Stopping backend services..."
        pkill -f "myriad-backend" && ((stopped_count++)) || true
        pkill -f "cargo run" && ((stopped_count++)) || true
        print_success "Backend stopped"
    fi
    
    # Stop Frontend
    if [[ "$service" == "all" || "$service" == "frontend" ]]; then
        print_info "Stopping frontend services..."
        pkill -f "astro dev" && ((stopped_count++)) || true
        pkill -f "vite" && ((stopped_count++)) || true
        pkill -f "npm run dev" && ((stopped_count++)) || true
        print_success "Frontend stopped"
    fi
    
    echo ""
    if [[ $stopped_count -gt 0 ]]; then
        print_success "Stopped $stopped_count process(es)"
    else
        echo -e "${GRAY}No services were running${NC}"
    fi
    echo ""
}

# ====================
# RESTART Command
# ====================
restart_services() {
    local service="${1:-all}"
    print_header "Restarting Myriad Services"
    stop_services "$service"
    sleep 2
    start_services "$service"
}

# ====================
# CLEAN Command
# ====================
clean_project() {
    print_header "Myriad Clean Tool"
    
    echo -e "${YELLOW}WARNING: This will delete:${NC}"
    echo "  - Database data (drop all tables)"
    echo "  - Backend build files (target/)"
    echo "  - Frontend build files (frontend/dist/)"
    echo "  - Cache files (backend/cache/)"
    echo "  - Environment config (backend/.env)"
    echo ""
    
    read -p "Type 'yes' to continue: " -r
    if [[ ! $REPLY == "yes" ]]; then
        print_info "Operation cancelled"
        return
    fi
    
    echo ""
    echo -e "${CYAN}Starting cleanup...${NC}"
    
    # 1. Clear database
    print_info "[1/5] Clearing database..."
    if docker ps --filter "name=myriad-postgres" --format "{{.Names}}" | grep -q "myriad-postgres"; then
        docker exec myriad-postgres psql -U myriad -d myriad -c "
DO \$\$ DECLARE r RECORD;
BEGIN
    FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
    END LOOP;
END \$\$;" > /dev/null 2>&1
        print_success "Database tables dropped"
    else
        echo -e "${GRAY}  Database not running${NC}"
    fi
    
    # 2. Delete backend build files
    print_info "[2/5] Deleting backend build files..."
    if [[ -d "$PROJECT_ROOT/backend/target" ]]; then
        rm -rf "$PROJECT_ROOT/backend/target"
        print_success "Backend build files deleted"
    else
        echo -e "${GRAY}  No backend build files${NC}"
    fi
    
    # 3. Delete frontend build files
    print_info "[3/5] Deleting frontend build files..."
    if [[ -d "$PROJECT_ROOT/frontend/dist" ]]; then
        rm -rf "$PROJECT_ROOT/frontend/dist"
        print_success "Frontend build files deleted"
    else
        echo -e "${GRAY}  No frontend build files${NC}"
    fi
    
    # 4. Delete cache files
    print_info "[4/5] Deleting cache files..."
    if [[ -d "$PROJECT_ROOT/backend/cache" ]]; then
        rm -f "$PROJECT_ROOT/backend/cache"/*.json 2>/dev/null || true
        print_success "Cache files deleted"
    else
        echo -e "${GRAY}  No cache files${NC}"
    fi
    
    # 5. Delete environment config
    print_info "[5/5] Deleting environment config..."
    if [[ -f "$PROJECT_ROOT/backend/.env" ]]; then
        rm -f "$PROJECT_ROOT/backend/.env"
        print_success ".env file deleted"
    else
        echo -e "${GRAY}  No .env file${NC}"
    fi
    
    echo ""
    print_success "Cleanup Complete!"
    echo -e "\nNext steps:"
    echo "  1. Run './dev.sh start' to start services"
    echo "  2. Complete setup wizard at http://localhost:4321/setup"
    echo ""
}

# ====================
# STATUS Command
# ====================
show_status() {
    print_header "Myriad Services Status"
    
    # Backend status
    if pgrep -f "myriad-backend|cargo run" > /dev/null; then
        echo -en "Backend:  "
        echo -e "${GREEN}RUNNING${NC}"
        echo -e "${GRAY}  PIDs: $(pgrep -f "myriad-backend|cargo run" | tr '\n' ' ')${NC}"
    else
        echo -en "Backend:  "
        echo -e "${RED}STOPPED${NC}"
    fi
    
    # Frontend status
    if pgrep -f "astro dev|vite|npm run dev" > /dev/null; then
        echo -en "Frontend: "
        echo -e "${GREEN}RUNNING${NC}"
        echo -e "${GRAY}  PIDs: $(pgrep -f "astro dev|vite" | tr '\n' ' ')${NC}"
    else
        echo -en "Frontend: "
        echo -e "${RED}STOPPED${NC}"
    fi
    
    echo ""
}

# ====================
# LOGS Command
# ====================
show_logs() {
    local service="${1:-all}"
    print_header "Myriad Service Logs"
    
    if [[ "$service" == "backend" ]]; then
        if [[ -f "$PROJECT_ROOT/backend.log" ]]; then
            tail -f "$PROJECT_ROOT/backend.log"
        else
            echo "Backend logs are in the terminal window where it was started"
        fi
    elif [[ "$service" == "frontend" ]]; then
        if [[ -f "$PROJECT_ROOT/frontend.log" ]]; then
            tail -f "$PROJECT_ROOT/frontend.log"
        else
            echo "Frontend logs are in the terminal window where it was started"
        fi
    else
        echo "Logs are displayed in service terminal windows"
        echo "If services were started in background:"
        echo "  Backend:  $PROJECT_ROOT/backend.log"
        echo "  Frontend: $PROJECT_ROOT/frontend.log"
    fi
    echo ""
}

# ====================
# HELP Command
# ====================
show_help() {
    echo "Myriad Development Script"
    echo ""
    echo "Usage: ./dev.sh <command> [service]"
    echo ""
    echo "Commands:"
    echo "  start [service]   - Start services (default: all)"
    echo "  stop [service]    - Stop services (default: all)"
    echo "  restart [service] - Restart services (default: all)"
    echo "  clean             - Clean build files and database"
    echo "  status            - Show service status"
    echo "  logs [service]    - Show logs (default: all)"
    echo "  help              - Show this help"
    echo ""
    echo "Services: backend, frontend, all (default)"
    echo ""
    echo "Examples:"
    echo "  ./dev.sh start              # Start all services"
    echo "  ./dev.sh start backend      # Start backend only"
    echo "  ./dev.sh stop               # Stop all services"
    echo "  ./dev.sh restart frontend   # Restart frontend only"
    echo "  ./dev.sh clean              # Clean everything"
    echo "  ./dev.sh status             # Show status"
    echo ""
}

# ====================
# Main Execution
# ====================
COMMAND="${1:-help}"
SERVICE="${2:-all}"

case "$COMMAND" in
    start)
        start_services "$SERVICE"
        ;;
    stop)
        stop_services "$SERVICE"
        ;;
    restart)
        restart_services "$SERVICE"
        ;;
    clean)
        clean_project
        ;;
    status)
        show_status
        ;;
    logs)
        show_logs "$SERVICE"
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        echo -e "${RED}Unknown command: $COMMAND${NC}"
        echo ""
        show_help
        exit 1
        ;;
esac
