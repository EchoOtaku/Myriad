#!/bin/bash
# =============================================================================
# Myriad Docker 镜像构建和推送脚本
# =============================================================================
# 用于在本地构建并推送 backend / frontend / proxy / updater 镜像。
#
# ⚠️  生产发版优先使用 GitHub Actions release.yml：
#     git tag v0.2.0 && git push origin v0.2.0
#   会自动 build 4 个镜像 + 生成 release.json + cosign 签名 + 发 GitHub Release。
#
# 本脚本主要用途：
#   - 本地快速验证 Dockerfile 改动
#   - 内网环境推到私有 registry
#   - GitHub Actions 不可用时的备用通路
# =============================================================================

set -e

# Default values
REGISTRY="docker.io"
USERNAME=""
TAG="latest"
PUSH=false
BUILD_BACKEND=true
BUILD_FRONTEND=true
BUILD_PROXY=false
BUILD_UPDATER=false
NO_BUILD_CACHE=false
MYRIAD_VERSION=""

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
log_success() { echo -e "${GREEN}$1${NC}"; }
log_info() { echo -e "${CYAN}$1${NC}"; }
log_warning() { echo -e "${YELLOW}$1${NC}"; }
log_error() { echo -e "${RED}$1${NC}"; }

show_banner() {
    log_info "==========================================="
    log_info "   Myriad Docker 镜像构建和推送工具"
    log_info "==========================================="
    log_warning "提示：生产发版请优先使用 \`git tag v* && git push --tags\` 触发 release.yml"
    echo ""
}

get_version() {
    if [ -f "backend/Cargo.toml" ]; then
        v=$(grep -E '^version\s*=' backend/Cargo.toml | head -1 | sed -E 's/.*"([^"]+)".*/\1/')
        [ -n "$v" ] && { echo "v$v"; return; }
    fi
    echo "v0.0.0-dev"
}

check_docker() {
    if ! command -v docker &>/dev/null; then
        log_error "✗ 未找到 Docker"; exit 1
    fi
    log_success "✓ Docker 已安装"
}

docker_login() {
    local registry=$1 username=$2
    [ -z "$username" ] && return 0
    log_info "登录 $registry ..."
    docker login "$registry" -u "$username" || { log_error "✗ 登录失败"; return 1; }
    log_success "✓ 登录成功"
}

build_image() {
    local service=$1 dockerfile=$2 image_name=$3
    [ ! -f "$dockerfile" ] && { log_warning "✗ $dockerfile 不存在，跳过 $service"; return 0; }

    log_info "构建 $service: $image_name"
    local args=("build" "-f" "$dockerfile" "-t" "$image_name" "--build-arg" "MYRIAD_VERSION=$MYRIAD_VERSION")
    [ "$NO_BUILD_CACHE" = true ] && args+=("--no-cache")
    args+=(".")
    if docker "${args[@]}"; then
        log_success "✓ $service 构建完成"
    else
        log_error "✗ $service 构建失败"; return 1
    fi
}

push_image() {
    local image_name=$1
    log_info "推送: $image_name"
    docker push "$image_name" && log_success "✓ 推送完成" || { log_error "✗ 推送失败"; return 1; }
}

show_help() {
    cat <<EOF
用法: $0 [选项]

选项:
  -u, --username USER    Registry 用户名（必需用于推送）
  -t, --tag TAG          镜像标签（默认: 当前 Cargo 版本，如 v0.1.0）
  -r, --registry URL     镜像仓库地址（默认: docker.io）
  -p, --push             构建后推送
  --backend              构建 backend（默认 ON）
  --frontend             构建 frontend（默认 ON）
  --proxy                构建 proxy
  --updater              构建 updater
  --all                  构建全部 4 个组件
  --backend-only         仅 backend
  --frontend-only        仅 frontend
  --proxy-only           仅 proxy
  --updater-only         仅 updater
  --no-cache             不使用缓存
  -h, --help             显示帮助

示例:
  $0 -u myuser --all -p                  # 推 4 个组件
  $0 -u myuser -t v0.2.0-rc.1 --all -p   # 推一个 rc tag
  $0 --proxy-only                        # 本地仅构建 proxy 测试
EOF
}

while [[ $# -gt 0 ]]; do
    case $1 in
        -u|--username) USERNAME="$2"; shift 2 ;;
        -t|--tag) TAG="$2"; shift 2 ;;
        -r|--registry) REGISTRY="$2"; shift 2 ;;
        -p|--push) PUSH=true; shift ;;
        --backend) BUILD_BACKEND=true; shift ;;
        --frontend) BUILD_FRONTEND=true; shift ;;
        --proxy) BUILD_PROXY=true; shift ;;
        --updater) BUILD_UPDATER=true; shift ;;
        --all) BUILD_BACKEND=true; BUILD_FRONTEND=true; BUILD_PROXY=true; BUILD_UPDATER=true; shift ;;
        --backend-only)  BUILD_BACKEND=true;  BUILD_FRONTEND=false; BUILD_PROXY=false; BUILD_UPDATER=false; shift ;;
        --frontend-only) BUILD_BACKEND=false; BUILD_FRONTEND=true;  BUILD_PROXY=false; BUILD_UPDATER=false; shift ;;
        --proxy-only)    BUILD_BACKEND=false; BUILD_FRONTEND=false; BUILD_PROXY=true;  BUILD_UPDATER=false; shift ;;
        --updater-only)  BUILD_BACKEND=false; BUILD_FRONTEND=false; BUILD_PROXY=false; BUILD_UPDATER=true;  shift ;;
        --no-cache) NO_BUILD_CACHE=true; shift ;;
        -h|--help) show_help; exit 0 ;;
        *) log_error "未知选项: $1"; show_help; exit 1 ;;
    esac
done

main() {
    show_banner
    check_docker

    if [ -z "$USERNAME" ] && [ "$PUSH" = true ]; then
        read -p "Registry 用户名: " USERNAME
        [ -z "$USERNAME" ] && { log_error "推送需要用户名"; exit 1; }
    fi

    [ -z "$MYRIAD_VERSION" ] && MYRIAD_VERSION=$(get_version)
    [ "$TAG" = "latest" ] && TAG="$MYRIAD_VERSION"
    log_info "版本: $MYRIAD_VERSION  tag: $TAG"
    echo ""

    if [ "$PUSH" = true ]; then
        docker_login "$REGISTRY" "$USERNAME" || exit 1
        echo ""
    fi

    # Build targets table
    declare -A TARGETS=(
        ["backend"]="docker/Dockerfile.backend"
        ["frontend"]="docker/Dockerfile.frontend"
        ["proxy"]="proxy/Dockerfile"
        ["updater"]="updater/Dockerfile"
    )
    declare -A ENABLED=(
        ["backend"]=$BUILD_BACKEND
        ["frontend"]=$BUILD_FRONTEND
        ["proxy"]=$BUILD_PROXY
        ["updater"]=$BUILD_UPDATER
    )

    declare -a BUILT_IMAGES=()
    for comp in backend frontend proxy updater; do
        [ "${ENABLED[$comp]}" != "true" ] && continue
        image="$REGISTRY/$USERNAME/myriad-$comp:$TAG"
        echo "========== $comp =========="
        if build_image "$comp" "${TARGETS[$comp]}" "$image"; then
            BUILT_IMAGES+=("$image")
        else
            log_error "$comp 构建失败"; exit 1
        fi
        echo ""
    done

    if [ "$PUSH" = true ]; then
        echo "========== 推送 =========="
        for img in "${BUILT_IMAGES[@]}"; do
            push_image "$img" || exit 1
        done
    fi

    echo ""
    log_success "==========================================="
    log_success "         完成"
    log_success "==========================================="
    for img in "${BUILT_IMAGES[@]}"; do
        echo "  $img"
    done
    echo ""
    [ "$PUSH" = false ] && log_info "使用 -p 推送到 registry"
}

main
