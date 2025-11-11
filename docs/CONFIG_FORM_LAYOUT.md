# Modern Config Form 布局说明

## 设计概述

新的配置表单采用卡片式设计：

- **主卡片**：包含搜索、收藏夹、最近访问、所有配置列表
- **详情卡片/模态框**：点击配置项后弹出，显示具体的配置表单

## HTML 结构

```html
<div class="modern-config-container">
  <!-- 主卡片 -->
  <div class="main-config-card">
    <!-- 卡片头部 -->
    <div class="card-header">
      <h2>系统配置</h2>
      <p>配置数据平台、AI服务、报告生成等系统功能</p>
    </div>

    <!-- 搜索栏 -->
    <div class="modern-search-bar">
      <div class="search-input-wrapper">
        <FaSearch class="search-icon" />
        <input type="text" class="search-input" placeholder="搜索配置项..." />
        <button class="search-clear">
          <FaTimes />
        </button>
      </div>
    </div>

    <!-- 快速访问区域 -->
    <div class="quick-access-section">
      <!-- 收藏夹 -->
      <div class="quick-access-group">
        <h3 class="quick-access-title">
          <FaStar class="title-icon" />
          收藏夹
        </h3>
        <div class="quick-access-grid">
          <button class="quick-access-card active">
            <div class="card-icon">🌐</div>
            <div class="card-label">数据平台</div>
            <button class="favorite-btn active">★</button>
          </button>
          <button class="quick-access-card">
            <div class="card-icon">🤖</div>
            <div class="card-label">AI配置</div>
            <button class="favorite-btn active">★</button>
          </button>
        </div>
      </div>

      <!-- 最近访问 -->
      <div class="quick-access-group">
        <h3 class="quick-access-title">
          <FaClock class="title-icon" />
          最近访问
        </h3>
        <div class="quick-access-grid">
          <button class="quick-access-card">
            <div class="card-icon">📊</div>
            <div class="card-label">报告生成</div>
            <button class="favorite-btn">☆</button>
          </button>
        </div>
      </div>
    </div>

    <!-- 分隔线 -->
    <hr class="section-divider" />

    <!-- 所有配置列表 -->
    <div class="config-list-section">
      <h3 class="section-title-bar">🔧 所有配置</h3>

      <div class="config-items-list">
        <!-- 配置项 -->
        <button
          class="config-item-card"
          onclick="openConfigDetail('platforms')"
        >
          <div class="config-item-left">
            <div class="config-item-icon-wrapper">
              <div class="config-item-icon">🌐</div>
            </div>
            <div class="config-item-info">
              <div class="config-item-name">数据平台</div>
              <div class="config-item-desc">配置 Bilibili、Steam 等数据源</div>
            </div>
          </div>
          <div class="config-item-right">
            <span class="status-badge configured">已配置</span>
            <div class="config-item-arrow">→</div>
          </div>
        </button>

        <button class="config-item-card" onclick="openConfigDetail('ai')">
          <div class="config-item-left">
            <div class="config-item-icon-wrapper">
              <div class="config-item-icon">🤖</div>
            </div>
            <div class="config-item-info">
              <div class="config-item-name">AI配置</div>
              <div class="config-item-desc">配置 AI 模型和 API 密钥</div>
            </div>
          </div>
          <div class="config-item-right">
            <span class="status-badge unconfigured">未配置</span>
            <div class="config-item-arrow">→</div>
          </div>
        </button>

        <button class="config-item-card">
          <div class="config-item-left">
            <div class="config-item-icon-wrapper">
              <div class="config-item-icon">📊</div>
            </div>
            <div class="config-item-info">
              <div class="config-item-name">报告生成</div>
              <div class="config-item-desc">设置报告话题风格和生成选项</div>
            </div>
          </div>
          <div class="config-item-right">
            <div class="config-item-arrow">→</div>
          </div>
        </button>

        <!-- 更多配置项... -->
      </div>
    </div>
  </div>

  <!-- 配置详情模态框 -->
  <div class="config-detail-modal">
    <div class="config-detail-card">
      <!-- 模态框头部 -->
      <div class="config-detail-header">
        <div class="config-detail-title-section">
          <div class="config-detail-icon-wrapper">
            <div class="config-detail-icon">🌐</div>
          </div>
          <div class="config-detail-title-text">
            <h3>数据平台配置</h3>
            <p>配置各个数据源的 Token 和相关设置</p>
          </div>
        </div>
        <button class="config-detail-close">
          <FaTimes />
        </button>
      </div>

      <!-- 模态框内容 -->
      <div class="config-detail-body">
        <!-- 这里放具体的配置表单 -->
        <div class="config-form">
          <!-- 平台卡片、表单字段等 -->
        </div>
      </div>

      <!-- 模态框底部 -->
      <div class="config-detail-footer">
        <button class="test-button">测试配置</button>
        <button class="test-button">保存</button>
      </div>
    </div>
  </div>
</div>
```

## 关键样式类说明

### 容器和卡片

- `.modern-config-container`: 整体容器，最大宽度 1200px
- `.main-config-card`: 主卡片，白色背景，圆角阴影
- `.card-header`: 卡片标题区域

### 搜索

- `.modern-search-bar`: 搜索栏容器
- `.search-input-wrapper`: 搜索输入框包装器
- `.search-input`: 搜索输入框
- `.search-icon`: 搜索图标
- `.search-clear`: 清除按钮

### 快速访问

- `.quick-access-section`: 快速访问区域
- `.quick-access-group`: 收藏夹/最近访问分组
- `.quick-access-title`: 分组标题
- `.quick-access-grid`: 卡片网格布局
- `.quick-access-card`: 快速访问卡片
- `.quick-access-card.active`: 激活状态
- `.favorite-btn`: 收藏按钮
- `.favorite-btn.active`: 已收藏状态

### 配置列表

- `.config-list-section`: 配置列表区域
- `.section-title-bar`: 区域标题
- `.config-items-list`: 配置项列表
- `.config-item-card`: 配置项卡片
- `.config-item-icon-wrapper`: 图标包装器
- `.config-item-info`: 配置项信息
- `.config-item-name`: 配置项名称
- `.config-item-desc`: 配置项描述
- `.config-item-arrow`: 箭头指示器

### 详情模态框

- `.config-detail-modal`: 模态框背景遮罩
- `.config-detail-card`: 详情卡片
- `.config-detail-header`: 详情头部
- `.config-detail-body`: 详情内容区
- `.config-detail-footer`: 详情底部按钮区
- `.config-detail-close`: 关闭按钮

### 状态徽章

- `.status-badge.configured`: 已配置徽章（绿色）
- `.status-badge.unconfigured`: 未配置徽章（橙色）

## 响应式设计

### 桌面端 (>= 1024px)

- 快速访问网格：5 列
- 配置列表：单列全宽
- 模态框：最大宽度 600px

### 平板端 (640px - 1023px)

- 快速访问网格：3 列
- 配置列表：单列全宽

### 移动端 (< 640px)

- 快速访问网格：2 列
- 卡片内边距减小
- 字体大小调整
- 模态框高度 95vh

## 交互效果

1. **悬停效果**

   - 卡片边框颜色变化
   - 轻微阴影
   - 配置项向右平移

2. **激活状态**

   - 边框加粗
   - 背景颜色高亮
   - 外发光效果

3. **动画**

   - 模态框淡入 + 上滑
   - 搜索结果下滑显示
   - 收藏按钮缩放

4. **深色模式**
   - 所有颜色自动适配
   - 对比度保持可读性

## 颜色方案

### 浅色模式

- 主色调：#3b82f6 (蓝色)
- 背景：白色 / #f9fafb
- 边框：#e5e7eb
- 文字：#1f2937 / #6b7280

### 深色模式

- 主色调：#60a5fa (亮蓝)
- 背景：rgba(31, 41, 55, 0.95)
- 边框：rgba(75, 85, 99, 0.5)
- 文字：#f3f4f6 / #9ca3af
