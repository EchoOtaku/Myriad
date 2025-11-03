#!/bin/bash

###############################################################################
# Myriad 项目一键部署脚本
# 适用于 Ubuntu 20.04+/Debian 11+/CentOS 8+
# 用途：自动安装依赖、配置环境、部署项目
###############################################################################

set -e  # 遇到错误立即退出

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# 日志函数
log_info() {
    echo -e "${CYAN}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 打印标题
print_banner() {
    echo -e "${BLUE}"
    cat << "EOF"
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║          Myriad 项目一键部署脚本                          ║
║          Multi-Platform Profile Aggregator                ║
║                                                           ║
║          Version: 1.0.0                                   ║
║          Date: 2025-11-03                                 ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
EOF
    echo -e "${NC}"
}

# 检查是否为 root 用户
check_root() {
    if [ "$EUID" -ne 0 ]; then 
        log_error "请使用 root 权限运行此脚本"
        log_info "使用方法: sudo bash install.sh"
        exit 1
    fi
}

# 检测操作系统
detect_os() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS=$ID
        OS_VERSION=$VERSION_ID
    else
        log_error "无法检测操作系统类型"
        exit 1
    fi
    
    log_info "检测到操作系统: $OS $OS_VERSION"
}

# 安装基础依赖
install_base_dependencies() {
    log_info "安装基础依赖..."
    
    case $OS in
        ubuntu|debian)
            apt-get update
            apt-get install -y curl wget git build-essential pkg-config libssl-dev \
                               ca-certificates gnupg lsb-release sudo ufw
            ;;
        centos|rhel|rocky|almalinux)
            yum update -y
            yum install -y curl wget git gcc gcc-c++ make openssl-devel \
                          ca-certificates gnupg2 sudo firewalld
            ;;
        *)
            log_error "不支持的操作系统: $OS"
            exit 1
            ;;
    esac
    
    log_success "基础依赖安装完成"
}

# 安装 PostgreSQL
install_postgresql() {
    log_info "安装 PostgreSQL 15..."
    
    case $OS in
        ubuntu|debian)
            # 添加 PostgreSQL 官方仓库
            sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
            wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | apt-key add -
            apt-get update
            apt-get install -y postgresql-15 postgresql-contrib-15
            ;;
        centos|rhel|rocky|almalinux)
            yum install -y https://download.postgresql.org/pub/repos/yum/reporpms/EL-8-x86_64/pgdg-redhat-repo-latest.noarch.rpm
            yum install -y postgresql15-server postgresql15-contrib
            /usr/pgsql-15/bin/postgresql-15-setup initdb
            ;;
    esac
    
    # 启动 PostgreSQL
    systemctl start postgresql
    systemctl enable postgresql
    
    log_success "PostgreSQL 安装完成"
}

# 配置 PostgreSQL 数据库
setup_postgresql() {
    log_info "配置 PostgreSQL 数据库..."
    
    # 生成随机密码
    DB_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-25)
    
    # 创建数据库和用户
    sudo -u postgres psql << EOF
-- 创建用户
CREATE USER myriad WITH PASSWORD '$DB_PASSWORD';

-- 创建数据库
CREATE DATABASE myriad OWNER myriad;

-- 授权
GRANT ALL PRIVILEGES ON DATABASE myriad TO myriad;

-- 退出
\q
EOF
    
    # 保存数据库信息
    cat > /root/myriad-db-info.txt << EOF
PostgreSQL 数据库信息
====================
数据库名: myriad
用户名: myriad
密码: $DB_PASSWORD
连接字符串: postgres://myriad:$DB_PASSWORD@localhost:5432/myriad

⚠️  请妥善保管此文件，建议备份后删除
EOF
    
    chmod 600 /root/myriad-db-info.txt
    
    log_success "数据库配置完成"
    log_info "数据库信息已保存到: /root/myriad-db-info.txt"
}

# 安装 Rust
install_rust() {
    log_info "安装 Rust..."
    
    if command -v rustc &> /dev/null; then
        log_warn "Rust 已安装，跳过"
        return
    fi
    
    # 安装 Rust
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    
    # 添加到环境变量
    source $HOME/.cargo/env
    echo 'source $HOME/.cargo/env' >> /root/.bashrc
    
    # 验证安装
    rustc --version
    cargo --version
    
    log_success "Rust 安装完成"
}

# 安装 Node.js
install_nodejs() {
    log_info "安装 Node.js 18..."
    
    if command -v node &> /dev/null; then
        NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
        if [ "$NODE_VERSION" -ge 18 ]; then
            log_warn "Node.js 已安装，跳过"
            return
        fi
    fi
    
    # 安装 Node.js 18
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    
    case $OS in
        ubuntu|debian)
            apt-get install -y nodejs
            ;;
        centos|rhel|rocky|almalinux)
            yum install -y nodejs
            ;;
    esac
    
    # 安装 pnpm
    npm install -g pnpm
    
    # 验证安装
    node --version
    npm --version
    pnpm --version
    
    log_success "Node.js 安装完成"
}

# 安装 Nginx
install_nginx() {
    log_info "安装 Nginx..."
    
    case $OS in
        ubuntu|debian)
            apt-get install -y nginx
            ;;
        centos|rhel|rocky|almalinux)
            yum install -y nginx
            ;;
    esac
    
    # 启动 Nginx
    systemctl start nginx
    systemctl enable nginx
    
    log_success "Nginx 安装完成"
}

# 克隆项目代码
clone_project() {
    log_info "克隆项目代码..."
    
    PROJECT_DIR="/opt/myriad"
    
    if [ -d "$PROJECT_DIR" ]; then
        log_warn "项目目录已存在，是否删除并重新克隆? (y/n)"
        read -r response
        if [[ "$response" == "y" ]]; then
            rm -rf "$PROJECT_DIR"
        else
            log_info "跳过克隆步骤"
            return
        fi
    fi
    
    # 克隆代码
    echo -e "${YELLOW}请输入 Git 仓库地址 (留空使用默认):${NC}"
    read -r GIT_REPO
    if [ -z "$GIT_REPO" ]; then
        GIT_REPO="https://github.com/mirai-mamori/Myriad.git"
    fi
    
    git clone "$GIT_REPO" "$PROJECT_DIR"
    
    log_success "项目代码克隆完成"
}

# 配置环境变量
configure_env() {
    log_info "配置环境变量..."
    
    # 读取数据库密码
    if [ ! -f /root/myriad-db-info.txt ]; then
        log_error "数据库信息文件不存在"
        exit 1
    fi
    
    DB_PASSWORD=$(grep "密码:" /root/myriad-db-info.txt | awk '{print $2}')
    
    # 生成 JWT Secret
    JWT_SECRET=$(openssl rand -base64 48 | tr -d "=+/" | cut -c1-64)
    
    # 获取用户输入
    echo -e "${YELLOW}请输入域名 (例如: example.com):${NC}"
    read -r DOMAIN
    
    echo -e "${YELLOW}请输入 GitHub OAuth Client ID (留空跳过):${NC}"
    read -r GITHUB_CLIENT_ID
    
    echo -e "${YELLOW}请输入 GitHub OAuth Client Secret (留空跳过):${NC}"
    read -r GITHUB_CLIENT_SECRET
    
    echo -e "${YELLOW}请输入 Gemini API Key (留空跳过):${NC}"
    read -r GEMINI_API_KEY
    
    # 创建 .env 文件
    cat > /opt/myriad/backend/.env << EOF
# ========================================
# 数据库配置
# ========================================
DATABASE_URL=postgres://myriad:${DB_PASSWORD}@localhost:5432/myriad

# ========================================
# 服务器配置
# ========================================
SERVER_HOST=127.0.0.1
SERVER_PORT=3000
RUST_LOG=info,myriad_backend=debug

# ========================================
# 前端配置
# ========================================
FRONTEND_DIST_PATH=/opt/myriad/frontend/dist

# ========================================
# GitHub OAuth 配置
# ========================================
GITHUB_CLIENT_ID=${GITHUB_CLIENT_ID}
GITHUB_CLIENT_SECRET=${GITHUB_CLIENT_SECRET}
GITHUB_REDIRECT_URL=https://${DOMAIN}/api/auth/github/callback

# ========================================
# JWT 配置
# ========================================
JWT_SECRET=${JWT_SECRET}

# ========================================
# 前端地址
# ========================================
FRONTEND_URL=https://${DOMAIN}

# ========================================
# 安全配置
# ========================================
CORS_ORIGINS=https://${DOMAIN}

# ========================================
# AI 配置
# ========================================
GEMINI_API_KEY=${GEMINI_API_KEY}
GEMINI_MODEL=gemini-1.5-flash

# ========================================
# UI 配置
# ========================================
UI_WALLPAPER_URL=https://images.unsplash.com/photo-1579546929518-9e396f3cc809
UI_WALLPAPER_BLUR=3
EOF
    
    chmod 600 /opt/myriad/backend/.env
    
    # 保存配置信息
    cat > /root/myriad-config.txt << EOF
Myriad 配置信息
==============
域名: ${DOMAIN}
JWT Secret: ${JWT_SECRET}
GitHub Client ID: ${GITHUB_CLIENT_ID}

配置文件位置: /opt/myriad/backend/.env

⚠️  请妥善保管此文件
EOF
    
    chmod 600 /root/myriad-config.txt
    
    log_success "环境变量配置完成"
}

# 初始化数据库
init_database() {
    log_info "初始化数据库..."
    
    # 执行数据库迁移
    DB_PASSWORD=$(grep "密码:" /root/myriad-db-info.txt | awk '{print $2}')
    
    export PGPASSWORD=$DB_PASSWORD
    psql -h localhost -U myriad -d myriad -f /opt/myriad/database/schema.sql
    psql -h localhost -U myriad -d myriad -f /opt/myriad/database/009_create_users_table.sql
    unset PGPASSWORD
    
    log_success "数据库初始化完成"
}

# 编译后端
build_backend() {
    log_info "编译后端 (这可能需要几分钟)..."
    
    cd /opt/myriad/backend
    source $HOME/.cargo/env
    cargo build --release
    
    log_success "后端编译完成"
}

# 构建前端
build_frontend() {
    log_info "构建前端..."
    
    cd /opt/myriad/frontend
    pnpm install
    pnpm run build
    
    log_success "前端构建完成"
}

# 创建 systemd 服务
create_systemd_service() {
    log_info "创建 systemd 服务..."
    
    cat > /etc/systemd/system/myriad-backend.service << 'EOF'
[Unit]
Description=Myriad Backend Service
After=network.target postgresql.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/myriad/backend
Environment="RUST_LOG=info,myriad_backend=debug"
EnvironmentFile=/opt/myriad/backend/.env
ExecStart=/opt/myriad/backend/target/release/myriad-backend
Restart=always
RestartSec=10

# 安全配置
NoNewPrivileges=true
PrivateTmp=true

# 日志配置
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
    
    # 重载 systemd
    systemctl daemon-reload
    
    # 启动服务
    systemctl start myriad-backend
    systemctl enable myriad-backend
    
    # 等待服务启动
    sleep 3
    
    # 检查服务状态
    if systemctl is-active --quiet myriad-backend; then
        log_success "后端服务启动成功"
    else
        log_error "后端服务启动失败"
        journalctl -u myriad-backend -n 20
        exit 1
    fi
}

# 配置 Nginx
configure_nginx() {
    log_info "配置 Nginx..."
    
    DOMAIN=$(grep "域名:" /root/myriad-config.txt | awk '{print $2}')
    
    cat > /etc/nginx/sites-available/myriad << EOF
server {
    listen 80;
    server_name ${DOMAIN} www.${DOMAIN};
    
    # 临时允许 HTTP (用于申请 SSL)
    root /opt/myriad/frontend/dist;
    index index.html;
    
    location / {
        try_files \$uri \$uri/ /index.html;
    }
    
    location /api {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
    
    location /health {
        proxy_pass http://127.0.0.1:3000;
        access_log off;
    }
}
EOF
    
    # 创建软链接
    ln -sf /etc/nginx/sites-available/myriad /etc/nginx/sites-enabled/
    
    # 删除默认站点
    rm -f /etc/nginx/sites-enabled/default
    
    # 测试配置
    nginx -t
    
    # 重载 Nginx
    systemctl reload nginx
    
    log_success "Nginx 配置完成"
}

# 配置防火墙
configure_firewall() {
    log_info "配置防火墙..."
    
    case $OS in
        ubuntu|debian)
            # UFW
            ufw --force enable
            ufw allow 22/tcp
            ufw allow 80/tcp
            ufw allow 443/tcp
            ufw status
            ;;
        centos|rhel|rocky|almalinux)
            # Firewalld
            systemctl start firewalld
            systemctl enable firewalld
            firewall-cmd --permanent --add-service=ssh
            firewall-cmd --permanent --add-service=http
            firewall-cmd --permanent --add-service=https
            firewall-cmd --reload
            firewall-cmd --list-all
            ;;
    esac
    
    log_success "防火墙配置完成"
}

# 安装 SSL 证书 (Let's Encrypt)
install_ssl() {
    log_info "安装 SSL 证书..."
    
    DOMAIN=$(grep "域名:" /root/myriad-config.txt | awk '{print $2}')
    
    echo -e "${YELLOW}是否安装 Let's Encrypt SSL 证书? (y/n)${NC}"
    read -r response
    
    if [[ "$response" != "y" ]]; then
        log_warn "跳过 SSL 安装"
        return
    fi
    
    # 安装 Certbot
    case $OS in
        ubuntu|debian)
            apt-get install -y certbot python3-certbot-nginx
            ;;
        centos|rhel|rocky|almalinux)
            yum install -y certbot python3-certbot-nginx
            ;;
    esac
    
    # 申请证书
    certbot --nginx -d ${DOMAIN} -d www.${DOMAIN} --non-interactive --agree-tos --email admin@${DOMAIN}
    
    # 设置自动续期
    echo "0 3 * * * certbot renew --quiet" | crontab -
    
    log_success "SSL 证书安装完成"
}

# 创建部署脚本
create_deploy_script() {
    log_info "创建部署脚本..."
    
    cat > /opt/myriad/deploy.sh << 'EOF'
#!/bin/bash

set -e

echo "🚀 开始部署 Myriad..."

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PROJECT_DIR="/opt/myriad"

# 拉取最新代码
echo -e "${YELLOW}📥 拉取最新代码...${NC}"
cd $PROJECT_DIR
git pull origin main

# 编译后端
echo -e "${YELLOW}🔨 编译后端...${NC}"
cd $PROJECT_DIR/backend
source $HOME/.cargo/env
cargo build --release

# 构建前端
echo -e "${YELLOW}🎨 构建前端...${NC}"
cd $PROJECT_DIR/frontend
pnpm install
pnpm run build

# 重启后端服务
echo -e "${YELLOW}🔄 重启后端服务...${NC}"
systemctl restart myriad-backend

# 等待服务启动
sleep 5

# 检查服务状态
if systemctl is-active --quiet myriad-backend; then
    echo -e "${GREEN}✅ 后端服务运行正常${NC}"
else
    echo -e "${RED}❌ 后端服务启动失败${NC}"
    journalctl -u myriad-backend -n 20
    exit 1
fi

# 重载 Nginx
echo -e "${YELLOW}🌐 重载 Nginx...${NC}"
nginx -t && nginx -s reload

echo -e "${GREEN}🎉 部署完成！${NC}"
EOF
    
    chmod +x /opt/myriad/deploy.sh
    
    log_success "部署脚本创建完成: /opt/myriad/deploy.sh"
}

# 创建备份脚本
create_backup_script() {
    log_info "创建备份脚本..."
    
    cat > /opt/myriad/backup.sh << 'EOF'
#!/bin/bash

BACKUP_DIR="/opt/backups/myriad"
DATE=$(date +%Y%m%d_%H%M%S)
DB_NAME="myriad"

mkdir -p $BACKUP_DIR

# 读取数据库密码
DB_PASSWORD=$(grep "密码:" /root/myriad-db-info.txt | awk '{print $2}')

# 备份数据库
export PGPASSWORD=$DB_PASSWORD
pg_dump -U myriad -h localhost $DB_NAME | gzip > $BACKUP_DIR/myriad_db_$DATE.sql.gz
unset PGPASSWORD

# 保留最近 30 天的备份
find $BACKUP_DIR -name "myriad_db_*.sql.gz" -mtime +30 -delete

echo "数据库备份完成: myriad_db_$DATE.sql.gz"
EOF
    
    chmod +x /opt/myriad/backup.sh
    
    # 设置定时备份
    echo "0 2 * * * /opt/myriad/backup.sh >> /var/log/myriad-backup.log 2>&1" | crontab -
    
    log_success "备份脚本创建完成: /opt/myriad/backup.sh"
}

# 显示部署信息
show_deployment_info() {
    DOMAIN=$(grep "域名:" /root/myriad-config.txt | awk '{print $2}')
    
    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                                                           ║${NC}"
    echo -e "${GREEN}║          🎉 Myriad 部署成功！                             ║${NC}"
    echo -e "${GREEN}║                                                           ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${CYAN}访问地址:${NC}"
    echo -e "  • http://${DOMAIN}"
    echo -e "  • https://${DOMAIN} ${GREEN}(如果已安装 SSL)${NC}"
    echo ""
    echo -e "${CYAN}重要文件:${NC}"
    echo -e "  • 项目目录: /opt/myriad"
    echo -e "  • 数据库信息: /root/myriad-db-info.txt"
    echo -e "  • 配置信息: /root/myriad-config.txt"
    echo -e "  • 环境变量: /opt/myriad/backend/.env"
    echo ""
    echo -e "${CYAN}常用命令:${NC}"
    echo -e "  • 查看后端状态: systemctl status myriad-backend"
    echo -e "  • 查看后端日志: journalctl -u myriad-backend -f"
    echo -e "  • 重启后端: systemctl restart myriad-backend"
    echo -e "  • 重新部署: /opt/myriad/deploy.sh"
    echo -e "  • 数据库备份: /opt/myriad/backup.sh"
    echo ""
    echo -e "${YELLOW}⚠️  下一步操作:${NC}"
    echo -e "  1. 配置 GitHub OAuth (如果未配置)"
    echo -e "     • 访问: https://github.com/settings/developers"
    echo -e "     • 创建 OAuth App"
    echo -e "     • 回调地址: https://${DOMAIN}/api/auth/github/callback"
    echo -e "     • 更新 /opt/myriad/backend/.env 中的配置"
    echo -e "     • 重启服务: systemctl restart myriad-backend"
    echo ""
    echo -e "  2. 配置 DNS"
    echo -e "     • 添加 A 记录指向服务器 IP"
    echo -e "     • 等待 DNS 生效后安装 SSL 证书"
    echo ""
    echo -e "  3. 查看完整文档"
    echo -e "     • /opt/myriad/docs/1PANEL_部署指南.md"
    echo -e "     • /opt/myriad/docs/GITHUB_OAUTH_申请指南.md"
    echo ""
    echo -e "${GREEN}感谢使用 Myriad！${NC}"
    echo ""
}

# 主函数
main() {
    print_banner
    
    log_info "开始安装 Myriad 项目..."
    echo ""
    
    # 检查 root 权限
    check_root
    
    # 检测操作系统
    detect_os
    
    # 安装步骤
    install_base_dependencies
    install_postgresql
    setup_postgresql
    install_rust
    install_nodejs
    install_nginx
    clone_project
    configure_env
    init_database
    build_backend
    build_frontend
    create_systemd_service
    configure_nginx
    configure_firewall
    install_ssl
    create_deploy_script
    create_backup_script
    
    # 显示部署信息
    show_deployment_info
    
    log_success "所有步骤完成！"
}

# 执行主函数
main "$@"
