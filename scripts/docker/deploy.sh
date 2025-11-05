#!/bin/bash
# =============================================================================
# Myriad Docker Unified Deployment Script
# =============================================================================
# Supports both local build and pre-built image deployment
# =============================================================================

set -e

# Color definitions
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Output functions
log_success() { echo -e "${GREEN}$1${NC}"; }
log_info() { echo -e "${CYAN}$1${NC}"; }
log_warning() { echo -e "${YELLOW}$1${NC}"; }
log_error() { echo -e "${RED}$1${NC}"; }

# Default parameters
MODE="build"
USERNAME="mirai-mamori"
TAG="latest"
STOP=false
CLEAN=false
LOGS=false
STATUS=false
REBUILD=false

# Show usage
show_usage() {
    echo "Usage: $0 [options]"
    echo ""
    echo "Options:"
    echo "  -m, --mode MODE         Deployment mode: build or prebuilt (default: build)"
    echo "  -u, --username USER     Docker Hub username (default: mirai-mamori)"
    echo "  -t, --tag TAG           Image tag (default: latest)"
    echo "  -s, --stop              Stop services"
    echo "  -c, --clean             Clean all resources"
    echo "  -l, --logs              Show logs"
    echo "  -S, --status            Show status"
    echo "  -r, --rebuild           Rebuild images (build mode only)"
    echo "  -h, --help              Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                                    # Deploy with local build"
    echo "  $0 --mode prebuilt                    # Deploy with pre-built images"
    echo "  $0 --mode build --rebuild             # Rebuild and deploy"
    echo "  $0 --mode prebuilt --stop             # Stop pre-built deployment"
    exit 0
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -m|--mode)
            MODE="$2"
            shift 2
            ;;
        -u|--username)
            USERNAME="$2"
            shift 2
            ;;
        -t|--tag)
            TAG="$2"
            shift 2
            ;;
        -s|--stop)
            STOP=true
            shift
            ;;
        -c|--clean)
            CLEAN=true
            shift
            ;;
        -l|--logs)
            LOGS=true
            shift
            ;;
        -S|--status)
            STATUS=true
            shift
            ;;
        -r|--rebuild)
            REBUILD=true
            shift
            ;;
        -h|--help)
            show_usage
            ;;
        *)
            echo "Unknown option: $1"
            show_usage
            ;;
    esac
done

# Validate mode
if [[ "$MODE" != "build" && "$MODE" != "prebuilt" ]]; then
    log_error "Invalid mode: $MODE (must be 'build' or 'prebuilt')"
    exit 1
fi

# Show banner
show_banner() {
    log_info "==========================================="
    if [ "$MODE" = "prebuilt" ]; then
        log_info "   Myriad Pre-built Image Deployment"
    else
        log_info "      Myriad Docker Deployment Tool"
    fi
    log_info "==========================================="
    echo ""
}

# Check if Docker is installed
check_docker() {
    log_info "Checking Docker environment..."
    if ! command -v docker &> /dev/null; then
        log_error "[ERROR] Docker not found"
        log_error "Please install Docker: https://docs.docker.com/engine/install/"
        exit 1
    fi
    
    log_success "[OK] Docker is installed"
    return 0
}

# Detect docker-compose command
get_compose_command() {
    if command -v docker-compose &> /dev/null; then
        echo "docker-compose"
    else
        echo "docker compose"
    fi
}

# Get compose file and template
get_compose_config() {
    if [ "$MODE" = "prebuilt" ]; then
        COMPOSE_FILE="docker-compose.prebuilt.yml"
        ENV_TEMPLATE=".env.prebuilt"
    else
        COMPOSE_FILE="docker-compose.yml"
        ENV_TEMPLATE=".env.docker"
    fi
}

# Check and create environment file
initialize_environment() {
    log_info "Checking environment configuration..."
    
    get_compose_config
    
    if [ ! -f ".env" ]; then
        if [ -f "$ENV_TEMPLATE" ]; then
            log_warning ".env file not found, creating from $ENV_TEMPLATE..."
            cp "$ENV_TEMPLATE" .env
            
            # For prebuilt mode, set Docker username and tag
            if [ "$MODE" = "prebuilt" ]; then
                sed -i.bak "s/DOCKER_USERNAME=.*/DOCKER_USERNAME=$USERNAME/" .env
                sed -i.bak "s/IMAGE_TAG=.*/IMAGE_TAG=$TAG/" .env
                rm -f .env.bak
            fi
            
            log_success "[OK] .env file created"
            log_warning "[IMPORTANT] Please edit .env file and change:"
            log_warning "  - POSTGRES_PASSWORD (database password)"
            log_warning "  - JWT_SECRET (JWT secret key)"
            echo ""
            
            read -p "Edit .env file now? (y/N): " response
            if [[ "$response" =~ ^[Yy]$ ]]; then
                ${EDITOR:-nano} .env
                echo ""
                read -p "Press Enter after editing to continue..."
            fi
        else
            log_error "[ERROR] $ENV_TEMPLATE template file not found"
            return 1
        fi
    else
        log_success "[OK] .env configuration file found"
    fi
    
    return 0
}

# Stop and cleanup containers
stop_application() {
    log_info "Stopping application containers..."
    COMPOSE_CMD=$(get_compose_command)
    get_compose_config
    
    if [ "$COMPOSE_FILE" = "docker-compose.yml" ]; then
        $COMPOSE_CMD down
    else
        $COMPOSE_CMD -f "$COMPOSE_FILE" down
    fi
    
    log_success "[OK] Containers stopped"
}

# Clean all resources (including volumes)
clean_application() {
    log_warning "[WARNING] This will delete all containers, images and volumes (including database data)"
    read -p "Confirm to continue? (yes/N): " response
    if [ "$response" != "yes" ]; then
        log_info "Cleanup cancelled"
        return
    fi
    
    log_info "Cleaning application resources..."
    COMPOSE_CMD=$(get_compose_command)
    get_compose_config
    
    if [ "$COMPOSE_FILE" = "docker-compose.yml" ]; then
        $COMPOSE_CMD down -v --rmi all
    else
        $COMPOSE_CMD -f "$COMPOSE_FILE" down -v
    fi
    
    log_success "[OK] All resources cleaned"
}

# Show logs
show_logs() {
    log_info "Showing application logs (Press Ctrl+C to exit)..."
    COMPOSE_CMD=$(get_compose_command)
    get_compose_config
    
    if [ "$COMPOSE_FILE" = "docker-compose.yml" ]; then
        $COMPOSE_CMD logs -f
    else
        $COMPOSE_CMD -f "$COMPOSE_FILE" logs -f
    fi
}

# Show status
show_status() {
    log_info "Application status:"
    echo ""
    
    COMPOSE_CMD=$(get_compose_command)
    get_compose_config
    
    if [ "$COMPOSE_FILE" = "docker-compose.yml" ]; then
        $COMPOSE_CMD ps
    else
        $COMPOSE_CMD -f "$COMPOSE_FILE" ps
    fi
    
    echo ""
    
    # Check health status
    postgres=$(docker inspect myriad-postgres --format='{{.State.Health.Status}}' 2>/dev/null || echo "")
    backend=$(docker inspect myriad-backend --format='{{.State.Health.Status}}' 2>/dev/null || echo "")
    frontend=$(docker inspect myriad-frontend --format='{{.State.Health.Status}}' 2>/dev/null || echo "")
    
    log_info "Service health status:"
    [ -n "$postgres" ] && echo "  PostgreSQL: $postgres"
    [ -n "$backend" ] && echo "  Backend:    $backend"
    [ -n "$frontend" ] && echo "  Frontend:   $frontend"
    echo ""
    
    log_info "Access URLs:"
    log_success "  Frontend: http://localhost:4321"
    log_success "  Backend:  http://localhost:3000"
    log_success "  Database: localhost:5432"
}

# Build and start application (local build mode)
start_local_build() {
    log_info "Starting Myriad application (Local Build Mode)..."
    echo ""
    
    COMPOSE_CMD=$(get_compose_command)
    
    if [ "$REBUILD" = true ]; then
        log_info "Building images (first build may take several minutes)..."
        $COMPOSE_CMD build --no-cache
        if [ $? -ne 0 ]; then
            log_error "[ERROR] Build failed"
            return 1
        fi
        log_success "[OK] Image build completed"
    fi
    
    log_info "Starting containers..."
    $COMPOSE_CMD up -d
    if [ $? -ne 0 ]; then
        log_error "[ERROR] Start failed"
        return 1
    fi
    
    log_success "[OK] Containers started"
    return 0
}

# Start application (pre-built mode)
start_prebuilt() {
    log_info "Starting Myriad application (Pre-built Image Mode)..."
    log_info "  Docker Hub user: $USERNAME"
    log_info "  Image tag: $TAG"
    echo ""
    
    COMPOSE_CMD=$(get_compose_command)
    
    log_info "Pulling latest images..."
    $COMPOSE_CMD -f docker-compose.prebuilt.yml pull
    echo ""
    
    log_info "Starting services..."
    $COMPOSE_CMD -f docker-compose.prebuilt.yml up -d
    
    if [ $? -ne 0 ]; then
        log_error "[ERROR] Start failed"
        return 1
    fi
    
    log_success "[OK] Services started"
    return 0
}

# Wait for services to be ready
wait_for_services() {
    log_info "Waiting for services to be ready..."
    max_wait=60
    waited=0
    interval=5
    
    while [ $waited -lt $max_wait ]; do
        sleep $interval
        waited=$((waited + interval))
        
        backend=$(docker inspect myriad-backend --format='{{.State.Health.Status}}' 2>/dev/null || echo "")
        if [ "$backend" = "healthy" ]; then
            log_success "[OK] All services ready!"
            echo ""
            show_status
            return 0
        fi
        
        echo -n "."
    done
    
    echo ""
    log_warning "[WARNING] Service startup timeout, please check logs"
    log_info "View logs with:"
    if [ "$MODE" = "prebuilt" ]; then
        echo "  docker-compose -f docker-compose.prebuilt.yml logs -f"
    else
        echo "  docker-compose logs -f"
    fi
    return 1
}

# Main function
main() {
    show_banner
    
    # Check Docker
    check_docker
    echo ""
    
    # Handle command line parameters
    if [ "$STOP" = true ]; then
        stop_application
        exit 0
    fi
    
    if [ "$CLEAN" = true ]; then
        clean_application
        exit 0
    fi
    
    if [ "$LOGS" = true ]; then
        show_logs
        exit 0
    fi
    
    if [ "$STATUS" = true ]; then
        show_status
        exit 0
    fi
    
    # Initialize environment
    if ! initialize_environment; then
        exit 1
    fi
    echo ""
    
    # Start application based on mode
    if [ "$MODE" = "prebuilt" ]; then
        if ! start_prebuilt; then
            exit 1
        fi
    else
        if ! start_local_build; then
            exit 1
        fi
    fi
    
    echo ""
    if ! wait_for_services; then
        exit 1
    fi
    
    echo ""
    log_success "==========================================="
    log_success "       Deployment Complete!"
    log_success "==========================================="
    echo ""
    log_info "Common commands:"
    echo "  Check status: ./deploy.sh --mode $MODE --status"
    echo "  View logs:    ./deploy.sh --mode $MODE --logs"
    echo "  Stop service: ./deploy.sh --mode $MODE --stop"
    if [ "$MODE" = "build" ]; then
        echo "  Rebuild:      ./deploy.sh --mode build --rebuild"
    fi
    echo "  Full cleanup: ./deploy.sh --mode $MODE --clean"
    echo ""
    
    read -p "Press Enter to exit..."
}

# Execute main function
main
