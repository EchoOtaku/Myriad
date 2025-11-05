#!/bin/bash
# =============================================================================
# Myriad Docker 镜像构建和推送脚本
# =============================================================================
# 用于构建 Docker 镜像并推送到 Docker Hub 或其他镜像仓库
# =============================================================================

set -e

# 默认值
REGISTRY="docker.io"
USERNAME=""
TAG="latest"
PUSH=false
BUILD_BACKEND=true
BUILD_FRONTEND=true
NO_BUILD_CACHE=false

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# 输出函数
log_success() { echo -e "${GREEN}$1${NC}"; }
log_info() { echo -e "${CYAN}$1${NC}"; }
log_warning() { echo -e "${YELLOW}$1${NC}"; }
log_error() { echo -e "${RED}$1${NC}"; }

# 显示横幅
show_banner() {
    log_info "==========================================="
    log_info "   Myriad Docker 镜像构建和推送工具"
    log_info "==========================================="
    echo ""
}

# 获取版本
get_version() {
    if [ -f "backend/Cargo.toml" ]; then
        version=$(grep -E '^version\s*=' backend/Cargo.toml | head -1 | sed -E 's/.*"([^"]+)".*/\1/')
        if [ -n "$version" ]; then
            echo "$version"
            return
        fi
    fi
    echo "latest"
}

# 检查 Docker
check_docker() {
    log_info "检查 Docker 环境..."
    if ! command -v docker &> /dev/null; then
        log_error "✗ 未找到 Docker"
        log_error "请先安装 Docker: https://docs.docker.com/engine/install/"
        exit 1
    fi
    log_success "✓ Docker 已安装"
}

# Docker 登录
docker_login() {
    local registry=$1
    local username=$2
    
    if [ -z "$username" ]; then
        log_warning "未提供用户名，跳过登录"
        return 0
    fi
    
    log_info "登录到 $registry ..."
    if docker login "$registry" -u "$username"; then
        log_success "✓ 登录成功"
        return 0
    else
        log_error "✗ 登录失败"
        return 1
    fi
}

# 构建镜像
build_image() {
    local service=$1
    local dockerfile=$2
    local image_name=$3
    local no_cache=$4
    
    log_info "构建 $service 镜像..."
    log_info "  镜像名称: $image_name"
    log_info "  Dockerfile: $dockerfile"
    
    local build_args=(
        "build"
        "-f" "$dockerfile"
        "-t" "$image_name"
        "."
    )
    
    if [ "$no_cache" = true ]; then
        build_args+=("--no-cache")
    fi
    
    echo ""
    if docker "${build_args[@]}"; then
        log_success "✓ $service 构建完成"
        return 0
    else
        log_error "✗ $service 构建失败"
        return 1
    fi
}

# 推送镜像
push_image() {
    local image_name=$1
    
    log_info "推送镜像: $image_name"
    if docker push "$image_name"; then
        log_success "✓ 推送完成"
        return 0
    else
        log_error "✗ 推送失败"
        return 1
    fi
}

# 显示帮助
show_help() {
    echo "用法: $0 [选项]"
    echo ""
    echo "选项:"
    echo "  -u, --username USER    Docker Hub 用户名（必需）"
    echo "  -t, --tag TAG          镜像标签（默认: latest）"
    echo "  -r, --registry URL     镜像仓库地址（默认: docker.io）"
    echo "  -p, --push             构建后推送到仓库"
    echo "  --backend-only         仅构建后端镜像"
    echo "  --frontend-only        仅构建前端镜像"
    echo "  --no-cache             不使用缓存构建"
    echo "  -h, --help             显示此帮助信息"
    echo ""
    echo "示例:"
    echo "  $0 -u myusername -t latest"
    echo "  $0 -u myusername -t v1.0.0 -p"
    echo "  $0 -u myusername --backend-only -p"
    echo ""
}

# 解析参数
while [[ $# -gt 0 ]]; do
    case $1 in
        -u|--username)
            USERNAME="$2"
            shift 2
            ;;
        -t|--tag)
            TAG="$2"
            shift 2
            ;;
        -r|--registry)
            REGISTRY="$2"
            shift 2
            ;;
        -p|--push)
            PUSH=true
            shift
            ;;
        --backend-only)
            BUILD_FRONTEND=false
            shift
            ;;
        --frontend-only)
            BUILD_BACKEND=false
            shift
            ;;
        --no-cache)
            NO_BUILD_CACHE=true
            shift
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        *)
            log_error "未知选项: $1"
            show_help
            exit 1
            ;;
    esac
done

# 主函数
main() {
    show_banner
    
    # 检查 Docker
    check_docker
    echo ""
    
    # 验证用户名
    if [ -z "$USERNAME" ]; then
        read -p "请输入 Docker Hub 用户名（或镜像仓库用户名）: " USERNAME
        if [ -z "$USERNAME" ]; then
            log_error "必须提供用户名"
            exit 1
        fi
    fi
    
    # 获取版本
    version=$(get_version)
    log_info "检测到版本: $version"
    echo ""
    
    # 镜像名称
    backend_image="$REGISTRY/$USERNAME/myriad-backend:$TAG"
    frontend_image="$REGISTRY/$USERNAME/myriad-frontend:$TAG"
    
    # 如果需要推送，先登录
    if [ "$PUSH" = true ]; then
        if ! docker_login "$REGISTRY" "$USERNAME"; then
            exit 1
        fi
        echo ""
    fi
    
    success=true
    
    # 构建后端
    if [ "$BUILD_BACKEND" = true ]; then
        log_info "========== 构建后端镜像 =========="
        if ! build_image "Backend" "docker/Dockerfile.backend" "$backend_image" "$NO_BUILD_CACHE"; then
            success=false
        fi
        echo ""
        
        # 同时标记版本号
        if [ "$TAG" != "$version" ] && [ "$TAG" != "latest" ]; then
            version_image="$REGISTRY/$USERNAME/myriad-backend:$version"
            docker tag "$backend_image" "$version_image"
            log_info "  也标记为: $version_image"
        fi
    fi
    
    # 构建前端
    if [ "$BUILD_FRONTEND" = true ]; then
        log_info "========== 构建前端镜像 =========="
        if ! build_image "Frontend" "docker/Dockerfile.frontend" "$frontend_image" "$NO_BUILD_CACHE"; then
            success=false
        fi
        echo ""
        
        # 同时标记版本号
        if [ "$TAG" != "$version" ] && [ "$TAG" != "latest" ]; then
            version_image="$REGISTRY/$USERNAME/myriad-frontend:$version"
            docker tag "$frontend_image" "$version_image"
            log_info "  也标记为: $version_image"
        fi
    fi
    
    if [ "$success" = false ]; then
        log_error "构建过程中出现错误"
        exit 1
    fi
    
    # 推送镜像
    if [ "$PUSH" = true ]; then
        log_info "========== 推送镜像 =========="
        
        if [ "$BUILD_BACKEND" = true ]; then
            if ! push_image "$backend_image"; then
                success=false
            fi
            
            # 如果有版本标签，也推送版本
            if [ "$TAG" != "$version" ] && [ "$TAG" != "latest" ]; then
                version_image="$REGISTRY/$USERNAME/myriad-backend:$version"
                push_image "$version_image"
            fi
        fi
        
        if [ "$BUILD_FRONTEND" = true ]; then
            if ! push_image "$frontend_image"; then
                success=false
            fi
            
            # 如果有版本标签，也推送版本
            if [ "$TAG" != "$version" ] && [ "$TAG" != "latest" ]; then
                version_image="$REGISTRY/$USERNAME/myriad-frontend:$version"
                push_image "$version_image"
            fi
        fi
        
        if [ "$success" = false ]; then
            log_error "推送过程中出现错误"
            exit 1
        fi
    fi
    
    # 显示摘要
    echo ""
    log_success "==========================================="
    log_success "         构建完成！"
    log_success "==========================================="
    echo ""
    log_info "构建的镜像："
    if [ "$BUILD_BACKEND" = true ]; then
        echo "  Backend:  $backend_image"
    fi
    if [ "$BUILD_FRONTEND" = true ]; then
        echo "  Frontend: $frontend_image"
    fi
    echo ""
    
    if [ "$PUSH" = true ]; then
        log_success "✓ 镜像已推送到仓库"
        echo ""
        log_info "用户可以使用以下命令拉取："
        if [ "$BUILD_BACKEND" = true ]; then
            echo "  docker pull $backend_image"
        fi
        if [ "$BUILD_FRONTEND" = true ]; then
            echo "  docker pull $frontend_image"
        fi
    else
        log_info "本地构建完成，使用 -p 参数推送到仓库"
        echo ""
        log_info "推送命令："
        echo "  $0 -u $USERNAME -t $TAG -p"
    fi
    
    echo ""
    log_info "查看镜像："
    echo "  docker images | grep myriad"
    echo ""
}

# 执行主函数
main
