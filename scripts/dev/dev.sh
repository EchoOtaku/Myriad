#!/bin/bash
# ============================================
# Myriad Development Script (Linux/macOS)
# ============================================
# Interactive development environment manager
# Usage: ./dev.sh [command] or run without args for menu

set -e

# ==================== Colors & Styles ====================
BOLD='\033[1m'
DIM='\033[2m'

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
WHITE='\033[0;37m'

# Bright Colors
BRIGHT_RED='\033[1;31m'
BRIGHT_GREEN='\033[1;32m'
BRIGHT_YELLOW='\033[1;33m'
BRIGHT_CYAN='\033[1;36m'
BRIGHT_WHITE='\033[1;37m'

NC='\033[0m' # Reset

# ==================== Project Config ====================
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VERSION="1.0.0"

# ==================== Unicode Icons ====================
ICON_CHECK="✔"
ICON_CROSS="✖"
ICON_ARROW="➜"
ICON_ROCKET="🚀"
ICON_STOP="⏹"
ICON_REFRESH="↻"
ICON_TRASH="🗑"
ICON_INFO="ℹ"
ICON_WARN="⚠"
ICON_DB="🗄"
ICON_RUST="🦀"
ICON_NODE="⬢"
ICON_HEART="❤"
ICON_SPARKLE="✨"

# ==================== Helper Functions ====================

clear_screen() {
    printf "\033[2J\033[H"
}

hide_cursor() { printf "\033[?25l"; }
show_cursor() { printf "\033[?25h"; }

get_terminal_size() {
    TERM_COLS=$(tput cols 2>/dev/null || echo 80)
}

# Draw a box
draw_box() {
    local title="$1"
    local width="${2:-60}"
    local color="${3:-$CYAN}"
    
    echo -en "${color}╭"
    printf '%*s' "$((width-2))" | tr ' ' "─"
    echo -e "╮${NC}"
    
    if [[ -n "$title" ]]; then
        local title_len=${#title}
        local padding=$(( (width - title_len - 4) / 2 ))
        echo -en "${color}│${NC}"
        printf '%*s' "$padding" ""
        echo -en "${BOLD}${BRIGHT_WHITE} ${title} ${NC}"
        printf '%*s' "$((width - padding - title_len - 4))" ""
        echo -e "${color}│${NC}"
        
        echo -en "${color}├"
        printf '%*s' "$((width-2))" | tr ' ' "─"
        echo -e "┤${NC}"
    fi
}

draw_box_bottom() {
    local width="${1:-60}"
    local color="${2:-$CYAN}"
    echo -en "${color}╰"
    printf '%*s' "$((width-2))" | tr ' ' "─"
    echo -e "╯${NC}"
}

draw_box_line() {
    local text="$1"
    local width="${2:-60}"
    local color="${3:-$CYAN}"
    
    # Remove ANSI codes for length calculation
    local clean_text=$(echo -e "$text" | sed 's/\x1b\[[0-9;]*m//g')
    local text_len=${#clean_text}
    
    echo -en "${color}│${NC} ${text}"
    local padding=$((width - text_len - 3))
    [[ $padding -gt 0 ]] && printf '%*s' "$padding" ""
    echo -e "${color}│${NC}"
}

# Progress bar
progress_bar() {
    local current=$1
    local total=$2
    local width="${3:-40}"
    local title="${4:-Progress}"
    
    local percent=$((current * 100 / total))
    local filled=$((current * width / total))
    local empty=$((width - filled))
    
    printf "\r${CYAN}${title}${NC} ["
    [[ $filled -gt 0 ]] && printf "${GREEN}%*s${NC}" $filled | tr ' ' '█'
    [[ $empty -gt 0 ]] && printf "${DIM}%*s${NC}" $empty | tr ' ' '░'
    printf "] ${BRIGHT_WHITE}%3d%%${NC}" $percent
}

# Print styled messages
print_success() { echo -e "${GREEN}${ICON_CHECK}${NC} $1"; }
print_error() { echo -e "${RED}${ICON_CROSS}${NC} $1"; }
print_info() { echo -e "${CYAN}${ICON_INFO}${NC} $1"; }
print_warning() { echo -e "${YELLOW}${ICON_WARN}${NC} $1"; }
print_step() { echo -e "${MAGENTA}${ICON_ARROW}${NC} $1"; }

# ==================== Logo & Banner ====================

show_logo() {
    echo -e "${BRIGHT_CYAN}"
    cat << 'EOF'
    __  ___           _           __
   /  |/  /_  _______(_)___ _____/ /
  / /|_/ / / / / ___/ / __ `/ __  / 
 / /  / / /_/ / /  / / /_/ / /_/ /  
/_/  /_/\__, /_/  /_/\__,_/\__,_/   
       /____/                        
EOF
    echo -e "${NC}"
    echo -e "${DIM}${ICON_SPARKLE} Multi-platform Personal Information Aggregation ${ICON_SPARKLE}${NC}"
    echo ""
}

show_mini_logo() {
    echo -e "${BRIGHT_CYAN}${BOLD}◆ Myriad${NC} ${DIM}v${VERSION}${NC}"
}

# ==================== Status Functions ====================

get_service_status() {
    local service=$1
    case $service in
        backend)
            pgrep -f "myriad-backend|cargo run" > /dev/null 2>&1
            ;;
        frontend)
            pgrep -f "astro dev|vite|pnpm run dev" > /dev/null 2>&1
            ;;
        database)
            docker ps --filter "name=myriad-postgres" --format "{{.Names}}" 2>/dev/null | grep -q "myriad-postgres"
            ;;
    esac
}

get_status_text() {
    if $1; then
        echo -e "${GREEN}${ICON_CHECK} Running${NC}"
    else
        echo -e "${RED}${ICON_CROSS} Stopped${NC}"
    fi
}

show_status_dashboard() {
    local width=50
    
    echo ""
    draw_box "Service Status" $width "$BRIGHT_CYAN"
    
    # Database
    local db_status=false
    get_service_status database && db_status=true
    draw_box_line "${ICON_DB} Database (PostgreSQL)    $(get_status_text $db_status)" $width "$BRIGHT_CYAN"
    
    # Backend
    local backend_status=false
    get_service_status backend && backend_status=true
    draw_box_line "${ICON_RUST} Backend (Rust/Axum)      $(get_status_text $backend_status)" $width "$BRIGHT_CYAN"
    
    # Frontend
    local frontend_status=false
    get_service_status frontend && frontend_status=true
    draw_box_line "${ICON_NODE} Frontend (Astro/React)   $(get_status_text $frontend_status)" $width "$BRIGHT_CYAN"
    
    draw_box_line "" $width "$BRIGHT_CYAN"
    
    if $backend_status || $frontend_status; then
        $backend_status && draw_box_line "${DIM}API:      http://localhost:3000${NC}" $width "$BRIGHT_CYAN"
        $frontend_status && draw_box_line "${DIM}Frontend: http://localhost:4321${NC}" $width "$BRIGHT_CYAN"
    fi
    
    draw_box_bottom $width "$BRIGHT_CYAN"
    echo ""
}

# ==================== Service Control ====================

start_database() {
    print_step "Starting PostgreSQL database..."
    
    if get_service_status database; then
        print_warning "Database is already running"
        return 0
    fi
    
    cd "$PROJECT_ROOT"
    if [[ -f "docker-compose.dev.yml" ]]; then
        docker compose -f docker-compose.dev.yml up -d 2>/dev/null
        sleep 3
        if get_service_status database; then
            print_success "Database started"
        else
            print_error "Failed to start database"
            return 1
        fi
    else
        print_error "docker-compose.dev.yml not found"
        return 1
    fi
}

stop_database() {
    print_step "Stopping PostgreSQL database..."
    cd "$PROJECT_ROOT"
    if [[ -f "docker-compose.dev.yml" ]]; then
        docker compose -f docker-compose.dev.yml down 2>/dev/null
        print_success "Database stopped"
    fi
}

start_backend() {
    print_step "Starting Rust backend..."
    
    if get_service_status backend; then
        print_warning "Backend is already running"
        return 0
    fi
    
    cd "$PROJECT_ROOT/backend"
    
    if [[ "$OSTYPE" == "darwin"* ]]; then
        osascript -e 'tell application "Terminal" to do script "cd '"$PROJECT_ROOT/backend"' && echo \"🦀 Myriad Backend\" && source ~/.cargo/env 2>/dev/null; cargo run"' 2>/dev/null
    else
        if command -v gnome-terminal &> /dev/null; then
            gnome-terminal -- bash -c "cd '$PROJECT_ROOT/backend' && echo '🦀 Myriad Backend' && cargo run; exec bash" 2>/dev/null
        else
            nohup cargo run > "$PROJECT_ROOT/backend.log" 2>&1 &
            print_info "Backend running in background (logs: backend.log)"
        fi
    fi
    
    sleep 2
    print_success "Backend starting on http://localhost:3000"
}

stop_backend() {
    print_step "Stopping backend..."
    pkill -f "myriad-backend" 2>/dev/null || true
    pkill -f "cargo run" 2>/dev/null || true
    print_success "Backend stopped"
}

start_frontend() {
    print_step "Starting Astro frontend..."
    
    if get_service_status frontend; then
        print_warning "Frontend is already running"
        return 0
    fi
    
    cd "$PROJECT_ROOT/frontend"
    
    if [[ "$OSTYPE" == "darwin"* ]]; then
        osascript -e 'tell application "Terminal" to do script "cd '"$PROJECT_ROOT/frontend"' && echo \"⚡ Myriad Frontend\" && pnpm run dev"' 2>/dev/null
    else
        if command -v gnome-terminal &> /dev/null; then
            gnome-terminal -- bash -c "cd '$PROJECT_ROOT/frontend' && echo '⚡ Myriad Frontend' && pnpm run dev; exec bash" 2>/dev/null
        else
            nohup pnpm run dev > "$PROJECT_ROOT/frontend.log" 2>&1 &
            print_info "Frontend running in background (logs: frontend.log)"
        fi
    fi
    
    sleep 2
    print_success "Frontend starting on http://localhost:4321"
}

stop_frontend() {
    print_step "Stopping frontend..."
    pkill -f "astro dev" 2>/dev/null || true
    pkill -f "vite" 2>/dev/null || true
    pkill -f "pnpm run dev" 2>/dev/null || true
    print_success "Frontend stopped"
}

# ==================== Combined Actions ====================

start_all() {
    echo ""
    echo -e "${BRIGHT_CYAN}${BOLD}${ICON_ROCKET} Starting All Services${NC}"
    echo ""
    
    start_database
    echo ""
    sleep 2
    start_backend
    echo ""
    sleep 1
    start_frontend
    
    echo ""
    echo -e "${GREEN}${BOLD}${ICON_CHECK} All services started!${NC}"
    echo ""
    echo -e "${DIM}URLs:${NC}"
    echo -e "  ${CYAN}Frontend:${NC} http://localhost:4321"
    echo -e "  ${CYAN}Backend:${NC}  http://localhost:3000"
    echo -e "  ${CYAN}Health:${NC}   http://localhost:3000/health"
    echo ""
}

stop_all() {
    echo ""
    echo -e "${BRIGHT_YELLOW}${BOLD}${ICON_STOP} Stopping All Services${NC}"
    echo ""
    
    stop_frontend
    stop_backend
    stop_database
    
    echo ""
    print_success "All services stopped"
    echo ""
}

restart_all() {
    stop_all
    sleep 2
    start_all
}

# ==================== Clean Functions ====================

clean_project() {
    echo ""
    draw_box "Clean Project" 50 "$YELLOW"
    draw_box_line "${ICON_WARN} This will delete:" 50 "$YELLOW"
    draw_box_line "  • Database tables" 50 "$YELLOW"
    draw_box_line "  • Backend build (target/)" 50 "$YELLOW"
    draw_box_line "  • Frontend build (dist/)" 50 "$YELLOW"
    draw_box_line "  • Cache files" 50 "$YELLOW"
    draw_box_bottom 50 "$YELLOW"
    echo ""
    
    echo -en "${YELLOW}Type 'yes' to confirm: ${NC}"
    read -r confirm
    
    if [[ "$confirm" != "yes" ]]; then
        print_info "Cancelled"
        return
    fi
    
    echo ""
    local total=5
    local current=0
    
    ((current++)); progress_bar $current $total 40 "Cleaning"
    if get_service_status database; then
        docker exec myriad-postgres-dev psql -U myriad -d myriad -c "
DO \$\$ DECLARE r RECORD;
BEGIN
    FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
    END LOOP;
END \$\$;" > /dev/null 2>&1 || true
    fi
    sleep 0.3
    
    ((current++)); progress_bar $current $total 40 "Cleaning"
    rm -rf "$PROJECT_ROOT/backend/target" 2>/dev/null || true
    sleep 0.3
    
    ((current++)); progress_bar $current $total 40 "Cleaning"
    rm -rf "$PROJECT_ROOT/frontend/dist" "$PROJECT_ROOT/frontend/.astro" 2>/dev/null || true
    sleep 0.3
    
    ((current++)); progress_bar $current $total 40 "Cleaning"
    rm -rf "$PROJECT_ROOT/backend/cache"/*.json 2>/dev/null || true
    sleep 0.3
    
    ((current++)); progress_bar $current $total 40 "Cleaning"
    rm -f "$PROJECT_ROOT/backend.log" "$PROJECT_ROOT/frontend.log" 2>/dev/null || true
    
    echo ""
    echo ""
    print_success "Cleanup complete!"
    echo ""
}

# ==================== Interactive Menu ====================

show_menu() {
    clear_screen
    show_logo
    show_status_dashboard
    
    local width=50
    draw_box "Main Menu" $width "$MAGENTA"
    draw_box_line "" $width "$MAGENTA"
    draw_box_line "  ${BRIGHT_GREEN}1${NC})  ${ICON_ROCKET} Start All Services" $width "$MAGENTA"
    draw_box_line "  ${BRIGHT_GREEN}2${NC})  ${ICON_STOP} Stop All Services" $width "$MAGENTA"
    draw_box_line "  ${BRIGHT_GREEN}3${NC})  ${ICON_REFRESH} Restart All Services" $width "$MAGENTA"
    draw_box_line "" $width "$MAGENTA"
    draw_box_line "  ${BRIGHT_YELLOW}4${NC})  ${ICON_DB} Database Only" $width "$MAGENTA"
    draw_box_line "  ${BRIGHT_YELLOW}5${NC})  ${ICON_RUST} Backend Only" $width "$MAGENTA"
    draw_box_line "  ${BRIGHT_YELLOW}6${NC})  ${ICON_NODE} Frontend Only" $width "$MAGENTA"
    draw_box_line "" $width "$MAGENTA"
    draw_box_line "  ${BRIGHT_CYAN}7${NC})  ${ICON_INFO} Show Status" $width "$MAGENTA"
    draw_box_line "  ${BRIGHT_RED}8${NC})  ${ICON_TRASH} Clean Project" $width "$MAGENTA"
    draw_box_line "" $width "$MAGENTA"
    draw_box_line "  ${DIM}q${NC})  Exit" $width "$MAGENTA"
    draw_box_line "" $width "$MAGENTA"
    draw_box_bottom $width "$MAGENTA"
    
    echo ""
    echo -en "${CYAN}Select option: ${NC}"
}

show_service_menu() {
    local service=$1
    local service_name="" icon=""
    
    case $service in
        database) service_name="Database"; icon="$ICON_DB" ;;
        backend) service_name="Backend"; icon="$ICON_RUST" ;;
        frontend) service_name="Frontend"; icon="$ICON_NODE" ;;
    esac
    
    echo ""
    draw_box "$icon $service_name" 40 "$CYAN"
    draw_box_line "  1) Start" 40 "$CYAN"
    draw_box_line "  2) Stop" 40 "$CYAN"
    draw_box_line "  3) Restart" 40 "$CYAN"
    draw_box_line "  b) Back" 40 "$CYAN"
    draw_box_bottom 40 "$CYAN"
    
    echo ""
    echo -en "${CYAN}Select: ${NC}"
    read -r choice
    
    case $choice in
        1) case $service in
            database) start_database ;; backend) start_backend ;; frontend) start_frontend ;;
           esac ;;
        2) case $service in
            database) stop_database ;; backend) stop_backend ;; frontend) stop_frontend ;;
           esac ;;
        3) case $service in
            database) stop_database; sleep 1; start_database ;;
            backend) stop_backend; sleep 1; start_backend ;;
            frontend) stop_frontend; sleep 1; start_frontend ;;
           esac ;;
    esac
    
    echo ""
    echo -e "${DIM}Press Enter to continue...${NC}"
    read -r
}

run_interactive() {
    trap 'show_cursor; echo ""; exit 0' INT TERM
    
    while true; do
        show_menu
        read -r choice
        
        case $choice in
            1) start_all; echo -e "${DIM}Press Enter...${NC}"; read -r ;;
            2) stop_all; echo -e "${DIM}Press Enter...${NC}"; read -r ;;
            3) restart_all; echo -e "${DIM}Press Enter...${NC}"; read -r ;;
            4) show_service_menu "database" ;;
            5) show_service_menu "backend" ;;
            6) show_service_menu "frontend" ;;
            7) clear_screen; show_mini_logo; show_status_dashboard; echo -e "${DIM}Press Enter...${NC}"; read -r ;;
            8) clean_project; echo -e "${DIM}Press Enter...${NC}"; read -r ;;
            q|Q) clear_screen; echo -e "${CYAN}${ICON_HEART} Thanks for using Myriad! ${ICON_HEART}${NC}"; echo ""; exit 0 ;;
            *) print_warning "Invalid option"; sleep 1 ;;
        esac
    done
}

# ==================== CLI Help ====================

show_help() {
    show_mini_logo
    echo ""
    echo -e "${BOLD}Usage:${NC} ./dev.sh [command] [service]"
    echo ""
    echo -e "${BOLD}Commands:${NC}"
    echo -e "  ${GREEN}start${NC}   [service]  Start services (default: all)"
    echo -e "  ${RED}stop${NC}    [service]  Stop services (default: all)"
    echo -e "  ${YELLOW}restart${NC} [service]  Restart services (default: all)"
    echo -e "  ${CYAN}status${NC}             Show service status"
    echo -e "  ${MAGENTA}clean${NC}              Clean build files and database"
    echo -e "  ${BLUE}menu${NC}               Open interactive menu"
    echo -e "  ${DIM}help${NC}               Show this help"
    echo ""
    echo -e "${BOLD}Services:${NC} database (db), backend, frontend, all"
    echo ""
    echo -e "${BOLD}Examples:${NC}"
    echo -e "  ${DIM}./dev.sh${NC}                 # Open interactive menu"
    echo -e "  ${DIM}./dev.sh start${NC}           # Start all services"
    echo -e "  ${DIM}./dev.sh start backend${NC}   # Start backend only"
    echo -e "  ${DIM}./dev.sh stop${NC}            # Stop all services"
    echo -e "  ${DIM}./dev.sh status${NC}          # Show status"
    echo ""
}

# ==================== Main ====================

main() {
    local command="${1:-}"
    local service="${2:-all}"
    
    [[ -z "$command" ]] && { run_interactive; exit 0; }
    
    case "$command" in
        start)
            case "$service" in
                all) start_all ;; database|db) start_database ;;
                backend) start_backend ;; frontend) start_frontend ;;
                *) print_error "Unknown service: $service" ;;
            esac ;;
        stop)
            case "$service" in
                all) stop_all ;; database|db) stop_database ;;
                backend) stop_backend ;; frontend) stop_frontend ;;
                *) print_error "Unknown service: $service" ;;
            esac ;;
        restart)
            case "$service" in
                all) restart_all ;;
                database|db) stop_database; sleep 1; start_database ;;
                backend) stop_backend; sleep 1; start_backend ;;
                frontend) stop_frontend; sleep 1; start_frontend ;;
                *) print_error "Unknown service: $service" ;;
            esac ;;
        status) show_mini_logo; show_status_dashboard ;;
        clean) clean_project ;;
        menu) run_interactive ;;
        help|--help|-h) show_help ;;
        *) print_error "Unknown command: $command"; echo ""; show_help; exit 1 ;;
    esac
}

main "$@"
