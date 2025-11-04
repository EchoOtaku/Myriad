#!/bin/bash

# ============================================
# Myriad 清理脚本 (Linux/macOS)
# ============================================
# 用途：删除所有配置文件、数据库、缓存和构建文件以进行全新测试
# 警告：此操作不可逆！所有数据将被永久删除！

# 颜色定义
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
GRAY='\033[0;90m'
NC='\033[0m' # No Color

echo -e "${RED}====================================="
echo -e "  Myriad 配置清理工具"
echo -e "=====================================${NC}"
echo ""
echo -e "${YELLOW}警告：此脚本将删除以下内容："
echo -e "  - 数据库数据（删除并重建表结构）"
echo -e "  - 后端构建文件 (target/)"
echo -e "  - 前端构建文件 (frontend/dist/)"
echo -e "  - 缓存文件 (backend/cache/)"
echo -e "  - 环境配置文件 (backend/.env)${NC}"
echo ""

# 确认删除
read -p "确定要继续吗？此操作不可逆！(yes/no): " confirmation
if [ "$confirmation" != "yes" ]; then
    echo -e "${GREEN}操作已取消${NC}"
    exit 0
fi

echo ""
echo -e "${CYAN}开始清理...${NC}"

# 1. Clear database data (keep container)
echo -e "${CYAN}[1/6] 清空数据库数据...${NC}"
if docker ps --filter "name=myriad-postgres" --format "{{.Names}}" 2>/dev/null | grep -q "myriad-postgres"; then
    echo -e "${GRAY}  正在删除所有表和迁移历史...${NC}"
    # Drop all tables in the database
    docker exec myriad-postgres psql -U myriad -d myriad -c "DO \$\$ DECLARE r RECORD; BEGIN FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE'; END LOOP; END \$\$;" 2>/dev/null
    echo -e "${GREEN}  ✓ 所有数据库表已成功删除${NC}"
else
    echo -e "${YELLOW}  ! 数据库容器未运行${NC}"
fi

# 2. 删除后端构建文件
echo -e "${CYAN}[2/6] 删除后端构建文件...${NC}"
if [ -d "backend/target" ]; then
    rm -rf backend/target
    echo -e "${GREEN}  ✓ 后端构建文件已删除${NC}"
else
    echo -e "${GRAY}  - 后端构建文件不存在${NC}"
fi

# 3. 删除前端构建文件
echo -e "${CYAN}[3/6] 删除前端构建文件...${NC}"
if [ -d "frontend/dist" ]; then
    rm -rf frontend/dist
    echo -e "${GREEN}  ✓ 前端构建文件已删除${NC}"
else
    echo -e "${GRAY}  - 前端构建文件不存在${NC}"
fi

# 可选：删除 node_modules（取消注释以启用）
# if [ -d "frontend/node_modules" ]; then
#     rm -rf frontend/node_modules
#     echo -e "${GREEN}  ✓ 前端 node_modules 已删除${NC}"
# fi

# 4. 删除缓存文件
echo -e "${CYAN}[4/6] 删除缓存文件...${NC}"
if [ -d "backend/cache" ]; then
    rm -f backend/cache/*.json
    echo -e "${GREEN}  ✓ 缓存文件已删除${NC}"
else
    echo -e "${GRAY}  - 缓存目录不存在${NC}"
fi

# 5. 删除环境配置文件
echo -e "${CYAN}[5/6] 删除环境配置文件...${NC}"
if [ -f "backend/.env" ]; then
    rm -f backend/.env
    echo -e "${GREEN}  ✓ .env 文件已删除${NC}"
else
    echo -e "${GRAY}  - .env 文件不存在${NC}"
fi

# 额外清理：删除根目录 target/ (flycheck 产生的)
if [ -d "target" ]; then
    rm -rf target
    echo -e "${GREEN}  ✓ 根目录 target/ 已删除${NC}"
fi

echo ""
echo -e "${GREEN}====================================="
echo -e "  清理完成！"
echo -e "=====================================${NC}"
echo ""
echo -e "${CYAN}后续步骤：${NC}"
echo -e "${NC}  1. 运行 ./scripts/start.sh 启动服务${NC}"
echo -e "${NC}  2. 使用设置向导初始化数据库和创建管理员用户${NC}"
echo -e "${GRAY}  (数据库容器仍在运行，所有表已清空)${NC}"
echo ""
