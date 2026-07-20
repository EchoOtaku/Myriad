/**
 * Aro — 社交中心 Tapp
 *
 * 统一管理消息 (Channel/Room)、时间线、环网、个人资料
 * 展示 Tapp.federation.* SDK 的完整用法
 */

import type { TappManifest } from '../../types'
import type { ExampleTapp, TappCodeStructure } from './types'

// ==================== Page HTML ====================
const PAGE_HTML = `\
<!-- 背景层 -->
<div id="tapp-background">
  <div class="page-bg-base"></div>
  <div class="page-bg-glow page-bg-glow-1"></div>
  <div class="page-bg-glow page-bg-glow-2"></div>
</div>

<!-- 内容层 -->
<div id="tapp-content">
  <!-- 顶部导航栏 -->
  <nav id="aro-nav" class="aro-nav">
    <button class="aro-nav-item aro-nav-active" data-view="feed" id="nav-feed">
      <div id="nav-feed-avatar" class="nav-feed-avatar">?</div>
      <span id="nav-feed-label" class="nav-feed-name"></span>
    </button>
    <button class="aro-nav-item" data-view="messages" id="nav-messages">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>
      <span id="nav-messages-label">信使</span>
    </button>
    <button class="aro-nav-item" data-view="rings" id="nav-rings">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M0 15L24 9"/></svg>
      <span id="nav-rings-label">环网</span>
    </button>
  </nav>

  <!-- ====== 信使视图 ====== -->
  <div id="view-messages" class="aro-view">
    <div class="messenger-app">
      <!-- 左侧：会话列表 -->
      <aside id="sidebar" class="sidebar">
        <div class="sidebar-header">
          <h2 class="sidebar-title">信使</h2>
          <button id="create-btn" class="create-btn" title="新建">+</button>
        </div>
        <div class="aro-search-bar">
          <span class="aro-search-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg></span>
          <input id="conv-search" class="aro-search-input" type="search" autocomplete="off" enterkeyhint="search" placeholder="搜索会话…" />
        </div>
        <div id="conv-list" class="conv-list"></div>
      </aside>

      <!-- 中间：聊天区 -->
      <main id="chat-main" class="chat-main">
        <div id="empty-state" class="empty-state">
          <div class="empty-icon"><svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 4L12 13 2 4"/></svg></div>
          <p class="empty-text">选择一个会话开始聊天</p>
        </div>
        <div id="chat-container" class="chat-container" style="display:none">
          <div id="chat-header" class="chat-header">
            <button id="back-btn" class="back-btn">←</button>
            <div id="chat-hdr-avatar" class="chat-hdr-avatar"></div>
            <div class="chat-header-info">
              <div id="chat-name" class="chat-name"></div>
              <div id="chat-meta" class="chat-meta"></div>
            </div>
            <div id="chat-actions" class="chat-actions"></div>
          </div>
          <div id="pinned-bar" class="pinned-bar" style="display:none"></div>
          <div id="messages" class="messages-area"></div>
          <div class="input-float-wrap">
            <div id="quote-preview" class="quote-preview" style="display:none"></div>
            <div id="attach-preview" class="attach-preview" style="display:none"></div>
            <div id="input-bar" class="input-bar">
              <button id="attach-btn" class="attach-btn" title="附件">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
              </button>
              <textarea id="msg-input" class="msg-input" rows="1" placeholder="输入消息..."></textarea>
              <button id="send-btn" class="send-btn" disabled aria-label="Send">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 20V4M5 11l7-7 7 7"/>
                </svg>
              </button>
            </div>
          </div>
          <input id="attach-file-input" type="file" style="display:none" />
          <input id="attach-image-input" type="file" accept="image/*" style="display:none" />
        </div>
      </main>

      <!-- 群文件面板（仅群聊；覆盖在消息视图上，复用 history 侧栏壳） -->
      <div id="room-files-overlay" class="history-overlay" style="display:none" role="dialog" aria-modal="true" aria-labelledby="room-files-title" hidden>
        <div class="history-sheet" role="document">
          <div class="history-grab" aria-hidden="true"><span class="history-grab-bar"></span></div>
          <div class="history-header">
            <div class="history-header-leading">
              <div class="history-header-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
              </div>
              <div class="history-header-text">
                <h3 id="room-files-title" class="history-title">群文件</h3>
                <div id="room-files-subtitle" class="history-subtitle"></div>
              </div>
            </div>
            <button type="button" id="room-files-close" class="history-close" aria-label="Close">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <div class="history-toolbar">
            <div class="aro-search-bar history-search-bar">
              <span class="aro-search-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg></span>
              <input id="room-files-search" class="aro-search-input" type="search" autocomplete="off" enterkeyhint="search" placeholder="搜索文件名…" />
            </div>
            <div id="room-files-filters" class="history-filters" role="tablist" aria-label="Filter">
              <button type="button" class="history-filter history-filter-active" data-room-files-filter="all" role="tab" aria-selected="true">全部</button>
              <button type="button" class="history-filter" data-room-files-filter="image" role="tab" aria-selected="false">图片</button>
              <button type="button" class="history-filter" data-room-files-filter="file" role="tab" aria-selected="false">文件</button>
            </div>
          </div>
          <div id="room-files-list" class="history-list"></div>
          <div class="history-footer">
            <div id="room-files-meta" class="history-meta"></div>
            <button type="button" id="room-files-load-more" class="history-load-more" hidden>加载更多</button>
            <p id="room-files-hint" class="room-files-hint"></p>
          </div>
        </div>
      </div>

      <!-- 聊天记录面板（覆盖在消息视图上） -->
      <div id="chat-history-overlay" class="history-overlay" style="display:none" role="dialog" aria-modal="true" aria-labelledby="history-title" hidden>
        <div class="history-sheet" role="document">
          <div class="history-grab" aria-hidden="true"><span class="history-grab-bar"></span></div>
          <div class="history-header">
            <div class="history-header-leading">
              <div class="history-header-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
              </div>
              <div class="history-header-text">
                <h3 id="history-title" class="history-title">聊天记录</h3>
                <div id="history-subtitle" class="history-subtitle"></div>
              </div>
            </div>
            <button type="button" id="history-close" class="history-close" aria-label="Close">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <div class="history-toolbar">
            <div class="aro-search-bar history-search-bar">
              <span class="aro-search-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg></span>
              <input id="history-search" class="aro-search-input" type="search" autocomplete="off" enterkeyhint="search" placeholder="搜索聊天记录…" />
            </div>
            <div id="history-filters" class="history-filters" role="tablist" aria-label="Filter">
              <button type="button" class="history-filter history-filter-active" data-history-filter="all" role="tab" aria-selected="true">全部</button>
              <button type="button" class="history-filter" data-history-filter="text" role="tab" aria-selected="false">文字</button>
              <button type="button" class="history-filter" data-history-filter="image" role="tab" aria-selected="false">图片</button>
              <button type="button" class="history-filter" data-history-filter="file" role="tab" aria-selected="false">文件</button>
              <button type="button" class="history-filter" data-history-filter="share" role="tab" aria-selected="false">分享</button>
              <button type="button" class="history-filter" data-history-filter="pinned" role="tab" aria-selected="false">置顶</button>
            </div>
          </div>
          <div id="history-list" class="history-list"></div>
          <div class="history-footer">
            <div id="history-meta" class="history-meta"></div>
            <button type="button" id="history-load-more" class="history-load-more" hidden>加载更早消息</button>
          </div>
        </div>
      </div>

      <!-- 右侧：成员面板 -->
      <aside id="member-panel" class="member-panel" style="display:none">
        <div class="member-header">
          <button id="member-back-btn" class="member-back-btn">←</button>
          <h3 id="member-title" class="member-title">成员</h3>
          <div id="invite-wrap" class="invite-wrap" style="display:none">
            <button id="invite-toggle" class="aro-icon-btn invite-toggle" title="邀请成员">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
            </button>
          </div>
        </div>
        <div class="aro-search-bar aro-search-bar-compact">
          <span class="aro-search-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg></span>
          <input id="member-search" class="aro-search-input" type="search" autocomplete="off" enterkeyhint="search" placeholder="搜索成员…" />
        </div>
        <div id="member-list" class="member-list"></div>
      </aside>
    </div>
  </div>

  <!-- ====== 动态视图 (Feed, X-style sidebar + content) ====== -->
  <div id="view-feed" class="aro-view aro-view-active">
    <div class="feed-layout">
      <!-- Left sidebar -->
      <aside class="feed-sidebar" id="feed-sidebar">
        <nav class="feed-sidebar-nav">
          <button class="feed-nav-item feed-nav-active" data-sub="timeline">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/><path d="M9 22V12h6v10"/></svg>
            <span id="feed-nav-timeline">动态</span>
          </button>
          <button class="feed-nav-item" data-sub="following">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M20 8v6M23 11h-6"/></svg>
            <span id="feed-nav-following">关注</span>
            <span class="feed-nav-badge" id="feed-badge-following" hidden>0</span>
          </button>
          <button class="feed-nav-item" data-sub="followers">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>
            <span id="feed-nav-followers">粉丝</span>
            <span class="feed-nav-badge" id="feed-badge-followers" hidden>0</span>
          </button>
          <button class="feed-nav-item" data-sub="published">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>
            <span id="feed-nav-published">已发布</span>
            <span class="feed-nav-badge" id="feed-badge-published" hidden>0</span>
          </button>
          <button class="feed-nav-item" data-sub="backup">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 11l5 5 5-5M4 20h16"/></svg>
            <span id="feed-nav-backup">备份</span>
          </button>
        </nav>
        <div class="feed-sidebar-footer">
          <div class="feed-profile-card" data-fed-profile>
            <div class="feed-profile-summary" data-fed-toggle role="button" tabindex="0" aria-expanded="false">
              <div id="feed-avatar" class="feed-avatar" data-feed-avatar>?</div>
              <div class="feed-profile-info">
                <div id="feed-display-name" class="feed-display-name" data-feed-display-name></div>
                <div id="feed-handle" class="feed-handle" data-fed-handle-summary></div>
              </div>
              <button class="feed-profile-copy" data-copy-fed="handle" title="复制">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
              </button>
              <button class="feed-profile-toggle" data-fed-toggle-button title="展开">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
              </button>
            </div>
            <div class="feed-profile-details" data-fed-details>
              <button class="feed-identity-actor" data-copy-fed="actor" type="button" data-fed-actor></button>
            </div>
            <div class="feed-profile-tablet-popover" data-fed-tablet-popover>
              <div class="feed-profile-tablet-main">
                <div class="feed-profile-info">
                  <div class="feed-display-name" data-feed-display-name></div>
                  <div class="feed-handle" data-fed-handle-summary></div>
                </div>
                <button class="feed-profile-copy" data-copy-fed="handle" title="复制">
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                </button>
                <button class="feed-profile-toggle" data-fed-toggle-button title="展开">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
                </button>
              </div>
              <div class="feed-profile-details" data-fed-details>
                <button class="feed-identity-actor" data-copy-fed="actor" type="button" data-fed-actor></button>
              </div>
            </div>
          </div>
        </div>
      </aside>
      <!-- Main content -->
      <main class="feed-main">
        <div class="feed-main-header">
          <div class="feed-header-leading">
            <div class="feed-main-heading">
              <div id="feed-section-title" class="feed-section-title">首页</div>
              <div id="feed-section-meta" class="feed-section-meta">关注的人与你的动态</div>
            </div>
          </div>
          <div class="feed-header-actions">
            <button id="refresh-feed-btn" class="feed-refresh-btn" title="刷新">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
            </button>
            <div class="feed-plus-wrap" id="feed-plus-wrap" style="display:none">
              <button id="feed-plus-btn" class="feed-plus-btn" type="button" title="添加" aria-haspopup="menu" aria-expanded="false" aria-controls="feed-plus-menu">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
              </button>
              <div id="feed-plus-menu" class="feed-plus-menu" role="menu" hidden>
                <button type="button" role="menuitem" class="feed-plus-item" data-feed-plus="post" id="feed-plus-post">
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                  <span id="feed-plus-post-label">发帖</span>
                </button>
                <button type="button" role="menuitem" class="feed-plus-item" data-feed-plus="follow" id="feed-plus-follow">
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></svg>
                  <span id="feed-plus-follow-label">关注</span>
                </button>
              </div>
            </div>
          </div>
        </div>
        <!-- Mobile tabs (visible only on small screens) -->
        <div class="feed-mobile-tabs" id="feed-mobile-tabs">
          <div class="feed-plus-wrap feed-plus-wrap-mobile" id="feed-plus-wrap-mobile" style="display:none">
            <button id="feed-plus-mobile-btn" class="feed-mobile-compose" type="button" title="添加" aria-haspopup="menu" aria-expanded="false" aria-controls="feed-plus-menu-mobile">
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
            </button>
            <div id="feed-plus-menu-mobile" class="feed-plus-menu feed-plus-menu-mobile" role="menu" hidden>
              <button type="button" role="menuitem" class="feed-plus-item" data-feed-plus="post" id="feed-plus-post-mobile">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                <span id="feed-plus-post-label-mobile">发帖</span>
              </button>
              <button type="button" role="menuitem" class="feed-plus-item" data-feed-plus="follow" id="feed-plus-follow-mobile">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></svg>
                <span id="feed-plus-follow-label-mobile">关注</span>
              </button>
            </div>
          </div>
          <button class="feed-mobile-tab feed-mobile-tab-active" data-sub="timeline"><span id="feed-tab-timeline">动态</span></button>
          <button class="feed-mobile-tab" data-sub="following"><span id="feed-tab-following">关注</span><span class="feed-nav-badge" id="feed-mobile-badge-following" hidden>0</span></button>
          <button class="feed-mobile-tab" data-sub="followers"><span id="feed-tab-followers">粉丝</span><span class="feed-nav-badge" id="feed-mobile-badge-followers" hidden>0</span></button>
          <button class="feed-mobile-tab" data-sub="published"><span id="feed-tab-published">已发布</span><span class="feed-nav-badge" id="feed-mobile-badge-published" hidden>0</span></button>
          <button class="feed-mobile-tab" data-sub="backup"><span id="feed-tab-backup">备份</span></button>
          <button id="refresh-feed-mobile-btn" class="feed-mobile-refresh" title="刷新">
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
          </button>
        </div>
        <div class="feed-profile-card feed-profile-mobile" data-fed-profile>
          <div class="feed-profile-summary" data-fed-toggle role="button" tabindex="0" aria-expanded="false">
            <div class="feed-avatar" data-feed-avatar>?</div>
            <div class="feed-profile-info">
              <div class="feed-display-name" data-feed-display-name></div>
              <div class="feed-handle" data-fed-handle-summary></div>
            </div>
            <button class="feed-profile-copy" data-copy-fed="handle" title="复制">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
            </button>
            <button class="feed-profile-toggle" data-fed-toggle-button title="展开">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
            </button>
          </div>
          <div class="feed-profile-details" data-fed-details>
            <button class="feed-identity-actor" data-copy-fed="actor" type="button" data-fed-actor></button>
          </div>
        </div>
        <div class="aro-search-bar feed-search-bar">
          <span class="aro-search-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg></span>
          <input id="feed-search" class="aro-search-input" type="search" autocomplete="off" enterkeyhint="search" placeholder="搜索动态…" />
        </div>
        <div id="feed-content" class="feed-content"></div>
        <div id="feed-empty" class="feed-empty" style="display:none">
          <div class="aro-empty-mark feed-empty-mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5a14 14 0 0114 14"/><path d="M5 11a8 8 0 018 8"/><circle cx="6" cy="18" r="1.6"/></svg></div>
          <div id="feed-empty-title" class="feed-empty-title">还没有动态</div>
          <span id="feed-empty-text">关注别人或发帖，首页就会亮起来</span>
          <button type="button" id="feed-empty-retry" class="feed-empty-retry">重试</button>
        </div>
      </main>
    </div>
  </div>

  <!-- ====== 环网视图 ====== -->
  <div id="view-rings" class="aro-view">
    <div class="aro-panel-layout">
      <!-- 左侧：环网列表 -->
      <aside id="ring-sidebar" class="sidebar">
        <div class="sidebar-header">
          <h2 id="ring-sidebar-title" class="sidebar-title">环网</h2>
          <button id="ring-create-open-btn" class="create-btn" title="新建">+</button>
        </div>
        <div class="aro-search-bar">
          <span class="aro-search-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg></span>
          <input id="ring-search" class="aro-search-input" type="search" autocomplete="off" enterkeyhint="search" placeholder="搜索环网…" />
        </div>
        <div id="ring-list" class="conv-list"></div>
      </aside>
      <!-- 右侧：环网详情 -->
      <main class="panel-main">
        <div id="ring-empty-state" class="empty-state">
          <div class="empty-icon"><svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M0 15L24 9"/></svg></div>
          <p class="empty-text" id="ring-select-hint">选择一个环网查看详情</p>
        </div>
        <div id="ring-detail" class="panel-detail" style="display:none">
          <div class="panel-detail-header">
            <button id="ring-back-btn" class="back-btn">←</button>
            <div id="ring-detail-icon" class="ring-hdr-icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M0 15L24 9"/></svg></div>
            <div class="chat-header-info">
              <div id="ring-detail-name" class="chat-name"></div>
              <div id="ring-detail-meta" class="chat-meta"></div>
            </div>
            <div class="chat-actions">
              <button id="ring-sync-btn" class="action-btn ring-action-sync" title="同步">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                <span id="ring-sync-label">同步</span>
              </button>
              <div class="manage-wrap">
                <button id="ring-manage-btn" class="aro-icon-btn manage-btn">⋯</button>
                <div id="ring-manage-dropdown" class="manage-dropdown">
                  <button id="ring-leave-btn" class="manage-item manage-item-danger">
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/></svg>
                    <span id="ring-leave-label">退出环网</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
          <!-- Ring ID (always visible for cross-instance join) -->
          <div class="ring-id-bar" id="ring-id-bar">
            <span class="ring-id-label" id="ring-id-label">Ring ID</span>
            <code class="ring-id-value" id="ring-id-value" title=""></code>
            <button type="button" class="ring-id-copy" id="ring-id-copy" title="Copy" aria-label="Copy">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
            </button>
          </div>
          <!-- 同步状态 -->
          <div id="ring-sync-status" class="ring-sync-bar" style="display:none"></div>
          <!-- 添加节点 -->
          <div class="invite-bar" id="ring-peer-bar">
            <input id="ring-peer-input" class="invite-input" type="text" placeholder="Actor URL 或 @user@domain" />
            <button id="ring-add-peer-btn" class="invite-btn">添加</button>
          </div>
          <!-- 节点列表 -->
          <div id="ring-peers-list" class="member-list"></div>
          <div id="ring-peers-empty" class="conv-empty" style="display:none">
            <span data-i18n-empty-peers>暂无节点</span>
          </div>
        </div>
      </main>
    </div>
  </div>

  <!-- 创建环网对话框 -->
  <div id="ring-create-dialog" class="create-overlay" style="display:none">
    <div class="create-dialog">
      <div class="create-dialog-header">
        <h3 id="ring-create-title" class="create-dialog-title">创建环网</h3>
        <button id="ring-create-close" class="create-dialog-close">✕</button>
      </div>
      <div class="create-form">
        <input id="ring-name-input" class="create-input" type="text" placeholder="环网名称" />
        <select id="ring-type-select" class="create-input" style="height:40px;cursor:pointer">
          <option id="ring-type-opt-brew" value="brew-recommend">Brew 推荐</option>
          <option id="ring-type-opt-tapp" value="tapp-store">Tapp 商店</option>
          <option id="ring-type-opt-library" value="library-exchange">资料交换</option>
          <option id="ring-type-opt-instance" value="instance-directory">实例目录</option>
        </select>
        <div id="ring-brew-category-wrap" style="display:none;flex-direction:column;gap:6px">
          <label id="ring-brew-category-label" for="ring-brew-category-select" style="font-size:12px;opacity:.8">Brew category (optional)</label>
          <select id="ring-brew-category-select" class="create-input" style="height:40px;cursor:pointer">
            <option id="ring-brew-category-all" value="">All my categories</option>
          </select>
          <input id="ring-brew-category-input" class="create-input" type="text" placeholder="Or type a category name" style="display:none" />
        </div>
        <button id="create-ring-btn" class="create-submit">创建</button>
      </div>
    </div>
  </div>

  <!-- 关注对话框（从 feed + 菜单打开） -->
  <div id="feed-follow-dialog" class="create-overlay" style="display:none">
    <div class="create-dialog">
      <div class="create-dialog-header">
        <h3 id="feed-follow-dialog-title" class="create-dialog-title">关注</h3>
        <button id="feed-follow-dialog-close" class="create-dialog-close" type="button">✕</button>
      </div>
      <div class="create-form">
        <input id="feed-follow-input" class="create-input" type="text" placeholder="Actor URL 或 @user@domain" autocomplete="off" />
        <button id="feed-follow-btn" class="create-submit" type="button">关注</button>
      </div>
    </div>
  </div>

  <!-- 发帖对话框（从 feed + 菜单打开；与关注弹窗同级） -->
  <div id="feed-compose-dialog" class="create-overlay feed-compose-overlay" style="display:none" role="dialog" aria-modal="true" aria-labelledby="feed-compose-dialog-title">
    <div class="create-dialog feed-compose-dialog">
      <div class="create-dialog-header">
        <div class="feed-compose-title-row">
          <h3 id="feed-compose-dialog-title" class="create-dialog-title">发帖</h3>
          <span id="feed-compose-draft-hint" class="feed-compose-draft-hint" hidden></span>
        </div>
        <button id="feed-compose-dialog-close" class="create-dialog-close" type="button" aria-label="Close">✕</button>
      </div>
      <div class="feed-compose-body">
        <textarea id="feed-compose-text" class="feed-compose-text" rows="4" placeholder="分享点什么…"></textarea>
        <div id="feed-compose-previews" class="feed-compose-previews"></div>
        <div id="feed-compose-draft-notice" class="feed-compose-draft-notice" hidden></div>
        <div class="feed-compose-actions">
          <div class="feed-compose-attach">
            <button type="button" id="feed-compose-image-btn" class="feed-compose-tool" title="图片">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
              <span id="feed-compose-image-label">图片</span>
            </button>
            <button type="button" id="feed-compose-video-btn" class="feed-compose-tool" title="视频">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M10 9l5 3-5 3V9z"/></svg>
              <span id="feed-compose-video-label">视频</span>
            </button>
            <input id="feed-compose-image-input" type="file" accept="image/jpeg,image/png,image/gif,image/webp" multiple style="display:none" />
            <input id="feed-compose-video-input" type="file" accept="video/mp4,video/webm,video/quicktime" multiple style="display:none" />
          </div>
          <div class="feed-compose-submit">
            <button type="button" id="feed-compose-cancel" class="feed-compose-cancel">取消</button>
            <button type="button" id="feed-compose-publish" class="feed-compose-publish">发布</button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- 创建对话框 -->
  <div id="create-dialog" class="create-overlay" style="display:none">
    <div class="create-dialog">
      <div class="create-dialog-header">
        <h3 id="create-dialog-title" class="create-dialog-title">新建</h3>
        <button id="create-dialog-close" class="create-dialog-close">✕</button>
      </div>
      <div class="create-dialog-tabs">
        <button id="create-tab-channel" class="create-tab create-tab-active" data-tab="channel">私信</button>
        <button id="create-tab-room" class="create-tab" data-tab="room">群聊</button>
      </div>
      <div id="create-form-channel" class="create-form">
        <input id="create-channel-input" class="create-input" type="text" placeholder="Actor URL 或 @user@domain" />
        <button id="create-channel-btn" class="create-submit">创建通道</button>
      </div>
      <div id="create-form-room" class="create-form" style="display:none">
        <input id="create-room-input" class="create-input" type="text" placeholder="房间名称" />
        <button id="create-room-btn" class="create-submit">创建房间</button>
      </div>
    </div>
  </div>

  <!-- 编辑房间对话框 -->
  <div id="edit-room-dialog" class="create-overlay" style="display:none">
    <div class="create-dialog">
      <div class="create-dialog-header">
        <h3 id="edit-room-title" class="create-dialog-title">编辑房间</h3>
        <button id="edit-room-close" class="create-dialog-close">✕</button>
      </div>
      <div class="create-form">
        <label class="edit-label" id="edit-name-label">房间名称</label>
        <input id="edit-room-name" class="create-input" type="text" />
        <label class="edit-label" id="edit-desc-label">房间描述</label>
        <input id="edit-room-desc" class="create-input" type="text" />
        <button id="edit-room-save" class="create-submit">保存</button>
      </div>
    </div>
  </div>
</div>
`

const STYLES = `\
/* ===== Dark Mode Variable Bridge ===== */
:root{--text-primary:#1a1a1a;--text-secondary:#999;--bg-primary:#fff}
.dark{--text-primary:rgba(255,255,255,.92);--text-secondary:rgba(255,255,255,.5);--bg-primary:#0a0a0a;color-scheme:dark}
body.dark{background:#0a0a0a;color:rgba(255,255,255,.92)}

/* ===== Tapp Content Override ===== */
#tapp-content{display:flex!important;flex-direction:column!important;overflow:hidden!important}

/* ===== Aro Nav ===== */
.aro-nav{display:flex;align-items:center;gap:4px;padding:8px 12px;border-bottom:1px solid rgba(128,128,128,.08);flex-shrink:0;background:rgba(255,255,255,.78);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}
.aro-nav-item{min-height:36px;display:flex;align-items:center;gap:8px;padding:0 14px;border:none;background:none;border-radius:11px;font-size:13px;font-weight:600;color:var(--text-secondary,#888);cursor:pointer;transition:background .14s,color .14s;white-space:nowrap}
.aro-nav-item:hover{background:rgba(128,128,128,.07);color:var(--text-primary,#222)}
.aro-nav-item:focus-visible{outline:2px solid rgba(var(--tapp-primary-rgb,99,102,241),.45);outline-offset:1px}
.aro-nav-active{background:rgba(var(--tapp-primary-rgb,100,100,255),.12)!important;color:var(--tapp-primary,#6366f1)!important}
.aro-nav-item svg{flex-shrink:0;opacity:.9}
.aro-nav-active svg{opacity:1}
/* Nav Feed Avatar */
.nav-feed-avatar{width:24px;height:24px;border-radius:50%;background:rgba(var(--tapp-primary-rgb,128,128,128),.14);color:var(--tapp-primary,#6366f1);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0;overflow:hidden}
.nav-feed-avatar img{width:100%;height:100%;object-fit:cover}
.nav-feed-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:96px}

/* ===== Aro Views ===== */
.aro-view{display:none;flex:1;min-height:0;min-width:0;width:100%;overflow:hidden}
.aro-view-active{display:flex;flex-direction:column;width:100%;max-width:none}

/* ===== Panel Layout (sidebar+content, for rings) ===== */
.aro-panel-layout{display:flex;flex:1;min-height:0;overflow:hidden}
.panel-main{flex:1;min-width:0;display:flex;flex-direction:column;position:relative;overflow:hidden}
.panel-detail{flex:1;min-height:0;display:flex;flex-direction:column}
.panel-detail-header{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid rgba(128,128,128,.06);flex-shrink:0}
.panel-detail-body{flex:1;overflow-y:auto;padding:16px}

/* ===== Ring header icon ===== */
.ring-hdr-icon{width:32px;height:32px;border-radius:8px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:16px;background:rgba(var(--tapp-primary-rgb,128,128,128),.08)}
.ring-action-sync{display:flex;align-items:center;gap:4px;background:rgba(var(--tapp-primary-rgb,100,100,255),.08);color:var(--tapp-primary,#6366f1);border:none;border-radius:10px;padding:4px 10px;font-size:11px;font-weight:500;cursor:pointer;transition:background .15s}
.ring-action-sync:hover{background:rgba(var(--tapp-primary-rgb,100,100,255),.16)}
.ring-sync-bar{font-size:11px;padding:8px 14px;border-bottom:1px solid rgba(128,128,128,.06);display:flex;align-items:center;gap:6px}
.ring-sync-bar.ring-sync-ok{color:#22c55e;background:rgba(34,197,94,.04)}
.ring-sync-bar.ring-sync-err{color:#ef4444;background:rgba(239,68,68,.04)}
/* Ring ID row — always show id under header for cross-instance sharing */
.ring-id-bar{display:flex;align-items:center;gap:8px;padding:8px 14px;border-bottom:1px solid rgba(128,128,128,.06);flex-shrink:0;background:rgba(128,128,128,.03);min-width:0}
.ring-id-label{font-size:10px;font-weight:600;letter-spacing:.02em;color:var(--text-secondary,#536471);flex-shrink:0;text-transform:uppercase}
.ring-id-value{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:11px;line-height:1.35;padding:6px 9px;border-radius:9px;background:rgba(128,128,128,.06);color:var(--text-primary,#0f1419)}
.ring-id-copy{width:28px;height:28px;border:none;border-radius:9px;background:rgba(var(--tapp-primary-rgb,100,100,255),.08);color:var(--tapp-primary,#6366f1);display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;transition:background .15s}
.ring-id-copy:hover{background:rgba(var(--tapp-primary-rgb,100,100,255),.14)}
.ring-id-copy:disabled{opacity:.45;cursor:default}

/* ===== Feed Layout (X-style sidebar + content) =====
   Two columns only: [sidebar | main]. Main fills remaining width after sidebar
   (no border-right phantom third column). Content stretches naturally inside main. */
.feed-layout{display:flex;flex:1 1 auto;width:100%;max-width:none;min-height:0;min-width:0;overflow:hidden}
/* Feed Sidebar */
.feed-sidebar{width:232px;flex:0 0 232px;flex-shrink:0;border-right:1px solid rgba(128,128,128,.08);display:flex;flex-direction:column;padding:14px 12px;overflow:hidden}
.feed-avatar{width:36px;height:36px;border-radius:50%;background:rgba(var(--tapp-primary-rgb,128,128,128),.1);color:var(--tapp-primary,#888);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:600;flex-shrink:0;overflow:hidden}
.feed-avatar img{width:100%;height:100%;object-fit:cover}
.feed-display-name{font-size:13px;font-weight:700;color:var(--text-primary,#0f1419);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.feed-handle{font-size:11px;color:var(--text-secondary,#536471);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
/* Sidebar Nav */
.feed-sidebar-nav{display:flex;flex-direction:column;gap:4px;padding:2px 0 8px;flex:1;overflow-y:auto;min-height:0}
.feed-nav-item{display:flex;align-items:center;gap:13px;padding:11px 13px;border:none;background:none;border-radius:14px;font-size:14px;font-weight:600;color:var(--text-primary,#0f1419);cursor:pointer;transition:background .15s,color .15s;white-space:nowrap;text-align:left;width:100%;position:relative}
.feed-nav-item:hover{background:rgba(128,128,128,.08)}
.feed-nav-active{background:rgba(var(--tapp-primary-rgb,100,100,255),.1)!important;color:var(--tapp-primary,#6366f1);font-weight:700!important}
.feed-nav-active svg{stroke-width:2.5}
.feed-nav-item svg{flex-shrink:0}
.feed-nav-badge{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 5px;margin-left:auto;border-radius:999px;font-size:10px;font-weight:700;line-height:1;letter-spacing:-.01em;background:rgba(var(--tapp-primary-rgb,100,100,255),.12);color:var(--tapp-primary,#6366f1);flex-shrink:0;box-sizing:border-box}
.feed-nav-badge[hidden]{display:none!important}
.feed-nav-active .feed-nav-badge{background:rgba(var(--tapp-primary-rgb,100,100,255),.2)}
/* Sidebar Footer (profile) */
.feed-sidebar-footer{flex-shrink:0;border-top:1px solid rgba(128,128,128,.06);padding-top:12px;display:flex;flex-direction:column;gap:10px}
.feed-profile-card{display:flex;flex-direction:column;gap:0;padding:8px;border:1px solid rgba(128,128,128,.12);border-radius:12px;background:rgba(128,128,128,.035);min-width:0}
.feed-profile-summary{min-width:0;display:flex;align-items:center;gap:9px;border-radius:10px;cursor:pointer;outline:none}
.feed-profile-summary:focus-visible{box-shadow:0 0 0 2px rgba(var(--tapp-primary-rgb,100,100,255),.35)}
.feed-profile-info{min-width:0;flex:1;display:flex;flex-direction:column;gap:1px}
.feed-profile-copy,.feed-profile-toggle{width:28px;height:28px;border:none;border-radius:9px;background:rgba(var(--tapp-primary-rgb,100,100,255),.08);color:var(--tapp-primary,#6366f1);display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;transition:background .15s,transform .15s}
.feed-profile-copy:hover,.feed-profile-toggle:hover{background:rgba(var(--tapp-primary-rgb,100,100,255),.14)}
.feed-profile-toggle{background:rgba(128,128,128,.06);color:var(--text-secondary,#536471)}
.feed-profile-card.feed-profile-expanded .feed-profile-toggle svg{transform:rotate(180deg)}
.feed-profile-details{max-height:0;overflow:hidden;opacity:0;transition:max-height .18s ease,opacity .15s ease,padding-top .18s ease}
.feed-profile-card.feed-profile-expanded .feed-profile-details{max-height:56px;opacity:1;padding-top:8px}
.feed-identity-actor{width:100%;padding:9px 10px;border:none;border-radius:9px;background:rgba(128,128,128,.06);text-align:left;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:11px;line-height:1.35;color:var(--text-primary,#0f1419)}
.feed-profile-card.feed-identity-actor-missing .feed-profile-details{display:none}
.feed-identity-actor:disabled{cursor:default}
.feed-profile-tablet-popover{display:none}
.feed-profile-tablet-main{display:flex;align-items:center;gap:9px;min-width:0}
.feed-profile-mobile{display:none;margin:10px 16px 0;flex-shrink:0}
/* Feed Main — fills remaining width after sidebar (header spans full main; no third-column border) */
.feed-main{
  flex:1 1 0%;
  min-width:0;
  max-width:none!important;
  width:auto;
  display:flex;
  flex-direction:column;
  overflow-y:auto;
  position:relative;
  border-right:none!important;
  box-sizing:border-box;
}
/* Feed header */
.feed-main-header{min-height:56px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 16px;border-bottom:1px solid rgba(128,128,128,.06);flex-shrink:0;background:rgba(255,255,255,.45);backdrop-filter:blur(12px);position:relative;z-index:5;overflow:visible}
.feed-header-leading{display:flex;align-items:center;gap:10px;min-width:0;flex:1}
.feed-plus-wrap{position:relative;flex-shrink:0}
.feed-plus-btn{width:36px;height:36px;min-width:36px;min-height:36px;border-radius:10px;border:none;background:var(--tapp-primary,#6366f1);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:opacity .15s,transform .12s,box-shadow .15s}
.feed-plus-btn:hover{opacity:.92}
.feed-plus-btn:active{transform:scale(.96)}
.feed-plus-btn[aria-expanded="true"]{box-shadow:0 0 0 3px rgba(var(--tapp-primary-rgb,99,102,241),.22)}
.feed-plus-btn:focus-visible{outline:2px solid rgba(var(--tapp-primary-rgb,99,102,241),.5);outline-offset:2px}
.feed-plus-menu{display:none;position:absolute;right:0;top:calc(100% + 6px);min-width:148px;padding:4px;border-radius:12px;border:1px solid rgba(128,128,128,.12);background:var(--bg-primary,#fff);box-shadow:0 10px 28px rgba(0,0,0,.12);z-index:60;overflow:hidden}
.feed-plus-menu.open{display:block}
.feed-plus-menu-mobile{left:0;right:auto}
.feed-plus-item{display:flex;align-items:center;gap:10px;width:100%;padding:9px 12px;border:none;border-radius:8px;background:none;color:var(--text-primary,#1a1a1a);font-size:13px;font-weight:600;cursor:pointer;text-align:left;transition:background .12s,transform .1s}
.feed-plus-item:hover{background:rgba(var(--tapp-primary-rgb,99,102,241),.08);color:var(--tapp-primary,#6366f1)}
.feed-plus-item:active{transform:scale(.98)}
.feed-plus-item svg{flex-shrink:0;opacity:.85}
.feed-plus-item[hidden]{display:none!important}
.dark .feed-plus-menu{background:var(--bg-primary,#1a1a1a);border-color:rgba(255,255,255,.1);box-shadow:0 12px 32px rgba(0,0,0,.4)}
.dark .feed-plus-item{color:rgba(255,255,255,.92)}
.dark .feed-plus-item:hover{background:rgba(var(--tapp-primary-rgb,99,102,241),.16);color:var(--tapp-primary,#818cf8)}
/* Compose dialog (overlay sheet; same tier as follow dialog) */
.feed-compose-dialog{width:min(440px,92vw);max-height:min(88vh,640px);padding:18px 18px 16px;display:flex;flex-direction:column;box-sizing:border-box}
.feed-compose-title-row{display:flex;align-items:baseline;gap:8px;min-width:0;flex:1}
.feed-compose-title-row .create-dialog-title{flex-shrink:0}
.feed-compose-draft-hint{font-size:11px;font-weight:500;color:var(--tapp-primary,#6366f1);opacity:.9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.feed-compose-draft-hint[hidden],.feed-compose-draft-notice[hidden]{display:none!important}
.feed-compose-body{display:flex;flex-direction:column;min-height:0;flex:1}
.feed-compose-text{width:100%;min-height:100px;max-height:40vh;resize:vertical;border:1px solid rgba(128,128,128,.15);border-radius:12px;padding:10px 12px;font-size:14px;line-height:1.5;background:rgba(128,128,128,.03);color:var(--text-primary,#1a1a1a);outline:none;font-family:inherit;box-sizing:border-box}
.dark .feed-compose-text{background:rgba(255,255,255,.03);border-color:rgba(255,255,255,.1);color:rgba(255,255,255,.92)}
.feed-compose-text:focus{border-color:rgba(var(--tapp-primary-rgb,99,102,241),.45);box-shadow:0 0 0 3px rgba(99,102,241,.12)}
.feed-compose-previews{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.feed-compose-preview{position:relative;width:88px;height:88px;border-radius:10px;overflow:hidden;background:rgba(128,128,128,.08);border:1px solid rgba(128,128,128,.12)}
.feed-compose-preview img,.feed-compose-preview video{width:100%;height:100%;object-fit:cover;display:block}
.feed-compose-preview-remove{position:absolute;top:4px;right:4px;width:22px;height:22px;border:none;border-radius:50%;background:rgba(0,0,0,.55);color:#fff;cursor:pointer;font-size:14px;line-height:1;display:flex;align-items:center;justify-content:center}
.feed-compose-draft-notice{margin-top:8px;padding:8px 10px;border-radius:10px;background:rgba(245,158,11,.1);color:#b45309;font-size:12px;line-height:1.4}
.dark .feed-compose-draft-notice{background:rgba(245,158,11,.12);color:#fbbf24}
.feed-compose-actions{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:12px;flex-wrap:wrap}
.feed-compose-attach{display:flex;gap:6px}
.feed-compose-tool{display:inline-flex;align-items:center;gap:5px;padding:6px 10px;border-radius:8px;border:1px solid rgba(128,128,128,.12);background:transparent;color:var(--text-secondary,#666);font-size:12px;cursor:pointer}
.feed-compose-tool:hover{border-color:var(--tapp-primary,#6366f1);color:var(--tapp-primary,#6366f1)}
.feed-compose-submit{display:flex;gap:8px;margin-left:auto}
.feed-compose-cancel{padding:7px 14px;border-radius:8px;border:1px solid rgba(128,128,128,.15);background:transparent;color:var(--text-secondary,#666);font-size:13px;cursor:pointer}
.feed-compose-publish{padding:7px 16px;border-radius:8px;border:none;background:var(--tapp-primary,#6366f1);color:#fff;font-size:13px;font-weight:600;cursor:pointer}
.feed-compose-publish:disabled,.feed-compose-cancel:disabled,.feed-compose-tool:disabled{opacity:.5;cursor:not-allowed}
@media(max-width:768px){
  .feed-compose-overlay{align-items:flex-end;justify-content:center;padding:0}
  .feed-compose-dialog{width:100%;max-width:100%;min-height:0;max-height:92vh;border-radius:16px 16px 0 0;padding:16px 16px calc(16px + env(safe-area-inset-bottom,0px))}
  .feed-compose-dialog{animation:aroSlideUp var(--aro-dur) var(--aro-ease) both}
  .feed-compose-overlay.aro-leaving .feed-compose-dialog{animation:aroSheetOut 160ms ease both}
  .feed-compose-text{min-height:120px;max-height:36vh}
}
.feed-item-media{margin-top:10px}
.feed-item-media-single{display:block;border-radius:12px;overflow:hidden;background:rgba(128,128,128,.05)}
.feed-item-media-single img,.feed-item-media-single video{display:block;width:100%;max-height:320px;object-fit:cover;vertical-align:middle}
.feed-item-media-grid{display:grid;grid-template-columns:1fr 1fr;gap:3px;border-radius:12px;overflow:hidden;background:rgba(128,128,128,.05)}
.feed-media-cell{position:relative;aspect-ratio:1;overflow:hidden;background:rgba(128,128,128,.06)}
.feed-media-cell img,.feed-media-cell video{width:100%;height:100%;object-fit:cover;display:block}
.feed-main-heading{min-width:0;display:flex;flex-direction:column;gap:2px}
.feed-section-title{font-size:16px;font-weight:750;color:var(--text-primary,#0f1419);line-height:1.2}
.feed-section-meta{min-height:15px;font-size:11px;font-weight:500;color:var(--text-secondary,#536471);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.feed-header-actions{display:flex;align-items:center;gap:8px;flex-shrink:0;position:relative;z-index:6;overflow:visible}
.feed-refresh-btn{width:36px;height:36px;min-width:36px;min-height:36px;border:none;border-radius:8px;background:rgba(128,128,128,.06);color:var(--text-secondary,#536471);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .15s,color .15s,transform .15s;flex-shrink:0}
.feed-refresh-btn:hover{background:rgba(var(--tapp-primary-rgb,100,100,255),.11);color:var(--tapp-primary,#6366f1)}
.feed-refresh-btn:active{transform:scale(.96)}
.feed-refresh-btn:disabled{opacity:.65;cursor:default;transform:none}
.feed-refresh-loading svg{animation:aroSpin .8s linear infinite}
@keyframes aroSpin{to{transform:rotate(360deg)}}
/* Feed Mobile Tabs (hidden on desktop) */
.feed-mobile-tabs{display:none;border-bottom:1px solid rgba(128,128,128,.08);flex-shrink:0;background:rgba(255,255,255,.45);position:relative;z-index:5;overflow:visible}
.feed-mobile-tab{flex:1;display:inline-flex;align-items:center;justify-content:center;gap:4px;padding:12px 4px;border:none;background:none;font-size:13px;font-weight:500;color:var(--text-secondary,#536471);cursor:pointer;text-align:center;transition:all .15s;border-bottom:2px solid transparent;min-width:0}
.feed-mobile-tab:hover{background:rgba(128,128,128,.04)}
.feed-mobile-tab-active{color:var(--text-primary,#0f1419)!important;font-weight:700;border-bottom-color:var(--tapp-primary,#6366f1)!important}
.feed-mobile-tab .feed-nav-badge{margin-left:0;min-width:16px;height:16px;padding:0 4px;font-size:9px}
.feed-plus-wrap-mobile{display:flex;align-items:stretch;flex-shrink:0;position:relative}
.feed-mobile-compose{width:44px;border:none;background:none;color:var(--tapp-primary,#6366f1);display:flex;align-items:center;justify-content:center;cursor:pointer;border-bottom:2px solid transparent;flex-shrink:0}
.feed-mobile-compose:hover{background:rgba(99,102,241,.08)}
.feed-mobile-compose[aria-expanded="true"]{background:rgba(99,102,241,.1)}
.feed-mobile-refresh{width:44px;border:none;background:none;color:var(--text-secondary,#536471);display:flex;align-items:center;justify-content:center;cursor:pointer;border-bottom:2px solid transparent}
.feed-mobile-refresh:hover{background:rgba(128,128,128,.04);color:var(--tapp-primary,#6366f1)}
.feed-mobile-refresh:disabled{opacity:.55;cursor:default}
.feed-mobile-refresh.feed-refresh-loading svg{animation:aroSpin .8s linear infinite}
/* Follow dialog form (reuses create-dialog shell) */
.feed-follow-input,.create-form #feed-follow-input{width:100%}
#feed-follow-btn:disabled{opacity:.5;cursor:not-allowed}
/* Feed content / empty — fill main column naturally (host shell caps overall width) */
.feed-content{flex:1 1 auto;min-height:0;width:100%;max-width:none;box-sizing:border-box}
.feed-empty{min-height:280px;padding:56px 24px;text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:var(--text-secondary,#536471);font-size:13px;line-height:1.5;width:100%;max-width:none;box-sizing:border-box}
.feed-main.feed-empty-visible .feed-content{display:none}
.feed-main.feed-empty-visible .feed-empty{display:flex;flex:1;min-height:0}
.aro-empty-mark{width:52px;height:52px;border-radius:16px;background:rgba(128,128,128,.06);color:var(--text-secondary,#536471);display:flex;align-items:center;justify-content:center;flex-shrink:0}
.aro-empty-mark svg{width:24px;height:24px}
.feed-empty-title{display:block;font-size:15px;font-weight:700;color:var(--text-primary,#0f1419);letter-spacing:-.01em}
#feed-empty-text{display:block;max-width:360px}
.feed-empty-error .aro-empty-mark{background:rgba(239,68,68,.08);color:#ef4444}
.feed-empty-error #feed-empty-text{color:#b91c1c}
.feed-empty-retry{margin-top:6px;padding:8px 18px;border:none;border-radius:999px;background:var(--tapp-primary,#6366f1);color:#fff;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;display:none}
.feed-empty-error .feed-empty-retry{display:inline-flex}
.feed-empty-retry:hover{filter:brightness(1.05)}
.feed-empty-retry:active{transform:scale(.97)}
.feed-skeleton-item{display:flex;gap:10px;padding:14px 16px;border-bottom:1px solid rgba(128,128,128,.06)}
.feed-skeleton-avatar{width:40px;height:40px;border-radius:50%;flex-shrink:0;background:linear-gradient(90deg,rgba(128,128,128,.08),rgba(128,128,128,.16),rgba(128,128,128,.08));background-size:200% 100%;animation:aroSkeleton 1.1s ease-in-out infinite}
.feed-skeleton-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:8px;padding-top:3px}
.feed-skeleton-line{height:10px;border-radius:999px;background:linear-gradient(90deg,rgba(128,128,128,.08),rgba(128,128,128,.16),rgba(128,128,128,.08));background-size:200% 100%;animation:aroSkeleton 1.1s ease-in-out infinite}
.feed-skeleton-line-short{width:34%}
.feed-skeleton-line-mid{width:62%}
@keyframes aroSkeleton{0%{background-position:200% 0}100%{background-position:-200% 0}}

/* ===== Feed Items (tweet-like cards) ===== */
.feed-item{display:flex;gap:12px;padding:16px 18px;border-bottom:1px solid rgba(128,128,128,.06);transition:background .12s;cursor:default}
.feed-item:hover{background:rgba(128,128,128,.028)}
.feed-item-avatar{width:42px;height:42px;border-radius:50%;flex-shrink:0;overflow:hidden;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:600;background:rgba(var(--tapp-primary-rgb,128,128,128),.1);color:var(--tapp-primary,#6366f1)}
.feed-item-avatar img{width:100%;height:100%;object-fit:cover}
.feed-item-icon{width:42px;height:42px;border-radius:12px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:18px;background:rgba(var(--tapp-primary-rgb,128,128,128),.07)}
.feed-item-body{flex:1;min-width:0}
.feed-item-header{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;min-width:0}
.feed-item-name{font-size:14px;font-weight:700;color:var(--text-primary,#1a1a1a);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:min(46%,220px)}
.feed-item-handle{font-size:13px;color:var(--text-secondary,#8b98a5);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}
.feed-item-sep{font-size:13px;color:var(--text-secondary,#c0c0c0)}
.feed-item-time{font-size:12px;color:var(--text-secondary,#8b98a5);white-space:nowrap;flex-shrink:0;margin-left:auto}
.feed-item-text{font-size:14.5px;line-height:1.55;color:var(--text-primary,#1a1a1a);margin-top:6px;white-space:pre-wrap;overflow-wrap:break-word;max-width:100%}
.feed-item-badges{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.feed-item-actions{display:flex;align-items:center;gap:8px;margin-top:10px;flex-wrap:wrap}
.feed-item-action{display:inline-flex;align-items:center;gap:5px;background:none;border:1px solid transparent;color:var(--text-secondary,#8b98a5);font-size:12px;font-weight:500;cursor:pointer;padding:6px 10px;border-radius:8px;transition:color .12s,background .12s,border-color .12s}
.feed-item-action:hover{color:var(--tapp-primary,#6366f1);background:rgba(var(--tapp-primary-rgb,99,102,241),.06)}
.feed-item-action-danger{color:var(--text-secondary,#999)}
.feed-item-action-danger:hover{color:#ef4444;background:rgba(239,68,68,.06);border-color:rgba(239,68,68,.12)}

/* ===== Aro Badges ===== */
.aro-badge{font-size:10px;padding:2px 8px;border-radius:8px;font-weight:500;white-space:nowrap}
.aro-badge-type{background:rgba(var(--tapp-primary-rgb,100,100,255),.08);color:var(--tapp-primary,#6366f1)}
.aro-badge-status{background:rgba(34,197,94,.1);color:#22c55e}
.aro-badge-pending{background:rgba(245,158,11,.1);color:#f59e0b}
.aro-badge-vis{background:rgba(var(--tapp-primary-rgb,100,100,255),.06);color:var(--tapp-primary,#888)}
.aro-unread-dot{width:7px;height:7px;border-radius:50%;background:var(--tapp-primary,#6366f1);flex-shrink:0;box-shadow:0 0 4px rgba(var(--tapp-primary-rgb,100,100,255),.4)}

/* ===== Dark Mode Overrides for Aro ===== */
.dark .aro-nav{background:rgba(10,10,10,.78)}
.dark .feed-sidebar{border-color:rgba(255,255,255,.06)}
.dark .feed-display-name{color:rgba(255,255,255,.92)}
.dark .feed-nav-item{color:rgba(255,255,255,.85)}
.dark .feed-nav-active{color:rgba(255,255,255,.95)!important}
.dark .feed-sidebar-footer{border-color:rgba(255,255,255,.06)}
.dark .feed-main-header{background:rgba(10,10,10,.52);border-color:rgba(255,255,255,.06)}
.dark .feed-section-title{color:rgba(255,255,255,.92)}
.dark .feed-section-meta{color:rgba(255,255,255,.45)}
.dark .feed-refresh-btn{background:rgba(255,255,255,.06);color:rgba(255,255,255,.56)}
.dark .feed-refresh-btn:hover{background:rgba(var(--tapp-primary-rgb,100,100,255),.16);color:var(--tapp-primary,#818cf8)}
.dark .feed-mobile-tabs{background:rgba(10,10,10,.5)}
.dark .feed-mobile-tab-active{color:rgba(255,255,255,.95)!important}
.dark .feed-mobile-refresh{color:rgba(255,255,255,.5)}
.dark .feed-mobile-refresh:hover{background:rgba(255,255,255,.04);color:var(--tapp-primary,#818cf8)}
.dark .feed-nav-badge{background:rgba(var(--tapp-primary-rgb,100,100,255),.2);color:var(--tapp-primary,#818cf8)}
.dark .feed-profile-card{border-color:rgba(255,255,255,.08);background:rgba(255,255,255,.035)}
.dark .feed-profile-toggle{background:rgba(255,255,255,.045);color:rgba(255,255,255,.48)}
.dark .feed-identity-actor{background:rgba(255,255,255,.06);color:rgba(255,255,255,.68)}
.dark .feed-item-name{color:rgba(255,255,255,.92)}
.dark .feed-item-text{color:rgba(255,255,255,.85)}
.dark .feed-item:hover{background:rgba(255,255,255,.03)}
.dark .feed-follow-input{background:rgba(255,255,255,.03);border-color:rgba(255,255,255,.1);color:rgba(255,255,255,.9)}
.dark .aro-empty-mark{background:rgba(255,255,255,.055);color:rgba(255,255,255,.42)}
.dark .feed-empty-title{color:rgba(255,255,255,.86)}

/* ===== Responsive for Aro Nav ===== */
@media(max-width:768px){
  .aro-nav-item span{display:none}
  .aro-nav-item{padding:8px 12px}
  .aro-nav{justify-content:center;gap:4px}
  .feed-sidebar{display:none}
  .feed-main-header{display:none}
  .feed-mobile-tabs{display:flex}
  .feed-profile-mobile{display:flex}
}

/* ===== Layout ===== */
.messenger-app{display:flex;flex:1;min-height:0;overflow:hidden;position:relative}
.sidebar{display:flex;flex-direction:column;width:280px;border-right:1px solid rgba(128,128,128,.08);flex-shrink:0;overflow:hidden}
.sidebar-header{padding:14px 14px 12px;border-bottom:1px solid rgba(128,128,128,.06);flex-shrink:0;display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:52px}
.sidebar-title{margin:0;font-size:16px;font-weight:700;color:var(--text-primary,#1a1a1a);letter-spacing:-.02em}
.create-btn{width:36px;height:36px;min-width:36px;min-height:36px;border-radius:10px;border:none;background:var(--tapp-primary,#6366f1);color:#fff;font-size:22px;font-weight:400;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:opacity .15s,transform .12s;flex-shrink:0;line-height:1}
.create-btn:hover{opacity:.9}
.create-btn:active{transform:scale(.96)}
.create-btn:focus-visible{outline:2px solid rgba(var(--tapp-primary-rgb,99,102,241),.5);outline-offset:2px}
/* ===== Shared list search ===== */
.aro-search-bar{display:flex;align-items:center;gap:8px;padding:8px 10px 6px;flex-shrink:0;border-bottom:1px solid rgba(128,128,128,.05)}
.aro-search-bar-compact{padding:6px 8px 4px}
.aro-search-icon{display:flex;align-items:center;justify-content:center;color:var(--text-secondary,#999);flex-shrink:0;opacity:.75}
.aro-search-icon svg{display:block}
.aro-search-input{flex:1;min-width:0;height:34px;padding:0 10px;border:1px solid rgba(128,128,128,.12);border-radius:10px;background:rgba(128,128,128,.04);font-size:13px;color:var(--text-primary,#1a1a1a);outline:none;box-sizing:border-box;font-family:inherit}
.aro-search-input::placeholder{color:var(--text-secondary,#999);opacity:.85}
.aro-search-input:focus{border-color:var(--tapp-primary,#6366f1);background:transparent;box-shadow:0 0 0 3px rgba(var(--tapp-primary-rgb,99,102,241),.12)}
.aro-search-empty{padding:24px 12px;font-size:12px;color:var(--text-secondary,#888);text-align:center}
.feed-search-bar{padding:8px 14px 6px;border-bottom:1px solid rgba(128,128,128,.06);background:rgba(255,255,255,.35)}
.dark .aro-search-input{background:rgba(255,255,255,.04);border-color:rgba(255,255,255,.1);color:rgba(255,255,255,.9)}
.dark .aro-search-input:focus{background:rgba(255,255,255,.02);box-shadow:0 0 0 3px rgba(var(--tapp-primary-rgb,99,102,241),.18)}
.dark .aro-search-icon{color:rgba(255,255,255,.45)}
.dark .feed-search-bar{background:rgba(0,0,0,.12);border-color:rgba(255,255,255,.06)}
.forward-search{padding:8px 12px 4px;flex-shrink:0}
.forward-search .aro-search-input{width:100%;flex:none}

/* ===== Chat history panel ===== */
.history-overlay{
  position:absolute;inset:0;z-index:40;display:none;align-items:stretch;justify-content:flex-end;
  background:rgba(15,23,42,.22);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);
}
.history-overlay.aro-history-enter{animation:aroFadeIn var(--aro-dur) ease both}
.history-overlay.aro-leaving{animation:aroFadeOut 150ms ease both;pointer-events:none}
/* history open uses class on overlay (not aroPlayEnter generic) */
.history-sheet{
  width:min(400px,100%);max-width:100%;height:100%;
  background:rgba(255,255,255,.96);border-left:1px solid rgba(128,128,128,.1);
  box-shadow:-16px 0 48px rgba(15,23,42,.12);
  display:flex;flex-direction:column;min-height:0;position:relative;
}
.history-overlay.aro-history-enter .history-sheet{animation:aroSlideInRight var(--aro-dur-view) var(--aro-ease) both}
.history-overlay.aro-leaving .history-sheet{animation:aroHistorySheetOut 150ms ease both}
@keyframes aroHistorySheetOut{from{opacity:1;transform:translateX(0)}to{opacity:.4;transform:translateX(18px)}}
.history-grab{display:none;justify-content:center;padding:8px 0 2px;flex-shrink:0}
.history-grab-bar{width:36px;height:4px;border-radius:999px;background:rgba(128,128,128,.22)}
.history-header{
  display:flex;align-items:center;justify-content:space-between;gap:10px;
  padding:12px 14px 10px;flex-shrink:0;
}
.history-header-leading{display:flex;align-items:center;gap:10px;min-width:0;flex:1}
.history-header-icon{
  width:36px;height:36px;border-radius:11px;flex-shrink:0;
  display:flex;align-items:center;justify-content:center;
  background:rgba(var(--tapp-primary-rgb,99,102,241),.1);color:var(--tapp-primary,#6366f1);
}
.history-header-text{min-width:0;flex:1}
.history-title{margin:0;font-size:15px;font-weight:700;color:var(--text-primary,#0f1419);letter-spacing:-.02em;line-height:1.25}
.history-subtitle{margin-top:2px;font-size:12px;color:var(--text-secondary,#536471);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.history-close{
  width:36px;height:36px;min-width:36px;border:none;border-radius:10px;
  background:rgba(128,128,128,.06);color:var(--text-secondary,#666);
  cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;
  transition:background .12s,color .12s,transform .1s;
}
.history-close:hover{background:rgba(128,128,128,.12);color:var(--text-primary,#222)}
.history-close:active{transform:scale(.96)}
.history-close:focus-visible{outline:2px solid rgba(var(--tapp-primary-rgb,99,102,241),.45);outline-offset:1px}
.history-toolbar{
  flex-shrink:0;padding:0 12px 10px;
  border-bottom:1px solid rgba(128,128,128,.07);
  background:linear-gradient(180deg,rgba(255,255,255,.5),rgba(255,255,255,0));
}
.history-search-bar{padding:0 0 8px;border:none}
.history-search-bar .aro-search-input{height:36px;border-radius:11px;background:rgba(128,128,128,.055)}
.history-filters{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch;padding-bottom:1px}
.history-filters::-webkit-scrollbar{display:none}
.history-filter{
  flex-shrink:0;border:1px solid transparent;background:rgba(128,128,128,.06);
  color:var(--text-secondary,#536471);border-radius:999px;padding:6px 12px;
  font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;line-height:1.2;
  transition:background .12s,color .12s,border-color .12s,transform .1s;
}
.history-filter:hover{background:rgba(128,128,128,.1);color:var(--text-primary,#222)}
.history-filter:active{transform:scale(.97)}
.history-filter:focus-visible{outline:2px solid rgba(var(--tapp-primary-rgb,99,102,241),.4);outline-offset:1px}
.history-filter-active{
  background:rgba(var(--tapp-primary-rgb,99,102,241),.12)!important;
  border-color:rgba(var(--tapp-primary-rgb,99,102,241),.22);
  color:var(--tapp-primary,#6366f1)!important;
}
.history-list{flex:1;min-height:0;overflow-y:auto;padding:8px 10px 14px;display:flex;flex-direction:column;gap:5px}
.history-day{
  display:flex;align-items:center;gap:10px;padding:12px 4px 6px;
  font-size:11px;font-weight:700;letter-spacing:.02em;color:var(--text-secondary,#8b98a5);text-transform:none;
}
.history-day::before,.history-day::after{content:"";flex:1;height:1px;background:rgba(128,128,128,.1)}
.history-item{
  display:flex;align-items:flex-start;gap:10px;width:100%;text-align:left;border:1px solid transparent;
  background:rgba(128,128,128,.035);border-radius:14px;padding:10px 11px;cursor:pointer;font-family:inherit;
  transition:background .12s,border-color .12s,transform .1s,box-shadow .12s;
}
.history-item:hover{
  background:rgba(var(--tapp-primary-rgb,99,102,241),.07);
  border-color:rgba(var(--tapp-primary-rgb,99,102,241),.12);
}
.history-item:active{transform:scale(.985)}
.history-item:focus-visible{outline:2px solid rgba(var(--tapp-primary-rgb,99,102,241),.4);outline-offset:1px}
.history-item-static{cursor:default}
.history-item-static:hover{background:rgba(128,128,128,.035);border-color:transparent}
.history-item-static:active{transform:none}
.history-item-local{background:rgba(var(--tapp-primary-rgb,99,102,241),.05)}
.history-item-avatar{
  width:32px;height:32px;border-radius:50%;flex-shrink:0;overflow:hidden;
  background:rgba(var(--tapp-primary-rgb,128,128,128),.1);color:var(--tapp-primary,#6366f1);
  display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;
}
.history-item-avatar img{width:100%;height:100%;object-fit:cover}
.history-item-avatar-local{background:rgba(var(--tapp-primary-rgb,99,102,241),.16)}
.history-item-body{min-width:0;flex:1}
.history-item-top{display:flex;align-items:center;gap:6px;margin-bottom:3px;min-width:0}
.history-item-name{font-size:12.5px;font-weight:700;color:var(--text-primary,#0f1419);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.history-item-kind{
  font-size:10px;font-weight:700;letter-spacing:.01em;color:var(--text-secondary,#8b98a5);
  padding:2px 7px;border-radius:999px;background:rgba(128,128,128,.08);flex-shrink:0;
}
.history-item-kind-image{color:#0ea5e9;background:rgba(14,165,233,.1)}
.history-item-kind-file{color:#f59e0b;background:rgba(245,158,11,.1)}
.history-item-kind-share{color:var(--tapp-primary,#6366f1);background:rgba(var(--tapp-primary-rgb,99,102,241),.1)}
.history-item-kind-system{color:#64748b;background:rgba(100,116,139,.1)}
.history-item-time{margin-left:auto;font-size:11px;color:var(--text-secondary,#8b98a5);flex-shrink:0;font-variant-numeric:tabular-nums}
.history-item-pin{
  width:16px;height:16px;flex-shrink:0;color:#f59e0b;display:inline-flex;align-items:center;justify-content:center;
}
.history-item-pin svg{width:12px;height:12px}
.history-item-text{
  font-size:13px;line-height:1.45;color:var(--text-primary,#334155);
  display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word;
}
.history-empty{
  flex:1;min-height:180px;padding:40px 20px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;
  text-align:center;font-size:13px;line-height:1.5;color:var(--text-secondary,#8b98a5);
}
.history-empty .aro-empty-mark{margin-bottom:2px}
.history-empty-title{font-size:14px;font-weight:700;color:var(--text-primary,#0f1419)}
.history-footer{
  display:flex;flex-direction:column;gap:8px;padding:10px 12px 14px;
  border-top:1px solid rgba(128,128,128,.07);flex-shrink:0;
  background:rgba(255,255,255,.72);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
}
.history-meta{font-size:11px;font-weight:600;color:var(--text-secondary,#8b98a5);text-align:center;letter-spacing:.01em}
.history-meta-error{color:#ef4444}
.history-load-more{
  width:100%;height:38px;border:1px solid rgba(128,128,128,.12);border-radius:11px;
  background:rgba(128,128,128,.04);color:var(--text-primary,#0f1419);
  font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;
  transition:background .12s,border-color .12s,color .12s,transform .1s;
}
.history-load-more:hover:not(:disabled){
  background:rgba(var(--tapp-primary-rgb,99,102,241),.08);
  border-color:rgba(var(--tapp-primary-rgb,99,102,241),.28);
  color:var(--tapp-primary,#6366f1);
}
.history-load-more:active:not(:disabled){transform:scale(.985)}
.history-load-more:disabled{opacity:.55;cursor:not-allowed}
.history-load-more:focus-visible{outline:2px solid rgba(var(--tapp-primary-rgb,99,102,241),.45);outline-offset:1px}
.msg-row.msg-highlight,.msg-highlight{
  animation:msgHighlight 2s var(--aro-ease);
  border-radius:14px;
}
@keyframes msgHighlight{
  0%{box-shadow:0 0 0 0 rgba(var(--tapp-primary-rgb,99,102,241),.4)}
  18%{box-shadow:0 0 0 3px rgba(var(--tapp-primary-rgb,99,102,241),.28);background:rgba(var(--tapp-primary-rgb,99,102,241),.08)}
  100%{box-shadow:0 0 0 0 transparent;background:transparent}
}
.dark .history-overlay{background:rgba(0,0,0,.45)}
.dark .history-sheet{background:rgba(18,18,18,.98);border-color:rgba(255,255,255,.08);box-shadow:-16px 0 48px rgba(0,0,0,.5)}
.dark .history-toolbar{background:linear-gradient(180deg,rgba(18,18,18,.6),rgba(18,18,18,0));border-color:rgba(255,255,255,.06)}
.dark .history-title,.dark .history-empty-title{color:rgba(255,255,255,.92)}
.dark .history-subtitle,.dark .history-meta,.dark .history-item-time{color:rgba(255,255,255,.45)}
.dark .history-close{background:rgba(255,255,255,.06);color:rgba(255,255,255,.55)}
.dark .history-close:hover{background:rgba(255,255,255,.1);color:rgba(255,255,255,.9)}
.dark .history-item{background:rgba(255,255,255,.035)}
.dark .history-item:hover{background:rgba(var(--tapp-primary-rgb,99,102,241),.14);border-color:rgba(var(--tapp-primary-rgb,99,102,241),.2)}
.dark .history-item-name,.dark .history-item-text{color:rgba(255,255,255,.88)}
.dark .history-item-kind{background:rgba(255,255,255,.08);color:rgba(255,255,255,.5)}
.dark .history-day::before,.dark .history-day::after{background:rgba(255,255,255,.08)}
.dark .history-footer{background:rgba(18,18,18,.82);border-color:rgba(255,255,255,.06)}
.dark .history-load-more{background:rgba(255,255,255,.04);border-color:rgba(255,255,255,.1);color:rgba(255,255,255,.88)}
.dark .history-search-bar .aro-search-input{background:rgba(255,255,255,.045)}
@media(max-width:768px){
  .history-overlay{position:fixed;z-index:90;align-items:flex-end;justify-content:stretch}
  .history-grab{display:flex}
  .history-sheet{
    width:100%;border-left:none;border-radius:18px 18px 0 0;
    max-height:min(92vh,820px);height:min(92vh,820px);margin-top:auto;align-self:flex-end;
    box-shadow:0 -12px 40px rgba(0,0,0,.18);
  }
  .history-overlay.aro-history-enter .history-sheet{animation:aroSlideUp var(--aro-dur-view) var(--aro-ease) both}
  .history-overlay.aro-leaving .history-sheet{animation:aroSheetOut 150ms ease both}
}
@media(prefers-reduced-motion:reduce){
  .history-overlay.aro-history-enter,.history-overlay.aro-history-enter .history-sheet,
  .history-overlay.aro-leaving,.history-overlay.aro-leaving .history-sheet,
  .msg-highlight{animation:none!important}
}

/* Room files panel (reuses history shell) */
.room-files-hint{
  margin:0;padding:2px 6px 0;font-size:10.5px;line-height:1.45;color:var(--text-secondary,#8b98a5);text-align:center;
  opacity:.92;
}
.room-file-item{
  align-items:flex-start!important;gap:12px!important;padding:11px 12px!important;
  border:1px solid transparent;border-radius:14px;
  transition:background .15s ease,border-color .15s ease,box-shadow .15s ease;
}
.room-file-item:hover{
  background:rgba(128,128,128,.045)!important;
  border-color:rgba(128,128,128,.08)!important;
  box-shadow:0 1px 0 rgba(255,255,255,.35) inset;
}
.room-file-tile{
  width:44px;height:44px;border-radius:12px;flex-shrink:0;position:relative;
  display:flex;align-items:center;justify-content:center;
  box-shadow:0 1px 2px rgba(0,0,0,.04) inset;
}
.room-file-tile-image{
  background:linear-gradient(145deg,rgba(14,165,233,.16),rgba(56,189,248,.08));
  color:#0284c7;
}
.room-file-tile-file{
  background:linear-gradient(145deg,rgba(245,158,11,.16),rgba(251,191,36,.08));
  color:#d97706;
}
.room-file-tile-icon{opacity:.92}
.room-file-tile-ext{
  position:absolute;right:3px;bottom:3px;
  font-size:8px;font-weight:800;letter-spacing:.02em;line-height:1;
  padding:2px 4px;border-radius:5px;
  background:rgba(255,255,255,.82);color:inherit;
  box-shadow:0 1px 2px rgba(0,0,0,.06);
  max-width:34px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.room-file-body{min-width:0;flex:1;padding-top:1px}
.room-file-top{flex-wrap:wrap;row-gap:4px}
.room-file-name{font-size:13px!important;letter-spacing:-.015em;max-width:100%}
.room-file-meta-line{opacity:.88;font-size:11.5px!important;margin-top:1px}
.room-file-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px}
.room-file-action-btn{
  display:inline-flex;align-items:center;justify-content:center;gap:5px;
  height:28px;padding:0 10px;border-radius:9px;border:1px solid transparent;
  font-size:11.5px;font-weight:650;letter-spacing:-.01em;cursor:pointer;
  transition:background .12s ease,border-color .12s ease,transform .1s ease,opacity .12s ease;
  -webkit-tap-highlight-color:transparent;
}
.room-file-action-btn:active{transform:scale(.97)}
.room-file-action-btn:focus-visible{outline:2px solid rgba(var(--tapp-primary-rgb,99,102,241),.45);outline-offset:1px}
.room-file-action-btn svg{flex-shrink:0}
.room-file-action-primary{
  color:#fff;
  background:var(--tapp-primary,#6366f1);
  border-color:rgba(var(--tapp-primary-rgb,99,102,241),.35);
  box-shadow:0 1px 2px rgba(var(--tapp-primary-rgb,99,102,241),.25);
}
.room-file-action-primary:hover{filter:brightness(1.05)}
.room-file-action-ghost{
  color:var(--text-secondary,#536471);
  background:rgba(128,128,128,.06);
  border-color:rgba(128,128,128,.1);
}
.room-file-action-ghost:hover{
  color:var(--text-primary,#0f1419);
  background:rgba(128,128,128,.1);
}
.room-file-status{
  font-size:10px;font-weight:700;padding:2px 7px;border-radius:999px;flex-shrink:0;
  letter-spacing:.01em;
}
.room-file-status-ready{color:#16a34a;background:rgba(22,163,74,.1)}
.room-file-status-pending{color:#d97706;background:rgba(217,119,6,.12)}
.room-file-status-missing{color:#94a3b8;background:rgba(148,163,184,.12)}
.room-files-skeleton{display:flex;flex-direction:column;gap:10px;padding:6px 4px}
.room-files-skel-row{
  height:72px;border-radius:14px;
  background:linear-gradient(90deg,rgba(128,128,128,.06) 0%,rgba(128,128,128,.12) 45%,rgba(128,128,128,.06) 100%);
  background-size:200% 100%;
  animation:roomFilesShimmer 1.15s ease-in-out infinite;
}
@keyframes roomFilesShimmer{
  0%{background-position:100% 0}
  100%{background-position:-100% 0}
}
@media(prefers-reduced-motion:reduce){
  .room-files-skel-row{animation:none;background:rgba(128,128,128,.08)}
}
.dark .room-files-hint{color:rgba(255,255,255,.42)}
.dark .room-file-item:hover{
  background:rgba(255,255,255,.04)!important;
  border-color:rgba(255,255,255,.08)!important;
  box-shadow:none;
}
.dark .room-file-tile-image{background:linear-gradient(145deg,rgba(56,189,248,.18),rgba(14,165,233,.08));color:#38bdf8}
.dark .room-file-tile-file{background:linear-gradient(145deg,rgba(251,191,36,.16),rgba(245,158,11,.08));color:#fbbf24}
.dark .room-file-tile-ext{background:rgba(0,0,0,.35);color:inherit}
.dark .room-file-action-ghost{background:rgba(255,255,255,.05);border-color:rgba(255,255,255,.08);color:rgba(255,255,255,.65)}
.dark .room-file-action-ghost:hover{background:rgba(255,255,255,.1);color:rgba(255,255,255,.92)}
.dark .room-file-status-ready{color:#4ade80;background:rgba(74,222,128,.12)}
.dark .room-file-status-pending{color:#fbbf24;background:rgba(251,191,36,.12)}
.dark .room-file-status-missing{color:rgba(255,255,255,.4);background:rgba(255,255,255,.06)}
.dark .room-files-skel-row{
  background:linear-gradient(90deg,rgba(255,255,255,.04) 0%,rgba(255,255,255,.09) 45%,rgba(255,255,255,.04) 100%);
  background-size:200% 100%;
}

/* ===== Profile backup / export-import page ===== */
.backup-page{
  padding:16px 16px 36px;display:flex;flex-direction:column;gap:14px;
  max-width:680px;margin:0 auto;width:100%;box-sizing:border-box;
  animation:aroViewIn var(--aro-dur-view) var(--aro-ease) both;
}
.backup-hero{
  display:flex;align-items:flex-start;gap:12px;padding:4px 2px 2px;
}
.backup-hero-icon{
  width:44px;height:44px;border-radius:14px;flex-shrink:0;
  display:flex;align-items:center;justify-content:center;
  background:linear-gradient(145deg,rgba(var(--tapp-primary-rgb,99,102,241),.16),rgba(var(--tapp-primary-rgb,99,102,241),.06));
  color:var(--tapp-primary,#6366f1);
}
.backup-hero-icon svg{width:22px;height:22px}
.backup-hero-text{min-width:0;flex:1;padding-top:2px}
.backup-hero-title{margin:0;font-size:17px;font-weight:750;letter-spacing:-.025em;color:var(--text-primary,#0f1419);line-height:1.25}
.backup-hero-desc{margin:4px 0 0;font-size:12.5px;line-height:1.5;color:var(--text-secondary,#536471)}
.backup-card{
  border:1px solid rgba(128,128,128,.1);border-radius:16px;
  background:rgba(255,255,255,.62);padding:16px;
  display:flex;flex-direction:column;gap:12px;
  box-shadow:0 1px 0 rgba(255,255,255,.5) inset;
}
.backup-card-flat{background:transparent;border:none;padding:0;box-shadow:none;gap:8px}
.backup-card-muted{
  background:rgba(128,128,128,.04);border-style:dashed;box-shadow:none;padding:12px 14px;
}
.backup-card-head{display:flex;align-items:flex-start;gap:10px}
.backup-card-icon{
  width:34px;height:34px;border-radius:10px;flex-shrink:0;
  display:flex;align-items:center;justify-content:center;
  background:rgba(128,128,128,.07);color:var(--text-secondary,#536471);
}
.backup-card-icon svg{width:16px;height:16px}
.backup-card-icon-export{background:rgba(var(--tapp-primary-rgb,99,102,241),.1);color:var(--tapp-primary,#6366f1)}
.backup-card-icon-import{background:rgba(14,165,233,.1);color:#0ea5e9}
.backup-card-icon-archive{background:rgba(245,158,11,.1);color:#f59e0b}
.backup-card-title{margin:0;font-size:14px;font-weight:700;color:var(--text-primary,#0f1419);letter-spacing:-.01em}
.backup-card-desc{margin:0;font-size:12.5px;line-height:1.55;color:var(--text-secondary,#536471)}
.backup-card-head .backup-card-desc{margin-top:3px}
.backup-actions{display:flex;flex-wrap:wrap;gap:8px}
.backup-btn{
  display:inline-flex;align-items:center;justify-content:center;gap:8px;
  min-height:38px;padding:0 14px;border-radius:11px;
  border:1px solid rgba(128,128,128,.12);background:rgba(128,128,128,.04);
  color:var(--text-primary,#0f1419);font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;
  transition:background .12s,border-color .12s,color .12s,transform .1s,filter .12s,box-shadow .12s;
}
.backup-btn svg{width:15px;height:15px;flex-shrink:0;opacity:.9}
.backup-btn:hover{
  background:rgba(var(--tapp-primary-rgb,99,102,241),.08);
  border-color:rgba(var(--tapp-primary-rgb,99,102,241),.24);
  color:var(--tapp-primary,#6366f1);
}
.backup-btn:active{transform:scale(.98)}
.backup-btn:focus-visible{outline:2px solid rgba(var(--tapp-primary-rgb,99,102,241),.45);outline-offset:1px}
.backup-btn-primary{
  background:var(--tapp-primary,#6366f1);border-color:transparent;color:#fff;
  box-shadow:0 6px 16px rgba(var(--tapp-primary-rgb,99,102,241),.22);
}
.backup-btn-primary:hover{
  filter:brightness(1.04);color:#fff;background:var(--tapp-primary,#6366f1);
  border-color:transparent;
}
.backup-btn-primary:disabled,.backup-btn:disabled{opacity:.55;cursor:not-allowed;transform:none;filter:none}
.backup-btn-sm{min-height:32px;padding:0 11px;font-size:12px;border-radius:9px}
.backup-btn-danger{color:var(--text-secondary,#888)}
.backup-btn-danger:hover{color:#ef4444;border-color:rgba(239,68,68,.22);background:rgba(239,68,68,.07)}
.backup-btn-ghost{
  background:transparent;border-color:transparent;color:var(--text-secondary,#536471);padding:0 8px;min-height:34px;
}
.backup-btn-ghost:hover{background:rgba(128,128,128,.08);color:var(--text-primary,#222);border-color:transparent}
.backup-check{
  display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;
  background:rgba(128,128,128,.04);border:1px solid rgba(128,128,128,.06);
  font-size:12.5px;color:var(--text-secondary,#536471);cursor:pointer;user-select:none;
  transition:background .12s,border-color .12s;
}
.backup-check:hover{background:rgba(128,128,128,.06)}
.backup-check input{
  width:16px;height:16px;margin:0;flex-shrink:0;accent-color:var(--tapp-primary,#6366f1);cursor:pointer;
}
.backup-status{
  min-height:0;font-size:12px;font-weight:600;line-height:1.4;
  color:var(--tapp-primary,#6366f1);padding:0;
}
.backup-status:not(:empty){
  min-height:18px;padding:8px 11px;border-radius:10px;
  background:rgba(var(--tapp-primary-rgb,99,102,241),.08);
}
.backup-status.backup-status-error{color:#ef4444;background:rgba(239,68,68,.08)}
.backup-status.backup-status-ok{color:#16a34a;background:rgba(22,163,74,.08)}
.backup-archive-list{display:flex;flex-direction:column;gap:8px}
.backup-archive-item{
  display:flex;align-items:center;gap:10px;padding:11px 12px;border-radius:13px;
  background:rgba(128,128,128,.035);border:1px solid rgba(128,128,128,.06);
  transition:background .12s,border-color .12s,transform .1s;
}
.backup-archive-link{
  width:100%;border:none;cursor:pointer;font-family:inherit;text-align:left;background:rgba(128,128,128,.035);
}
.backup-archive-link:hover{
  background:rgba(var(--tapp-primary-rgb,99,102,241),.07);
  border-color:rgba(var(--tapp-primary-rgb,99,102,241),.16);
}
.backup-archive-link:active{transform:scale(.99)}
.backup-archive-icon{
  width:36px;height:36px;border-radius:11px;flex-shrink:0;
  display:flex;align-items:center;justify-content:center;
  background:rgba(128,128,128,.07);color:var(--text-secondary,#64748b);
}
.backup-archive-icon svg{width:16px;height:16px}
.backup-archive-icon-dm{background:rgba(var(--tapp-primary-rgb,99,102,241),.1);color:var(--tapp-primary,#6366f1)}
.backup-archive-icon-room{background:rgba(16,185,129,.1);color:#10b981}
.backup-archive-icon-file{background:rgba(245,158,11,.1);color:#f59e0b}
.backup-archive-info{min-width:0;flex:1}
.backup-archive-name{font-size:13px;font-weight:700;color:var(--text-primary,#0f1419);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.backup-archive-meta{font-size:11.5px;color:var(--text-secondary,#8b98a5);margin-top:2px;line-height:1.35}
.backup-archive-actions{display:flex;align-items:center;gap:4px;flex-shrink:0}
.backup-chevron{color:var(--text-secondary,#99a1ad);display:flex;opacity:.75}
.backup-toolbar{
  display:flex;align-items:center;gap:8px;padding:2px 0 6px;position:sticky;top:0;z-index:2;
  background:linear-gradient(180deg,rgba(255,255,255,.92) 60%,rgba(255,255,255,0));
  backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);margin:0 -4px;padding-left:4px;padding-right:4px;
}
.backup-toolbar-title{
  font-size:14px;font-weight:700;color:var(--text-primary,#0f1419);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1;
}
.backup-browse-meta{
  font-size:11.5px;font-weight:600;color:var(--text-secondary,#8b98a5);
  padding:2px 4px 8px;
}
.backup-history-list{max-height:none;padding:0;gap:6px}
.backup-empty{
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;
  padding:28px 16px;text-align:center;color:var(--text-secondary,#8b98a5);font-size:12.5px;line-height:1.5;
}
.backup-empty .aro-empty-mark{width:44px;height:44px;border-radius:14px}
.dark .backup-page{color:rgba(255,255,255,.9)}
.dark .backup-hero-title,.dark .backup-card-title,.dark .backup-toolbar-title,.dark .backup-archive-name{color:rgba(255,255,255,.92)}
.dark .backup-hero-desc,.dark .backup-card-desc,.dark .backup-archive-meta,.dark .backup-browse-meta{color:rgba(255,255,255,.48)}
.dark .backup-card{background:rgba(255,255,255,.04);border-color:rgba(255,255,255,.08);box-shadow:none}
.dark .backup-card-muted{background:rgba(255,255,255,.03);border-color:rgba(255,255,255,.08)}
.dark .backup-btn{background:rgba(255,255,255,.04);border-color:rgba(255,255,255,.1);color:rgba(255,255,255,.88)}
.dark .backup-btn-primary{background:var(--tapp-primary,#6366f1);border-color:transparent;color:#fff}
.dark .backup-btn-ghost:hover{background:rgba(255,255,255,.08);color:rgba(255,255,255,.9)}
.dark .backup-check{background:rgba(255,255,255,.04);border-color:rgba(255,255,255,.06);color:rgba(255,255,255,.55)}
.dark .backup-archive-item,.dark .backup-archive-link{background:rgba(255,255,255,.035);border-color:rgba(255,255,255,.06)}
.dark .backup-archive-link:hover{background:rgba(var(--tapp-primary-rgb,99,102,241),.14)}
.dark .backup-toolbar{background:linear-gradient(180deg,rgba(10,10,10,.92) 55%,rgba(10,10,10,0))}
@media(max-width:768px){
  .backup-page{padding:12px 12px 32px;gap:12px}
  .backup-actions{flex-direction:column}
  .backup-actions .backup-btn{width:100%}
  .backup-archive-item{padding:10px}
  .backup-archive-actions{flex-direction:column;align-items:stretch}
}
@media(prefers-reduced-motion:reduce){
  .backup-page{animation:none!important}
}

.conv-list{flex:1;min-height:0;overflow-y:auto;padding:6px 8px;display:flex;flex-direction:column;gap:2px}
.chat-main{flex:1;min-width:0;display:flex;flex-direction:column;position:relative;overflow:hidden}
.member-panel{display:flex;flex-direction:column;width:220px;border-left:1px solid rgba(128,128,128,.08);flex-shrink:0;overflow:hidden;transition:width .2s}
.member-panel.member-collapsed{width:0;border-left:none;overflow:hidden}
.member-back-btn{display:none;background:none;border:none;font-size:16px;color:var(--text-primary,#1a1a1a);cursor:pointer;padding:2px 4px;margin-right:6px;border-radius:6px;flex-shrink:0}
.member-back-btn:hover{background:rgba(128,128,128,.08)}
.member-header{padding:12px 14px;border-bottom:1px solid rgba(128,128,128,.06);flex-shrink:0;display:flex;align-items:center;justify-content:space-between}
.member-title{margin:0;font-size:12px;font-weight:600;color:var(--text-secondary,#888);text-transform:uppercase;letter-spacing:.04em}
.member-list{flex:1;overflow-y:auto;padding:8px}
/* Invite popover */
.invite-wrap{position:relative}
/* Shared 36×36 toolbar icon-button token (hit target + chrome). Variants set color/bg. */
.aro-icon-btn,.member-toggle-btn,.manage-btn,.invite-toggle{
  width:36px;height:36px;min-width:36px;min-height:36px;padding:0;
  border-radius:8px;border:none;cursor:pointer;flex-shrink:0;line-height:1;
  display:flex;align-items:center;justify-content:center;
  transition:background .15s,color .15s;
}
.aro-icon-btn svg,.member-toggle-btn svg,.invite-toggle svg{width:18px;height:18px;flex-shrink:0}
.invite-toggle{background:none;color:var(--tapp-primary,#6366f1)}
.invite-toggle:hover{background:rgba(var(--tapp-primary-rgb,100,100,255),.1)}
.invite-popover{position:fixed;width:240px;background:var(--bg-primary,#fff);border:1px solid rgba(128,128,128,.1);border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.12);z-index:200;overflow:hidden}
.invite-popover.aro-menu-enter{animation:aroPopIn .14s var(--aro-ease) both}
.invite-popover.aro-leaving{animation:aroFadeOut .12s ease both;pointer-events:none}
.invite-pop-section{padding:8px}
.invite-pop-label{font-size:10px;font-weight:600;color:var(--text-secondary,#888);text-transform:uppercase;letter-spacing:.04em;padding:4px 6px 6px}
.invite-pop-list{max-height:180px;overflow-y:auto}
.invite-pop-empty{padding:12px 6px;text-align:center;font-size:11px;color:var(--text-secondary,#999)}
.invite-pop-contact{display:flex;align-items:center;gap:8px;width:100%;padding:6px 8px;border:none;background:none;border-radius:8px;cursor:pointer;transition:background .12s;text-align:left}
.invite-pop-contact:hover{background:rgba(var(--tapp-primary-rgb,100,100,255),.06)}
.invite-pop-contact-avatar{width:28px;height:28px;border-radius:50%;background:rgba(var(--tapp-primary-rgb,128,128,128),.1);color:var(--tapp-primary,#888);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;flex-shrink:0;overflow:hidden}
.invite-pop-contact-avatar img{width:100%;height:100%;object-fit:cover}
.invite-pop-contact-info{min-width:0;flex:1}
.invite-pop-contact-name{font-size:12px;font-weight:500;color:var(--text-primary,#1a1a1a);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.invite-pop-contact-url{font-size:10px;color:var(--text-secondary,#999);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.invite-pop-contact-added{font-size:10px;color:var(--tapp-primary,#6366f1);flex-shrink:0}
.invite-pop-divider{height:1px;background:rgba(128,128,128,.08);margin:0 8px}
.invite-pop-manual{display:flex;gap:6px;padding:0 2px}
.invite-pop-send{width:28px;height:28px;border:none;border-radius:8px;background:var(--tapp-primary,#6366f1);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:opacity .15s}
.invite-pop-send:hover{opacity:.85}
.invite-pop-send:disabled{opacity:.4;cursor:not-allowed}
.dark .invite-popover{background:var(--bg-primary,#1a1a1a);border-color:rgba(255,255,255,.08);box-shadow:0 8px 24px rgba(0,0,0,.35)}
.dark .invite-pop-contact-name{color:rgba(255,255,255,.9)}
.invite-bar{display:flex;gap:6px;padding:8px 10px;border-bottom:1px solid rgba(128,128,128,.06);flex-shrink:0}
.invite-input{flex:1;padding:5px 8px;border:1px solid rgba(128,128,128,.15);border-radius:6px;background:rgba(128,128,128,.04);color:var(--text-primary,#fff);font-size:12px;outline:none}
.invite-input:focus{border-color:rgba(var(--tapp-primary-rgb,100,100,255),.5)}
.invite-btn{padding:5px 10px;border:none;border-radius:6px;background:var(--tapp-primary,#6366f1);color:#fff;font-size:12px;cursor:pointer;white-space:nowrap}
.invite-btn:hover{opacity:.85}
.invite-btn:disabled{opacity:.5;cursor:not-allowed}

/* ===== Conversation Items ===== */
.conv-item{position:relative;display:flex;align-items:center;gap:10px;width:100%;min-height:56px;padding:10px 12px 10px 14px;border:none;border-radius:12px;background:transparent;cursor:pointer;text-align:left;transition:background .12s;overflow:hidden}
.conv-item:hover{background:rgba(128,128,128,.06)}
.conv-item:focus-visible{outline:2px solid rgba(var(--tapp-primary-rgb,99,102,241),.45);outline-offset:1px}
.conv-active{background:rgba(var(--tapp-primary-rgb,99,102,241),.1)!important}
.conv-active:hover{background:rgba(var(--tapp-primary-rgb,99,102,241),.14)!important}
.conv-accent{position:absolute;left:4px;top:14px;bottom:14px;width:3px;border-radius:2px;background:transparent}
.conv-active .conv-accent{background:var(--tapp-primary,#6366f1)}
.conv-unread:not(.conv-active) .conv-accent{background:var(--tapp-primary,#6366f1);opacity:.55}
.conv-avatar{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:600;flex-shrink:0;overflow:hidden}
.conv-avatar img{width:100%;height:100%;object-fit:cover}
.avatar-channel{background:rgba(var(--tapp-primary-rgb,99,102,241),.12);color:var(--tapp-primary,#6366f1)}
.avatar-room{background:rgba(var(--tapp-primary-rgb,99,102,241),.12);color:var(--tapp-primary,#6366f1)}
.conv-info{min-width:0;flex:1;display:flex;flex-direction:column;gap:2px}
.conv-top{display:flex;align-items:baseline;gap:8px;min-width:0}
.conv-name{flex:1;min-width:0;font-size:13px;font-weight:600;color:var(--text-primary,#1a1a1a);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.conv-unread .conv-name{font-weight:700}
.conv-time{flex-shrink:0;font-size:11px;font-weight:400;color:var(--text-secondary,#999);white-space:nowrap}
.conv-unread .conv-time{color:var(--tapp-primary,#6366f1);font-weight:500}
.conv-bottom{display:flex;align-items:center;gap:6px;min-width:0}
.conv-preview{flex:1;min-width:0;font-size:12px;line-height:1.35;color:var(--text-secondary,#888);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.conv-unread .conv-preview{color:var(--text-primary,#444);font-weight:500}
.conv-badge{min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--tapp-primary,#6366f1);color:#fff;font-size:10px;font-weight:600;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.conv-closed{font-size:10px;color:var(--text-secondary,#999);background:rgba(128,128,128,.08);padding:2px 6px;border-radius:6px;flex-shrink:0}
.conv-pending{font-size:10px;color:#f59e0b;background:rgba(245,158,11,.1);padding:2px 6px;border-radius:6px;flex-shrink:0}
.conv-empty{padding:40px 16px;text-align:center;font-size:13px;line-height:1.55;color:var(--text-secondary,#999)}
.conv-empty-fill{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:0 16px}
.dark .conv-item:hover{background:rgba(255,255,255,.05)}
.dark .conv-active{background:rgba(var(--tapp-primary-rgb,99,102,241),.16)!important}
.dark .conv-active:hover{background:rgba(var(--tapp-primary-rgb,99,102,241),.2)!important}
.dark .conv-name{color:rgba(255,255,255,.92)}
.dark .conv-preview{color:rgba(255,255,255,.5)}
.dark .conv-unread .conv-preview{color:rgba(255,255,255,.78)}

/* ===== Empty State ===== */
.empty-state{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:32px 20px;color:var(--text-secondary,#999)}
.empty-icon{width:48px;height:48px;border-radius:14px;background:rgba(var(--tapp-primary-rgb,128,128,128),.06);display:flex;align-items:center;justify-content:center;font-size:0;margin-bottom:6px;color:var(--text-secondary,#999)}
.empty-icon svg{width:22px;height:22px;stroke-width:1.8}
.empty-text{margin:0;font-size:13px;line-height:1.5;font-weight:400;color:var(--text-secondary,#999);text-align:center;max-width:260px}

/* ===== Chat Container ===== */
.chat-container{flex:1;min-height:0;display:flex;flex-direction:column;position:relative}
.chat-header{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid rgba(128,128,128,.06);flex-shrink:0;min-height:56px;background:rgba(255,255,255,.4)}
.dark .chat-header{background:rgba(10,10,10,.35)}
.back-btn{display:none;background:none;border:none;font-size:18px;padding:6px 10px;border-radius:8px;cursor:pointer;color:var(--text-secondary,#888);line-height:1}
.back-btn:hover{background:rgba(128,128,128,.08)}
.chat-hdr-avatar{width:36px;height:36px;border-radius:50%;overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;background:rgba(var(--tapp-primary-rgb,128,128,128),.1);color:var(--tapp-primary,#6366f1)}
.chat-hdr-avatar img{width:100%;height:100%;object-fit:cover}
.chat-header-info{min-width:0;flex:1}
.chat-name{font-size:15px;font-weight:700;color:var(--text-primary,#1a1a1a);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;letter-spacing:-.01em}
.chat-meta{display:flex;gap:6px;align-items:center;margin-top:3px;flex-wrap:wrap}
.meta-badge{font-size:10px;padding:2px 8px;border-radius:999px;background:rgba(var(--tapp-primary-rgb,128,128,128),.08);color:var(--tapp-primary,#6366f1);font-weight:600}
.badge-channel{}
.badge-room{}
.badge-role{}
.badge-closed{background:rgba(128,128,128,.08);color:var(--text-secondary,#999)}
.badge-pending{background:rgba(245,158,11,.1);color:#f59e0b}
.chat-actions{display:flex;gap:6px;flex-shrink:0;align-items:center}
/* Muted header chrome — same family as .aro-icon-btn (size from shared rule above) */
.member-toggle-btn,.manage-btn{background:rgba(128,128,128,.06);color:var(--text-secondary,#999);font-size:16px}
.member-toggle-btn:hover,.manage-btn:hover{background:rgba(128,128,128,.12)}
.action-btn{font-size:11px;padding:4px 10px;border-radius:10px;border:none;cursor:pointer;transition:background .15s}
.action-accept{color:#fff;background:#22c55e}
.action-accept:hover{background:#16a34a}
.action-reject{color:#fff;background:#ef4444;margin-left:6px}
.action-reject:hover{background:#dc2626}
.member-pending{opacity:.72}
.member-pending .member-role{color:#d97706}
.manage-wrap{position:relative}
.manage-dropdown{display:none;position:absolute;right:0;top:calc(100% + 4px);min-width:120px;background:var(--bg-primary,#fff);border:1px solid rgba(128,128,128,.1);border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.1);z-index:50;padding:4px;overflow:hidden}
.manage-dropdown.open{display:block}
.manage-item{display:flex;align-items:center;gap:8px;width:100%;padding:7px 10px;border:none;background:none;border-radius:7px;font-size:12px;color:var(--text-primary,#333);cursor:pointer;transition:background .12s;text-align:left}
.manage-item:hover{background:rgba(128,128,128,.08)}
.manage-item-danger{color:#ef4444}
.manage-item-danger:hover{background:rgba(239,68,68,.06)}
.dark .manage-dropdown{background:var(--bg-primary,#1a1a1a);border-color:rgba(255,255,255,.08);box-shadow:0 4px 16px rgba(0,0,0,.3)}

/* ===== Pinned Bar ===== */
.pinned-bar{display:flex;align-items:center;gap:8px;padding:6px 14px;background:rgba(var(--tapp-primary-rgb,99,102,241),.06);border-bottom:1px solid rgba(var(--tapp-primary-rgb,99,102,241),.1);cursor:pointer;flex-shrink:0;min-height:0;overflow:hidden;transition:background .15s}
.pinned-bar:hover{background:rgba(var(--tapp-primary-rgb,99,102,241),.1)}
.pinned-bar-icon{width:14px;height:14px;flex-shrink:0;color:var(--tapp-primary,#6366f1);display:flex;align-items:center;justify-content:center}
.pinned-bar-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.pinned-bar-label{font-size:10px;font-weight:600;color:var(--tapp-primary,#6366f1);text-transform:uppercase;letter-spacing:.3px}
.pinned-bar-text{font-size:12px;color:var(--text-primary,#333);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pinned-bar-close{width:20px;height:20px;border:none;background:none;color:var(--text-secondary,#999);cursor:pointer;display:flex;align-items:center;justify-content:center;border-radius:4px;flex-shrink:0;font-size:14px;line-height:1}
.pinned-bar-close:hover{background:rgba(128,128,128,.1)}

/* ===== Messages ===== */
.messages-area{flex:1;overflow-y:auto;padding:14px 14px 76px;display:flex;flex-direction:column;gap:6px}
.messages-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;color:var(--text-secondary,#999);padding:24px 16px;text-align:center}
.messages-empty p{margin:0;font-size:13px;line-height:1.5;max-width:240px}
.messages-empty-icon{width:44px;height:44px;border-radius:13px;background:rgba(var(--tapp-primary-rgb,128,128,128),.06);display:flex;align-items:center;justify-content:center;font-size:0;margin-bottom:4px}
.messages-empty-icon svg{width:21px;height:21px;stroke-width:1.8}
.messages-retry-btn{margin-top:8px;min-height:36px;padding:8px 16px;border:none;border-radius:10px;background:var(--tapp-primary,#6366f1);color:#fff;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit}
.messages-retry-btn:hover{filter:brightness(1.05)}
.messages-retry-btn:active{transform:scale(.97)}
.msg-day-sep{display:flex;align-items:center;justify-content:center;gap:10px;margin:12px 0 6px;user-select:none}
.msg-day-sep::before,.msg-day-sep::after{content:'';flex:1;height:1px;background:rgba(128,128,128,.12);max-width:72px}
.msg-day-label{font-size:11px;font-weight:500;color:var(--text-secondary,#888);padding:0 2px;letter-spacing:.01em}
.msg-row{display:flex;gap:8px;align-items:flex-end;position:relative}
.msg-row.msg-compact{margin-top:-2px}
.msg-local{justify-content:flex-end;padding-left:40px}
.msg-remote{justify-content:flex-start;padding-right:40px}
.msg-avatar{width:28px;height:28px;border-radius:50%;overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;background:rgba(var(--tapp-primary-rgb,128,128,128),.12);color:var(--tapp-primary,#888);margin-bottom:2px}
.msg-avatar img{width:100%;height:100%;object-fit:cover}
.msg-avatar-spacer{width:28px;flex-shrink:0}
.msg-bubble{position:relative;max-width:72%;padding:8px 12px;border-radius:16px;font-size:13px;line-height:1.5}
.bubble-local{background:var(--tapp-primary,#6366f1);color:#fff;border-bottom-right-radius:6px}
.bubble-remote{background:rgba(128,128,128,.08);color:var(--text-primary,#1a1a1a);border-bottom-left-radius:6px}
.msg-more-btn{position:absolute;top:2px;right:2px;width:32px;height:32px;min-width:32px;min-height:32px;border:none;border-radius:8px;background:transparent;color:inherit;opacity:0;pointer-events:none;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:opacity .12s,background .12s;z-index:2}
.msg-row:hover .msg-more-btn,.msg-more-btn:focus-visible{opacity:.7;pointer-events:auto}
.msg-more-btn:hover,.msg-more-btn:focus-visible{opacity:1;background:rgba(0,0,0,.08)}
.bubble-local .msg-more-btn:hover,.bubble-local .msg-more-btn:focus-visible{background:rgba(255,255,255,.18)}
@media (hover:none),(pointer:coarse){
  .msg-more-btn{opacity:.55;pointer-events:auto}
}
.msg-sender{font-size:11px;font-weight:600;color:var(--tapp-primary,#6366f1);margin-bottom:2px;padding-right:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.msg-text{white-space:pre-wrap;overflow-wrap:break-word}
.msg-footer{display:flex;align-items:center;gap:4px;margin-top:3px}
.msg-local .msg-footer{justify-content:flex-end}
.msg-remote .msg-footer{justify-content:flex-start}
.msg-pin{font-size:10px;display:inline-flex;align-items:center}
.msg-time{font-size:10px;opacity:.5;cursor:default}
.msg-compact .msg-footer{margin-top:2px}
.dark .msg-day-sep::before,.dark .msg-day-sep::after{background:rgba(255,255,255,.1)}
.dark .msg-day-label{color:rgba(255,255,255,.55)}
.dark .bubble-remote{background:rgba(255,255,255,.08)}
.dark .msg-more-btn:hover,.dark .msg-more-btn:focus-visible{background:rgba(255,255,255,.1)}

/* ===== Input ===== */
.input-float-wrap{position:absolute;bottom:0;left:0;right:0;z-index:20;padding:8px 12px;padding-bottom:calc(8px + env(safe-area-inset-bottom,0px));background:linear-gradient(to top,var(--bg-primary,#fff) 70%,transparent);pointer-events:none}
.input-float-wrap>*{pointer-events:auto}
.input-bar{display:flex;align-items:flex-end;gap:8px;padding:8px 10px;background:var(--bg-primary,#fff);border:1px solid rgba(128,128,128,.12);border-radius:18px;box-shadow:0 2px 12px rgba(0,0,0,.06)}
.attach-btn{width:36px;height:36px;border-radius:50%;border:none;background:transparent;color:var(--text-secondary,#999);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:background .15s,color .15s;margin-bottom:1px}
.attach-btn:hover{background:rgba(128,128,128,.08);color:var(--text-primary,#555)}
.attach-btn.attach-btn-active{background:rgba(var(--tapp-primary-rgb,100,100,255),.1);color:var(--tapp-primary,#6366f1);transform:rotate(45deg)}
.msg-input{flex:1;min-height:22px;max-height:120px;padding:7px 0;border:none;background:transparent;color:var(--text-primary,#1a1a1a);font-size:14px;line-height:1.45;outline:none;resize:none;overflow-y:auto;font-family:inherit}
.msg-input::placeholder{color:var(--text-secondary,#bbb)}
.send-btn{width:36px;height:36px;border-radius:50%;border:none;background:transparent;color:var(--text-secondary,#aaa);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:background .15s,color .15s,opacity .15s;margin-bottom:1px}
.send-btn:hover:not(:disabled){color:var(--tapp-primary,#6366f1);background:rgba(var(--tapp-primary-rgb,100,100,255),.1)}
.send-btn:disabled{opacity:.4;cursor:not-allowed}
.send-btn.send-ready{background:var(--tapp-primary,#6366f1);color:#fff}
.send-btn.send-ready:hover:not(:disabled){background:var(--tapp-primary,#6366f1);color:#fff;filter:brightness(1.05)}
.send-btn.send-ready:active:not(:disabled){transform:scale(.96)}
.dark .attach-btn:hover{background:rgba(255,255,255,.08);color:rgba(255,255,255,.85)}
.dark .send-btn.send-ready{background:var(--tapp-primary,#6366f1);color:#fff}
.dark .input-float-wrap{background:linear-gradient(to top,var(--bg-primary,#1a1a1a) 70%,transparent)}
.dark .input-bar{background:var(--bg-primary,#1a1a1a);border-color:rgba(255,255,255,.1);box-shadow:0 2px 12px rgba(0,0,0,.2)}

/* ===== Attachment Menu ===== */
.attach-menu{position:absolute;bottom:calc(100% + 6px);left:0;background:var(--bg-primary,#fff);border:1px solid rgba(128,128,128,.1);border-radius:14px;box-shadow:0 6px 20px rgba(0,0,0,.1);z-index:60;padding:6px;display:grid;grid-template-columns:repeat(3,1fr);gap:2px;min-width:228px}
.attach-menu.aro-menu-enter{animation:aroPopIn .16s var(--aro-ease) both}
.attach-menu.aro-leaving{animation:aroFadeOut .12s ease both;pointer-events:none}
.attach-menu-item{display:flex;flex-direction:column;align-items:center;gap:5px;min-height:64px;padding:10px 6px;border:none;background:none;border-radius:10px;cursor:pointer;transition:background .12s;color:var(--text-primary,#1a1a1a);font-size:10px;font-weight:500;white-space:nowrap}
.attach-menu-item:hover{background:rgba(128,128,128,.06)}
.attach-menu-icon{width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px}
.attach-icon-image{background:rgba(59,130,246,.1);color:#3b82f6}
.attach-icon-file{background:rgba(245,158,11,.1);color:#f59e0b}
.attach-icon-tapp{background:rgba(var(--tapp-primary-rgb,100,100,255),.1);color:var(--tapp-primary,#6366f1)}
.attach-icon-brew{background:rgba(34,197,94,.1);color:#22c55e}
.attach-icon-library{background:rgba(168,85,247,.1);color:#a855f7}
.attach-icon-report{background:rgba(239,68,68,.1);color:#ef4444}
.dark .attach-menu{background:var(--bg-primary,#1a1a1a);border-color:rgba(255,255,255,.08);box-shadow:0 6px 20px rgba(0,0,0,.35)}
.dark .attach-menu-item{color:rgba(255,255,255,.9)}

/* ===== Attachment Preview ===== */
.attach-preview{padding:8px 10px;display:flex;align-items:center;gap:10px;background:var(--bg-primary,#fff);border:1px solid rgba(128,128,128,.1);border-bottom:none;border-radius:14px 14px 0 0;margin-bottom:-1px}
.attach-preview-thumb{width:48px;height:48px;border-radius:8px;overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:rgba(128,128,128,.06)}
.attach-preview-thumb img{width:100%;height:100%;object-fit:cover}
.attach-preview-icon{width:48px;height:48px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0}
.attach-preview-info{flex:1;min-width:0}
.attach-preview-name{font-size:12px;font-weight:500;color:var(--text-primary,#1a1a1a);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.attach-preview-meta{font-size:10px;color:var(--text-secondary,#999);margin-top:2px}
.attach-preview-remove{width:36px;height:36px;min-width:36px;min-height:36px;border-radius:50%;border:none;background:rgba(128,128,128,.08);color:var(--text-secondary,#999);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:background .12s;font-size:16px;line-height:1}
.attach-preview-remove:hover{background:rgba(239,68,68,.1);color:#ef4444}
.composer-locked .input-bar{opacity:.72;background:rgba(128,128,128,.04)}
.composer-locked .attach-btn,.composer-locked .send-btn{pointer-events:none}
.composer-locked .msg-input{cursor:not-allowed}
.composer-locked .quote-preview,.composer-locked .attach-preview{display:none !important}
.dark .composer-locked .input-bar{background:rgba(255,255,255,.03)}

/* ===================================================================
   Bottom sheets — content picker (add) + share detail (open)
   -------------------------------------------------------------------
   One chrome for both: the detail overlay reuses .picker-sheet. Surface
   tokens mirror the message-card system so a sheet reads as the same
   material as the card that opened it, and --acc carries the platform
   brand color through header, tabs, selection and primary action.
   =================================================================== */
.picker-overlay{
  --acc:var(--tapp-primary-rgb,99,102,241);
  --sheet-bg:#fff;
  --sheet-hair:rgba(15,23,42,.09);
  --sheet-chip:rgba(15,23,42,.05);
  --sheet-chip-hover:rgba(15,23,42,.08);
  --sheet-ink:var(--text-primary,#0f172a);
  --sheet-ink-dim:rgba(15,23,42,.55);
  position:fixed;inset:0;z-index:200;display:flex;align-items:center;justify-content:center;
  padding:24px 20px calc(24px + env(safe-area-inset-bottom,0px));
  padding-top:calc(24px + env(safe-area-inset-top,0px));
  background:rgba(9,9,14,.5);
  backdrop-filter:blur(10px) saturate(1.05);-webkit-backdrop-filter:blur(10px) saturate(1.05);
  animation:pickerFadeIn .2s ease;
}
.dark .picker-overlay{
  --sheet-bg:#15151a;
  --sheet-hair:rgba(255,255,255,.09);
  --sheet-chip:rgba(255,255,255,.06);
  --sheet-chip-hover:rgba(255,255,255,.1);
  --sheet-ink:rgba(255,255,255,.94);
  --sheet-ink-dim:rgba(255,255,255,.55);
  background:rgba(0,0,0,.6);
}
.picker-overlay[data-mark="brand"]{--acc:var(--acc-l,var(--tapp-primary-rgb,99,102,241))}
.dark .picker-overlay[data-mark="brand"]{--acc:var(--acc-d,var(--acc-l,var(--tapp-primary-rgb,99,102,241)))}
@keyframes pickerFadeIn{from{opacity:0}to{opacity:1}}
@keyframes pickerPopIn{from{opacity:0;transform:scale(.94) translateY(8px)}to{opacity:1;transform:scale(1) translateY(0)}}
@keyframes pickerPopOut{from{opacity:1;transform:scale(1)}to{opacity:0;transform:scale(.96)}}
.picker-sheet{
  position:relative;width:100%;max-width:520px;max-height:100%;
  background:var(--sheet-bg);color:var(--sheet-ink);
  border-radius:24px;display:flex;flex-direction:column;overflow:hidden;
  box-shadow:0 24px 60px -20px rgba(0,0,0,.45),0 4px 14px -6px rgba(0,0,0,.2);
  animation:pickerPopIn .24s cubic-bezier(.2,.8,.2,1);
}
/* Inset ring reads as an edge on every side now that the dialog floats free */
.picker-sheet::before{content:'';position:absolute;inset:0;border-radius:inherit;box-shadow:inset 0 0 0 1px rgba(255,255,255,.5);pointer-events:none;z-index:3}
.dark .picker-sheet::before{box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)}

.picker-header{display:flex;align-items:center;gap:12px;padding:18px 18px 12px;flex-shrink:0}
.picker-header-icon{
  width:44px;height:44px;flex-shrink:0;border-radius:14px;overflow:hidden;
  display:flex;align-items:center;justify-content:center;font-size:20px;
  color:rgb(var(--acc));
  background:linear-gradient(150deg,rgba(var(--acc),.24),rgba(var(--acc),.09));
  box-shadow:inset 0 0 0 1px rgba(var(--acc),.2);
}
.picker-header-icon svg{width:22px;height:22px}
.picker-header-icon img{width:100%;height:100%;object-fit:cover}
.picker-header-icon[data-mark="img"]{color:var(--sheet-ink);background:var(--sheet-chip);box-shadow:inset 0 0 0 1px var(--sheet-hair)}
.picker-header-icon[data-mark="img"] img{width:24px;height:24px;object-fit:contain;border-radius:6px}
.picker-header-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.picker-header-title{font-size:16.5px;font-weight:680;letter-spacing:-.01em;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.picker-header-sub{font-size:12px;color:var(--sheet-ink-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.picker-header-sub:empty{display:none}
.picker-close-btn{
  width:34px;height:34px;flex-shrink:0;border-radius:50%;border:none;
  background:var(--sheet-chip);color:var(--sheet-ink-dim);
  cursor:pointer;display:flex;align-items:center;justify-content:center;
  font-size:19px;line-height:1;font-family:inherit;transition:background .15s,color .15s,transform .12s;
}
.picker-close-btn:hover{background:var(--sheet-chip-hover);color:var(--sheet-ink)}
.picker-close-btn:active{transform:scale(.93)}
.picker-close-btn:focus-visible{outline:2px solid rgba(var(--acc),.55);outline-offset:2px}

.picker-search{padding:2px 18px 10px;flex-shrink:0}
.picker-search input{
  width:100%;padding:10px 14px;border:1px solid transparent;border-radius:13px;
  background:var(--sheet-chip);font-size:13.5px;color:var(--sheet-ink);
  outline:none;box-sizing:border-box;font-family:inherit;transition:background .15s,border-color .15s,box-shadow .15s;
}
.picker-search input::placeholder{color:var(--sheet-ink-dim)}
.picker-search input:focus{background:transparent;border-color:rgba(var(--acc),.45);box-shadow:0 0 0 3px rgba(var(--acc),.12)}

.picker-tabs{display:flex;gap:6px;padding:0 18px 10px;flex-shrink:0;overflow-x:auto;scrollbar-width:none}
.picker-tabs::-webkit-scrollbar{display:none}
.picker-tab{
  padding:6px 13px;border:none;border-radius:10px;background:var(--sheet-chip);
  color:var(--sheet-ink-dim);font-size:12.5px;font-weight:600;cursor:pointer;
  transition:background .15s,color .15s;white-space:nowrap;font-family:inherit;
}
.picker-tab:hover{background:var(--sheet-chip-hover)}
.picker-tab.active{background:rgba(var(--acc),.14);color:rgb(var(--acc))}
.picker-tab:focus-visible{outline:2px solid rgba(var(--acc),.55);outline-offset:2px}

.picker-body{flex:1;overflow-y:auto;overscroll-behavior:contain;padding:2px 10px 10px}
.picker-loading,.picker-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:44px 16px;color:var(--sheet-ink-dim);font-size:13px;gap:12px;text-align:center}
.picker-loading-spinner{width:26px;height:26px;border:2.5px solid var(--sheet-chip);border-top-color:rgb(var(--acc));border-radius:50%;animation:pickerSpin .7s linear infinite}
@keyframes pickerSpin{to{transform:rotate(360deg)}}

.picker-item{
  display:flex;align-items:center;gap:12px;padding:10px 10px;margin-bottom:2px;
  border-radius:14px;cursor:pointer;border:1px solid transparent;background:none;
  width:100%;text-align:left;color:var(--sheet-ink);font-family:inherit;
  transition:background .14s,border-color .14s;
}
.picker-item:hover{background:var(--sheet-chip)}
.picker-item:focus-visible{outline:2px solid rgba(var(--acc),.5);outline-offset:-2px}
.picker-item.selected{background:rgba(var(--acc),.09);border-color:rgba(var(--acc),.28)}
.picker-item-icon{
  width:40px;height:40px;flex-shrink:0;border-radius:12px;overflow:hidden;
  display:flex;align-items:center;justify-content:center;font-size:18px;
  color:rgb(var(--acc));background:linear-gradient(150deg,rgba(var(--acc),.2),rgba(var(--acc),.08));
  box-shadow:inset 0 0 0 1px rgba(var(--acc),.16);
}
.picker-item-icon svg{width:20px;height:20px}
.picker-item-icon img{width:100%;height:100%;object-fit:cover}
/* A row carrying a real brand mark uses that brand's color, not the sheet's */
.picker-item-icon[data-mark="brand"]{--acc:var(--acc-l,var(--tapp-primary-rgb,99,102,241))}
.dark .picker-item-icon[data-mark="brand"]{--acc:var(--acc-d,var(--acc-l,var(--tapp-primary-rgb,99,102,241)))}
.picker-item-icon[data-mark="img"]{color:var(--sheet-ink);background:var(--sheet-chip);box-shadow:inset 0 0 0 1px var(--sheet-hair)}
.picker-item-icon[data-mark="img"] img{width:22px;height:22px;object-fit:contain;border-radius:5px}
.picker-item-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.picker-item-name{font-size:13.5px;font-weight:600;letter-spacing:-.005em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.picker-item-meta{font-size:11.5px;color:var(--sheet-ink-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.4}
.picker-item-check{
  width:22px;height:22px;flex-shrink:0;border-radius:50%;
  border:1.5px solid var(--sheet-hair);display:flex;align-items:center;justify-content:center;
  font-size:12px;color:transparent;transition:border-color .14s,background .14s,color .14s,transform .14s;
}
.picker-item.selected .picker-item-check{border-color:rgb(var(--acc));background:rgb(var(--acc));color:#fff;transform:scale(1.06)}

.picker-form{padding:4px 18px 12px;display:flex;flex-direction:column;gap:12px}
.picker-form label{font-size:12px;font-weight:600;color:var(--sheet-ink-dim);display:flex;flex-direction:column;gap:6px}
.picker-form input,.picker-form textarea{
  width:100%;padding:10px 14px;border:1px solid transparent;border-radius:13px;
  background:var(--sheet-chip);font-size:13.5px;color:var(--sheet-ink);
  outline:none;font-family:inherit;box-sizing:border-box;transition:background .15s,border-color .15s,box-shadow .15s;
}
.picker-form input:focus,.picker-form textarea:focus{background:transparent;border-color:rgba(var(--acc),.45);box-shadow:0 0 0 3px rgba(var(--acc),.12)}
.picker-form textarea{min-height:72px;resize:vertical;line-height:1.55}

.picker-footer{display:flex;gap:10px;padding:12px 18px 16px;flex-shrink:0;border-top:1px solid var(--sheet-hair);background:var(--sheet-bg)}
.picker-footer-btn{flex:1;min-height:42px;padding:0 16px;border:none;border-radius:14px;font-size:14px;font-weight:650;cursor:pointer;font-family:inherit;transition:background .15s,filter .15s,transform .12s,opacity .15s}
.picker-footer-btn:active{transform:scale(.985)}
.picker-footer-btn:focus-visible{outline:2px solid rgba(var(--acc),.55);outline-offset:2px}
.picker-btn-cancel{background:var(--sheet-chip);color:var(--sheet-ink-dim)}
.picker-btn-cancel:hover{background:var(--sheet-chip-hover);color:var(--sheet-ink)}
.picker-btn-confirm{background:linear-gradient(160deg,rgb(var(--acc)),rgba(var(--acc),.84));color:#fff;box-shadow:0 2px 8px -3px rgba(var(--acc),.5)}
.picker-btn-confirm:hover:not(:disabled){filter:brightness(1.06)}
.picker-btn-confirm:disabled{opacity:.35;cursor:not-allowed;filter:none;box-shadow:none}

/* ----- Detail sheet body ----- */
.sheet-pad{padding:4px 18px 22px;display:flex;flex-direction:column;gap:16px}
.sheet-cover{width:100%;max-height:210px;object-fit:cover;border-radius:16px;display:block;background:var(--sheet-chip);box-shadow:inset 0 0 0 1px var(--sheet-hair)}
.sheet-meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:12px;color:var(--sheet-ink-dim)}
.sheet-meta-chip{padding:3px 9px;border-radius:8px;background:var(--sheet-chip);font-weight:600;font-variant-numeric:tabular-nums}
.sheet-desc{font-size:13.5px;line-height:1.65;color:var(--sheet-ink-dim);overflow-wrap:anywhere;white-space:pre-wrap}
.sheet-panel{display:flex;flex-direction:column;gap:10px;padding:14px;border-radius:16px;background:var(--sheet-chip);border:1px solid var(--sheet-hair)}
.sheet-row{display:flex;align-items:baseline;justify-content:space-between;gap:12px;font-size:12.5px}
.sheet-row dt{color:var(--sheet-ink-dim);font-weight:600;flex-shrink:0}
.sheet-row dd{margin:0;text-align:right;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.sheet-status{display:inline-flex;align-items:center;gap:7px;font-size:13px;font-weight:650}
.sheet-status-dot{width:8px;height:8px;border-radius:50%;background:currentColor;flex-shrink:0;box-shadow:0 0 0 3px color-mix(in srgb,currentColor 18%,transparent)}
.sheet-status-ok{color:#16a34a}.dark .sheet-status-ok{color:#4ade80}
.sheet-status-warn{color:#d97706}.dark .sheet-status-warn{color:#fbbf24}
.sheet-status-off{color:var(--sheet-ink-dim)}
.sheet-section{display:flex;flex-direction:column;gap:7px}
.sheet-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--sheet-ink-dim)}
.sheet-text{font-size:13.5px;line-height:1.65;overflow-wrap:anywhere}
.sheet-text ul{margin:0;padding-left:18px}
.sheet-text li{margin:5px 0}
/* The dialog body owns scrolling; a nested scroller here just traps the wheel. */
.sheet-scroll{min-width:0}
.sheet-btn{width:100%;min-height:46px;border:none;border-radius:14px;font-size:14.5px;font-weight:650;cursor:pointer;font-family:inherit;color:#fff;background:linear-gradient(160deg,rgb(var(--acc)),rgba(var(--acc),.84));box-shadow:0 2px 8px -3px rgba(var(--acc),.5);transition:filter .15s,transform .12s,opacity .15s}
.sheet-btn:hover:not(:disabled){filter:brightness(1.06)}
.sheet-btn:active:not(:disabled){transform:scale(.99)}
.sheet-btn:disabled{opacity:.6;cursor:default}
.sheet-btn:focus-visible{outline:2px solid rgba(var(--acc),.55);outline-offset:2px}
.sheet-btn-warn{background:linear-gradient(160deg,#f59e0b,#d97706);box-shadow:0 2px 8px -3px rgba(245,158,11,.5)}
.sheet-btn-ok{background:linear-gradient(160deg,#22c55e,#16a34a);box-shadow:none}
.sheet-btn-err{background:linear-gradient(160deg,#ef4444,#dc2626);box-shadow:none}
.sheet-btn.is-busy{opacity:.7;cursor:progress}
.sheet-link{display:inline-flex;align-items:center;gap:5px;font-size:13px;font-weight:600;color:rgb(var(--acc));text-decoration:none;align-self:flex-start;padding:7px 12px;border-radius:11px;background:rgba(var(--acc),.1);transition:background .15s}
.sheet-link:hover{background:rgba(var(--acc),.18)}
.sheet-note{font-size:11.5px;line-height:1.5;color:var(--sheet-ink-dim)}
.sheet-note-warn{color:#d97706}.dark .sheet-note-warn{color:#fbbf24}
.sheet-error{font-size:12.5px;line-height:1.5;color:#dc2626;overflow-wrap:anywhere}
.dark .sheet-error{color:#f87171}
.sheet-hint{text-align:center;font-size:12.5px;color:var(--sheet-ink-dim);padding:2px 0}

@media(max-width:600px){
  .picker-overlay{padding:16px 12px calc(16px + env(safe-area-inset-bottom,0px))}
  .picker-sheet{max-width:none;border-radius:20px}
  .picker-header{padding:16px 14px 10px}
  .picker-search,.picker-tabs{padding-left:16px;padding-right:16px}
  .sheet-pad{padding-left:16px;padding-right:16px}
  .picker-footer{padding:12px 16px 16px}
}

/* ===== Rich Message Bubbles ===== */

/* -- Message Context Menu -- */
.msg-ctx-menu{position:fixed;z-index:200;min-width:140px;background:var(--bg-primary,#fff);border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.18);padding:4px;animation:ctxFadeIn .12s ease}
@keyframes ctxFadeIn{from{opacity:0;transform:scale(.95)}to{opacity:1;transform:scale(1)}}
.msg-ctx-item{display:flex;align-items:center;gap:8px;width:100%;padding:9px 12px;border:none;background:none;border-radius:8px;font-size:13px;font-weight:500;color:var(--text-primary,#1a1a1a);cursor:pointer;transition:background .12s;font-family:inherit}
.msg-ctx-item:hover{background:rgba(128,128,128,.08)}
.msg-ctx-item:active{background:rgba(128,128,128,.14)}
.msg-ctx-item svg{flex-shrink:0;opacity:.6}
.dark .msg-ctx-menu{background:var(--bg-primary,#1a1a1a);box-shadow:0 8px 32px rgba(0,0,0,.4)}
.dark .msg-ctx-item{color:rgba(255,255,255,.9)}

/* -- Quote Block inside message bubble -- */
.msg-quote-block{
  display:flex;gap:0;margin-bottom:6px;border-radius:8px;overflow:hidden;
  background:rgba(128,128,128,.08);padding:6px 8px;width:100%;max-width:100%;
  border:none;text-align:left;font:inherit;color:inherit;cursor:pointer;
  transition:background .12s ease,transform .1s ease;
  -webkit-tap-highlight-color:transparent;
}
.msg-quote-block:hover{background:rgba(128,128,128,.12)}
.msg-quote-block:active{transform:scale(.99)}
.msg-quote-block:focus-visible{outline:2px solid rgba(var(--tapp-primary-rgb,99,102,241),.45);outline-offset:1px}
.msg-quote-block:not([data-quote-id]){cursor:default}
.msg-quote-bar{width:3px;border-radius:2px;background:var(--tapp-primary,#6366f1);flex-shrink:0;margin-right:8px}
.msg-quote-content{min-width:0;flex:1}
.msg-quote-sender{font-size:11px;font-weight:600;opacity:.7;margin-bottom:1px}
.msg-quote-text{font-size:12px;opacity:.6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px}
.bubble-local .msg-quote-block{background:rgba(255,255,255,.15)}
.bubble-local .msg-quote-block:hover{background:rgba(255,255,255,.22)}
.bubble-local .msg-quote-bar{background:rgba(255,255,255,.6)}

/* -- Quote Preview above input bar -- */
.quote-preview{display:flex;align-items:center;gap:0;padding:8px 12px;background:rgba(128,128,128,.04);border-bottom:1px solid rgba(128,128,128,.08);border-radius:12px 12px 0 0}
.quote-preview-bar{width:3px;height:100%;min-height:28px;border-radius:2px;background:var(--tapp-primary,#6366f1);flex-shrink:0;margin-right:10px}
.quote-preview-body{flex:1;min-width:0}
.quote-preview-sender{font-size:11px;font-weight:600;color:var(--tapp-primary,#6366f1)}
.quote-preview-text{font-size:12px;color:var(--text-secondary,#888);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.quote-preview-close{background:none;border:none;font-size:18px;color:var(--text-secondary,#999);cursor:pointer;padding:0;width:36px;height:36px;min-width:36px;min-height:36px;border-radius:8px;flex-shrink:0;line-height:1;display:flex;align-items:center;justify-content:center}
.quote-preview-close:hover{background:rgba(128,128,128,.1)}

/* -- Forward Overlay -- */
.forward-overlay{position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;z-index:200;animation:ctxFadeIn .15s ease}
.forward-sheet{background:var(--bg-primary,#fff);border-radius:16px;width:min(340px,90vw);max-height:60vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 16px 48px rgba(0,0,0,.15)}
.forward-header{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid rgba(128,128,128,.08)}
.forward-title{font-size:15px;font-weight:600;color:var(--text-primary,#1a1a1a)}
.forward-close{background:none;border:none;font-size:18px;color:var(--text-secondary,#999);cursor:pointer;padding:0;width:36px;height:36px;min-width:36px;min-height:36px;border-radius:8px;display:flex;align-items:center;justify-content:center}
.forward-close:hover{background:rgba(128,128,128,.1)}
.forward-list{overflow-y:auto;padding:6px}
.forward-item{display:flex;align-items:center;gap:10px;width:100%;padding:10px 12px;border:none;background:none;border-radius:10px;font-size:13px;font-weight:500;color:var(--text-primary,#1a1a1a);cursor:pointer;transition:background .12s;font-family:inherit}
.forward-item:hover{background:rgba(128,128,128,.06)}
.forward-item:active{background:rgba(128,128,128,.12)}
.forward-item-avatar{width:32px;height:32px;border-radius:50%;background:rgba(var(--tapp-primary-rgb,128,128,128),.1);color:var(--tapp-primary,#888);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;flex-shrink:0;overflow:hidden}
.forward-item-avatar img{width:100%;height:100%;object-fit:cover}
.dark .forward-sheet{background:var(--bg-primary,#1a1a1a)}
.dark .forward-header{border-color:rgba(255,255,255,.06)}
.dark .forward-title{color:rgba(255,255,255,.9)}
.dark .forward-item{color:rgba(255,255,255,.9)}

/* ===================================================================
   Message media & rich cards
   -------------------------------------------------------------------
   Two skins, one markup. A media message with no caption/quote drops
   the bubble entirely (.bubble-media) and the card carries its own
   surface. With a caption the card nests inside the bubble instead,
   and on the tinted outgoing bubble it switches to a frosted skin.
   Both skins are driven by the same token block below.
   =================================================================== */
.msg-bubble{
  --card-surface:rgba(255,255,255,.72);
  --card-surface-hover:rgba(255,255,255,.86);
  --card-hair:rgba(15,23,42,.09);
  --card-hair-strong:rgba(15,23,42,.14);
  --card-shadow:0 2px 6px -3px rgba(15,23,42,.14),0 1px 1px rgba(15,23,42,.03);
  --card-shadow-hover:0 5px 14px -7px rgba(15,23,42,.18),0 1px 2px rgba(15,23,42,.04);
  --card-ink:var(--text-primary,#0f172a);
  --card-ink-dim:rgba(15,23,42,.58);
  --card-chip:rgba(15,23,42,.06);
}
.dark .msg-bubble{
  --card-surface:rgba(255,255,255,.07);
  --card-surface-hover:rgba(255,255,255,.11);
  --card-hair:rgba(255,255,255,.1);
  --card-hair-strong:rgba(255,255,255,.16);
  --card-shadow:0 2px 8px -5px rgba(0,0,0,.5);
  --card-shadow-hover:0 6px 16px -9px rgba(0,0,0,.6);
  --card-ink:rgba(255,255,255,.94);
  --card-ink-dim:rgba(255,255,255,.56);
  --card-chip:rgba(255,255,255,.09);
}
/* Nested inside the tinted outgoing bubble → frosted-on-accent skin */
.bubble-local:not(.bubble-media),.dark .bubble-local:not(.bubble-media){
  --card-surface:rgba(255,255,255,.16);
  --card-surface-hover:rgba(255,255,255,.24);
  --card-hair:rgba(255,255,255,.24);
  --card-hair-strong:rgba(255,255,255,.34);
  --card-shadow:none;
  --card-shadow-hover:none;
  --card-ink:#fff;
  --card-ink-dim:rgba(255,255,255,.74);
  --card-chip:rgba(255,255,255,.2);
}
/* Card-as-bubble: strip the bubble chrome, keep the footer legible */
.bubble-media{background:none!important;padding:0;max-width:min(340px,80%);border-radius:20px}
.bubble-media .msg-sender{margin:0 4px 5px}
.bubble-media .msg-footer{padding:0 4px}
.bubble-media .msg-time,.bubble-media .msg-pin{color:var(--text-secondary,#94a3b8)}
.bubble-media .msg-more-btn{top:6px;right:6px;color:var(--card-ink);background:var(--card-surface);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);box-shadow:0 1px 4px rgba(15,23,42,.12);width:28px;height:28px;min-width:28px;min-height:28px;border-radius:9px}
/* The sender line lives inside the bubble; without a bubble the button must
   clear it so it lands on the card rather than above it. */
.bubble-media:has(.msg-sender) .msg-more-btn{top:28px}
.msg-caption{margin-top:8px}

/* ----- Image bubble ----- */
/* The frame owns the size cap and the image fills it — an <img>'s max-content
   contribution is its natural width, so capping the img instead leaves a gutter. */
.msg-media{position:relative;margin:0;display:block;width:fit-content;max-width:min(300px,100%);border-radius:18px;overflow:hidden;cursor:zoom-in;line-height:0;background:var(--card-chip);box-shadow:var(--card-shadow);isolation:isolate}
.msg-media::after{content:'';position:absolute;inset:0;border-radius:inherit;box-shadow:inset 0 0 0 1px var(--card-hair);pointer-events:none}
.msg-media:focus-visible{outline:2px solid rgba(var(--tapp-primary-rgb,99,102,241),.6);outline-offset:2px}
.msg-image{display:block;width:100%;height:auto;max-height:330px;object-fit:cover;border-radius:inherit;transition:transform .35s cubic-bezier(.2,.7,.2,1)}
.msg-media-veil{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.28),transparent 42%,transparent 62%,rgba(0,0,0,.24));opacity:0;transition:opacity .2s;pointer-events:none}
.msg-media-zoom{position:absolute;top:10px;right:10px;width:30px;height:30px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:15px;color:#fff;background:rgba(15,23,42,.42);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);opacity:0;transform:scale(.85);transition:opacity .18s,transform .18s;pointer-events:none}
.msg-media:hover .msg-image{transform:scale(1.035)}
.msg-media:hover .msg-media-veil,.msg-media:focus-visible .msg-media-veil{opacity:1}
.msg-media:hover .msg-media-zoom,.msg-media:focus-visible .msg-media-zoom{opacity:1;transform:scale(1)}

/* ----- File bubble ----- */
.msg-file-card{
  --acc:100,116,139;
  display:flex;align-items:center;gap:12px;width:100%;min-width:min(250px,100%);
  padding:11px 12px;border-radius:16px;border:1px solid var(--card-hair);
  background:var(--card-surface);color:var(--card-ink);box-shadow:var(--card-shadow);
  font:inherit;text-align:left;cursor:pointer;
  transition:background .18s,border-color .18s,box-shadow .22s,transform .18s;
}
.msg-file-card[data-kind="image"]{--acc:59,130,246}
.msg-file-card[data-kind="video"]{--acc:236,72,153}
.msg-file-card[data-kind="audio"]{--acc:14,165,233}
.msg-file-card[data-kind="archive"]{--acc:245,158,11}
.msg-file-card[data-kind="doc"]{--acc:239,68,68}
.msg-file-card[data-kind="sheet"]{--acc:34,197,94}
.msg-file-card[data-kind="code"]{--acc:139,92,246}
.msg-file-card[data-kind="text"]{--acc:100,116,139}
button.msg-file-card:hover{background:var(--card-surface-hover);border-color:var(--card-hair-strong);box-shadow:var(--card-shadow-hover);transform:translateY(-1px)}
button.msg-file-card:active{transform:translateY(0) scale(.99)}
button.msg-file-card:focus-visible{outline:2px solid rgba(var(--tapp-primary-rgb,99,102,241),.55);outline-offset:2px}
button.msg-file-card:disabled,.msg-file-card-disabled{opacity:.55;cursor:not-allowed;transform:none!important;box-shadow:none!important}
button.msg-file-card.msg-file-card-loading{opacity:.75;pointer-events:none;cursor:wait}
button.msg-file-card.msg-file-card-loading .msg-file-action{animation:aroSpin .8s linear infinite}
.msg-file-icon{position:relative;width:42px;height:42px;flex-shrink:0;border-radius:13px;display:flex;align-items:center;justify-content:center;font-size:20px;color:rgb(var(--acc));background:linear-gradient(150deg,rgba(var(--acc),.24),rgba(var(--acc),.1));box-shadow:inset 0 0 0 1px rgba(var(--acc),.22)}
.bubble-local:not(.bubble-media) .msg-file-icon{color:#fff;background:rgba(255,255,255,.22);box-shadow:inset 0 0 0 1px rgba(255,255,255,.28)}
.msg-file-ext{position:absolute;bottom:-3px;right:-3px;font-style:normal;font-size:8px;font-weight:800;letter-spacing:.02em;line-height:1;padding:3px 4px;border-radius:6px;color:#fff;background:rgb(var(--acc));box-shadow:0 0 0 2px var(--card-surface)}
.bubble-local:not(.bubble-media) .msg-file-ext{color:var(--tapp-primary,#6366f1);background:#fff;box-shadow:none}
.msg-file-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.msg-file-name{font-size:13.5px;font-weight:600;letter-spacing:-.005em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.msg-file-size{font-size:11px;font-weight:500;color:var(--card-ink-dim)}
.msg-file-size:empty{display:none}
.msg-file-action{flex-shrink:0;width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:15px;color:var(--card-ink-dim);background:var(--card-chip);transition:background .18s,color .18s,transform .18s}
button.msg-file-card:hover .msg-file-action{color:rgb(var(--acc));background:rgba(var(--acc),.16);transform:translateY(1px)}
.bubble-local:not(.bubble-media) button.msg-file-card:hover .msg-file-action{color:#fff;background:rgba(255,255,255,.28)}

/* ----- Share card (tapp / brew / library / report) ----- */
.msg-share-card{
  --acc:var(--tapp-primary-rgb,99,102,241);
  position:relative;display:flex;flex-direction:column;overflow:hidden;
  width:100%;min-width:min(260px,100%);
  border-radius:18px;border:1px solid var(--card-hair);
  background:var(--card-surface);color:var(--card-ink);box-shadow:var(--card-shadow);
  cursor:pointer;transition:background .18s,border-color .18s,box-shadow .22s,transform .18s;
}
.msg-share-card[data-type="brew"]{--acc:34,197,94}
.msg-share-card[data-type="library"]{--acc:168,85,247}
.msg-share-card[data-type="report"]{--acc:239,68,68}
.msg-share-card[data-pending]{cursor:default}
.msg-share-card:hover{background:var(--card-surface-hover);border-color:rgba(var(--acc),.32);box-shadow:var(--card-shadow-hover);transform:translateY(-1px)}
.msg-share-card[data-pending]:hover{transform:none}
.msg-share-card:active{transform:translateY(0) scale(.995)}
/* Accent wash: a soft corner bloom keyed to the content type */
.msg-share-wash{position:absolute;inset:0;pointer-events:none;background:radial-gradient(120% 90% at 0% 0%,rgba(var(--acc),.16),transparent 62%);opacity:.9}
/* A favicon states the source without giving us a color to match, so the card
   stays near-neutral rather than tinting by message type. Brand-marked cards
   keep a full wash — it is now the platform's own color. */
.msg-share-card[data-mark="img"] .msg-share-wash{opacity:.2}
.bubble-local:not(.bubble-media) .msg-share-wash{background:radial-gradient(120% 90% at 0% 0%,rgba(255,255,255,.16),transparent 62%)}
.msg-share-main{position:relative;display:flex;gap:12px;align-items:flex-start;padding:14px}
.msg-share-icon{position:relative;width:48px;height:48px;flex-shrink:0;border-radius:14px;overflow:hidden;display:flex;align-items:center;justify-content:center;font-size:21px;color:rgb(var(--acc));background:linear-gradient(150deg,rgba(var(--acc),.26),rgba(var(--acc),.1));box-shadow:inset 0 0 0 1px rgba(var(--acc),.22)}
.msg-share-icon svg{width:23px;height:23px}
.msg-share-icon[data-cover]{background:var(--card-chip);box-shadow:inset 0 0 0 1px var(--card-hair)}
.msg-share-icon img{width:100%;height:100%;object-fit:cover;display:block}
.bubble-local:not(.bubble-media) .msg-share-icon{color:#fff;background:rgba(255,255,255,.2);box-shadow:inset 0 0 0 1px rgba(255,255,255,.26)}
.msg-share-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;padding-top:2px}
/* Known platform → brand palette drives the tile, wash and hover border.
   Set here (not inline) so the .dark variant can win the cascade. */
.msg-share-card[data-mark="brand"]{--acc:var(--acc-l,var(--tapp-primary-rgb,99,102,241))}
.dark .msg-share-card[data-mark="brand"]{--acc:var(--acc-d,var(--acc-l,var(--tapp-primary-rgb,99,102,241)))}
.msg-share-icon[data-mark] svg{width:26px;height:26px}
/* A favicon carries its own colors — keep its tile neutral so it doesn't clash */
.msg-share-icon[data-mark="img"]{color:var(--card-ink);background:var(--card-chip);box-shadow:inset 0 0 0 1px var(--card-hair)}
.bubble-local:not(.bubble-media) .msg-share-icon[data-mark="img"]{color:#fff}
.msg-share-favicon{width:26px;height:26px;object-fit:contain;border-radius:6px}
.msg-share-title{font-size:14.5px;font-weight:650;line-height:1.32;letter-spacing:-.01em;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.msg-share-title:empty::before{content:'—';opacity:.45;font-weight:500}
.msg-share-desc{font-size:12px;line-height:1.42;color:var(--card-ink-dim);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.msg-share-meta{display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-top:3px}
.msg-share-ver{font-size:10px;font-weight:700;letter-spacing:.02em;padding:3px 7px;border-radius:7px;background:var(--card-chip);color:var(--card-ink-dim);font-variant-numeric:tabular-nums}
.msg-share-status{font-size:10px;font-weight:700;letter-spacing:.01em;padding:3px 9px;border-radius:7px}
.msg-share-status-pending{background:rgba(245,158,11,.16);color:#d97706}
.msg-share-status-accepted{background:rgba(34,197,94,.16);color:#16a34a}
.msg-share-status-rejected{background:rgba(239,68,68,.16);color:#dc2626}
.dark .msg-share-status-pending{color:#fbbf24}
.dark .msg-share-status-accepted{color:#4ade80}
.dark .msg-share-status-rejected{color:#f87171}
.bubble-local:not(.bubble-media) .msg-share-status{background:rgba(255,255,255,.22);color:#fff}
.msg-share-go{align-self:center;flex-shrink:0;font-size:15px;color:var(--card-ink-dim);opacity:.5;transition:transform .2s,opacity .2s}
.msg-share-card:hover .msg-share-go{opacity:1;transform:translateX(2px)}
.msg-share-actions{position:relative;display:flex;gap:8px;padding:0 14px 14px}
.msg-share-actions button{flex:1;min-height:34px;padding:0 12px;border:none;border-radius:11px;font:inherit;font-size:12.5px;font-weight:650;cursor:pointer;transition:filter .16s,background .16s,transform .12s}
.msg-share-actions button:active{transform:scale(.98)}
.msg-share-actions button:focus-visible{outline:2px solid rgba(var(--tapp-primary-rgb,99,102,241),.55);outline-offset:2px}
.msg-share-btn-accept{background:linear-gradient(160deg,rgb(var(--acc)),rgba(var(--acc),.82));color:#fff;box-shadow:0 2px 6px -3px rgba(var(--acc),.45)}
.msg-share-btn-accept:hover{filter:brightness(1.06)}
.msg-share-btn-reject{background:var(--card-chip);color:var(--card-ink-dim)}
.msg-share-btn-reject:hover{background:var(--card-hair)}

/* ----- Media (library) share cards — image-forward poster layout -----------
   A game / anime / music share carries its own cover art, so it renders as a
   poster card: cover leads (platform logo as a corner mark), then just the
   title + one compact meta row (kind · rating · sender playtime/progress) — no
   source text, no separators. Orientation: games banner, music square, else
   portrait, corrected from the loaded image's real aspect (chat.js). */
.msg-media-card{
  --acc:168,85,247;
  position:relative;overflow:hidden;display:flex;align-items:stretch;
  width:100%;min-width:min(210px,100%);max-width:330px;
  border-radius:16px;border:1px solid var(--card-hair);
  background:var(--card-surface);color:var(--card-ink);box-shadow:var(--card-shadow);
  cursor:pointer;transition:border-color .18s,box-shadow .22s,transform .18s;
}
.msg-media-card[data-mark="brand"]{--acc:var(--acc-l,168,85,247)}
.dark .msg-media-card[data-mark="brand"]{--acc:var(--acc-d,var(--acc-l,168,85,247))}
.msg-media-card:hover{border-color:rgba(var(--acc),.34);box-shadow:var(--card-shadow-hover);transform:translateY(-1px)}
.msg-media-card:active{transform:translateY(0) scale(.995)}

.msg-media-cover{position:relative;flex-shrink:0;overflow:hidden;line-height:0;background:linear-gradient(150deg,rgba(var(--acc),.24),rgba(var(--acc),.08))}
.msg-media-cover-img{position:relative;z-index:1;width:100%;height:100%;object-fit:cover;display:block;transition:transform .3s}
.msg-media-card:hover .msg-media-cover-img{transform:scale(1.04)}
.msg-media-cover-fallback{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:28px;color:rgb(var(--acc));opacity:.92}
.msg-media-cover[data-broken] .msg-media-cover-img{display:none}
/* Platform logo as a small frosted mark on the cover (replaces source text). */
.msg-media-logo{position:absolute;z-index:2;top:6px;left:6px;width:22px;height:22px;border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:13px;color:#fff;background:rgba(15,23,42,.5);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);box-shadow:0 1px 3px rgba(0,0,0,.25)}
.msg-media-logo svg{width:13px;height:13px}

.msg-media-info{position:relative;z-index:1;flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:4px;padding:10px 30px 10px 12px}
.msg-media-title{font-size:14.5px;font-weight:680;line-height:1.26;letter-spacing:-.01em;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.msg-media-meta{display:flex;align-items:center;flex-wrap:wrap;gap:9px;font-size:11.5px;line-height:1.2;font-variant-numeric:tabular-nums}
.msg-media-kind{font-weight:600;color:var(--card-ink-dim)}
.msg-media-sub{font-weight:500;color:var(--card-ink-dim);opacity:.72}
.msg-media-rate{display:inline-flex;align-items:center;gap:3px;font-weight:700;color:#f59e0b}
.dark .msg-media-rate{color:#fbbf24}
.msg-media-rate svg{width:12px;height:12px}
/* Progress / playtime row: pure monochrome ink (light=near-black, dark=near-white).
   Never inherit platform --acc purple — force color on both the label and the SVG. */
.msg-media-stat{display:inline-flex;align-items:center;gap:3.5px;font-weight:700;color:var(--card-ink)}
.msg-media-stat svg{width:13px;height:13px;flex-shrink:0;color:var(--card-ink)}
.msg-media-card .msg-media-stat,.msg-media-card .msg-media-stat svg{color:var(--card-ink)}
.msg-media-go{position:absolute;z-index:2;top:50%;right:8px;transform:translateY(-50%);font-size:14px;color:var(--card-ink-dim);opacity:.4;transition:opacity .2s}
.msg-media-card:hover .msg-media-go{opacity:.85}

.msg-media-card[data-orient="landscape"]{flex-direction:column}
.msg-media-card[data-orient="landscape"] .msg-media-cover{width:100%;aspect-ratio:16/9}
.msg-media-card[data-orient="landscape"] .msg-media-go{top:auto;bottom:9px;transform:none}
/* Portrait poster (anime / books): a large image on top with the text below,
   so the cover reads as a proper poster instead of a thin side thumbnail. */
.msg-media-card[data-orient="portrait"]{flex-direction:column;max-width:230px}
.msg-media-card[data-orient="portrait"] .msg-media-cover{width:100%;aspect-ratio:3/4}
.msg-media-card[data-orient="portrait"] .msg-media-go{top:auto;bottom:9px;transform:none}
.msg-media-card[data-orient="square"] .msg-media-cover{width:92px;aspect-ratio:1/1}
/* Music (square): stack artist over album instead of a gap-spaced row. */
.msg-media-card[data-orient="square"] .msg-media-meta{flex-direction:column;align-items:flex-start;gap:1px}
.msg-media-card[data-orient="square"] .msg-media-meta > span{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media (prefers-reduced-motion:reduce){
  .msg-media-card:hover .msg-media-cover-img{transform:none}
}

/* ----- Full-screen image viewer ----- */
.img-viewer{position:fixed;inset:0;z-index:400;display:flex;flex-direction:column;background:rgba(9,9,14,.82);backdrop-filter:blur(22px) saturate(1.1);-webkit-backdrop-filter:blur(22px) saturate(1.1)}
.img-viewer-bar{display:flex;align-items:center;gap:10px;padding:12px 14px;padding-top:calc(12px + env(safe-area-inset-top,0px));color:rgba(255,255,255,.9);flex-shrink:0}
.img-viewer-name{flex:1;min-width:0;font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:rgba(255,255,255,.82)}
.img-viewer-btn{width:36px;height:36px;flex-shrink:0;border:none;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:17px;color:#fff;background:rgba(255,255,255,.12);cursor:pointer;transition:background .15s,transform .12s}
.img-viewer-btn:hover{background:rgba(255,255,255,.22)}
.img-viewer-btn:active{transform:scale(.94)}
.img-viewer-btn:focus-visible{outline:2px solid rgba(255,255,255,.65);outline-offset:2px}
.img-viewer-stage{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:0 16px calc(24px + env(safe-area-inset-bottom,0px))}
.img-viewer-img{max-width:100%;max-height:100%;object-fit:contain;border-radius:14px;box-shadow:0 30px 70px -30px rgba(0,0,0,.9);cursor:default}

/* ===== Members ===== */
.member-item{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;transition:background .15s;min-height:44px}
.member-item:hover{background:rgba(128,128,128,.05)}
.member-avatar{width:32px;height:32px;border-radius:50%;background:rgba(var(--tapp-primary-rgb,128,128,128),.1);color:var(--tapp-primary,#6366f1);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;flex-shrink:0;overflow:hidden}
.member-avatar img{width:100%;height:100%;object-fit:cover}
.member-info{min-width:0;flex:1}
.member-name{font-size:13px;font-weight:500;color:var(--text-primary,#1a1a1a);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.member-role{font-size:11px;color:var(--text-secondary,#999);margin-top:1px}
.member-local{font-size:10px;font-weight:600;color:var(--tapp-primary,#6366f1);background:rgba(var(--tapp-primary-rgb,99,102,241),.1);padding:2px 7px;border-radius:999px;flex-shrink:0}

/* ===== Dark Mode ===== */
.dark .aro-nav-item:hover{color:rgba(255,255,255,.9)}
.dark .sidebar{border-color:rgba(255,255,255,.06)}
.dark .sidebar-header{border-color:rgba(255,255,255,.06)}
.dark .sidebar-title{color:rgba(255,255,255,.92)}
.dark .conv-name{color:rgba(255,255,255,.9)}
.dark .conv-subtitle{color:rgba(255,255,255,.45)}
.dark .conv-empty{color:rgba(255,255,255,.45)}
.dark .chat-header{border-color:rgba(255,255,255,.06)}
.dark .chat-name{color:rgba(255,255,255,.92)}
.dark .back-btn{color:rgba(255,255,255,.6)}
.dark .member-panel{border-color:rgba(255,255,255,.06)}
.dark .member-header{border-color:rgba(255,255,255,.06)}
.dark .member-name{color:rgba(255,255,255,.9)}
.dark .member-title{color:rgba(255,255,255,.45)}
.dark .member-back-btn{color:rgba(255,255,255,.9)}
.dark .member-toggle-btn,.dark .manage-btn{color:rgba(255,255,255,.6)}
.dark .empty-icon{background:rgba(255,255,255,.06);color:rgba(255,255,255,.35)}
.dark .empty-state{color:rgba(255,255,255,.5)}
.dark .empty-text{color:rgba(255,255,255,.5)}
.dark .bubble-remote{background:rgba(255,255,255,.07);color:rgba(255,255,255,.9)}
.dark .msg-input{color:rgba(255,255,255,.9)}
.dark .msg-time{opacity:.4}
.dark .msg-sender{color:var(--tapp-primary,#818cf8)}
.dark .messages-empty{color:rgba(255,255,255,.45)}
.dark .messages-empty-icon{background:rgba(255,255,255,.06);color:rgba(255,255,255,.35)}
.dark .pinned-bar{background:rgba(var(--tapp-primary-rgb,99,102,241),.1)}
.dark .pinned-bar-text{color:rgba(255,255,255,.85)}
.dark .manage-item{color:rgba(255,255,255,.9)}
.dark .meta-badge{color:rgba(255,255,255,.6)}
.dark .feed-handle{color:rgba(255,255,255,.45)}
.dark .feed-mobile-tab{color:rgba(255,255,255,.5)}
.dark .feed-item{border-color:rgba(255,255,255,.04)}
.dark .feed-item-handle{color:rgba(255,255,255,.45)}
.dark .feed-item-time{color:rgba(255,255,255,.4)}
.dark .feed-item-action{color:rgba(255,255,255,.45)}
.dark .feed-empty{color:rgba(255,255,255,.45)}

.dark .attach-preview{background:var(--bg-primary,#1a1a1a);border-color:rgba(255,255,255,.1)}
.dark .attach-preview-name{color:rgba(255,255,255,.9)}
.dark .picker-header-title{color:rgba(255,255,255,.92)}
.dark .picker-tab{background:rgba(255,255,255,.06);color:rgba(255,255,255,.5)}
.dark .picker-form label{color:rgba(255,255,255,.5)}
.dark .create-dialog-title{color:rgba(255,255,255,.92)}
.dark .create-dialog-tabs{background:rgba(255,255,255,.04)}
.dark .edit-label{color:rgba(255,255,255,.45)}
.dark .quote-preview{background:rgba(255,255,255,.04);border-color:rgba(255,255,255,.06)}
.dark .quote-preview-text{color:rgba(255,255,255,.5)}
.dark .invite-bar{border-color:rgba(255,255,255,.06)}
.dark .invite-input{background:rgba(255,255,255,.04);border-color:rgba(255,255,255,.1);color:rgba(255,255,255,.9)}
.dark .panel-detail-header{border-color:rgba(255,255,255,.06)}
.dark .ring-hdr-icon{background:rgba(var(--tapp-primary-rgb,128,128,128),.15);color:var(--tapp-primary,#818cf8)}
.dark .ring-action-sync{background:rgba(var(--tapp-primary-rgb,100,100,255),.15)}
.dark .ring-sync-bar{border-color:rgba(255,255,255,.04)}
.dark .ring-sync-bar.ring-sync-ok{background:rgba(34,197,94,.08)}
.dark .ring-sync-bar.ring-sync-err{background:rgba(239,68,68,.08)}
.dark .ring-id-bar{border-color:rgba(255,255,255,.06);background:rgba(255,255,255,.03)}
.dark .ring-id-label{color:rgba(255,255,255,.45)}
.dark .ring-id-value{background:rgba(255,255,255,.06);color:rgba(255,255,255,.68)}
.dark .conv-avatar{color:var(--tapp-primary,#818cf8)}
.dark .member-avatar{color:var(--tapp-primary,#818cf8)}

/* ===== Responsive ===== */
@media(max-width:768px){
  .aro-nav{order:99;border-bottom:none;border-top:1px solid rgba(128,128,128,.08);padding:6px 6px calc(6px + env(safe-area-inset-bottom,0px));justify-content:space-around}
  .aro-nav-item{flex-direction:column;gap:3px;padding:8px 12px;font-size:11px}
  .aro-nav-item svg{width:22px;height:22px}
  .nav-feed-avatar{width:24px;height:24px;font-size:11px}
  .sidebar{width:100%}
  .sidebar-hidden-mobile{display:none!important}
  .back-btn{display:block}
  .member-panel{display:none;position:fixed;inset:0;width:100%!important;z-index:80;background:var(--bg-primary,#fff);border-left:none}
  .dark .member-panel{background:var(--bg-primary,#1a1a1a)}
  .member-panel.member-open-mobile{display:flex!important}
  .member-back-btn{display:flex}
  .aro-panel-layout .sidebar{width:100%}
  .aro-panel-layout .sidebar-hidden-mobile{display:none!important}
  .aro-panel-layout .panel-main{display:none}
  .aro-panel-layout .panel-main-show-mobile{display:flex!important}
}
@media(min-width:769px) and (max-width:1024px){
  .member-panel{width:0;border-left:none;overflow:hidden}
  .member-panel.member-expanded-tablet{width:180px;border-left:1px solid rgba(128,128,128,.08);overflow:hidden}
  .feed-sidebar{width:68px;flex:0 0 68px;padding:12px 8px;overflow:visible;position:relative;z-index:5}
  .feed-main{max-width:none!important;border-right:none!important}
  .feed-nav-item>span:not(.feed-nav-badge){display:none}
  .feed-nav-item{justify-content:center;padding:10px}
  .feed-nav-item .feed-nav-badge{position:absolute;top:2px;right:2px;margin-left:0;min-width:14px;height:14px;padding:0 3px;font-size:8px;pointer-events:none}
  .feed-sidebar-footer{align-items:center;position:relative}
  .feed-profile-card{width:40px;height:40px;padding:0;border:none;background:none;overflow:visible}
  .feed-profile-summary{width:40px;height:40px;justify-content:center}
  .feed-profile-card>.feed-profile-summary .feed-profile-info,.feed-profile-card>.feed-profile-summary .feed-profile-copy,.feed-profile-card>.feed-profile-summary .feed-profile-toggle,.feed-profile-card>.feed-profile-details{display:none!important}
  .feed-profile-card.feed-profile-popover-open .feed-profile-tablet-popover{position:absolute;left:54px;bottom:0;width:232px;padding:9px;border:1px solid rgba(128,128,128,.12);border-radius:12px;background:var(--bg-primary,#fff);box-shadow:0 12px 36px rgba(0,0,0,.18);z-index:40;display:flex;flex-direction:column}
  .feed-profile-card.feed-profile-popover-open .feed-profile-tablet-popover .feed-profile-info{display:flex!important}
  .feed-profile-card.feed-profile-popover-open .feed-profile-tablet-popover .feed-profile-copy,.feed-profile-card.feed-profile-popover-open .feed-profile-tablet-popover .feed-profile-toggle{display:flex!important}
  .feed-profile-card.feed-profile-popover-open .feed-profile-tablet-popover .feed-profile-details{display:block!important}
  .feed-profile-card.feed-profile-popover-open.feed-profile-expanded .feed-profile-tablet-popover .feed-profile-details{max-height:56px;opacity:1;padding-top:8px}
  .dark .feed-profile-card.feed-profile-popover-open .feed-profile-tablet-popover{background:var(--bg-primary,#0a0a0a);border-color:rgba(255,255,255,.08);box-shadow:0 16px 44px rgba(0,0,0,.38)}
}

/* ===== Create Dialog ===== */
.create-overlay{position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;z-index:100}
.create-dialog{background:var(--bg-primary,#fff);border-radius:16px;width:min(360px,90vw);padding:20px;box-shadow:0 16px 48px rgba(0,0,0,.15)}
.create-dialog-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
.create-dialog-title{margin:0;font-size:16px;font-weight:600;color:var(--text-primary,#1a1a1a)}
.create-dialog-close{background:none;border:none;font-size:16px;color:var(--text-secondary,#999);cursor:pointer;padding:4px;border-radius:6px}
.create-dialog-close:hover{background:rgba(128,128,128,.08)}
.create-dialog-tabs{display:flex;gap:4px;margin-bottom:16px;background:rgba(128,128,128,.06);border-radius:10px;padding:3px}
.create-tab{flex:1;padding:6px 12px;border:none;background:none;border-radius:8px;font-size:12px;font-weight:500;color:var(--text-secondary,#999);cursor:pointer;transition:all .15s}
.create-tab-active{background:var(--bg-primary,#fff);color:var(--text-primary,#1a1a1a);box-shadow:0 1px 3px rgba(0,0,0,.08)}
.create-form{display:flex;flex-direction:column;gap:10px}
.create-input{height:40px;padding:0 14px;border-radius:12px;border:1px solid rgba(128,128,128,.15);background:rgba(128,128,128,.03);color:var(--text-primary,#1a1a1a);font-size:13px;outline:none;transition:border-color .2s}
.create-input:focus{border-color:rgba(var(--tapp-primary-rgb,128,128,128),.4)}
.create-input::placeholder{color:var(--text-secondary,#bbb)}
.create-submit{height:40px;border-radius:12px;border:none;background:var(--tapp-primary,#888);color:#fff;font-size:13px;font-weight:500;cursor:pointer;transition:opacity .15s}
.create-submit:hover{opacity:.85}
.create-submit:disabled{opacity:.4;cursor:not-allowed}
.dark .create-dialog{background:var(--bg-primary,#1a1a1a)}
.dark .create-tab-active{background:rgba(255,255,255,.08);color:rgba(255,255,255,.92)}
.dark .create-input{background:rgba(255,255,255,.03);border-color:rgba(255,255,255,.1);color:rgba(255,255,255,.9)}
.edit-label{font-size:11px;font-weight:600;color:var(--text-secondary,#888);text-transform:uppercase;letter-spacing:.04em}
.member-kick{margin-left:auto;width:36px;height:36px;min-width:36px;min-height:36px;border:none;background:none;color:var(--text-secondary,#999);cursor:pointer;border-radius:8px;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .15s,background .15s;flex-shrink:0}
.member-item:hover .member-kick,.member-kick:focus-visible{opacity:1}
.member-kick:hover,.member-kick:focus-visible{background:rgba(239,68,68,.1);color:#ef4444}
@media (hover:none),(pointer:coarse){
  .member-kick{opacity:.85}
}

/* Ring list reuses conv-item; type subtitle class */
.conv-subtitle{font-size:12px;color:var(--text-secondary,#888);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dark .conv-subtitle{color:rgba(255,255,255,.5)}
.panel-detail-header{min-height:56px;padding:12px 14px;background:rgba(255,255,255,.4)}
.dark .panel-detail-header{background:rgba(10,10,10,.35)}
.ring-action-sync{min-height:32px;padding:6px 12px;font-size:12px;font-weight:600}
.invite-bar{padding:10px 12px;gap:8px;align-items:center}
.invite-input{height:36px;border-radius:10px;padding:0 12px;font-size:13px}
.invite-btn{height:36px;padding:0 14px;border-radius:10px;font-weight:600}

/* Composer disabled locked look */
.msg-input:disabled{opacity:.55;cursor:not-allowed}
.attach-btn:disabled{opacity:.4;cursor:not-allowed;pointer-events:none}
.input-bar:focus-within{border-color:rgba(var(--tapp-primary-rgb,99,102,241),.35);box-shadow:0 2px 14px rgba(var(--tapp-primary-rgb,99,102,241),.08)}
.dark .input-bar:focus-within{border-color:rgba(var(--tapp-primary-rgb,99,102,241),.4)}

/* Manage menu destructive already; improve touch */
.manage-item{min-height:36px;padding:8px 12px;font-size:13px}
.msg-ctx-item{min-height:40px;padding:10px 14px}


/* ===== In-app Confirm Dialog (native confirm() is blocked in the sandboxed iframe) ===== */
.confirm-overlay{position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;z-index:300;animation:ctxFadeIn .12s ease}
.confirm-dialog{background:var(--bg-primary,#fff);border-radius:16px;width:min(320px,88vw);padding:20px;box-shadow:0 16px 48px rgba(0,0,0,.18)}
.confirm-message{font-size:14px;line-height:1.6;color:var(--text-primary,#1a1a1a);margin-bottom:18px;overflow-wrap:break-word}
.confirm-actions{display:flex;gap:8px;justify-content:flex-end}
.confirm-btn{padding:8px 18px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;transition:opacity .15s;font-family:inherit}
.confirm-btn:hover{opacity:.85}
.confirm-btn-cancel{background:rgba(128,128,128,.08);color:var(--text-primary,#1a1a1a)}
.confirm-btn-ok{background:var(--tapp-primary,#6366f1);color:#fff}
.confirm-btn-danger{background:#ef4444}
.dark .confirm-dialog{background:var(--bg-primary,#1a1a1a)}
.dark .confirm-message{color:rgba(255,255,255,.9)}
.dark .confirm-btn-cancel{background:rgba(255,255,255,.08);color:rgba(255,255,255,.9)}

/* ===== Motion layer (intentional, short, reduced-motion aware) ===== */
:root{
  --aro-ease:cubic-bezier(.2,.8,.2,1);
  --aro-dur-fast:120ms;
  --aro-dur:200ms;
  --aro-dur-view:240ms;
}
@keyframes aroFadeIn{from{opacity:0}to{opacity:1}}
@keyframes aroFadeOut{from{opacity:1}to{opacity:0}}
@keyframes aroViewIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
@keyframes aroSlideInRight{from{opacity:0;transform:translateX(14px)}to{opacity:1;transform:translateX(0)}}
@keyframes aroSlideInLeft{from{opacity:0;transform:translateX(-10px)}to{opacity:1;transform:translateX(0)}}
@keyframes aroSlideUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
@keyframes aroScaleIn{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}
@keyframes aroMsgIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
@keyframes aroPopIn{from{opacity:0;transform:scale(.94) translateY(4px)}to{opacity:1;transform:scale(1) translateY(0)}}
@keyframes aroSheetOut{from{opacity:1;transform:translateY(0)}to{opacity:0;transform:translateY(12px)}}
@keyframes aroScaleOut{from{opacity:1;transform:scale(1)}to{opacity:0;transform:scale(.97)}}

/* View switch: messages / feed / rings */
.aro-view.aro-view-active.aro-view-enter{
  animation:aroViewIn var(--aro-dur-view) var(--aro-ease) both;
}

/* Chat open empty → thread; sidebar return */
.chat-container.aro-panel-enter{animation:aroSlideInRight var(--aro-dur-view) var(--aro-ease) both}
.empty-state.aro-panel-enter{animation:aroFadeIn var(--aro-dur) var(--aro-ease) both}
.sidebar.aro-panel-enter{animation:aroSlideInLeft var(--aro-dur-view) var(--aro-ease) both}
.panel-main.aro-panel-enter,
.panel-detail.aro-panel-enter{animation:aroSlideInRight var(--aro-dur-view) var(--aro-ease) both}

/* Mobile member sheet */
@media(max-width:768px){
  .member-panel.member-open-mobile{animation:aroSlideInRight 220ms var(--aro-ease) both}
}

/* Dialogs / sheets / confirm / menus */
.create-overlay{animation:aroFadeIn var(--aro-dur) ease both}
.create-dialog{animation:aroScaleIn var(--aro-dur) var(--aro-ease) both}
.create-overlay.aro-leaving{animation:aroFadeOut 160ms ease both;pointer-events:none}
.create-overlay.aro-leaving .create-dialog{animation:aroScaleOut 160ms ease both}

.confirm-overlay{animation:aroFadeIn .16s ease both}
.confirm-dialog{animation:aroScaleIn .16s var(--aro-ease) both}
.confirm-overlay.aro-leaving{animation:aroFadeOut .14s ease both;pointer-events:none}
.confirm-overlay.aro-leaving .confirm-dialog{animation:aroScaleOut .14s ease both}

.picker-overlay.aro-leaving{animation:aroFadeOut .16s ease both;pointer-events:none}
.picker-overlay.aro-leaving .picker-sheet{animation:pickerPopOut .16s ease both}

.forward-sheet{animation:aroScaleIn .18s var(--aro-ease) both}
.forward-overlay.aro-leaving{animation:aroFadeOut .14s ease both;pointer-events:none}
.forward-overlay.aro-leaving .forward-sheet{animation:aroScaleOut .14s ease both}

.msg-ctx-menu.aro-leaving{animation:aroFadeOut .1s ease both;pointer-events:none}
.img-viewer.aro-viewer-enter{animation:aroFadeIn .18s ease both}
.img-viewer.aro-viewer-enter .img-viewer-img{animation:aroScaleIn .22s var(--aro-ease) both}
.img-viewer.aro-leaving{animation:aroFadeOut .16s ease both;pointer-events:none}
.img-viewer.aro-leaving .img-viewer-img{animation:aroScaleOut .16s ease both}
.manage-dropdown.open{animation:aroPopIn .14s var(--aro-ease) both}
.feed-plus-menu.open{animation:aroPopIn .14s var(--aro-ease) both}
.feed-plus-menu.aro-leaving{animation:aroFadeOut .1s ease both;pointer-events:none}
.invite-popover{animation:aroPopIn .14s var(--aro-ease) both}

/* Composer dialog + attach */
.feed-compose-preview{animation:aroScaleIn .16s var(--aro-ease) both}
.feed-compose-tool{transition:border-color .12s,color .12s,background .12s,transform .1s}
.feed-compose-tool:active{transform:scale(.97)}
.feed-compose-publish,.feed-compose-cancel{transition:opacity .15s,transform .1s,filter .12s}
.feed-compose-publish:hover:not(:disabled){filter:brightness(1.05)}
.feed-compose-publish:active:not(:disabled),.feed-compose-cancel:active:not(:disabled){transform:scale(.97)}
.feed-compose-preview-remove{transition:background .12s,transform .1s}
.feed-compose-preview-remove:active{transform:scale(.92)}

.attach-preview.aro-attach-enter{animation:aroPopIn .18s var(--aro-ease) both}
.send-btn{transition:background .15s,color .15s,opacity .15s,transform .12s,box-shadow .15s}
.send-btn.send-ready{box-shadow:0 2px 10px rgba(var(--tapp-primary-rgb,99,102,241),.32)}

/* Message appear (new only) */
.msg-row.msg-appear{animation:aroMsgIn .2s var(--aro-ease) both}

/* Unread badge + status chips */
@keyframes aroBadgeIn{from{opacity:0;transform:scale(.7)}to{opacity:1;transform:scale(1)}}
.conv-badge{animation:aroBadgeIn .16s var(--aro-ease) both}
.conv-pending,.conv-closed{animation:aroFadeIn .16s var(--aro-ease) both}

/* Quote / pinned / attach chrome */
.quote-preview{animation:aroSlideUp .18s var(--aro-ease) both}
.pinned-bar{animation:aroSlideUp .2s var(--aro-ease) both}
.attach-preview{transition:opacity .15s,transform .15s}
.attach-btn{transition:background .15s,color .15s,transform .12s}
.attach-btn:active{transform:scale(.94)}
.attach-btn.attach-btn-active{transition:background .15s,color .15s,transform .18s}

/* Day separator soft enter */
.msg-day-sep{animation:aroFadeIn .18s var(--aro-ease) both}

/* Feed media fade-in (avoid jank: opacity only) */
.feed-item-media-single img,.feed-item-media-single video,
.feed-media-cell img,.feed-media-cell video{
  animation:aroFadeIn .22s var(--aro-ease) both;
}

/* Press feedback — lists & chrome (100–150ms) */
.conv-item,.feed-nav-item,.aro-nav-item,.feed-item-action,.manage-item,.msg-ctx-item,
.create-btn,.create-submit,.action-btn,.ring-action-sync,.feed-empty-retry,.confirm-btn,
.picker-footer-btn,.picker-item,.attach-menu-item,.feed-plus-item,.invite-pop-contact,
.member-item,.forward-item{
  transition:background .12s,color .12s,opacity .12s,transform .1s,border-color .12s,filter .12s;
}
.conv-item:active,.feed-nav-item:active,.aro-nav-item:active,.feed-item-action:active,
.manage-item:active,.msg-ctx-item:active,.create-btn:active,.create-submit:active:not(:disabled),
.action-btn:active,.ring-action-sync:active,.feed-empty-retry:active,.confirm-btn:active,
.picker-footer-btn:active,.picker-item:active,.attach-menu-item:active,.feed-plus-item:active,
.invite-pop-contact:active,.forward-item:active{
  transform:scale(.97);
}
.create-btn:active{transform:scale(.94)}

/* Empty / error soft enter */
.feed-empty,.messages-empty,.conv-empty{animation:aroFadeIn var(--aro-dur) var(--aro-ease) both}
.feed-item{transition:background .12s,transform .1s}
.feed-item:active{background:rgba(128,128,128,.04)}

/* Profile card polish */
.feed-profile-card{transition:border-color .15s,box-shadow .15s,background .15s}
.feed-profile-card:hover{border-color:rgba(var(--tapp-primary-rgb,100,100,255),.22);box-shadow:0 2px 10px rgba(0,0,0,.04)}
.dark .feed-profile-card:hover{box-shadow:0 2px 12px rgba(0,0,0,.25)}

/* Reduced motion: dampen intentional motion; keep spinners usable but quiet */
@media (prefers-reduced-motion:reduce){
  :root{
    --aro-dur-fast:1ms;
    --aro-dur:1ms;
    --aro-dur-view:1ms;
  }
  .aro-view-enter,
  .aro-panel-enter,
  .aro-attach-enter,
  .msg-appear,
  .feed-empty,.messages-empty,.conv-empty,
  .create-overlay,.create-dialog,
  .confirm-overlay,.confirm-dialog,
  .picker-overlay,.picker-sheet,
  .forward-overlay,.forward-sheet,
  .msg-ctx-menu,
  .manage-dropdown.open,
  .feed-plus-menu.open,
  .invite-popover,
  .member-panel.member-open-mobile,
  .feed-compose-preview,
  .quote-preview,.pinned-bar,.conv-badge,.conv-pending,.conv-closed,.msg-day-sep,
  .feed-item-media-single img,.feed-item-media-single video,
  .feed-media-cell img,.feed-media-cell video{
    animation:none!important;
  }
  .create-overlay.aro-leaving,
  .confirm-overlay.aro-leaving,
  .picker-overlay.aro-leaving,
  .forward-overlay.aro-leaving,
  .msg-ctx-menu.aro-leaving,
  .create-overlay.aro-leaving .create-dialog,
  .feed-compose-overlay.aro-leaving .feed-compose-dialog,
  .confirm-overlay.aro-leaving .confirm-dialog,
  .picker-overlay.aro-leaving .picker-sheet,
  .img-viewer.aro-leaving,
  .img-viewer.aro-leaving .img-viewer-img,
  .forward-overlay.aro-leaving .forward-sheet{
    animation:none!important;
  }
  .msg-media:hover .msg-image{transform:none}
  .conv-item:active,.feed-nav-item:active,.aro-nav-item:active,.feed-item-action:active,
  .manage-item:active,.msg-ctx-item:active,.create-btn:active,.create-submit:active:not(:disabled),
  .action-btn:active,.ring-action-sync:active,.feed-empty-retry:active,.confirm-btn:active,
  .picker-footer-btn:active,.picker-item:active,.attach-menu-item:active,.feed-plus-item:active,
  .invite-pop-contact:active,.forward-item:active,
  .feed-plus-btn:active,.feed-compose-publish:active:not(:disabled),.feed-compose-cancel:active:not(:disabled),
  .feed-compose-tool:active,.send-btn.send-ready:active:not(:disabled){
    transform:none!important;
  }
  .feed-skeleton-avatar,.feed-skeleton-line{animation:none!important;background:rgba(128,128,128,.1)}
}

/* Create / invite empty-submit feedback */
.create-input-invalid,.invite-input.create-input-invalid{
  border-color:#ef4444 !important;
  box-shadow:0 0 0 2px rgba(239,68,68,.18);
  animation:aroShake .35s ease;
}
@keyframes aroShake{
  0%,100%{transform:translateX(0)}
  25%{transform:translateX(-3px)}
  75%{transform:translateX(3px)}
}
@media (prefers-reduced-motion:reduce){
  .create-input-invalid,.invite-input.create-input-invalid{animation:none}
}
`

const ARO_I18N: Record<string, Record<string, string>> = {
  "en": {
    "accept": "Accept",
    "acceptConfirmDesc": "Someone shared a Tapp with you.",
    "acceptConfirmTitle": "Install this Tapp?",
    "acceptFail": "Couldn't accept",
    "acceptTapp": "Accept",
    "activityType": "Activity",
    "addPeerBtn": "Add peer",
    "addPeerFail": "Couldn't add peer",
    "addPeerPlaceholder": "@user@domain or profile link",
    "adminRequired": "Admin access required",
    "alreadyLatest": "You're up to date",
    "attach": "Attach",
    "attachBrew": "Brew",
    "attachBrewPrompt": "Brew article title",
    "attachFile": "File",
    "attachImage": "Image",
    "attachLibrary": "Library",
    "attachLibraryPrompt": "Library name",
    "attachReport": "Report",
    "attachReportPrompt": "Report title",
    "attachSending": "Sending…",
    "attachTapp": "Tapp",
    "attachTappPrompt": "Tapp ID or name",
    "back": "Back",
    "backupBrowse": "Browse",
    "backupDeleted": "Archive removed",
    "backupExportActive": "Export open chat",
    "backupExportAll": "Export all chats",
    "backupExportCount": "{n} messages",
    "backupExportDesc": "Download a JSON backup of your direct messages and group chats from this device.",
    "backupExportFail": "Couldn't export",
    "backupExportOk": "Export ready",
    "backupExportProgress": "Exporting {done}/{total}…",
    "backupExportTitle": "Export chat history",
    "backupExporting": "Exporting…",
    "backupGuest": "Sign in to export or import chat history.",
    "backupHint": "Export and import your messenger history",
    "backupImportBtn": "Choose JSON file",
    "backupImportDesc": "Import a previously exported JSON file to browse offline. Import does not re-send messages to the server.",
    "backupImportFail": "Couldn't import",
    "backupImportFormat": "Unknown archive format",
    "backupImportHint": "Browse under Imported archives",
    "backupImportOk": "Import saved",
    "backupImportTitle": "Import archive",
    "backupImportedEmpty": "No imports yet.",
    "backupImportedTitle": "Imported archives",
    "backupImporting": "Importing…",
    "backupIncludeMedia": "Include image data (larger file)",
    "backupNeedConversation": "Open a chat first",
    "backupPrivacyNote": "Exports stay on your device. Large image payloads are omitted unless you enable “Include image data”.",
    "backupTitle": "Chat backup",
    "channelNotAccepted": "Accept the chat before sending",
    "channelPlaceholder": "@user@domain or profile link",
    "channelRejectConfirm": "Decline this message request?",
    "channelRejected": "Request declined",
    "close": "Close chat",
    "closeChannelConfirm": "Close this chat? You won't be able to send messages afterward.",
    "closeChannelFail": "Couldn't close chat",
    "closed": "Closed",
    "closedComposer": "This chat is closed — you can't send messages",
    "collapseDetails": "Show less",
    "composeAddImage": "Image",
    "composeAddVideo": "Video",
    "composeBadMediaUrl": "Uploaded media URL looks invalid — not publishing",
    "composeCancel": "Cancel",
    "composeDeliveryQueued": "Delivering to {n} followers",
    "composeDialogTitle": "New post",
    "composeDraftRestored": "Draft restored",
    "composeDraftTextOnly": "Draft kept text only — re-attach media if needed",
    "composeEmpty": "Write something or add media",
    "composeFail": "Couldn't publish",
    "composeMediaMissingOnFeed": "Published, but media may not show on the feed yet",
    "composePlaceholder": "What's on your mind?",
    "composePost": "Post",
    "composePublish": "Publish",
    "composePublishing": "Publishing…",
    "composeSuccess": "Published",
    "composeSuccessMedia": "Published with media",
    "composeTimelineMissing": "Published, but the post isn't on your timeline yet — try refresh",
    "composeUploadFail": "Media upload failed — not publishing",
    "composeUploadPartial": "Some media uploaded, then upload failed — not publishing (no half-post)",
    "composeUploading": "Uploading…",
    "composerClosed": "This chat is closed — you can't send messages",
    "confirmCancel": "Cancel",
    "confirmOk": "OK",
    "connected": "Connected",
    "copied": "Copied",
    "copy": "Copy",
    "copyFail": "Couldn't copy",
    "create": "New",
    "createChannel": "Start chat",
    "createFail": "Couldn't create",
    "createRingBtn": "Create ring",
    "createRingFail": "Couldn't create ring",
    "createRingTitle": "Create a ring",
    "createRoom": "Create group",
    "creating": "Creating…",
    "dateToday": "Today",
    "dateYesterday": "Yesterday",
    "deliveryDeadBody": "{n} outbound federation messages could not be delivered",
    "deliveryDeadTitle": "Federation delivery failed",
    "deliveryNotQueued": "Saved locally but could not queue for remote peers",
    "deliveryRetryBody": "{n} messages re-queued for delivery",
    "deliveryRetryConfirm": "Retry {n} failed federation deliveries?",
    "deliveryRetryOk": "Retry queued",
    "deliveryWarnBody": "Remote delivery may be incomplete",
    "deliveryWarnTitle": "Delivery notice",
    "disconnected": "Offline",
    "dismiss": "Dismiss",
    "dissolve": "Dissolve group",
    "dissolveConfirm": "Dissolve this group? Everyone will lose access. This can't be undone.",
    "dissolveFail": "Couldn't dissolve group",
    "dm": "Direct message",
    "downloadFail": "Couldn't download file",
    "downloadFile": "Download",
    "e2eFail": "Couldn’t publish encryption key",
    "e2ePublish": "Publish encryption key",
    "e2ePublished": "Encryption key published",
    "editRoom": "Edit group",
    "emptyChatHint": "No messages yet — say hello",
    "emptyFollowers": "Share your profile link so others can follow you.",
    "emptyFollowing": "Tap + then Follow to add someone by handle or profile link.",
    "emptyPeers": "No peers yet — add one below",
    "emptyPublished": "Switch to Home and tap + to publish a note or media.",
    "emptyRings": "No rings yet — create one to get started.",
    "emptyRoomHint": "No messages yet — start the conversation",
    "emptyTimeline": "Follow people or publish a post to fill your home feed.",
    "emptyTitleFollowers": "No followers yet",
    "emptyTitleFollowing": "Not following anyone",
    "emptyTitlePublished": "Nothing published",
    "emptyTitleTimeline": "No posts yet",
    "expandDetails": "Show more",
    "feedBackup": "Backup",
    "feedFollowers": "Followers",
    "feedFollowing": "Following",
    "feedHintBackup": "Export and import messenger history",
    "feedHintFollowers": "People who follow you",
    "feedHintFollowing": "People you follow",
    "feedHintGuest": "Public posts from this site",
    "feedHintPublished": "Notes you've published",
    "feedHintTimeline": "Posts from people you follow",
    "feedItems": "posts",
    "feedLoadFail": "Couldn't load feed",
    "feedLoading": "Loading…",
    "feedMetaFollowers": "People who follow you",
    "feedMetaFollowing": "People you follow",
    "feedMetaGuest": "Public posts from this site",
    "feedMetaPublished": "Notes you've published",
    "feedMetaTimeline": "Posts from people you follow",
    "feedPlus": "Add",
    "feedPublished": "Published",
    "feedRetry": "Try again",
    "feedSubFollowers": "People who follow you",
    "feedSubFollowing": "People you follow",
    "feedSubPublished": "Notes you've published",
    "feedSubTimeline": "Posts from people you follow",
    "feedTimeline": "Home",
    "fileTooLarge": "File too large (max 100 MB)",
    "fileTooLargeRoom": "File too large for group chat — use a DM for larger files",
    "followBtn": "Follow",
    "followDialogTitle": "Follow someone",
    "followFail": "Couldn't follow",
    "followPlaceholder": "@user@domain or profile link",
    "followQueued": "Follow request sent. Most instances accept automatically.",
    "forwardEmpty": "No other conversations to forward to",
    "forwardSuccess": "Forwarded",
    "forwardTo": "Forward to…",
    "forwardTooLarge": "Attachment too large to forward inline",
    "forwardTransferOnly": "Large chunked files can’t be forwarded yet — download and re-send",
    "guest": "Guest",
    "historyCount": "{n} messages",
    "historyEmpty": "No messages in this chat yet",
    "historyFilterAll": "All",
    "historyFilterFile": "Files",
    "historyFilterImage": "Images",
    "historyFilterPinned": "Pinned",
    "historyFilterShare": "Shares",
    "historyFilterText": "Text",
    "historyJumpMiss": "Couldn't find that message in the chat window",
    "historyLoadFail": "Couldn't load history",
    "historyLoadMore": "Load older messages",
    "historyLoading": "Loading history…",
    "historyMatchCount": "{n} / {total}",
    "historySearchPlaceholder": "Search messages…",
    "historyTitle": "Chat history",
    "installBtn": "Install",
    "installFailed": "Install failed — tap to retry",
    "installSuccess": "Installed",
    "installedAt": "Installed",
    "installingBtn": "Installing…",
    "invite": "Invite",
    "inviteBtn": "Invite",
    "inviteFail": "Couldn't invite",
    "inviteFromContacts": "From contacts",
    "inviteManual": "Invite by address",
    "invitePlaceholder": "@user@domain or profile link",
    "inviteSuccess": "Invite sent",
    "invited": "Invited",
    "inviting": "Inviting…",
    "joinRoom": "Join",
    "joinRoomFail": "Failed to join",
    "joinRoomOk": "Joined the group",
    "kick": "Remove",
    "kickConfirm": "Remove this member from the group?",
    "kickFail": "Couldn't remove member",
    "kicked": "You were removed from the group",
    "leave": "Leave group",
    "leaveBtn": "Leave ring",
    "leaveConfirm": "Leave this group? You can rejoin if invited again.",
    "leaveFail": "Couldn't leave group",
    "leaveRingConfirm": "Leave this ring? You can rejoin later if invited.",
    "leaveRingFail": "Couldn't leave ring",
    "libraryPickerEmpty": "No library items for this platform",
    "libraryPickerLoadFail": "Couldn't load library data",
    "loadFail": "Couldn't load",
    "local": "You",
    "localVer": "Installed",
    "manage": "More",
    "me": "Me",
    "mediaCh": "Ch {c}/{t}",
    "mediaChOnly": "Ch {c}",
    "mediaEp": "EP {c}/{t}",
    "mediaEpOnly": "EP {c}",
    "mediaHours": "{v}h",
    "mediaKind_anime": "Anime",
    "mediaKind_book": "Book",
    "mediaKind_game": "Game",
    "mediaKind_music": "Music",
    "mediaKind_tv_series": "TV",
    "mediaKind_video": "Video",
    "mediaMinutes": "{v}m",
    "mediaTooLarge": "File too large (images max 10 MB, videos max 50 MB)",
    "mediaUnsupported": "Unsupported file type",
    "members": "Members",
    "msgActions": "Message actions",
    "msgCopy": "Copy",
    "msgForward": "Forward",
    "msgPin": "Pin",
    "msgQuote": "Reply",
    "msgUnpin": "Unpin",
    "navFeed": "Home",
    "navMessages": "Messages",
    "navRings": "Rings",
    "newChannel": "New chat",
    "newMessage": "New message",
    "newRoom": "New group",
    "noContacts": "No contacts to invite yet",
    "noConv": "No conversations",
    "noConvHint": "Tap + to start a chat or group",
    "openJoin": "Open",
    "openOriginal": "Open original",
    "openTappBtn": "Open Tapp",
    "peers": "peers",
    "pending": "Pending",
    "pendingConfirm": "Waiting for confirmation",
    "pickerCancel": "Cancel",
    "pickerConfirm": "Add",
    "pickerDesc": "Description (optional)",
    "pickerEmpty": "Nothing to show",
    "pickerLoading": "Loading…",
    "pickerPickOne": "Pick one to attach",
    "pickerSearchPlaceholder": "Search…",
    "pickerSelectPlatform": "Choose a platform",
    "pickerTitle": "Title",
    "pinFail": "Couldn't pin message",
    "pinnedMsg": "Pinned message",
    "previewFile": "📎 File",
    "previewImage": "📷 Image",
    "previewSystem": "System",
    "publicFeed": "Public feed",
    "quoteLabel": "Replying to",
    "refresh": "Refresh",
    "reject": "Decline",
    "rejectTapp": "Decline",
    "remoteVer": "Shared version",
    "remove": "Remove",
    "removeBtn": "Unpublish",
    "removePeerFail": "Couldn't remove peer",
    "reportAnalysis": "Analysis",
    "reportInsights": "Insights",
    "reportSummary": "Summary",
    "reportUnavailable": "Report details unavailable",
    "ringBrewCategoryAll": "All my categories",
    "ringBrewCategoryLabel": "Brew category (optional)",
    "ringBrewCategoryPlaceholder": "Or type a category name",
    "ringId": "Ring ID",
    "ringIdCopied": "Ring ID copied",
    "ringNamePlaceholder": "Ring name",
    "ringPeersTitle": "Peers",
    "ringType": "Type",
    "ringTypeBrewRecommend": "Brew picks",
    "ringTypeInstanceDirectory": "Instance directory",
    "ringTypeLibraryExchange": "Library exchange",
    "ringTypeTappStore": "Tapp store",
    "roleAdmin": "Admin",
    "roleMember": "Member",
    "roleOwner": "Owner",
    "roomDesc": "Description",
    "roomFilesCount": "{n} items",
    "roomFilesDownload": "Download",
    "roomFilesEmpty": "No files in this group yet",
    "roomFilesEmptyHint": "Share a file or image from the composer (+).",
    "roomFilesFilterAll": "All",
    "roomFilesFilterFile": "Files",
    "roomFilesFilterImage": "Images",
    "roomFilesHint": "Files stay on the sender’s instance. This list is an index from group history.",
    "roomFilesJump": "Show in chat",
    "roomFilesLoadMore": "Load more",
    "roomFilesLoading": "Loading files…",
    "roomFilesMatchCount": "{n} / {total}",
    "roomFilesNeedChat": "Open in chat to download this attachment",
    "roomFilesOnlyRoom": "Group files are only available in rooms",
    "roomFilesOpenInChat": "Open in chat",
    "roomFilesSearch": "Search files…",
    "roomFilesStatusMissing": "Unavailable",
    "roomFilesStatusPending": "Uploading…",
    "roomFilesStatusReady": "Ready",
    "roomFilesTitle": "Group files",
    "roomInviteAccepted": "Joined the group",
    "roomInvitePending": "Accept the invite to chat in this group",
    "roomInviteRejectConfirm": "Decline this group invite?",
    "roomInviteRejected": "Invite declined",
    "roomName": "Group name",
    "roomPlaceholder": "Group name",
    "save": "Save",
    "saveFail": "Couldn't save",
    "saving": "Saving…",
    "searchContacts": "Search contacts…",
    "searchConversations": "Search chats…",
    "searchFeed": "Search feed…",
    "searchForward": "Search chats…",
    "searchMembers": "Search members…",
    "searchNoResults": "No matches",
    "searchPlaceholder": "Search…",
    "searchRings": "Search rings…",
    "selectBrew": "Choose a Brew article",
    "selectHint": "Pick a conversation to start messaging",
    "selectLibrary": "Choose from library",
    "selectReport": "Choose a report",
    "selectRing": "Select a ring to view details",
    "selectTapp": "Choose a Tapp",
    "send": "Send",
    "sendFail": "Couldn't send",
    "shareUntitled": "Untitled",
    "syncBtn": "Sync",
    "syncFail": "Couldn't sync",
    "syncSuccess": "Sync complete",
    "syncing": "Syncing…",
    "tappDirectInstall": "Install package included in share",
    "tappInstallNoPackage": "This shared Tapp is not in the store and no install package was attached. Ask the sender to re-share.",
    "tappInstallNoStoreSource": "Share is missing store catalog URL. Ask the sender to re-share the Tapp from a current Aro build.",
    "tappInstalled": "Installed",
    "tappNotInstalled": "Not installed",
    "tappReceived": "Tapp shared with you",
    "tappShareAccepted": "Accepted",
    "tappSharePending": "Waiting for reply",
    "tappShareRejected": "Declined",
    "tappStoreInstall": "Will install from store catalog",
    "tappUpdateAvail": "Update available",
    "title": "Messages",
    "transferCancelled": "Transfer cancelled",
    "transferComplete": "File sent",
    "transferDownloadFail": "Couldn't download file",
    "transferDownloadOk": "Download started",
    "transferDownloadUnsupported": "Transfer download is not available in this runtime",
    "transferDownloading": "Downloading…",
    "transferFail": "Couldn't upload file",
    "transferFailed": "Transfer failed",
    "transferOwner": "Transfer ownership",
    "transferOwnerConfirm": "Transfer ownership to {name}?",
    "transferOwnerEmpty": "No eligible member to transfer to",
    "transferOwnerFail": "Couldn’t transfer ownership",
    "transferOwnerInvalid": "Invalid choice",
    "transferOwnerOk": "Ownership transferred",
    "transferOwnerPrompt": "Transfer ownership to member number:",
    "transferOwnerUnsupported": "Ownership transfer is not available",
    "transferPreparing": "Waiting for file to finish transferring…",
    "transferProgress": "Uploading… {pct}%",
    "transferReceived": "File received",
    "transferStarting": "Uploading file…",
    "transferStillArriving": "File may still be arriving — trying download…",
    "typing": "Message…",
    "unfollowBtn": "Unfollow",
    "unfollowFail": "Couldn't unfollow",
    "unpublishFail": "Couldn't unpublish",
    "updatingBtn": "Update",
  },
  "ja": {
    "accept": "承認",
    "acceptConfirmDesc": "Tappが共有されました。",
    "acceptConfirmTitle": "このTappをインストールしますか？",
    "acceptFail": "承認に失敗しました",
    "acceptTapp": "承認",
    "activityType": "アクティビティ",
    "addPeerBtn": "ピアを追加",
    "addPeerFail": "ピアの追加に失敗しました",
    "addPeerPlaceholder": "@user@domain またはプロフィールURL",
    "adminRequired": "管理者権限が必要です",
    "alreadyLatest": "最新版です",
    "attach": "添付",
    "attachBrew": "Brew",
    "attachBrewPrompt": "Brew記事のタイトル",
    "attachFile": "ファイル",
    "attachImage": "画像",
    "attachLibrary": "ライブラリ",
    "attachLibraryPrompt": "ライブラリ名",
    "attachReport": "レポート",
    "attachReportPrompt": "レポートのタイトル",
    "attachSending": "送信中…",
    "attachTapp": "Tapp",
    "attachTappPrompt": "Tapp IDまたは名前",
    "back": "戻る",
    "backupBrowse": "閲覧",
    "backupDeleted": "アーカイブを削除しました",
    "backupExportActive": "開いているチャットをエクスポート",
    "backupExportAll": "すべてのチャットをエクスポート",
    "backupExportCount": "{n} 件のメッセージ",
    "backupExportDesc": "この端末のダイレクトメッセージとグループチャットを JSON で保存します。",
    "backupExportFail": "エクスポートに失敗しました",
    "backupExportOk": "エクスポート完了",
    "backupExportProgress": "エクスポート中 {done}/{total}…",
    "backupExportTitle": "履歴をエクスポート",
    "backupExporting": "エクスポート中…",
    "backupGuest": "サインインして履歴をエクスポート／インポートできます。",
    "backupHint": "メッセンジャー履歴をエクスポート／インポート",
    "backupImportBtn": "JSON ファイルを選択",
    "backupImportDesc": "以前エクスポートした JSON を読み込み、オフラインで閲覧できます。サーバーへ再送信はしません。",
    "backupImportFail": "インポートに失敗しました",
    "backupImportFormat": "不明なアーカイブ形式です",
    "backupImportHint": "「インポート済み」から閲覧できます",
    "backupImportOk": "インポートしました",
    "backupImportTitle": "アーカイブをインポート",
    "backupImportedEmpty": "まだインポートがありません。",
    "backupImportedTitle": "インポート済みアーカイブ",
    "backupImporting": "インポート中…",
    "backupIncludeMedia": "画像データを含める（ファイルが大きくなります）",
    "backupNeedConversation": "先にチャットを開いてください",
    "backupPrivacyNote": "エクスポートは端末内に保存されます。大きな画像データは「画像データを含める」をオンにしない限り除外されます。",
    "backupTitle": "チャットバックアップ",
    "channelNotAccepted": "送信前にチャットを承認してください",
    "channelPlaceholder": "@user@domain またはプロフィールURL",
    "channelRejectConfirm": "このメッセージリクエストを辞退しますか？",
    "channelRejected": "リクエストを辞退しました",
    "close": "チャットを閉じる",
    "closeChannelConfirm": "このチャットを閉じますか？閉じると送信できなくなります。",
    "closeChannelFail": "チャットを閉じられませんでした",
    "closed": "終了済み",
    "closedComposer": "このチャットは終了済みです — 送信できません",
    "collapseDetails": "閉じる",
    "composeAddImage": "画像",
    "composeAddVideo": "動画",
    "composeBadMediaUrl": "アップロード先URLが不正です — 公開しません",
    "composeCancel": "キャンセル",
    "composeDeliveryQueued": "{n}人のフォロワーへ配信中",
    "composeDialogTitle": "投稿を作成",
    "composeDraftRestored": "下書きを復元しました",
    "composeDraftTextOnly": "下書きは文字のみ保存されています — 必要ならメディアを再添付してください",
    "composeEmpty": "テキストか画像/動画を追加してください",
    "composeFail": "公開に失敗しました",
    "composeMediaMissingOnFeed": "公開済みですがフィードにメディアが表示されない可能性があります",
    "composePlaceholder": "いまどうしてる？",
    "composePost": "投稿",
    "composePublish": "公開",
    "composePublishing": "公開中…",
    "composeSuccess": "公開しました",
    "composeSuccessMedia": "メディア付きで公開しました",
    "composeTimelineMissing": "公開済みですがタイムラインにまだ出ていません — 再読み込みしてください",
    "composeUploadFail": "メディアのアップロードに失敗しました — 公開しません",
    "composeUploadPartial": "一部のメディアは上がりましたが途中で失敗 — 途中公開はしません",
    "composeUploading": "アップロード中…",
    "composerClosed": "このチャットは終了済みです — 送信できません",
    "confirmCancel": "キャンセル",
    "confirmOk": "OK",
    "connected": "接続中",
    "copied": "コピーしました",
    "copy": "コピー",
    "copyFail": "コピーに失敗しました",
    "create": "新規",
    "createChannel": "チャットを開始",
    "createFail": "作成に失敗しました",
    "createRingBtn": "リングを作成",
    "createRingFail": "リングの作成に失敗しました",
    "createRingTitle": "リングを作成",
    "createRoom": "グループを作成",
    "creating": "作成中…",
    "dateToday": "今日",
    "dateYesterday": "昨日",
    "deliveryDeadBody": "配信できなかった送信メッセージが {n} 件あります",
    "deliveryDeadTitle": "連邦配信に失敗",
    "deliveryNotQueued": "ローカルには保存されましたが、リモートへの配信キューに入れられませんでした",
    "deliveryRetryBody": "{n} 件のメッセージを再配信キューに入れました",
    "deliveryRetryConfirm": "失敗した {n} 件の連合配信を再試行しますか？",
    "deliveryRetryOk": "再試行をキューに追加しました",
    "deliveryWarnBody": "リモート配信が不完全な可能性があります",
    "deliveryWarnTitle": "配信の通知",
    "disconnected": "オフライン",
    "dismiss": "閉じる",
    "dissolve": "グループを解散",
    "dissolveConfirm": "このグループを解散しますか？メンバーはアクセスできなくなり、元に戻せません。",
    "dissolveFail": "解散に失敗しました",
    "dm": "ダイレクトメッセージ",
    "downloadFail": "ファイルをダウンロードできませんでした",
    "downloadFile": "ダウンロード",
    "e2eFail": "暗号鍵を公開できませんでした",
    "e2ePublish": "暗号鍵を公開",
    "e2ePublished": "暗号鍵を公開しました",
    "editRoom": "グループを編集",
    "emptyChatHint": "まだメッセージがありません。あいさつしてみましょう",
    "emptyFollowers": "プロフィールを共有してフォロワーを増やしましょう。",
    "emptyFollowing": "右上の + からハンドルやプロフィールURLでフォローできます。",
    "emptyPeers": "ピアはまだありません。下から追加できます",
    "emptyPublished": "ホームに切り替えて + から投稿できます。",
    "emptyRings": "リングはまだありません。+ から作成できます。",
    "emptyRoomHint": "まだメッセージがありません。会話を始めましょう",
    "emptyTimeline": "フォローや投稿でホームを埋めましょう。",
    "emptyTitleFollowers": "フォロワーはまだいません",
    "emptyTitleFollowing": "まだ誰もフォローしていません",
    "emptyTitlePublished": "公開したコンテンツはありません",
    "emptyTitleTimeline": "投稿はまだありません",
    "expandDetails": "もっと見る",
    "feedBackup": "バックアップ",
    "feedFollowers": "フォロワー",
    "feedFollowing": "フォロー中",
    "feedHintBackup": "メッセンジャー履歴のエクスポート／インポート",
    "feedHintFollowers": "あなたをフォローしている人",
    "feedHintFollowing": "フォロー中のアカウントを管理",
    "feedHintGuest": "このサイトの公開投稿",
    "feedHintPublished": "公開した投稿",
    "feedHintTimeline": "フォロー中の人と自分の投稿",
    "feedItems": "件",
    "feedLoadFail": "フィードを読み込めませんでした",
    "feedLoading": "読み込み中…",
    "feedMetaFollowers": "あなたをフォローしている人",
    "feedMetaFollowing": "フォロー中のアカウントを管理",
    "feedMetaGuest": "このサイトの公開投稿",
    "feedMetaPublished": "公開した投稿",
    "feedMetaTimeline": "フォロー中の人と自分の投稿",
    "feedPlus": "追加",
    "feedPublished": "公開済み",
    "feedRetry": "再試行",
    "feedSubFollowers": "あなたをフォローしている人",
    "feedSubFollowing": "フォロー中のアカウントを管理",
    "feedSubPublished": "公開した投稿",
    "feedSubTimeline": "フォロー中の人と自分の投稿",
    "feedTimeline": "ホーム",
    "fileTooLarge": "ファイルが大きすぎます（最大100MB）",
    "fileTooLargeRoom": "グループチャットでは大きすぎます — 大きいファイルはDMを使ってください",
    "followBtn": "フォロー",
    "followDialogTitle": "フォローする",
    "followFail": "フォローに失敗しました",
    "followPlaceholder": "@user@domain またはプロフィールURL",
    "followQueued": "フォローリクエストを送信しました。多くのインスタンスは自動承認します。",
    "forwardEmpty": "転送できる他の会話がありません",
    "forwardSuccess": "転送しました",
    "forwardTo": "転送先…",
    "forwardTooLarge": "添付が大きすぎて転送できません",
    "forwardTransferOnly": "分割転送の大きなファイルはまだ転送できません。ダウンロードして再送してください",
    "guest": "ゲスト",
    "historyCount": "{n} 件のメッセージ",
    "historyEmpty": "このチャットにはまだメッセージがありません",
    "historyFilterAll": "すべて",
    "historyFilterFile": "ファイル",
    "historyFilterImage": "画像",
    "historyFilterPinned": "ピン留め",
    "historyFilterShare": "共有",
    "historyFilterText": "テキスト",
    "historyJumpMiss": "チャット内でそのメッセージを見つけられませんでした",
    "historyLoadFail": "履歴を読み込めませんでした",
    "historyLoadMore": "さらに古いメッセージ",
    "historyLoading": "履歴を読み込み中…",
    "historyMatchCount": "{n} / {total}",
    "historySearchPlaceholder": "メッセージを検索…",
    "historyTitle": "チャット履歴",
    "installBtn": "インストール",
    "installFailed": "インストールに失敗しました。タップして再試行",
    "installSuccess": "インストール完了",
    "installedAt": "インストール日",
    "installingBtn": "インストール中…",
    "invite": "招待",
    "inviteBtn": "招待",
    "inviteFail": "招待に失敗しました",
    "inviteFromContacts": "連絡先から選ぶ",
    "inviteManual": "アドレスで招待",
    "invitePlaceholder": "@user@domain またはプロフィールURL",
    "inviteSuccess": "招待を送信しました",
    "invited": "招待済み",
    "inviting": "招待中…",
    "joinRoom": "参加",
    "joinRoomFail": "参加に失敗しました",
    "joinRoomOk": "グループに参加しました",
    "kick": "削除",
    "kickConfirm": "このメンバーをグループから削除しますか？",
    "kickFail": "削除に失敗しました",
    "kicked": "グループから削除されました",
    "leave": "グループを退出",
    "leaveBtn": "リングを退出",
    "leaveConfirm": "このグループを退出しますか？再参加には招待が必要です。",
    "leaveFail": "退出に失敗しました",
    "leaveRingConfirm": "このリングから退出しますか？招待があれば再参加できます。",
    "leaveRingFail": "退出に失敗しました",
    "libraryPickerEmpty": "このプラットフォームのライブラリ項目がありません",
    "libraryPickerLoadFail": "ライブラリデータを読み込めませんでした",
    "loadFail": "読み込みに失敗しました",
    "local": "自分",
    "localVer": "インストール済み",
    "manage": "その他",
    "me": "自分",
    "mediaCh": "{c}/{t} 章",
    "mediaChOnly": "{c} 章",
    "mediaEp": "{c}/{t} 話",
    "mediaEpOnly": "{c} 話",
    "mediaHours": "{v} 時間",
    "mediaKind_anime": "アニメ",
    "mediaKind_book": "書籍",
    "mediaKind_game": "ゲーム",
    "mediaKind_music": "音楽",
    "mediaKind_tv_series": "ドラマ",
    "mediaKind_video": "動画",
    "mediaMinutes": "{v} 分",
    "mediaTooLarge": "ファイルが大きすぎます（画像最大10MB、動画最大50MB）",
    "mediaUnsupported": "未対応のファイル形式です",
    "members": "メンバー",
    "msgActions": "メッセージ操作",
    "msgCopy": "コピー",
    "msgForward": "転送",
    "msgPin": "ピン留め",
    "msgQuote": "返信",
    "msgUnpin": "ピン解除",
    "navFeed": "ホーム",
    "navMessages": "メッセージ",
    "navRings": "リング",
    "newChannel": "新規チャット",
    "newMessage": "新しいメッセージ",
    "newRoom": "新規グループ",
    "noContacts": "招待できる連絡先がありません",
    "noConv": "会話はまだありません",
    "noConvHint": "+ からチャットやグループを開始",
    "openJoin": "オープン",
    "openOriginal": "元記事を開く",
    "openTappBtn": "Tappを開く",
    "peers": "ピア",
    "pending": "保留中",
    "pendingConfirm": "確認待ち",
    "pickerCancel": "キャンセル",
    "pickerConfirm": "追加",
    "pickerDesc": "説明（任意）",
    "pickerEmpty": "表示する項目がありません",
    "pickerLoading": "読み込み中…",
    "pickerPickOne": "添付する項目を選択",
    "pickerSearchPlaceholder": "検索…",
    "pickerSelectPlatform": "プラットフォームを選択",
    "pickerTitle": "タイトル",
    "pinFail": "ピン留めに失敗しました",
    "pinnedMsg": "ピン留めメッセージ",
    "previewFile": "📎 ファイル",
    "previewImage": "📷 画像",
    "previewSystem": "システム",
    "publicFeed": "公開フィード",
    "quoteLabel": "返信先",
    "refresh": "更新",
    "reject": "辞退",
    "rejectTapp": "拒否",
    "remoteVer": "共有バージョン",
    "remove": "削除",
    "removeBtn": "公開を取り消す",
    "removePeerFail": "ピアの削除に失敗しました",
    "reportAnalysis": "分析",
    "reportInsights": "インサイト",
    "reportSummary": "概要",
    "reportUnavailable": "レポートの詳細を読み込めません",
    "ringBrewCategoryAll": "すべてのカテゴリ",
    "ringBrewCategoryLabel": "Brewカテゴリ（任意）",
    "ringBrewCategoryPlaceholder": "またはカテゴリ名を入力",
    "ringId": "リングID",
    "ringIdCopied": "リングIDをコピーしました",
    "ringNamePlaceholder": "リング名",
    "ringPeersTitle": "ピア",
    "ringType": "タイプ",
    "ringTypeBrewRecommend": "Brewおすすめ",
    "ringTypeInstanceDirectory": "インスタンス一覧",
    "ringTypeLibraryExchange": "資料交換",
    "ringTypeTappStore": "Tappストア",
    "roleAdmin": "管理者",
    "roleMember": "メンバー",
    "roleOwner": "オーナー",
    "roomDesc": "説明",
    "roomFilesCount": "{n} 件",
    "roomFilesDownload": "ダウンロード",
    "roomFilesEmpty": "このグループにはまだファイルがありません",
    "roomFilesEmptyHint": "入力欄の + からファイルや画像を共有できます。",
    "roomFilesFilterAll": "すべて",
    "roomFilesFilterFile": "ファイル",
    "roomFilesFilterImage": "画像",
    "roomFilesHint": "ファイルは送信元インスタンスに保存されます。一覧はグループ履歴の添付インデックスです。",
    "roomFilesJump": "チャットで表示",
    "roomFilesLoadMore": "さらに読み込む",
    "roomFilesLoading": "ファイルを読み込み中…",
    "roomFilesMatchCount": "{n} / {total}",
    "roomFilesNeedChat": "チャットで開いてからダウンロードしてください",
    "roomFilesOnlyRoom": "グループファイルはルームでのみ利用できます",
    "roomFilesOpenInChat": "チャットで開く",
    "roomFilesSearch": "ファイルを検索…",
    "roomFilesStatusMissing": "利用不可",
    "roomFilesStatusPending": "転送中…",
    "roomFilesStatusReady": "ダウンロード可",
    "roomFilesTitle": "グループファイル",
    "roomInviteAccepted": "グループに参加しました",
    "roomInvitePending": "招待を承認してからメッセージを送れます",
    "roomInviteRejectConfirm": "このグループ招待を辞退しますか？",
    "roomInviteRejected": "招待を辞退しました",
    "roomName": "グループ名",
    "roomPlaceholder": "グループ名",
    "save": "保存",
    "saveFail": "保存に失敗しました",
    "saving": "保存中…",
    "searchContacts": "連絡先を検索…",
    "searchConversations": "チャットを検索…",
    "searchFeed": "フィードを検索…",
    "searchForward": "チャットを検索…",
    "searchMembers": "メンバーを検索…",
    "searchNoResults": "一致する結果がありません",
    "searchPlaceholder": "検索…",
    "searchRings": "リングを検索…",
    "selectBrew": "Brew記事を選択",
    "selectHint": "会話を選んでメッセージを始めましょう",
    "selectLibrary": "ライブラリから選択",
    "selectReport": "レポートを選択",
    "selectRing": "リングを選んで詳細を表示",
    "selectTapp": "Tappを選択",
    "send": "送信",
    "sendFail": "送信に失敗しました",
    "shareUntitled": "無題",
    "syncBtn": "同期",
    "syncFail": "同期に失敗しました",
    "syncSuccess": "同期完了",
    "syncing": "同期中…",
    "tappDirectInstall": "共有にインストールパッケージが含まれています",
    "tappInstallNoPackage": "この Tapp はストアになく、インストールパッケージもありません。送信者に再共有を依頼してください。",
    "tappInstallNoStoreSource": "共有にストアカタログ URL がありません。送信者に最新の Aro から再共有を依頼してください。",
    "tappInstalled": "インストール済み",
    "tappNotInstalled": "未インストール",
    "tappReceived": "Tappが共有されました",
    "tappShareAccepted": "承認済み",
    "tappSharePending": "返信待ち",
    "tappShareRejected": "拒否済み",
    "tappStoreInstall": "ストアカタログからインストールします",
    "tappUpdateAvail": "更新あり",
    "title": "メッセージ",
    "transferCancelled": "転送がキャンセルされました",
    "transferComplete": "ファイルを送信しました",
    "transferDownloadFail": "ファイルをダウンロードできませんでした",
    "transferDownloadOk": "ダウンロードを開始しました",
    "transferDownloadUnsupported": "この環境では転送ダウンロードを利用できません",
    "transferDownloading": "ダウンロード中…",
    "transferFail": "ファイルをアップロードできませんでした",
    "transferFailed": "転送に失敗しました",
    "transferOwner": "オーナーを譲渡",
    "transferOwnerConfirm": "{name} にオーナーを譲渡しますか？",
    "transferOwnerEmpty": "譲渡できるメンバーがいません",
    "transferOwnerFail": "オーナー譲渡に失敗しました",
    "transferOwnerInvalid": "無効な選択です",
    "transferOwnerOk": "オーナーを譲渡しました",
    "transferOwnerPrompt": "譲渡先のメンバー番号：",
    "transferOwnerUnsupported": "オーナー譲渡はこの環境では利用できません",
    "transferPreparing": "ファイルの転送完了を待っています…",
    "transferProgress": "アップロード中… {pct}%",
    "transferReceived": "ファイルを受信しました",
    "transferStarting": "ファイルをアップロード中…",
    "transferStillArriving": "ファイルがまだ届いている可能性があります。ダウンロードを試します…",
    "typing": "メッセージを入力…",
    "unfollowBtn": "フォロー解除",
    "unfollowFail": "フォロー解除に失敗しました",
    "unpublishFail": "公開の取り消しに失敗しました",
    "updatingBtn": "更新",
  },
  "zh": {
    "accept": "接受",
    "acceptConfirmDesc": "有人向你分享了一个 Tapp。",
    "acceptConfirmTitle": "安装此 Tapp？",
    "acceptFail": "接受失败",
    "acceptTapp": "接受",
    "activityType": "动态",
    "addPeerBtn": "添加节点",
    "addPeerFail": "添加节点失败",
    "addPeerPlaceholder": "@用户@域名 或个人主页链接",
    "adminRequired": "需要管理员权限",
    "alreadyLatest": "已是最新版本",
    "attach": "添加附件",
    "attachBrew": "Brew",
    "attachBrewPrompt": "Brew 文章标题",
    "attachFile": "文件",
    "attachImage": "图片",
    "attachLibrary": "资料库",
    "attachLibraryPrompt": "资料库名称",
    "attachReport": "报告",
    "attachReportPrompt": "报告标题",
    "attachSending": "发送中…",
    "attachTapp": "Tapp",
    "attachTappPrompt": "Tapp ID 或名称",
    "back": "返回",
    "backupBrowse": "浏览",
    "backupDeleted": "已删除备份",
    "backupExportActive": "导出当前会话",
    "backupExportAll": "导出全部会话",
    "backupExportCount": "{n} 条消息",
    "backupExportDesc": "将本机私信与群聊导出为 JSON 备份文件。",
    "backupExportFail": "导出失败",
    "backupExportOk": "导出完成",
    "backupExportProgress": "导出中 {done}/{total}…",
    "backupExportTitle": "导出聊天记录",
    "backupExporting": "导出中…",
    "backupGuest": "登录后可导出或导入聊天记录。",
    "backupHint": "导出与导入你的聊天记录",
    "backupImportBtn": "选择 JSON 文件",
    "backupImportDesc": "导入先前导出的 JSON，可离线浏览。不会把消息重新发送到服务器。",
    "backupImportFail": "导入失败",
    "backupImportFormat": "无法识别的备份格式",
    "backupImportHint": "可在「已导入备份」中浏览",
    "backupImportOk": "导入成功",
    "backupImportTitle": "导入备份",
    "backupImportedEmpty": "暂无导入。",
    "backupImportedTitle": "已导入备份",
    "backupImporting": "导入中…",
    "backupIncludeMedia": "包含图片数据（文件更大）",
    "backupNeedConversation": "请先打开一个会话",
    "backupPrivacyNote": "导出文件保存在你的设备上。除非勾选「包含图片数据」，否则会省略体积较大的图片内容。",
    "backupTitle": "聊天备份",
    "channelNotAccepted": "请先接受私信再发送",
    "channelPlaceholder": "@用户@域名 或个人主页链接",
    "channelRejectConfirm": "确定拒绝此私信请求？",
    "channelRejected": "已拒绝请求",
    "close": "关闭会话",
    "closeChannelConfirm": "确定关闭此私信？关闭后将无法继续发送消息。",
    "closeChannelFail": "关闭会话失败",
    "closed": "已关闭",
    "closedComposer": "会话已关闭，无法发送消息",
    "collapseDetails": "收起",
    "composeAddImage": "图片",
    "composeAddVideo": "视频",
    "composeBadMediaUrl": "上传返回的媒体地址无效 — 已取消发布",
    "composeCancel": "取消",
    "composeDeliveryQueued": "正在向 {n} 位关注者投递",
    "composeDialogTitle": "发帖",
    "composeDraftRestored": "已恢复草稿",
    "composeDraftTextOnly": "草稿仅保留文字，请重新添加附件",
    "composeEmpty": "写点文字或添加图片/视频",
    "composeFail": "发布失败",
    "composeMediaMissingOnFeed": "已发布，但动态中可能暂未显示媒体",
    "composePlaceholder": "分享此刻的想法…",
    "composePost": "发帖",
    "composePublish": "发布",
    "composePublishing": "发布中…",
    "composeSuccess": "已发布",
    "composeSuccessMedia": "已发布（含媒体）",
    "composeTimelineMissing": "已发布，但时间线暂未出现 — 请刷新",
    "composeUploadFail": "媒体上传失败 — 未发布",
    "composeUploadPartial": "部分媒体已上传后失败 — 未半发布",
    "composeUploading": "上传中…",
    "composerClosed": "会话已关闭，无法发送消息",
    "confirmCancel": "取消",
    "confirmOk": "确定",
    "connected": "已连接",
    "copied": "已复制",
    "copy": "复制",
    "copyFail": "复制失败",
    "create": "新建",
    "createChannel": "开始私信",
    "createFail": "创建失败",
    "createRingBtn": "创建环网",
    "createRingFail": "创建环网失败",
    "createRingTitle": "创建环网",
    "createRoom": "创建群聊",
    "creating": "创建中…",
    "dateToday": "今天",
    "dateYesterday": "昨天",
    "deliveryDeadBody": "有 {n} 条联邦出站消息无法投递",
    "deliveryDeadTitle": "联邦投递失败",
    "deliveryNotQueued": "已保存在本机，但未能加入远程投递队列",
    "deliveryRetryBody": "已将 {n} 条消息重新加入投递队列",
    "deliveryRetryConfirm": "重试 {n} 条失败的联邦投递？",
    "deliveryRetryOk": "已重新排队",
    "deliveryWarnBody": "远程投递可能不完整",
    "deliveryWarnTitle": "投递提示",
    "disconnected": "未连接",
    "dismiss": "关闭",
    "dissolve": "解散群组",
    "dissolveConfirm": "确定解散此群组？所有成员将失去访问权限，且无法撤销。",
    "dissolveFail": "解散失败",
    "dm": "私信",
    "downloadFail": "无法下载文件",
    "downloadFile": "下载",
    "e2eFail": "无法发布加密密钥",
    "e2ePublish": "发布加密密钥",
    "e2ePublished": "已发布加密密钥",
    "editRoom": "编辑群聊",
    "emptyChatHint": "还没有消息，打个招呼吧",
    "emptyFollowers": "分享你的个人主页，让别人关注你。",
    "emptyFollowing": "点右上角 +，用 handle 或个人主页链接关注别人。",
    "emptyPeers": "暂无节点，可在下方添加",
    "emptyPublished": "切到首页，点 + 发帖即可发布。",
    "emptyRings": "暂无环网，点 + 创建一个吧。",
    "emptyRoomHint": "还没有消息，开始群聊吧",
    "emptyTimeline": "关注别人或发帖，首页就会亮起来。",
    "emptyTitleFollowers": "还没有粉丝",
    "emptyTitleFollowing": "还没有关注任何人",
    "emptyTitlePublished": "还没有发布内容",
    "emptyTitleTimeline": "还没有动态",
    "expandDetails": "展开",
    "feedBackup": "备份",
    "feedFollowers": "粉丝",
    "feedFollowing": "关注",
    "feedHintBackup": "导出与导入聊天记录",
    "feedHintFollowers": "关注你的人",
    "feedHintFollowing": "管理你关注的人",
    "feedHintGuest": "本站的公开动态",
    "feedHintPublished": "你发布的内容",
    "feedHintTimeline": "关注的人与你的动态",
    "feedItems": "条",
    "feedLoadFail": "动态加载失败",
    "feedLoading": "加载中…",
    "feedMetaFollowers": "关注你的人",
    "feedMetaFollowing": "管理你关注的人",
    "feedMetaGuest": "本站的公开动态",
    "feedMetaPublished": "你发布的内容",
    "feedMetaTimeline": "关注的人与你的动态",
    "feedPlus": "添加",
    "feedPublished": "已发布",
    "feedRetry": "重试",
    "feedSubFollowers": "关注你的人",
    "feedSubFollowing": "管理你关注的人",
    "feedSubPublished": "你发布的内容",
    "feedSubTimeline": "关注的人与你的动态",
    "feedTimeline": "首页",
    "fileTooLarge": "文件过大（最大 100 MB）",
    "fileTooLargeRoom": "群聊不支持大文件 — 请通过私信发送",
    "followBtn": "关注",
    "followDialogTitle": "关注用户",
    "followFail": "关注失败",
    "followPlaceholder": "@用户@域名 或个人主页链接",
    "followQueued": "关注请求已发送，对方实例通常会自动接受。",
    "forwardEmpty": "没有可转发的其他会话",
    "forwardSuccess": "已转发",
    "forwardTo": "转发到…",
    "forwardTooLarge": "附件过大，无法直接转发",
    "forwardTransferOnly": "分块大文件暂不支持转发，请下载后重新发送",
    "guest": "访客",
    "historyCount": "{n} 条消息",
    "historyEmpty": "此会话还没有消息",
    "historyFilterAll": "全部",
    "historyFilterFile": "文件",
    "historyFilterImage": "图片",
    "historyFilterPinned": "置顶",
    "historyFilterShare": "分享",
    "historyFilterText": "文字",
    "historyJumpMiss": "无法在当前会话中定位该消息",
    "historyLoadFail": "无法加载聊天记录",
    "historyLoadMore": "加载更早消息",
    "historyLoading": "加载记录中…",
    "historyMatchCount": "{n} / {total}",
    "historySearchPlaceholder": "搜索消息…",
    "historyTitle": "聊天记录",
    "installBtn": "安装",
    "installFailed": "安装失败，点击重试",
    "installSuccess": "安装成功",
    "installedAt": "安装时间",
    "installingBtn": "安装中…",
    "invite": "邀请",
    "inviteBtn": "邀请",
    "inviteFail": "邀请失败",
    "inviteFromContacts": "从联系人选择",
    "inviteManual": "通过地址邀请",
    "invitePlaceholder": "@用户@域名 或个人主页链接",
    "inviteSuccess": "邀请已发送",
    "invited": "已邀请",
    "inviting": "邀请中…",
    "joinRoom": "加入",
    "joinRoomFail": "加入失败",
    "joinRoomOk": "已加入群组",
    "kick": "移除",
    "kickConfirm": "确定将此成员移出群聊？",
    "kickFail": "移除失败",
    "kicked": "你已被移出群聊",
    "leave": "退出群聊",
    "leaveBtn": "退出环网",
    "leaveConfirm": "确定离开此群组？如需重新加入需再次邀请。",
    "leaveFail": "离开失败",
    "leaveRingConfirm": "确定退出此环网？之后若获邀可再加入。",
    "leaveRingFail": "退出失败",
    "libraryPickerEmpty": "该平台资料库暂无内容",
    "libraryPickerLoadFail": "无法加载资料库数据",
    "loadFail": "加载失败",
    "local": "我",
    "localVer": "已安装",
    "manage": "更多",
    "me": "我",
    "mediaCh": "{c}/{t} 章",
    "mediaChOnly": "第 {c} 章",
    "mediaEp": "{c}/{t} 话",
    "mediaEpOnly": "第 {c} 话",
    "mediaHours": "{v} 小时",
    "mediaKind_anime": "番剧",
    "mediaKind_book": "书籍",
    "mediaKind_game": "游戏",
    "mediaKind_music": "音乐",
    "mediaKind_tv_series": "剧集",
    "mediaKind_video": "视频",
    "mediaMinutes": "{v} 分钟",
    "mediaTooLarge": "文件过大（图片最大 10 MB，视频最大 50 MB）",
    "mediaUnsupported": "不支持的文件类型",
    "members": "成员",
    "msgActions": "消息操作",
    "msgCopy": "复制",
    "msgForward": "转发",
    "msgPin": "置顶",
    "msgQuote": "回复",
    "msgUnpin": "取消置顶",
    "navFeed": "首页",
    "navMessages": "消息",
    "navRings": "环网",
    "newChannel": "新建私信",
    "newMessage": "新消息",
    "newRoom": "新建群聊",
    "noContacts": "暂无可邀请的联系人",
    "noConv": "暂无会话",
    "noConvHint": "点 + 开始私信或群聊",
    "openJoin": "开放",
    "openOriginal": "查看原文",
    "openTappBtn": "打开 Tapp",
    "peers": "节点",
    "pending": "待处理",
    "pendingConfirm": "等待确认",
    "pickerCancel": "取消",
    "pickerConfirm": "添加",
    "pickerDesc": "描述（可选）",
    "pickerEmpty": "暂无内容",
    "pickerLoading": "加载中…",
    "pickerPickOne": "选择一项添加到消息",
    "pickerSearchPlaceholder": "搜索…",
    "pickerSelectPlatform": "选择平台",
    "pickerTitle": "标题",
    "pinFail": "置顶失败",
    "pinnedMsg": "置顶消息",
    "previewFile": "📎 文件",
    "previewImage": "📷 图片",
    "previewSystem": "系统",
    "publicFeed": "公开动态",
    "quoteLabel": "回复",
    "refresh": "刷新",
    "reject": "拒绝",
    "rejectTapp": "拒绝",
    "remoteVer": "分享版本",
    "remove": "移除",
    "removeBtn": "取消发布",
    "removePeerFail": "移除节点失败",
    "reportAnalysis": "综合分析",
    "reportInsights": "洞察",
    "reportSummary": "摘要",
    "reportUnavailable": "无法加载报告详情",
    "ringBrewCategoryAll": "我的全部分类",
    "ringBrewCategoryLabel": "Brew 分类（可选）",
    "ringBrewCategoryPlaceholder": "或输入分类名称",
    "ringId": "环网 ID",
    "ringIdCopied": "已复制环网 ID",
    "ringNamePlaceholder": "环网名称",
    "ringPeersTitle": "节点",
    "ringType": "类型",
    "ringTypeBrewRecommend": "Brew 推荐",
    "ringTypeInstanceDirectory": "实例目录",
    "ringTypeLibraryExchange": "资料交换",
    "ringTypeTappStore": "Tapp 商店",
    "roleAdmin": "管理员",
    "roleMember": "成员",
    "roleOwner": "群主",
    "roomDesc": "群聊描述",
    "roomFilesCount": "{n} 项",
    "roomFilesDownload": "下载",
    "roomFilesEmpty": "此群还没有文件",
    "roomFilesEmptyHint": "在输入框点 + 发送文件或图片。",
    "roomFilesFilterAll": "全部",
    "roomFilesFilterFile": "文件",
    "roomFilesFilterImage": "图片",
    "roomFilesHint": "文件保存在发送方实例。此列表是群聊历史中的附件索引。",
    "roomFilesJump": "在聊天中定位",
    "roomFilesLoadMore": "加载更多",
    "roomFilesLoading": "加载文件中…",
    "roomFilesMatchCount": "{n} / {total}",
    "roomFilesNeedChat": "请在聊天中打开后下载",
    "roomFilesOnlyRoom": "群文件仅在群聊中可用",
    "roomFilesOpenInChat": "在聊天中打开",
    "roomFilesSearch": "搜索文件名…",
    "roomFilesStatusMissing": "不可用",
    "roomFilesStatusPending": "传输中…",
    "roomFilesStatusReady": "可下载",
    "roomFilesTitle": "群文件",
    "roomInviteAccepted": "已加入群组",
    "roomInvitePending": "请先接受邀请后再发言",
    "roomInviteRejectConfirm": "确定拒绝此群组邀请？",
    "roomInviteRejected": "已拒绝邀请",
    "roomName": "群聊名称",
    "roomPlaceholder": "群聊名称",
    "save": "保存",
    "saveFail": "保存失败",
    "saving": "保存中…",
    "searchContacts": "搜索联系人…",
    "searchConversations": "搜索会话…",
    "searchFeed": "搜索动态…",
    "searchForward": "搜索会话…",
    "searchMembers": "搜索成员…",
    "searchNoResults": "无匹配结果",
    "searchPlaceholder": "搜索…",
    "searchRings": "搜索环网…",
    "selectBrew": "选择 Brew 文章",
    "selectHint": "选择一个会话开始聊天",
    "selectLibrary": "从资料库选择",
    "selectReport": "选择报告",
    "selectRing": "选择一个环网查看详情",
    "selectTapp": "选择 Tapp",
    "send": "发送",
    "sendFail": "发送失败",
    "shareUntitled": "未命名",
    "syncBtn": "同步",
    "syncFail": "同步失败",
    "syncSuccess": "同步完成",
    "syncing": "同步中…",
    "tappDirectInstall": "分享中已包含可安装包",
    "tappInstallNoPackage": "该 Tapp 不在商店中，且分享未附带安装包。请让对方重新分享。",
    "tappInstallNoStoreSource": "分享缺少商店目录 URL。请让对方用最新版 Aro 重新分享。",
    "tappInstalled": "已安装",
    "tappNotInstalled": "未安装",
    "tappReceived": "收到 Tapp 分享",
    "tappShareAccepted": "已接受",
    "tappSharePending": "等待对方回复",
    "tappShareRejected": "已拒绝",
    "tappStoreInstall": "将从商店目录安装",
    "tappUpdateAvail": "有可用更新",
    "title": "消息",
    "transferCancelled": "传输已取消",
    "transferComplete": "文件已发送",
    "transferDownloadFail": "无法下载文件",
    "transferDownloadOk": "已开始下载",
    "transferDownloadUnsupported": "当前运行环境不支持分块文件下载",
    "transferDownloading": "下载中…",
    "transferFail": "上传文件失败",
    "transferFailed": "传输失败",
    "transferOwner": "转让群主",
    "transferOwnerConfirm": "将群主转让给 {name}？",
    "transferOwnerEmpty": "没有可转让的成员",
    "transferOwnerFail": "转让群主失败",
    "transferOwnerInvalid": "无效选择",
    "transferOwnerOk": "已转让群主",
    "transferOwnerPrompt": "转让给第几位成员：",
    "transferOwnerUnsupported": "当前环境不支持转让群主",
    "transferPreparing": "等待文件传输完成…",
    "transferProgress": "上传中… {pct}%",
    "transferReceived": "文件已接收",
    "transferStarting": "正在上传文件…",
    "transferStillArriving": "文件可能仍在到达，正在尝试下载…",
    "typing": "输入消息…",
    "unfollowBtn": "取消关注",
    "unfollowFail": "取消关注失败",
    "unpublishFail": "取消发布失败",
    "updatingBtn": "更新",
  },
}

// ==================== Page Modules ====================
const PAGE_MOD_I18N = `\
// i18n — loads from sandbox-injected window._TAPP_I18N
var LANG = window._TAPP_I18N || {};
var lang = LANG.zh || {};
var currentLocale = 'zh';

function setLocale(locale) {
  currentLocale = locale || 'zh';
  var key = currentLocale.startsWith('zh') ? 'zh' : currentLocale.startsWith('ja') ? 'ja' : 'en';
  lang = LANG[key] || LANG.en || {};
}
`

const PAGE_MOD_STATE = `\
// ==================== State ====================
var state = {
  channels: [],
  rooms: [],
  activeKind: null,
  activeId: null,
  messages: [],
  messagesFp: '',
  /** Skip bubble appear animation on next renderMessages (e.g. open chat). */
  skipMsgAppear: false,
  members: [],
  channelDetail: null,
  roomDetail: null,
  /** Sticky error when openConversation fails (shown instead of empty-chat copy). */
  chatLoadError: null,
  sending: false,
  pollTimer: null,
  pollInterval: 15000,
  /** 新消息应用内 Toast（设置项 notifyOnMessage） */
  notifyOnMessage: true,
  /** Active realtime WS subscription (channel|room) */
  subscribedKind: null,
  subscribedId: null,
  realtimeBound: false,
  localActorUrl: null,
  identity: null,
  userRole: 'guest',
  isGuest: true,
  isAdmin: false,
  // Attachment
  pendingAttach: null, // { type, file?, data?, name, size, mime, ... }
  // Aro views
  currentView: 'feed',
  // Feed (merged timeline + profile)
  feedSubTab: 'timeline',
  feedLoading: false,
  feedError: null,
  feedLoaded: {
    timeline: false,
    following: false,
    followers: false,
    published: false,
    backup: false,
  },
  timeline: [],
  following: [],
  followers: [],
  published: [],
  // Rings
  rings: [],
  // Ring detail
  activeRingId: null,
  ringDetail: null,
  ringPeers: [],
  // Tapp accept/reject state map
  tappAcceptMap: {},
  // Quote reply
  quoteMsg: null,
  // Client-side list search queries (not sent to server)
  search: {
    conv: '',
    ring: '',
    feed: '',
    member: '',
    invite: '',
  },
  /**
   * Chat history browser (separate from live window).
   * messages: ASC by created_at (same as main chat).
   */
  history: {
    open: false,
    kind: null,
    id: null,
    messages: [],
    query: '',
    filter: 'all', // all | text | image | file | share | pinned
    loading: false,
    loadingMore: false,
    hasMore: false,
    error: null,
    /** Prevent concurrent load-older for main chat scroll. */
    mainLoadingOlder: false,
  },
  /**
   * Room files panel (group only).
   * Prefer server listRoomFiles; fallback client scan of messages + transfers.
   */
  roomFiles: {
    open: false,
    roomId: null,
    items: [],
    query: '',
    filter: 'all', // all | image | file
    loading: false,
    loadingMore: false,
    hasMore: false,
    error: null,
    /** message_id cursor for older pages */
    oldestMessageId: null,
    /** 'server' | 'client' */
    source: 'client',
    searchTimer: null,
  },
};

var $ = function (id) { return document.getElementById(id); };

/**
 * Brand logos for share-card icons, keyed by platform slug.
 * Mirrors the host's PlatformIcon.tsx mapping (same react-icons glyphs) so a
 * shared report/library item shows the same logo the rest of Myriad shows.
 */
var PLATFORM_LOGOS = {
  github: '<svg viewBox="0 0 496 512" width="1em" height="1em" fill="currentColor"><path d="M165.9 397.4c0 2-2.3 3.6-5.2 3.6-3.3.3-5.6-1.3-5.6-3.6 0-2 2.3-3.6 5.2-3.6 3-.3 5.6 1.3 5.6 3.6zm-31.1-4.5c-.7 2 1.3 4.3 4.3 4.9 2.6 1 5.6 0 6.2-2s-1.3-4.3-4.3-5.2c-2.6-.7-5.5.3-6.2 2.3zm44.2-1.7c-2.9.7-4.9 2.6-4.6 4.9.3 2 2.9 3.3 5.9 2.6 2.9-.7 4.9-2.6 4.6-4.6-.3-1.9-3-3.2-5.9-2.9zM244.8 8C106.1 8 0 113.3 0 252c0 110.9 69.8 205.8 169.5 239.2 12.8 2.3 17.3-5.6 17.3-12.1 0-6.2-.3-40.4-.3-61.4 0 0-70 15-84.7-29.8 0 0-11.4-29.1-27.8-36.6 0 0-22.9-15.7 1.6-15.4 0 0 24.9 2 38.6 25.8 21.9 38.6 58.6 27.5 72.9 20.9 2.3-16 8.8-27.1 16-33.7-55.9-6.2-112.3-14.3-112.3-110.5 0-27.5 7.6-41.3 23.6-58.9-2.6-6.5-11.1-33.3 2.6-67.9 20.9-6.5 69 27 69 27 20-5.6 41.5-8.5 62.8-8.5s42.8 2.9 62.8 8.5c0 0 48.1-33.6 69-27 13.7 34.7 5.2 61.4 2.6 67.9 16 17.7 25.8 31.5 25.8 58.9 0 96.5-58.9 104.2-114.8 110.5 9.2 7.9 17 22.9 17 46.4 0 33.7-.3 75.4-.3 83.6 0 6.5 4.6 14.4 17.3 12.1C428.2 457.8 496 362.9 496 252 496 113.3 383.5 8 244.8 8zM97.2 352.9c-1.3 1-1 3.3.7 5.2 1.6 1.6 3.9 2.3 5.2 1 1.3-1 1-3.3-.7-5.2-1.6-1.6-3.9-2.3-5.2-1zm-10.8-8.1c-.7 1.3.3 2.9 2.3 3.9 1.6 1 3.6.7 4.3-.7.7-1.3-.3-2.9-2.3-3.9-2-.6-3.6-.3-4.3.7zm32.4 35.6c-1.6 1.3-1 4.3 1.3 6.2 2.3 2.3 5.2 2.6 6.5 1 1.3-1.3.7-4.3-1.3-6.2-2.2-2.3-5.2-2.6-6.5-1zm-11.4-14.7c-1.6 1-1.6 3.6 0 5.9 1.6 2.3 4.3 3.3 5.6 2.3 1.6-1.3 1.6-3.9 0-6.2-1.4-2.3-4-3.3-5.6-2z"/></svg>',
  steam: '<svg viewBox="0 0 496 512" width="1em" height="1em" fill="currentColor"><path d="M496 256c0 137-111.2 248-248.4 248-113.8 0-209.6-76.3-239-180.4l95.2 39.3c6.4 32.1 34.9 56.4 68.9 56.4 39.2 0 71.9-32.4 70.2-73.5l84.5-60.2c52.1 1.3 95.8-40.9 95.8-93.5 0-51.6-42-93.5-93.7-93.5s-93.7 42-93.7 93.5v1.2L176.6 279c-15.5-.9-30.7 3.4-43.5 12.1L0 236.1C10.2 108.4 117.1 8 247.6 8 384.8 8 496 119 496 256zM155.7 384.3l-30.5-12.6a52.79 52.79 0 0 0 27.2 25.8c26.9 11.2 57.8-1.6 69-28.4 5.4-13 5.5-27.3.1-40.3-5.4-13-15.5-23.2-28.5-28.6-12.9-5.4-26.7-5.2-38.9-.6l31.5 13c19.8 8.2 29.2 30.9 20.9 50.7-8.3 19.9-31 29.2-50.8 21zm173.8-129.9c-34.4 0-62.4-28-62.4-62.3s28-62.3 62.4-62.3 62.4 28 62.4 62.3-27.9 62.3-62.4 62.3zm.1-15.6c25.9 0 46.9-21 46.9-46.8 0-25.9-21-46.8-46.9-46.8s-46.9 21-46.9 46.8c.1 25.8 21.1 46.8 46.9 46.8z"/></svg>',
  xbox: '<svg viewBox="0 0 512 512" width="1em" height="1em" fill="currentColor"><path d="M369.9 318.2c44.3 54.3 64.7 98.8 54.4 118.7-7.9 15.1-56.7 44.6-92.6 55.9-29.6 9.3-68.4 13.3-100.4 10.2-38.2-3.7-76.9-17.4-110.1-39C93.3 445.8 87 438.3 87 423.4c0-29.9 32.9-82.3 89.2-142.1 32-33.9 76.5-73.7 81.4-72.6 9.4 2.1 84.3 75.1 112.3 109.5zM188.6 143.8c-29.7-26.9-58.1-53.9-86.4-63.4-15.2-5.1-16.3-4.8-28.7 8.1-29.2 30.4-53.5 79.7-60.3 122.4-5.4 34.2-6.1 43.8-4.2 60.5 5.6 50.5 17.3 85.4 40.5 120.9 9.5 14.6 12.1 17.3 9.3 9.9-4.2-11-.3-37.5 9.5-64 14.3-39 53.9-112.9 120.3-194.4zm311.6 63.5C483.3 127.3 432.7 77 425.6 77c-7.3 0-24.2 6.5-36 13.9-23.3 14.5-41 31.4-64.3 52.8C367.7 197 427.5 283.1 448.2 346c6.8 20.7 9.7 41.1 7.4 52.3-1.7 8.5-1.7 8.5 1.4 4.6 6.1-7.7 19.9-31.3 25.4-43.5 7.4-16.2 15-40.2 18.6-58.7 4.3-22.5 3.9-70.8-.8-93.4zM141.3 43C189 40.5 251 77.5 255.6 78.4c.7.1 10.4-4.2 21.6-9.7 63.9-31.1 94-25.8 107.4-25.2-63.9-39.3-152.7-50-233.9-11.7-23.4 11.1-24 11.9-9.4 11.2z"/></svg>',
  bilibili: '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor"><path d="M17.813 4.653h.854c1.51.054 2.769.578 3.773 1.574 1.004.995 1.524 2.249 1.56 3.76v7.36c-.036 1.51-.556 2.769-1.56 3.773s-2.262 1.524-3.773 1.56H5.333c-1.51-.036-2.769-.556-3.773-1.56S.036 18.858 0 17.347v-7.36c.036-1.511.556-2.765 1.56-3.76 1.004-.996 2.262-1.52 3.773-1.574h.774l-1.174-1.12a1.234 1.234 0 0 1-.373-.906c0-.356.124-.658.373-.907l.027-.027c.267-.249.573-.373.92-.373.347 0 .653.124.92.373L9.653 4.44c.071.071.134.142.187.213h4.267a.836.836 0 0 1 .16-.213l2.853-2.747c.267-.249.573-.373.92-.373.347 0 .662.151.929.4.267.249.391.551.391.907 0 .355-.124.657-.373.906zM5.333 7.24c-.746.018-1.373.276-1.88.773-.506.498-.769 1.13-.786 1.894v7.52c.017.764.28 1.395.786 1.893.507.498 1.134.756 1.88.773h13.334c.746-.017 1.373-.275 1.88-.773.506-.498.769-1.129.786-1.893v-7.52c-.017-.765-.28-1.396-.786-1.894-.507-.497-1.134-.755-1.88-.773zM8 11.107c.373 0 .684.124.933.373.25.249.383.569.4.96v1.173c-.017.391-.15.711-.4.96-.249.25-.56.374-.933.374s-.684-.125-.933-.374c-.25-.249-.383-.569-.4-.96V12.44c0-.373.129-.689.386-.947.258-.257.574-.386.947-.386zm8 0c.373 0 .684.124.933.373.25.249.383.569.4.96v1.173c-.017.391-.15.711-.4.96-.249.25-.56.374-.933.374s-.684-.125-.933-.374c-.25-.249-.383-.569-.4-.96V12.44c.017-.391.15-.711.4-.96.249-.249.56-.373.933-.373Z"/></svg>',
  discord: '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor"><path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"/></svg>',
  mal: '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor"><path d="M14.921 6.479c-.82 0-3.683 0-4.947 3.156-.662 1.652-.986 4.812.876 7.886l1.934-1.41s-.767-1.095-1.083-3.191h2.897l.022 3.19h2.604V8.835h-2.581v2.043l-2.46-.023s.413-2.408 2.877-2.336h2.454l-.572-2.04ZM0 6.528v9.624h2.348v-5.84l2.031 2.664 2.047-2.652v5.828h2.336V6.528H6.437L4.368 9.474 2.31 6.528Zm18.447.022v9.583h5.022L24 14.09h-3.232V6.55Z"/></svg>',
  netease: '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor"><path d="M13.046 9.388a3.919 3.919 0 0 0-.66.19c-.809.312-1.447.991-1.666 1.775a2.269 2.269 0 0 0-.074.81c.048.546.333 1.05.764 1.35a1.483 1.483 0 0 0 2.01-.286c.406-.531.355-1.183.24-1.636-.098-.387-.22-.816-.345-1.249a64.76 64.76 0 0 1-.269-.954zm-.82 10.07c-3.984 0-7.224-3.24-7.224-7.223 0-.98.226-3.02 1.884-4.822A7.188 7.188 0 0 1 9.502 5.6a.792.792 0 1 1 .587 1.472 5.619 5.619 0 0 0-2.795 2.462 5.538 5.538 0 0 0-.707 2.7 5.645 5.645 0 0 0 5.638 5.638c1.844 0 3.627-.953 4.542-2.428 1.042-1.68.772-3.931-.627-5.238a3.299 3.299 0 0 0-1.437-.777c.172.589.334 1.18.494 1.772.284 1.12.1 2.181-.519 2.989-.39.51-.956.888-1.592 1.064a3.038 3.038 0 0 1-2.58-.44 3.45 3.45 0 0 1-1.44-2.514c-.04-.467.002-.93.128-1.376.35-1.256 1.356-2.339 2.622-2.826a5.5 5.5 0 0 1 .823-.246l-.134-.505c-.37-1.371.25-2.579 1.547-3.007.329-.109.68-.145 1.025-.105.792.09 1.476.592 1.709 1.023.258.507-.096 1.153-.706 1.153a.788.788 0 0 1-.54-.213c-.088-.08-.163-.174-.259-.247a.825.825 0 0 0-.632-.166.807.807 0 0 0-.634.551c-.056.191-.031.406.02.595.07.256.159.597.217.82 1.11.098 2.162.54 2.97 1.296 1.974 1.844 2.35 4.886.892 7.233-1.197 1.93-3.509 3.177-5.889 3.177zM0 12c0 6.627 5.373 12 12 12s12-5.373 12-12S18.627 0 12 0 0 5.373 0 12Z"/></svg>',
  psn: '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor"><path d="M8.984 2.596v17.547l3.915 1.261V6.688c0-.69.304-1.151.794-.991.636.18.76.814.76 1.505v5.875c2.441 1.193 4.362-.002 4.362-3.152 0-3.237-1.126-4.675-4.438-5.827-1.307-.448-3.728-1.186-5.39-1.502zm4.656 16.241l6.296-2.275c.715-.258.826-.625.246-.818-.586-.192-1.637-.139-2.357.123l-4.205 1.5V14.98l.24-.085s1.201-.42 2.913-.615c1.696-.18 3.785.03 5.437.661 1.848.601 2.04 1.472 1.576 2.072-.465.6-1.622 1.036-1.622 1.036l-8.544 3.107V18.86zM1.807 18.6c-1.9-.545-2.214-1.668-1.352-2.32.801-.586 2.16-1.052 2.16-1.052l5.615-2.013v2.313L4.205 17c-.705.271-.825.632-.239.826.586.195 1.637.15 2.343-.12L8.247 17v2.074c-.12.03-.256.044-.39.073-1.939.331-3.996.196-6.038-.479z"/></svg>',
  x: '<svg viewBox="0 0 512 512" width="1em" height="1em" fill="currentColor"><path d="M389.2 48h70.6L305.6 224.2 487 464H345L233.7 318.6 106.5 464H35.8L200.7 275.5 26.8 48H172.4L272.9 180.9 389.2 48zM364.4 421.8h39.1L151.1 88h-42L364.4 421.8z"/></svg>',
  bangumi: '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M8.55 6.75 5.95 2.25" stroke-width="2.15"/><path d="M15.45 6.75 18.05 2.25" stroke-width="2.15"/><path d="M4.25 6.85h15.5A2.95 2.95 0 0 1 22.7 9.8v7.25A2.95 2.95 0 0 1 19.75 20H11.35L6.8 23.05 7.85 20h-3.6a2.95 2.95 0 0 1-2.95-2.95V9.8a2.95 2.95 0 0 1 2.95-2.95Z" stroke-width="2.05"/><path d="m5.6 11.35 3.35 1.35-3.35 1.35" stroke-width="1.45"/><path d="m18.4 11.35-3.35 1.35 3.35 1.35" stroke-width="1.45"/><path d="M9.75 13.2h4.5L12 16.95Z" stroke-width="1.35"/></svg>',
};

/** Slug aliases, mirroring PlatformIcon.tsx's switch cases. */
var PLATFORM_LOGO_ALIASES = {
  twitter: 'x', 'x (twitter)': 'x',
  myanimelist: 'mal',
  playstation: 'psn',
  'netease music': 'netease', '\\u7f51\\u6613\\u4e91\\u97f3\\u4e50': 'netease',
};

/**
 * Official brand colors as "r,g,b" (consumed via rgba(var(--acc),a)).
 * \`d\` is the dark-theme variant, only set where the light value would vanish
 * against a dark card (GitHub / X are near-black) or read too muddy.
 */
var PLATFORM_COLORS = {
  github: { l: '24,23,23', d: '230,237,243' },
  x: { l: '0,0,0', d: '255,255,255' },
  // Steam's dark-theme mark is its light grey-blue (#C7D5E0), not the store's
  // link blue (#66C0F4) — the latter reads as a generic cyan, not as Steam.
  steam: { l: '27,40,56', d: '199,213,224' },
  bilibili: { l: '0,174,236' },
  netease: { l: '194,12,12', d: '233,68,68' },
  bangumi: { l: '240,145,153' },
  mal: { l: '46,81,162', d: '110,145,225' },
  discord: { l: '88,101,242' },
  xbox: { l: '16,124,16', d: '58,181,58' },
  psn: { l: '0,55,145', d: '0,112,209' },
};

/** Normalize a platform slug/name through the alias table. */
function platformKey(slug) {
  if (!slug) return '';
  var key = String(slug).trim().toLowerCase();
  return PLATFORM_LOGO_ALIASES[key] || key;
}

/** Resolve a platform slug/name to inline brand SVG, or '' when unknown. */
function platformLogoSvg(slug) {
  var key = platformKey(slug);
  return (key && PLATFORM_LOGOS[key]) || '';
}

/**
 * Brand accent for a platform as { l, d } rgb triples, or null when unknown.
 * Callers fall back to the message-type accent.
 */
function platformAccent(slug) {
  var key = platformKey(slug);
  var c = key && PLATFORM_COLORS[key];
  if (!c) return null;
  return { l: c.l, d: c.d || c.l };
}


// SVG icon constants (replacing emoji for consistency)
var SVG_ICONS = {
  tapp: '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/></svg>',
  brew: '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 8h1a4 4 0 010 8h-1"/><path d="M3 8h14v9a4 4 0 01-4 4H7a4 4 0 01-4-4V8z"/><path d="M6 2v3M10 2v3M14 2v3"/></svg>',
  library: '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>',
  report: '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>',
  file: '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>',
  channel: '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>',
  room: '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>',
  memo: '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
  page: '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>',
  coffee: '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8h1a4 4 0 010 8h-1M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z"/><path d="M6 1v3M10 1v3M14 1v3"/></svg>',
  puzzle: '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 01-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 10-3.214 3.214c.446.166.855.497.925.968a.979.979 0 01-.276.837l-1.61 1.61a2.404 2.404 0 01-1.705.707 2.402 2.402 0 01-1.704-.706l-1.568-1.568a1.026 1.026 0 00-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 11-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 00-.289-.877l-1.568-1.568A2.41 2.41 0 011.998 12c0-.617.236-1.234.706-1.704L4.315 8.685a.98.98 0 01.837-.276c.47.07.802.48.968.925a2.501 2.501 0 103.214-3.214c-.446-.166-.855-.497-.925-.968a.979.979 0 01.276-.837l1.61-1.61a2.404 2.404 0 011.705-.707c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.968a2.5 2.5 0 113.237 3.237c-.464.18-.894.527-.967 1.02z"/></svg>',
  globe: '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>',
  ring: '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M0 15L24 9"/></svg>',
  star: '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" stroke="currentColor" stroke-width="1"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14l-5-4.87 6.91-1.01L12 2z"/></svg>',
  gamepad: '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="12" x2="10" y2="12"/><line x1="8" y1="10" x2="8" y2="14"/><line x1="15" y1="13" x2="15.01" y2="13"/><line x1="18" y1="11" x2="18.01" y2="11"/><rect x="2" y="6" width="20" height="12" rx="2"/></svg>',
  playCircle: '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M10 8.5l5.5 3.5-5.5 3.5v-7z" fill="currentColor" stroke="none"/></svg>',
  mail: '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 4L12 13 2 4"/></svg>',
  antenna: '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.9 19.1l2.8-2.8M7 4l3.5 3.5M16.5 20l-3.5-3.5M2 12h3M19 12h3M12 2v3M12 19v3"/><circle cx="12" cy="12" r="4"/></svg>',
  chevronRight: '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>',
  download: '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 11l5 5 5-5M4 20h16"/></svg>',
  cloud: '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 17a4 4 0 000-8h-.7A6 6 0 106 17.5"/><path d="M12 12v9M8.5 17.5L12 21l3.5-3.5"/></svg>',
  expand: '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>',
  close: '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
};
`

const PAGE_MOD_HELPERS = `\
// ==================== Helpers ====================
function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

/** Normalize a search query for case-insensitive substring match. */
function normalizeSearchQuery(q) {
  return String(q == null ? '' : q).trim().toLowerCase();
}

/**
 * True if query is empty or any of the text parts contains the query.
 * @param {string} q already-normalized (lowercased) query, or raw (will normalize)
 * @param {Array<string|null|undefined>} parts
 */
function matchesSearch(q, parts) {
  var query = normalizeSearchQuery(q);
  if (!query) return true;
  if (!parts || !parts.length) return false;
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    if (p == null || p === '') continue;
    if (String(p).toLowerCase().indexOf(query) !== -1) return true;
  }
  return false;
}

/** Empty-state markup when a filter has no hits (source list may still be non-empty). */
function searchNoResultsHtml() {
  return '<div class="conv-empty conv-empty-fill aro-search-empty"><span>'
    + esc(lang.searchNoResults || lang.pickerEmpty || 'No results')
    + '</span></div>';
}

/**
 * Bind a list-search input once. Updates state.search[key] and calls onChange.
 * @param {string} inputId
 * @param {string} stateKey key under state.search
 * @param {function} onChange
 */
function bindListSearch(inputId, stateKey, onChange) {
  var input = $(inputId);
  if (!input || input.dataset.searchBound === '1') return;
  input.dataset.searchBound = '1';
  if (state.search && state.search[stateKey]) {
    input.value = state.search[stateKey];
  }
  input.addEventListener('input', function () {
    if (!state.search) state.search = {};
    state.search[stateKey] = input.value || '';
    if (typeof onChange === 'function') onChange();
  });
}

/** Apply i18n placeholder + aria to a search input. */
function applySearchInputLabel(inputId, placeholder) {
  var el = $(inputId);
  if (!el) return;
  var ph = placeholder || lang.pickerSearchPlaceholder || lang.searchPlaceholder || 'Search…';
  el.placeholder = ph;
  el.setAttribute('aria-label', ph);
}

/** True when the user prefers reduced motion (a11y). */
function prefersReducedMotion() {
  try {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch (e) { return false; }
}

/**
 * Play a one-shot enter animation class (restarts if already present).
 * Class is removed after animationend (or immediately under reduced motion).
 */
function aroPlayEnter(el, className) {
  if (!el || !className) return;
  el.classList.remove(className);
  if (prefersReducedMotion()) return;
  try { void el.offsetWidth; } catch (e) { /* ignore */ }
  el.classList.add(className);
  var done = function () {
    el.classList.remove(className);
    el.removeEventListener('animationend', done);
  };
  el.addEventListener('animationend', done);
  setTimeout(done, 400);
}

/**
 * Hide or remove an element after a short exit animation (class \`aro-leaving\`).
 * @param {HTMLElement} el
 * @param {{ remove?: boolean, ms?: number, onDone?: function }} opts
 */
function aroDismiss(el, opts) {
  opts = opts || {};
  if (!el) { if (opts.onDone) opts.onDone(); return; }
  var finished = false;
  var finish = function () {
    if (finished) return;
    finished = true;
    el.classList.remove('aro-leaving');
    el.removeEventListener('animationend', onAnimEnd);
    if (opts.remove) {
      try { el.remove(); } catch (e) { /* ignore */ }
    } else {
      el.style.display = 'none';
    }
    if (opts.onDone) opts.onDone();
  };
  var onAnimEnd = function (e) {
    // Ignore bubbled end events from child sheet/dialog animations.
    if (e && e.target && e.target !== el) return;
    finish();
  };
  if (prefersReducedMotion() || el.style.display === 'none') {
    finish();
    return;
  }
  el.classList.add('aro-leaving');
  el.addEventListener('animationend', onAnimEnd);
  setTimeout(finish, opts.ms || 180);
}

function timeStr(iso) { try { return new Date(iso).toLocaleTimeString(currentLocale, { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }
function fullTimeStr(iso) { try { return new Date(iso).toLocaleString(currentLocale); } catch (e) { return ''; } }
/** Relative short time for conv list (e.g. 5m, 2h, 3d). */
function relTimeStr(iso) {
  if (!iso) return '';
  try {
    if (typeof timeAgo === 'function') return timeAgo(iso);
  } catch (e) { /* fall through */ }
  try {
    var d = new Date(iso);
    var sec = Math.floor((Date.now() - d) / 1000);
    if (sec < 60) return sec + 's';
    var min = Math.floor(sec / 60);
    if (min < 60) return min + 'm';
    var hr = Math.floor(min / 60);
    if (hr < 24) return hr + 'h';
    var day = Math.floor(hr / 24);
    if (day < 30) return day + 'd';
    return d.toLocaleDateString(currentLocale, { month: 'short', day: 'numeric' });
  } catch (e2) { return ''; }
}

/** 消息日期分隔线标签：今天/昨天/日期 */
function dayLabel(iso) {
  var d = new Date(iso);
  if (isNaN(d)) return '';
  var now = new Date();
  var startOfDay = function (x) { return new Date(x.getFullYear(), x.getMonth(), x.getDate()); };
  var diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (diffDays === 0) return lang.dateToday || 'Today';
  if (diffDays === 1) return lang.dateYesterday || 'Yesterday';
  var opts = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  try { return d.toLocaleDateString(currentLocale, opts); } catch (e) { return d.toLocaleDateString(); }
}

/**
 * Backend send_message / file transfer only allow active|accepted.
 * Pending/closed/rejected (and missing detail while a channel is open) must lock the composer.
 */
function isChannelStatusWritable(status) {
  return status === 'active' || status === 'accepted';
}

function isChannelComposerLocked() {
  if (state.activeKind !== 'channel') return false;
  // Open channel without detail (loading / mid-open): do not pretend writable.
  if (!state.channelDetail) return !!state.activeId;
  return !isChannelStatusWritable(state.channelDetail.status);
}

function isRoomInvitePending() {
  if (state.activeKind !== 'room' || !state.roomDetail) return false;
  var st = state.roomDetail.my_membership_status
    || state.roomDetail.membership_status
    || 'active';
  return st === 'pending';
}

function isRoomComposerLocked() {
  return isRoomInvitePending();
}

function channelComposerLockReason() {
  if (!isChannelComposerLocked()) return '';
  var detail = state.channelDetail;
  var s = detail && detail.status;
  if (s === 'closed') {
    return lang.closedComposer || lang.composerClosed || lang.closed || '';
  }
  if (s === 'pending') {
    // Remote-initiated: need Accept. Local-initiated: wait for peer.
    if (detail && detail.initiated_by === 'remote') {
      return lang.channelNotAccepted || lang.pending || '';
    }
    return lang.pendingConfirm || lang.pending || lang.channelNotAccepted || '';
  }
  if (s === 'rejected') {
    return lang.channelNotAccepted || lang.closedComposer || lang.closed || '';
  }
  if (!detail) {
    return lang.loadFail || lang.channelNotAccepted || '';
  }
  return lang.channelNotAccepted || lang.closedComposer || lang.composerClosed || '';
}

function roomComposerLockReason() {
  if (!isRoomComposerLocked()) return '';
  return lang.roomInvitePending || lang.channelNotAccepted || lang.pending || 'Accept the invite to chat';
}

/** 发送按钮/composer 状态：不可写会话、发送中、无内容时不可发送 */
function updateSendState() {
  var btn = $('send-btn');
  var input = $('msg-input');
  var attach = $('attach-btn');
  var locked = isChannelComposerLocked() || isRoomComposerLocked();
  var blocked = !state.activeId || locked || !!state.sending;
  var lockMsg = locked
    ? (isRoomComposerLocked() ? roomComposerLockReason() : channelComposerLockReason())
    : '';
  var floatWrap = document.querySelector('#chat-container .input-float-wrap');
  if (floatWrap) {
    floatWrap.classList.toggle('composer-locked', locked);
    floatWrap.setAttribute('aria-disabled', locked ? 'true' : 'false');
  }

  if (input) {
    input.disabled = locked || !state.activeId;
    input.setAttribute('aria-disabled', input.disabled ? 'true' : 'false');
    if (locked) input.placeholder = lockMsg || lang.typing || '';
    else if (lang.typing) input.placeholder = lang.typing;
  }
  if (attach) {
    attach.disabled = blocked;
    attach.setAttribute('aria-disabled', blocked ? 'true' : 'false');
    attach.title = locked ? (lockMsg || lang.attach || '') : (lang.attach || '');
  }

  if (!btn) return;
  var hasContent = !!((input && !input.disabled && input.value.trim()) || (!locked && state.pendingAttach));
  var ready = !blocked && hasContent;
  btn.disabled = !ready;
  btn.classList.toggle('send-ready', ready);
  btn.setAttribute('aria-label', lang.send || 'Send');
  btn.title = locked ? (lockMsg || lang.send || '') : (lang.send || 'Send');
}
function autoResizeInput(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}
/**
 * Human-readable text from a message payload.
 * Never stringifies media blobs (data / transfer_id) — that used to dump base64 into quotes.
 */
function getPayloadText(payload) {
  if (payload == null) return '';
  if (typeof payload === 'string') return payload;
  if (typeof payload !== 'object') {
    try { return String(payload); } catch (e0) { return ''; }
  }
  if (payload.text != null && payload.text !== '') return String(payload.text);
  if (typeof payload.content === 'string' && payload.content) return payload.content;
  if (payload.summary != null && payload.summary !== '') return String(payload.summary);
  if (payload.title != null && payload.title !== '') return String(payload.title);
  if (payload.filename != null && payload.filename !== '') return String(payload.filename);
  if (payload.name != null && payload.name !== '') return String(payload.name);
  // Media / opaque objects: no dump
  if (payload.data != null || payload.transfer_id) return '';
  try {
    var s = JSON.stringify(payload);
    if (!s || s === '{}' || s === 'null') return '';
    return s.length > 160 ? s.slice(0, 159) + '…' : s;
  } catch (e) {
    return '';
  }
}

/** Short label for quote/reply preview (filename / type / text). */
function quotePreviewText(msg) {
  if (!msg) return '';
  var payload = (typeof msg.payload === 'object' && msg.payload) ? msg.payload : {};
  var text = getPayloadText(payload);
  if (text) return text.length > 140 ? text.slice(0, 139) + '…' : text;
  var mt = msg.message_type || '';
  if (mt === 'image' || (payload.mime_type && String(payload.mime_type).indexOf('image/') === 0)) {
    return payload.filename || lang.previewImage || 'Image';
  }
  if (mt === 'file' || mt === 'file-meta' || payload.filename || payload.transfer_id) {
    return payload.filename || lang.previewFile || 'File';
  }
  if (mt === 'tapp' || mt === 'brew' || mt === 'library' || mt === 'report') {
    return payload.title || payload.summary || payload.name || lang.previewShare || 'Share';
  }
  return lang.newMessage || 'Message';
}

/** Display name for the author of a quoted message (both parties). */
function quoteSenderLabel(msg) {
  if (!msg) return '?';
  var actor = msg.sender_actor || '';
  if (typeof isLocalActor === 'function' && isLocalActor(actor)) {
    return lang.me || lang.local || 'Me';
  }
  if (state.activeKind === 'channel' && state.channelDetail) {
    // Peer in DM
    if (state.channelDetail.remote_actor_url && actor
      && String(state.channelDetail.remote_actor_url) === String(actor)) {
      return state.channelDetail.remote_actor_name
        || actor.split('/').pop()
        || '?';
    }
    if (state.channelDetail.remote_actor_name && !isLocalActor(actor)) {
      return state.channelDetail.remote_actor_name;
    }
  }
  if (typeof findMemberByActor === 'function') {
    var m = findMemberByActor(actor);
    if (m && m.display_name) return m.display_name;
  }
  return actor.split('/').pop() || '?';
}

/** 会话列表/通知用的短预览 */
function messagePreview(msg) {
  if (!msg) return lang.newMessage || '新消息';
  var mt = msg.message_type || 'text';
  if (mt === 'image') return lang.previewImage || '📷 图片';
  if (mt === 'file' || mt === 'file-meta') return lang.previewFile || '📎 文件';
  if (mt === 'system') return lang.previewSystem || '系统消息';
  var text = getPayloadText(msg.payload);
  if (!text) return lang.newMessage || '新消息';
  return text.length > 80 ? text.slice(0, 79) + '…' : text;
}

/**
 * 应用内新消息 Toast。
 * 条件：设置开启，且（页面在后台 或 当前未打开该会话）。
 * 全局通知中心由后端 SSE 负责，这里只补 Aro 打开时的即时反馈。
 */
function maybeNotifyIncomingMessage(scope, scopeId, msg) {
  if (!state.notifyOnMessage || !msg) return;
  var isActive =
    state.activeKind === scope &&
    state.activeId === scopeId &&
    typeof document !== 'undefined' &&
    !document.hidden;
  if (isActive) return;

  var title = lang.newMessage || '新消息';
  if (scope === 'channel') {
    for (var i = 0; i < state.channels.length; i++) {
      if (state.channels[i].channel_id === scopeId) {
        title = state.channels[i].remote_actor_name ||
          (state.channels[i].remote_actor_url || '').split('/').pop() ||
          title;
        break;
      }
    }
  } else if (scope === 'room') {
    for (var j = 0; j < state.rooms.length; j++) {
      if (state.rooms[j].room_id === scopeId) {
        title = state.rooms[j].name || title;
        break;
      }
    }
  }
  var preview = messagePreview(msg);
  try {
    Tapp.ui.showNotification({ title: title, message: preview, type: 'info' });
  } catch (e) { /* ignore */ }
}
/**
 * Recover the live message payload behind a share card via its data-msg-idx.
 * Detail sheets prefer this over DOM text: it keeps the full snapshot the
 * sender attached (cover, favicon, install package) rather than the truncated
 * strings the card displays.
 */
function shareCardPayload(card) {
  if (!card || !card.dataset || card.dataset.msgIdx == null || !state.messages) return {};
  var idx = parseInt(card.dataset.msgIdx, 10);
  if (isNaN(idx) || !state.messages[idx]) return {};
  var payload = state.messages[idx].payload;
  return (payload && typeof payload === 'object') ? payload : {};
}

/** Meta chip row for detail sheets; skips empty parts and renders nothing if all are empty. */
function sheetMetaHtml(parts) {
  var chips = (parts || []).filter(function (p) { return p != null && String(p).trim() !== ''; });
  if (!chips.length) return '';
  return '<div class="sheet-meta">'
    + chips.map(function (c) { return '<span class="sheet-meta-chip">' + esc(String(c)) + '</span>'; }).join('')
    + '</div>';
}

/** "Open original" affordance; only https links are offered (sandbox blocks the rest). */
function brewLinkHtml(url) {
  var href = String(url || '').trim();
  if (href.toLowerCase().indexOf('https://') !== 0) return '';
  return '<a class="sheet-link" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">'
    + esc(lang.openOriginal || 'Open original')
    + '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>'
    + '</a>';
}

/** Per-type sheet accents, matching the share-card palette. */
var SHARE_TYPE_ACCENTS = {
  brew: '34,197,94',
  library: '168,85,247',
  report: '239,68,68',
};

/**
 * Resolve a bottom sheet's header icon and brand accent using the same rules as
 * the share cards: cover art > raw svg > favicon > platform logo > type glyph.
 *
 * @returns {{icon:string, mark:string, accent:object|null}}
 *   \`mark\` goes on the icon element so a favicon keeps a neutral tile;
 *   \`accent\` is applied to the overlay by applySheetAccent().
 */
function sheetVisual(opts) {
  opts = opts || {};
  var favicon = safeIconUrl(opts.favicon);
  var logo = platformLogoSvg(opts.slug);
  var icon = '';
  var mark = '';
  var accent = null;

  if (opts.cover) {
    icon = '<img src="' + esc(opts.cover) + '" alt="" />';
  } else if (opts.rawSvg) {
    icon = opts.rawSvg;
  } else if (favicon) {
    icon = '<img src="' + esc(favicon) + '" alt="" />';
    mark = 'img';
  } else if (logo) {
    icon = logo;
    mark = 'brand';
  } else {
    icon = opts.fallback || SVG_ICONS.file;
  }

  if (mark === 'brand') {
    var brand = platformAccent(opts.slug);
    if (brand) accent = { brand: true, l: brand.l, d: brand.d };
  }
  if (!accent && opts.type && SHARE_TYPE_ACCENTS[opts.type]) {
    accent = { brand: false, flat: SHARE_TYPE_ACCENTS[opts.type] };
  }
  return { icon: icon, mark: mark, accent: accent };
}

/**
 * Terminal/among-flight states for a .sheet-btn, as classes rather than inline
 * colors so the palette stays in one place.
 * @param {'busy'|'ok'|'err'|'idle'} stateName
 */
function setSheetBtnState(btn, stateName) {
  if (!btn) return;
  btn.classList.remove('sheet-btn-ok', 'sheet-btn-err', 'is-busy');
  if (stateName === 'busy') btn.classList.add('is-busy');
  else if (stateName === 'ok') btn.classList.add('sheet-btn-ok');
  else if (stateName === 'err') btn.classList.add('sheet-btn-err');
}

/**
 * Inline attributes for an icon element built as an HTML string (picker rows).
 * Emits the -l/-d accent pair so the element's own brand color wins per row,
 * and marks favicons so a dead one can be swapped for a glyph.
 */
function sheetVisualAttrs(v, fallbackType) {
  if (!v || !v.mark) return '';
  var attrs = ' data-mark="' + esc(v.mark) + '"';
  if (v.mark === 'img' && fallbackType) attrs += ' data-fallback="' + esc(fallbackType) + '"';
  if (v.mark === 'brand' && v.accent && v.accent.brand) {
    attrs += ' style="--acc-l:' + v.accent.l + ';--acc-d:' + v.accent.d + '"';
  }
  return attrs;
}

/**
 * Swap dead favicons inside a container for the generic type glyph.
 * Applies to picker rows; the message-card path has its own binding because it
 * must also clear the accent on the surrounding card.
 */
function bindFaviconFallbacks(container) {
  if (!container) return;
  container.querySelectorAll('[data-mark="img"][data-fallback] img').forEach(function (img) {
    img.addEventListener('error', function () {
      var tile = img.closest('[data-fallback]');
      if (!tile) return;
      var glyphs = { tapp: SVG_ICONS.tapp, brew: SVG_ICONS.brew, library: SVG_ICONS.library, report: SVG_ICONS.report };
      tile.removeAttribute('data-mark');
      tile.innerHTML = glyphs[tile.dataset.fallback] || SVG_ICONS.file;
    });
  });
}

/** Apply a sheetVisual() accent to an overlay element. */
function applySheetAccent(el, accent) {
  if (!el || !accent) return;
  if (accent.brand) {
    // -l/-d pair, never --acc directly: an inline --acc would outrank the
    // \`.dark .picker-overlay[data-mark="brand"]\` rule and freeze the theme.
    el.dataset.mark = 'brand';
    el.style.setProperty('--acc-l', accent.l);
    el.style.setProperty('--acc-d', accent.d);
  } else if (accent.flat) {
    el.style.setProperty('--acc', accent.flat);
  }
}

/**
 * Keep only image URLs the sandbox CSP will actually load (img-src data: blob: https:).
 * Anything else would render as a broken tile, so callers fall back to a glyph.
 */
function safeIconUrl(url) {
  if (!url) return '';
  var v = String(url).trim();
  var lower = v.toLowerCase();
  if (lower.indexOf('https://') === 0 || lower.indexOf('data:image/') === 0) return v;
  return '';
}

/* ----- File bubble typing: accent slug + glyph + short extension label ----- */
var FILE_KIND_RULES = [
  { kind: 'image', re: /^(png|jpe?g|gif|webp|avif|bmp|svg|heic|heif|ico)$/ },
  { kind: 'video', re: /^(mp4|mov|mkv|webm|avi|m4v|flv)$/ },
  { kind: 'audio', re: /^(mp3|wav|flac|aac|m4a|ogg|opus|aiff?)$/ },
  { kind: 'archive', re: /^(zip|rar|7z|tar|gz|tgz|bz2|xz|zst)$/ },
  { kind: 'doc', re: /^(pdf|docx?|pages|rtf|odt|epub|mobi)$/ },
  { kind: 'sheet', re: /^(xlsx?|csv|tsv|numbers|ods)$/ },
  { kind: 'code', re: /^(js|mjs|cjs|ts|tsx|jsx|rs|go|py|rb|java|kt|swift|c|cc|cpp|h|hpp|sh|zsh|json|ya?ml|toml|html?|css|scss|sql)$/ },
  { kind: 'text', re: /^(txt|md|markdown|log)$/ },
];

var FILE_KIND_GLYPHS = {
  image: '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.6"/><path d="M21 15l-4.5-4.5L6 21"/></svg>',
  video: '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="4"/><path d="M10 9l5 3-5 3z"/></svg>',
  audio: '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></svg>',
  archive: '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7l1.5-3h15L21 7v12a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><path d="M3 7h18M12 11v5M10 13h4"/></svg>',
  doc: '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>',
  sheet: '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M3 15h18M9 3v18"/></svg>',
  code: '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 8L4 12l4.5 4M15.5 8l4.5 4-4.5 4M13.5 5l-3 14"/></svg>',
  text: '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6M9 9h2"/></svg>',
  file: '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5"/></svg>',
};

/** Map a filename/mime to { kind, ext, glyph } used by the file bubble. */
function fileCardMeta(filename, mime) {
  var name = String(filename || '');
  var dot = name.lastIndexOf('.');
  var ext = dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : '';
  var kind = '';
  for (var i = 0; i < FILE_KIND_RULES.length && ext; i++) {
    if (FILE_KIND_RULES[i].re.test(ext)) { kind = FILE_KIND_RULES[i].kind; break; }
  }
  if (!kind && mime) {
    var m = String(mime);
    if (m.indexOf('image/') === 0) kind = 'image';
    else if (m.indexOf('video/') === 0) kind = 'video';
    else if (m.indexOf('audio/') === 0) kind = 'audio';
    else if (m.indexOf('text/') === 0) kind = 'text';
  }
  if (!kind) kind = 'file';
  return {
    kind: kind,
    ext: ext ? ext.toUpperCase().slice(0, 4) : '',
    glyph: FILE_KIND_GLYPHS[kind] || FILE_KIND_GLYPHS.file,
  };
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function getErrorMessage(error) {
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (error.message) return String(error.message);
  if (error.error) return String(error.error);
  try { return JSON.stringify(error); } catch (e) { return ''; }
}

function errorSuffix(error) {
  var message = getErrorMessage(error);
  return message ? ': ' + message : '';
}

function notifyError(title, error) {
  var message = getErrorMessage(error);
  try {
    Tapp.ui.showNotification({ title: title, message: message || undefined, type: 'error' });
  } catch (e) {}
}

function requireAdminAction() {
  if (state.isAdmin) return true;
  notifyError(lang.adminRequired);
  return false;
}

/** 本地化环网类型标签；未知类型原样返回 */
function ringTypeLabel(type) {
  var map = {
    'brew-recommend': lang.ringTypeBrewRecommend,
    'tapp-store': lang.ringTypeTappStore,
    'library-exchange': lang.ringTypeLibraryExchange,
    'instance-directory': lang.ringTypeInstanceDirectory,
  };
  return map[type] || type || '';
}

/** 本地化成员角色标签 */
function roleLabel(role) {
  var map = { owner: lang.roleOwner, admin: lang.roleAdmin, member: lang.roleMember };
  return map[role] || role || '';
}

/** 本地化分享卡片类型标签 */
function shareTypeLabel(type) {
  var map = { tapp: lang.attachTapp, brew: lang.attachBrew, library: lang.attachLibrary, report: lang.attachReport };
  return map[type] || type || '';
}

/**
 * Unify share payload → bubble card fields for tapp/brew/library/report.
 * Always returns a non-empty title so cards never render blank.
 */
function resolveShareCardView(msgType, payload) {
  payload = payload || {};
  var untitled = lang.shareUntitled || 'Untitled';
  var title = '';
  var description = '';
  var image = String(payload.image || payload.cover || '').trim();

  if (msgType === 'report') {
    title = String(payload.summary || payload.title || '').trim();
    description = String(payload.description || '').trim();
    if (!description) {
      if (payload.platform && payload.content_preview && payload.content_preview !== payload.summary) {
        description = payload.platform + ' · ' + payload.content_preview;
      } else {
        description = String(payload.content_preview || payload.platform || '').trim();
        if (description === title) description = String(payload.platform || '').trim();
      }
    } else if (payload.summary && description === title) {
      description = String(payload.platform || '').trim();
    }
  } else if (msgType === 'library') {
    title = String(payload.title || payload.summary || payload.name || '').trim();
    description = String(payload.description || '').trim();
    if (!description) {
      var libParts = [];
      if (payload.platform_id) libParts.push(String(payload.platform_id));
      var itemKind = payload.item_type || (payload.content_type && payload.content_type !== 'library' ? payload.content_type : '');
      if (itemKind) libParts.push(String(itemKind));
      description = libParts.join(' · ');
    }
    if (!image) image = String(payload.thumbnail || '').trim();
  } else if (msgType === 'tapp') {
    title = String(payload.title || payload.tapp_name || payload.name || '').trim();
    description = String(payload.description || payload.tapp_id || '').trim();
    if (description === title) description = String(payload.tapp_id || '').trim();
  } else if (msgType === 'brew') {
    title = String(payload.title || payload.name || '').trim();
    description = String(payload.description || '').trim();
  } else {
    title = String(payload.title || payload.summary || payload.name || '').trim();
    description = String(payload.description || '').trim();
  }

  if (!title) {
    // Last-resort fallbacks — never blank
    if (msgType === 'tapp' && payload.tapp_id) title = String(payload.tapp_id);
    else if (msgType === 'library' && payload.item_id) title = String(payload.item_id);
    else if (msgType === 'report' && payload.report_id) title = String(payload.report_id);
    else if (msgType === 'brew' && payload.brew_id) title = 'Brew #' + payload.brew_id;
    else title = shareTypeLabel(msgType) || untitled;
  }
  if (description === title) description = '';
  return { title: title, description: description, image: image };
}

/* ---------------------------------------------------------------------------
 * Media (library) share cards — image-forward layout with sender attribution.
 * A game/anime/music share carries its own cover art, so it renders as a poster
 * card rather than the compact icon+title row. Playtime / watch progress / the
 * sender's rating travel as flat snapshot fields so recipients render without a
 * re-fetch (mirrors frontend LibraryGrid + libraryWatchProgress conventions).
 * ------------------------------------------------------------------------- */

/** Parse a non-negative integer, tolerating strings; null when not usable. */
function mediaInt(value) {
  if (value == null || value === '') return null;
  var n = typeof value === 'number' ? value : Number(value);
  if (!isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

/** Parse "5/12", "5/?", "5" style progress → {cur,total|null} | null. */
function parseProgressStr(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number') {
    var only = mediaInt(raw);
    return only == null ? null : { cur: only, total: null };
  }
  if (typeof raw !== 'string') return null;
  var s = raw.trim();
  if (!s) return null;
  var m = s.match(/^(\\d+)\\s*\\/\\s*(\\d+|\\?)$/);
  if (m) {
    var total = m[2] === '?' ? null : Number(m[2]);
    return { cur: Number(m[1]), total: (total && total > 0) ? total : null };
  }
  var n = s.match(/^(\\d+)$/);
  if (n) return { cur: Number(n[1]), total: null };
  return null;
}

/** anime / video / tv_series are episode-tracked; book is chapter-tracked. */
function isAnimeLikeType(itemType) {
  return itemType === 'anime' || itemType === 'tv_series' || itemType === 'video';
}

/** Episode/chapter total from Bangumi/MAL-shaped metadata. */
function mediaEpisodeTotal(meta) {
  if (!meta || typeof meta !== 'object') return null;
  var subject = (meta.subject && typeof meta.subject === 'object') ? meta.subject : {};
  var node = (meta.node && typeof meta.node === 'object') ? meta.node : {};
  return mediaInt(subject.eps) != null ? mediaInt(subject.eps)
    : (mediaInt(node.num_episodes) != null ? mediaInt(node.num_episodes)
      : mediaInt(meta.num_episodes));
}

/**
 * Extract structured sender stats from a live library item at share time.
 * @returns {{playtimeMin:(number|null), rating:(number|null),
 *            progressCur:(number|null), progressTotal:(number|null)}}
 */
function extractLibraryStats(itemType, meta) {
  var out = { playtimeMin: null, rating: null, progressCur: null, progressTotal: null };
  if (!meta || typeof meta !== 'object') meta = {};
  var ls = (meta.list_status && typeof meta.list_status === 'object') ? meta.list_status : {};

  // Playtime (games): Steam stores minutes in playtime_forever.
  var pt = mediaInt(meta.playtime_forever);
  if (pt == null) pt = mediaInt(meta.playtime);
  if (pt != null && pt > 0) out.playtimeMin = pt;

  // Rating: Bangumi \`rate\` / MAL \`list_status.score\` (0 == unrated).
  var rate = meta.rate != null ? Number(meta.rate) : Number(ls.score);
  if (isFinite(rate) && rate > 0) out.rating = Math.round(rate * 10) / 10;

  // Watch/read progress (anime-like → episodes, book → chapters).
  var parts = parseProgressStr(meta.progress);
  if (isAnimeLikeType(itemType)) {
    if (!parts) {
      var watched = mediaInt(meta.ep_status);
      if (watched == null) watched = mediaInt(ls.num_episodes_watched);
      if (watched == null) watched = mediaInt(meta.num_episodes_watched);
      if (watched != null) parts = { cur: watched, total: mediaEpisodeTotal(meta) };
    } else if (parts.total == null) {
      var total = mediaEpisodeTotal(meta);
      if (total != null) parts.total = total;
    }
  } else if (itemType === 'book') {
    var ch = mediaInt(meta.ep_status);
    if (ch == null) ch = mediaInt(ls.num_chapters_read);
    if (ch == null) ch = mediaInt(meta.num_chapters_read);
    if (ch != null) parts = { cur: ch, total: null };
    else if (parts && parts.total == null) parts = { cur: parts.cur, total: null };
  } else {
    parts = null; // games/music carry no episode progress
  }
  // Suppress a meaningless 0 with no total (wishlist / untouched).
  if (parts && !(parts.cur === 0 && parts.total == null)) {
    out.progressCur = parts.cur;
    out.progressTotal = parts.total;
  }
  return out;
}

/**
 * Artist + album for a music item, from Netease-shaped (\`ar\`/\`al\`) or flat
 * (\`artist\`/\`album\`) metadata. Empty strings when unknown.
 */
function extractMusicMeta(meta) {
  var out = { artist: '', album: '' };
  if (!meta || typeof meta !== 'object') return out;
  var ar = meta.ar || meta.artists || meta.artist;
  if (Array.isArray(ar)) {
    out.artist = ar.map(function (a) { return (a && (a.name || (typeof a === 'string' ? a : ''))) || ''; })
      .filter(Boolean).join(', ');
  } else if (typeof ar === 'string') {
    out.artist = ar.trim();
  }
  if (meta.al && typeof meta.al === 'object') out.album = String(meta.al.name || '').trim();
  else if (typeof meta.album === 'string') out.album = meta.album.trim();
  return out;
}

/** Localized playtime label: hours once past an hour, minutes below. */
function formatPlaytime(min) {
  var n = Number(min);
  if (!isFinite(n) || n <= 0) return '';
  if (n < 60) return (lang.mediaMinutes || '{v}m').replace('{v}', String(Math.round(n)));
  return (lang.mediaHours || '{v}h').replace('{v}', String(Math.round(n / 60)));
}

/** Localized watch/read progress label from stored cur/total. */
function formatWatchProgress(cur, total, itemType) {
  var c = mediaInt(cur);
  if (c == null) return '';
  var t = mediaInt(total);
  var isBook = itemType === 'book';
  if (t != null && t > 0) {
    return (isBook ? (lang.mediaCh || '{c}/{t}') : (lang.mediaEp || '{c}/{t}'))
      .replace('{c}', String(c)).replace('{t}', String(t));
  }
  return (isBook ? (lang.mediaChOnly || '{c}') : (lang.mediaEpOnly || '{c}'))
    .replace('{c}', String(c));
}

/**
 * Render model for a library media card, read from a message payload's flat
 * snapshot fields. \`stat\` is the sender-attributed line (playtime OR progress).
 */
function libraryMediaView(payload) {
  payload = payload || {};
  var base = resolveShareCardView('library', payload);
  var itemType = String(payload.item_type || payload.content_type || '').trim();
  if (itemType === 'library') itemType = '';
  var ratingText = '';
  var rating = Number(payload.rating);
  if (isFinite(rating) && rating > 0) ratingText = String(Math.round(rating * 10) / 10);

  var stat = null;
  var ptText = formatPlaytime(payload.playtime_min);
  if (ptText) {
    stat = { icon: SVG_ICONS.gamepad, text: ptText };
  } else {
    var progText = formatWatchProgress(payload.progress_cur, payload.progress_total, itemType);
    if (progText) stat = { icon: SVG_ICONS.playCircle, text: progText };
  }
  return {
    image: base.image,
    title: base.title,
    description: base.description,
    itemType: itemType,
    platform: String(payload.platform_id || '').trim(),
    ratingText: ratingText,
    artist: String(payload.artist || '').trim(),
    album: String(payload.album || '').trim(),
    stat: stat,
  };
}

/** Best-guess cover orientation before the image loads (games ship banners). */
function mediaCoverOrient(itemType) {
  return itemType === 'game' ? 'landscape' : 'portrait';
}

/** Localized content-kind label ("Game" / "番剧" / …); '' when unknown. */
function mediaKindLabel(itemType) {
  var t = String(itemType || '').trim();
  if (!t) return '';
  var k = lang['mediaKind_' + t];
  if (k) return k;
  var fallback = {
    game: 'Game', anime: 'Anime', music: 'Music',
    tv_series: 'TV', book: 'Book', video: 'Video',
  };
  return fallback[t] || (t.charAt(0).toUpperCase() + t.slice(1).replace(/_/g, ' '));
}

/**
 * 应用内确认对话框（沙箱 iframe 中原生 confirm() 会被浏览器拦截并静默返回 false）。
 * 返回 Promise<boolean>。
 */
function aroConfirm(message, danger) {
  return new Promise(function (resolve) {
    var overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = '<div class="confirm-dialog">'
      + '<div class="confirm-message">' + esc(message) + '</div>'
      + '<div class="confirm-actions">'
      + '<button class="confirm-btn confirm-btn-cancel">' + esc(lang.confirmCancel || 'Cancel') + '</button>'
      + '<button class="confirm-btn confirm-btn-ok' + (danger ? ' confirm-btn-danger' : '') + '">' + esc(lang.confirmOk || 'OK') + '</button>'
      + '</div></div>';
    var settled = false;
    var done = function (result) {
      if (settled) return;
      settled = true;
      aroDismiss(overlay, {
        remove: true,
        ms: 150,
        onDone: function () { resolve(result); },
      });
    };
    overlay.querySelector('.confirm-btn-cancel').addEventListener('click', function () { done(false); });
    overlay.querySelector('.confirm-btn-ok').addEventListener('click', function () { done(true); });
    overlay.addEventListener('click', function (e) { if (e.target === overlay) done(false); });
    document.body.appendChild(overlay);
    overlay.querySelector('.confirm-btn-ok').focus();
  });
}

function setAdminElementVisible(selector, visible) {
  document.querySelectorAll(selector).forEach(function (el) {
    el.style.display = visible ? '' : 'none';
  });
}

function applyAdminControls() {
  var visible = !!state.isAdmin;
  setAdminElementVisible('#ring-create-open-btn', visible);
  setAdminElementVisible('#ring-sync-btn', visible);
  setAdminElementVisible('#ring-peer-bar', visible);
  setAdminElementVisible('.ring-peer-remove-btn', visible);
  var manageBtn = $('ring-manage-btn');
  var manageWrap = manageBtn ? manageBtn.closest('.manage-wrap') : null;
  if (manageWrap) manageWrap.style.display = visible ? '' : 'none';
  if (!visible) {
    var createDialog = $('ring-create-dialog');
    if (createDialog) createDialog.style.display = 'none';
    var dropdown = $('ring-manage-dropdown');
    if (dropdown) dropdown.classList.remove('open');
  }
}

function applyRoleControls() {
  var privateOnly = !state.isGuest;
  // 访客只有「动态」一个视图，整条顶部导航都没有意义，直接隐藏
  setAdminElementVisible('#aro-nav', privateOnly);
  setAdminElementVisible('#nav-messages', privateOnly);
  setAdminElementVisible('#nav-rings', privateOnly);
  setAdminElementVisible('.feed-nav-item[data-sub="following"]', privateOnly);
  setAdminElementVisible('.feed-nav-item[data-sub="followers"]', privateOnly);
  setAdminElementVisible('.feed-nav-item[data-sub="published"]', privateOnly);
  setAdminElementVisible('.feed-nav-item[data-sub="backup"]', privateOnly);
  setAdminElementVisible('.feed-mobile-tab[data-sub="following"]', privateOnly);
  setAdminElementVisible('.feed-mobile-tab[data-sub="followers"]', privateOnly);
  setAdminElementVisible('.feed-mobile-tab[data-sub="published"]', privateOnly);
  setAdminElementVisible('.feed-mobile-tab[data-sub="backup"]', privateOnly);
  if (state.isGuest) {
    state.feedSubTab = 'timeline';
    state.currentView = 'feed';
    if (typeof closeFollowDialog === 'function') closeFollowDialog();
    if (typeof closeFeedPlusMenu === 'function') closeFeedPlusMenu();
    if (typeof closeComposer === 'function') closeComposer();
  }
  if (typeof updateFeedPlusVisibility === 'function') {
    updateFeedPlusVisibility();
  } else if (typeof updateComposeButtonVisibility === 'function') {
    updateComposeButtonVisibility();
  }
}

/**
 * Resolve guest/user/admin without locking authenticated users as guests
 * when getRole/isAdmin are missing, throw, or host-default to 'guest'.
 *
 * Order (mirrors resolveAroUserRole util + unit tests):
 *   1. Tapp.user.getRole user/admin → use it
 *   2. getRole 'guest' is SOFT (host often does userRole||'guest') → verify below
 *   3. Tapp.user.isAdmin — true→admin, false→user (never guest)
 *   4. Tapp.context.getUser — authenticated user → user/admin
 *   5. Remain guest only when no auth user or context role is guest
 *
 * Repro (before this soft-guest fix, local preview logged-in):
 *   - Host getRole returns 'guest' because tappInstance.userRole is unset
 *   - #145 still treated that as resolved=true → Messages/Rings/create/+ all gone
 * After:
 *   - Same login + soft-guest getRole → getUser promotes to member
 *   - True guest (context role guest / no identity) still locked
 *
 * Manual test (local preview, logged-in non-admin):
 *   - Open Aro: #aro-nav shows Messages + Rings
 *   - Feed has Following / Followers / Published tabs (not timeline-only)
 *   - Messenger opens; compose + is available on timeline/following
 *   - DevTools: force getRole to 'guest' while getUser has id/username → still member
 *   - DevTools: force getRole to throw → still not guest if getUser works
 *   - Logged-out / true guest: nav hidden, timeline-only feed
 */
async function loadUserRole() {
  state.userRole = 'guest';
  state.isGuest = true;
  state.isAdmin = false;
  var resolved = false;

  function isGuestUsername(name) {
    var u = String(name || '').trim().toLowerCase();
    return !u || u.indexOf('guest:') === 0 || u === 'guest' || u === 'anonymous';
  }

  function isGuestUserId(id) {
    var s = id != null ? String(id).trim() : '';
    if (!s) return true;
    if (s === 'guest' || s === '0' || s === '-1') return true;
    // user_-123 style guest subjects (negative numeric id)
    var m = /^user_(-?\\d+)$/i.exec(s);
    if (m) {
      var n = parseInt(m[1], 10);
      return !Number.isFinite(n) || n <= 0;
    }
    if (/^-\\d+$/.test(s)) return true;
    return false;
  }

  function applyMember(isAdminUser) {
    state.isAdmin = !!isAdminUser;
    state.userRole = isAdminUser ? 'admin' : 'user';
    state.isGuest = false;
    resolved = true;
  }

  // 1) getRole: host may soft-default to guest when instance.userRole unset —
  //    host now re-probes context/user, so user/admin here is authoritative.
  if (Tapp.user && typeof Tapp.user.getRole === 'function') {
    try {
      var role = await Tapp.user.getRole();
      if (role != null && String(role).trim() !== '') {
        var roleNorm = String(role).trim().toLowerCase();
        if (roleNorm === 'admin' || roleNorm === 'user') {
          applyMember(roleNorm === 'admin');
        }
        // roleNorm === 'guest': soft — verify via getUser / isLoggedIn
      }
    } catch (e) { /* fall through */ }
  }

  // 2) getUser — strongest session signal (JWT cookie + grant)
  if (!resolved) {
    try {
      var user = null;
      if (Tapp.context && typeof Tapp.context.getUser === 'function') {
        user = await Tapp.context.getUser();
      }
      if (user && typeof user === 'object') {
        var rawRole = user.role != null ? String(user.role).trim().toLowerCase() : '';
        var username = user.username != null ? String(user.username).trim() : '';
        var id = user.id != null ? String(user.id).trim() : '';
        var isAdminUser = !!(user.isAdmin === true || rawRole === 'admin');
        var isExplicitGuest = rawRole === 'guest' || isGuestUsername(username) || isGuestUserId(id);
        if (isAdminUser) {
          applyMember(true);
        } else if (!isExplicitGuest && (
          rawRole === 'user'
          || user.authenticated === true
          || (!isGuestUserId(id) && username)
        )) {
          applyMember(false);
        }
      }
    } catch (e) {
      console.warn('[Aro] context.getUser failed during role resolve:', e);
    }
  }

  // 3) isLoggedIn after host re-probe (true only when role is not guest)
  if (!resolved && Tapp.user && typeof Tapp.user.isLoggedIn === 'function') {
    try {
      if (await Tapp.user.isLoggedIn()) {
        var adminFlag = false;
        try {
          if (typeof Tapp.user.isAdmin === 'function') {
            adminFlag = !!(await Tapp.user.isAdmin());
          }
        } catch (e2) { /* non-admin member */ }
        applyMember(adminFlag);
      }
    } catch (e) { /* remain guest */ }
  }

  // 4) Last resort: isAdmin true only
  if (!resolved && Tapp.user && typeof Tapp.user.isAdmin === 'function') {
    try {
      if (await Tapp.user.isAdmin()) {
        applyMember(true);
      }
    } catch (e) { /* remain guest */ }
  }

  if (resolved) {
    console.info('[Aro] role resolved', state.userRole);
  } else {
    console.warn('[Aro] remaining guest — messenger/rings locked');
  }

  applyAdminControls();
  applyRoleControls();
}

function normalizeFederationUrl(value) {
  if (value === null || value === undefined) return '';
  var text = String(value).trim();
  if (!text) return '';
  var lower = text.toLowerCase();
  if (
    lower === 'null' ||
    lower === 'undefined' ||
    lower.indexOf('null/') === 0 ||
    lower.indexOf('undefined/') === 0 ||
    lower.indexOf('://null') !== -1 ||
    lower.indexOf('://undefined') !== -1
  ) {
    return '';
  }
  try {
    var parsed = new URL(text);
    var protocol = parsed.protocol.toLowerCase();
    var host = (parsed.hostname || '').toLowerCase();
    if ((protocol !== 'http:' && protocol !== 'https:') || !host || host === 'null' || host === 'undefined') {
      return '';
    }
    return text;
  } catch (e) {
    return '';
  }
}

function normalizeFederationDomain(value) {
  if (value === null || value === undefined) return '';
  var text = String(value).trim();
  if (!text) return '';
  var lower = text.toLowerCase();
  if (lower === 'null' || lower === 'undefined') return '';
  return text.replace(/^@+/, '');
}

function getIdentityActorUrl() {
  var identity = state.identity || {};
  return normalizeFederationUrl(identity.actor_url) || normalizeFederationUrl(state.localActorUrl);
}

function sanitizeFederationIdentity(identity) {
  if (!identity) return null;
  var clean = {};
  Object.keys(identity).forEach(function (key) {
    clean[key] = identity[key];
  });
  clean.actor_url = normalizeFederationUrl(clean.actor_url);
  clean.domain = normalizeFederationDomain(clean.domain);
  if (!clean.domain && clean.actor_url) {
    try { clean.domain = new URL(clean.actor_url).host; } catch (e) {}
  }
  if (!clean.handle && clean.acct) clean.handle = '@' + String(clean.acct).replace(/^@/, '');
  if (!clean.handle && clean.username && clean.domain) clean.handle = '@' + clean.username + '@' + clean.domain;
  if (!clean.acct && clean.handle) clean.acct = String(clean.handle).replace(/^@/, '');
  if (!clean.actor_url) {
    clean.inbox_url = '';
    clean.outbox_url = '';
    clean.followers_url = '';
    clean.following_url = '';
  }
  return clean;
}

function getIdentityHandle() {
  var identity = state.identity || {};
  if (identity.handle) return identity.handle;
  if (identity.acct) return '@' + identity.acct;
  var domain = normalizeFederationDomain(identity.domain);
  if (identity.username && domain) return '@' + identity.username + '@' + domain;
  return '';
}

function synthesizeFederationIdentityFromUser(user) {
  if (state.identity || !user) return;
  var rawUsername = user.username || user.display_name || user.name || '';
  rawUsername = String(rawUsername).replace(/^@/, '').split('@')[0];
  if (!rawUsername) return;

  var actorUrl = normalizeFederationUrl(user.actor_url) || getIdentityActorUrl();
  var domain = '';
  if (actorUrl) {
    try { domain = new URL(actorUrl).host; } catch (e) {}
  }
  if (!domain) domain = normalizeFederationDomain(user.domain || user.instance_domain) || 'local';

  var acct = rawUsername + '@' + domain;
  state.identity = {
    username: rawUsername,
    domain: domain,
    handle: '@' + acct,
    acct: acct,
    webfinger_resource: 'acct:' + acct,
    actor_url: actorUrl,
    inbox_url: actorUrl ? actorUrl + '/inbox' : '',
    outbox_url: actorUrl ? actorUrl + '/outbox' : '',
    followers_url: actorUrl ? actorUrl + '/followers' : '',
    following_url: actorUrl ? actorUrl + '/following' : '',
    profile_url: ''
  };
  if (actorUrl) state.localActorUrl = actorUrl;
}

function renderFederationIdentity() {
  var identity = sanitizeFederationIdentity(state.identity) || {};
  state.identity = Object.keys(identity).length > 0 ? identity : null;
  var handle = getIdentityHandle();
  var actorUrl = getIdentityActorUrl();
  var visible = !!(handle || actorUrl);

  if (actorUrl) state.localActorUrl = actorUrl;
  else if (state.localActorUrl && !normalizeFederationUrl(state.localActorUrl)) state.localActorUrl = null;

  document.querySelectorAll('[data-fed-profile]').forEach(function (card) {
    card.style.display = visible ? '' : 'none';
    card.classList.toggle('feed-identity-actor-missing', !actorUrl);
    card.querySelectorAll('[data-fed-handle-summary]').forEach(function (handleEl) {
      handleEl.textContent = handle || actorUrl;
    });
    card.querySelectorAll('[data-fed-actor]').forEach(function (actorEl) {
      actorEl.textContent = actorUrl;
      actorEl.disabled = !actorUrl;
      actorEl.style.display = actorUrl ? '' : 'none';
    });
    card.querySelectorAll('[data-fed-toggle-button]').forEach(function (toggleBtn) {
      toggleBtn.style.display = actorUrl ? '' : 'none';
    });
    if (!actorUrl) setFeedProfileExpanded(card, false);
  });

  var profileHandle = $('feed-handle');
  if (profileHandle && handle) profileHandle.textContent = handle;
}

function avatarContentHtml(url, name) {
  var initial = ((name || '?')[0] || '?').toUpperCase();
  if (url) return '<img src="' + esc(url) + '" alt="" />';
  return esc(initial);
}

/** Unwrap getRoomMembers response: { members, total } or legacy bare array. */
function unwrapRoomMembers(res) {
  if (!res) return [];
  if (Array.isArray(res)) return res;
  if (Array.isArray(res.members)) return res.members;
  return [];
}

function sameActorUrl(a, b) {
  var left = normalizeFederationUrl(a) || String(a || '').trim().replace(/\\/+$/, '');
  var right = normalizeFederationUrl(b) || String(b || '').trim().replace(/\\/+$/, '');
  if (!left || !right) return false;
  return left === right || left.replace(/\\/+$/, '') === right.replace(/\\/+$/, '');
}

function findMemberByActor(actorUrl) {
  if (!actorUrl) return null;
  for (var i = 0; i < state.members.length; i++) {
    var m = state.members[i];
    if (sameActorUrl(m.actor_url, actorUrl)) return m;
  }
  return null;
}

function renderFeedProfileUser(user) {
  if (!user) return;
  var name = user.display_name || user.username || '';
  var avatar = user.avatar_url || user.avatar || '';
  // Prefer federation identity avatar when context only has placeholder/empty
  if (!avatar && state.identity && state.identity.avatar_url) {
    avatar = state.identity.avatar_url;
  }
  if (!name && state.identity) {
    name = state.identity.display_name || state.identity.username || name;
  }
  var initial = ((name || user.username || '?')[0] || '?').toUpperCase();
  document.querySelectorAll('[data-feed-avatar]').forEach(function (avatarEl) {
    if (avatar) avatarEl.innerHTML = '<img src="' + esc(avatar) + '" alt="" />';
    else avatarEl.textContent = initial;
  });
  document.querySelectorAll('[data-feed-display-name]').forEach(function (nameEl) {
    nameEl.textContent = name;
  });
  var fallbackHandle = user.username ? '@' + user.username : '';
  if (!state.identity && fallbackHandle) {
    document.querySelectorAll('[data-fed-handle-summary]').forEach(function (handleEl) {
      handleEl.textContent = fallbackHandle;
    });
  }
}

function setFeedProfileExpanded(card, expanded) {
  if (!card) return;
  if (expanded && card.classList.contains('feed-identity-actor-missing')) return;
  card.classList.toggle('feed-profile-expanded', !!expanded);
  var summary = card.querySelector('[data-fed-toggle]');
  if (summary) summary.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  card.querySelectorAll('[data-fed-toggle-button]').forEach(function (toggleBtn) {
    toggleBtn.setAttribute('title', expanded ? (lang.collapseDetails || '收起') : (lang.expandDetails || '展开'));
  });
}

function isTabletFeedProfileCard(card) {
  return !!(card && card.closest('.feed-sidebar') && window.matchMedia && window.matchMedia('(min-width: 769px) and (max-width: 1024px)').matches);
}

function closeFeedProfilePopovers(exceptCard) {
  document.querySelectorAll('.feed-profile-popover-open').forEach(function (card) {
    if (card !== exceptCard) {
      card.classList.remove('feed-profile-popover-open');
      setFeedProfileExpanded(card, false);
    }
  });
}

function setFeedProfilePopoverOpen(card, open) {
  if (!card) return;
  if (open) {
    closeFeedProfilePopovers(card);
    card.classList.add('feed-profile-popover-open');
    setFeedProfileExpanded(card, false);
  } else {
    card.classList.remove('feed-profile-popover-open');
    setFeedProfileExpanded(card, false);
  }
}

function toggleFeedProfileDetails(card) {
  if (!card || card.classList.contains('feed-identity-actor-missing')) return;
  setFeedProfileExpanded(card, !card.classList.contains('feed-profile-expanded'));
}

function toggleFeedProfileSummary(card) {
  if (!card) return;
  if (isTabletFeedProfileCard(card)) {
    setFeedProfilePopoverOpen(card, !card.classList.contains('feed-profile-popover-open'));
    return;
  }
  toggleFeedProfileDetails(card);
}

async function loadFederationIdentity() {
  if (state.isGuest) {
    try {
      var guestUser = await Tapp.context.getUser();
      synthesizeFederationIdentityFromUser(guestUser);
    } catch (e) {}
    renderFederationIdentity();
    return;
  }
  if (!Tapp.federation || typeof Tapp.federation.getIdentity !== 'function') {
    try {
      var fallbackUser = await Tapp.context.getUser();
      synthesizeFederationIdentityFromUser(fallbackUser);
    } catch (e) {}
    renderFederationIdentity();
    return;
  }
  try {
    var identity = await Tapp.federation.getIdentity();
    if (identity) {
      state.identity = sanitizeFederationIdentity(identity);
      var actorUrl = getIdentityActorUrl();
      if (actorUrl) state.localActorUrl = actorUrl;
    }
  } catch (e) {
    console.warn('[Aro] federation identity unavailable:', e);
  }
  if (!state.identity) {
    try {
      var fallbackUser2 = await Tapp.context.getUser();
      synthesizeFederationIdentityFromUser(fallbackUser2);
    } catch (e2) {}
  }
  renderFederationIdentity();
}

function fallbackCopyText(text) {
  var area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', 'readonly');
  area.style.position = 'fixed';
  area.style.left = '-9999px';
  document.body.appendChild(area);
  area.select();
  area.setSelectionRange(0, text.length);
  var ok = false;
  try {
    ok = document.execCommand('copy');
  } catch (e) {
    ok = false;
  } finally {
    area.remove();
  }
  return ok;
}

/** Copy arbitrary text with sandbox-safe clipboard fallback. */
async function copyTextToClipboard(text, opts) {
  opts = opts || {};
  if (!text) {
    if (!opts.silent) {
      try { Tapp.ui.showNotification({ title: lang.copyFail, type: 'error' }); } catch (e0) {}
    }
    return false;
  }
  var ok = false;
  // Tapp 运行在 opaque-origin 的沙箱 iframe 中，异步 Clipboard API 会被
  // 浏览器以 NotAllowedError 拒绝，因此拒绝后必须回退到 execCommand。
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      ok = true;
    }
  } catch (e) {
    ok = false;
  }
  if (!ok) ok = fallbackCopyText(text);
  if (!opts.silent) {
    if (ok) {
      try {
        Tapp.ui.showNotification({
          title: lang.copied,
          message: opts.showMessage === false ? undefined : text,
          type: 'success',
        });
      } catch (e2) {}
    } else {
      try { Tapp.ui.showNotification({ title: lang.copyFail, type: 'error' }); } catch (e3) {}
    }
  }
  return ok;
}

async function copyFederationIdentity(kind) {
  var text = kind === 'actor' ? getIdentityActorUrl() : getIdentityHandle();
  if (!text) return;
  await copyTextToClipboard(text);
}

function isLocalActor(actor) {
  if (!actor) return false;
  var localActor = getIdentityActorUrl();
  if (localActor && sameActorUrl(actor, localActor)) return true;
  if (state.localActorUrl && sameActorUrl(actor, state.localActorUrl)) return true;
  if (state.activeKind === 'channel' && state.channelDetail && state.channelDetail.remote_actor_url) {
    // In a 1:1 channel, anything that is not the remote peer is local
    return !sameActorUrl(actor, state.channelDetail.remote_actor_url);
  }
  if (state.activeKind === 'room' && state.members.length > 0) {
    var member = findMemberByActor(actor);
    if (member) return !!member.is_local;
  }
  return String(actor).indexOf('myriad.local') !== -1;
}

function applyLabels() {
  var el;
  el = $('nav-messages-label'); if (el) el.textContent = lang.navMessages;
  el = $('nav-rings-label'); if (el) el.textContent = lang.navRings;
  el = $('nav-feed-label'); if (el && !el.textContent) el.textContent = lang.navFeed || lang.feedTimeline;
  // Messenger sidebar (not ring sidebar)
  el = document.querySelector('#view-messages .sidebar-title'); if (el) el.textContent = lang.title || 'Messenger';
  el = document.querySelector('#view-messages .empty-text'); if (el) el.textContent = lang.selectHint || 'Pick a conversation to start messaging';
  el = $('create-btn'); if (el) { el.setAttribute('title', lang.create); el.setAttribute('aria-label', lang.create); }
  el = $('feed-empty-title');
  if (el && typeof getFeedEmptyTitle === 'function') {
    el.style.display = 'block';
    el.hidden = false;
    if (!$('feed-empty') || !$('feed-empty').classList.contains('feed-empty-error')) {
      el.textContent = getFeedEmptyTitle(state.feedSubTab);
    }
  }
  el = $('feed-empty-text');
  if (el && typeof getFeedEmptyText === 'function') {
    el.style.display = 'block';
    el.hidden = false;
    if (!$('feed-empty') || !$('feed-empty').classList.contains('feed-empty-error')) {
      el.textContent = getFeedEmptyText(state.feedSubTab);
    }
  }
  el = $('feed-empty-retry'); if (el) el.textContent = lang.feedRetry || 'Try again';
  el = $('msg-input'); if (el) el.placeholder = lang.typing;
  el = $('attach-btn'); if (el) { el.setAttribute('title', lang.attach || lang.attachFile); el.setAttribute('aria-label', lang.attach || lang.attachFile); }
  el = $('send-btn'); if (el) { el.setAttribute('title', lang.send); el.setAttribute('aria-label', lang.send); }
  el = $('back-btn'); if (el) el.setAttribute('aria-label', lang.back || 'Back');
  el = $('member-back-btn'); if (el) el.setAttribute('aria-label', lang.back || 'Back');
  el = $('member-title'); if (el && state.activeKind !== 'room') el.textContent = lang.members;
  el = $('invite-toggle'); if (el) { el.setAttribute('title', lang.invite); el.setAttribute('aria-label', lang.invite); }
  el = $('feed-nav-timeline'); if (el) el.textContent = lang.feedTimeline;
  el = $('feed-nav-following'); if (el) el.textContent = lang.feedFollowing;
  el = $('feed-nav-followers'); if (el) el.textContent = lang.feedFollowers;
  el = $('feed-nav-published'); if (el) el.textContent = lang.feedPublished;
  el = $('feed-nav-backup'); if (el) el.textContent = lang.feedBackup || lang.backupTitle || 'Backup';
  el = $('feed-tab-timeline'); if (el) el.textContent = lang.feedTimeline;
  el = $('feed-tab-following'); if (el) el.textContent = lang.feedFollowing;
  el = $('feed-tab-followers'); if (el) el.textContent = lang.feedFollowers;
  el = $('feed-tab-published'); if (el) el.textContent = lang.feedPublished;
  el = $('feed-tab-backup'); if (el) el.textContent = lang.feedBackup || lang.backupTitle || 'Backup';
  if (typeof applyHistoryLabels === 'function') applyHistoryLabels();
  if (typeof applyRoomFilesLabels === 'function') applyRoomFilesLabels();
  el = $('feed-follow-input'); if (el) el.placeholder = lang.followPlaceholder;
  el = $('feed-follow-btn'); if (el) el.textContent = lang.followBtn;
  el = $('feed-follow-dialog-title'); if (el) el.textContent = lang.followDialogTitle || lang.followBtn || 'Follow';
  var plusLabel = lang.feedPlus || lang.create || 'Add';
  el = $('feed-plus-btn'); if (el) { el.setAttribute('title', plusLabel); el.setAttribute('aria-label', plusLabel); }
  el = $('feed-plus-mobile-btn'); if (el) { el.setAttribute('title', plusLabel); el.setAttribute('aria-label', plusLabel); }
  el = $('feed-plus-post-label'); if (el) el.textContent = lang.composePost || 'Post';
  el = $('feed-plus-follow-label'); if (el) el.textContent = lang.followBtn || 'Follow';
  el = $('feed-plus-post-label-mobile'); if (el) el.textContent = lang.composePost || 'Post';
  el = $('feed-plus-follow-label-mobile'); if (el) el.textContent = lang.followBtn || 'Follow';
  el = $('feed-plus-post'); if (el) el.setAttribute('aria-label', lang.composePost || 'Post');
  el = $('feed-plus-follow'); if (el) el.setAttribute('aria-label', lang.followBtn || 'Follow');
  el = $('feed-plus-post-mobile'); if (el) el.setAttribute('aria-label', lang.composePost || 'Post');
  el = $('feed-plus-follow-mobile'); if (el) el.setAttribute('aria-label', lang.followBtn || 'Follow');
  el = $('feed-compose-dialog-title'); if (el) el.textContent = lang.composeDialogTitle || lang.composePost || 'Post';
  el = $('feed-compose-dialog-close'); if (el) el.setAttribute('aria-label', lang.composeCancel || lang.close || 'Close');
  el = $('feed-compose-text'); if (el) el.placeholder = lang.composePlaceholder || '';
  el = $('feed-compose-image-label'); if (el) el.textContent = lang.composeAddImage || 'Image';
  el = $('feed-compose-image-btn'); if (el) el.setAttribute('title', lang.composeAddImage || 'Image');
  el = $('feed-compose-video-label'); if (el) el.textContent = lang.composeAddVideo || 'Video';
  el = $('feed-compose-video-btn'); if (el) el.setAttribute('title', lang.composeAddVideo || 'Video');
  el = $('feed-compose-cancel'); if (el) el.textContent = lang.composeCancel || 'Cancel';
  el = $('feed-compose-publish'); if (el) el.textContent = lang.composePublish || 'Publish';
  el = $('feed-compose-draft-hint');
  if (el && !el.hidden) el.textContent = lang.composeDraftRestored || 'Draft restored';
  el = $('feed-compose-draft-notice');
  if (el && !el.hidden) el.textContent = lang.composeDraftTextOnly || '';
  el = $('refresh-feed-btn'); if (el) { el.setAttribute('title', lang.refresh); el.setAttribute('aria-label', lang.refresh); }
  el = $('refresh-feed-mobile-btn'); if (el) { el.setAttribute('title', lang.refresh); el.setAttribute('aria-label', lang.refresh); }
  applySearchInputLabel('conv-search', lang.searchConversations || lang.pickerSearchPlaceholder);
  applySearchInputLabel('ring-search', lang.searchRings || lang.pickerSearchPlaceholder);
  applySearchInputLabel('feed-search', lang.searchFeed || lang.pickerSearchPlaceholder);
  applySearchInputLabel('member-search', lang.searchMembers || lang.pickerSearchPlaceholder);
  applySearchInputLabel('invite-contact-search', lang.searchContacts || lang.pickerSearchPlaceholder);
  // Always set header title (even while loading) so HTML placeholders never stick in the wrong locale
  el = $('feed-section-title');
  if (el && typeof getFeedTitle === 'function') {
    el.textContent = getFeedTitle(state.feedSubTab);
  }
  if (typeof updateFeedPlusVisibility === 'function') updateFeedPlusVisibility();
  else if (typeof updateComposeButtonVisibility === 'function') updateComposeButtonVisibility();
  document.querySelectorAll('[data-copy-fed]').forEach(function (node) { node.setAttribute('title', lang.copy); });
  document.querySelectorAll('[data-fed-profile]').forEach(function (card) {
    setFeedProfileExpanded(card, card.classList.contains('feed-profile-expanded'));
  });
  if (typeof updateFeedHeader === 'function') updateFeedHeader();
  el = $('ring-sidebar-title'); if (el) el.textContent = lang.navRings || 'Rings';
  el = $('ring-select-hint'); if (el) el.textContent = lang.selectRing || lang.emptyRings || 'Select a ring';
  el = $('ring-create-title'); if (el) el.textContent = lang.createRingTitle;
  el = $('ring-create-open-btn'); if (el) { el.setAttribute('title', lang.create); el.setAttribute('aria-label', lang.create); }
  el = $('ring-name-input'); if (el) el.placeholder = lang.ringNamePlaceholder;
  el = $('create-ring-btn'); if (el) el.textContent = lang.createRingBtn;
  el = $('ring-peer-input'); if (el) el.placeholder = lang.addPeerPlaceholder;
  el = $('ring-add-peer-btn'); if (el) el.textContent = lang.addPeerBtn;
  el = $('ring-sync-label'); if (el) el.textContent = lang.syncBtn;
  el = $('ring-sync-btn'); if (el) el.setAttribute('title', lang.syncBtn);
  el = $('ring-leave-label'); if (el) el.textContent = lang.leaveBtn;
  el = $('ring-id-label'); if (el) el.textContent = lang.ringId || 'Ring ID';
  el = $('ring-id-copy');
  if (el) {
    el.setAttribute('title', lang.copy || 'Copy');
    el.setAttribute('aria-label', (lang.copy || 'Copy') + ' ' + (lang.ringId || 'Ring ID'));
  }
  el = $('ring-type-opt-brew'); if (el) el.textContent = lang.ringTypeBrewRecommend;
  el = $('ring-type-opt-tapp'); if (el) el.textContent = lang.ringTypeTappStore;
  el = $('ring-type-opt-library'); if (el) el.textContent = lang.ringTypeLibraryExchange;
  el = $('ring-type-opt-instance'); if (el) el.textContent = lang.ringTypeInstanceDirectory;
  el = $('ring-brew-category-label'); if (el) el.textContent = lang.ringBrewCategoryLabel || 'Brew category (optional)';
  el = $('ring-brew-category-all'); if (el) el.textContent = lang.ringBrewCategoryAll || 'All my categories';
  el = $('ring-brew-category-input'); if (el) el.placeholder = lang.ringBrewCategoryPlaceholder || 'Or type a category name';
  document.querySelectorAll('[data-i18n-empty-peers]').forEach(function (node) {
    node.textContent = lang.emptyPeers;
  });
  updateSendState();
}

function applyDialogLabels() {
  var el;
  el = $('create-dialog-title'); if (el) el.textContent = lang.create;
  el = $('create-channel-input'); if (el) el.placeholder = lang.channelPlaceholder;
  el = $('create-room-input'); if (el) el.placeholder = lang.roomPlaceholder;
  el = $('create-channel-btn'); if (el) el.textContent = lang.createChannel;
  el = $('create-room-btn'); if (el) el.textContent = lang.createRoom;
  el = $('create-tab-channel'); if (el) el.textContent = lang.newChannel;
  el = $('create-tab-room'); if (el) el.textContent = lang.newRoom;
  el = $('invite-input'); if (el) el.placeholder = lang.invitePlaceholder;
  el = $('invite-pop-contacts-label'); if (el) el.textContent = lang.inviteFromContacts;
  el = $('invite-pop-manual-label'); if (el) el.textContent = lang.inviteManual;
  el = $('edit-room-title'); if (el) el.textContent = lang.editRoom;
  el = $('edit-name-label'); if (el) el.textContent = lang.roomName;
  el = $('edit-desc-label'); if (el) el.textContent = lang.roomDesc;
  el = $('edit-room-save'); if (el) el.textContent = lang.save;
}
`

const PAGE_MOD_ATTACHMENTS = `\
// ==================== Attachment Menu ====================
var _attachMenu = null;
// Overall attach cap (large channel files use chunked transfer under federation:files).
var MAX_ATTACH_SIZE = 100 * 1024 * 1024; // 100MB
// Inline base64 only under this raw size so JSON payload stays under backend budget.
var INLINE_ATTACH_MAX = 2 * 1024 * 1024; // 2 MiB raw
// Must match backend federation file_transfer DEFAULT_CHUNK_SIZE (1 MiB).
var TRANSFER_CHUNK_SIZE = 1024 * 1024;

function toggleAttachMenu() {
  if (_attachMenu) { closeAttachMenu(); return; }
  var wrap = $('input-bar');
  if (!wrap) return;
  // Not writable / no active conversation: attach disabled
  var btn = $('attach-btn');
  if (btn && btn.disabled) return;
  var locked = typeof isChannelComposerLocked === 'function'
    ? isChannelComposerLocked()
    : !!(state.activeKind === 'channel' && state.channelDetail && state.channelDetail.status === 'closed');
  if (!state.activeId || locked || state.sending) return;
  wrap.style.position = 'relative';
  if (btn) btn.classList.add('attach-btn-active');

  var menu = document.createElement('div');
  menu.className = 'attach-menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML =
    '<button type="button" class="attach-menu-item" data-attach="image" role="menuitem"><div class="attach-menu-icon attach-icon-image"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg></div>' + esc(lang.attachImage) + '</button>'
    + '<button type="button" class="attach-menu-item" data-attach="file" role="menuitem"><div class="attach-menu-icon attach-icon-file"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg></div>' + esc(lang.attachFile) + '</button>'
    + '<button type="button" class="attach-menu-item" data-attach="tapp" role="menuitem"><div class="attach-menu-icon attach-icon-tapp"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg></div>' + esc(lang.attachTapp) + '</button>'
    + '<button type="button" class="attach-menu-item" data-attach="brew" role="menuitem"><div class="attach-menu-icon attach-icon-brew"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 8h1a4 4 0 010 8h-1M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z"/><path d="M6 1v3M10 1v3M14 1v3"/></svg></div>' + esc(lang.attachBrew) + '</button>'
    + '<button type="button" class="attach-menu-item" data-attach="library" role="menuitem"><div class="attach-menu-icon attach-icon-library"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg></div>' + esc(lang.attachLibrary) + '</button>'
    + '<button type="button" class="attach-menu-item" data-attach="report" role="menuitem"><div class="attach-menu-icon attach-icon-report"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg></div>' + esc(lang.attachReport) + '</button>';

  menu.addEventListener('click', function (e) {
    var item = e.target.closest('[data-attach]');
    if (!item) return;
    var type = item.dataset.attach;
    closeAttachMenu();
    if (type === 'image') { var inp = $('attach-image-input'); if (inp) inp.click(); }
    else if (type === 'file') { var inp2 = $('attach-file-input'); if (inp2) inp2.click(); }
    else pickFedContent(type);
  });

  wrap.appendChild(menu);
  _attachMenu = menu;
  aroPlayEnter(menu, 'aro-menu-enter');

  // Close on outside click
  setTimeout(function () {
    document.addEventListener('click', _attachOutsideClick);
  }, 0);
}

function _attachOutsideClick(e) {
  if (_attachMenu && !_attachMenu.contains(e.target) && e.target.id !== 'attach-btn' && !e.target.closest('#attach-btn')) {
    closeAttachMenu();
  }
}

function closeAttachMenu() {
  if (!_attachMenu) {
    var btnIdle = $('attach-btn');
    if (btnIdle) btnIdle.classList.remove('attach-btn-active');
    document.removeEventListener('click', _attachOutsideClick);
    return;
  }
  var menu = _attachMenu;
  _attachMenu = null;
  var btn = $('attach-btn');
  if (btn) btn.classList.remove('attach-btn-active');
  document.removeEventListener('click', _attachOutsideClick);
  aroDismiss(menu, { remove: true, ms: 120 });
}

function handleFileSelect(file, forceType) {
  if (!file) return;
  if (file.size > MAX_ATTACH_SIZE) {
    try { Tapp.ui.showNotification({ title: lang.fileTooLarge, type: 'error' }); } catch (e) { /* ignore */ }
    return;
  }
  var type = forceType || (file.type && file.type.indexOf('image/') === 0 ? 'image' : 'file');
  // Keep the File for chunked upload; dataURL preview only for images.
  if (type === 'image') {
    var reader = new FileReader();
    reader.onload = function () {
      setPendingAttach({ type: type, file: file, data: reader.result, name: file.name, size: file.size, mime: file.type || 'image/*' });
    };
    reader.onerror = function () {
      setPendingAttach({ type: type, file: file, name: file.name, size: file.size, mime: file.type || 'image/*' });
    };
    reader.readAsDataURL(file);
  } else {
    setPendingAttach({ type: type, file: file, name: file.name, size: file.size, mime: file.type || 'application/octet-stream' });
  }
}

function readFileAsDataURL(file) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onload = function () { resolve(reader.result); };
    reader.onerror = function () { reject(reader.error || new Error('read failed')); };
    reader.readAsDataURL(file);
  });
}

function arrayBufferToBase64(buffer) {
  var bytes = new Uint8Array(buffer);
  var binary = '';
  var step = 0x8000;
  for (var i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

/**
 * Chunked transfer for files above INLINE_ATTACH_MAX.
 * Supports both channel (DM) and room (group) via initiateTransfer / initiateRoomTransfer.
 */
async function sendChunkedFileTransfer(attach, text, replyTo) {
  var file = attach.file;
  if (!file) throw new Error('Missing file data');

  var isRoom = state.activeKind === 'room';
  var isChannel = state.activeKind === 'channel';
  if (!isRoom && !isChannel) {
    throw new Error(lang.fileTooLarge || 'File too large');
  }

  if (isChannel) {
    var chStatus = state.channelDetail && state.channelDetail.status;
    if (chStatus && chStatus !== 'active' && chStatus !== 'accepted') {
      throw new Error(lang.channelNotAccepted || 'Channel must be accepted first');
    }
    if (typeof Tapp.federation.initiateTransfer !== 'function') {
      throw new Error(lang.fileTooLarge || 'File too large');
    }
  } else if (typeof Tapp.federation.initiateRoomTransfer !== 'function') {
    throw new Error(lang.fileTooLargeRoom || lang.fileTooLarge || 'File too large for group');
  }
  if (typeof Tapp.federation.uploadChunk !== 'function') {
    throw new Error(lang.fileTooLarge || 'File too large');
  }

  try {
    Tapp.ui.showNotification({ title: lang.transferStarting || 'Uploading…', type: 'info' });
  } catch (e0) { /* ignore */ }

  var meta = {
    filename: attach.name,
    file_size: attach.size,
    mime_type: attach.mime || 'application/octet-stream',
  };
  var transfer = isRoom
    ? await Tapp.federation.initiateRoomTransfer(state.activeId, meta)
    : await Tapp.federation.initiateTransfer(state.activeId, meta);
  var transferId = transfer && transfer.transfer_id;
  if (!transferId) throw new Error('No transfer_id returned');

  var buf = await file.arrayBuffer();
  var bytes = new Uint8Array(buf);
  var totalChunks = Math.max(1, Math.ceil(bytes.length / TRANSFER_CHUNK_SIZE));
  var lastPct = -1;

  for (var i = 0; i < totalChunks; i++) {
    var start = i * TRANSFER_CHUNK_SIZE;
    var end = Math.min(start + TRANSFER_CHUNK_SIZE, bytes.length);
    var slice = bytes.subarray(start, end);
    var chunkData = arrayBufferToBase64(slice);
    await Tapp.federation.uploadChunk(transferId, {
      chunk_index: i,
      chunk_data: chunkData,
      chunk_size: slice.length,
    });
    var pct = Math.round(((i + 1) / totalChunks) * 100);
    if (pct >= lastPct + 20 || pct === 100) {
      lastPct = pct;
      try {
        var prog = (lang.transferProgress || 'Uploading… {pct}%').replace('{pct}', String(pct));
        Tapp.ui.showNotification({ title: prog, type: 'info' });
      } catch (e1) { /* ignore */ }
    }
  }

  var msgPayload = {
    filename: attach.name,
    size: attach.size,
    mime_type: attach.mime || 'application/octet-stream',
    transfer_id: transferId,
    text: text || '',
  };
  if (state.quoteMsg) {
    msgPayload.quote_sender = state.quoteMsg.sender;
    msgPayload.quote_text = state.quoteMsg.text;
    msgPayload.quote_id = state.quoteMsg.message_id;
  }
  var sendReq = { payload: msgPayload, message_type: 'file-meta' };
  if (replyTo) sendReq.reply_to = replyTo;
  if (isRoom) {
    await Tapp.federation.sendRoomMessage(state.activeId, sendReq);
  } else {
    await Tapp.federation.sendMessage(state.activeId, sendReq);
  }

  try {
    Tapp.ui.showNotification({ title: lang.transferComplete || 'File sent', type: 'success' });
  } catch (e2) { /* ignore */ }
}

/**
 * Handle WS transfer_progress / transfer_completed / transfer_cancelled for
 * inbound federated file transfers (and outbound multi-tab).
 */
function handleTransferWsEvent(data) {
  if (!data || !data.type) return;
  if (!state.transferUi) state.transferUi = {};
  var tid = data.transfer_id || data.transferId || '';
  if (tid) {
    state.transferUi[tid] = {
      status: data.status || data.type,
      progress: data.progress != null ? Number(data.progress) : (state.transferUi[tid] && state.transferUi[tid].progress) || 0,
      chunks_completed: data.chunks_completed,
      chunks_total: data.chunks_total,
      updatedAt: Date.now(),
    };
  }
  try {
    if (data.type === 'transfer_progress') {
      var pct = Math.round(Number(data.progress) || 0);
      // Throttle toasts: 25% steps only
      var key = tid + ':' + Math.floor(pct / 25);
      if (!state.transferUi._lastToastKey || state.transferUi._lastToastKey !== key) {
        if (pct > 0 && pct < 100) {
          state.transferUi._lastToastKey = key;
          var prog = (lang.transferProgress || 'Receiving… {pct}%').replace('{pct}', String(pct));
          Tapp.ui.showNotification({ title: prog, type: 'info' });
        }
      }
    } else if (data.type === 'transfer_completed') {
      Tapp.ui.showNotification({
        title: lang.transferReceived || lang.transferComplete || 'File ready',
        type: 'success',
      });
      // Reload messages so file-meta / ready status updates
      if (typeof pollMessages === 'function') pollMessages(true);
    } else if (data.type === 'transfer_cancelled') {
      Tapp.ui.showNotification({
        title: lang.transferCancelled || 'Transfer cancelled',
        type: 'info',
      });
    }
  } catch (e) { /* ignore toast errors */ }
}

/** @deprecated use sendChunkedFileTransfer */
async function sendChannelFileTransfer(attach, text, replyTo) {
  return sendChunkedFileTransfer(attach, text, replyTo);
}

function pickFedContent(type) {
  var icons = { tapp: SVG_ICONS.tapp, brew: SVG_ICONS.brew, library: SVG_ICONS.library, report: SVG_ICONS.report };
  var titles = { tapp: lang.selectTapp, brew: lang.selectBrew, library: lang.selectLibrary, report: lang.selectReport };

  if (type === 'tapp') { openTappPicker(icons, titles); return; }
  if (type === 'brew') { openBrewPicker(icons, titles); return; }
  if (type === 'library') { openLibraryPicker(icons, titles); return; }
  if (type === 'report') { openReportPicker(icons, titles); return; }
}

/* ----- Shared overlay helpers ----- */
function createPickerOverlay(type, icons, titles) {
  var overlay = document.createElement('div');
  overlay.className = 'picker-overlay';
  var visual = sheetVisual({ type: type, rawSvg: icons[type], fallback: SVG_ICONS.file });
  applySheetAccent(overlay, visual.accent);
  overlay.innerHTML =
    '<div class="picker-sheet" role="dialog" aria-modal="true" aria-label="' + esc(titles[type]) + '">'
    + '<div class="picker-header">'
    + '<div class="picker-header-icon">' + visual.icon + '</div>'
    + '<div class="picker-header-text">'
    + '<div class="picker-header-title">' + esc(titles[type]) + '</div>'
    + '<div class="picker-header-sub">' + esc(lang.pickerPickOne || '') + '</div>'
    + '</div>'
    + '<button type="button" class="picker-close-btn" aria-label="' + esc(lang.dismiss || lang.close || 'Close') + '">&times;</button>'
    + '</div>'
    + '<div class="picker-search"><input placeholder="' + esc(lang.pickerSearchPlaceholder) + '" aria-label="' + esc(lang.pickerSearchPlaceholder) + '" /></div>'
    + '<div class="picker-body"></div>'
    + '<div class="picker-footer">'
    + '<button type="button" class="picker-footer-btn picker-btn-cancel">' + esc(lang.pickerCancel) + '</button>'
    + '<button type="button" class="picker-footer-btn picker-btn-confirm" disabled>' + esc(lang.pickerConfirm) + '</button>'
    + '</div>'
    + '</div>';
  var dismissPicker = function () { dismissPickerOverlay(overlay); };
  overlay.querySelector('.picker-close-btn').addEventListener('click', dismissPicker);
  overlay.querySelector('.picker-btn-cancel').addEventListener('click', dismissPicker);
  overlay.addEventListener('click', function (e) { if (e.target === overlay) dismissPicker(); });
  overlay.dataset.aroDismissable = '1';
  document.body.appendChild(overlay);
  return overlay;
}

function showPickerLoading(body) {
  body.innerHTML = '<div class="picker-loading"><div class="picker-loading-spinner"></div>' + esc(lang.pickerLoading) + '</div>';
}
function showPickerEmpty(body) {
  body.innerHTML = '<div class="picker-empty">' + esc(lang.pickerEmpty) + '</div>';
}

/** getItems: array or () => array (avoids stale empty-list closures after async load). */
function bindPickerSearch(overlay, getItems, renderFn, filterFn) {
  var searchInput = overlay.querySelector('.picker-search input');
  if (!searchInput) return;
  searchInput.addEventListener('input', function () {
    var allItems = typeof getItems === 'function' ? getItems() : getItems;
    if (!allItems) allItems = [];
    var q = this.value.trim().toLowerCase();
    if (!q) { renderFn(allItems); return; }
    renderFn(allItems.filter(function (item) { return filterFn(item, q); }));
  });
}

function dismissPickerOverlay(overlay) {
  if (!overlay) return;
  aroDismiss(overlay, { remove: true, ms: 170 });
}

function bindPickerItems(body, items, confirmBtn, onSelect) {
  bindFaviconFallbacks(body);
  body.querySelectorAll('.picker-item').forEach(function (el) {
    el.addEventListener('click', function () {
      body.querySelectorAll('.picker-item').forEach(function (e) { e.classList.remove('selected'); });
      el.classList.add('selected');
      onSelect(items[parseInt(el.dataset.idx)]);
      confirmBtn.disabled = false;
    });
  });
}

/* ----- Tapp picker (real list from SDK) ----- */
function openTappPicker(icons, titles) {
  var type = 'tapp';
  var overlay = createPickerOverlay(type, icons, titles);
  var body = overlay.querySelector('.picker-body');
  var confirmBtn = overlay.querySelector('.picker-btn-confirm');
  var selectedTapp = null;
  var allTapps = [];

  showPickerLoading(body);

  Tapp.tappList.list().then(function (tapps) {
    allTapps = tapps || [];
    renderTappItems(allTapps);
  }).catch(function () { showPickerEmpty(body); });

  function renderTappItems(items) {
    if (!items.length) { showPickerEmpty(body); return; }
    body.innerHTML = items.map(function (t, i) {
      var meta = t.version || '';
      if (t.status) meta += (meta ? ' · ' : '') + t.status;
      var tv = sheetVisual({ rawSvg: t.iconSvg || '', favicon: t.icon || '', fallback: SVG_ICONS.tapp });
      return '<button type="button" class="picker-item" data-idx="' + i + '">'
        + '<div class="picker-item-icon"' + sheetVisualAttrs(tv, 'tapp') + '>' + tv.icon + '</div>'
        + '<div class="picker-item-body"><div class="picker-item-name">' + esc(t.name) + '</div>'
        + '<div class="picker-item-meta">' + esc(t.id + (meta ? ' · ' + meta : '')) + '</div>'
        + (t.description ? '<div class="picker-item-meta">' + esc(t.description) + '</div>' : '')
        + '</div><div class="picker-item-check">✓</div></button>';
    }).join('');
    bindPickerItems(body, items, confirmBtn, function (t) { selectedTapp = t; });
  }

  bindPickerSearch(overlay, function () { return allTapps; }, renderTappItems, function (t, q) {
    return (t.name || '').toLowerCase().indexOf(q) !== -1
      || (t.id || '').toLowerCase().indexOf(q) !== -1
      || (t.description || '').toLowerCase().indexOf(q) !== -1;
  });

  confirmBtn.addEventListener('click', function () {
    if (!selectedTapp) return;
    confirmBtn.disabled = true;
    var pending = {
      type: type,
      name: selectedTapp.name,
      desc: selectedTapp.description || selectedTapp.id,
      icon: icons[type],
      label: lang.attachTapp || 'Tapp',
      tappId: selectedTapp.id,
      tappVersion: selectedTapp.version || '',
      tappIcon: selectedTapp.iconSvg || selectedTapp.icon || ''
    };
    // P0: resolve portable store catalog URL so peer installFromStore works.
    // (InstallFromStoreRequest.source is catalog URL/id — NEVER the mode "store".)
    // Optional: direct package for offline/custom as secondary path.
    var finish = function () {
      setPendingAttach(pending);
      dismissPickerOverlay(overlay);
    };
    var resolveStore = (typeof Tapp.tappList !== 'undefined' && typeof Tapp.tappList.resolveStoreSource === 'function')
      ? Tapp.tappList.resolveStoreSource(selectedTapp.id).then(function (res) {
          if (res && res.storeSource) {
            pending.storeSource = res.storeSource;
            pending.storeSourceMatched = !!res.matchedApp;
          }
        }).catch(function (e) {
          console.warn('[Aro] resolveStoreSource failed', e);
        })
      : Promise.resolve();
    // Package snapshot for reliability (storeSource remains P0). Cap under
    // channel/room 32 MiB payload + bridge envelope (bridge / backend).
    var TAPP_SHARE_PACKAGE_MAX = 28 * 1024 * 1024;
    var resolvePkg = (typeof Tapp.tappList !== 'undefined' && typeof Tapp.tappList.getInstallPackage === 'function')
      ? Tapp.tappList.getInstallPackage(selectedTapp.id, { maxBytes: TAPP_SHARE_PACKAGE_MAX })
          .then(function (pkgRes) {
            if (pkgRes && pkgRes.package) {
              pending.installPackage = pkgRes.package;
            } else if (pkgRes && pkgRes.reason) {
              pending.installPackageOmitted = pkgRes.reason;
            }
          })
          .catch(function (e) {
            console.warn('[Aro] getInstallPackage failed; store-only share', e);
          })
      : Promise.resolve();
    Promise.all([resolveStore, resolvePkg]).then(finish).catch(finish);
  });
}

/* ----- Brew picker (real list from SDK) ----- */
function openBrewPicker(icons, titles) {
  var type = 'brew';
  var overlay = createPickerOverlay(type, icons, titles);
  var body = overlay.querySelector('.picker-body');
  var confirmBtn = overlay.querySelector('.picker-btn-confirm');
  var selectedBrew = null;
  var allBrews = [];

  showPickerLoading(body);

  Tapp.brewList.list({ limit: 50 }).then(function (res) {
    allBrews = (res && res.items) || [];
    renderBrewItems(allBrews);
  }).catch(function () { showPickerEmpty(body); });

  function renderBrewItems(items) {
    if (!items.length) { showPickerEmpty(body); return; }
    body.innerHTML = items.map(function (b, i) {
      var meta = b.source_name || '';
      if (b.author) meta += (meta ? ' · ' : '') + b.author;
      if (b.published_at) meta += (meta ? ' · ' : '') + new Date(b.published_at).toLocaleDateString();
      var bv = sheetVisual({ favicon: b.source_icon || '', slug: b.source_name || '', fallback: SVG_ICONS.brew });
      return '<button type="button" class="picker-item" data-idx="' + i + '">'
        + '<div class="picker-item-icon"' + sheetVisualAttrs(bv, 'brew') + '>' + bv.icon + '</div>'
        + '<div class="picker-item-body"><div class="picker-item-name">' + esc(b.title) + '</div>'
        + (meta ? '<div class="picker-item-meta">' + esc(meta) + '</div>' : '')
        + (b.summary ? '<div class="picker-item-meta">' + esc(b.summary) + '</div>' : '')
        + '</div><div class="picker-item-check">✓</div></button>';
    }).join('');
    bindPickerItems(body, items, confirmBtn, function (b) { selectedBrew = b; });
  }

  bindPickerSearch(overlay, function () { return allBrews; }, renderBrewItems, function (b, q) {
    return (b.title || '').toLowerCase().indexOf(q) !== -1
      || (b.author || '').toLowerCase().indexOf(q) !== -1
      || (b.source_name || '').toLowerCase().indexOf(q) !== -1
      || (b.summary || '').toLowerCase().indexOf(q) !== -1;
  });

  confirmBtn.addEventListener('click', function () {
    if (!selectedBrew) return;
    var desc = selectedBrew.source_name || '';
    if (selectedBrew.author) desc += (desc ? ' · ' : '') + selectedBrew.author;
    // Source mark travels with the message so the receiver renders the site's
    // own icon without re-fetching a brew they may not have.
    setPendingAttach({
      type: type,
      name: selectedBrew.title,
      desc: desc,
      icon: icons[type],
      label: lang.attachBrew || 'Brew',
      brewId: selectedBrew.id,
      brewLink: selectedBrew.link,
      sourceIcon: selectedBrew.source_icon || '',
      sourceName: selectedBrew.source_name || '',
    });
    dismissPickerOverlay(overlay);
  });
}

/* ----- Library picker (platform data) ----- */
/**
 * Resolve stable platform slug for getData / cache paths.
 * listEnabled maps id/key → slug; keep defensive fallbacks for older hosts.
 */
function platformSlug(p) {
  if (!p) return '';
  if (p.key) return String(p.key);
  if (p.slug) return String(p.slug);
  if (p.id != null && p.id !== '' && !/^d+$/.test(String(p.id))) return String(p.id);
  return p.id != null ? String(p.id) : '';
}

/** Build a chat-safe library item snapshot (never id-only / blank title). */
function buildLibraryShareSnapshot(item, platformId) {
  var title = '';
  var contentType = '';
  var image = '';
  var itemId = '';
  var description = '';
  var meta = item && item.metadata && typeof item.metadata === 'object' ? item.metadata : null;
  if (item) {
    title = String(item.title || item.name || item.username || '').trim();
    contentType = String(item.type || item.content_type || item.subject_type || '').trim();
    image = String(item.image || item.cover || item.display_image || item.thumbnail || '').trim();
    if (!image && meta) {
      image = String(meta.image || meta.cover || meta.display_image || '').trim();
    }
    itemId = item.id != null && item.id !== ''
      ? String(item.id)
      : (item.subject_id != null ? String(item.subject_id)
        : (item.title_id != null ? String(item.title_id) : ''));
    description = String(item.description || item.summary || '').trim();
  }
  if (!title) title = itemId || (lang.shareUntitled || 'Untitled');
  var platform = platformId ? String(platformId) : '';
  var descParts = [];
  if (platform) descParts.push(platform);
  if (contentType) descParts.push(contentType);
  if (meta) {
    if (meta.playtime != null && meta.playtime !== '') descParts.push(String(meta.playtime) + ' min');
    else if (item && item.playtime != null) descParts.push(String(item.playtime) + ' min');
    if (meta.rate != null) descParts.push('★ ' + meta.rate);
    else if (meta.score != null) descParts.push('★ ' + meta.score);
  } else if (item) {
    if (item.score !== undefined && item.score !== null) descParts.push('★ ' + item.score);
    if (item.rate !== undefined && item.rate !== null) descParts.push('★ ' + item.rate);
    if (item.year) descParts.push(String(item.year));
  }
  if (!description) description = descParts.join(' · ');
  else if (descParts.length) description = descParts.join(' · ') + (description ? ' · ' + description : '');
  // Structured sender stats travel alongside the text snapshot so the recipient
  // renders the media card (playtime / watch progress / rating) without refetch.
  var statSource = {};
  if (item) { for (var ik in item) if (Object.prototype.hasOwnProperty.call(item, ik)) statSource[ik] = item[ik]; }
  if (meta) { for (var mk in meta) if (Object.prototype.hasOwnProperty.call(meta, mk)) statSource[mk] = meta[mk]; }
  var stats = extractLibraryStats(contentType || (item && item.type) || '', statSource);
  var music = extractMusicMeta(statSource);
  return {
    title: title,
    description: description,
    platform_id: platform,
    item_id: itemId,
    image: image,
    content_type: contentType || 'library',
    playtime_min: stats.playtimeMin,
    rating: stats.rating,
    progress_cur: stats.progressCur,
    progress_total: stats.progressTotal,
    artist: music.artist,
    album: music.album,
  };
}

function openLibraryPicker(icons, titles) {
  var type = 'library';
  var overlay = createPickerOverlay(type, icons, titles);
  var sheet = overlay.querySelector('.picker-sheet');
  var body = overlay.querySelector('.picker-body');
  var confirmBtn = overlay.querySelector('.picker-btn-confirm');
  var selectedItem = null;

  showPickerLoading(body);

  // Insert platform tabs before search
  var searchDiv = overlay.querySelector('.picker-search');
  var tabsDiv = document.createElement('div');
  tabsDiv.className = 'picker-tabs';
  sheet.insertBefore(tabsDiv, searchDiv);

  var allItems = [];
  var activePlatform = null;

  Tapp.platform.listEnabled().then(function (platforms) {
    if (!platforms || !platforms.length) {
      body.innerHTML = '<div class="picker-empty">' + esc(lang.libraryPickerEmpty || lang.pickerEmpty) + '</div>';
      return;
    }
    tabsDiv.innerHTML = platforms.map(function (p) {
      var slug = platformSlug(p);
      return '<button class="picker-tab" data-pid="' + esc(slug) + '">' + (p.icon && p.icon.length <= 4 ? '<span style="margin-right:3px">' + esc(p.icon) + '</span>' : '') + esc(p.name || slug) + '</button>';
    }).join('');
    selectPlatform(platformSlug(platforms[0]));
    tabsDiv.addEventListener('click', function (e) {
      var tab = e.target.closest('.picker-tab');
      if (!tab) return;
      selectPlatform(tab.dataset.pid);
    });
  }).catch(function () {
    body.innerHTML = '<div class="picker-empty">' + esc(lang.libraryPickerLoadFail || lang.loadFail || lang.pickerEmpty) + '</div>';
  });

  function selectPlatform(pid) {
    activePlatform = pid;
    allItems = [];
    selectedItem = null;
    confirmBtn.disabled = true;
    tabsDiv.querySelectorAll('.picker-tab').forEach(function (t) {
      t.classList.toggle('active', t.dataset.pid === pid);
    });
    showPickerLoading(body);
    // getData expects stable slug (steam), not numeric PK
    Tapp.platform.getData(pid, { limit: 50 }).then(function (res) {
      allItems = (res && res.items) || [];
      renderLibraryItems(allItems);
    }).catch(function () {
      body.innerHTML = '<div class="picker-empty">' + esc(lang.libraryPickerLoadFail || lang.loadFail || lang.pickerEmpty) + '</div>';
    });
  }

  function libraryItemCover(item) {
    if (!item) return '';
    return item.image || item.cover || item.display_image || item.thumbnail
      || (item.metadata && (item.metadata.image || item.metadata.cover)) || '';
  }

  function libraryItemMeta(item) {
    var meta = item.platform || activePlatform || '';
    var itemType = item.type || item.content_type || '';
    if (itemType) meta += (meta ? ' · ' : '') + itemType;
    var m = item.metadata || {};
    if (item.score !== undefined && item.score !== null) meta += (meta ? ' · ' : '') + '★ ' + item.score;
    else if (m.rate != null) meta += (meta ? ' · ' : '') + '★ ' + m.rate;
    else if (m.score != null) meta += (meta ? ' · ' : '') + '★ ' + m.score;
    if (item.year) meta += (meta ? ' · ' : '') + item.year;
    else if (m.playtime != null && m.playtime !== '') meta += (meta ? ' · ' : '') + m.playtime + ' min';
    else if (item.playtime != null) meta += (meta ? ' · ' : '') + item.playtime + ' min';
    return meta;
  }

  function renderLibraryItems(items) {
    if (!items.length) {
      body.innerHTML = '<div class="picker-empty">' + esc(lang.libraryPickerEmpty || lang.pickerEmpty) + '</div>';
      return;
    }
    body.innerHTML = items.map(function (item, i) {
      var name = item.title || item.name || item.username || item.id || ('Item ' + (i + 1));
      var meta = libraryItemMeta(item);
      var cover = libraryItemCover(item);
      var lv = sheetVisual({ cover: safeIconUrl(cover), slug: item.platform || activePlatform || '', fallback: SVG_ICONS.library });
      return '<button type="button" class="picker-item" data-idx="' + i + '">'
        + '<div class="picker-item-icon"' + sheetVisualAttrs(lv, 'library') + '>' + lv.icon + '</div>'
        + '<div class="picker-item-body"><div class="picker-item-name">' + esc(name) + '</div>'
        + (meta ? '<div class="picker-item-meta">' + esc(meta) + '</div>' : '')
        + '</div><div class="picker-item-check">✓</div></button>';
    }).join('');
    bindPickerItems(body, items, confirmBtn, function (item) { selectedItem = item; });
  }

  bindPickerSearch(overlay, function () { return allItems; }, renderLibraryItems, function (item, q) {
    var hay = ((item.title || item.name || item.username || item.id || '') + ' ' + (item.type || item.content_type || '') + ' ' + (item.description || '')).toLowerCase();
    return hay.indexOf(q) !== -1;
  });

  confirmBtn.addEventListener('click', function () {
    if (!selectedItem) return;
    var snap = buildLibraryShareSnapshot(selectedItem, activePlatform);
    // Snapshot fields travel with the message so recipients render without re-fetch.
    setPendingAttach({
      type: type,
      name: snap.title,
      desc: snap.description,
      icon: icons[type],
      label: lang.attachLibrary,
      platformId: snap.platform_id,
      itemId: snap.item_id,
      image: snap.image,
      contentType: snap.content_type,
      summary: snap.title,
      playtimeMin: snap.playtime_min,
      rating: snap.rating,
      progressCur: snap.progress_cur,
      progressTotal: snap.progress_total,
      artist: snap.artist,
      album: snap.album,
    });
    dismissPickerOverlay(overlay);
  });
}

/* ----- Report picker ----- */
function openReportPicker(icons, titles) {
  var type = 'report';
  var overlay = createPickerOverlay(type, icons, titles);
  var body = overlay.querySelector('.picker-body');
  var confirmBtn = overlay.querySelector('.picker-btn-confirm');
  var selectedReport = null;
  var allReports = [];

  showPickerLoading(body);

  Tapp.report.listReports().then(function (res) {
    allReports = (res && res.reports) || [];
    renderReportItems(allReports);
  }).catch(function () { showPickerEmpty(body); });

  function renderReportItems(reports) {
    if (!reports.length) { showPickerEmpty(body); return; }
    body.innerHTML = reports.map(function (r, i) {
      var name = r.summary || r.type || ('Report ' + (i + 1));
      var meta = '';
      if (r.platform) meta += r.platform;
      if (r.type) meta += (meta ? ' · ' : '') + r.type;
      if (r.createdAt) meta += (meta ? ' · ' : '') + new Date(r.createdAt).toLocaleDateString();
      var rv = sheetVisual({ slug: r.platform || '', fallback: SVG_ICONS.report });
      return '<button type="button" class="picker-item" data-idx="' + i + '">'
        + '<div class="picker-item-icon"' + sheetVisualAttrs(rv, 'report') + '>' + rv.icon + '</div>'
        + '<div class="picker-item-body"><div class="picker-item-name">' + esc(name) + '</div>'
        + (meta ? '<div class="picker-item-meta">' + esc(meta) + '</div>' : '')
        + '</div><div class="picker-item-check">✓</div></button>';
    }).join('');
    bindPickerItems(body, reports, confirmBtn, function (r) { selectedReport = r; });
  }

  bindPickerSearch(overlay, function () { return allReports; }, renderReportItems, function (r, q) {
    return ((r.summary || '') + ' ' + (r.type || '') + ' ' + (r.platform || '')).toLowerCase().indexOf(q) !== -1;
  });

  confirmBtn.addEventListener('click', function () {
    if (!selectedReport) return;
    var snap = buildReportShareSnapshot(selectedReport);
    var name = snap.summary || selectedReport.type || 'Report';
    var desc = snap.platform || '';
    if (selectedReport.createdAt) desc += (desc ? ' · ' : '') + new Date(selectedReport.createdAt).toLocaleDateString();
    // Snapshot fields travel with the message so recipients can render without getReport (user-scoped).
    setPendingAttach({
      type: type,
      name: name,
      desc: desc,
      icon: icons[type],
      label: lang.attachReport,
      reportId: snap.report_id,
      summary: snap.summary,
      platform: snap.platform,
      contentPreview: snap.content_preview,
    });
    dismissPickerOverlay(overlay);
  });
}

/**
 * Build a chat/federation-safe report snapshot.
 * Field names: report_id, summary, platform, content_preview.
 * Mirrored by frontend/src/tapp/utils/reportShareSnapshot.ts (unit-tested).
 * Does not include full report JSON — only what chat recipients need to render.
 */
function buildReportShareSnapshot(report) {
  var reportId = report && (report.id != null ? report.id : report.report_id);
  var platform = (report && (report.platform || report.platform_id)) || '';
  var summary = '';
  if (report) {
    if (report.summary) summary = String(report.summary);
    else if (report.report_title) summary = String(report.report_title);
    else if (report.type) summary = String(report.type);
  }
  var preview = '';
  if (report) {
    if (report.content_preview) preview = String(report.content_preview);
    else if (report.summary) preview = String(report.summary);
    else preview = formatReportContentBody(report.content, '');
  }
  preview = stripHtmlPreview(preview || '').trim();
  if (preview.length > 500) preview = preview.slice(0, 500);
  if (!summary) summary = preview ? preview.slice(0, 80) : 'Report';
  return {
    report_id: reportId != null && reportId !== '' ? String(reportId) : '',
    summary: summary,
    platform: platform ? String(platform) : '',
    content_preview: preview,
  };
}

/**
 * Format structured report content into readable plain text.
 * Never produces "[object Object]" — walks known fields (summary, insights, 综合分析).
 * Mirrored by formatReportContentBody in reportShareSnapshot.ts.
 */
function formatReportContentBody(content, fallbackPreview) {
  if (content == null || content === '') return fallbackPreview || '';
  if (typeof content === 'string') {
    var s = stripHtmlPreview(content).trim();
    return s || fallbackPreview || '';
  }
  if (typeof content === 'number' || typeof content === 'boolean') return String(content);
  if (typeof content !== 'object') return fallbackPreview || '';

  var parts = [];
  if (typeof content.summary === 'string' && content.summary.trim()) {
    parts.push(content.summary.trim());
  }
  if (Array.isArray(content.insights)) {
    for (var i = 0; i < content.insights.length; i++) {
      var item = content.insights[i];
      if (item == null || item === '') continue;
      if (typeof item === 'string' || typeof item === 'number') {
        parts.push('• ' + String(item));
      }
    }
  }
  var analysis = content['综合分析'];
  if (analysis && typeof analysis === 'object') {
    if (typeof analysis['总体画像'] === 'string' && analysis['总体画像'].trim()) {
      parts.push(String(analysis['总体画像']).trim());
    } else if (analysis.content && typeof analysis.content === 'object' && typeof analysis.content['总体画像'] === 'string') {
      parts.push(String(analysis.content['总体画像']).trim());
    }
  } else if (typeof analysis === 'string' && analysis.trim()) {
    parts.push(analysis.trim());
  }
  // Use fromCharCode so this survives PAGE_MOD template-literal embedding (avoids '\\n' escape issues).
  var nl = String.fromCharCode(10);
  if (parts.length) return parts.join(nl);

  // Last resort: primitive key/value lines (not JSON dump, not [object Object])
  try {
    var keys = Object.keys(content);
    for (var k = 0; k < keys.length && k < 12; k++) {
      var v = content[keys[k]];
      if (v == null) continue;
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        var line = String(v).trim();
        if (line) parts.push(keys[k] + ': ' + line);
      }
    }
  } catch (e) { /* ignore */ }
  if (parts.length) return parts.join(nl);
  return fallbackPreview || '';
}

/**
 * Structured HTML sections for report *detail* (owner getReport path).
 * Complementary to formatReportContentBody (plain text used for share snapshots).
 * Never esc() objects — only primitives/arrays of primitives.
 */
function formatReportFieldValueHtml(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    var s = String(value).trim();
    return s ? esc(s) : '';
  }
  if (Array.isArray(value)) {
    var items = value.filter(function (v) {
      return v != null && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean');
    }).map(function (v) { return String(v).trim(); }).filter(Boolean);
    if (!items.length) return '';
    return '<ul>' + items.map(function (item) { return '<li>' + esc(item) + '</li>'; }).join('') + '</ul>';
  }
  return '';
}

function isSkippedReportContentKey(key) {
  return /^(id|platform|type|summary|created_?at|metadata|card_visuals|cardVisuals|theme_color|visual_style|decorative_emojis|card_subtitle|key_metric|theme_icon|icon_image_url|icon_prompt|background_elements|platform_reports)$/i.test(key)
    || key === '综合分析'
    || key === 'comprehensive_analysis';
}

function formatReportContentSectionsHtml(content) {
  if (content == null || content === '') return '';
  if (typeof content === 'string' || typeof content === 'number' || typeof content === 'boolean') {
    var plain = String(content).trim();
    return plain ? '<div class="sheet-text sheet-scroll">' + esc(plain) + '</div>' : '';
  }
  if (typeof content !== 'object') return '';

  var sections = [];
  function pushSection(label, bodyHtml) {
    if (!bodyHtml) return;
    sections.push(
      '<div class="sheet-section">'
      + (label ? '<div class="sheet-label">' + esc(label) + '</div>' : '')
      + bodyHtml
      + '</div>'
    );
  }

  if (Array.isArray(content.insights) && content.insights.length) {
    pushSection(
      lang.reportInsights || 'Insights',
      formatReportFieldValueHtml(content.insights)
    );
  }

  var analysis = content['综合分析'] || content.comprehensive_analysis;
  if (analysis && typeof analysis === 'object') {
    var analysisParts = [];
    Object.keys(analysis).forEach(function (k) {
      if (isSkippedReportContentKey(k)) return;
      var fieldHtml = formatReportFieldValueHtml(analysis[k]);
      if (!fieldHtml) return;
      analysisParts.push(
        '<div class="sheet-section" style="margin-bottom:10px">'
        + '<div class="sheet-label">' + esc(k) + '</div>'
        + '<div class="sheet-text">' + fieldHtml + '</div>'
        + '</div>'
      );
    });
    if (analysisParts.length) {
      pushSection(lang.reportAnalysis || 'Analysis', analysisParts.join(''));
    }
  } else if (typeof analysis === 'string' && analysis.trim()) {
    pushSection(lang.reportAnalysis || 'Analysis', '<div class="sheet-text">' + esc(analysis.trim()) + '</div>');
  }

  Object.keys(content).forEach(function (k) {
    if (isSkippedReportContentKey(k) || k === 'insights') return;
    var fieldHtml = formatReportFieldValueHtml(content[k]);
    if (!fieldHtml) return;
    pushSection(k, '<div class="sheet-text">' + fieldHtml + '</div>');
  });

  if (!sections.length) return '';
  return '<div class="sheet-section sheet-scroll" style="gap:14px">' + sections.join('') + '</div>';
}

/** Full structured detail HTML: summary / platform / type / date + sectioned content. */
function renderReportDetailBodyHtml(detail) {
  detail = detail || {};
  var content = detail.content;
  var summary = detail.summary || '';
  var platform = detail.platform || '';
  var type = detail.type || '';
  var createdAt = detail.createdAt || detail.created_at || '';

  if (content && typeof content === 'object') {
    if (!summary && content.summary) summary = content.summary;
    if (!platform && content.platform) platform = content.platform;
    if (!createdAt && (content.createdAt || content.created_at)) {
      createdAt = content.createdAt || content.created_at;
    }
  }

  var title = summary || detail.name || type || (lang.attachReport || 'Report');
  var metaParts = [];
  if (platform) metaParts.push(platform);
  if (type) metaParts.push(type);
  if (createdAt) {
    try {
      var d = new Date(createdAt);
      if (!isNaN(d.getTime())) metaParts.push(d.toLocaleDateString(currentLocale));
    } catch (e) { /* ignore */ }
  }

  var html = '<div class="sheet-pad">';
  html += sheetMetaHtml(metaParts);
  // When summary *is* the title the sheet header already shows it; only render
  // it here when the header title came from somewhere else (name / type).
  if (summary && summary !== title) {
    html += '<div class="sheet-section">'
      + '<div class="sheet-label">' + esc(lang.reportSummary || 'Summary') + '</div>'
      + '<div class="sheet-text">' + esc(summary) + '</div>'
      + '</div>';
  }

  var contentHtml = formatReportContentSectionsHtml(content);
  if (contentHtml) {
    html += contentHtml;
  } else if (!summary) {
    // Fall back to plain-text formatter when no sectionable fields.
    // .sheet-desc is pre-wrap, so newlines survive without <br> splicing.
    var plain = formatReportContentBody(content, '');
    if (plain) html += '<div class="sheet-desc sheet-scroll">' + esc(plain) + '</div>';
  }
  html += '</div>';
  return html;
}

function setPendingAttach(attach) {
  state.pendingAttach = attach;
  renderAttachPreview();
  updateSendState();
}

function clearPendingAttach() {
  state.pendingAttach = null;
  var preview = $('attach-preview');
  if (preview) { preview.style.display = 'none'; preview.innerHTML = ''; }
  // Reset file inputs
  var fi = $('attach-file-input'); if (fi) fi.value = '';
  var ii = $('attach-image-input'); if (ii) ii.value = '';
  updateSendState();
}

function renderAttachPreview() {
  var preview = $('attach-preview');
  if (!preview || !state.pendingAttach) return;
  var a = state.pendingAttach;
  var html = '';
  if (a.type === 'image' && a.data) {
    html += '<div class="attach-preview-thumb"><img src="' + esc(a.data) + '" alt="" /></div>';
  } else if (a.type === 'file') {
    html += '<div class="attach-preview-icon attach-icon-file" style="background:rgba(245,158,11,.1)">' + SVG_ICONS.file + '</div>';
  } else {
    var iconBg = { tapp: 'rgba(var(--tapp-primary-rgb,100,100,255),.1)', brew: 'rgba(34,197,94,.1)', library: 'rgba(168,85,247,.1)', report: 'rgba(239,68,68,.1)' };
    html += '<div class="attach-preview-icon" style="background:' + (iconBg[a.type] || 'rgba(128,128,128,.06)') + '">' + (a.icon || SVG_ICONS.file) + '</div>';
  }
  html += '<div class="attach-preview-info">'
    + '<div class="attach-preview-name">' + esc(a.name || '') + '</div>'
    + '<div class="attach-preview-meta">' + (a.size ? formatFileSize(a.size) : (a.label || a.type)) + '</div>'
    + '</div>'
    + '<button type="button" class="attach-preview-remove" id="attach-remove" title="' + esc(lang.remove || lang.dismiss || 'Remove') + '" aria-label="' + esc(lang.remove || lang.dismiss || 'Remove') + '">&times;</button>';
  preview.innerHTML = html;
  preview.style.display = 'flex';
  aroPlayEnter(preview, 'aro-attach-enter');
  var removeBtn = $('attach-remove');
  if (removeBtn) removeBtn.addEventListener('click', clearPendingAttach);
}
`

const PAGE_MOD_CHAT = `\
// ==================== Render: Conversation List ====================
function buildConversationItems() {
  var items = [];
  state.channels.forEach(function (ch) {
    items.push({
      kind: 'channel', id: ch.channel_id,
      name: ch.remote_actor_name || (ch.remote_actor_url || '').split('/').pop() || '?',
      avatar: ch.remote_actor_avatar || '',
      preview: lang.dm,
      unread: ch.unread_count || 0,
      status: ch.status,
      initiatedBy: ch.initiated_by,
      sortTime: ch.last_activity_at || ch.created_at || '',
      actorUrl: ch.remote_actor_url || '',
    });
  });
  state.rooms.forEach(function (rm) {
    var mstatus = rm.my_membership_status || rm.membership_status || 'active';
    items.push({
      kind: 'room', id: rm.room_id,
      name: rm.name || '?',
      avatar: rm.avatar_url || '',
      preview: mstatus === 'pending'
        ? (lang.pending || 'Pending')
        : ((rm.member_count || 0) + ' ' + lang.members),
      unread: rm.unread_count || 0,
      status: mstatus === 'pending' ? 'pending' : undefined,
      initiatedBy: mstatus === 'pending' ? 'remote' : undefined,
      sortTime: rm.last_message_at || rm.created_at || '',
      actorUrl: '',
    });
  });
  items.sort(function (a, b) { return (b.sortTime || '').localeCompare(a.sortTime || ''); });
  return items;
}

function filterConversationItems(items, query) {
  var q = normalizeSearchQuery(query);
  if (!q) return items;
  return items.filter(function (item) {
    return matchesSearch(q, [item.name, item.preview, item.actorUrl, item.kind === 'channel' ? lang.dm : lang.members]);
  });
}

function renderConvList() {
  var list = $('conv-list');
  if (!list) return;

  var allItems = buildConversationItems();
  var q = (state.search && state.search.conv) || '';
  var items = filterConversationItems(allItems, q);

  if (allItems.length === 0) {
    list.innerHTML = '<div class="conv-empty conv-empty-fill"><span style="display:flex;flex-direction:column;gap:6px;align-items:center;max-width:200px">'
      + '<span style="font-weight:600;font-size:13px;color:var(--text-primary,#333)">' + esc(lang.noConv || lang.title || 'Messenger') + '</span>'
      + '<span style="font-size:12px;line-height:1.45;opacity:.8">' + esc(lang.noConvHint || lang.selectHint || 'Start a chat with +') + '</span></span></div>';
    return;
  }

  if (items.length === 0) {
    list.innerHTML = searchNoResultsHtml();
    return;
  }

  var html = '';
  items.forEach(function (item) {
    var isActive = item.id === state.activeId;
    var avatarClass = item.kind === 'channel' ? 'avatar-channel' : 'avatar-room';
    var rel = item.sortTime ? relTimeStr(item.sortTime) : '';
    html += '<button class="conv-item' + (isActive ? ' conv-active' : '') + (item.unread > 0 ? ' conv-unread' : '') + '" data-kind="' + item.kind + '" data-id="' + esc(item.id) + '">'
      + '<span class="conv-accent" aria-hidden="true"></span>'
      + '<div class="conv-avatar ' + avatarClass + '">' + avatarContentHtml(item.avatar || '', item.name) + '</div>'
      + '<div class="conv-info">'
      + '<div class="conv-top">'
      + '<span class="conv-name">' + esc(item.name) + '</span>'
      + (rel ? '<span class="conv-time">' + esc(rel) + '</span>' : '')
      + '</div>'
      + '<div class="conv-bottom">'
      + '<span class="conv-preview">' + esc(item.preview) + '</span>';
    if (item.unread > 0) {
      html += '<span class="conv-badge">' + (item.unread > 9 ? '9+' : item.unread) + '</span>';
    }
    if (item.status === 'closed') {
      html += '<span class="conv-closed">' + esc(lang.closed) + '</span>';
    }
    if (item.status === 'pending' && item.initiatedBy === 'remote') {
      html += '<span class="conv-pending">' + esc(lang.pending) + '</span>';
    }
    html += '</div></div></button>';
  });
  list.innerHTML = html;

  list.querySelectorAll('.conv-item').forEach(function (el) {
    el.addEventListener('click', function () {
      openConversation(el.dataset.kind, el.dataset.id);
    });
  });
}

// ==================== Render: Pinned Bar ====================
state.pinnedBarDismissed = false;

function renderPinnedBar() {
  var bar = $('pinned-bar');
  if (!bar) return;
  if (state.pinnedBarDismissed) { bar.style.display = 'none'; return; }
  var pinned = [];
  for (var i = 0; i < state.messages.length; i++) {
    if (state.messages[i].is_pinned) pinned.push(state.messages[i]);
  }
  if (pinned.length === 0) { bar.style.display = 'none'; return; }
  var last = pinned[pinned.length - 1];
  var text = getPayloadText(last.payload) || '';
  if (!text && last.payload) {
    text = last.payload.title || last.payload.filename || '';
  }
  bar.style.display = '';
  bar.innerHTML = '<span class="pinned-bar-icon"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 11V4a1 1 0 011-1h4a1 1 0 011 1v7"/><path d="M5 17h14"/><path d="M7 11l-2 6h14l-2-6"/></svg></span>'
    + '<div class="pinned-bar-body">'
    + '<span class="pinned-bar-label">' + esc(lang.pinnedMsg) + (pinned.length > 1 ? ' (' + pinned.length + ')' : '') + '</span>'
    + '<span class="pinned-bar-text">' + esc(text) + '</span>'
    + '</div>'
    + '<button type="button" class="pinned-bar-close" id="pinned-bar-close" title="' + esc(lang.dismiss || 'Dismiss') + '" aria-label="' + esc(lang.dismiss || 'Dismiss') + '">&times;</button>';
  var closeBtn = $('pinned-bar-close');
  if (closeBtn) closeBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    state.pinnedBarDismissed = true;
    bar.style.display = 'none';
  });
  bar.onclick = function () {
    var msgEl = document.querySelector('[data-msg-id="' + last.message_id + '"]');
    if (msgEl) msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
}

// ==================== Message Context Menu ====================
var _msgMenu = null;
var _longPressTimer = null;
var _msgMenuIgnoreUntil = 0;

function closeMsgMenu() {
  if (!_msgMenu) return;
  var menu = _msgMenu;
  _msgMenu = null;
  aroDismiss(menu, { remove: true, ms: 120 });
}

function onMsgMenuOutside(e) {
  if (!_msgMenu) return;
  if (Date.now() < _msgMenuIgnoreUntil) return;
  // Keep open when interacting with the menu itself
  if (_msgMenu.contains(e.target)) return;
  // Opening control (⋯) handles its own toggle
  if (e.target && e.target.closest && e.target.closest('.msg-more-btn')) return;
  closeMsgMenu();
}

// Single document listeners (not re-bound per render)
document.addEventListener('click', onMsgMenuOutside);
document.addEventListener('contextmenu', onMsgMenuOutside);

function showMsgMenu(msgEl, x, y) {
  closeMsgMenu();
  var msgId = msgEl.dataset.msgId;
  if (!msgId) return;
  var msg = null;
  for (var i = 0; i < state.messages.length; i++) {
    if (state.messages[i].message_id === msgId) { msg = state.messages[i]; break; }
  }
  if (!msg) return;

  var isPinned = !!msg.is_pinned;
  var canPin = state.activeKind === 'room' && typeof Tapp.federation.pinRoomMessage === 'function';
  var pinSvg = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 11V4a1 1 0 011-1h4a1 1 0 011 1v7"/><path d="M5 17h14"/><path d="M7 11l-2 6h14l-2-6"/></svg>';
  var quoteSvg = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3z"/></svg>';
  var forwardSvg = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/><path d="M14 9l3 3-3 3"/><path d="M17 12H9"/></svg>';
  var copySvg = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';

  var menu = document.createElement('div');
  menu.className = 'msg-ctx-menu';
  menu.setAttribute('role', 'menu');
  var html = '';
  // Pin only for rooms — channel pin has no federation API
  if (canPin) {
    html += '<button type="button" class="msg-ctx-item" data-action="pin" role="menuitem">' + pinSvg + '<span>' + (isPinned ? esc(lang.msgUnpin) : esc(lang.msgPin)) + '</span></button>';
  }
  html += '<button type="button" class="msg-ctx-item" data-action="quote" role="menuitem">' + quoteSvg + '<span>' + esc(lang.msgQuote) + '</span></button>'
    + '<button type="button" class="msg-ctx-item" data-action="forward" role="menuitem">' + forwardSvg + '<span>' + esc(lang.msgForward) + '</span></button>'
    + '<button type="button" class="msg-ctx-item" data-action="copy" role="menuitem">' + copySvg + '<span>' + esc(lang.msgCopy || lang.copy || 'Copy') + '</span></button>';
  menu.innerHTML = html;

  document.body.appendChild(menu);
  var mw = menu.offsetWidth, mh = menu.offsetHeight;
  var ww = window.innerWidth, wh = window.innerHeight;
  var left = x + mw > ww ? ww - mw - 8 : x;
  var top = y + mh > wh ? wh - mh - 8 : y;
  if (left < 8) left = 8;
  if (top < 8) top = 8;
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
  _msgMenu = menu;
  // Ignore the opening gesture / synthetic click so long-press doesn't instantly dismiss
  _msgMenuIgnoreUntil = Date.now() + 400;

  menu.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    var action = btn.dataset.action;
    closeMsgMenu();
    if (action === 'pin') doTogglePin(msg);
    else if (action === 'quote') doQuote(msg);
    else if (action === 'forward') doForward(msg);
    else if (action === 'copy') doCopyMsg(msg);
  });
}

function bindMsgContextMenu(container) {
  // Bind once — renderMessages replaces innerHTML but reuses #messages
  if (!container || container.dataset.msgMenuBound === '1') return;
  container.dataset.msgMenuBound = '1';

  container.addEventListener('contextmenu', function (e) {
    var row = e.target.closest('.msg-row');
    if (!row) return;
    e.preventDefault();
    showMsgMenu(row, e.clientX, e.clientY);
  });
  container.addEventListener('touchstart', function (e) {
    var row = e.target.closest('.msg-row');
    if (!row) return;
    if (e.target.closest('a, button, img')) return;
    var touch = e.touches[0];
    if (!touch) return;
    var startX = touch.clientX;
    var startY = touch.clientY;
    _longPressTimer = setTimeout(function () {
      _longPressTimer = null;
      showMsgMenu(row, startX, startY);
    }, 500);
  }, { passive: true });
  container.addEventListener('touchend', function () {
    if (_longPressTimer) { clearTimeout(_longPressTimer); _longPressTimer = null; }
  });
  container.addEventListener('touchmove', function () {
    if (_longPressTimer) { clearTimeout(_longPressTimer); _longPressTimer = null; }
  });
  container.addEventListener('click', function (e) {
    var more = e.target.closest('.msg-more-btn');
    if (!more || !container.contains(more)) return;
    e.preventDefault();
    e.stopPropagation();
    var row = more.closest('.msg-row');
    if (!row) return;
    // Toggle if already open for this message
    if (_msgMenu && row.dataset.msgId && _msgMenu.dataset.forMsg === row.dataset.msgId) {
      closeMsgMenu();
      return;
    }
    var rect = more.getBoundingClientRect();
    showMsgMenu(row, rect.left, rect.bottom + 4);
    if (_msgMenu) _msgMenu.dataset.forMsg = row.dataset.msgId || '';
  });
}

async function doTogglePin(msg) {
  if (state.activeKind !== 'room' || !state.activeId) return;
  if (typeof Tapp.federation.pinRoomMessage !== 'function') return;
  var newPinned = !msg.is_pinned;
  try {
    await Tapp.federation.pinRoomMessage(state.activeId, msg.message_id, newPinned);
    msg.is_pinned = newPinned;
    state.messagesFp = messagesFingerprint(state.messages);
    state.pinnedBarDismissed = false;
    renderMessages();
  } catch (e) {
    try { Tapp.ui.showNotification({ title: lang.pinFail || 'Pin failed', type: 'error' }); } catch (e2) { /* ignore */ }
  }
}

function doQuote(msg) {
  // Pending/closed/rejected channel: cannot reply
  if (typeof isChannelComposerLocked === 'function' ? isChannelComposerLocked() : (
    state.activeKind === 'channel' && state.channelDetail && state.channelDetail.status === 'closed'
  )) {
    try {
      Tapp.ui.showNotification({
        title: (typeof channelComposerLockReason === 'function' && channelComposerLockReason())
          || lang.composerClosed || lang.channelNotAccepted || lang.closed,
        type: 'error'
      });
    } catch (e) { /* ignore */ }
    return;
  }
  var sender = typeof quoteSenderLabel === 'function'
    ? quoteSenderLabel(msg)
    : ((msg.sender_actor || '').split('/').pop() || '?');
  var text = typeof quotePreviewText === 'function'
    ? quotePreviewText(msg)
    : (getPayloadText(msg.payload) || (msg.payload && (msg.payload.title || msg.payload.filename)) || '');
  state.quoteMsg = {
    message_id: msg.message_id,
    sender: sender,
    text: text || (lang.newMessage || 'Message'),
  };
  renderQuotePreview();
  var input = $('msg-input');
  if (input && !input.disabled) input.focus();
}

function messageCopyText(msg) {
  if (!msg) return '';
  var payload = (typeof msg.payload === 'object' && msg.payload) ? msg.payload : {};
  var text = getPayloadText(msg.payload) || '';
  if (text) return text;
  if (payload.title) return String(payload.title);
  if (payload.filename) return String(payload.filename);
  if (payload.tapp_id) return String(payload.tapp_id);
  if (payload.brew_link) return String(payload.brew_link);
  return '';
}

async function doCopyMsg(msg) {
  var text = messageCopyText(msg);
  if (!text) {
    try { Tapp.ui.showNotification({ title: lang.copyFail, type: 'error' }); } catch (e) { /* ignore */ }
    return;
  }
  if (typeof copyTextToClipboard === 'function') {
    await copyTextToClipboard(text);
    return;
  }
  // Fallback if helper not yet available
  var ok = false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      ok = true;
    }
  } catch (e2) { ok = false; }
  if (!ok && typeof fallbackCopyText === 'function') ok = fallbackCopyText(text);
  try {
    Tapp.ui.showNotification({ title: ok ? lang.copied : lang.copyFail, type: ok ? 'success' : 'error' });
  } catch (e3) { /* ignore */ }
}

function clearQuote() {
  state.quoteMsg = null;
  renderQuotePreview();
}

function renderQuotePreview() {
  var wrap = $('quote-preview');
  if (!wrap) return;
  if (!state.quoteMsg) { wrap.style.display = 'none'; wrap.innerHTML = ''; return; }
  wrap.style.display = 'flex';
  wrap.innerHTML =
    '<div class="quote-preview-bar"></div>'
    + '<div class="quote-preview-body">'
    + '<div class="quote-preview-sender">' + esc((lang.quoteLabel || 'Replying to') + ' ' + state.quoteMsg.sender) + '</div>'
    + '<div class="quote-preview-text">' + esc(state.quoteMsg.text) + '</div>'
    + '</div>'
    + '<button type="button" class="quote-preview-close" id="quote-close" title="' + esc(lang.dismiss || lang.close || 'Close') + '" aria-label="' + esc(lang.dismiss || lang.close || 'Close') + '">&times;</button>';
  var closeBtn = $('quote-close');
  if (closeBtn) closeBtn.addEventListener('click', clearQuote);
  // Restart enter motion when quote target changes
  aroPlayEnter(wrap, 'aro-attach-enter');
}

/**
 * Build a self-contained payload for forwarding.
 * - Copies content; strips reply/quote context (forward is a new message).
 * - file-meta with only transfer_id is NOT portable across conversations
 *   (transfer ACL is bound to original channel/room). Reject unless inline data exists.
 */
function buildForwardPayload(msg) {
  var src = (typeof msg.payload === 'object' && msg.payload) ? msg.payload : {};
  var payload = {};
  try {
    payload = JSON.parse(JSON.stringify(src));
  } catch (e) {
    payload = Object.assign({}, src);
  }
  // Drop quote/reply snapshot from original (forward is not a reply)
  delete payload.quote_sender;
  delete payload.quote_text;
  delete payload.quote_id;

  var msgType = msg.message_type || 'text';
  if (msgType === 'text' || !msgType) {
    if (payload.transfer_id && payload.filename) msgType = 'file-meta';
    else if (payload.data && payload.mime_type && String(payload.mime_type).indexOf('image/') === 0) msgType = 'image';
    else if (payload.data && payload.filename) msgType = 'file';
  }

  // transfer_id alone: target conversation cannot download (wrong channel/room ACL)
  if ((msgType === 'file-meta' || payload.transfer_id) && !payload.data) {
    return {
      ok: false,
      error: lang.forwardTransferOnly
        || lang.forwardFileMetaFail
        || 'Large files cannot be forwarded yet — open the file and re-send it',
    };
  }

  // Cap accidental giant payloads (safety)
  if (payload.data && typeof payload.data === 'string' && payload.data.length > 6 * 1024 * 1024) {
    return {
      ok: false,
      error: lang.forwardTooLarge || lang.mediaTooLarge || 'Attachment too large to forward',
    };
  }

  return { ok: true, payload: payload, message_type: msgType };
}

function doForward(msg) {
  var built = buildForwardPayload(msg);
  if (!built.ok) {
    try {
      Tapp.ui.showNotification({
        title: lang.msgForward || 'Forward',
        message: built.error,
        type: 'error',
      });
    } catch (eBlock) { /* ignore */ }
    return;
  }

  var items = [];
  state.channels.forEach(function (ch) {
    // Skip non-writable DMs (pending/closed/rejected) as forward targets
    if (ch.status && ch.status !== 'active' && ch.status !== 'accepted') return;
    items.push({
      kind: 'channel',
      id: ch.channel_id,
      name: ch.remote_actor_name || (ch.remote_actor_url || '').split('/').pop() || '?',
      avatar: ch.remote_actor_avatar || '',
    });
  });
  state.rooms.forEach(function (rm) {
    var mst = rm.my_membership_status || rm.membership_status || 'active';
    if (mst === 'pending') return; // cannot forward into pending invite rooms
    items.push({
      kind: 'room',
      id: rm.room_id,
      name: rm.name || '?',
      avatar: rm.avatar_url || '',
    });
  });
  items = items.filter(function (it) { return it.id !== state.activeId; });
  if (items.length === 0) {
    try {
      Tapp.ui.showNotification({ title: lang.forwardEmpty || lang.noConv || 'No conversations', type: 'error' });
    } catch (e0) { /* ignore */ }
    return;
  }

  var overlay = document.createElement('div');
  overlay.className = 'forward-overlay';
  overlay.dataset.aroDismissable = '1';
  var searchPh = lang.searchForward || lang.searchConversations || lang.pickerSearchPlaceholder || 'Search…';
  overlay.innerHTML =
    '<div class="forward-sheet" role="dialog" aria-label="' + esc(lang.forwardTo) + '">'
    + '<div class="forward-header">'
    + '<div class="forward-title">' + esc(lang.forwardTo) + '</div>'
    + '<button type="button" class="forward-close" aria-label="' + esc(lang.dismiss || lang.close || 'Close') + '">&times;</button>'
    + '</div>'
    + '<div class="forward-search">'
    + '<input type="search" class="aro-search-input" autocomplete="off" enterkeyhint="search" placeholder="' + esc(searchPh) + '" aria-label="' + esc(searchPh) + '" />'
    + '</div>'
    + '<div class="forward-list"></div>'
    + '</div>';
  var listEl = overlay.querySelector('.forward-list');
  var searchInput = overlay.querySelector('.forward-search input');
  var dismissForward = function () { aroDismiss(overlay, { remove: true, ms: 160 }); };

  function renderForwardItems(filterQ) {
    var q = normalizeSearchQuery(filterQ);
    var filtered = !q ? items : items.filter(function (it) {
      return matchesSearch(q, [it.name, it.kind]);
    });
    listEl.innerHTML = '';
    if (filtered.length === 0) {
      listEl.innerHTML = '<div class="aro-search-empty" style="text-align:center;padding:16px">'
        + esc(lang.searchNoResults || lang.pickerEmpty || 'No matches') + '</div>';
      return;
    }
    filtered.forEach(function (it) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'forward-item';
      btn.innerHTML = '<div class="forward-item-avatar">' + avatarContentHtml(it.avatar || '', it.name) + '</div><span>' + esc(it.name) + '</span>';
      btn.addEventListener('click', async function () {
        if (btn.disabled) return;
        btn.disabled = true;
        dismissForward();
        try {
          var sendReq = { payload: built.payload, message_type: built.message_type };
          var fwdRes;
          if (it.kind === 'channel') {
            fwdRes = await Tapp.federation.sendMessage(it.id, sendReq);
          } else {
            fwdRes = await Tapp.federation.sendRoomMessage(it.id, sendReq);
          }
          if (typeof noteDeliveryEnqueue === 'function') noteDeliveryEnqueue(fwdRes);
          try { Tapp.ui.showNotification({ title: lang.forwardSuccess, type: 'success' }); } catch (e2) {}
          // If user is already in the target conversation, refresh
          if (state.activeKind === it.kind && state.activeId === it.id && typeof pollMessages === 'function') {
            try { await pollMessages(true); } catch (e3) { /* ignore */ }
          }
        } catch (e) {
          notifyError(lang.sendFail, e);
        }
      });
      listEl.appendChild(btn);
    });
  }

  renderForwardItems('');
  if (searchInput) {
    searchInput.addEventListener('input', function () {
      renderForwardItems(searchInput.value);
    });
  }
  overlay.querySelector('.forward-close').addEventListener('click', dismissForward);
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) dismissForward();
  });
  document.body.appendChild(overlay);
  if (searchInput) {
    try { searchInput.focus(); } catch (eFocus) { /* ignore */ }
  }
}

// ==================== Render: Messages ====================
function renderMessages(opts) {
  opts = opts || {};
  var container = $('messages');
  if (!container) return;
  state.pinnedBarDismissed = false;

  if (state.messages.length === 0) {
    if (state.chatLoadError) {
      container.innerHTML = '<div class="messages-empty messages-empty-error">'
        + '<div class="messages-empty-icon" style="color:#b91c1c">' + SVG_ICONS.file + '</div>'
        + '<p style="font-weight:600;color:#b91c1c">' + esc(lang.loadFail || 'Load failed') + '</p>'
        + '<p style="font-size:12px;opacity:.8;max-width:240px;line-height:1.45">' + esc(String(state.chatLoadError)) + '</p>'
        + '<button type="button" class="messages-retry-btn" id="messages-retry-btn">' + esc(lang.feedRetry || 'Try again') + '</button>'
        + '</div>';
      var retryBtn = $('messages-retry-btn');
      if (retryBtn) {
        retryBtn.addEventListener('click', function () {
          if (state.activeKind && state.activeId) openConversation(state.activeKind, state.activeId);
        });
      }
    } else {
      var hint = state.activeKind === 'channel' ? lang.emptyChatHint : lang.emptyRoomHint;
      container.innerHTML = '<div class="messages-empty"><div class="messages-empty-icon">'
        + (state.activeKind === 'channel' ? SVG_ICONS.channel : SVG_ICONS.room)
        + '</div><p>' + esc(hint) + '</p></div>';
    }
    var pb = $('pinned-bar'); if (pb) pb.style.display = 'none';
    state.skipMsgAppear = false;
    return;
  }
  // Successful non-empty load clears sticky error
  state.chatLoadError = null;

  var animateNew = !!opts.animateNew && !state.skipMsgAppear && !prefersReducedMotion();
  var newCount = Math.max(0, opts.newCount || 0);
  var appearFrom = animateNew ? Math.max(0, state.messages.length - newCount) : state.messages.length;
  state.skipMsgAppear = false;

  var html = '';
  var lastDayKey = '';
  state.messages.forEach(function (msg, idx) {
    var local = isLocalActor(msg.sender_actor);
    var sender = (msg.sender_actor || '').split('/').pop() || '?';
    var payload = (typeof msg.payload === 'object' && msg.payload) ? msg.payload : {};
    var msgType = msg.message_type || 'text';
    // Auto-detect content type from payload when message_type is generic
    if (msgType === 'text' || !msgType) {
      var knownShareTypes = { tapp: 1, brew: 1, library: 1, report: 1, image: 1, file: 1, 'file-meta': 1 };
      if (payload.content_type && typeof payload.content_type === 'string' && knownShareTypes[payload.content_type]) {
        msgType = payload.content_type;
      } else if (payload.tapp_id) {
        msgType = 'tapp';
      } else if (payload.brew_id || payload.brew_link) {
        msgType = 'brew';
      } else if (payload.report_id) {
        msgType = 'report';
      } else if (payload.platform_id && (payload.item_id || payload.title)) {
        msgType = 'library';
      } else if (payload.data && payload.mime_type && payload.mime_type.indexOf('image/') === 0) {
        msgType = 'image';
      } else if (payload.transfer_id && payload.filename) {
        msgType = 'file-meta';
      } else if (payload.data && payload.filename) {
        msgType = 'file';
      }
    }
    var text = getPayloadText(msg.payload);
    var pinned = msg.is_pinned ? '<span class="msg-pin"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 11V4a1 1 0 011-1h4a1 1 0 011 1v7"/><path d="M5 17h14"/><path d="M7 11l-2 6h14l-2-6"/></svg></span>' : '';

    // Resolve avatar and display name for remote messages
    var avatarUrl = '';
    var displayName = sender;
    if (!local) {
      if (state.activeKind === 'channel' && state.channelDetail) {
        avatarUrl = state.channelDetail.remote_actor_avatar || '';
        displayName = state.channelDetail.remote_actor_name || sender;
      } else if (state.activeKind === 'room') {
        var member = findMemberByActor(msg.sender_actor);
        if (member) {
          displayName = member.display_name || sender;
          avatarUrl = member.avatar_url || '';
        }
      }
    }

    // Day separators
    var dayKey = '';
    try {
      var md = new Date(msg.created_at);
      if (!isNaN(md)) dayKey = md.getFullYear() + '-' + md.getMonth() + '-' + md.getDate();
    } catch (e) { dayKey = ''; }
    if (dayKey && dayKey !== lastDayKey) {
      lastDayKey = dayKey;
      html += '<div class="msg-day-sep"><span class="msg-day-label">' + esc(dayLabel(msg.created_at)) + '</span></div>';
    }

    // Compact: same sender within ~5 minutes
    var prevMsg = idx > 0 ? state.messages[idx - 1] : null;
    var sameSender = prevMsg && sameActorUrl(prevMsg.sender_actor, msg.sender_actor);
    var compact = false;
    if (sameSender && prevMsg && prevMsg.created_at && msg.created_at) {
      try {
        var dt = Math.abs(new Date(msg.created_at) - new Date(prevMsg.created_at));
        compact = dt < 5 * 60 * 1000;
      } catch (e2) { compact = false; }
    }

    html += '<div class="msg-row ' + (local ? 'msg-local' : 'msg-remote') + (compact ? ' msg-compact' : '')
      + (idx >= appearFrom ? ' msg-appear' : '')
      + '" data-msg-id="' + esc(msg.message_id || '') + '">';
    if (!local) {
      if (compact) {
        html += '<div class="msg-avatar-spacer"></div>';
      } else {
        html += '<div class="msg-avatar">' + avatarContentHtml(avatarUrl, displayName) + '</div>';
      }
    }
    // Rich media / share cards carry their own surface — the card *is* the bubble
    // whenever there is no caption or quote to host alongside it.
    var isMediaMsg = (msgType === 'image' && payload.data)
      || msgType === 'file' || msgType === 'file-meta'
      || msgType === 'tapp' || msgType === 'brew' || msgType === 'library' || msgType === 'report';
    var bareMedia = isMediaMsg && !payload.text && !payload.quote_sender && !payload.quote_text;

    html += '<div class="msg-bubble ' + (local ? 'bubble-local' : 'bubble-remote')
      + (bareMedia ? ' bubble-media' : '') + '">';
    html += '<button type="button" class="msg-more-btn" title="' + esc(lang.msgActions || 'Message actions') + '" aria-label="' + esc(lang.msgActions || 'Message actions') + '">'
      + '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>'
      + '</button>';
    if (!local && !compact) {
      html += '<div class="msg-sender">' + esc(displayName) + '</div>';
    }

    // Render quoted message if present (snapshot travels in payload for both parties)
    if (payload.quote_sender || payload.quote_text || payload.quote_id) {
      var qId = payload.quote_id || msg.reply_to || '';
      html += '<button type="button" class="msg-quote-block"'
        + (qId ? ' data-quote-id="' + esc(qId) + '"' : '')
        + ' title="' + esc(lang.roomFilesJump || lang.historyJump || 'Show in chat') + '">'
        + '<div class="msg-quote-bar"></div>'
        + '<div class="msg-quote-content">'
        + '<div class="msg-quote-sender">' + esc(payload.quote_sender || '') + '</div>'
        + '<div class="msg-quote-text">' + esc(payload.quote_text || '') + '</div>'
        + '</div></button>';
    }

    // Render content based on message type
    if (msgType === 'image' && payload.data) {
      html += '<figure class="msg-media" data-media-idx="' + idx + '" tabindex="0" role="button"'
        + ' aria-label="' + esc(payload.filename || lang.attachImage || 'Image') + '">'
        + '<img class="msg-image" src="' + esc(payload.data) + '" alt="' + esc(payload.filename || '') + '" loading="lazy" />'
        + '<span class="msg-media-veil"></span>'
        + '<span class="msg-media-zoom">' + SVG_ICONS.expand + '</span>'
        + '</figure>';
      if (payload.text) html += '<div class="msg-text msg-caption">' + esc(payload.text) + '</div>';
    } else if (msgType === 'file' || msgType === 'file-meta') {
      var fileMeta = fileCardMeta(payload.filename, payload.mime_type);
      var hasInline = !!(payload.data);
      var hasTransfer = !!(payload.transfer_id);
      var canDownload = hasInline || hasTransfer;
      var metaBits = [];
      if (payload.size) metaBits.push(formatFileSize(payload.size));
      if (fileMeta.ext) metaBits.push(fileMeta.ext);
      if (hasTransfer && !hasInline) metaBits.push(lang.attachFile || 'file');
      var sizeLabel = metaBits.join(' · ');
      var fileTitle = canDownload
        ? (lang.downloadFile || payload.filename || 'File')
        : (payload.filename || lang.previewFile || 'File');
      // Inline base64 OR completed chunked transfer (transfer_id) → downloadable
      html += '<button type="button" class="msg-file-card' + (canDownload ? '' : ' msg-file-card-disabled') + '"'
        + ' data-kind="' + esc(fileMeta.kind) + '" data-file-idx="' + idx + '"'
        + (hasInline ? ' data-has-inline="1"' : '')
        + (hasTransfer ? ' data-transfer-id="' + esc(payload.transfer_id) + '"' : '')
        + (canDownload ? '' : ' disabled')
        + ' title="' + esc(fileTitle) + '">'
        + '<span class="msg-file-icon">' + fileMeta.glyph
        + (fileMeta.ext ? '<em class="msg-file-ext">' + esc(fileMeta.ext) + '</em>' : '') + '</span>'
        + '<span class="msg-file-info">'
        + '<span class="msg-file-name">' + esc(payload.filename || 'file') + '</span>'
        + '<span class="msg-file-size">' + esc(sizeLabel) + '</span>'
        + '</span>'
        + '<span class="msg-file-action">' + (canDownload ? SVG_ICONS.download : SVG_ICONS.cloud) + '</span>'
        + '</button>';
      if (payload.text) html += '<div class="msg-text msg-caption">' + esc(payload.text) + '</div>';
    } else if (msgType === 'tapp' || msgType === 'brew' || msgType === 'library' || msgType === 'report') {
      // A library share that carries cover art renders as an image-forward media
      // card (poster + sender attribution); everything else stays the compact row.
      var mediaView = (msgType === 'library') ? libraryMediaView(payload) : null;
      if (mediaView && safeIconUrl(mediaView.image)) {
        html += libraryMediaCardHtml(idx, payload, mediaView);
        if (payload.text) html += '<div class="msg-text msg-caption">' + esc(payload.text) + '</div>';
      } else {
      var shareIcons = { tapp: SVG_ICONS.tapp, brew: SVG_ICONS.brew, library: SVG_ICONS.library, report: SVG_ICONS.report };
      var shareCardId = 'share-card-' + idx;
      // Unified share fields so cards never render blank (type label + title + optional desc/cover).
      var shareView = resolveShareCardView(msgType, payload);
      var shareTitle = shareView.title;
      var shareDesc = shareView.description;
      var shareCover = shareView.image;
      // The icon carries the type, so it must be the real source mark where one
      // exists: cover art > the tapp's own icon > the source site / platform
      // logo > the generic type glyph (older messages carry no logo fields).
      var shareSlug = '';
      if (msgType === 'report') shareSlug = payload.platform || payload.platform_id || '';
      else if (msgType === 'library') shareSlug = payload.platform_id || '';
      else if (msgType === 'brew') shareSlug = payload.source_name || '';
      var shareLogo = platformLogoSvg(shareSlug);
      var shareFavicon = msgType === 'brew' ? safeIconUrl(payload.source_icon) : '';
      var iconContent = '';
      // '' | 'brand' (known platform → brand palette) | 'img' (favicon supplies
      // its own colors, so the card stays neutral)
      var iconMark = '';
      if (shareCover) {
        iconContent = '<img src="' + esc(shareCover) + '" alt="" />';
      } else if (msgType === 'tapp' && payload.tapp_icon) {
        iconContent = payload.tapp_icon; // raw SVG string
      } else if (shareFavicon) {
        // data-fallback: swapped in on load error (dead favicon / hotlink block)
        iconContent = '<img class="msg-share-favicon" src="' + esc(shareFavicon) + '" alt="" data-fallback="' + esc(msgType) + '" />';
        iconMark = 'img';
      } else if (shareLogo) {
        iconContent = shareLogo;
        iconMark = 'brand';
      } else {
        iconContent = payload.icon || shareIcons[msgType] || SVG_ICONS.file;
      }
      // Brand accent drives --acc (tile, wash, hover border) for known platforms.
      // Emitted as -l/-d pairs so the stylesheet — not inline style — picks the
      // theme variant; an inline --acc would outrank the .dark rule.
      var shareAccent = iconMark === 'brand' ? platformAccent(shareSlug) : null;
      var shareAccentStyle = shareAccent
        ? ';--acc-l:' + shareAccent.l + ';--acc-d:' + shareAccent.d
        : '';
      // Determine tapp share acceptance status from storage
      var tappAcceptStatus = '';
      if (msgType === 'tapp' && payload.tapp_id) {
        var stKey = 'tapp_accept_' + payload.tapp_id + '_' + idx;
        tappAcceptStatus = (state.tappAcceptMap && state.tappAcceptMap[stKey]) || '';
      }
      // Undecided incoming tapp share → decision card (no drill-in affordance yet)
      var shareNeedsDecision = (msgType === 'tapp' && !local && !tappAcceptStatus);
      html += '<div class="msg-share-card" id="' + shareCardId + '"'
        + ' style="cursor:pointer' + shareAccentStyle + '" data-type="' + esc(msgType) + '"'
        + (payload.tapp_id ? ' data-tapp-id="' + esc(payload.tapp_id) + '"' : '')
        + (payload.tapp_version ? ' data-tapp-version="' + esc(payload.tapp_version) + '"' : '')
        + (payload.tapp_name ? ' data-tapp-name="' + esc(payload.tapp_name) + '"' : '')
        + ((payload.store_source || payload.storeSource) ? ' data-store-source="' + esc(payload.store_source || payload.storeSource) + '"' : '')
        + (payload.brew_id ? ' data-brew-id="' + esc(String(payload.brew_id)) + '"' : '')
        + (payload.brew_link ? ' data-brew-link="' + esc(payload.brew_link) + '"' : '')
        + (payload.platform_id ? ' data-platform-id="' + esc(payload.platform_id) + '"' : '')
        + (payload.item_id ? ' data-item-id="' + esc(String(payload.item_id)) + '"' : '')
        + (shareCover ? ' data-image="' + esc(shareCover) + '"' : '')
        + (payload.report_id ? ' data-report-id="' + esc(payload.report_id) + '"' : '')
        + (payload.summary ? ' data-report-summary="' + esc(payload.summary) + '"' : '')
        + (payload.platform ? ' data-report-platform="' + esc(payload.platform) + '"' : '')
        + (payload.content_preview ? ' data-report-content-preview="' + esc(payload.content_preview) + '"' : '')
        + ' data-msg-idx="' + idx + '"'
        + (shareNeedsDecision ? ' data-pending="1"' : '')
        + (iconMark ? ' data-mark="' + iconMark + '"' : '')
        + '>'
        + '<span class="msg-share-wash" aria-hidden="true"></span>'
        + '<div class="msg-share-main">'
        + '<div class="msg-share-icon"' + (shareCover ? ' data-cover="1"' : '') + (iconMark ? ' data-mark="' + iconMark + '"' : '') + '>' + iconContent + '</div>'
        + '<div class="msg-share-body">'
        + '<div class="msg-share-title">' + esc(shareTitle) + '</div>'
        + (shareDesc ? '<div class="msg-share-desc">' + esc(shareDesc) + '</div>' : '');
      // Version badge + status pill for tapp
      if (msgType === 'tapp') {
        html += '<div class="msg-share-meta">';
        if (payload.tapp_version) html += '<span class="msg-share-ver">v' + esc(payload.tapp_version) + '</span>';
        if (local) {
          // Sender: show pending status
          html += '<span class="msg-share-status msg-share-status-pending">' + esc(lang.tappSharePending) + '</span>';
        } else if (tappAcceptStatus === 'accepted') {
          html += '<span class="msg-share-status msg-share-status-accepted">' + esc(lang.tappShareAccepted) + '</span>';
        } else if (tappAcceptStatus === 'rejected') {
          html += '<span class="msg-share-status msg-share-status-rejected">' + esc(lang.tappShareRejected) + '</span>';
        }
        html += '</div>';
      }
      html += '</div>'
        + (shareNeedsDecision ? '' : '<span class="msg-share-go" aria-hidden="true">' + SVG_ICONS.chevronRight + '</span>')
        + '</div>';
      // Receiver: accept/reject span the card footer, below the main row
      if (shareNeedsDecision) {
        html += '<div class="msg-share-actions">'
          + '<button type="button" class="msg-share-btn-reject" data-reject-idx="' + idx + '">' + esc(lang.rejectTapp) + '</button>'
          + '<button type="button" class="msg-share-btn-accept" data-accept-idx="' + idx + '">' + esc(lang.acceptTapp) + '</button>'
          + '</div>';
      }
      html += '</div>';
      if (payload.text) html += '<div class="msg-text msg-caption">' + esc(payload.text) + '</div>';
      }
    } else {
      html += '<div class="msg-text">' + esc(text) + '</div>';
    }

    html += '<div class="msg-footer">' + pinned + '<span class="msg-time" title="' + esc(fullTimeStr(msg.created_at)) + '">' + timeStr(msg.created_at) + '</span></div>'
      + '</div></div>';
  });
  container.innerHTML = html;
  container.scrollTop = container.scrollHeight;

  // ⋯ / long-press / contextmenu bound once via bindMsgContextMenu

  // Bind tapp accept/reject buttons
  container.querySelectorAll('.msg-share-btn-accept').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var msgIdx = btn.dataset.acceptIdx;
      var card = btn.closest('.msg-share-card');
      var tappId = card ? card.dataset.tappId : '';
      if (!tappId) return;
      var stKey = 'tapp_accept_' + tappId + '_' + msgIdx;
      if (!state.tappAcceptMap) state.tappAcceptMap = {};
      state.tappAcceptMap[stKey] = 'accepted';
      Tapp.storage.set(stKey, 'accepted').catch(function () {});
      // Open install detail immediately
      openTappDetail(tappId, card);
      renderMessages();
    });
  });
  container.querySelectorAll('.msg-share-btn-reject').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var msgIdx = btn.dataset.rejectIdx;
      var card = btn.closest('.msg-share-card');
      var tappId = card ? card.dataset.tappId : '';
      if (!tappId) return;
      var stKey = 'tapp_accept_' + tappId + '_' + msgIdx;
      if (!state.tappAcceptMap) state.tappAcceptMap = {};
      state.tappAcceptMap[stKey] = 'rejected';
      Tapp.storage.set(stKey, 'rejected').catch(function () {});
      renderMessages();
    });
  });
  // File card → inline data URL or chunked transfer_id download
  container.querySelectorAll('.msg-file-card').forEach(function (card) {
    if (card.disabled) return;
    card.addEventListener('click', function (e) {
      e.stopPropagation();
      var idx = parseInt(card.dataset.fileIdx, 10);
      var m = state.messages[idx];
      if (!m || !m.payload) return;
      downloadMessageFile(m.payload, card);
    });
  });

  // Quote snapshot → jump to original message (same conversation, both parties)
  container.querySelectorAll('.msg-quote-block[data-quote-id]').forEach(function (qEl) {
    qEl.addEventListener('click', function (e) {
      e.stopPropagation();
      var qid = qEl.getAttribute('data-quote-id');
      if (!qid) return;
      if (typeof jumpToHistoryMessage === 'function') {
        jumpToHistoryMessage(qid);
      } else {
        var target = container.querySelector('[data-msg-id="' + qid.replace(/"/g, '') + '"]');
        if (target) {
          try { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (eJ) {}
          target.classList.add('msg-highlight');
          setTimeout(function () {
            try { target.classList.remove('msg-highlight'); } catch (eK) {}
          }, 2200);
        }
      }
    });
  });

  // Dead favicon → fall back to the generic type glyph rather than a broken tile
  container.querySelectorAll('.msg-share-favicon[data-fallback]').forEach(function (img) {
    img.addEventListener('error', function () {
      var tile = img.parentNode;
      if (!tile) return;
      var glyphs = { tapp: SVG_ICONS.tapp, brew: SVG_ICONS.brew, library: SVG_ICONS.library, report: SVG_ICONS.report };
      // Clear the mark on both tile and card: with no source mark left, the
      // message type is the only identity again, so the type wash comes back.
      tile.removeAttribute('data-mark');
      var markedCard = tile.closest('.msg-share-card');
      if (markedCard) markedCard.removeAttribute('data-mark');
      tile.innerHTML = glyphs[img.dataset.fallback] || SVG_ICONS.file;
    });
  });

  // Image bubbles → full-screen viewer
  container.querySelectorAll('.msg-media[data-media-idx]').forEach(function (fig) {
    var open = function (e) {
      e.stopPropagation();
      var m = state.messages[parseInt(fig.dataset.mediaIdx, 10)];
      if (!m || !m.payload || !m.payload.data) return;
      openImageViewer(m.payload.data, m.payload.filename || '');
    };
    fig.addEventListener('click', open);
    fig.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e); }
    });
  });

  // Media cards: tag real cover orientation once loaded so CSS can adapt the
  // layout (games ship landscape banners, anime/music portrait posters), and
  // fall back to the platform glyph if the cover fails to load.
  container.querySelectorAll('.msg-media-card .msg-media-cover-img').forEach(function (img) {
    var apply = function () {
      var card = img.closest('.msg-media-card');
      // Music stays square regardless of the source image's real aspect.
      if (!card || card.dataset.orient === 'square' || !img.naturalWidth || !img.naturalHeight) return;
      card.dataset.orient = (img.naturalWidth / img.naturalHeight >= 1.15) ? 'landscape' : 'portrait';
    };
    if (img.complete && img.naturalWidth) apply();
    else img.addEventListener('load', apply);
    img.addEventListener('error', function () {
      var cover = img.closest('.msg-media-cover');
      if (cover) cover.setAttribute('data-broken', '1');
    });
  });

  // Bind share card click handlers — open detail views
  container.querySelectorAll('.msg-share-card[data-type], .msg-media-card[data-type]').forEach(function (card) {
    card.addEventListener('click', function (e) {
      // Don't open detail if clicking on action buttons
      if (e.target.closest('.msg-share-actions')) return;
      var type = card.dataset.type;
      if (type === 'tapp' && card.dataset.tappId) {
        // Only open detail if accepted or if sender
        var msgIdx = card.dataset.msgIdx;
        var stKey = 'tapp_accept_' + card.dataset.tappId + '_' + msgIdx;
        var status = state.tappAcceptMap && state.tappAcceptMap[stKey];
        var isLocal = card.closest('.msg-local');
        if (isLocal || status === 'accepted') {
          openTappDetail(card.dataset.tappId, card);
        }
      } else if (type === 'brew' && card.dataset.brewId) {
        openBrewDetail(parseInt(card.dataset.brewId, 10), card.dataset.brewLink, card);
      } else if (type === 'library') {
        openLibraryDetail(card);
      } else if (type === 'report' && card.dataset.reportId) {
        // Report detail polish is owned by report workers; keep basic open path
        openReportDetail(card.dataset.reportId, card);
      }
    });
  });
  renderPinnedBar();
  bindMsgContextMenu(container);
}

/**
 * Image-forward media card for a library share that carries cover art.
 * The cover leads (with the platform's logo as a corner mark); beside/under it
 * sit just the title and one compact meta row — kind, rating, and the sender's
 * playtime / watch progress. No source text, no separators. Orientation: games
 * banner, music square, everything else portrait (corrected once loaded).
 */
function libraryMediaCardHtml(idx, payload, view) {
  var slug = view.platform || '';
  var logo = platformLogoSvg(slug);
  var accent = logo ? platformAccent(slug) : null;
  var accentStyle = accent ? ';--acc-l:' + accent.l + ';--acc-d:' + accent.d : '';
  var orient = view.itemType === 'music' ? 'square' : mediaCoverOrient(view.itemType);

  // One meta row, gap-spaced (icons delimit — no dots/dividers). Music leads
  // with the artist (and album when it differs from the title); other media
  // show kind · rating · the sender's playtime/watch progress.
  var meta = '';
  if (view.itemType === 'music' && (view.artist || view.album)) {
    if (view.artist) meta += '<span class="msg-media-kind">' + esc(view.artist) + '</span>';
    if (view.album && view.album !== view.title) meta += '<span class="msg-media-sub">' + esc(view.album) + '</span>';
  } else {
    var kindLabel = mediaKindLabel(view.itemType);
    if (kindLabel) meta += '<span class="msg-media-kind">' + esc(kindLabel) + '</span>';
    if (view.ratingText) meta += '<span class="msg-media-rate">' + SVG_ICONS.star + esc(view.ratingText) + '</span>';
    if (view.stat) meta += '<span class="msg-media-stat">' + view.stat.icon + esc(view.stat.text) + '</span>';
  }

  var cover = '<div class="msg-media-cover">'
    + '<img class="msg-media-cover-img" src="' + esc(view.image) + '" alt="" loading="lazy" />'
    + '<span class="msg-media-cover-fallback" aria-hidden="true">' + (logo || SVG_ICONS.library) + '</span>'
    + (logo ? '<span class="msg-media-logo" data-mark="brand" aria-hidden="true">' + logo + '</span>' : '')
    + '</div>';

  return '<div class="msg-media-card" data-type="library" data-orient="' + orient + '"'
    + ' data-msg-idx="' + idx + '"'
    + (payload.platform_id ? ' data-platform-id="' + esc(payload.platform_id) + '"' : '')
    + (payload.item_id ? ' data-item-id="' + esc(String(payload.item_id)) + '"' : '')
    + (view.image ? ' data-image="' + esc(view.image) + '"' : '')
    + (accent ? ' data-mark="brand"' : '')
    + ' style="cursor:pointer' + accentStyle + '">'
    + cover
    + '<div class="msg-media-info">'
    + '<div class="msg-media-title">' + esc(view.title) + '</div>'
    + (meta ? '<div class="msg-media-meta">' + meta + '</div>' : '')
    + '</div>'
    + '<span class="msg-media-go" aria-hidden="true">' + SVG_ICONS.chevronRight + '</span>'
    + '</div>';
}

/** Full-screen image viewer for image bubbles. */
function openImageViewer(src, name) {
  if (!src) return;
  var overlay = document.createElement('div');
  overlay.className = 'img-viewer';
  overlay.dataset.aroDismissable = '1';
  overlay.innerHTML = '<div class="img-viewer-bar">'
    + '<span class="img-viewer-name"></span>'
    + '<button type="button" class="img-viewer-btn" data-act="save" title="' + esc(lang.downloadFile || 'Download') + '" aria-label="' + esc(lang.downloadFile || 'Download') + '">' + SVG_ICONS.download + '</button>'
    + '<button type="button" class="img-viewer-btn" data-act="close" title="' + esc(lang.dismiss || 'Close') + '" aria-label="' + esc(lang.dismiss || 'Close') + '">' + SVG_ICONS.close + '</button>'
    + '</div>'
    + '<div class="img-viewer-stage"><img class="img-viewer-img" alt="" /></div>';
  // Assign untrusted values as properties, never through innerHTML.
  overlay.querySelector('.img-viewer-name').textContent = name || '';
  var img = overlay.querySelector('.img-viewer-img');
  img.src = src;
  img.alt = name || '';

  var close = function () {
    document.removeEventListener('keydown', onKey);
    aroDismiss(overlay, { remove: true, ms: 170 });
  };
  var onKey = function (e) { if (e.key === 'Escape') close(); };

  overlay.addEventListener('click', function (e) {
    var act = e.target.closest('[data-act]');
    if (act && act.dataset.act === 'save') {
      downloadMessageFile({ data: src, filename: name || 'image' });
      return;
    }
    if (act && act.dataset.act === 'close') { close(); return; }
    if (!e.target.closest('.img-viewer-img')) close();
  });
  document.addEventListener('keydown', onKey);

  document.body.appendChild(overlay);
  aroPlayEnter(overlay, 'aro-viewer-enter');
}

/**
 * Poll getTransfer until completed (or failed) so file-meta cards don't 409
 * when meta arrives before federated chunks finish writing.
 * @returns {'ready'|'failed'|'timeout'}
 */
async function waitForTransferReady(transferId, maxMs) {
  maxMs = typeof maxMs === 'number' ? maxMs : 45000;
  if (!transferId || typeof Tapp === 'undefined' || !Tapp.federation) return 'timeout';
  if (typeof Tapp.federation.getTransfer !== 'function') return 'ready';
  var start = Date.now();
  var delay = 400;
  while (Date.now() - start < maxMs) {
    try {
      var meta = await Tapp.federation.getTransfer(transferId);
      var st = meta && meta.status;
      if (st === 'completed') return 'ready';
      if (st === 'failed' || st === 'cancelled') return 'failed';
    } catch (e) {
      // 404 while inbound chunks still arriving — keep waiting
    }
    await new Promise(function (r) { setTimeout(r, delay); });
    delay = Math.min(delay + 200, 2000);
  }
  return 'timeout';
}

/**
 * Download a message attachment.
 * - Small files: payload.data is a data: URL → <a download>
 * - Large channel files: payload.transfer_id → host federation.downloadTransfer
 */
async function downloadMessageFile(payload, triggerEl) {
  if (!payload) {
    try { Tapp.ui.showNotification({ title: lang.downloadFail || lang.loadFail, type: 'error' }); } catch (e) { /* ignore */ }
    return;
  }

  // Path A: inline data URL / base64
  if (payload.data) {
    try {
      var a = document.createElement('a');
      a.href = payload.data;
      a.download = payload.filename || 'file';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e2) {
      try { Tapp.ui.showNotification({ title: lang.downloadFail || lang.loadFail, type: 'error' }); } catch (e3) { /* ignore */ }
    }
    return;
  }

  // Path B: chunked transfer (file-meta)
  var transferId = payload.transfer_id;
  if (!transferId) {
    try { Tapp.ui.showNotification({ title: lang.downloadFail || lang.loadFail, type: 'error' }); } catch (e4) { /* ignore */ }
    return;
  }

  if (typeof Tapp === 'undefined' || !Tapp.federation || typeof Tapp.federation.downloadTransfer !== 'function') {
    try {
      Tapp.ui.showNotification({
        title: lang.downloadFail || lang.loadFail,
        message: lang.transferDownloadUnsupported || 'Transfer download unavailable',
        type: 'error',
      });
    } catch (e5) { /* ignore */ }
    return;
  }

  var busy = false;
  if (triggerEl) {
    busy = !!triggerEl.dataset.dlBusy;
    if (busy) return;
    triggerEl.dataset.dlBusy = '1';
    triggerEl.classList.add('msg-file-card-loading');
  }
  try {
    try {
      Tapp.ui.showNotification({
        title: lang.transferPreparing || lang.transferDownloading || lang.transferStarting || 'Preparing…',
        type: 'info',
      });
    } catch (e6) { /* ignore */ }

    var ready = await waitForTransferReady(transferId, 45000);
    if (ready === 'failed') {
      try {
        Tapp.ui.showNotification({
          title: lang.transferDownloadFail || lang.downloadFail || lang.loadFail,
          message: lang.transferFailed || undefined,
          type: 'error',
        });
      } catch (eFail) { /* ignore */ }
      return;
    }
    if (ready === 'timeout') {
      try {
        Tapp.ui.showNotification({
          title: lang.transferDownloading || 'Downloading…',
          message: lang.transferStillArriving || undefined,
          type: 'info',
        });
      } catch (eTo) { /* ignore */ }
    } else {
      try {
        Tapp.ui.showNotification({
          title: lang.transferDownloading || lang.transferStarting || 'Downloading…',
          type: 'info',
        });
      } catch (eDl) { /* ignore */ }
    }

    var result = await Tapp.federation.downloadTransfer(transferId);
    var savedName = (result && result.filename) || payload.filename || 'file';
    try {
      Tapp.ui.showNotification({
        title: lang.transferDownloadOk || lang.downloadFile || 'Downloaded',
        message: savedName,
        type: 'success',
      });
    } catch (e7) { /* ignore */ }
  } catch (err) {
    var msg = (err && (err.message || err.error)) || String(err || '');
    if (/not ready|not completed|409|Transfer is not ready/i.test(msg) && transferId) {
      try {
        var again = await waitForTransferReady(transferId, 20000);
        if (again === 'ready') {
          var result2 = await Tapp.federation.downloadTransfer(transferId);
          var saved2 = (result2 && result2.filename) || payload.filename || 'file';
          try {
            Tapp.ui.showNotification({
              title: lang.transferDownloadOk || lang.downloadFile || 'Downloaded',
              message: saved2,
              type: 'success',
            });
          } catch (eOk2) { /* ignore */ }
          return;
        }
      } catch (eRetry) {
        msg = (eRetry && (eRetry.message || eRetry.error)) || msg;
      }
    }
    try {
      Tapp.ui.showNotification({
        title: lang.transferDownloadFail || lang.downloadFail || lang.loadFail,
        message: msg || undefined,
        type: 'error',
      });
    } catch (e8) { /* ignore */ }
  } finally {
    if (triggerEl) {
      delete triggerEl.dataset.dlBusy;
      triggerEl.classList.remove('msg-file-card-loading');
    }
  }
}

/* ----- Shared detail overlay for received content ----- */
/**
 * Bottom sheet shell for share detail views.
 * @param {string} title
 * @param {{type?:string, subtitle?:string, slug?:string, favicon?:string,
 *          cover?:string, rawSvg?:string, fallback?:string}} opts
 *   Icon + accent resolve exactly like the share card that opened the sheet.
 */
function createDetailOverlay(title, opts) {
  opts = opts || {};
  var overlay = document.createElement('div');
  overlay.className = 'picker-overlay';
  overlay.dataset.aroDismissable = '1';
  var visual = sheetVisual(opts);
  applySheetAccent(overlay, visual.accent);
  overlay.innerHTML =
    '<div class="picker-sheet" role="dialog" aria-modal="true" aria-label="' + esc(title) + '">'
    + '<div class="picker-header">'
    + '<div class="picker-header-icon"' + (visual.mark ? ' data-mark="' + esc(visual.mark) + '"' : '') + '>' + visual.icon + '</div>'
    + '<div class="picker-header-text">'
    + '<div class="picker-header-title">' + esc(title) + '</div>'
    + '<div class="picker-header-sub">' + esc(opts.subtitle || '') + '</div>'
    + '</div>'
    + '<button type="button" class="picker-close-btn" aria-label="' + esc(lang.dismiss || lang.close || 'Close') + '">&times;</button>'
    + '</div>'
    + '<div class="picker-body"></div>'
    + '</div>';

  var close = function () {
    document.removeEventListener('keydown', onKey);
    aroDismiss(overlay, { remove: true, ms: 170 });
  };
  var onKey = function (e) { if (e.key === 'Escape') close(); };
  overlay.querySelector('.picker-close-btn').addEventListener('click', close);
  overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);

  document.body.appendChild(overlay);
  return overlay;
}

function openTappDetail(tappId, card) {
  // Extract sender-provided info from the share card / data attributes
  var remoteName = (card.querySelector('.msg-share-title') || {}).textContent || card.dataset.tappName || tappId;
  var remoteDesc = (card.querySelector('.msg-share-desc') || {}).textContent || '';
  var remoteVersion = card.dataset.tappVersion || '';
  // P0: catalog URL for store install (portable across instances).
  var storeSource = (card && card.dataset.storeSource) || '';
  // Peer install package lives on the message payload (not data-attrs — too large).
  var installPackage = null;
  var installOmitted = '';
  if (card && card.dataset.msgIdx != null && state.messages) {
    var m = state.messages[parseInt(card.dataset.msgIdx, 10)];
    if (m && m.payload) {
      installPackage = m.payload.install_package || m.payload.installPackage || null;
      installOmitted = m.payload.install_package_omitted || m.payload.installPackageOmitted || '';
      if (!storeSource) {
        storeSource = m.payload.store_source || m.payload.storeSource || '';
      }
    }
  }

  var overlay = createDetailOverlay(remoteName, {
    type: 'tapp',
    subtitle: tappId,
    rawSvg: shareCardPayload(card).tapp_icon || '',
    fallback: SVG_ICONS.tapp,
  });
  var body = overlay.querySelector('.picker-body');
  showPickerLoading(body);

  // Check local installation
  Tapp.tappList.get(tappId).then(function (local) {
    var installed = local && local.status && local.status !== 'uninstalled';
    var localVer = installed ? (local.version || '') : '';
    var needsUpdate = installed && remoteVersion && localVer && localVer !== remoteVersion;
    renderTappDetailView(body, tappId, remoteName, remoteDesc, remoteVersion, installed, localVer, needsUpdate, installPackage, installOmitted, storeSource);
  }).catch(function () {
    // Can't determine local status — assume not installed
    renderTappDetailView(body, tappId, remoteName, remoteDesc, remoteVersion, false, '', false, installPackage, installOmitted, storeSource);
  });
}

function isValidStoreSourceRef(ref) {
  if (!ref || typeof ref !== 'string') return false;
  var s = ref.trim().toLowerCase();
  if (!s || s === 'store' || s === 'direct') return false;
  return true;
}

function renderTappDetailView(body, tappId, name, desc, remoteVer, installed, localVer, needsUpdate, installPackage, installOmitted, storeSource) {
  var statusText = installed ? (needsUpdate ? lang.tappUpdateAvail : lang.tappInstalled) : lang.tappNotInstalled;
  var statusClass = installed ? (needsUpdate ? 'sheet-status-warn' : 'sheet-status-ok') : 'sheet-status-off';
  var hasDirectPkg = !!(installPackage && installPackage.manifest && installPackage.code);
  var hasStoreSource = isValidStoreSourceRef(storeSource);

  var html = '<div class="sheet-pad">';
  if (desc) html += '<div class="sheet-desc">' + esc(desc) + '</div>';

  // Install state panel: status line + version rows + provenance note
  html += '<div class="sheet-panel">'
    + '<div class="sheet-status ' + statusClass + '"><span class="sheet-status-dot" aria-hidden="true"></span>' + esc(statusText) + '</div>';
  if (remoteVer || localVer) {
    html += '<dl style="margin:0;display:flex;flex-direction:column;gap:6px">';
    if (remoteVer) {
      html += '<div class="sheet-row"><dt>' + esc(lang.remoteVer) + '</dt><dd>v' + esc(remoteVer) + '</dd></div>';
    }
    if (localVer) {
      html += '<div class="sheet-row"><dt>' + esc(lang.localVer) + '</dt><dd>v' + esc(localVer) + '</dd></div>';
    }
    html += '</dl>';
  }
  if (!installed && hasStoreSource) {
    html += '<div class="sheet-note">' + esc(lang.tappStoreInstall || 'Will install from store catalog') + '</div>';
  } else if (!installed && hasDirectPkg) {
    html += '<div class="sheet-note">' + esc(lang.tappDirectInstall || 'Install package included in share') + '</div>';
  } else if (!installed && installOmitted) {
    html += '<div class="sheet-note sheet-note-warn">' + esc(installOmitted) + '</div>';
  }
  html += '</div>';

  // Action
  if (!installed) {
    html += '<button type="button" class="sheet-btn tapp-action-btn" data-action="install">' + esc(lang.installBtn) + '</button>'
      + '<div class="sheet-error tapp-install-error" style="display:none"></div>';
  } else if (needsUpdate) {
    html += '<button type="button" class="sheet-btn sheet-btn-warn tapp-action-btn" data-action="update">' + esc(lang.updatingBtn) + '</button>'
      + '<div class="sheet-error tapp-install-error" style="display:none"></div>';
  } else {
    html += '<div class="sheet-hint">' + esc(lang.alreadyLatest) + '</div>';
  }

  html += '</div>';
  body.innerHTML = html;

  // Bind install/update — P0 store path with real storeSource; direct package as fallback.
  var actionBtn = body.querySelector('.tapp-action-btn');
  var errEl = body.querySelector('.tapp-install-error');
  if (actionBtn) {
    actionBtn.addEventListener('click', function handleInstallClick() {
      if (actionBtn.disabled) return;
      actionBtn.disabled = true;
      actionBtn.textContent = lang.installingBtn;
      setSheetBtnState(actionBtn, 'busy');
      if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }

      var installReq = null;
      // Store apps between instances: installFromStore with catalog URL.
      if (hasStoreSource) {
        installReq = {
          source: 'store',
          storeSource: storeSource.trim(),
          tappId: tappId
        };
      } else if (hasDirectPkg) {
        installReq = {
          source: 'direct',
          manifest: installPackage.manifest,
          code: installPackage.code,
          styles: installPackage.styles,
          pageTemplate: installPackage.pageTemplate,
          widgetTemplates: installPackage.widgetTemplates,
          widgetCss: installPackage.widgetCss,
          pageCss: installPackage.pageCss,
          i18n: installPackage.i18n,
          pageModules: installPackage.pageModules,
          assets: installPackage.assets,
          permissions: installPackage.permissions
        };
      }

      if (!installReq) {
        actionBtn.textContent = lang.installFailed;
        setSheetBtnState(actionBtn, 'err');
        actionBtn.disabled = false;
        if (errEl) {
          errEl.style.display = 'block';
          errEl.textContent = lang.tappInstallNoStoreSource ||
            'Share is missing store catalog URL. Ask the sender to re-share the Tapp from a current Aro build.';
        }
        return;
      }

      Tapp.tappList.install(installReq).then(function () {
        actionBtn.textContent = lang.installSuccess;
        setSheetBtnState(actionBtn, 'ok');
        actionBtn.removeEventListener('click', handleInstallClick);
      }).catch(function (err) {
        var msg = (err && err.message) ? String(err.message) : (lang.installFailed || 'Install failed');
        // If store path failed and we have a direct package, offer one automatic retry.
        if (hasStoreSource && hasDirectPkg && installReq.source === 'store') {
          var directReq = {
            source: 'direct',
            manifest: installPackage.manifest,
            code: installPackage.code,
            styles: installPackage.styles,
            pageTemplate: installPackage.pageTemplate,
            widgetTemplates: installPackage.widgetTemplates,
            widgetCss: installPackage.widgetCss,
            pageCss: installPackage.pageCss,
            i18n: installPackage.i18n,
            pageModules: installPackage.pageModules,
            assets: installPackage.assets,
            permissions: installPackage.permissions
          };
          return Tapp.tappList.install(directReq).then(function () {
            actionBtn.textContent = lang.installSuccess;
            setSheetBtnState(actionBtn, 'ok');
            actionBtn.removeEventListener('click', handleInstallClick);
          }).catch(function (err2) {
            var msg2 = (err2 && err2.message) ? String(err2.message) : msg;
            actionBtn.textContent = lang.installFailed;
            setSheetBtnState(actionBtn, 'err');
            actionBtn.disabled = false;
            if (errEl) { errEl.style.display = 'block'; errEl.textContent = msg2; }
          });
        }
        actionBtn.textContent = lang.installFailed;
        setSheetBtnState(actionBtn, 'err');
        actionBtn.disabled = false;
        if (errEl) {
          errEl.style.display = 'block';
          errEl.textContent = msg;
        }
      });
    });
  }
}

function openBrewDetail(brewId, brewLink, card) {
  var titleEl = card && card.querySelector('.msg-share-title');
  var brewSnap = shareCardPayload(card);
  var overlay = createDetailOverlay((titleEl && titleEl.textContent) || lang.attachBrew || 'Brew', {
    type: 'brew',
    subtitle: brewSnap.source_name || '',
    favicon: brewSnap.source_icon || '',
    slug: brewSnap.source_name || '',
    fallback: SVG_ICONS.brew,
  });
  var body = overlay.querySelector('.picker-body');
  showPickerLoading(body);
  if (!brewId || typeof Tapp.brewList === 'undefined' || typeof Tapp.brewList.get !== 'function') {
    // Fall back to card payload / link only
    var descEl = card && card.querySelector('.msg-share-desc');
    body.innerHTML =
      '<div class="sheet-pad">'
      + (descEl && descEl.textContent ? '<div class="sheet-desc">' + esc(descEl.textContent) + '</div>' : '')
      + brewLinkHtml(brewLink)
      + '</div>';
    return;
  }
  Tapp.brewList.get(brewId).then(function (detail) {
    if (!detail) { body.innerHTML = '<div class="picker-empty">' + esc(lang.pickerEmpty) + '</div>'; return; }
    var brewChips = [];
    if (detail.source_name) brewChips.push(detail.source_name);
    if (detail.author) brewChips.push(detail.author);
    if (detail.published_at) {
      try { brewChips.push(new Date(detail.published_at).toLocaleDateString(currentLocale)); } catch (e) { /* ignore */ }
    }
    body.innerHTML =
      '<div class="sheet-pad">'
      + (safeIconUrl(detail.image) ? '<img class="sheet-cover" src="' + esc(detail.image) + '" alt="" />' : '')
      + sheetMetaHtml(brewChips)
      + (detail.summary ? '<div class="sheet-desc">' + esc(detail.summary) + '</div>' : '')
      + brewLinkHtml(brewLink)
      + '</div>';
  }).catch(function () {
    body.innerHTML = '<div class="picker-empty">' + esc(lang.pickerEmpty) + '</div>';
  });
}

function openLibraryDetail(card) {
  // Prefer live message payload snapshot, then data-* attrs, then DOM text.
  var payloadSnap = shareCardPayload(card);
  var titleEl = card && card.querySelector('.msg-share-title');
  var descEl = card && card.querySelector('.msg-share-desc');
  var view = resolveShareCardView('library', payloadSnap);
  var title = view.title || (titleEl && titleEl.textContent) || lang.attachLibrary || 'Library';
  var desc = view.description || (descEl && descEl.textContent) || '';
  var platformId = payloadSnap.platform_id || (card && card.dataset.platformId) || '';
  var itemId = payloadSnap.item_id != null ? String(payloadSnap.item_id) : ((card && card.dataset.itemId) || '');
  var image = view.image || (card && card.dataset.image) || '';
  var contentType = payloadSnap.item_type || (payloadSnap.content_type && payloadSnap.content_type !== 'library' ? payloadSnap.content_type : '') || '';
  var overlay = createDetailOverlay(title, {
    type: 'library',
    subtitle: platformId,
    slug: platformId,
    fallback: SVG_ICONS.library,
  });
  var body = overlay.querySelector('.picker-body');
  body.innerHTML =
    '<div class="sheet-pad">'
    + (safeIconUrl(image) ? '<img class="sheet-cover" src="' + esc(image) + '" alt="" />' : '')
    + sheetMetaHtml([platformId, contentType, itemId])
    + (desc ? '<div class="sheet-desc">' + esc(desc) + '</div>' : '')
    + '</div>';
}

function openReportDetail(reportId, card) {
  // Prefer live message payload (#120 snapshot fields), then data-* attrs, then DOM text.
  // getReport is user-scoped — recipients rely on the snapshot only.
  var payloadSnap = shareCardPayload(card);
  var titleNode = card && card.querySelector ? card.querySelector('.msg-share-title') : null;
  var descNode = card && card.querySelector ? card.querySelector('.msg-share-desc') : null;
  var snapSummary = payloadSnap.summary
    || (card && card.dataset && card.dataset.reportSummary)
    || (titleNode && titleNode.textContent)
    || 'Report';
  var snapPlatform = payloadSnap.platform
    || (card && card.dataset && card.dataset.reportPlatform)
    || '';
  var snapPreview = payloadSnap.content_preview
    || (card && card.dataset && card.dataset.reportContentPreview)
    || '';
  if (!snapPreview && descNode && descNode.textContent) snapPreview = descNode.textContent;
  var snapType = payloadSnap.type || payloadSnap.content_type || '';

  var overlay = createDetailOverlay(snapSummary || 'Report', {
    type: 'report',
    subtitle: snapPlatform,
    slug: snapPlatform,
    fallback: SVG_ICONS.report,
  });
  var body = overlay.querySelector('.picker-body');

  function renderReportSnapshot(summary, platform, contentText, createdAt, typeLabel) {
    var dateLabel = '';
    if (createdAt) {
      try { dateLabel = new Date(createdAt).toLocaleDateString(currentLocale); } catch (e) { /* ignore */ }
    }
    // Plain-text snapshot path (share payload / recipients) — never esc(object)
    var bodyText = formatReportContentBody(contentText, snapPreview || '');
    bodyText = stripHtmlPreview(bodyText || '').trim();
    body.innerHTML =
      '<div class="sheet-pad">'
      + sheetMetaHtml([platform, typeLabel, dateLabel])
      + (bodyText ? '<div class="sheet-desc sheet-scroll">' + esc(bodyText) + '</div>' : '')
      + '</div>';
  }

  // Always show message snapshot first so recipients never hit empty/loading forever.
  if (snapSummary || snapPreview || snapPlatform) {
    renderReportSnapshot(snapSummary, snapPlatform, snapPreview, null, snapType || null);
  } else {
    showPickerLoading(body);
  }

  // Owner path: enrich with sectioned HTML from catalog (complementary to #120 plain snapshot).
  if (!reportId) return;
  if (!Tapp.report || typeof Tapp.report.getReport !== 'function') return;
  Tapp.report.getReport(reportId).then(function (detail) {
    if (!detail) {
      if (!snapSummary && !snapPreview && !snapPlatform) {
        body.innerHTML = '<div class="picker-empty">' + esc(lang.reportUnavailable || lang.pickerEmpty) + '</div>';
      }
      return;
    }
    if (!detail.summary && snapSummary) detail.summary = snapSummary;
    if (!detail.platform && snapPlatform) detail.platform = snapPlatform;
    body.innerHTML = renderReportDetailBodyHtml(detail);
  }).catch(function () {
    // Recipients: keep snapshot already rendered. Only show empty if we had nothing.
    if (!snapSummary && !snapPreview && !snapPlatform) {
      body.innerHTML = '<div class="picker-empty">' + esc(lang.reportUnavailable || lang.pickerEmpty) + '</div>';
    }
  });
}

// ==================== Render: Members ====================
// (function body continues in members.js — page modules are concatenated in order)
function renderMembers() {
  var panel = $('member-panel');
  if (!panel) return;

  if (state.activeKind !== 'room' || !state.roomDetail) {
    panel.style.display = 'none';
    return;
  }
`

const PAGE_MOD_HISTORY = `\
// ==================== Chat History Browser + Archive Export/Import ====================
// Per-conversation history panel (search / filter / load older).
// Profile sub-page \`backup\`: export all chats + import archives (local Tapp.storage).

var ARO_ARCHIVE_FORMAT = 'myriad.aro.chat-archive';
var ARO_ARCHIVE_VERSION = 1;
var ARO_IMPORTED_ARCHIVES_KEY = 'aro.importedArchives.v1';
var HISTORY_PAGE_LIMIT = 100;
var HISTORY_MAX_EXPORT_PAGES = 40; // 40 * 100 = 4000 msgs/conversation safety cap

function ensureHistoryState() {
  if (!state.history) {
    state.history = {
      open: false,
      kind: null,
      id: null,
      messages: [],
      query: '',
      filter: 'all',
      loading: false,
      loadingMore: false,
      hasMore: false,
      error: null,
      mainLoadingOlder: false,
    };
  }
  return state.history;
}

function unwrapMessagesResponse(res) {
  if (!res) return [];
  if (Array.isArray(res)) return res;
  if (Array.isArray(res.messages)) return res.messages;
  if (res.data) {
    if (Array.isArray(res.data)) return res.data;
    if (Array.isArray(res.data.messages)) return res.data.messages;
  }
  return [];
}

/** Normalize message_type for filters (text | image | file | share | system). */
function classifyHistoryMessage(msg) {
  if (!msg) return 'text';
  if (msg.is_pinned) { /* pin is orthogonal */ }
  var payload = (typeof msg.payload === 'object' && msg.payload) ? msg.payload : {};
  var mt = msg.message_type || 'text';
  if (mt === 'text' || !mt) {
    var knownShare = { tapp: 1, brew: 1, library: 1, report: 1, image: 1, file: 1, 'file-meta': 1 };
    if (payload.content_type && knownShare[payload.content_type]) mt = payload.content_type;
    else if (payload.tapp_id) mt = 'tapp';
    else if (payload.brew_id || payload.brew_link) mt = 'brew';
    else if (payload.report_id) mt = 'report';
    else if (payload.platform_id && (payload.item_id || payload.title)) mt = 'library';
    else if (payload.data && payload.mime_type && String(payload.mime_type).indexOf('image/') === 0) mt = 'image';
    else if (payload.transfer_id && payload.filename) mt = 'file-meta';
    else if (payload.data && payload.filename) mt = 'file';
  }
  if (mt === 'image') return 'image';
  if (mt === 'file' || mt === 'file-meta') return 'file';
  if (mt === 'tapp' || mt === 'brew' || mt === 'library' || mt === 'report') return 'share';
  if (mt === 'system') return 'system';
  return 'text';
}

function historyMessageSearchParts(msg) {
  var payload = (typeof msg.payload === 'object' && msg.payload) ? msg.payload : {};
  var text = '';
  try {
    text = (typeof getPayloadText === 'function' ? getPayloadText(msg.payload) : '') || '';
  } catch (e) { text = ''; }
  var sender = (msg.sender_actor || '').split('/').pop() || '';
  var displayName = historySenderLabel(msg);
  return [
    text,
    displayName,
    sender,
    msg.sender_actor,
    msg.message_type,
    classifyHistoryMessage(msg),
    payload.title,
    payload.filename,
    payload.tapp_id,
    payload.brew_link,
    payload.name,
    msg.message_id,
  ];
}

function historySenderLabel(msg) {
  if (!msg) return '?';
  var sender = (msg.sender_actor || '').split('/').pop() || '?';
  if (typeof isLocalActor === 'function' && isLocalActor(msg.sender_actor)) {
    return lang.me || lang.local || 'Me';
  }
  if (state.activeKind === 'channel' && state.channelDetail) {
    return state.channelDetail.remote_actor_name || sender;
  }
  if (state.activeKind === 'room' && typeof findMemberByActor === 'function') {
    var m = findMemberByActor(msg.sender_actor);
    if (m && m.display_name) return m.display_name;
  }
  return sender;
}

function historyPreviewText(msg) {
  if (typeof messagePreview === 'function') {
    try { return messagePreview(msg); } catch (e) { /* fall through */ }
  }
  var payload = (typeof msg.payload === 'object' && msg.payload) ? msg.payload : {};
  var kind = classifyHistoryMessage(msg);
  if (kind === 'image') return lang.previewImage || 'Image';
  if (kind === 'file') return lang.previewFile || 'File';
  if (kind === 'share') {
    return payload.title || payload.name || payload.tapp_id || payload.brew_link || (lang.attach || 'Share');
  }
  var t = typeof getPayloadText === 'function' ? getPayloadText(msg.payload) : '';
  if (!t && payload.title) t = String(payload.title);
  if (!t && payload.filename) t = String(payload.filename);
  if (!t) t = lang.newMessage || 'Message';
  return t.length > 120 ? t.slice(0, 119) + '…' : t;
}

function filterHistoryMessages(messages, query, filter) {
  var q = normalizeSearchQuery(query);
  var f = filter || 'all';
  return (messages || []).filter(function (msg) {
    if (f === 'pinned' && !msg.is_pinned) return false;
    if (f !== 'all' && f !== 'pinned') {
      if (classifyHistoryMessage(msg) !== f) return false;
    }
    if (!q) return true;
    return matchesSearch(q, historyMessageSearchParts(msg));
  });
}

function mergeMessageListsAsc(existing, incoming) {
  var map = {};
  var out = [];
  function push(msg) {
    if (!msg || !msg.message_id) return;
    if (map[msg.message_id]) {
      // Prefer newer object fields
      for (var i = 0; i < out.length; i++) {
        if (out[i].message_id === msg.message_id) {
          out[i] = Object.assign({}, out[i], msg);
          break;
        }
      }
      return;
    }
    map[msg.message_id] = true;
    out.push(msg);
  }
  (existing || []).forEach(push);
  (incoming || []).forEach(push);
  out.sort(function (a, b) {
    return String(a.created_at || '').localeCompare(String(b.created_at || ''));
  });
  return out;
}

async function fetchMessagesPage(kind, id, before, limit) {
  limit = limit || HISTORY_PAGE_LIMIT;
  var res = null;
  if (kind === 'channel') {
    res = await Tapp.federation.getMessages(id, before || undefined, limit);
  } else {
    res = await Tapp.federation.getRoomMessages(id, before || undefined, limit);
  }
  return unwrapMessagesResponse(res);
}

/** Fetch up to maxPages older pages for one conversation (ASC list). */
async function fetchAllMessagesForConversation(kind, id, opts) {
  opts = opts || {};
  var maxPages = opts.maxPages || HISTORY_MAX_EXPORT_PAGES;
  var limit = opts.limit || HISTORY_PAGE_LIMIT;
  var onProgress = opts.onProgress;
  var all = [];
  var before = undefined;
  var page = 0;
  while (page < maxPages) {
    var batch = await fetchMessagesPage(kind, id, before, limit);
    page += 1;
    if (!batch.length) break;
    // API returns ASC; with \`before\`, still ASC older page
    all = mergeMessageListsAsc(batch, all);
    if (typeof onProgress === 'function') onProgress(all.length, kind, id);
    if (batch.length < limit) break;
    before = batch[0].message_id; // oldest in this page
    if (!before) break;
  }
  return all;
}

// ---------- Per-conversation history panel ----------

function historyConversationTitle() {
  if (state.activeKind === 'channel' && state.channelDetail) {
    return state.channelDetail.remote_actor_name
      || (state.channelDetail.remote_actor_url || '').split('/').pop()
      || lang.dm
      || 'Chat';
  }
  if (state.activeKind === 'room' && state.roomDetail) {
    return state.roomDetail.name || lang.members || 'Room';
  }
  return lang.historyTitle || 'Chat history';
}

function openChatHistory() {
  ensureHistoryState();
  if (!state.activeKind || !state.activeId) return;
  var h = state.history;
  h.open = true;
  h.kind = state.activeKind;
  h.id = state.activeId;
  h.query = h.query || '';
  h.filter = h.filter || 'all';
  h.error = null;
  // Seed from live window
  h.messages = mergeMessageListsAsc([], state.messages || []);
  h.hasMore = (state.messages || []).length >= 150; // likely more if near page size
  h.loading = false;
  h.loadingMore = false;

  var overlay = $('chat-history-overlay');
  if (!overlay) return;
  overlay.hidden = false;
  overlay.style.display = 'flex';
  overlay.classList.remove('aro-leaving', 'aro-history-enter');
  // Restart enter animation
  try { void overlay.offsetWidth; } catch (eAnim) { /* ignore */ }
  if (typeof prefersReducedMotion === 'function' && prefersReducedMotion()) {
    /* no enter class */
  } else {
    overlay.classList.add('aro-history-enter');
    var clearEnter = function () {
      overlay.classList.remove('aro-history-enter');
      overlay.removeEventListener('animationend', clearEnter);
    };
    overlay.addEventListener('animationend', clearEnter);
    setTimeout(clearEnter, 360);
  }

  applyHistoryLabels();
  var search = $('history-search');
  if (search) search.value = h.query || '';
  syncHistoryFilterChips();
  renderHistoryList();
  updateHistoryFooter();

  // If live window is short, still try one older page in background when empty/filter
  if (h.messages.length === 0) {
    loadMoreHistoryMessages();
  }

  if (search) {
    try { search.focus(); } catch (e) { /* ignore */ }
  }
}

function closeChatHistory() {
  ensureHistoryState();
  state.history.open = false;
  var overlay = $('chat-history-overlay');
  if (!overlay || overlay.style.display === 'none') return;
  overlay.classList.remove('aro-history-enter');
  if (typeof aroDismiss === 'function') {
    aroDismiss(overlay, {
      ms: 160,
      onDone: function () {
        overlay.hidden = true;
      },
    });
  } else {
    overlay.style.display = 'none';
    overlay.hidden = true;
  }
}

function isChatHistoryOpen() {
  var overlay = $('chat-history-overlay');
  return !!(overlay && overlay.style.display !== 'none' && !overlay.hidden);
}

function applyHistoryLabels() {
  var el;
  el = $('history-title');
  if (el) el.textContent = lang.historyTitle || 'Chat history';
  el = $('history-subtitle');
  if (el) el.textContent = historyConversationTitle();
  el = $('history-close');
  if (el) el.setAttribute('aria-label', lang.close || lang.dismiss || 'Close');
  applySearchInputLabel('history-search', lang.historySearchPlaceholder || lang.searchPlaceholder || 'Search…');
  el = $('history-load-more');
  if (el) el.textContent = lang.historyLoadMore || 'Load older messages';

  var filterLabels = {
    all: lang.historyFilterAll || 'All',
    text: lang.historyFilterText || 'Text',
    image: lang.historyFilterImage || 'Images',
    file: lang.historyFilterFile || 'Files',
    share: lang.historyFilterShare || 'Shares',
    pinned: lang.historyFilterPinned || 'Pinned',
  };
  document.querySelectorAll('[data-history-filter]').forEach(function (btn) {
    var key = btn.getAttribute('data-history-filter');
    if (filterLabels[key]) btn.textContent = filterLabels[key];
  });
}

function syncHistoryFilterChips() {
  var h = ensureHistoryState();
  document.querySelectorAll('[data-history-filter]').forEach(function (btn) {
    var active = btn.getAttribute('data-history-filter') === h.filter;
    btn.classList.toggle('history-filter-active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
}

function historyEmptyHtml(title, body) {
  var icon = '<div class="aro-empty-mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></div>';
  return '<div class="history-empty">'
    + icon
    + (title ? '<div class="history-empty-title">' + esc(title) + '</div>' : '')
    + '<div>' + esc(body || '') + '</div>'
    + '</div>';
}

function historyPinSvg() {
  return '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 11V4a1 1 0 011-1h4a1 1 0 011 1v7"/><path d="M5 17h14"/><path d="M7 11l-2 6h14l-2-6"/></svg>';
}

function historyAvatarForMsg(msg, displayName, local) {
  var avatarUrl = '';
  if (!local) {
    if (state.activeKind === 'channel' && state.channelDetail) {
      avatarUrl = state.channelDetail.remote_actor_avatar || '';
    } else if (state.activeKind === 'room' && typeof findMemberByActor === 'function') {
      var m = findMemberByActor(msg.sender_actor);
      if (m) avatarUrl = m.avatar_url || '';
    }
  }
  var cls = 'history-item-avatar' + (local ? ' history-item-avatar-local' : '');
  if (typeof avatarContentHtml === 'function') {
    return '<div class="' + cls + '">' + avatarContentHtml(avatarUrl, displayName || '?') + '</div>';
  }
  return '<div class="' + cls + '">' + esc((displayName || '?').charAt(0).toUpperCase()) + '</div>';
}

function updateHistoryFooter() {
  var h = ensureHistoryState();
  var meta = $('history-meta');
  var loadBtn = $('history-load-more');
  var filtered = filterHistoryMessages(h.messages, h.query, h.filter);
  if (meta) {
    meta.classList.toggle('history-meta-error', !!h.error && !h.loadingMore);
    if (h.loadingMore) {
      meta.textContent = lang.historyLoading || lang.pickerLoading || 'Loading…';
    } else if (h.error) {
      meta.textContent = h.error;
    } else {
      var q = normalizeSearchQuery(h.query);
      var total = (h.messages || []).length;
      if (q || (h.filter && h.filter !== 'all')) {
        meta.textContent = (lang.historyMatchCount || '{n} / {total}')
          .replace('{n}', String(filtered.length))
          .replace('{total}', String(total));
      } else {
        meta.textContent = (lang.historyCount || '{n} messages').replace('{n}', String(total));
      }
    }
  }
  if (loadBtn) {
    loadBtn.hidden = !h.hasMore;
    loadBtn.disabled = !!h.loadingMore;
    loadBtn.textContent = h.loadingMore
      ? (lang.historyLoading || 'Loading…')
      : (lang.historyLoadMore || 'Load older messages');
  }
}

function renderHistoryList() {
  var list = $('history-list');
  if (!list) return;
  var h = ensureHistoryState();
  var filtered = filterHistoryMessages(h.messages, h.query, h.filter);
  // Newest first for browsing
  var view = filtered.slice().reverse();

  if (h.loading && !h.messages.length) {
    list.innerHTML = historyEmptyHtml(lang.historyLoading || lang.pickerLoading || 'Loading…', '');
    return;
  }
  if (!h.messages.length) {
    list.innerHTML = historyEmptyHtml(
      lang.historyEmpty || 'No messages yet',
      lang.emptyChatHint || ''
    );
    return;
  }
  if (!view.length) {
    list.innerHTML = historyEmptyHtml(
      lang.searchNoResults || 'No matches',
      lang.historySearchPlaceholder || ''
    );
    return;
  }

  var html = '';
  var lastDay = '';
  view.forEach(function (msg) {
    var day = '';
    try {
      var d = new Date(msg.created_at);
      if (!isNaN(d)) day = d.toDateString();
    } catch (e) { day = ''; }
    if (day && day !== lastDay) {
      lastDay = day;
      html += '<div class="history-day"><span>' + esc(typeof dayLabel === 'function' ? dayLabel(msg.created_at) : day) + '</span></div>';
    }
    var kind = classifyHistoryMessage(msg);
    var local = typeof isLocalActor === 'function' && isLocalActor(msg.sender_actor);
    var time = typeof timeStr === 'function' ? timeStr(msg.created_at) : '';
    var name = historySenderLabel(msg);
    var kindClass = kind !== 'text' ? (' history-item-kind-' + kind) : '';
    html += '<button type="button" class="history-item' + (local ? ' history-item-local' : '') + '" data-msg-id="' + esc(msg.message_id || '') + '">'
      + historyAvatarForMsg(msg, name, local)
      + '<div class="history-item-body">'
      + '<div class="history-item-top">'
      + '<span class="history-item-name">' + esc(name) + '</span>'
      + (msg.is_pinned ? '<span class="history-item-pin" title="' + esc(lang.msgPin || 'Pinned') + '">' + historyPinSvg() + '</span>' : '')
      + (kind !== 'text' ? '<span class="history-item-kind' + kindClass + '">' + esc(historyKindLabel(kind)) + '</span>' : '')
      + (time ? '<span class="history-item-time">' + esc(time) + '</span>' : '')
      + '</div>'
      + '<div class="history-item-text">' + esc(historyPreviewText(msg)) + '</div>'
      + '</div>'
      + '</button>';
  });
  list.innerHTML = html;
  list.querySelectorAll('.history-item').forEach(function (btn) {
    btn.addEventListener('click', function () {
      jumpToHistoryMessage(btn.getAttribute('data-msg-id'));
    });
  });
  updateHistoryFooter();
}

function historyKindLabel(kind) {
  if (kind === 'image') return lang.historyFilterImage || 'Image';
  if (kind === 'file') return lang.historyFilterFile || 'File';
  if (kind === 'share') return lang.historyFilterShare || 'Share';
  if (kind === 'system') return lang.previewSystem || 'System';
  return lang.historyFilterText || 'Text';
}

async function loadMoreHistoryMessages() {
  var h = ensureHistoryState();
  if (!h.open || !h.kind || !h.id || h.loadingMore) return;
  if (!h.hasMore && h.messages.length) return;
  h.loadingMore = true;
  h.error = null;
  updateHistoryFooter();
  try {
    var before = h.messages.length ? h.messages[0].message_id : undefined;
    var batch = await fetchMessagesPage(h.kind, h.id, before, HISTORY_PAGE_LIMIT);
    if (!batch.length) {
      h.hasMore = false;
    } else {
      var prevLen = h.messages.length;
      h.messages = mergeMessageListsAsc(h.messages, batch);
      h.hasMore = batch.length >= HISTORY_PAGE_LIMIT && h.messages.length > prevLen;
    }
  } catch (e) {
    h.error = (typeof getErrorMessage === 'function' ? getErrorMessage(e) : '') || lang.historyLoadFail || lang.loadFail || 'Load failed';
    console.error('[Aro] loadMoreHistoryMessages', e);
  } finally {
    h.loadingMore = false;
    renderHistoryList();
  }
}

async function jumpToHistoryMessage(msgId) {
  if (!msgId) return;
  closeChatHistory();
  // Ensure message is in the live window (load older pages if needed)
  var found = false;
  for (var i = 0; i < (state.messages || []).length; i++) {
    if (state.messages[i].message_id === msgId) { found = true; break; }
  }
  if (!found && state.activeKind && state.activeId) {
    var pages = 0;
    while (pages < HISTORY_MAX_EXPORT_PAGES && !found) {
      pages += 1;
      var older = await loadOlderMessagesIntoChat({ silent: true });
      if (!older || !older.loaded) break;
      for (var j = 0; j < state.messages.length; j++) {
        if (state.messages[j].message_id === msgId) { found = true; break; }
      }
      if (!older.hasMore) break;
    }
    if (found && typeof renderMessages === 'function') renderMessages();
  }
  var el = document.querySelector('[data-msg-id="' + msgId.replace(/"/g, '') + '"]');
  if (el) {
    try {
      el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
    } catch (e2) {
      try { el.scrollIntoView(); } catch (e3) {}
    }
    el.classList.add('msg-highlight');
    setTimeout(function () {
      try { el.classList.remove('msg-highlight'); } catch (e4) {}
    }, 2200);
  } else {
    try {
      Tapp.ui.showNotification({
        title: lang.historyJumpMiss || lang.searchNoResults || 'Message not in view',
        type: 'error',
      });
    } catch (e5) {}
  }
}

/** Load one older page into the main chat window. Returns {loaded, hasMore}. */
async function loadOlderMessagesIntoChat(opts) {
  opts = opts || {};
  var h = ensureHistoryState();
  if (!state.activeKind || !state.activeId || h.mainLoadingOlder) {
    return { loaded: 0, hasMore: false };
  }
  if (!(state.messages || []).length) return { loaded: 0, hasMore: false };
  h.mainLoadingOlder = true;
  var container = $('messages');
  var prevHeight = container ? container.scrollHeight : 0;
  var prevTop = container ? container.scrollTop : 0;
  try {
    var before = state.messages[0].message_id;
    var batch = await fetchMessagesPage(state.activeKind, state.activeId, before, HISTORY_PAGE_LIMIT);
    if (!batch.length) return { loaded: 0, hasMore: false };
    var prevLen = state.messages.length;
    state.messages = mergeMessageListsAsc(state.messages, batch);
    var loaded = state.messages.length - prevLen;
    if (loaded > 0) {
      state.messagesFp = typeof messagesFingerprint === 'function'
        ? messagesFingerprint(state.messages)
        : state.messagesFp;
      state.skipMsgAppear = true;
      if (typeof renderMessages === 'function') renderMessages();
      if (container) {
        var newHeight = container.scrollHeight;
        container.scrollTop = prevTop + (newHeight - prevHeight);
      }
    }
    return { loaded: loaded, hasMore: batch.length >= HISTORY_PAGE_LIMIT };
  } catch (e) {
    if (!opts.silent) console.error('[Aro] loadOlderMessagesIntoChat', e);
    return { loaded: 0, hasMore: false };
  } finally {
    h.mainLoadingOlder = false;
  }
}

function bindMessagesScrollLoadOlder() {
  var container = $('messages');
  if (!container || container.dataset.historyScrollBound === '1') return;
  container.dataset.historyScrollBound = '1';
  container.addEventListener('scroll', function () {
    if (container.scrollTop > 48) return;
    if (!state.activeId || !state.messages || !state.messages.length) return;
    var h = ensureHistoryState();
    if (h.mainLoadingOlder) return;
    loadOlderMessagesIntoChat({ silent: true });
  });
}

function bindChatHistoryUi() {
  if (bindChatHistoryUi._bound) return;
  bindChatHistoryUi._bound = true;

  var closeBtn = $('history-close');
  if (closeBtn) closeBtn.addEventListener('click', closeChatHistory);

  var overlay = $('chat-history-overlay');
  if (overlay) {
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeChatHistory();
    });
  }

  var search = $('history-search');
  if (search) {
    search.addEventListener('input', function () {
      ensureHistoryState().query = search.value || '';
      renderHistoryList();
    });
  }

  document.querySelectorAll('[data-history-filter]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      ensureHistoryState().filter = btn.getAttribute('data-history-filter') || 'all';
      syncHistoryFilterChips();
      renderHistoryList();
    });
  });

  var loadMore = $('history-load-more');
  if (loadMore) loadMore.addEventListener('click', function () { loadMoreHistoryMessages(); });

  bindMessagesScrollLoadOlder();
}

// ---------- Export / Import (profile backup sub-page) ----------

function sanitizePayloadForExport(payload, opts) {
  opts = opts || {};
  if (payload == null || typeof payload !== 'object') return payload;
  try {
    var copy = JSON.parse(JSON.stringify(payload));
  } catch (e) {
    return payload;
  }
  // Strip huge data-URLs unless full media requested
  if (!opts.includeMedia) {
    if (copy.data && typeof copy.data === 'string' && copy.data.length > 2048) {
      copy.data_omitted = true;
      copy.data_bytes_estimate = copy.data.length;
      delete copy.data;
    }
  }
  return copy;
}

function serializeMessageForExport(msg, opts) {
  return {
    message_id: msg.message_id || '',
    sender_actor: msg.sender_actor || '',
    message_type: msg.message_type || 'text',
    payload: sanitizePayloadForExport(msg.payload, opts),
    reply_to: msg.reply_to || null,
    is_encrypted: !!msg.is_encrypted,
    is_pinned: !!msg.is_pinned,
    created_at: msg.created_at || '',
  };
}

function buildArchiveEnvelope(conversations, opts) {
  opts = opts || {};
  var identity = state.identity || {};
  return {
    format: ARO_ARCHIVE_FORMAT,
    version: ARO_ARCHIVE_VERSION,
    exported_at: new Date().toISOString(),
    include_media: !!opts.includeMedia,
    identity: {
      actor_url: getIdentityActorUrl ? getIdentityActorUrl() : (identity.actor_url || state.localActorUrl || ''),
      handle: typeof getIdentityHandle === 'function' ? getIdentityHandle() : (identity.handle || ''),
      display_name: identity.display_name || identity.username || '',
    },
    conversations: conversations || [],
  };
}

function downloadJsonFile(filename, obj) {
  var json = JSON.stringify(obj, null, 2);
  var blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  setTimeout(function () {
    try { a.remove(); } catch (e) {}
    try { URL.revokeObjectURL(url); } catch (e2) {}
  }, 500);
}

function archiveFilename(prefix) {
  var d = new Date();
  var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
  var stamp = d.getFullYear()
    + p2(d.getMonth() + 1)
    + p2(d.getDate())
    + '-'
    + p2(d.getHours())
    + p2(d.getMinutes());
  return (prefix || 'aro-chat') + '-' + stamp + '.json';
}

async function exportActiveConversationArchive(opts) {
  opts = opts || {};
  if (!state.activeKind || !state.activeId) {
    try { Tapp.ui.showNotification({ title: lang.backupNeedConversation || lang.noConv || 'Open a chat first', type: 'error' }); } catch (e0) {}
    return;
  }
  try {
    Tapp.ui.showNotification({ title: lang.backupExporting || 'Exporting…', type: 'info' });
  } catch (e1) {}
  try {
    var msgs = await fetchAllMessagesForConversation(state.activeKind, state.activeId, {
      includeMedia: opts.includeMedia,
    });
    // Prefer fullest of live window + fetched
    msgs = mergeMessageListsAsc(state.messages || [], msgs);
    var conv = {
      kind: state.activeKind,
      id: state.activeId,
      name: historyConversationTitle(),
      remote_actor_url: state.channelDetail && state.channelDetail.remote_actor_url || '',
      member_count: state.roomDetail && state.roomDetail.member_count || undefined,
      message_count: msgs.length,
      messages: msgs.map(function (m) { return serializeMessageForExport(m, opts); }),
    };
    var archive = buildArchiveEnvelope([conv], opts);
    downloadJsonFile(archiveFilename('aro-chat-' + (state.activeKind === 'room' ? 'room' : 'dm')), archive);
    try {
      Tapp.ui.showNotification({
        title: lang.backupExportOk || 'Export ready',
        message: (lang.backupExportCount || '{n} messages').replace('{n}', String(msgs.length)),
        type: 'success',
      });
    } catch (e2) {}
  } catch (e) {
    notifyError(lang.backupExportFail || lang.loadFail || 'Export failed', e);
  }
}

async function exportAllConversationsArchive(opts) {
  opts = opts || {};
  if (state.isGuest) {
    try { Tapp.ui.showNotification({ title: lang.adminRequired || 'Sign in required', type: 'error' }); } catch (e0) {}
    return;
  }
  var statusEl = $('backup-status');
  var setStatus = function (t, kind) {
    if (!statusEl) return;
    statusEl.textContent = t || '';
    statusEl.classList.remove('backup-status-ok', 'backup-status-error');
    if (kind === 'ok') statusEl.classList.add('backup-status-ok');
    if (kind === 'error') statusEl.classList.add('backup-status-error');
  };

  try {
    setStatus(lang.backupExporting || 'Exporting…');
    // Refresh conversation list
    if (typeof loadConversations === 'function') {
      try { await loadConversations(); } catch (eLc) {}
    }
    var conversations = [];
    var channels = state.channels || [];
    var rooms = state.rooms || [];
    var totalTargets = channels.length + rooms.length;
    var done = 0;

    async function one(kind, id, name, extra) {
      done += 1;
      setStatus((lang.backupExportProgress || 'Exporting {done}/{total}…')
        .replace('{done}', String(done))
        .replace('{total}', String(totalTargets))
        + (name ? ' · ' + name : ''));
      var msgs = [];
      try {
        msgs = await fetchAllMessagesForConversation(kind, id, opts);
      } catch (eFetch) {
        console.warn('[Aro] export skip', kind, id, eFetch);
      }
      // If this is the active chat, merge live window
      if (state.activeKind === kind && state.activeId === id) {
        msgs = mergeMessageListsAsc(state.messages || [], msgs);
      }
      conversations.push(Object.assign({
        kind: kind,
        id: id,
        name: name || id,
        message_count: msgs.length,
        messages: msgs.map(function (m) { return serializeMessageForExport(m, opts); }),
      }, extra || {}));
    }

    for (var i = 0; i < channels.length; i++) {
      var ch = channels[i];
      await one(
        'channel',
        ch.channel_id,
        ch.remote_actor_name || (ch.remote_actor_url || '').split('/').pop() || ch.channel_id,
        { remote_actor_url: ch.remote_actor_url || '', status: ch.status || '' }
      );
    }
    for (var j = 0; j < rooms.length; j++) {
      var rm = rooms[j];
      await one(
        'room',
        rm.room_id,
        rm.name || rm.room_id,
        { member_count: rm.member_count || 0 }
      );
    }

    var archive = buildArchiveEnvelope(conversations, opts);
    archive.summary = {
      channels: channels.length,
      rooms: rooms.length,
      messages: conversations.reduce(function (n, c) { return n + (c.message_count || 0); }, 0),
    };
    downloadJsonFile(archiveFilename('aro-chat-all'), archive);
    setStatus(
      (lang.backupExportOk || 'Export ready') + ' · '
        + (lang.backupExportCount || '{n} messages').replace('{n}', String(archive.summary.messages)),
      'ok'
    );
    try {
      Tapp.ui.showNotification({
        title: lang.backupExportOk || 'Export ready',
        message: (lang.backupExportCount || '{n} messages').replace('{n}', String(archive.summary.messages)),
        type: 'success',
      });
    } catch (e2) {}
  } catch (e) {
    setStatus(lang.backupExportFail || lang.loadFail || 'Export failed', 'error');
    notifyError(lang.backupExportFail || lang.loadFail || 'Export failed', e);
  }
}

function parseChatArchive(raw) {
  var data = raw;
  if (typeof raw === 'string') {
    data = JSON.parse(raw);
  }
  if (!data || typeof data !== 'object') throw new Error('Invalid archive');
  // Accept envelope or bare conversation list
  if (data.format && data.format !== ARO_ARCHIVE_FORMAT) {
    // still allow if conversations array present
    if (!Array.isArray(data.conversations)) {
      throw new Error(lang.backupImportFormat || 'Unknown archive format');
    }
  }
  if (!Array.isArray(data.conversations)) {
    if (Array.isArray(data.messages) && data.id) {
      data = {
        format: ARO_ARCHIVE_FORMAT,
        version: ARO_ARCHIVE_VERSION,
        exported_at: data.exported_at || new Date().toISOString(),
        conversations: [data],
      };
    } else {
      throw new Error(lang.backupImportFormat || 'Unknown archive format');
    }
  }
  return data;
}

async function loadImportedArchives() {
  try {
    if (!Tapp.storage || typeof Tapp.storage.get !== 'function') return [];
    var list = await Tapp.storage.get(ARO_IMPORTED_ARCHIVES_KEY);
    if (!list) return [];
    if (typeof list === 'string') {
      try { list = JSON.parse(list); } catch (e) { return []; }
    }
    return Array.isArray(list) ? list : [];
  } catch (e) {
    console.warn('[Aro] loadImportedArchives', e);
    return [];
  }
}

async function saveImportedArchives(list) {
  if (!Tapp.storage || typeof Tapp.storage.set !== 'function') {
    throw new Error('storage unavailable');
  }
  // Cap stored archives to last 10 to protect storage quota
  var trimmed = (list || []).slice(0, 10);
  await Tapp.storage.set(ARO_IMPORTED_ARCHIVES_KEY, trimmed);
  return trimmed;
}

async function importChatArchiveFromFile(file) {
  if (!file) return;
  var statusEl = $('backup-status');
  var setStatus = function (t, kind) {
    if (!statusEl) return;
    statusEl.textContent = t || '';
    statusEl.classList.remove('backup-status-ok', 'backup-status-error');
    if (kind === 'ok') statusEl.classList.add('backup-status-ok');
    if (kind === 'error') statusEl.classList.add('backup-status-error');
  };
  setStatus(lang.backupImporting || 'Importing…');
  try {
    var text = await new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () { reject(reader.error || new Error('read failed')); };
      reader.readAsText(file);
    });
    var archive = parseChatArchive(text);
    var msgCount = 0;
    (archive.conversations || []).forEach(function (c) {
      msgCount += (c.messages && c.messages.length) || c.message_count || 0;
    });
    var entry = {
      id: 'imp-' + Date.now().toString(36),
      imported_at: new Date().toISOString(),
      source_name: file.name || 'archive.json',
      exported_at: archive.exported_at || '',
      identity: archive.identity || null,
      summary: archive.summary || {
        channels: (archive.conversations || []).filter(function (c) { return c.kind === 'channel'; }).length,
        rooms: (archive.conversations || []).filter(function (c) { return c.kind === 'room'; }).length,
        messages: msgCount,
      },
      // Store full archive for offline browse
      archive: archive,
    };
    var list = await loadImportedArchives();
    list.unshift(entry);
    await saveImportedArchives(list);
    setStatus(
      (lang.backupImportOk || 'Import saved') + ' · '
        + (lang.backupExportCount || '{n} messages').replace('{n}', String(msgCount)),
      'ok'
    );
    try {
      Tapp.ui.showNotification({
        title: lang.backupImportOk || 'Import saved',
        message: (lang.backupImportHint || 'Browse under Imported archives'),
        type: 'success',
      });
    } catch (e2) {}
    renderBackupPage();
  } catch (e) {
    setStatus(lang.backupImportFail || 'Import failed', 'error');
    notifyError(lang.backupImportFail || 'Import failed', e);
  }
}

async function deleteImportedArchive(id) {
  var list = await loadImportedArchives();
  list = list.filter(function (a) { return a.id !== id; });
  await saveImportedArchives(list);
  if (state.history && state.history.browseArchiveId === id) {
    state.history.browseArchiveId = null;
    state.history.browseConversationId = null;
  }
  renderBackupPage();
}

function openImportedArchiveBrowser(entryId, conversationKey) {
  ensureHistoryState();
  state.history.browseArchiveId = entryId;
  state.history.browseConversationId = conversationKey || null;
  state.history.browseQuery = state.history.browseQuery || '';
  renderBackupPage();
}

function backupConversationKey(conv, idx) {
  return (conv.kind || 'x') + ':' + (conv.id || idx);
}

async function renderBackupPage() {
  var content = $('feed-content');
  var empty = $('feed-empty');
  if (!content) return;
  if (empty) empty.style.display = 'none';
  var main = content.closest('.feed-main');
  if (main) main.classList.remove('feed-empty-visible');

  // Hide feed search on backup page
  var searchBar = document.querySelector('.feed-search-bar');
  if (searchBar) searchBar.style.display = 'none';

  if (state.isGuest) {
    content.innerHTML = '<div class="backup-page">'
      + backupHeroHtml()
      + '<div class="backup-card"><div class="backup-empty">'
      + '<div class="aro-empty-mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v12M7 11l5 5 5-5M4 20h16"/></svg></div>'
      + '<div class="history-empty-title">' + esc(lang.backupTitle || 'Chat backup') + '</div>'
      + '<div>' + esc(lang.backupGuest || 'Sign in to export or import chat history.') + '</div>'
      + '</div></div></div>';
    return;
  }

  var h = ensureHistoryState();
  var imported = await loadImportedArchives();

  // Deep browse: archive → conversation messages
  if (h.browseArchiveId) {
    var entry = null;
    for (var i = 0; i < imported.length; i++) {
      if (imported[i].id === h.browseArchiveId) { entry = imported[i]; break; }
    }
    if (!entry) {
      h.browseArchiveId = null;
    } else if (h.browseConversationId) {
      content.innerHTML = renderImportedConversationView(entry, h.browseConversationId);
      bindBackupPageEvents(content);
      return;
    } else {
      content.innerHTML = renderImportedArchiveView(entry);
      bindBackupPageEvents(content);
      return;
    }
  }

  var html = '<div class="backup-page">';
  html += backupHeroHtml();

  html += '<div class="backup-card">';
  html += '<div class="backup-card-head">'
    + '<div class="backup-card-icon backup-card-icon-export">' + (SVG_ICONS.download || '') + '</div>'
    + '<div><div class="backup-card-title">' + esc(lang.backupExportTitle || 'Export chat history') + '</div>'
    + '<p class="backup-card-desc">' + esc(lang.backupExportDesc || 'Download a JSON backup of your direct messages and group chats from this device.') + '</p></div>'
    + '</div>';
  html += '<div class="backup-actions">';
  html += '<button type="button" class="backup-btn backup-btn-primary" id="backup-export-all">'
    + (SVG_ICONS.download || '') + '<span>' + esc(lang.backupExportAll || 'Export all chats') + '</span></button>';
  html += '<button type="button" class="backup-btn" id="backup-export-active">'
    + (SVG_ICONS.download || '') + '<span>' + esc(lang.backupExportActive || 'Export open chat') + '</span></button>';
  html += '</div>';
  html += '<label class="backup-check"><input type="checkbox" id="backup-include-media" /> '
    + '<span>' + esc(lang.backupIncludeMedia || 'Include image data (larger file)') + '</span></label>';
  html += '<div id="backup-status" class="backup-status" aria-live="polite"></div>';
  html += '</div>';

  html += '<div class="backup-card">';
  html += '<div class="backup-card-head">'
    + '<div class="backup-card-icon backup-card-icon-import">' + (SVG_ICONS.cloud || '') + '</div>'
    + '<div><div class="backup-card-title">' + esc(lang.backupImportTitle || 'Import archive') + '</div>'
    + '<p class="backup-card-desc">' + esc(lang.backupImportDesc || 'Import a previously exported JSON file to browse offline. Import does not re-send messages to the server.') + '</p></div>'
    + '</div>';
  html += '<div class="backup-actions">';
  html += '<button type="button" class="backup-btn backup-btn-primary" id="backup-import-btn">'
    + (SVG_ICONS.cloud || '') + '<span>' + esc(lang.backupImportBtn || 'Choose JSON file') + '</span></button>';
  html += '<input type="file" id="backup-import-input" accept="application/json,.json" style="display:none" />';
  html += '</div>';
  html += '</div>';

  html += '<div class="backup-card">';
  html += '<div class="backup-card-head">'
    + '<div class="backup-card-icon backup-card-icon-archive">' + (SVG_ICONS.page || '') + '</div>'
    + '<div><div class="backup-card-title">' + esc(lang.backupImportedTitle || 'Imported archives') + '</div>'
    + '<p class="backup-card-desc">' + esc(imported.length
      ? (lang.backupImportHint || '')
      : (lang.backupImportedEmpty || 'No imports yet.')) + '</p></div>'
    + '</div>';
  if (!imported.length) {
    html += '<div class="backup-empty">'
      + '<div class="aro-empty-mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg></div>'
      + '<div>' + esc(lang.backupImportedEmpty || 'No imports yet.') + '</div>'
      + '</div>';
  } else {
    html += '<div class="backup-archive-list">';
    imported.forEach(function (a) {
      var sum = a.summary || {};
      var meta = [];
      if (sum.messages != null) meta.push((lang.backupExportCount || '{n} messages').replace('{n}', String(sum.messages)));
      if (a.imported_at) {
        try { meta.push(new Date(a.imported_at).toLocaleString(currentLocale)); } catch (e) { meta.push(a.imported_at); }
      }
      html += '<div class="backup-archive-item" data-archive-id="' + esc(a.id) + '">'
        + '<div class="backup-archive-icon backup-archive-icon-file">' + (SVG_ICONS.page || '') + '</div>'
        + '<div class="backup-archive-info">'
        + '<div class="backup-archive-name">' + esc(a.source_name || a.id) + '</div>'
        + '<div class="backup-archive-meta">' + esc(meta.join(' · ')) + '</div>'
        + '</div>'
        + '<div class="backup-archive-actions">'
        + '<button type="button" class="backup-btn backup-btn-sm" data-open-archive="' + esc(a.id) + '">' + esc(lang.backupBrowse || 'Browse') + '</button>'
        + '<button type="button" class="backup-btn backup-btn-sm backup-btn-danger" data-del-archive="' + esc(a.id) + '" title="' + esc(lang.remove || 'Remove') + '">' + esc(lang.remove || 'Remove') + '</button>'
        + '</div>'
        + '</div>';
    });
    html += '</div>';
  }
  html += '</div>';

  html += '<div class="backup-card backup-card-muted">';
  html += '<p class="backup-card-desc">' + esc(lang.backupPrivacyNote || 'Exports stay on your device. Large image payloads are omitted unless you enable “Include image data”.') + '</p>';
  html += '</div>';
  html += '</div>';

  content.innerHTML = html;
  bindBackupPageEvents(content);
}

function backupHeroHtml() {
  return '<div class="backup-hero">'
    + '<div class="backup-hero-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 11l5 5 5-5M4 20h16"/></svg></div>'
    + '<div class="backup-hero-text">'
    + '<h2 class="backup-hero-title">' + esc(lang.backupTitle || 'Chat backup') + '</h2>'
    + '<p class="backup-hero-desc">' + esc(lang.backupHint || lang.feedHintBackup || 'Export and import your messenger history') + '</p>'
    + '</div></div>';
}

function backupBackBtnHtml(id) {
  return '<button type="button" class="backup-btn backup-btn-ghost" id="' + id + '">'
    + '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>'
    + '<span>' + esc(lang.back || 'Back') + '</span></button>';
}

function renderImportedArchiveView(entry) {
  var archive = entry.archive || {};
  var convs = archive.conversations || [];
  var html = '<div class="backup-page">';
  html += '<div class="backup-toolbar">';
  html += backupBackBtnHtml('backup-back-root');
  html += '<div class="backup-toolbar-title">' + esc(entry.source_name || lang.backupImportedTitle || 'Archive') + '</div>';
  html += '</div>';
  html += '<div class="backup-card">';
  if (!convs.length) {
    html += '<div class="backup-empty">'
      + '<div class="aro-empty-mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></div>'
      + '<div>' + esc(lang.historyEmpty || 'No messages') + '</div></div>';
  } else {
    html += '<div class="backup-archive-list">';
    convs.forEach(function (c, idx) {
      var key = backupConversationKey(c, idx);
      var count = (c.messages && c.messages.length) || c.message_count || 0;
      var isRoom = c.kind === 'room';
      var kindLabel = isRoom ? (lang.newRoom || 'Room') : (lang.dm || 'DM');
      var iconCls = isRoom ? 'backup-archive-icon-room' : 'backup-archive-icon-dm';
      var icon = isRoom ? (SVG_ICONS.room || '') : (SVG_ICONS.channel || '');
      html += '<button type="button" class="backup-archive-item backup-archive-link" data-open-conv="' + esc(key) + '">'
        + '<div class="backup-archive-icon ' + iconCls + '">' + icon + '</div>'
        + '<div class="backup-archive-info">'
        + '<div class="backup-archive-name">' + esc(c.name || c.id || key) + '</div>'
        + '<div class="backup-archive-meta">' + esc(kindLabel + ' · ' + (lang.backupExportCount || '{n} messages').replace('{n}', String(count))) + '</div>'
        + '</div>'
        + '<span class="backup-chevron">' + (SVG_ICONS.chevronRight || '›') + '</span>'
        + '</button>';
    });
    html += '</div>';
  }
  html += '</div></div>';
  return html;
}

function renderImportedConversationView(entry, convKey) {
  var archive = entry.archive || {};
  var convs = archive.conversations || [];
  var conv = null;
  for (var i = 0; i < convs.length; i++) {
    if (backupConversationKey(convs[i], i) === convKey) { conv = convs[i]; break; }
  }
  var h = ensureHistoryState();
  var q = h.browseQuery || '';
  var msgs = (conv && conv.messages) || [];
  var filtered = filterHistoryMessages(msgs, q, 'all');
  var view = filtered.slice().reverse();

  var html = '<div class="backup-page">';
  html += '<div class="backup-toolbar">';
  html += backupBackBtnHtml('backup-back-archive');
  html += '<div class="backup-toolbar-title">' + esc((conv && conv.name) || convKey) + '</div>';
  html += '</div>';
  html += '<div class="aro-search-bar history-search-bar" style="padding:0 0 10px;border:none">';
  html += '<span class="aro-search-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg></span>';
  html += '<input id="backup-browse-search" class="aro-search-input" type="search" autocomplete="off" placeholder="' + esc(lang.historySearchPlaceholder || 'Search…') + '" value="' + esc(q) + '" />';
  html += '</div>';
  html += '<div class="backup-card backup-card-flat">';
  html += '<div class="backup-browse-meta">' + esc((lang.historyMatchCount || '{n} / {total}')
    .replace('{n}', String(filtered.length))
    .replace('{total}', String(msgs.length))) + '</div>';
  if (!view.length) {
    html += historyEmptyHtml(
      q ? (lang.searchNoResults || 'No matches') : (lang.historyEmpty || 'No messages'),
      ''
    );
  } else {
    html += '<div class="history-list backup-history-list">';
    view.forEach(function (msg) {
      var time = typeof timeStr === 'function' ? timeStr(msg.created_at) : (msg.created_at || '');
      var sender = (msg.sender_actor || '').split('/').pop() || '?';
      var kind = classifyHistoryMessage(msg);
      var kindClass = kind !== 'text' ? (' history-item-kind-' + kind) : '';
      html += '<div class="history-item history-item-static">'
        + '<div class="history-item-avatar">' + esc((sender || '?').charAt(0).toUpperCase()) + '</div>'
        + '<div class="history-item-body">'
        + '<div class="history-item-top">'
        + '<span class="history-item-name">' + esc(sender) + '</span>'
        + (kind !== 'text' ? '<span class="history-item-kind' + kindClass + '">' + esc(historyKindLabel(kind)) + '</span>' : '')
        + (time ? '<span class="history-item-time">' + esc(time) + '</span>' : '')
        + '</div>'
        + '<div class="history-item-text">' + esc(historyPreviewText(msg)) + '</div>'
        + '</div></div>';
    });
    html += '</div>';
  }
  html += '</div></div>';
  return html;
}

function bindBackupPageEvents(root) {
  root = root || document;
  var exportAll = root.querySelector('#backup-export-all') || $('backup-export-all');
  if (exportAll) {
    exportAll.addEventListener('click', function () {
      var includeMedia = !!( $('backup-include-media') && $('backup-include-media').checked );
      exportAllConversationsArchive({ includeMedia: includeMedia });
    });
  }
  var exportActive = root.querySelector('#backup-export-active') || $('backup-export-active');
  if (exportActive) {
    exportActive.addEventListener('click', function () {
      var includeMedia = !!( $('backup-include-media') && $('backup-include-media').checked );
      exportActiveConversationArchive({ includeMedia: includeMedia });
    });
  }
  var importBtn = root.querySelector('#backup-import-btn') || $('backup-import-btn');
  var importInput = root.querySelector('#backup-import-input') || $('backup-import-input');
  if (importBtn && importInput) {
    importBtn.addEventListener('click', function () { importInput.click(); });
    importInput.addEventListener('change', function () {
      var file = importInput.files && importInput.files[0];
      importInput.value = '';
      if (file) importChatArchiveFromFile(file);
    });
  }
  root.querySelectorAll('[data-open-archive]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      openImportedArchiveBrowser(btn.getAttribute('data-open-archive'));
    });
  });
  root.querySelectorAll('[data-del-archive]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      var id = btn.getAttribute('data-del-archive');
      try {
        await deleteImportedArchive(id);
        try { Tapp.ui.showNotification({ title: lang.backupDeleted || lang.remove || 'Removed', type: 'success' }); } catch (e0) {}
      } catch (e) {
        notifyError(lang.backupImportFail || 'Failed', e);
      }
    });
  });
  var backRoot = root.querySelector('#backup-back-root');
  if (backRoot) {
    backRoot.addEventListener('click', function () {
      ensureHistoryState().browseArchiveId = null;
      ensureHistoryState().browseConversationId = null;
      renderBackupPage();
    });
  }
  var backArch = root.querySelector('#backup-back-archive');
  if (backArch) {
    backArch.addEventListener('click', function () {
      ensureHistoryState().browseConversationId = null;
      renderBackupPage();
    });
  }
  root.querySelectorAll('[data-open-conv]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      openImportedArchiveBrowser(ensureHistoryState().browseArchiveId, btn.getAttribute('data-open-conv'));
    });
  });
  var browseSearch = root.querySelector('#backup-browse-search');
  if (browseSearch) {
    browseSearch.addEventListener('input', function () {
      ensureHistoryState().browseQuery = browseSearch.value || '';
      renderBackupPage();
    });
  }
}

/** Inject history button into chat header actions (called from renderChatHeader). */
function historyHeaderButtonHtml() {
  var title = lang.historyTitle || 'Chat history';
  return '<button type="button" class="aro-icon-btn" id="history-open-btn" title="' + esc(title) + '" aria-label="' + esc(title) + '">'
    + '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>'
    + '</button>';
}

function wireHistoryHeaderButton() {
  var btn = $('history-open-btn');
  if (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      openChatHistory();
    });
  }
}

// Reset history when leaving a conversation
function resetHistoryOnConversationChange() {
  ensureHistoryState();
  if (state.history.open) closeChatHistory();
  state.history.messages = [];
  state.history.query = '';
  state.history.filter = 'all';
  state.history.hasMore = false;
  state.history.error = null;
  state.history.kind = null;
  state.history.id = null;
}
`

const PAGE_MOD_FILES = `\
// ==================== Room files (group attachment library) ====================
// Phase 1: prefer GET rooms/{id}/files (server index over messages + transfers).
// Fallback: client aggregate of state.messages + listRoomTransfers.
// Bytes live on the sender instance (transfer disk or message payload.data).

var ROOM_FILES_PAGE_LIMIT = 50;

function ensureRoomFilesState() {
  if (!state.roomFiles) {
    state.roomFiles = {
      open: false,
      roomId: null,
      items: [],
      query: '',
      filter: 'all',
      loading: false,
      loadingMore: false,
      hasMore: false,
      error: null,
      oldestMessageId: null,
      source: 'client', // 'server' | 'client'
      searchTimer: null,
    };
  }
  return state.roomFiles;
}

function roomFilesHeaderButtonHtml() {
  var title = lang.roomFilesTitle || 'Group files';
  return '<button type="button" class="aro-icon-btn" id="room-files-open-btn" title="' + esc(title) + '" aria-label="' + esc(title) + '">'
    + '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>'
    + '</button>';
}

function wireRoomFilesHeaderButton() {
  var btn = $('room-files-open-btn');
  if (!btn) return;
  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    openRoomFiles();
  });
}

function applyRoomFilesLabels() {
  var el;
  el = $('room-files-title');
  if (el) el.textContent = lang.roomFilesTitle || 'Group files';
  el = $('room-files-close');
  if (el) el.setAttribute('aria-label', lang.close || lang.dismiss || 'Close');
  applySearchInputLabel('room-files-search', lang.roomFilesSearch || lang.pickerSearchPlaceholder || 'Search…');
  el = $('room-files-load-more');
  if (el) el.textContent = lang.roomFilesLoadMore || lang.historyLoadMore || 'Load more';
  el = $('room-files-hint');
  if (el) el.textContent = lang.roomFilesHint || '';
  var map = {
    all: lang.roomFilesFilterAll || lang.historyFilterAll || 'All',
    image: lang.roomFilesFilterImage || lang.historyFilterImage || 'Images',
    file: lang.roomFilesFilterFile || lang.historyFilterFile || 'Files',
  };
  document.querySelectorAll('[data-room-files-filter]').forEach(function (btn) {
    var k = btn.getAttribute('data-room-files-filter');
    if (map[k]) btn.textContent = map[k];
  });
}

function syncRoomFilesFilterChips() {
  var rf = ensureRoomFilesState();
  document.querySelectorAll('[data-room-files-filter]').forEach(function (btn) {
    var active = btn.getAttribute('data-room-files-filter') === rf.filter;
    btn.classList.toggle('history-filter-active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
}

function isRoomFilesOpen() {
  var overlay = $('room-files-overlay');
  return !!(overlay && overlay.style.display !== 'none' && !overlay.hidden);
}

function closeRoomFiles() {
  var rf = ensureRoomFilesState();
  rf.open = false;
  if (rf.searchTimer) {
    try { clearTimeout(rf.searchTimer); } catch (e) { /* ignore */ }
    rf.searchTimer = null;
  }
  var overlay = $('room-files-overlay');
  if (!overlay || overlay.style.display === 'none') return;
  overlay.classList.remove('aro-history-enter');
  if (typeof aroDismiss === 'function') {
    aroDismiss(overlay, {
      ms: 160,
      onDone: function () { overlay.hidden = true; },
    });
  } else {
    overlay.style.display = 'none';
    overlay.hidden = true;
  }
}

function resetRoomFilesOnConversationChange() {
  var rf = ensureRoomFilesState();
  if (rf.open) closeRoomFiles();
  rf.roomId = null;
  rf.items = [];
  rf.query = '';
  rf.filter = 'all';
  rf.hasMore = false;
  rf.error = null;
  rf.oldestMessageId = null;
  rf.loading = false;
  rf.loadingMore = false;
  rf.source = 'client';
}

/** Classify message as room-files kind: image | file | null */
function roomFileKindFromMessage(msg) {
  if (!msg) return null;
  var payload = (typeof msg.payload === 'object' && msg.payload) ? msg.payload : {};
  var mt = msg.message_type || 'text';
  if (mt === 'text' || !mt) {
    if (payload.transfer_id && payload.filename) mt = 'file-meta';
    else if (payload.data && payload.mime_type && String(payload.mime_type).indexOf('image/') === 0) mt = 'image';
    else if (payload.data && payload.filename) mt = 'file';
  }
  if (mt === 'image') return 'image';
  if (mt === 'file' || mt === 'file-meta') return 'file';
  return null;
}

function roomFileSenderLabel(actorOrMsg) {
  var actor = '';
  if (typeof actorOrMsg === 'string') actor = actorOrMsg;
  else if (actorOrMsg) actor = actorOrMsg.sender_actor || '';
  if (!actor) return '—';
  if (typeof isLocalActor === 'function' && isLocalActor(actor)) {
    return lang.me || lang.local || 'Me';
  }
  if (typeof findMemberByActor === 'function') {
    var m = findMemberByActor(actor);
    if (m && m.display_name) return m.display_name;
  }
  return actor.split('/').pop() || '?';
}

/**
 * Status for list UI + download affordance.
 * transfer_id without local list entry still counts as ready (same as message card).
 */
function roomFileStatusFromParts(hasInline, transferStatus, hasTransferId) {
  if (hasInline) return 'ready';
  if (transferStatus === 'completed') return 'ready';
  if (transferStatus === 'pending' || transferStatus === 'in-progress' || transferStatus === 'transferring') {
    return 'pending';
  }
  if (transferStatus === 'failed' || transferStatus === 'cancelled') return 'missing';
  if (hasTransferId) return 'ready';
  return 'missing';
}

function roomFileStatusLabel(status) {
  if (status === 'ready') return lang.roomFilesStatusReady || 'Ready';
  if (status === 'pending') return lang.roomFilesStatusPending || 'Uploading…';
  return lang.roomFilesStatusMissing || 'Unavailable';
}

function roomFileExtBadge(filename, kind) {
  var name = String(filename || '');
  var ext = '';
  var dot = name.lastIndexOf('.');
  if (dot > 0 && dot < name.length - 1) {
    ext = name.slice(dot + 1).toUpperCase();
    if (ext.length > 5) ext = ext.slice(0, 4) + '…';
  }
  if (!ext) ext = kind === 'image' ? 'IMG' : 'FILE';
  return ext;
}

/**
 * Build list items from messages (attachments only).
 * transferMap: transfer_id -> { status, filename, file_size, mime_type }
 */
function buildRoomFileItemsFromMessages(messages, transferMap) {
  transferMap = transferMap || {};
  var items = [];
  (messages || []).forEach(function (msg) {
    var kind = roomFileKindFromMessage(msg);
    if (!kind) return;
    var payload = (typeof msg.payload === 'object' && msg.payload) ? msg.payload : {};
    var transferId = payload.transfer_id || '';
    var tr = transferId ? transferMap[transferId] : null;
    var hasInline = !!(payload.data);
    var status = roomFileStatusFromParts(hasInline, tr && tr.status, !!transferId);
    var filename = payload.filename || (tr && tr.filename) || (kind === 'image' ? 'image' : 'file');
    var size = payload.size || (tr && tr.file_size) || 0;
    var mime = payload.mime_type || (tr && tr.mime_type) || '';
    var dlPayload = payload;
    if (!hasInline && transferId && (!payload.transfer_id || !payload.filename)) {
      dlPayload = {
        transfer_id: transferId,
        filename: filename,
        size: size,
        mime_type: mime,
      };
    }
    items.push({
      key: (msg.message_id || '') + ':' + (transferId || filename),
      message_id: msg.message_id || '',
      kind: kind,
      filename: filename,
      size: size,
      mime: mime,
      sender: roomFileSenderLabel(msg),
      sender_actor: msg.sender_actor || '',
      created_at: msg.created_at || '',
      transfer_id: transferId,
      has_inline: hasInline,
      status: status,
      payload: dlPayload,
    });
  });
  return items;
}

/** Merge transfer-only rows that have no message yet (rare race). */
function mergeOrphanTransfers(items, transfers, knownIds) {
  knownIds = knownIds || {};
  (transfers || []).forEach(function (tr) {
    var id = tr.transfer_id || tr.id;
    if (!id || knownIds[id]) return;
    if (tr.status !== 'completed' && tr.status !== 'pending' && tr.status !== 'in-progress' && tr.status !== 'transferring') {
      return;
    }
    items.push({
      key: 'tr:' + id,
      message_id: '',
      kind: 'file',
      filename: tr.filename || 'file',
      size: tr.file_size || 0,
      mime: tr.mime_type || '',
      sender: '—',
      sender_actor: '',
      created_at: tr.created_at || '',
      transfer_id: id,
      has_inline: false,
      status: roomFileStatusFromParts(false, tr.status, true),
      payload: { transfer_id: id, filename: tr.filename, size: tr.file_size, mime_type: tr.mime_type },
    });
  });
  return items;
}

function sortRoomFileItemsNewestFirst(items) {
  items.sort(function (a, b) {
    return String(b.created_at || '').localeCompare(String(a.created_at || ''));
  });
  return items;
}

function filterRoomFileItems(items, query, filter) {
  var q = normalizeSearchQuery(query);
  var f = filter || 'all';
  return (items || []).filter(function (it) {
    if (f === 'image' && it.kind !== 'image') return false;
    if (f === 'file' && it.kind !== 'file') return false;
    if (!q) return true;
    return matchesSearch(q, [it.filename, it.sender, it.mime, it.transfer_id, it.kind]);
  });
}

function unwrapTransfersResponse(res) {
  if (!res) return [];
  if (Array.isArray(res)) return res;
  if (Array.isArray(res.transfers)) return res.transfers;
  if (res.data && Array.isArray(res.data.transfers)) return res.data.transfers;
  return [];
}

function unwrapMessagesResponse(res) {
  if (!res) return [];
  if (Array.isArray(res)) return res;
  if (Array.isArray(res.messages)) return res.messages;
  if (res.data && Array.isArray(res.data.messages)) return res.data.messages;
  return [];
}

function unwrapRoomFilesResponse(res) {
  if (!res) return { files: [], hasMore: false, total: 0 };
  var root = res;
  if (res.data && (Array.isArray(res.data.files) || Array.isArray(res.data))) {
    root = res.data;
  }
  var files = Array.isArray(root.files) ? root.files : (Array.isArray(root) ? root : []);
  return {
    files: files,
    hasMore: !!root.has_more,
    total: typeof root.total === 'number' ? root.total : files.length,
  };
}

function mapServerRoomFileItem(raw) {
  if (!raw) return null;
  var kind = raw.kind === 'image' ? 'image' : 'file';
  var transferId = raw.transfer_id || '';
  var hasInline = !!raw.has_inline;
  var status = raw.status || roomFileStatusFromParts(hasInline, null, !!transferId);
  var filename = raw.filename || (kind === 'image' ? 'image' : 'file');
  var size = raw.size || 0;
  var mime = raw.mime_type || raw.mime || '';
  return {
    key: raw.key || ((raw.message_id || '') + ':' + (transferId || filename)),
    message_id: raw.message_id || '',
    kind: kind,
    filename: filename,
    size: size,
    mime: mime,
    sender: roomFileSenderLabel(raw.sender_actor || ''),
    sender_actor: raw.sender_actor || '',
    created_at: raw.created_at || '',
    transfer_id: transferId,
    has_inline: hasInline,
    status: status,
    payload: transferId
      ? { transfer_id: transferId, filename: filename, size: size, mime_type: mime }
      : null,
  };
}

async function fetchRoomTransfersMap(roomId) {
  var map = {};
  if (!roomId || typeof Tapp === 'undefined' || !Tapp.federation) return map;
  if (typeof Tapp.federation.listRoomTransfers !== 'function') return map;
  try {
    var res = await Tapp.federation.listRoomTransfers(roomId);
    unwrapTransfersResponse(res).forEach(function (tr) {
      var id = tr.transfer_id || tr.id;
      if (id) map[id] = tr;
    });
  } catch (e) {
    console.warn('[Aro] listRoomTransfers failed', e);
  }
  return map;
}

function rebuildRoomFilesFromStateMessages(transferMap) {
  var rf = ensureRoomFilesState();
  var items = buildRoomFileItemsFromMessages(state.messages || [], transferMap);
  var known = {};
  items.forEach(function (it) { if (it.transfer_id) known[it.transfer_id] = true; });
  var transfers = Object.keys(transferMap).map(function (k) { return transferMap[k]; });
  mergeOrphanTransfers(items, transfers, known);
  sortRoomFileItemsNewestFirst(items);
  rf.items = items;
  rf.source = 'client';
  if ((state.messages || []).length) {
    rf.oldestMessageId = state.messages[0].message_id || null;
    rf.hasMore = state.messages.length >= 100;
  } else {
    rf.oldestMessageId = null;
    rf.hasMore = false;
  }
}

function supportsListRoomFiles() {
  return typeof Tapp !== 'undefined'
    && Tapp.federation
    && typeof Tapp.federation.listRoomFiles === 'function';
}

async function fetchRoomFilesPage(roomId, opts) {
  opts = opts || {};
  var res = await Tapp.federation.listRoomFiles(roomId, {
    before: opts.before || undefined,
    limit: opts.limit || ROOM_FILES_PAGE_LIMIT,
    filter: opts.filter && opts.filter !== 'all' ? opts.filter : undefined,
    q: opts.q || undefined,
  });
  var unwrapped = unwrapRoomFilesResponse(res);
  var items = [];
  unwrapped.files.forEach(function (raw) {
    var it = mapServerRoomFileItem(raw);
    if (it) items.push(it);
  });
  return {
    items: items,
    hasMore: unwrapped.hasMore,
    total: unwrapped.total,
  };
}

async function openRoomFiles() {
  ensureRoomFilesState();
  if (state.activeKind !== 'room' || !state.activeId) {
    try {
      Tapp.ui.showNotification({
        title: lang.roomFilesOnlyRoom || lang.roomFilesTitle || 'Group files',
        type: 'error',
      });
    } catch (e0) { /* ignore */ }
    return;
  }
  if (typeof closeChatHistory === 'function' && typeof isChatHistoryOpen === 'function' && isChatHistoryOpen()) {
    closeChatHistory();
  }

  var rf = state.roomFiles;
  rf.open = true;
  rf.roomId = state.activeId;
  rf.error = null;
  rf.loading = true;
  rf.items = [];
  rf.hasMore = false;
  rf.oldestMessageId = null;

  var overlay = $('room-files-overlay');
  if (!overlay) return;
  overlay.hidden = false;
  overlay.style.display = 'flex';
  overlay.classList.remove('aro-leaving', 'aro-history-enter');
  try { void overlay.offsetWidth; } catch (eAnim) { /* ignore */ }
  if (!(typeof prefersReducedMotion === 'function' && prefersReducedMotion())) {
    overlay.classList.add('aro-history-enter');
    var clearEnter = function () {
      overlay.classList.remove('aro-history-enter');
      overlay.removeEventListener('animationend', clearEnter);
    };
    overlay.addEventListener('animationend', clearEnter);
    setTimeout(clearEnter, 360);
  }

  applyRoomFilesLabels();
  var sub = $('room-files-subtitle');
  if (sub) {
    sub.textContent = (state.roomDetail && state.roomDetail.name)
      || lang.roomFilesTitle
      || 'Group files';
  }
  var search = $('room-files-search');
  if (search) search.value = rf.query || '';
  syncRoomFilesFilterChips();
  renderRoomFilesList();

  try {
    await loadRoomFilesFirstPage();
  } catch (e) {
    rf.error = (typeof getErrorMessage === 'function' ? getErrorMessage(e) : '') || lang.roomFilesLoading || 'Load failed';
  } finally {
    rf.loading = false;
    renderRoomFilesList();
  }

  if (search) {
    try { search.focus(); } catch (eF) { /* ignore */ }
  }
}

async function loadRoomFilesFirstPage() {
  var rf = ensureRoomFilesState();
  if (!rf.roomId) return;

  if (supportsListRoomFiles()) {
    try {
      var page = await fetchRoomFilesPage(rf.roomId, {
        filter: rf.filter,
        q: normalizeSearchQuery(rf.query) || undefined,
        limit: ROOM_FILES_PAGE_LIMIT,
      });
      rf.items = page.items;
      rf.hasMore = page.hasMore;
      rf.source = 'server';
      rf.oldestMessageId = oldestMessageIdFromItems(page.items);
      return;
    } catch (e) {
      console.warn('[Aro] listRoomFiles failed, falling back to client scan', e);
    }
  }

  // Phase 0 fallback
  var transferMap = await fetchRoomTransfersMap(rf.roomId);
  rebuildRoomFilesFromStateMessages(transferMap);
}

function oldestMessageIdFromItems(items) {
  var oldest = null;
  var oldestTs = '';
  (items || []).forEach(function (it) {
    if (!it.message_id) return;
    var ts = it.created_at || '';
    if (!oldest || String(ts).localeCompare(String(oldestTs)) < 0) {
      oldest = it.message_id;
      oldestTs = ts;
    }
  });
  return oldest;
}

async function loadMoreRoomFiles() {
  var rf = ensureRoomFilesState();
  if (!rf.open || !rf.roomId || rf.loadingMore || !rf.hasMore) return;
  rf.loadingMore = true;
  rf.error = null;
  updateRoomFilesFooter();
  try {
    if (rf.source === 'server' && supportsListRoomFiles()) {
      var before = rf.oldestMessageId || undefined;
      var page = await fetchRoomFilesPage(rf.roomId, {
        before: before,
        filter: rf.filter,
        q: normalizeSearchQuery(rf.query) || undefined,
        limit: ROOM_FILES_PAGE_LIMIT,
      });
      if (!page.items.length) {
        rf.hasMore = false;
      } else {
        var seen = {};
        rf.items.forEach(function (it) { seen[it.key] = true; });
        page.items.forEach(function (it) {
          if (!seen[it.key]) rf.items.push(it);
        });
        rf.hasMore = page.hasMore;
        var nextOldest = oldestMessageIdFromItems(page.items);
        if (nextOldest) rf.oldestMessageId = nextOldest;
      }
    } else {
      // Client: page older room messages into live window
      if (typeof Tapp === 'undefined' || !Tapp.federation || typeof Tapp.federation.getRoomMessages !== 'function') {
        rf.hasMore = false;
        return;
      }
      var beforeMsg = rf.oldestMessageId || undefined;
      var res = await Tapp.federation.getRoomMessages(rf.roomId, beforeMsg, 100);
      var batch = unwrapMessagesResponse(res);
      if (!batch.length) {
        rf.hasMore = false;
      } else {
        if (state.activeKind === 'room' && state.activeId === rf.roomId) {
          var existing = {};
          (state.messages || []).forEach(function (m) {
            if (m.message_id) existing[m.message_id] = true;
          });
          var older = [];
          batch.forEach(function (m) {
            if (m.message_id && !existing[m.message_id]) older.push(m);
          });
          if (older.length && typeof mergeMessageListsAsc === 'function') {
            state.messages = mergeMessageListsAsc(state.messages || [], older);
            if (typeof messagesFingerprint === 'function') {
              state.messagesFp = messagesFingerprint(state.messages);
            }
            state.skipMsgAppear = true;
            if (typeof renderMessages === 'function') renderMessages();
          } else if (older.length) {
            state.messages = older.concat(state.messages || []);
          }
          rf.oldestMessageId = state.messages.length ? state.messages[0].message_id : rf.oldestMessageId;
        } else {
          rf.oldestMessageId = batch[0].message_id || rf.oldestMessageId;
        }
        rf.hasMore = batch.length >= 100;
        var transferMap = await fetchRoomTransfersMap(rf.roomId);
        rebuildRoomFilesFromStateMessages(transferMap);
      }
    }
  } catch (e) {
    rf.error = (typeof getErrorMessage === 'function' ? getErrorMessage(e) : '') || lang.loadFail || 'Load failed';
    console.error('[Aro] loadMoreRoomFiles', e);
  } finally {
    rf.loadingMore = false;
    renderRoomFilesList();
  }
}

async function refreshRoomFilesFromServer() {
  var rf = ensureRoomFilesState();
  if (!rf.open || !rf.roomId || rf.loading || rf.loadingMore) return;
  rf.loading = true;
  rf.error = null;
  updateRoomFilesFooter();
  try {
    await loadRoomFilesFirstPage();
  } catch (e) {
    rf.error = (typeof getErrorMessage === 'function' ? getErrorMessage(e) : '') || lang.loadFail || 'Load failed';
  } finally {
    rf.loading = false;
    renderRoomFilesList();
  }
}

function scheduleRoomFilesSearchRefresh() {
  var rf = ensureRoomFilesState();
  if (rf.searchTimer) {
    try { clearTimeout(rf.searchTimer); } catch (e) { /* ignore */ }
  }
  // Server search when using index; client filter is instant (no debounce needed for client-only)
  if (rf.source === 'server' || supportsListRoomFiles()) {
    rf.searchTimer = setTimeout(function () {
      rf.searchTimer = null;
      if (!rf.open) return;
      refreshRoomFilesFromServer();
    }, 280);
  } else {
    renderRoomFilesList();
  }
}

function updateRoomFilesFooter() {
  var rf = ensureRoomFilesState();
  var meta = $('room-files-meta');
  var loadBtn = $('room-files-load-more');
  var displayItems = rf.source === 'server'
    ? (rf.items || [])
    : filterRoomFileItems(rf.items, rf.query, rf.filter);
  if (meta) {
    meta.classList.toggle('history-meta-error', !!rf.error && !rf.loadingMore && !rf.loading);
    if (rf.loadingMore || rf.loading) {
      meta.textContent = lang.roomFilesLoading || lang.pickerLoading || 'Loading…';
    } else if (rf.error) {
      meta.textContent = rf.error;
    } else {
      var q = normalizeSearchQuery(rf.query);
      var total = (rf.items || []).length;
      if (rf.source === 'client' && (q || (rf.filter && rf.filter !== 'all'))) {
        meta.textContent = (lang.roomFilesMatchCount || lang.historyMatchCount || '{n} / {total}')
          .replace('{n}', String(displayItems.length))
          .replace('{total}', String(total));
      } else {
        meta.textContent = (lang.roomFilesCount || '{n} items').replace('{n}', String(displayItems.length));
      }
    }
  }
  if (loadBtn) {
    loadBtn.hidden = !rf.hasMore;
    loadBtn.disabled = !!rf.loadingMore || !!rf.loading;
    loadBtn.textContent = rf.loadingMore
      ? (lang.roomFilesLoading || 'Loading…')
      : (lang.roomFilesLoadMore || 'Load more');
  }
}

function roomFileCanDownload(item) {
  if (!item || item.status === 'pending' || item.status === 'missing') return false;
  if (item.transfer_id) return true;
  if (item.has_inline) {
    // Need live payload.data or will jump-to-chat instead
    if (item.payload && item.payload.data) return true;
    if (item.message_id && state.messages) {
      for (var i = 0; i < state.messages.length; i++) {
        if (state.messages[i].message_id === item.message_id
          && state.messages[i].payload
          && state.messages[i].payload.data) {
          return true;
        }
      }
    }
  }
  return false;
}

function roomFileResolvePayload(item) {
  if (!item) return null;
  if (item.message_id && state.messages) {
    for (var j = 0; j < state.messages.length; j++) {
      if (state.messages[j].message_id === item.message_id && state.messages[j].payload) {
        return state.messages[j].payload;
      }
    }
  }
  if (item.payload) return item.payload;
  if (item.transfer_id) {
    return {
      transfer_id: item.transfer_id,
      filename: item.filename,
      size: item.size,
      mime_type: item.mime,
    };
  }
  return null;
}

function renderRoomFilesList() {
  var list = $('room-files-list');
  if (!list) return;
  var rf = ensureRoomFilesState();
  var filtered = rf.source === 'server'
    ? (rf.items || [])
    : filterRoomFileItems(rf.items, rf.query, rf.filter);

  if (rf.loading && !rf.items.length) {
    list.innerHTML = '<div class="room-files-skeleton" aria-hidden="true">'
      + '<div class="room-files-skel-row"></div>'
      + '<div class="room-files-skel-row"></div>'
      + '<div class="room-files-skel-row"></div>'
      + '</div>';
    updateRoomFilesFooter();
    return;
  }
  if (!rf.items.length) {
    list.innerHTML = typeof historyEmptyHtml === 'function'
      ? historyEmptyHtml(lang.roomFilesEmpty || 'No files yet', lang.roomFilesEmptyHint || '')
      : '<div class="history-empty">' + esc(lang.roomFilesEmpty || 'No files') + '</div>';
    updateRoomFilesFooter();
    return;
  }
  if (!filtered.length) {
    list.innerHTML = typeof historyEmptyHtml === 'function'
      ? historyEmptyHtml(lang.searchNoResults || 'No matches', '')
      : '<div class="history-empty">' + esc(lang.searchNoResults || 'No matches') + '</div>';
    updateRoomFilesFooter();
    return;
  }

  var html = '';
  var lastDay = '';
  filtered.forEach(function (it) {
    var day = '';
    try {
      var d = new Date(it.created_at);
      if (!isNaN(d)) day = d.toDateString();
    } catch (e) { day = ''; }
    if (day && day !== lastDay) {
      lastDay = day;
      html += '<div class="history-day"><span>'
        + esc(typeof dayLabel === 'function' ? dayLabel(it.created_at) : day)
        + '</span></div>';
    }
    var time = typeof timeStr === 'function' ? timeStr(it.created_at) : '';
    var sizeLabel = it.size && typeof formatFileSize === 'function' ? formatFileSize(it.size) : (it.size ? String(it.size) : '');
    var statusClass = 'room-file-status room-file-status-' + (it.status || 'missing');
    var canDl = roomFileCanDownload(it);
    var canJump = !!it.message_id;
    var badge = roomFileExtBadge(it.filename, it.kind);
    var kindClass = it.kind === 'image' ? 'room-file-tile-image' : 'room-file-tile-file';
    var metaBits = [it.sender, sizeLabel].filter(Boolean).join(' · ');

    html += '<div class="history-item history-item-static room-file-item" data-file-key="' + esc(it.key) + '">'
      + '<div class="room-file-tile ' + kindClass + '" aria-hidden="true">'
      + '<span class="room-file-tile-ext">' + esc(badge) + '</span>'
      + (it.kind === 'image'
        ? '<svg class="room-file-tile-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>'
        : '<svg class="room-file-tile-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/></svg>')
      + '</div>'
      + '<div class="history-item-body room-file-body">'
      + '<div class="history-item-top room-file-top">'
      + '<span class="history-item-name room-file-name" title="' + esc(it.filename) + '">' + esc(it.filename) + '</span>'
      + '<span class="' + statusClass + '">' + esc(roomFileStatusLabel(it.status)) + '</span>'
      + (time ? '<span class="history-item-time">' + esc(time) + '</span>' : '')
      + '</div>'
      + (metaBits
        ? '<div class="history-item-text room-file-meta-line">' + esc(metaBits) + '</div>'
        : '')
      + '<div class="room-file-actions">'
      + (canDl
        ? '<button type="button" class="room-file-action-btn room-file-action-primary room-file-dl" data-file-key="' + esc(it.key) + '">'
          + '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M5 21h14"/></svg>'
          + '<span>' + esc(lang.roomFilesDownload || lang.downloadFile || 'Download') + '</span></button>'
        : '')
      + (canJump
        ? '<button type="button" class="room-file-action-btn '
          + (canDl ? 'room-file-action-ghost' : 'room-file-action-primary')
          + ' room-file-jump" data-msg-id="' + esc(it.message_id) + '">'
          + (canDl
            ? ''
            : '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>')
          + '<span>' + esc(canDl
            ? (lang.roomFilesJump || 'Show in chat')
            : (lang.roomFilesOpenInChat || lang.roomFilesJump || 'Open in chat'))
          + '</span></button>'
        : '')
      + '</div>'
      + '</div></div>';
  });
  list.innerHTML = html;

  list.querySelectorAll('.room-file-dl').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var key = btn.getAttribute('data-file-key');
      var item = null;
      for (var i = 0; i < rf.items.length; i++) {
        if (rf.items[i].key === key) { item = rf.items[i]; break; }
      }
      if (!item || typeof downloadMessageFile !== 'function') return;
      var payload = roomFileResolvePayload(item);
      if (!payload || (!payload.data && !payload.transfer_id)) {
        try {
          Tapp.ui.showNotification({
            title: lang.roomFilesNeedChat || lang.roomFilesJump || 'Open in chat to download',
            type: 'info',
          });
        } catch (eN) { /* ignore */ }
        if (item.message_id) {
          closeRoomFiles();
          if (typeof jumpToHistoryMessage === 'function') jumpToHistoryMessage(item.message_id);
        }
        return;
      }
      downloadMessageFile(payload, btn);
    });
  });
  list.querySelectorAll('.room-file-jump').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var msgId = btn.getAttribute('data-msg-id');
      if (!msgId) return;
      closeRoomFiles();
      if (typeof jumpToHistoryMessage === 'function') {
        jumpToHistoryMessage(msgId);
      } else {
        var el = document.querySelector('[data-msg-id="' + msgId.replace(/"/g, '') + '"]');
        if (el) {
          try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e2) {}
          el.classList.add('msg-highlight');
          setTimeout(function () { try { el.classList.remove('msg-highlight'); } catch (e3) {} }, 2200);
        }
      }
    });
  });

  updateRoomFilesFooter();
}

function bindRoomFilesUi() {
  if (bindRoomFilesUi._bound) return;
  bindRoomFilesUi._bound = true;

  var closeBtn = $('room-files-close');
  if (closeBtn) closeBtn.addEventListener('click', closeRoomFiles);

  var overlay = $('room-files-overlay');
  if (overlay) {
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeRoomFiles();
    });
  }

  var search = $('room-files-search');
  if (search) {
    search.addEventListener('input', function () {
      ensureRoomFilesState().query = search.value || '';
      if (ensureRoomFilesState().source === 'server' || supportsListRoomFiles()) {
        scheduleRoomFilesSearchRefresh();
      } else {
        renderRoomFilesList();
      }
    });
  }

  document.querySelectorAll('[data-room-files-filter]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var rf = ensureRoomFilesState();
      rf.filter = btn.getAttribute('data-room-files-filter') || 'all';
      syncRoomFilesFilterChips();
      if (rf.source === 'server' || supportsListRoomFiles()) {
        refreshRoomFilesFromServer();
      } else {
        renderRoomFilesList();
      }
    });
  });

  var loadMore = $('room-files-load-more');
  if (loadMore) loadMore.addEventListener('click', function () { loadMoreRoomFiles(); });
}
`

const PAGE_MOD_MEMBERS = `\
  panel.style.display = '';
  $('member-title').textContent = lang.members + ' (' + state.members.length + ')';

  var myRole = state.roomDetail.my_role || '';
  var myPending = (state.roomDetail.my_membership_status || state.roomDetail.membership_status || 'active') === 'pending';
  var canKick = !myPending && (myRole === 'owner' || myRole === 'admin');
  var memberQ = (state.search && state.search.member) || '';
  var memberQuery = normalizeSearchQuery(memberQ);
  var filteredMembers = !memberQuery ? state.members : state.members.filter(function (m) {
    var name = m.display_name || (m.actor_url || '').split('/').pop() || '';
    return matchesSearch(memberQuery, [name, m.actor_url, m.role, m.username, m.membership_status]);
  });

  var html = '';
  if (state.members.length > 0 && filteredMembers.length === 0) {
    html = searchNoResultsHtml();
  } else {
    filteredMembers.forEach(function (m) {
      var name = m.display_name || (m.actor_url || '').split('/').pop() || '?';
      // 普通成员不显示角色，减少列表噪音；仅标出群主/管理员
      var roleText = (m.role && m.role !== 'member') ? roleLabel(m.role) : '';
      var mStatus = m.membership_status || 'active';
      if (mStatus === 'pending') {
        roleText = roleText
          ? (roleText + ' · ' + (lang.pending || 'Pending'))
          : (lang.pending || 'Pending');
      }
      html += '<div class="member-item' + (mStatus === 'pending' ? ' member-pending' : '') + '">'
        + '<div class="member-avatar">' + avatarContentHtml(m.avatar_url || '', name) + '</div>'
        + '<div class="member-info">'
        + '<div class="member-name">' + esc(name) + '</div>'
        + (roleText ? '<div class="member-role">' + esc(roleText) + '</div>' : '')
        + '</div>';
      if (m.is_local) {
        html += '<span class="member-local">' + esc(lang.local) + '</span>';
      } else if (canKick && m.role !== 'owner') {
        html += '<button type="button" class="member-kick" data-actor="' + esc(m.actor_url || '') + '" title="' + esc(lang.kick) + '" aria-label="' + esc(lang.kick) + '">'
          + '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>'
          + '</button>';
      }
      html += '</div>';
    });
  }
  $('member-list').innerHTML = html;

  // Wire kick buttons
  if (canKick) {
    var kicks = document.querySelectorAll('.member-kick');
    kicks.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var actor = btn.getAttribute('data-actor');
        if (actor) doKickMember(actor);
      });
    });
  }

  // Show invite icon for active room members only
  var inviteWrap = $('invite-wrap');
  if (inviteWrap) {
    inviteWrap.style.display = (!myPending && state.roomDetail && myRole) ? '' : 'none';
  }
}

// ==================== Manage Dropdown ====================
function toggleManageDropdown(e) {
  e && e.stopPropagation();
  var dd = $('manage-dropdown');
  if (!dd) return;
  dd.classList.toggle('open');
}
function closeManageDropdown() {
  var dd = $('manage-dropdown');
  if (dd) dd.classList.remove('open');
}
document.addEventListener('click', function (e) {
  var dd = $('manage-dropdown');
  if (!dd || !dd.classList.contains('open')) return;
  var wrap = dd.parentElement;
  if (wrap && !wrap.contains(e.target)) closeManageDropdown();
});

// ==================== Render: Chat Header ====================
function renderChatHeader() {
  var nameEl = $('chat-name');
  var metaEl = $('chat-meta');
  var actionsEl = $('chat-actions');
  var avatarEl = $('chat-hdr-avatar');
  if (!nameEl) return;

  if (state.activeKind === 'channel' && state.channelDetail) {
    var ch = state.channelDetail;
    var chName = ch.remote_actor_name || (ch.remote_actor_url || '').split('/').pop() || '?';
    nameEl.textContent = chName;
    if (avatarEl) {
      avatarEl.innerHTML = avatarContentHtml(ch.remote_actor_avatar || '', chName);
    }
    metaEl.innerHTML = '<span class="meta-badge badge-channel">' + esc(lang.dm) + '</span>'
      + (ch.status === 'pending' ? '<span class="meta-badge badge-pending">' + esc(lang.pending) + '</span>' : '');
    var actionsHtml = '';
    if (typeof historyHeaderButtonHtml === 'function') actionsHtml += historyHeaderButtonHtml();
    if (ch.status === 'pending' && ch.initiated_by === 'remote') {
      actionsHtml += '<button class="action-btn action-accept" id="action-accept">' + esc(lang.accept) + '</button>';
      actionsHtml += '<button class="action-btn action-reject" id="action-reject-channel">' + esc(lang.reject || 'Decline') + '</button>';
    }
    if (ch.status !== 'closed') {
      actionsHtml += '<div class="manage-wrap"><button type="button" class="aro-icon-btn manage-btn" id="manage-toggle" title="' + esc(lang.manage) + '" aria-label="' + esc(lang.manage) + '">⋯</button>'
        + '<div class="manage-dropdown" id="manage-dropdown" role="menu">'
        + '<button type="button" class="manage-item manage-item-danger" id="action-close" role="menuitem">'
        + '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>'
        + esc(lang.close) + '</button></div></div>';
    } else {
      actionsHtml += '<span class="meta-badge badge-closed">' + esc(lang.closed) + '</span>';
    }
    actionsEl.innerHTML = actionsHtml;
  } else if (state.activeKind === 'room' && state.roomDetail) {
    var rm = state.roomDetail;
    var roomPending = (rm.my_membership_status || rm.membership_status || 'active') === 'pending';
    // Public/open rooms may open without membership (browse); offer join when invite_policy=open
    var canSelfJoin = !roomPending
      && !rm.my_role
      && (rm.invite_policy === 'open')
      && typeof Tapp !== 'undefined'
      && Tapp.federation
      && typeof Tapp.federation.joinRoom === 'function';
    nameEl.textContent = rm.name || '?';
    if (avatarEl) {
      avatarEl.innerHTML = avatarContentHtml(rm.avatar_url || '', rm.name || '?');
    }
    metaEl.innerHTML = '<span class="meta-badge badge-room">' + (rm.member_count || 0) + ' ' + esc(lang.members) + '</span>'
      + (roomPending ? '<span class="meta-badge badge-pending">' + esc(lang.pending || 'Pending') + '</span>' : '')
      + (canSelfJoin ? '<span class="meta-badge badge-pending">' + esc(lang.openJoin || 'Open') + '</span>' : '')
      + (!roomPending && rm.my_role && rm.my_role !== 'member' ? '<span class="meta-badge badge-role">' + esc(roleLabel(rm.my_role)) + '</span>' : '');
    var menuItems = '';
    if (!roomPending && (rm.my_role === 'owner' || rm.my_role === 'admin')) {
      menuItems += '<button type="button" class="manage-item" id="action-edit-room" role="menuitem">'
        + '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>'
        + esc(lang.editRoom) + '</button>';
    }
    if (!roomPending && rm.my_role !== 'owner') {
      menuItems += '<button type="button" class="manage-item manage-item-danger" id="action-leave" role="menuitem">'
        + '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/></svg>'
        + esc(lang.leave) + '</button>';
    }
    if (!roomPending && rm.my_role === 'owner') {
      menuItems += '<button type="button" class="manage-item" id="action-transfer-owner" role="menuitem">'
        + '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 3h5v5"/><path d="M8 3H3v5"/><path d="M21 3l-7 7"/><path d="M3 3l7 7"/><path d="M12 14v7"/><path d="M9 18l3 3 3-3"/></svg>'
        + esc(lang.transferOwner || 'Transfer ownership') + '</button>';
      menuItems += '<button type="button" class="manage-item manage-item-danger" id="action-dissolve" role="menuitem">'
        + '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M10 11v6M14 11v6"/></svg>'
        + esc(lang.dissolve) + '</button>';
    }
    // E2E key publish (best-effort; enables encrypt when peers publish too)
    if (!roomPending && typeof Tapp !== 'undefined' && Tapp.federation && typeof Tapp.federation.initiateRoomE2e === 'function') {
      menuItems += '<button type="button" class="manage-item" id="action-room-e2e" role="menuitem">'
        + '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>'
        + esc(lang.e2ePublish || 'Publish encryption key') + '</button>';
    }
    // History + group files + member toggle + manage menu
    var historyBtn = typeof historyHeaderButtonHtml === 'function' ? historyHeaderButtonHtml() : '';
    var filesBtn = typeof roomFilesHeaderButtonHtml === 'function' ? roomFilesHeaderButtonHtml() : '';
    var memberToggleHtml = '<button type="button" class="aro-icon-btn member-toggle-btn" id="member-toggle-btn" title="' + esc(lang.members) + '" aria-label="' + esc(lang.members) + '">'
      + '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>'
      + '</button>';
    var roomInviteActions = '';
    if (roomPending) {
      roomInviteActions = '<button class="action-btn action-accept" id="action-accept-room">' + esc(lang.accept) + '</button>'
        + '<button class="action-btn action-reject" id="action-reject-room">' + esc(lang.reject || lang.leave || 'Reject') + '</button>';
      actionsEl.innerHTML = roomInviteActions;
    } else if (canSelfJoin) {
      actionsEl.innerHTML = '<button class="action-btn action-accept" id="action-join-room">' + esc(lang.joinRoom || lang.accept || 'Join') + '</button>';
    } else if (menuItems) {
      actionsEl.innerHTML = historyBtn + filesBtn + memberToggleHtml + '<div class="manage-wrap"><button type="button" class="aro-icon-btn manage-btn" id="manage-toggle" title="' + esc(lang.manage) + '" aria-label="' + esc(lang.manage) + '">⋯</button>'
        + '<div class="manage-dropdown" id="manage-dropdown" role="menu">' + menuItems + '</div></div>';
    } else {
      actionsEl.innerHTML = historyBtn + filesBtn + memberToggleHtml;
    }
  }

  var acceptBtn = $('action-accept');
  if (acceptBtn) acceptBtn.addEventListener('click', doAcceptChannel);
  var rejectChBtn = $('action-reject-channel');
  if (rejectChBtn) rejectChBtn.addEventListener('click', function () {
    if (typeof doRejectChannel === 'function') doRejectChannel();
  });
  var acceptRoomBtn = $('action-accept-room');
  if (acceptRoomBtn) acceptRoomBtn.addEventListener('click', function () {
    if (typeof doAcceptRoomInvite === 'function') doAcceptRoomInvite();
  });
  var rejectRoomBtn = $('action-reject-room');
  if (rejectRoomBtn) rejectRoomBtn.addEventListener('click', function () {
    if (typeof doRejectRoomInvite === 'function') doRejectRoomInvite();
  });
  var joinRoomBtn = $('action-join-room');
  if (joinRoomBtn) joinRoomBtn.addEventListener('click', function () {
    if (typeof doJoinOpenRoom === 'function') doJoinOpenRoom();
  });
  var closeBtn = $('action-close');
  if (closeBtn) closeBtn.addEventListener('click', function () { closeManageDropdown(); doCloseChannel(); });
  var leaveBtn = $('action-leave');
  if (leaveBtn) leaveBtn.addEventListener('click', function () { closeManageDropdown(); doLeaveRoom(); });
  var editRoomBtn = $('action-edit-room');
  if (editRoomBtn) editRoomBtn.addEventListener('click', function () { closeManageDropdown(); showEditRoomDialog(); });
  var dissolveBtn = $('action-dissolve');
  if (dissolveBtn) dissolveBtn.addEventListener('click', function () { closeManageDropdown(); doDissolveRoom(); });
  var transferBtn = $('action-transfer-owner');
  if (transferBtn) transferBtn.addEventListener('click', function () { closeManageDropdown(); doTransferOwnership(); });
  var roomE2eBtn = $('action-room-e2e');
  if (roomE2eBtn) roomE2eBtn.addEventListener('click', function () { closeManageDropdown(); doRoomE2eExchange(); });
  var toggleBtn = $('manage-toggle');
  if (toggleBtn) toggleBtn.addEventListener('click', toggleManageDropdown);
  var memberToggle = $('member-toggle-btn');
  if (memberToggle) memberToggle.addEventListener('click', toggleMemberPanel);
  if (typeof wireHistoryHeaderButton === 'function') wireHistoryHeaderButton();
  if (typeof wireRoomFilesHeaderButton === 'function') wireRoomFilesHeaderButton();

  if (typeof updateSendState === 'function') updateSendState();
}

// ==================== Member Panel Toggle ====================
state.memberPanelOpen = true; // default open on desktop

function isTablet() { var w = window.innerWidth; return w >= 769 && w <= 1024; }

function toggleMemberPanel() {
  var panel = $('member-panel');
  if (!panel) return;
  var isMobile = window.innerWidth <= 768;
  if (isMobile) {
    panel.classList.toggle('member-open-mobile');
  } else if (isTablet()) {
    panel.classList.toggle('member-expanded-tablet');
    state.memberPanelOpen = panel.classList.contains('member-expanded-tablet');
  } else {
    panel.classList.toggle('member-collapsed');
    state.memberPanelOpen = !panel.classList.contains('member-collapsed');
  }
}

function closeMemberPanel() {
  var panel = $('member-panel');
  if (!panel) return;
  panel.classList.remove('member-open-mobile');
  panel.classList.remove('member-expanded-tablet');
  if (window.innerWidth > 768 && !isTablet()) {
    panel.classList.add('member-collapsed');
  }
  state.memberPanelOpen = false;
}

// ==================== API ====================
async function loadConversations() {
  try {
    var results = await Promise.allSettled([
      Tapp.federation.getChannels(),
      Tapp.federation.getRooms(),
    ]);
    var errors = [];
    if (results[0].status === 'fulfilled' && results[0].value) {
      state.channels = results[0].value.channels || [];
    // soft delivery health check (dead letters) — non-blocking
    if (typeof refreshDeliveryHealth === 'function') {
      refreshDeliveryHealth().catch(function () {});
    }`

const PAGE_MOD_API = `\
    } else if (results[0].status === 'rejected') {
      console.error('[Aro] getChannels failed:', results[0].reason);
      errors.push(String(results[0].reason));
    }
    if (results[1].status === 'fulfilled' && results[1].value) {
      state.rooms = results[1].value.rooms || [];
    } else if (results[1].status === 'rejected') {
      console.error('[Aro] getRooms failed:', results[1].reason);
      errors.push(String(results[1].reason));
    }
    renderConvList();
    if (errors.length > 0 && state.channels.length === 0 && state.rooms.length === 0) {
      var list = $('conv-list');
      if (list) {
        list.innerHTML = '<div class="conv-empty conv-empty-fill" style="color:#b91c1c;font-size:12px;line-height:1.5;max-width:220px;text-align:center">'
          + '<div style="font-weight:600;margin-bottom:4px">' + esc(lang.loadFail || 'Load failed') + '</div>'
          + '<div style="opacity:.85;white-space:pre-wrap">' + esc(errors.join('\\n')) + '</div></div>';
      }
    }
    // Soft dead-letter check (host notification center is primary)
    if (typeof refreshDeliveryHealth === 'function') {
      refreshDeliveryHealth().catch(function () {});
    }
  } catch (e) {
    console.error('[Aro] loadConversations error:', e);
  }
}

async function openConversation(kind, id) {
  // Drop previous realtime subscription before switching
  await unsubscribeRealtime();
  if (typeof resetHistoryOnConversationChange === 'function') resetHistoryOnConversationChange();
  if (typeof resetRoomFilesOnConversationChange === 'function') resetRoomFilesOnConversationChange();

  state.activeKind = kind;
  state.activeId = id;
  state.messages = [];
  state.messagesFp = '';
  state.skipMsgAppear = true;
  state.members = [];
  state.channelDetail = null;
  state.roomDetail = null;
  state.chatLoadError = null;
  // Drop previous composer lock immediately; re-lock channels until detail proves writable.
  if (typeof clearPendingAttach === 'function') clearPendingAttach();
  if (typeof clearQuote === 'function') clearQuote();
  if (typeof closeAttachMenu === 'function') closeAttachMenu();
  if (typeof updateSendState === 'function') updateSendState();

  $('empty-state').style.display = 'none';
  var chatEl = $('chat-container');
  if (chatEl) {
    chatEl.style.display = '';
    aroPlayEnter(chatEl, 'aro-panel-enter');
  }
  $('sidebar').classList.add('sidebar-hidden-mobile');

  renderMessages();
  renderChatHeader();

  try {
    if (kind === 'channel') {
      var results = await Promise.all([
        Tapp.federation.getChannel(id),
        Tapp.federation.getMessages(id, undefined, 200),
      ]);
      if (results[0]) {
        state.channelDetail = results[0];
        // Derive local actor URL: find a message sender that is NOT the remote actor
        if (!state.localActorUrl && results[0].remote_actor_url) {
          var msgs = (results[1] && results[1].messages) || [];
          for (var mi = 0; mi < msgs.length; mi++) {
            var senderActor = msgs[mi].sender_actor;
            if (senderActor && !sameActorUrl(senderActor, results[0].remote_actor_url)) {
              state.localActorUrl = normalizeFederationUrl(senderActor) || senderActor;
              break;
            }
          }
        }
      }
      if (results[1]) {
        state.messages = results[1].messages || [];
        state.messagesFp = messagesFingerprint(state.messages);
      }
    } else {
      // Pending invites cannot load messages (403) — use allSettled so detail/members still open
      var roomParts = await Promise.allSettled([
        Tapp.federation.getRoom(id),
        Tapp.federation.getRoomMembers(id),
        Tapp.federation.getRoomMessages(id, undefined, 200),
      ]);
      if (roomParts[0].status === 'fulfilled' && roomParts[0].value) {
        state.roomDetail = roomParts[0].value;
      } else if (roomParts[0].status === 'rejected') {
        throw roomParts[0].reason;
      }
      if (roomParts[1].status === 'fulfilled' && roomParts[1].value) {
        state.members = unwrapRoomMembers(roomParts[1].value);
        // Extract local actor URL from members list
        if (!state.localActorUrl) {
          for (var i = 0; i < state.members.length; i++) {
            var memberActor = normalizeFederationUrl(state.members[i].actor_url);
            if (state.members[i].is_local && memberActor) { state.localActorUrl = memberActor; break; }
          }
        }
      }
      if (roomParts[2].status === 'fulfilled' && roomParts[2].value) {
        state.messages = roomParts[2].value.messages || [];
        state.messagesFp = messagesFingerprint(state.messages);
      } else {
        // pending membership: empty transcript is expected
        state.messages = [];
        state.messagesFp = '';
      }
    }
  } catch (e) {
    console.error('[Aro] openConversation failed:', e);
    state.chatLoadError = (e && (e.message || e.error || String(e))) || (lang.loadFail || 'Load failed');
    notifyError(lang.loadFail || lang.sendFail || 'Load failed', e);
  }

  renderChatHeader();
  renderMessages();
  renderMembers();
  renderConvList();
  updateSendState();
  startPolling();
  subscribeRealtime();
  // Best-effort E2E key publish after open (non-blocking)
  if (typeof maybePublishE2eKeys === 'function') {
    maybePublishE2eKeys().catch(function () {});
  }
  var focusInput = $('msg-input');
  if (focusInput && !focusInput.disabled) {
    try { focusInput.focus(); } catch (e) { /* ignore */ }
  }
}

/** Auto-publish E2E keys when opening an active channel/room (if API present). */
async function maybePublishE2eKeys() {
  if (typeof Tapp === 'undefined' || !Tapp.federation) return;
  if (state.activeKind === 'channel' && state.activeId
    && typeof Tapp.federation.initiateChannelE2e === 'function') {
    var st = state.channelDetail && state.channelDetail.status;
    if (st === 'active' || st === 'accepted') {
      try {
        await Tapp.federation.initiateChannelE2e(state.activeId);
      } catch (e) {
        console.debug('[Aro] channel E2E exchange skipped', e);
      }
    }
  } else if (state.activeKind === 'room' && state.activeId
    && typeof Tapp.federation.initiateRoomE2e === 'function') {
    try {
      await Tapp.federation.initiateRoomE2e(state.activeId);
    } catch (e) {
      console.debug('[Aro] room E2E publish skipped', e);
    }
  }
}

async function doRoomE2eExchange() {
  if (!state.activeId || state.activeKind !== 'room') return;
  if (typeof Tapp.federation.initiateRoomE2e !== 'function') return;
  try {
    var res = await Tapp.federation.initiateRoomE2e(state.activeId);
    var n = (res && (res.published_key_count != null ? res.published_key_count : res.data && res.data.published_key_count)) || '';
    try {
      Tapp.ui.showNotification({
        title: lang.e2ePublished || 'Encryption key published',
        message: n ? String(n) : undefined,
        type: 'success',
      });
    } catch (e0) { /* ignore */ }
  } catch (e) {
    notifyError(lang.e2eFail || lang.sendFail || 'E2E failed', e);
  }
}

async function doTransferOwnership() {
  if (!state.activeId || state.activeKind !== 'room') return;
  if (typeof Tapp.federation.transferRoomOwnership !== 'function') {
    try {
      Tapp.ui.showNotification({ title: lang.transferOwnerUnsupported || 'Not available', type: 'error' });
    } catch (e0) { /* ignore */ }
    return;
  }
  var candidates = (state.members || []).filter(function (m) {
    return m.role !== 'owner' && m.role !== 'observer' && !(typeof isLocalActor === 'function' && isLocalActor(m.actor_url));
  });
  // Include local non-self members too
  candidates = (state.members || []).filter(function (m) {
    return m.role !== 'owner' && m.role !== 'observer';
  });
  if (!candidates.length) {
    try {
      Tapp.ui.showNotification({
        title: lang.transferOwnerEmpty || 'No member to transfer to',
        type: 'error',
      });
    } catch (e1) { /* ignore */ }
    return;
  }
  var lines = candidates.map(function (m, i) {
    var name = m.display_name || (m.actor_url || '').split('/').pop() || m.actor_url;
    return (i + 1) + '. ' + name;
  }).join('\\n');
  var pick = window.prompt(
    (lang.transferOwnerPrompt || 'Transfer ownership to member number:') + '\\n' + lines,
    '1'
  );
  if (!pick) return;
  var idx = parseInt(pick, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= candidates.length) {
    try {
      Tapp.ui.showNotification({ title: lang.transferOwnerInvalid || 'Invalid choice', type: 'error' });
    } catch (e2) { /* ignore */ }
    return;
  }
  var target = candidates[idx];
  var label = target.display_name || target.actor_url;
  if (!(await aroConfirm((lang.transferOwnerConfirm || 'Transfer ownership to {name}?').replace('{name}', label), true))) {
    return;
  }
  try {
    await Tapp.federation.transferRoomOwnership(state.activeId, target.actor_url);
    var detail = await Tapp.federation.getRoom(state.activeId);
    if (detail) state.roomDetail = detail;
    var membersRes = await Tapp.federation.getRoomMembers(state.activeId);
    state.members = unwrapRoomMembers(membersRes);
    renderMembers();
    renderChatHeader();
    try {
      Tapp.ui.showNotification({
        title: lang.transferOwnerOk || 'Ownership transferred',
        type: 'success',
      });
    } catch (e3) { /* ignore */ }
  } catch (e) {
    notifyError(lang.transferOwnerFail || lang.sendFail || 'Transfer failed', e);
  }
}

async function doSend() {
  var input = $('msg-input');
  if (!input) return;

  var text = input.value.trim();
  var attach = state.pendingAttach;

  // Need either text or attachment
  if ((!text && !attach) || !state.activeId || state.sending) return;
  // Backend only accepts active|accepted; pending/closed must not clear the input
  if (typeof isChannelComposerLocked === 'function' ? isChannelComposerLocked() : (
    state.activeKind === 'channel' && state.channelDetail && state.channelDetail.status === 'closed'
  )) return;

  input.value = '';
  autoResizeInput(input);
  state.sending = true;
  updateSendState();
  closeAttachMenu();
  closeMsgMenu();

  try {
    var msgPayload;
    var msgType;

    // Attach quote info if replying to a message
    var replyTo = null;
    if (state.quoteMsg) {
      replyTo = state.quoteMsg.message_id;
    }

    if (attach && (attach.type === 'image' || attach.type === 'file')) {
      var useChunked = attach.size > INLINE_ATTACH_MAX;
      if (useChunked) {
        if (state.activeKind !== 'channel' && state.activeKind !== 'room') {
          throw new Error(lang.fileTooLarge || 'File too large');
        }
        clearPendingAttach();
        await sendChunkedFileTransfer(attach, text, replyTo);
        if (state.quoteMsg) clearQuote();
        await pollMessages(true);
        return;
      }

      // Small files: inline base64 under backend payload budget
      var dataUrl = attach.data;
      if (!dataUrl && attach.file) {
        dataUrl = await readFileAsDataURL(attach.file);
      }
      if (!dataUrl) throw new Error('Failed to read file');
      msgType = attach.type === 'image' ? 'image' : 'file';
      msgPayload = { data: dataUrl, filename: attach.name, mime_type: attach.mime, size: attach.size, text: text || '' };
      clearPendingAttach();
    } else if (attach) {
      // Federation content: tapp, brew, library, report — rich snapshot, never id-only.
      msgType = attach.type;
      msgPayload = {
        title: (attach.name || '').trim() || (lang.shareUntitled || 'Untitled'),
        description: attach.desc || '',
        content_type: attach.type,
        icon: attach.icon || '',
        text: text || '',
      };
      // Include resource IDs so the receiver can fetch detail
      if (attach.tappId) msgPayload.tapp_id = attach.tappId;
      if (attach.tappVersion) msgPayload.tapp_version = attach.tappVersion;
      if (attach.tappIcon) msgPayload.tapp_icon = attach.tappIcon;
      if (attach.name && attach.type === 'tapp') msgPayload.tapp_name = attach.name;
      // P0 store install: portable catalog URL (never local DB id / mode "store")
      if (attach.storeSource) msgPayload.store_source = attach.storeSource;
      // Direct-install package fallback for offline/custom (optional)
      if (attach.installPackage) msgPayload.install_package = attach.installPackage;
      if (attach.installPackageOmitted) msgPayload.install_package_omitted = attach.installPackageOmitted;
      if (attach.brewId) msgPayload.brew_id = attach.brewId;
      if (attach.brewLink) msgPayload.brew_link = attach.brewLink;
      // Source mark for the share card icon (favicon URL / brand slug).
      if (attach.sourceIcon) msgPayload.source_icon = attach.sourceIcon;
      if (attach.sourceName) msgPayload.source_name = attach.sourceName;
      // Library share: title, description, platform_id, item_id, image, content_type (like report snapshot).
      // content_type stays "library" (message kind); item kind goes in item_type / description.
      if (attach.type === 'library') {
        var libTitle = (attach.name || attach.summary || '').trim() || (lang.shareUntitled || 'Untitled');
        var libDesc = (attach.desc || '').trim();
        var libPlatform = (attach.platformId || '').trim();
        var libItemId = attach.itemId != null && attach.itemId !== '' ? String(attach.itemId) : '';
        var libImage = (attach.image || '').trim();
        var libItemType = (attach.contentType || '').trim();
        if (libItemType === 'library') libItemType = '';
        msgPayload.title = libTitle;
        msgPayload.description = libDesc || (libPlatform ? libPlatform + (libItemType ? ' · ' + libItemType : '') : '');
        msgPayload.platform_id = libPlatform;
        msgPayload.item_id = libItemId;
        msgPayload.image = libImage;
        msgPayload.content_type = 'library';
        if (libItemType) msgPayload.item_type = libItemType;
        msgPayload.summary = libTitle;
        // Structured sender stats for the media card (omit empties so old
        // recipients ignore them and the card falls back cleanly).
        if (attach.playtimeMin != null) msgPayload.playtime_min = attach.playtimeMin;
        if (attach.rating != null) msgPayload.rating = attach.rating;
        if (attach.progressCur != null) msgPayload.progress_cur = attach.progressCur;
        if (attach.progressTotal != null) msgPayload.progress_total = attach.progressTotal;
        if (attach.artist) msgPayload.artist = attach.artist;
        if (attach.album) msgPayload.album = attach.album;
      } else {
        if (attach.platformId) msgPayload.platform_id = attach.platformId;
        if (attach.itemId) msgPayload.item_id = attach.itemId;
        if (attach.image) msgPayload.image = attach.image;
      }
      // Report share: always wire snapshot fields (never id-only).
      // Coordinated field names (Aro + federation Article): report_id, summary, platform, content_preview.
      // Mirrored by wireReportSharePayload / REPORT_SHARE_SNAPSHOT_FIELDS in reportShareSnapshot.ts.
      if (attach.type === 'report') {
        var reportSummary = (attach.summary || attach.name || '').trim() || 'Report';
        var reportPlatform = (attach.platform || '').trim();
        var reportPreview = (attach.contentPreview || attach.desc || '').trim();
        msgPayload.report_id = attach.reportId != null && attach.reportId !== '' ? String(attach.reportId) : '';
        msgPayload.summary = reportSummary;
        msgPayload.platform = reportPlatform;
        msgPayload.content_preview = reportPreview;
        if (!msgPayload.title) msgPayload.title = reportSummary;
        if (!msgPayload.description) {
          msgPayload.description = reportPreview
            ? (reportPlatform ? reportPlatform + ' · ' + reportPreview : reportPreview)
            : reportPlatform;
        }
      } else if (attach.reportId) {
        msgPayload.report_id = attach.reportId;
      }
      clearPendingAttach();
    } else {
      msgType = 'text';
      msgPayload = { text: text };
    }

    if (state.quoteMsg) {
      msgPayload.quote_sender = state.quoteMsg.sender;
      msgPayload.quote_text = state.quoteMsg.text;
      msgPayload.quote_id = state.quoteMsg.message_id;
      clearQuote();
    }

    var sendReq = { payload: msgPayload, message_type: msgType };
    if (replyTo) sendReq.reply_to = replyTo;
    // Prefer E2E when session may be established (server no-ops if keys missing)
    if (state.e2ePreferEncrypt !== false) {
      sendReq.encrypt = true;
    }
    var sendRes;
    if (state.activeKind === 'channel') {
      try {
        sendRes = await Tapp.federation.sendMessage(state.activeId, sendReq);
      } catch (eEnc) {
        // Fallback plaintext if peer has no E2E session yet
        if (sendReq.encrypt) {
          delete sendReq.encrypt;
          sendRes = await Tapp.federation.sendMessage(state.activeId, sendReq);
        } else throw eEnc;
      }
    } else {
      try {
        sendRes = await Tapp.federation.sendRoomMessage(state.activeId, sendReq);
      } catch (eEnc2) {
        if (sendReq.encrypt) {
          delete sendReq.encrypt;
          sendRes = await Tapp.federation.sendRoomMessage(state.activeId, sendReq);
        } else throw eEnc2;
      }
    }
    if (typeof noteDeliveryEnqueue === 'function') noteDeliveryEnqueue(sendRes);
    await pollMessages(true);
  } catch (e) {
    if (text) input.value = text;
    notifyError(lang.sendFail, e);
  } finally {
    state.sending = false;
    updateSendState();
    input.focus();
  }
}

/**
 * Surface outbound enqueue warnings (remote may not receive even though send returned 200).
 * Full dead-letter failures also land in the host notification center via the delivery worker.
 */
function noteDeliveryEnqueue(sendRes) {
  if (!sendRes) return;
  var d = sendRes.delivery || (sendRes.data && sendRes.data.delivery) || null;
  if (!d || !d.warning) return;
  var title = lang.deliveryWarnTitle || 'Delivery notice';
  var msg = lang.deliveryWarnBody || d.warning;
  if (d.queued === 0 && d.remote_targets > 0) {
    msg = lang.deliveryNotQueued
      || 'Message saved locally but could not be queued for remote peers';
  }
  try {
    Tapp.ui.showNotification({ title: title, message: msg, type: 'error' });
  } catch (e) { /* ignore */ }
  console.warn('[Aro] delivery enqueue warning', d);
}

/** Soft check for dead letters (host notifications are primary; this is in-app). */
async function refreshDeliveryHealth() {
  if (typeof Tapp === 'undefined' || !Tapp.federation) return;
  if (typeof Tapp.federation.getDeliveryStats !== 'function') return;
  try {
    var stats = await Tapp.federation.getDeliveryStats();
    var root = stats && stats.data ? stats.data : stats;
    if (!root) return;
    var dead = root.dead || root.failed || 0;
    if (dead > 0 && !refreshDeliveryHealth._warned) {
      refreshDeliveryHealth._warned = true;
      try {
        Tapp.ui.showNotification({
          title: lang.deliveryDeadTitle || 'Federation delivery failed',
          message: (lang.deliveryDeadBody || '{n} outbound messages could not be delivered')
            .replace('{n}', String(dead)),
          type: 'error',
        });
      } catch (e2) { /* ignore */ }
      // Offer re-queue of dead letters (one-shot; cooldown 2 min)
      if (
        typeof Tapp.federation.retryAllDeadDelivery === 'function'
        && !refreshDeliveryHealth._retryOffered
        && typeof aroConfirm === 'function'
      ) {
        refreshDeliveryHealth._retryOffered = true;
        try {
          var ok = await aroConfirm(
            (lang.deliveryRetryConfirm || 'Retry {n} failed deliveries?').replace('{n}', String(dead)),
            false
          );
          if (ok) {
            var retryRes = await Tapp.federation.retryAllDeadDelivery(Math.min(dead, 50));
            var retried = 0;
            if (retryRes) {
              retried = retryRes.retried != null
                ? retryRes.retried
                : (retryRes.data && retryRes.data.retried) || 0;
            }
            try {
              Tapp.ui.showNotification({
                title: lang.deliveryRetryOk || 'Retry queued',
                message: (lang.deliveryRetryBody || '{n} messages re-queued').replace('{n}', String(retried)),
                type: 'success',
              });
            } catch (e3) { /* ignore */ }
            refreshDeliveryHealth._warned = false;
          }
        } catch (e4) { /* ignore */ }
        setTimeout(function () { refreshDeliveryHealth._retryOffered = false; }, 120000);
      }
    }
    if (dead === 0) {
      refreshDeliveryHealth._warned = false;
      refreshDeliveryHealth._retryOffered = false;
    }
  } catch (e) {
    /* stats API optional */
  }
}

/** Fingerprint message list so pin/content changes refresh even when count stays the same. */
function messagesFingerprint(msgs) {
  if (!msgs || !msgs.length) return '0';
  var last = msgs[msgs.length - 1] || {};
  var pins = 0;
  var ids = [];
  for (var i = 0; i < msgs.length; i++) {
    if (msgs[i].is_pinned) pins++;
    if (i === 0 || i === msgs.length - 1 || msgs[i].is_pinned) {
      ids.push((msgs[i].message_id || '') + (msgs[i].is_pinned ? '*' : ''));
    }
  }
  return msgs.length + '|' + (last.message_id || '') + '|' + (last.created_at || '') + '|' + pins + '|' + ids.join(',');
}

function mergeIncomingMessage(msg) {
  if (!msg || !msg.message_id) return false;
  for (var i = 0; i < state.messages.length; i++) {
    if (state.messages[i].message_id === msg.message_id) {
      state.messages[i] = Object.assign({}, state.messages[i], msg);
      state.messagesFp = messagesFingerprint(state.messages);
      renderMessages();
      return true;
    }
  }
  state.messages.push(msg);
  state.messagesFp = messagesFingerprint(state.messages);
  renderMessages({ animateNew: true, newCount: 1 });
  return true;
}

async function pollMessages(force) {
  if (!state.activeId || !state.activeKind) return;
  try {
    var res;
    if (state.activeKind === 'channel') {
      res = await Tapp.federation.getMessages(state.activeId, undefined, 200);
    } else {
      res = await Tapp.federation.getRoomMessages(state.activeId, undefined, 200);
    }
    if (res) {
      var msgs = res.messages || [];
      var fp = messagesFingerprint(msgs);
      var hadError = !!state.chatLoadError;
      state.chatLoadError = null;
      if (force || fp !== state.messagesFp || hadError) {
        var prevLen = state.messages.length;
        var prevLast = prevLen ? (state.messages[prevLen - 1].message_id || '') : '';
        state.messages = msgs;
        state.messagesFp = fp;
        var grew = msgs.length > prevLen;
        var tailChanged = msgs.length && (msgs[msgs.length - 1].message_id || '') !== prevLast;
        if (grew && tailChanged && !state.skipMsgAppear && !hadError) {
          renderMessages({ animateNew: true, newCount: Math.min(msgs.length - prevLen, 3) });
        } else {
          renderMessages();
        }
      }
    }
  } catch (e) { /* ignore */ }
}

function startPolling() {
  stopPolling();
  state.pollTimer = setInterval(function () { pollMessages(false); }, state.pollInterval);
}

function stopPolling() {
  if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
}

async function subscribeRealtime() {
  if (!state.activeId || !state.activeKind || !Tapp.federation) return;
  // Already subscribed to this conversation
  if (state.subscribedKind === state.activeKind && state.subscribedId === state.activeId) return;
  await unsubscribeRealtime();
  try {
    if (state.activeKind === 'channel' && typeof Tapp.federation.subscribeChannel === 'function') {
      await Tapp.federation.subscribeChannel(state.activeId);
      state.subscribedKind = 'channel';
      state.subscribedId = state.activeId;
    } else if (state.activeKind === 'room' && typeof Tapp.federation.subscribeRoom === 'function') {
      await Tapp.federation.subscribeRoom(state.activeId);
      state.subscribedKind = 'room';
      state.subscribedId = state.activeId;
    }
  } catch (e) {
    console.warn('[Aro] realtime subscribe failed, falling back to poll:', e);
  }
}

async function unsubscribeRealtime() {
  if (!state.subscribedKind || !state.subscribedId || !Tapp.federation) {
    state.subscribedKind = null;
    state.subscribedId = null;
    return;
  }
  try {
    if (state.subscribedKind === 'channel' && typeof Tapp.federation.unsubscribeChannel === 'function') {
      await Tapp.federation.unsubscribeChannel(state.subscribedId);
    } else if (state.subscribedKind === 'room' && typeof Tapp.federation.unsubscribeRoom === 'function') {
      await Tapp.federation.unsubscribeRoom(state.subscribedId);
    }
  } catch (e) { /* ignore */ }
  state.subscribedKind = null;
  state.subscribedId = null;
}

function handleRealtimeMessage(ev) {
  if (!ev) return;
  var data = ev.data || {};
  var scope = ev.scope;
  var scopeId = scope === 'channel' ? ev.channelId : scope === 'room' ? ev.roomId : null;
  var inScope = false;
  if (scope === 'channel' && state.activeKind === 'channel' && ev.channelId === state.activeId) {
    inScope = true;
  } else if (scope === 'room' && state.activeKind === 'room' && ev.roomId === state.activeId) {
    inScope = true;
  }

  // 非当前会话：Toast + 刷新列表（后端通知中心另有 SSE）
  if (!inScope) {
    if (data.type === 'message' && data.message && scopeId) {
      maybeNotifyIncomingMessage(scope, scopeId, data.message);
      loadConversations().catch(function () {});
    }
    return;
  }

  if (data.type === 'message' && data.message) {
    mergeIncomingMessage(data.message);
    // 当前会话但页面在后台时仍提示
    maybeNotifyIncomingMessage(scope, scopeId, data.message);
    return;
  }
  if (data.type === 'room_message_pinned' && data.message_id) {
    for (var i = 0; i < state.messages.length; i++) {
      if (state.messages[i].message_id === data.message_id) {
        state.messages[i].is_pinned = !!data.is_pinned;
        state.messagesFp = messagesFingerprint(state.messages);
        renderMessages();
        return;
      }
    }
    pollMessages(true);
    return;
  }
  // Federated file transfer live progress (incoming chunks / cancel / complete)
  if (
    data.type === 'transfer_progress'
    || data.type === 'transfer_completed'
    || data.type === 'transfer_cancelled'
  ) {
    if (typeof handleTransferWsEvent === 'function') {
      handleTransferWsEvent(data);
    } else {
      // lightweight toast fallback
      try {
        if (data.type === 'transfer_progress' && data.progress != null) {
          var pct = Math.round(Number(data.progress) || 0);
          if (pct > 0 && pct < 100 && pct % 25 === 0) {
            var prog = (lang.transferProgress || 'Receiving… {pct}%').replace('{pct}', String(pct));
            Tapp.ui.showNotification({ title: prog, type: 'info' });
          }
        } else if (data.type === 'transfer_completed') {
          Tapp.ui.showNotification({
            title: lang.transferReceived || lang.transferComplete || 'File ready',
            type: 'success',
          });
        } else if (data.type === 'transfer_cancelled') {
          Tapp.ui.showNotification({
            title: lang.transferCancelled || 'Transfer cancelled',
            type: 'info',
          });
        }
      } catch (eProg) { /* ignore */ }
    }
    // Refresh group files panel if open
    if (typeof isRoomFilesOpen === 'function' && isRoomFilesOpen() && typeof loadRoomFiles === 'function') {
      loadRoomFiles({ append: false }).catch(function () {});
    }
    return;
  }
  // Membership / room lifecycle (local WS + federated RoomJoin/Leave/Pin paths)
  if (
    data.event === 'member_invited'
    || data.event === 'member_left'
    || data.event === 'member_joined'
    || data.event === 'member_removed'
    || data.event === 'member_kicked'
    || data.type === 'room_deleted'
  ) {
    if (state.activeKind !== 'room' || !state.activeId) {
      if (typeof loadConversations === 'function') loadConversations().catch(function () {});
      return;
    }
    // Room dissolved remotely → leave UI like local dissolve
    if (data.type === 'room_deleted') {
      exitActiveConversationUi(lang.dissolve || lang.dissolveFail || 'Room deleted', true);
      return;
    }
    // Kicked / forced leave of self
    if (
      (data.event === 'member_removed' || data.event === 'member_left' || data.event === 'member_kicked')
      && data.actor
      && typeof isLocalActor === 'function'
      && isLocalActor(data.actor)
    ) {
      exitActiveConversationUi(lang.kicked || lang.leave || 'You left the group', true);
      return;
    }
    Tapp.federation.getRoomMembers(state.activeId).then(function (res) {
      state.members = unwrapRoomMembers(res);
      renderMembers();
      renderChatHeader();
    }).catch(function () {});
    if (typeof loadConversations === 'function') {
      loadConversations().catch(function () {});
    }
    return;
  }
  // Unknown event — force a full refresh
  pollMessages(true);
}

function bindRealtimeListeners() {
  if (state.realtimeBound || !Tapp.federation) return;
  state.realtimeBound = true;
  if (typeof Tapp.federation.onMessage === 'function') {
    Tapp.federation.onMessage(function (ev) { handleRealtimeMessage(ev); });
  }
  if (typeof Tapp.federation.onChannelUpdate === 'function') {
    Tapp.federation.onChannelUpdate(function (ev) {
      if (!ev || ev.channelId !== state.activeId || state.activeKind !== 'channel') return;
      if (ev.event === 'closed') {
        if (state.channelDetail) state.channelDetail.status = 'closed';
        for (var i = 0; i < state.channels.length; i++) {
          if (state.channels[i].channel_id === state.activeId) {
            state.channels[i].status = 'closed';
            break;
          }
        }
        clearPendingAttach();
        if (typeof clearQuote === 'function') clearQuote();
        closeAttachMenu();
        renderChatHeader();
        renderConvList();
        updateSendState();
      } else if (ev.event === 'accepted') {
        // Remote accepted our pending open — unlock composer (backend status is accepted).
        if (state.channelDetail) state.channelDetail.status = 'accepted';
        for (var j = 0; j < state.channels.length; j++) {
          if (state.channels[j].channel_id === state.activeId) {
            state.channels[j].status = 'accepted';
            break;
          }
        }
        renderChatHeader();
        renderConvList();
        updateSendState();
      } else if (ev.event === 'disconnected') {
        // WS dropped — poll will keep things eventually consistent
        pollMessages(true);
      }
    });
  }
  if (typeof Tapp.federation.onRoomUpdate === 'function') {
    Tapp.federation.onRoomUpdate(function (ev) {
      if (!ev || !ev.roomId) return;
      if (ev.event === 'deleted') {
        if (state.activeKind === 'room' && state.activeId === ev.roomId) {
          exitActiveConversationUi(lang.dissolve || 'Room deleted', true);
        } else if (typeof loadConversations === 'function') {
          loadConversations().catch(function () {});
        }
        return;
      }
      if (ev.roomId !== state.activeId || state.activeKind !== 'room') return;
      if (ev.event === 'disconnected') pollMessages(true);
      else if (ev.event === 'governance_changed') {
        Tapp.federation.getRoom(state.activeId).then(function (detail) {
          if (!detail) return;
          state.roomDetail = detail;
          // Keep conv list in sync with federated renames (not only header).
          for (var gi = 0; gi < state.rooms.length; gi++) {
            if (state.rooms[gi].room_id === state.activeId) {
              if (detail.name) state.rooms[gi].name = detail.name;
              if (detail.description !== undefined) state.rooms[gi].description = detail.description;
              if (detail.avatar_url !== undefined) state.rooms[gi].avatar_url = detail.avatar_url;
              break;
            }
          }
          renderChatHeader();
          renderConvList();
        }).catch(function () {});
      } else if (
        ev.event === 'member_joined'
        || ev.event === 'member_left'
        || ev.event === 'member_removed'
        || ev.event === 'member_invited'
      ) {
        Tapp.federation.getRoomMembers(state.activeId).then(function (res) {
          state.members = unwrapRoomMembers(res);
          renderMembers();
          renderChatHeader();
        }).catch(function () {});
      }
    });
  }
}

async function doCloseChannel() {
  if (!state.activeId || state.activeKind !== 'channel') return;
  if (!(await aroConfirm(lang.closeChannelConfirm, true))) return;
  try {
    await unsubscribeRealtime();
    await Tapp.federation.closeChannel(state.activeId);
    if (state.channelDetail) state.channelDetail.status = 'closed';
    for (var i = 0; i < state.channels.length; i++) {
      if (state.channels[i].channel_id === state.activeId) {
        state.channels[i].status = 'closed';
        break;
      }
    }
    clearPendingAttach();
    if (typeof clearQuote === 'function') clearQuote();
    closeAttachMenu();
    renderChatHeader();
    renderConvList();
    updateSendState();
    loadConversations();
  } catch (e) {
    notifyError(lang.closeChannelFail || lang.sendFail || 'Close failed', e);
  }
}

async function doInviteMember(actorUrl) {
  if (!state.activeId || state.activeKind !== 'room') return;
  var actor = actorUrl;
  if (!actor) {
    var input = $('invite-input');
    actor = (input ? input.value : '').trim();
  }
  if (!actor) {
    var emptyInput = $('invite-input');
    if (emptyInput) {
      emptyInput.classList.add('create-input-invalid');
      try { emptyInput.focus(); } catch (e0) {}
      setTimeout(function () { emptyInput.classList.remove('create-input-invalid'); }, 900);
    }
    try { Tapp.ui.showNotification({ title: lang.invitePlaceholder || lang.inviteFail, type: 'error' }); } catch (e1) {}
    return;
  }
  try {
    await Tapp.federation.inviteMember(state.activeId, { actor: actor });
    if (!actorUrl) { var input2 = $('invite-input'); if (input2) input2.value = ''; }
    try { Tapp.ui.showNotification({ title: lang.inviteSuccess, type: 'success' }); } catch (e2) {}
    // Refresh members & re-render popover
    try {
      var detail = await Tapp.federation.getRoom(state.activeId);
      if (detail) state.roomDetail = detail;
      var membersRes = await Tapp.federation.getRoomMembers(state.activeId);
      state.members = unwrapRoomMembers(membersRes);
      renderMembers();
      renderInvitePopoverContacts();
    } catch (e2) {}
  } catch (e) {
    notifyError(lang.inviteFail, e);
  }
}

// ==================== Invite Popover ====================
// Create popover dynamically on document.body to escape all overflow clipping
var _invitePopover = null;
function ensureInvitePopover() {
  if (_invitePopover) return _invitePopover;
  var div = document.createElement('div');
  div.id = 'invite-popover';
  div.className = 'invite-popover';
  div.style.display = 'none';
  var contactSearchPh = lang.searchContacts || lang.pickerSearchPlaceholder || 'Search…';
  div.innerHTML = '<div class="invite-pop-section">'
    + '<div class="invite-pop-label" id="invite-pop-contacts-label">' + esc(lang.inviteFromContacts) + '</div>'
    + '<div class="aro-search-bar aro-search-bar-compact" style="padding:0 0 6px;border:none">'
    + '<input id="invite-contact-search" class="aro-search-input" type="search" autocomplete="off" enterkeyhint="search" placeholder="' + esc(contactSearchPh) + '" aria-label="' + esc(contactSearchPh) + '" />'
    + '</div>'
    + '<div id="invite-pop-list" class="invite-pop-list"></div>'
    + '<div id="invite-pop-empty" class="invite-pop-empty" style="display:none">' + esc(lang.noContacts) + '</div>'
    + '</div>'
    + '<div class="invite-pop-divider"></div>'
    + '<div class="invite-pop-section">'
    + '<div class="invite-pop-label" id="invite-pop-manual-label">' + esc(lang.inviteManual) + '</div>'
    + '<div class="invite-pop-manual">'
    + '<input id="invite-input" class="invite-input" type="text" placeholder="' + esc(lang.invitePlaceholder) + '" />'
    + '<button id="invite-btn" class="invite-pop-send">'
    + '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>'
    + '</button>'
    + '</div>'
    + '</div>';
  document.body.appendChild(div);
  // Wire events on the popover elements
  var inviteBtn = div.querySelector('#invite-btn');
  if (inviteBtn) inviteBtn.addEventListener('click', function () { doInviteMember(); });
  var inviteInput = div.querySelector('#invite-input');
  if (inviteInput) inviteInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); doInviteMember(); }
  });
  var contactSearch = div.querySelector('#invite-contact-search');
  if (contactSearch) {
    contactSearch.addEventListener('input', function () {
      if (!state.search) state.search = {};
      state.search.invite = contactSearch.value || '';
      renderInvitePopoverContacts();
    });
  }
  _invitePopover = div;
  return div;
}

function toggleInvitePopover(e) {
  e && e.stopPropagation();
  var pop = ensureInvitePopover();
  var toggle = $('invite-toggle');
  if (!toggle) return;
  var isOpen = pop.style.display !== 'none';
  if (isOpen) {
    closeInvitePopover();
  } else {
    var rect = toggle.getBoundingClientRect();
    pop.style.top = (rect.bottom + 6) + 'px';
    pop.style.left = Math.max(4, rect.right - 240) + 'px';
    pop.classList.remove('aro-leaving');
    pop.style.display = '';
    aroPlayEnter(pop, 'aro-menu-enter');
    renderInvitePopoverContacts();
    var invInput = pop.querySelector('#invite-input');
    if (invInput) {
      try { invInput.focus(); } catch (e2) { /* ignore */ }
    }
  }
}
function closeInvitePopover() {
  if (!_invitePopover || _invitePopover.style.display === 'none') return;
  aroDismiss(_invitePopover, { ms: 120 });
}
document.addEventListener('click', function (e) {
  if (!_invitePopover || _invitePopover.style.display === 'none') return;
  var wrap = $('invite-wrap');
  if ((wrap && wrap.contains(e.target)) || _invitePopover.contains(e.target)) return;
  closeInvitePopover();
});

function renderInvitePopoverContacts() {
  var listEl = $('invite-pop-list');
  var emptyEl = $('invite-pop-empty');
  if (!listEl || !emptyEl) return;

  // Get actor URLs of current room members for filtering (normalized)
  var memberActors = {};
  state.members.forEach(function (m) {
    if (!m.actor_url) return;
    memberActors[m.actor_url] = true;
    var normalized = normalizeFederationUrl(m.actor_url);
    if (normalized) memberActors[normalized] = true;
  });

  // Build contacts from existing channels (chat partners)
  var contacts = [];
  state.channels.forEach(function (ch) {
    if (!ch.remote_actor_url || ch.status === 'closed') return;
    var remoteNorm = normalizeFederationUrl(ch.remote_actor_url) || ch.remote_actor_url;
    var alreadyMember = !!(memberActors[ch.remote_actor_url] || memberActors[remoteNorm]);
    contacts.push({
      name: ch.remote_actor_name || (ch.remote_actor_url || '').split('/').pop() || '?',
      avatar: ch.remote_actor_avatar || '',
      actorUrl: ch.remote_actor_url,
      alreadyMember: alreadyMember,
    });
  });

  if (contacts.length === 0) {
    listEl.innerHTML = '';
    emptyEl.style.display = '';
    emptyEl.textContent = lang.noContacts;
    return;
  }

  var inviteQ = normalizeSearchQuery((state.search && state.search.invite) || '');
  if (inviteQ) {
    contacts = contacts.filter(function (c) {
      return matchesSearch(inviteQ, [c.name, c.actorUrl]);
    });
  }

  if (contacts.length === 0) {
    listEl.innerHTML = '';
    emptyEl.style.display = '';
    emptyEl.textContent = lang.searchNoResults || lang.noContacts;
    return;
  }

  emptyEl.style.display = 'none';
  var html = '';
  contacts.forEach(function (c) {
    var initial = (c.name[0] || '?').toUpperCase();
    var shortUrl = (c.actorUrl || '').replace(/^https?:\\/\\//, '').split('/').slice(0, 2).join('/');
    html += '<button class="invite-pop-contact' + (c.alreadyMember ? ' invite-pop-contact-disabled' : '') + '"'
      + ' data-actor="' + esc(c.actorUrl) + '"' + (c.alreadyMember ? ' disabled' : '') + '>'
      + '<div class="invite-pop-contact-avatar">'
      + avatarContentHtml(c.avatar || '', c.name || initial)
      + '</div>'
      + '<div class="invite-pop-contact-info">'
      + '<div class="invite-pop-contact-name">' + esc(c.name) + '</div>'
      + '<div class="invite-pop-contact-url">' + esc(shortUrl) + '</div>'
      + '</div>'
      + (c.alreadyMember ? '<span class="invite-pop-contact-added">' + esc(lang.invited || lang.members) + '</span>' : '')
      + '</button>';
  });
  listEl.innerHTML = html;

  // Wire contact click handlers
  listEl.querySelectorAll('.invite-pop-contact:not([disabled])').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var actor = btn.getAttribute('data-actor');
      if (actor) doInviteMember(actor);
    });
  });
}

// ==================== Edit Room ====================
function showEditRoomDialog() {
  if (!state.roomDetail) return;
  var overlay = $('edit-room-dialog');
  if (!overlay) return;
  $('edit-room-name').value = state.roomDetail.name || '';
  $('edit-room-desc').value = state.roomDetail.description || '';
  overlay.classList.remove('aro-leaving');
  overlay.style.display = 'flex';
}

function hideEditRoomDialog() {
  var overlay = $('edit-room-dialog');
  if (!overlay || overlay.style.display === 'none') return;
  aroDismiss(overlay, { ms: 170 });
}

async function doSaveRoom() {
  if (!state.activeId || !state.roomDetail) return;
  var nameVal = ($('edit-room-name').value || '').trim();
  var descVal = ($('edit-room-desc').value || '').trim();
  if (!nameVal) return;
  var btn = $('edit-room-save');
  btn && (btn.disabled = true, btn.textContent = lang.saving);
  try {
    var updated = await Tapp.federation.updateRoom(state.activeId, { name: nameVal, description: descVal });
    if (updated) state.roomDetail = updated;
    // Sync to room list
    for (var i = 0; i < state.rooms.length; i++) {
      if (state.rooms[i].room_id === state.activeId) {
        state.rooms[i].name = nameVal;
        state.rooms[i].description = descVal;
        break;
      }
    }
    hideEditRoomDialog();
    renderChatHeader();
    renderConvList();
  } catch (e) {
    notifyError(lang.saveFail, e);
  } finally {
    btn && (btn.disabled = false, btn.textContent = lang.save);
  }
}

// ==================== Kick Member ====================
async function doKickMember(actorUrl) {
  if (!state.activeId || state.activeKind !== 'room') return;
  if (!(await aroConfirm(lang.kickConfirm, true))) return;
  try {
    await Tapp.federation.removeMember(state.activeId, actorUrl);
    // Refresh members
    var detail = await Tapp.federation.getRoom(state.activeId);
    if (detail) state.roomDetail = detail;
    var membersRes = await Tapp.federation.getRoomMembers(state.activeId);
    state.members = unwrapRoomMembers(membersRes);
    renderMembers();
    renderChatHeader();
  } catch (e) {
    notifyError(lang.kickFail, e);
  }
}

// ==================== Dissolve Room ====================
/**
 * Leave the open chat UI (dissolve / kicked / remote room_deleted).
 * @param {string} [toastTitle]
 * @param {boolean} [asError]
 */
function exitActiveConversationUi(toastTitle, asError) {
  try {
    if (typeof unsubscribeRealtime === 'function') unsubscribeRealtime();
  } catch (e0) { /* ignore */ }
  state.activeKind = null;
  state.activeId = null;
  state.channelDetail = null;
  state.roomDetail = null;
  state.members = [];
  state.messages = [];
  state.messagesFp = '';
  if (typeof stopPolling === 'function') stopPolling();
  if (typeof clearPendingAttach === 'function') clearPendingAttach();
  if (typeof clearQuote === 'function') clearQuote();
  if (typeof closeAttachMenu === 'function') closeAttachMenu();
  if (typeof closeInvitePopover === 'function') closeInvitePopover();
  if (typeof resetHistoryOnConversationChange === 'function') resetHistoryOnConversationChange();
  if (typeof resetRoomFilesOnConversationChange === 'function') resetRoomFilesOnConversationChange();
  var chat = $('chat-container');
  if (chat) chat.style.display = 'none';
  var panel = $('member-panel');
  if (panel) {
    panel.style.display = 'none';
    panel.classList.remove('member-open-mobile');
  }
  var emptyAfter = $('empty-state');
  if (emptyAfter) {
    emptyAfter.style.display = '';
    if (typeof aroPlayEnter === 'function') aroPlayEnter(emptyAfter, 'aro-panel-enter');
  }
  var sideAfter = $('sidebar');
  if (sideAfter) {
    sideAfter.classList.remove('sidebar-hidden-mobile');
    if (typeof aroPlayEnter === 'function') aroPlayEnter(sideAfter, 'aro-panel-enter');
  }
  if (typeof updateSendState === 'function') updateSendState();
  if (typeof loadConversations === 'function') loadConversations();
  if (toastTitle) {
    try {
      Tapp.ui.showNotification({
        title: toastTitle,
        type: asError ? 'error' : 'info',
      });
    } catch (e1) {
      if (asError && typeof notifyError === 'function') notifyError(toastTitle);
    }
  }
}

async function doDissolveRoom() {
  if (!state.activeId || state.activeKind !== 'room') return;
  if (!(await aroConfirm(lang.dissolveConfirm, true))) return;
  try {
    await unsubscribeRealtime();
    await Tapp.federation.deleteRoom(state.activeId);
    exitActiveConversationUi(null, false);
  } catch (e) {
    notifyError(lang.dissolveFail, e);
  }
}

async function doAcceptChannel() {
  if (!state.activeId || state.activeKind !== 'channel') return;
  try {
    await Tapp.federation.acceptChannel(state.activeId);
    // Backend sets status to 'accepted' (writable); 'active' after first message.
    if (state.channelDetail) state.channelDetail.status = 'accepted';
    for (var i = 0; i < state.channels.length; i++) {
      if (state.channels[i].channel_id === state.activeId) {
        state.channels[i].status = 'accepted'; break;
      }
    }
    renderChatHeader();
    renderConvList();
    // Unlock attach/send after accept (pending was composer-locked).
    updateSendState();
    if (typeof maybePublishE2eKeys === 'function') {
      maybePublishE2eKeys().catch(function () {});
    }
  } catch (e) {
    notifyError(lang.acceptFail, e);
  }
}

/** Decline a remote-initiated pending channel (close without chatting). */
async function doRejectChannel() {
  if (!state.activeId || state.activeKind !== 'channel') return;
  if (!(await aroConfirm(lang.channelRejectConfirm || lang.closeChannelConfirm || 'Decline this request?', true))) return;
  try {
    await unsubscribeRealtime();
    await Tapp.federation.closeChannel(state.activeId);
    exitActiveConversationUi(lang.channelRejected || lang.closed || null, false);
  } catch (e) {
    notifyError(lang.closeChannelFail || lang.acceptFail || 'Reject failed', e);
  }
}

/** Self-join an open-policy room (no invite required). */
async function doJoinOpenRoom() {
  if (!state.activeId || state.activeKind !== 'room') return;
  if (!Tapp.federation || typeof Tapp.federation.joinRoom !== 'function') {
    notifyError(lang.joinRoomFail || lang.acceptFail || 'Join not available');
    return;
  }
  try {
    await Tapp.federation.joinRoom(state.activeId);
    if (state.roomDetail) {
      state.roomDetail.my_membership_status = 'active';
      state.roomDetail.my_role = state.roomDetail.my_role || 'member';
    }
    try {
      var detail = await Tapp.federation.getRoom(state.activeId);
      if (detail) state.roomDetail = detail;
      var membersRes = await Tapp.federation.getRoomMembers(state.activeId);
      state.members = unwrapRoomMembers(membersRes);
    } catch (e2) { /* ignore */ }
    renderChatHeader();
    renderMembers();
    renderConvList();
    updateSendState();
    if (typeof maybePublishE2eKeys === 'function') {
      maybePublishE2eKeys().catch(function () {});
    }
    try {
      Tapp.ui.showNotification({
        title: lang.joinRoomOk || lang.roomInviteAccepted || 'Joined',
        type: 'success',
      });
    } catch (e3) { /* ignore */ }
  } catch (e) {
    notifyError(lang.joinRoomFail || lang.acceptFail || 'Join failed', e);
  }
}

async function doAcceptRoomInvite() {
  if (!state.activeId || state.activeKind !== 'room') return;
  if (!Tapp.federation || typeof Tapp.federation.acceptRoomInvite !== 'function') {
    notifyError(lang.acceptFail || 'Accept not available');
    return;
  }
  try {
    await Tapp.federation.acceptRoomInvite(state.activeId);
    if (state.roomDetail) state.roomDetail.my_membership_status = 'active';
    for (var i = 0; i < state.rooms.length; i++) {
      if (state.rooms[i].room_id === state.activeId) {
        state.rooms[i].my_membership_status = 'active';
        break;
      }
    }
    try {
      var detail = await Tapp.federation.getRoom(state.activeId);
      if (detail) state.roomDetail = detail;
      var membersRes = await Tapp.federation.getRoomMembers(state.activeId);
      state.members = unwrapRoomMembers(membersRes);
    } catch (e2) { /* ignore refresh errors */ }
    renderChatHeader();
    renderMembers();
    renderConvList();
    updateSendState();
    if (typeof maybePublishE2eKeys === 'function') {
      maybePublishE2eKeys().catch(function () {});
    }
    try {
      Tapp.ui.showNotification({ title: lang.roomInviteAccepted || lang.accept || 'Joined', type: 'success' });
    } catch (e3) { /* ignore */ }
  } catch (e) {
    notifyError(lang.acceptFail, e);
  }
}

async function doRejectRoomInvite() {
  if (!state.activeId || state.activeKind !== 'room') return;
  if (!(await aroConfirm(lang.roomInviteRejectConfirm || lang.leaveConfirm || 'Decline this invite?', true))) return;
  try {
    if (Tapp.federation && typeof Tapp.federation.rejectRoomInvite === 'function') {
      await Tapp.federation.rejectRoomInvite(state.activeId);
    } else {
      await Tapp.federation.leaveRoom(state.activeId);
    }
    await unsubscribeRealtime();
    exitActiveConversationUi(lang.roomInviteRejected || null, false);
  } catch (e) {
    notifyError(lang.acceptFail || lang.leaveFail || 'Reject failed', e);
  }
}

async function doLeaveRoom() {
  if (!state.activeId || state.activeKind !== 'room') return;
  if (!(await aroConfirm(lang.leaveConfirm || lang.leaveRingConfirm || 'Leave this group?', true))) return;
  try {
    await unsubscribeRealtime();
    await Tapp.federation.leaveRoom(state.activeId);
    exitActiveConversationUi(null, false);
  } catch (e) {
    notifyError(lang.leaveFail || lang.sendFail || 'Leave failed', e);
  }
}

// ==================== Create Dialog ====================
function showCreateDialog() {
  var overlay = $('create-dialog');
  if (overlay) {
    overlay.classList.remove('aro-leaving');
    overlay.style.display = 'flex';
  }
  switchCreateTab('channel');
}

function hideCreateDialog() {
  var overlay = $('create-dialog');
  var clearInputs = function () {
    var channelInput = $('create-channel-input');
    var roomInput = $('create-room-input');
    if (channelInput) channelInput.value = '';
    if (roomInput) roomInput.value = '';
  };
  if (!overlay || overlay.style.display === 'none') {
    clearInputs();
    return;
  }
  aroDismiss(overlay, { ms: 170, onDone: clearInputs });
}

function switchCreateTab(tab) {
  var channelTab = $('create-tab-channel');
  var roomTab = $('create-tab-room');
  var channelForm = $('create-form-channel');
  var roomForm = $('create-form-room');
  if (!channelTab) return;
  if (tab === 'channel') {
    channelTab.classList.add('create-tab-active');
    roomTab.classList.remove('create-tab-active');
    channelForm.style.display = '';
    roomForm.style.display = 'none';
  } else {
    roomTab.classList.add('create-tab-active');
    channelTab.classList.remove('create-tab-active');
    roomForm.style.display = '';
    channelForm.style.display = 'none';
  }
}

function flashCreateInput(input) {
  if (!input) return;
  input.classList.add('create-input-invalid');
  try { input.focus(); } catch (e) { /* ignore */ }
  setTimeout(function () { input.classList.remove('create-input-invalid'); }, 900);
}

async function doCreateChannel() {
  var input = $('create-channel-input');
  if (!input) return;
  var remoteActor = input.value.trim();
  if (!remoteActor) {
    flashCreateInput(input);
    try { Tapp.ui.showNotification({ title: lang.channelPlaceholder || lang.createFail, type: 'error' }); } catch (e0) {}
    return;
  }
  var btn = $('create-channel-btn');
  if (btn) { btn.disabled = true; btn.textContent = lang.creating; }
  try {
    var result = await Tapp.federation.createChannel({ remote_actor: remoteActor });
    hideCreateDialog();
    await loadConversations();
    if (result && result.channel_id) {
      openConversation('channel', result.channel_id);
    }
  } catch (e) {
    console.error('[Aro] createChannel error:', e);
    notifyError(lang.createFail, e);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = lang.createChannel; }
  }
}

async function doCreateRoom() {
  var input = $('create-room-input');
  if (!input) return;
  var name = input.value.trim();
  if (!name) {
    flashCreateInput(input);
    try { Tapp.ui.showNotification({ title: lang.roomPlaceholder || lang.createFail, type: 'error' }); } catch (e0) {}
    return;
  }
  var btn = $('create-room-btn');
  if (btn) { btn.disabled = true; btn.textContent = lang.creating; }
  try {
    var result = await Tapp.federation.createRoom({ name: name });
    hideCreateDialog();
    await loadConversations();
    if (result && result.room_id) {
      openConversation('room', result.room_id);
    }
  } catch (e) {
    console.error('[Aro] createRoom error:', e);
    notifyError(lang.createFail, e);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = lang.createRoom; }
  }
}

// ==================== View Switching ====================
function switchView(view) {
  if (state.isGuest && view !== 'feed') view = 'feed';
  var prev = state.currentView;
  state.currentView = view;
  var views = ['messages', 'feed', 'rings'];
  views.forEach(function (v) {
    var el = $('view-' + v);
    if (el) {
      el.classList.toggle('aro-view-active', v === view);
      if (v !== view) {
        el.style.display = 'none';
        el.classList.remove('aro-view-enter');
      } else {
        el.style.display = '';
        el.classList.add('aro-view-active');
        if (prev && prev !== view) aroPlayEnter(el, 'aro-view-enter');
      }
    }
  });
  // Update nav buttons
  document.querySelectorAll('.aro-nav-item').forEach(function (btn) {
    btn.classList.toggle('aro-nav-active', btn.dataset.view === view);
  });
  // Pause chat poll when not on messages; keep WS for quick resume
  if (view === 'messages') {
    if (state.activeId) startPolling();
  } else {
    stopPolling();
  }
  // Contextual feed + is feed-only; hide and close menus when leaving feed.
  if (typeof updateFeedPlusVisibility === 'function') updateFeedPlusVisibility();
  if (view !== 'feed') {
    if (typeof closeFeedPlusMenu === 'function') closeFeedPlusMenu();
    if (typeof closeFollowDialog === 'function') closeFollowDialog();
  }
  // Load data for the view
  if (view === 'feed') loadFeed();
  else if (view === 'rings') loadRings();
}
`

const PAGE_MOD_VIEWS = `\
// ==================== Feed View (merged Timeline + Profile) ====================
async function loadFeed() {
  renderFederationIdentity();
  updateFeedProfileHeader();
  return loadFeedSubTab();
}

function formatFeedBadgeCount(n) {
  if (n > 99) return '99+';
  return String(n);
}

/** Sync following/followers/published counts into nav + mobile tab badges. Hidden when 0. */
function updateFeedCountBadges() {
  var pairs = [
    { count: (state.following && state.following.length) || 0, ids: ['feed-badge-following', 'feed-mobile-badge-following'] },
    { count: (state.followers && state.followers.length) || 0, ids: ['feed-badge-followers', 'feed-mobile-badge-followers'] },
    { count: (state.published && state.published.length) || 0, ids: ['feed-badge-published', 'feed-mobile-badge-published'] }
  ];
  if (state.isGuest) {
    pairs.forEach(function (p) { p.count = 0; });
  }
  pairs.forEach(function (p) {
    p.ids.forEach(function (id) {
      var el = $(id);
      if (!el) return;
      if (p.count === 0) {
        el.hidden = true;
        el.textContent = '0';
      } else {
        el.hidden = false;
        el.textContent = formatFeedBadgeCount(p.count);
      }
    });
  });
}

/** Normalize list API shapes: {items}, bare array, or double-wrapped data. */
function unwrapListResponse(res) {
  if (!res) return [];
  if (Array.isArray(res)) return res;
  if (Array.isArray(res.items)) return res.items;
  if (res.data) {
    if (Array.isArray(res.data)) return res.data;
    if (Array.isArray(res.data.items)) return res.data.items;
  }
  return [];
}

function updateFeedProfileHeader() {
  if (state.isGuest) {
    state.following = [];
    state.followers = [];
    state.published = [];
    updateFeedCountBadges();
    updateFeedHeader();
    return;
  }
  Promise.all([
    Tapp.federation.getFollowing().catch(function () { return { items: [] }; }),
    Tapp.federation.getFollowers().catch(function () { return { items: [] }; }),
    Tapp.federation.getPublished().catch(function () { return { items: [] }; })
  ]).then(function (results) {
    state.following = unwrapListResponse(results[0]);
    state.followers = unwrapListResponse(results[1]);
    state.published = unwrapListResponse(results[2]);
    updateFeedCountBadges();
    updateFeedHeader();
    // If user is already on followers/following/published, re-render with fresh counts.
    if (state.currentView === 'feed' && state.feedSubTab !== 'timeline') {
      renderFeedContent();
    }
  });
}

async function loadFeedSubTab() {
  var sub = state.feedSubTab;
  if (typeof updateFeedPlusVisibility === 'function') updateFeedPlusVisibility();

  state.feedLoading = true;
  state.feedError = null;
  updateFeedLoadingState();
  updateFeedHeader();
  renderFeedContent();

  try {
    if (sub === 'timeline') {
      var res = null;
      var feedErr = null;
      if (Tapp.federation && typeof Tapp.federation.getFeed === 'function') {
        try {
          res = await Tapp.federation.getFeed();
        } catch (eFeed) {
          feedErr = eFeed;
          console.warn('[Aro] getFeed failed, trying getTimeline', eFeed);
        }
      }
      if (!res && Tapp.federation && typeof Tapp.federation.getTimeline === 'function') {
        try {
          res = await Tapp.federation.getTimeline();
        } catch (eTl) {
          if (!feedErr) feedErr = eTl;
          else console.warn('[Aro] getTimeline also failed', eTl);
        }
      }
      if (!res && feedErr) throw feedErr;
      state.timeline = unwrapListResponse(res);
    } else if (sub === 'following') {
      var res = await Tapp.federation.getFollowing();
      state.following = unwrapListResponse(res);
      updateFeedCountBadges();
    } else if (sub === 'followers') {
      var res = await Tapp.federation.getFollowers();
      state.followers = unwrapListResponse(res);
      updateFeedCountBadges();
    } else if (sub === 'published') {
      var res = await Tapp.federation.getPublished();
      state.published = unwrapListResponse(res);
      updateFeedCountBadges();
    } else if (sub === 'backup') {
      // Local export/import page — no network list load
      state.feedError = null;
    }
    if (state.feedSubTab !== sub) return;
    state.feedLoaded[sub] = true;
    state.feedError = null;
  } catch (e) {
    if (state.feedSubTab !== sub) return;
    // Mark loaded so UI never sticks on blank/skeleton; show error empty state.
    state.feedLoaded[sub] = true;
    state.feedError = getErrorMessage(e) || lang.feedLoadFail || lang.disconnected || '加载失败';
    console.error('[Aro] loadFeedSubTab error:', e);
  } finally {
    if (state.feedSubTab === sub) {
      state.feedLoading = false;
      updateFeedLoadingState();
      updateFeedHeader();
      renderFeedContent();
    }
  }
}

function updateFeedLoadingState() {
  ['refresh-feed-btn', 'refresh-feed-mobile-btn'].forEach(function (id) {
    var refreshBtn = $(id);
    if (!refreshBtn) return;
    refreshBtn.classList.toggle('feed-refresh-loading', !!state.feedLoading);
    refreshBtn.disabled = !!state.feedLoading;
  });
}

function getFeedTitle(sub) {
  if (state.isGuest) return lang.publicFeed || lang.feedTimeline || 'Home';
  if (sub === 'following') return lang.feedFollowing || 'Following';
  if (sub === 'followers') return lang.feedFollowers || 'Followers';
  if (sub === 'published') return lang.feedPublished || 'Published';
  if (sub === 'backup') return lang.backupTitle || lang.feedBackup || 'Chat backup';
  return lang.feedTimeline || 'Home';
}

/**
 * Header subtitle — always non-empty for the active tab.
 * Keys: feedHint* (primary) / feedMeta* / feedSub* aliases.
 */
function getFeedHint(sub) {
  if (state.isGuest) {
    return lang.feedHintGuest || lang.feedMetaGuest || lang.publicFeed
      || 'Public posts from this site';
  }
  if (sub === 'following') {
    return lang.feedHintFollowing || lang.feedMetaFollowing || lang.feedSubFollowing
      || lang.feedFollowing || 'People you follow';
  }
  if (sub === 'followers') {
    return lang.feedHintFollowers || lang.feedMetaFollowers || lang.feedSubFollowers
      || lang.feedFollowers || 'People who follow you';
  }
  if (sub === 'backup') {
    return lang.feedHintBackup || lang.backupHint
      || 'Export and import your messenger history';
  }
  if (sub === 'published') {
    return lang.feedHintPublished || lang.feedMetaPublished || lang.feedSubPublished
      || lang.feedPublished || "Notes you've published";
  }
  return lang.feedHintTimeline || lang.feedMetaTimeline || lang.feedSubTimeline
    || lang.feedTimeline || 'Posts from people you follow';
}

function updateFeedHeader() {
  var title = $('feed-section-title');
  var meta = $('feed-section-meta');
  var sub = state.feedSubTab;
  var pageTitle = getFeedTitle(sub);
  if (title) title.textContent = pageTitle;
  if (!meta) return;
  // Never leave subtitle blank: helper, loading, or helper · count
  var hint = getFeedHint(sub) || pageTitle || '—';
  if (sub === 'backup') {
    meta.textContent = hint;
    return;
  }
  var allItems = getFeedItems(sub) || [];
  var items = filterFeedItems(sub, allItems);
  var q = normalizeSearchQuery((state.search && state.search.feed) || '');
  if (state.feedLoading && !state.feedLoaded[sub]) {
    meta.textContent = lang.feedLoading || hint;
  } else if (state.feedLoaded[sub] && allItems.length > 0) {
    if (q) {
      meta.textContent = (items.length + ' / ' + allItems.length) + (lang.feedItems ? ' ' + lang.feedItems : '');
    } else {
      var countText = allItems.length + ' ' + (lang.feedItems || '');
      meta.textContent = countText ? (hint + ' · ' + countText) : hint;
    }
  } else {
    meta.textContent = hint;
  }
}

function getFeedItems(sub) {
  if (sub === 'following') return state.following;
  if (sub === 'followers') return state.followers;
  if (sub === 'published') return state.published;
  return state.timeline;
}

function actorSearchParts(actor) {
  if (!actor) return [];
  var handle = actor.username
    ? '@' + actor.username + (actor.domain ? '@' + actor.domain : '')
    : '';
  return [
    actor.display_name,
    actor.username,
    actor.domain,
    handle,
    actor.actor_url,
    actor.bio,
  ];
}

function timelineItemSearchParts(item) {
  var actor = (item && item.actor) || {};
  var contentJson = (item && (item.content_json || item.content || item.object)) || null;
  if (contentJson && contentJson.object && typeof contentJson.object === 'object'
      && !contentJson.content && !(contentJson.source && contentJson.source.content)
      && !contentJson.summary && !contentJson.name) {
    contentJson = contentJson.object;
  }
  var text = '';
  if (contentJson) {
    text = stripHtmlPreview(
      contentJson.title ||
      contentJson.name ||
      (contentJson.source && typeof contentJson.source === 'object' && contentJson.source.content) ||
      contentJson.content ||
      contentJson.summary ||
      contentJson.content_preview ||
      ''
    );
  }
  if (!text && item && item.content_preview) text = stripHtmlPreview(item.content_preview);
  return actorSearchParts(actor).concat([text, item && item.content_preview]);
}

function publishedItemSearchParts(item) {
  if (!item) return [];
  return [
    item.title,
    item.name,
    item.content_preview,
    item.summary,
    item.content_type,
    item.content_id,
    publishedTypeLabel(item.content_type),
  ];
}

/** Apply current feed search query to a sub-tab list. */
function filterFeedItems(sub, items) {
  var q = normalizeSearchQuery((state.search && state.search.feed) || '');
  if (!q || !items || !items.length) return items || [];
  return items.filter(function (item) {
    if (sub === 'following' || sub === 'followers') {
      return matchesSearch(q, actorSearchParts(item));
    }
    if (sub === 'published') {
      return matchesSearch(q, publishedItemSearchParts(item));
    }
    return matchesSearch(q, timelineItemSearchParts(item));
  });
}

/** Empty-state title ≈ page title; dedicated emptyTitle* preferred when present. */
function getFeedEmptyTitle(sub) {
  if (sub === 'following') {
    return lang.emptyTitleFollowing || getFeedTitle(sub) || 'Not following anyone';
  }
  if (sub === 'followers') {
    return lang.emptyTitleFollowers || getFeedTitle(sub) || 'No followers yet';
  }
  if (sub === 'published') {
    return lang.emptyTitlePublished || getFeedTitle(sub) || 'Nothing published';
  }
  return lang.emptyTitleTimeline || getFeedTitle(sub) || 'No posts yet';
}

function getFeedEmptyText(sub) {
  if (sub === 'following') {
    return lang.emptyFollowing
      || 'Tap + then Follow to add someone by handle or profile link.';
  }
  if (sub === 'followers') {
    return lang.emptyFollowers
      || 'Share your profile link so others can follow you.';
  }
  if (sub === 'published') {
    return lang.emptyPublished
      || 'Switch to Home and tap + to publish a note or media.';
  }
  return lang.emptyTimeline
    || 'Follow people or publish a post to fill your home feed.';
}

function showFeedEmpty(message, kind) {
  var empty = $('feed-empty');
  if (!empty) {
    console.warn('[Aro] #feed-empty missing');
    return;
  }
  var main = empty.closest('.feed-main');
  if (main) main.classList.add('feed-empty-visible');
  // Inline style on page.html is display:none — force visible flex layout.
  empty.style.display = 'flex';
  empty.style.visibility = 'visible';
  empty.hidden = false;
  empty.removeAttribute('hidden');
  empty.classList.toggle('feed-empty-error', kind === 'error');
  empty.classList.toggle('feed-empty-loading', kind === 'loading');
  // Always show title + body for default empty (not only on error)
  var title = $('feed-empty-title');
  if (title) {
    title.style.display = 'block';
    title.hidden = false;
    if (kind === 'error') {
      title.textContent = lang.feedLoadFail || lang.disconnected || 'Load failed';
    } else if (kind === 'loading') {
      title.textContent = getFeedTitle(state.feedSubTab);
    } else {
      title.textContent = getFeedEmptyTitle(state.feedSubTab) || getFeedTitle(state.feedSubTab);
    }
  }
  var text = $('feed-empty-text');
  if (text) {
    text.style.display = 'block';
    text.hidden = false;
    if (kind === 'loading') {
      text.textContent = lang.feedLoading || message || '…';
    } else {
      text.textContent = message || getFeedEmptyText(state.feedSubTab);
    }
  }
  var retry = $('feed-empty-retry');
  if (retry) {
    retry.textContent = lang.feedRetry || 'Try again';
    retry.style.display = kind === 'error' ? '' : 'none';
    if (!retry.dataset.bound) {
      retry.dataset.bound = '1';
      retry.addEventListener('click', function () { loadFeedSubTab(); });
    }
  }
}

function renderFeedSkeleton() {
  var html = '';
  for (var i = 0; i < 4; i++) {
    html += '<div class="feed-skeleton-item">'
      + '<div class="feed-skeleton-avatar"></div>'
      + '<div class="feed-skeleton-body">'
      + '<div class="feed-skeleton-line feed-skeleton-line-short"></div>'
      + '<div class="feed-skeleton-line"></div>'
      + '<div class="feed-skeleton-line feed-skeleton-line-mid"></div>'
      + '</div>'
      + '</div>';
  }
  return html;
}

function bindFeedContentActions(content) {
  content.querySelectorAll('[data-action-unfollow]').forEach(function (btn) {
    btn.addEventListener('click', function (e) { e.stopPropagation(); doUnfollow(btn.dataset.actionUnfollow); });
  });
  content.querySelectorAll('[data-action-unpublish]').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      doUnpublish(btn.dataset.contentType, btn.dataset.contentId);
    });
  });
}

function renderFeedContent() {
  var content = $('feed-content');
  var empty = $('feed-empty');
  if (!content) return;
  var main = content.closest('.feed-main');
  if (main) main.classList.remove('feed-empty-visible');

  var sub = state.feedSubTab;
  var searchBar = document.querySelector('.feed-search-bar');

  // Profile → chat backup sub-page (export / import)
  if (sub === 'backup') {
    if (searchBar) searchBar.style.display = 'none';
    if (empty) empty.style.display = 'none';
    if (typeof renderBackupPage === 'function') {
      renderBackupPage();
    } else {
      content.innerHTML = '<div class="backup-page"><div class="backup-card"><p class="backup-card-desc">'
        + esc(lang.backupTitle || 'Chat backup') + '</p></div></div>';
    }
    return;
  }
  if (searchBar) searchBar.style.display = '';

  var allItems = getFeedItems(sub) || [];
  var items = filterFeedItems(sub, allItems);
  var hasLoaded = !!state.feedLoaded[sub];
  var q = normalizeSearchQuery((state.search && state.search.feed) || '');
  var html = '';

  if (state.feedLoading && !hasLoaded) {
    content.innerHTML = renderFeedSkeleton();
    if (empty) empty.style.display = 'none';
    return;
  }

  if (state.feedError) {
    content.innerHTML = '';
    if (empty) empty.style.display = 'none';
    showFeedEmpty(state.feedError, 'error');
    return;
  }

  if (!allItems || allItems.length === 0) {
    content.innerHTML = '';
    // Prefer empty UI even before first load completes (avoids pure white main).
    showFeedEmpty(getFeedEmptyText(sub), hasLoaded ? 'empty' : (state.feedLoading ? 'loading' : 'empty'));
    return;
  }

  if (items.length === 0 && q) {
    content.innerHTML = searchNoResultsHtml();
    if (empty) empty.style.display = 'none';
    return;
  }

  if (empty) empty.style.display = 'none';

  if (sub === 'timeline') {
    items.forEach(function (item) {
      html += renderTimelineItem(item);
    });
  } else if (sub === 'following') {
    items.forEach(function (actor) {
      html += renderActorItem(actor, 'following');
    });
  } else if (sub === 'followers') {
    items.forEach(function (actor) {
      html += renderActorItem(actor, 'followers');
    });
  } else if (sub === 'published') {
    items.forEach(function (item) {
      html += renderPublishedItem(item);
    });
  }

  content.innerHTML = html;
  bindFeedContentActions(content);
}

function stripHtmlPreview(html) {
  if (!html) return '';
  return String(html)
    .replace(/<br\\s*\\/?>/gi, '\\n')
    .replace(/<\\/p>/gi, '\\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .trim();
}

function extractNoteAttachments(contentJson) {
  if (!contentJson) return [];
  var atts = contentJson.attachment || contentJson.attachments || [];
  if (!Array.isArray(atts)) {
    if (atts && typeof atts === 'object') atts = [atts];
    else return [];
  }
  return atts.filter(function (a) { return a && a.url; });
}

function renderTimelineMedia(attachments) {
  if (!attachments || !attachments.length) return '';
  var multi = attachments.length >= 2;
  var h = '<div class="feed-item-media' + (multi ? ' feed-item-media-grid' : ' feed-item-media-single') + '">';
  attachments.forEach(function (att) {
    var url = att.url;
    var mime = (att.mediaType || att.media_type || '').toLowerCase();
    var type = (att.type || '').toLowerCase();
    var isVideo = type === 'video' || mime.indexOf('video/') === 0;
    if (multi) {
      h += '<div class="feed-media-cell">';
      if (isVideo) {
        h += '<video src="' + esc(url) + '" controls playsinline preload="metadata"></video>';
      } else {
        h += '<img src="' + esc(url) + '" alt="" loading="lazy" />';
      }
      h += '</div>';
    } else if (isVideo) {
      h += '<video src="' + esc(url) + '" controls playsinline preload="metadata"></video>';
    } else {
      h += '<img src="' + esc(url) + '" alt="" loading="lazy" />';
    }
  });
  h += '</div>';
  return h;
}

function actorLabelFromUrl(url) {
  if (!url) return '';
  try {
    var path = String(url).replace(/\\/+$/, '');
    var seg = path.split('/').pop() || '';
    return seg || url;
  } catch (e) {
    return String(url);
  }
}

function renderTimelineItem(item) {
  var actor = item.actor || {};
  var name = actor.display_name || actor.username || actorLabelFromUrl(actor.actor_url) || '?';
  var handle = actor.username
    ? '@' + actor.username + (actor.domain ? '@' + actor.domain : '')
    : (actor.actor_url ? actor.actor_url : '');
  var ts = '';
  try { ts = timeAgo(item.created_at || item.received_at || item.timestamp); } catch (e) {}
  // content_json is normally the AP object; tolerate full Create envelope or aliases.
  var contentJson = item.content_json || item.content || item.object || null;
  if (contentJson && contentJson.object && typeof contentJson.object === 'object'
      && !contentJson.content && !(contentJson.source && contentJson.source.content)
      && !contentJson.summary && !contentJson.name) {
    contentJson = contentJson.object;
  }
  var text = '';
  var linkUrl = '';
  if (contentJson) {
    text = stripHtmlPreview(
      contentJson.title ||
      contentJson.name ||
      (contentJson.source && typeof contentJson.source === 'object' && contentJson.source.content) ||
      contentJson.content ||
      contentJson.summary ||
      contentJson.content_preview ||
      ''
    );
    linkUrl = contentJson.link || contentJson.url || '';
    if (typeof linkUrl !== 'string') linkUrl = '';
    // Ring brew entries often put source as a string name
    if (!text && contentJson.summary) text = stripHtmlPreview(contentJson.summary);
  }
  if (!text && item.content_preview) text = stripHtmlPreview(item.content_preview);
  var attachments = extractNoteAttachments(contentJson);
  // Media-only Note: still show a short placeholder so the card is not blank.
  if (!text && attachments.length) {
    text = lang.composeMedia || '📎';
  }
  var h = '<div class="feed-item">';
  h += '<div class="feed-item-avatar">' + avatarContentHtml(actor.avatar_url || '', name) + '</div>';
  h += '<div class="feed-item-body">';
  h += '<div class="feed-item-header">';
  h += '<span class="feed-item-name">' + esc(name) + '</span>';
  if (handle) h += '<span class="feed-item-handle">' + esc(handle) + '</span>';
  if (ts) h += '<span class="feed-item-sep">&middot;</span><span class="feed-item-time">' + esc(ts) + '</span>';
  h += '</div>';
  if (text) {
    if (linkUrl) {
      h += '<div class="feed-item-text"><a href="' + esc(linkUrl) + '" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:underline">' + esc(text) + '</a></div>';
    } else {
      h += '<div class="feed-item-text">' + esc(text) + '</div>';
    }
  }
  h += renderTimelineMedia(attachments);
  h += '</div></div>';
  return h;
}

function pendingStatusLabel(status) {
  if (!status || status === 'accepted') return '';
  if (status === 'pending') return lang.pendingConfirm || lang.pending || 'pending';
  return status;
}

function renderActorItem(actor, context) {
  // username may be null for unresolved remote actors — fall back to actor_url.
  var name = actor.display_name || actor.username || actorLabelFromUrl(actor.actor_url) || '?';
  var handle = actor.username
    ? '@' + actor.username + (actor.domain ? '@' + actor.domain : '')
    : (actor.actor_url || actor.domain || '');
  var h = '<div class="feed-item">';
  h += '<div class="feed-item-avatar">' + avatarContentHtml(actor.avatar_url || '', name) + '</div>';
  h += '<div class="feed-item-body">';
  h += '<div class="feed-item-header">';
  h += '<span class="feed-item-name">' + esc(name) + '</span>';
  if (handle) h += '<span class="feed-item-handle">' + esc(handle) + '</span>';
  h += '</div>';
  if (actor.bio) h += '<div class="feed-item-text">' + esc(actor.bio) + '</div>';
  // Status + action — localize non-accepted (pending) badge
  h += '<div class="feed-item-actions">';
  if (actor.status && actor.status !== 'accepted') {
    h += '<span class="aro-badge aro-badge-pending">' + esc(pendingStatusLabel(actor.status)) + '</span>';
  }
  if (context === 'following') {
    h += '<button class="feed-item-action feed-item-action-danger" data-action-unfollow="' + esc(actor.actor_url || '') + '">'
      + '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>'
      + esc(lang.unfollowBtn) + '</button>';
  }
  h += '</div></div></div>';
  return h;
}

/** 已发布内容的可读类型名 */
function publishedTypeLabel(type) {
  var map = {
    'note': lang.composePost,
    'tapp': lang.attachTapp,
    'brew-article': lang.attachBrew,
    'library': lang.attachLibrary,
    'report': lang.attachReport,
  };
  return map[type] || type || '';
}

function renderPublishedItem(item) {
  var typeIcons = { 'report': SVG_ICONS.report, 'brew-article': SVG_ICONS.memo, 'tapp': SVG_ICONS.tapp, 'library': SVG_ICONS.library, 'note': SVG_ICONS.page };
  var icon = typeIcons[item.content_type] || SVG_ICONS.page;
  var dateStr = '';
  try { dateStr = timeAgo(item.published_at); } catch (e) {}
  // Prefer title as header line when useful; body uses summary/content_preview.
  var titleLine = stripHtmlPreview(item.title || item.name || '');
  var preview = stripHtmlPreview(item.content_preview || item.summary || '');
  if (!preview && titleLine) preview = titleLine;
  if (!preview) preview = stripHtmlPreview(item.content_id || '');
  var h = '<div class="feed-item">';
  h += '<div class="feed-item-icon">' + icon + '</div>';
  h += '<div class="feed-item-body">';
  h += '<div class="feed-item-header">';
  h += '<span class="feed-item-name">' + esc(titleLine || publishedTypeLabel(item.content_type)) + '</span>';
  if (dateStr) h += '<span class="feed-item-sep">&middot;</span><span class="feed-item-time">' + esc(dateStr) + '</span>';
  h += '</div>';
  if (titleLine && preview && preview !== titleLine) {
    h += '<div class="feed-item-text">' + esc(preview) + '</div>';
  } else if (preview) {
    h += '<div class="feed-item-text">' + esc(preview) + '</div>';
  }
  if (titleLine && item.content_type && item.content_type !== 'note') {
    h += '<div class="feed-item-meta" style="font-size:11px;color:var(--text-secondary,#888)">' + esc(publishedTypeLabel(item.content_type)) + '</div>';
  }
  h += '<div class="feed-item-actions">';
  h += '<button class="feed-item-action feed-item-action-danger" data-action-unpublish data-content-type="' + esc(item.content_type) + '" data-content-id="' + esc(item.content_id) + '">'
    + '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>'
    + esc(lang.removeBtn) + '</button>';
  h += '</div></div></div>';
  return h;
}

function timeAgo(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  var now = new Date();
  var sec = Math.floor((now - d) / 1000);
  if (sec < 60) return sec + 's';
  var min = Math.floor(sec / 60);
  if (min < 60) return min + 'm';
  var hr = Math.floor(min / 60);
  if (hr < 24) return hr + 'h';
  var day = Math.floor(hr / 24);
  if (day < 30) return day + 'd';
  try { return d.toLocaleDateString(currentLocale, { month: 'short', day: 'numeric' }); } catch (e) { return day + 'd'; }
}

function switchFeedSubTab(sub) {
  state.feedSubTab = sub;
  updateFeedHeader();
  // Update sidebar nav
  document.querySelectorAll('.feed-nav-item').forEach(function (btn) {
    btn.classList.toggle('feed-nav-active', btn.dataset.sub === sub);
  });
  // Update mobile tabs
  document.querySelectorAll('.feed-mobile-tab').forEach(function (btn) {
    btn.classList.toggle('feed-mobile-tab-active', btn.dataset.sub === sub);
  });
  // Contextual + must recompute immediately on tab change (before async load).
  if (typeof updateFeedPlusVisibility === 'function') updateFeedPlusVisibility();
  // Leaving Post tab: collapse composer so it doesn't linger under other tabs.
  if (sub !== 'timeline' && typeof closeComposer === 'function') closeComposer();
  if (sub !== 'following' && typeof closeFollowDialog === 'function') closeFollowDialog();
  loadFeedSubTab();
}

async function doFollow() {
  var input = $('feed-follow-input');
  var btn = $('feed-follow-btn');
  if (!input) return;
  var target = input.value.trim();
  if (!target) return;
  if (btn) { btn.disabled = true; }
  try {
    await Tapp.federation.follow(target);
    input.value = '';
    if (typeof closeFollowDialog === 'function') closeFollowDialog();
    // Refresh following list; auto-accept is remote (no manual approve UI).
    if (state.feedSubTab !== 'following') {
      state.feedSubTab = 'following';
      switchFeedSubTab('following');
    } else {
      loadFeedSubTab();
    }
    updateFeedProfileHeader();
    try {
      Tapp.ui.showNotification({
        title: lang.followBtn || 'Follow',
        message: lang.followQueued || '',
        type: 'info'
      });
    } catch (e2) { /* ignore */ }
  } catch (e) {
    notifyError(lang.followFail, e);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ==================== Feed composer (freeform Note) ====================
var composeAttachments = []; // { file, previewUrl, kind: 'image'|'video' }
var COMPOSE_DRAFT_KEY = 'aro_compose_draft';
/** Track whether last storage restore lacked attachable files. */
var composeDraftTextOnly = false;

/**
 * Contextual + menu (owner feed only):
 * - timeline  → Post only
 * - following → Follow only
 * - followers / published / guest / non-feed → no +
 */
function canComposePost() {
  return !state.isGuest
    && state.currentView === 'feed'
    && state.feedSubTab === 'timeline';
}

function canFollowFromFeed() {
  return !state.isGuest
    && state.currentView === 'feed'
    && state.feedSubTab === 'following';
}

function isComposeBusy() {
  var publishBtn = $('feed-compose-publish');
  return !!(publishBtn && publishBtn.disabled);
}

function getComposeText() {
  var ta = $('feed-compose-text');
  return ta ? String(ta.value || '') : '';
}

function composeHasContent() {
  return !!(getComposeText().trim() || composeAttachments.length);
}

function setComposeDraftHint(visible) {
  var hint = $('feed-compose-draft-hint');
  if (!hint) return;
  if (visible) {
    hint.textContent = lang.composeDraftRestored || 'Draft restored';
    hint.hidden = false;
  } else {
    hint.hidden = true;
    hint.textContent = '';
  }
}

function setComposeDraftNotice(visible) {
  var notice = $('feed-compose-draft-notice');
  if (!notice) return;
  if (visible) {
    notice.textContent = lang.composeDraftTextOnly || 'Draft kept text only';
    notice.hidden = false;
  } else {
    notice.hidden = true;
    notice.textContent = '';
  }
}

function clearComposeForm() {
  var ta = $('feed-compose-text');
  if (ta) ta.value = '';
  composeAttachments.forEach(function (a) {
    if (a.previewUrl) try { URL.revokeObjectURL(a.previewUrl); } catch (e) {}
  });
  composeAttachments = [];
  renderComposePreviews();
  setComposeDraftHint(false);
  setComposeDraftNotice(false);
  composeDraftTextOnly = false;
}

function clearComposeDraftStorage() {
  try {
    if (Tapp.storage && typeof Tapp.storage.remove === 'function') {
      Tapp.storage.remove(COMPOSE_DRAFT_KEY).catch(function () {});
    }
  } catch (e) { /* ignore */ }
}

/**
 * Persist draft to Tapp.storage.
 * Files cannot be reliably serialized — save text + fileNames metadata.
 * Same-session attachments stay in memory (composeAttachments).
 */
function saveComposeDraftFromForm() {
  if (!composeHasContent()) {
    clearComposeDraftStorage();
    return;
  }
  var payload = {
    text: getComposeText(),
    savedAt: Date.now(),
    fileNames: composeAttachments.map(function (a) {
      return (a.file && a.file.name) || a.name || '';
    }).filter(Boolean)
  };
  try {
    if (Tapp.storage && typeof Tapp.storage.set === 'function') {
      Tapp.storage.set(COMPOSE_DRAFT_KEY, payload).catch(function () {});
    }
  } catch (e) { /* ignore */ }
}

/**
 * Restore draft from storage when form is empty (e.g. after reload).
 * Session attachments already in memory are kept as-is.
 * @returns {Promise<boolean>} true if anything was restored
 */
async function restoreComposeDraft() {
  var ta = $('feed-compose-text');
  var hasSession = !!(ta && ta.value.trim()) || composeAttachments.length > 0;
  if (hasSession) {
    // Session still has content (dialog closed without clear).
    if (composeHasContent()) setComposeDraftHint(true);
    setComposeDraftNotice(composeDraftTextOnly && !composeAttachments.length);
    return composeHasContent();
  }
  var draft = null;
  try {
    if (Tapp.storage && typeof Tapp.storage.get === 'function') {
      draft = await Tapp.storage.get(COMPOSE_DRAFT_KEY);
    }
  } catch (e) { draft = null; }
  if (!draft || typeof draft !== 'object') return false;
  var text = typeof draft.text === 'string' ? draft.text : '';
  var names = Array.isArray(draft.fileNames) ? draft.fileNames : [];
  if (!text.trim() && !names.length) return false;
  if (ta && text) ta.value = text;
  // File blobs are not durable across reloads; only text is restored.
  composeDraftTextOnly = names.length > 0;
  setComposeDraftHint(true);
  setComposeDraftNotice(composeDraftTextOnly);
  return true;
}

function updateComposeButtonVisibility() {
  updateFeedPlusVisibility();
}

function updateFeedPlusVisibility() {
  var showPost = canComposePost();
  var showFollow = canFollowFromFeed();
  // showPlus = !isGuest && feed && (timeline || following) — equivalent to either action
  var showPlus = showPost || showFollow;
  var display = showPlus ? '' : 'none';

  var wrap = $('feed-plus-wrap');
  if (wrap) wrap.style.display = display;
  var wrapMobile = $('feed-plus-wrap-mobile');
  if (wrapMobile) wrapMobile.style.display = display;

  document.querySelectorAll('[data-feed-plus="post"]').forEach(function (el) {
    if (showPost) el.removeAttribute('hidden');
    else el.setAttribute('hidden', '');
  });
  document.querySelectorAll('[data-feed-plus="follow"]').forEach(function (el) {
    if (showFollow) el.removeAttribute('hidden');
    else el.setAttribute('hidden', '');
  });

  if (!showPlus) closeFeedPlusMenu();
}

function closeFeedPlusMenu() {
  ['feed-plus-menu', 'feed-plus-menu-mobile'].forEach(function (id) {
    var menu = $(id);
    if (!menu || menu.hidden) return;
    menu.classList.remove('open');
    menu.classList.remove('aro-leaving');
    menu.hidden = true;
  });
  ['feed-plus-btn', 'feed-plus-mobile-btn'].forEach(function (id) {
    var btn = $(id);
    if (btn) btn.setAttribute('aria-expanded', 'false');
  });
}

function openFeedPlusMenu(anchorBtn) {
  if (!anchorBtn) return;
  var menuId = anchorBtn.getAttribute('aria-controls') || 'feed-plus-menu';
  var menu = $(menuId);
  if (!menu) return;

  // Close the other instance first
  closeFeedPlusMenu();

  menu.hidden = false;
  menu.classList.remove('aro-leaving');
  menu.classList.add('open');
  anchorBtn.setAttribute('aria-expanded', 'true');

  // Focus first visible item
  var first = menu.querySelector('.feed-plus-item:not([hidden])');
  if (first) {
    try { first.focus(); } catch (e) { /* ignore */ }
  }
}

function toggleFeedPlusMenu(anchorBtn) {
  if (!anchorBtn) return;
  var menuId = anchorBtn.getAttribute('aria-controls') || 'feed-plus-menu';
  var menu = $(menuId);
  if (menu && !menu.hidden && menu.classList.contains('open')) {
    closeFeedPlusMenu();
  } else {
    openFeedPlusMenu(anchorBtn);
  }
}

function handleFeedPlusAction(action) {
  closeFeedPlusMenu();
  if (action === 'post') {
    openComposer();
  } else if (action === 'follow') {
    openFollowDialog();
  }
}

function openFollowDialog() {
  if (!canFollowFromFeed()) return;
  var d = $('feed-follow-dialog');
  if (!d) return;
  d.classList.remove('aro-leaving');
  d.style.display = 'flex';
  var input = $('feed-follow-input');
  if (input) {
    try { input.focus(); } catch (e) { /* ignore */ }
  }
}

function closeFollowDialog() {
  var d = $('feed-follow-dialog');
  if (!d || d.style.display === 'none') return;
  aroDismiss(d, { ms: 160 });
}

function openComposer() {
  if (!canComposePost()) return;
  closeFeedPlusMenu();
  var d = $('feed-compose-dialog');
  if (!d) return;
  // Already open: just refocus, don't re-flash draft hints.
  if (d.style.display !== 'none' && !d.classList.contains('aro-leaving')) {
    var taOpen = $('feed-compose-text');
    if (taOpen) {
      try { taOpen.focus(); } catch (e) { /* ignore */ }
    }
    return;
  }
  d.classList.remove('aro-leaving');
  d.style.display = 'flex';
  // Restore draft (storage or in-session), then focus.
  Promise.resolve(restoreComposeDraft()).then(function () {
    var ta = $('feed-compose-text');
    if (ta) {
      try { ta.focus(); } catch (e) { /* ignore */ }
    }
  }).catch(function () {
    var ta = $('feed-compose-text');
    if (ta) {
      try { ta.focus(); } catch (e) { /* ignore */ }
    }
  });
}

/**
 * Close compose dialog.
 * @param {{ clear?: boolean }} opts  clear=true after successful publish (wipe form + storage).
 *   Default: auto-save draft when there is content (do not silent-drop).
 */
function closeComposer(opts) {
  opts = opts || {};
  if (isComposeBusy() && !opts.clear) return;
  var d = $('feed-compose-dialog');
  if (opts.clear) {
    clearComposeForm();
    clearComposeDraftStorage();
  } else {
    // Auto-save on dismiss when user has typed / attached.
    saveComposeDraftFromForm();
    // Keep form values in DOM for same-session re-open; only hide draft banners.
    setComposeDraftHint(false);
    // Keep text-only notice state for next open if attachments still missing.
  }
  if (!d || d.style.display === 'none') return;
  aroDismiss(d, { ms: 160 });
}

function renderComposePreviews() {
  var box = $('feed-compose-previews');
  if (!box) return;
  if (!composeAttachments.length) {
    box.innerHTML = '';
    return;
  }
  var h = '';
  composeAttachments.forEach(function (a, idx) {
    h += '<div class="feed-compose-preview">';
    if (a.kind === 'video') {
      h += '<video src="' + esc(a.previewUrl) + '" muted></video>';
    } else {
      h += '<img src="' + esc(a.previewUrl) + '" alt="" />';
    }
    h += '<button type="button" class="feed-compose-preview-remove" data-compose-remove="' + idx + '" aria-label="' + esc(lang.remove || 'Remove') + '">&times;</button>';
    h += '</div>';
  });
  box.innerHTML = h;
  box.querySelectorAll('[data-compose-remove]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var i = parseInt(btn.getAttribute('data-compose-remove'), 10);
      if (isNaN(i) || i < 0 || i >= composeAttachments.length) return;
      var removed = composeAttachments.splice(i, 1)[0];
      if (removed && removed.previewUrl) try { URL.revokeObjectURL(removed.previewUrl); } catch (e) {}
      renderComposePreviews();
    });
  });
}

function addComposeFiles(fileList, forceKind) {
  if (!fileList || !fileList.length) return;
  var maxImage = 10 * 1024 * 1024;
  var maxVideo = 50 * 1024 * 1024;
  for (var i = 0; i < fileList.length; i++) {
    if (composeAttachments.length >= 8) break;
    var file = fileList[i];
    var mime = (file.type || '').toLowerCase();
    var kind = forceKind || (mime.indexOf('video/') === 0 ? 'video' : 'image');
    if (kind === 'image' && mime && mime.indexOf('image/') !== 0) {
      notifyError(lang.mediaUnsupported || 'Unsupported');
      continue;
    }
    if (kind === 'video' && mime && mime.indexOf('video/') !== 0) {
      notifyError(lang.mediaUnsupported || 'Unsupported');
      continue;
    }
    var max = kind === 'video' ? maxVideo : maxImage;
    if (file.size > max) {
      notifyError(lang.mediaTooLarge || lang.fileTooLarge || 'Too large');
      continue;
    }
    composeAttachments.push({
      file: file,
      previewUrl: URL.createObjectURL(file),
      kind: kind
    });
  }
  renderComposePreviews();
}

function fileToDataUrl(file) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onload = function () { resolve(reader.result); };
    reader.onerror = function () { reject(new Error('read failed')); };
    reader.readAsDataURL(file);
  });
}

/**
 * Client-side check mirroring host/backend media URL shape.
 * Path: /media/federation/{userId}/{filename} with safe single-segment name.
 */
function isValidFederationMediaUrl(url) {
  if (!url || typeof url !== 'string') return false;
  var trimmed = url.trim();
  if (!trimmed) return false;
  // Reject before URL() normalizes ".." away
  if (trimmed.indexOf('..') >= 0) return false;
  try {
    var u = new URL(trimmed);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    if (u.pathname.indexOf('..') >= 0) return false;
    var m = u.pathname.match(/^\\/media\\/federation\\/(\\d+)\\/([A-Za-z0-9._-]+)$/);
    return !!(m && m[1] && m[2]);
  } catch (e) {
    return false;
  }
}

function unwrapUploadMediaResult(res) {
  if (!res) return null;
  // Bridge may return { url } or nested { data: { url } }
  if (res.url) return res;
  if (res.data && res.data.url) return res.data;
  return res;
}

function unwrapPublishResult(res) {
  if (!res) return null;
  if (res.activity_id || res.content_id || typeof res.delivered_queued === 'number') return res;
  if (res.data && (res.data.activity_id || res.data.content_id)) return res.data;
  return res;
}

async function uploadComposeMedia(entry) {
  var file = entry.file;
  // Re-check raw size before data-URL conversion (aligns with backend limits).
  var maxImage = 10 * 1024 * 1024;
  var maxVideo = 50 * 1024 * 1024;
  var kind = entry.kind === 'video' ? 'video' : 'image';
  var maxBytes = kind === 'video' ? maxVideo : maxImage;
  if (file && typeof file.size === 'number' && file.size > maxBytes) {
    throw new Error(lang.mediaTooLarge || lang.fileTooLarge || 'File too large');
  }
  if (typeof Tapp.federation.uploadMedia === 'function') {
    var dataUrl = await fileToDataUrl(file);
    var res = await Tapp.federation.uploadMedia({
      data: dataUrl,
      name: file.name || 'upload.bin',
      mime: file.type || (entry.kind === 'video' ? 'video/mp4' : 'image/jpeg')
    });
    var uploaded = unwrapUploadMediaResult(res);
    if (!uploaded || !isValidFederationMediaUrl(uploaded.url)) {
      console.error('[Aro] uploadMedia returned invalid URL', res);
      throw new Error(lang.composeBadMediaUrl || 'Invalid media URL after upload');
    }
    return uploaded;
  }
  // Fallback: publish path unavailable
  console.error('[Aro] uploadMedia not available on Tapp.federation');
  throw new Error('uploadMedia not available');
}

/**
 * Soft-check that the published note (and media) appears on timeline/published.
 * Non-blocking: only warns via toast/console; never fails the publish UX.
 */
function softVerifyPublishedNote(publishRes, expectedAttachments) {
  var contentId = publishRes && (publishRes.content_id || publishRes.contentId);
  var activityId = publishRes && (publishRes.activity_id || publishRes.activityId);
  if (!contentId && !activityId) return;

  var attempts = 0;
  var maxAttempts = 4;
  var delayMs = 700;
  var wantMedia = !!(expectedAttachments && expectedAttachments.length);

  function noteMatches(item) {
    if (!item) return false;
    var cj = item.content_json || item.content || {};
    var cid = (cj['mfp:contentId'] || cj.content_id || item.content_id || '');
    var aid = item.activity_id || (cj.id) || '';
    if (contentId && String(cid) === String(contentId)) return true;
    if (activityId && String(aid).indexOf(String(activityId)) >= 0) return true;
    if (activityId && String(item.activity_id || '') === String(activityId)) return true;
    return false;
  }

  function itemHasMedia(item) {
    var atts = extractNoteAttachments(item.content_json || item.content || null);
    return atts && atts.length > 0 && atts.every(function (a) { return a && a.url; });
  }

  function tick() {
    attempts += 1;
    Promise.all([
      (typeof Tapp.federation.getTimeline === 'function'
        ? Tapp.federation.getTimeline().catch(function (e) {
            console.warn('[Aro] soft-verify getTimeline', e);
            return null;
          })
        : Promise.resolve(null)),
      (typeof Tapp.federation.getPublished === 'function'
        ? Tapp.federation.getPublished().catch(function (e) {
            console.warn('[Aro] soft-verify getPublished', e);
            return null;
          })
        : Promise.resolve(null))
    ]).then(function (pair) {
      var timelineItems = (pair[0] && pair[0].items) || [];
      var publishedItems = (pair[1] && pair[1].items) || [];
      var found =
        timelineItems.find(noteMatches) ||
        publishedItems.find(noteMatches) ||
        null;

      if (found) {
        if (wantMedia && !itemHasMedia(found)) {
          console.warn('[Aro] soft-verify: note found but attachments missing on feed', found);
          try {
            Tapp.ui.showNotification({
              title: lang.composeMediaMissingOnFeed || lang.composeTimelineMissing || 'Media missing',
              type: 'warning'
            });
          } catch (e2) {}
        }
        return;
      }

      if (attempts < maxAttempts) {
        setTimeout(tick, delayMs);
        return;
      }

      console.warn('[Aro] soft-verify: published note not on timeline/published within timeout', {
        contentId: contentId,
        activityId: activityId
      });
      try {
        Tapp.ui.showNotification({
          title: lang.composeTimelineMissing || 'Not on timeline yet',
          type: 'warning'
        });
      } catch (e3) {}
    }).catch(function (e) {
      console.warn('[Aro] soft-verify failed', e);
    });
  }

  setTimeout(tick, delayMs);
}

async function publishComposeNote() {
  if (state.isGuest) return;
  var ta = $('feed-compose-text');
  var text = ta ? ta.value.trim() : '';
  if (!text && !composeAttachments.length) {
    notifyError(lang.composeEmpty || 'Empty');
    return;
  }
  var publishBtn = $('feed-compose-publish');
  var cancelBtn = $('feed-compose-cancel');
  var setBusy = function (busy) {
    if (publishBtn) {
      publishBtn.disabled = busy;
      publishBtn.textContent = busy
        ? (lang.composePublishing || '…')
        : (lang.composePublish || 'Publish');
    }
    if (cancelBtn) cancelBtn.disabled = busy;
  };
  setBusy(true);
  try {
    var attachments = [];
    var uploadedCount = 0;
    for (var i = 0; i < composeAttachments.length; i++) {
      if (publishBtn) publishBtn.textContent = lang.composeUploading || '…';
      try {
        var uploaded = await uploadComposeMedia(composeAttachments[i]);
      } catch (upErr) {
        console.error('[Aro] media upload failed at index', i, upErr);
        if (uploadedCount > 0) {
          notifyError(lang.composeUploadPartial || lang.composeUploadFail || lang.composeFail || 'Fail', upErr);
        } else {
          notifyError(lang.composeUploadFail || lang.composeFail || 'Fail', upErr);
        }
        // Do not half-publish: abort without createNote.
        return;
      }
      if (!isValidFederationMediaUrl(uploaded.url)) {
        console.error('[Aro] rejecting bad attachment URL before createNote', uploaded);
        notifyError(lang.composeBadMediaUrl || lang.composeFail || 'Bad URL');
        return;
      }
      attachments.push({
        url: uploaded.url,
        media_type: uploaded.media_type || uploaded.mediaType || composeAttachments[i].file.type,
        name: uploaded.name || composeAttachments[i].file.name
      });
      uploadedCount += 1;
    }
    if (publishBtn) publishBtn.textContent = lang.composePublishing || '…';
    var rawPublish;
    if (typeof Tapp.federation.createNote === 'function') {
      rawPublish = await Tapp.federation.createNote({
        text: text,
        attachments: attachments,
        visibility: 'public'
      });
    } else if (typeof Tapp.federation.publish === 'function') {
      rawPublish = await Tapp.federation.publish({
        content_type: 'note',
        text: text,
        attachments: attachments,
        visibility: 'public'
      });
    } else {
      console.error('[Aro] createNote/publish not available');
      throw new Error('createNote not available');
    }
    var publishRes = unwrapPublishResult(rawPublish);
    if (publishRes && publishRes.success === false) {
      console.error('[Aro] publish response success=false', publishRes);
      throw new Error(publishRes.error || lang.composeFail || 'Publish failed');
    }

    // Success: wipe draft + form (do not re-save published content).
    closeComposer({ clear: true });
    var successTitle = attachments.length > 0
      ? (lang.composeSuccessMedia || lang.composeSuccess || 'OK')
      : (lang.composeSuccess || 'OK');
    var successMsg;
    var queued = publishRes && (publishRes.delivered_queued != null
      ? publishRes.delivered_queued
      : publishRes.deliveredQueued);
    if (typeof queued === 'number' && queued > 0) {
      successMsg = String(lang.composeDeliveryQueued || 'Delivering to {n} followers')
        .replace('{n}', String(queued));
    }
    try {
      Tapp.ui.showNotification({
        title: successTitle,
        message: successMsg || undefined,
        type: 'success'
      });
    } catch (e2) {}

    // Force reload author timeline + published so the new note is visible.
    state.feedLoaded.timeline = false;
    state.feedLoaded.published = false;
    if (state.feedSubTab !== 'timeline') {
      switchFeedSubTab('timeline');
    } else {
      loadFeedSubTab();
    }
    updateFeedProfileHeader();

    // Non-blocking soft verify (timeline/media presence).
    softVerifyPublishedNote(publishRes, attachments);
  } catch (e) {
    console.error('[Aro] publishComposeNote failed', e);
    notifyError(lang.composeFail || lang.unpublishFail || 'Fail', e);
  } finally {
    setBusy(false);
  }
}

async function doUnfollow(actorUrl) {
  try {
    await Tapp.federation.unfollow(actorUrl);
    loadFeedSubTab();
    updateFeedProfileHeader();
  } catch (e) {
    notifyError(lang.unfollowFail, e);
  }
}

async function doUnpublish(contentType, contentId) {
  try {
    await Tapp.federation.unpublish({ content_type: contentType, content_id: contentId });
    loadFeedSubTab();
    updateFeedProfileHeader();
  } catch (e) {
    notifyError(lang.unpublishFail, e);
  }
}

// ==================== Rings View ====================
async function loadRings() {
  try {
    var res = await Tapp.federation.getRings();
    state.rings = (res && res.rings) || [];
    state.activeRingId = null;
    renderRingsSidebar();
    hideRingDetail();
  } catch (e) { console.error('[Aro] loadRings error:', e); }
}

function renderRingsSidebar() {
  var list = $('ring-list');
  if (!list) return;
  if (state.rings.length === 0) {
    list.innerHTML = '<div class="conv-empty conv-empty-fill"><span id="ring-empty-text">'
      + esc(lang.emptyRings || 'No rings yet')
      + '<br><span style="font-size:11px;opacity:.75">' + esc(lang.createRingTitle || '') + '</span></span></div>';
    return;
  }
  var q = normalizeSearchQuery((state.search && state.search.ring) || '');
  var rings = !q ? state.rings : state.rings.filter(function (ring) {
    return matchesSearch(q, [
      ring.ring_name,
      ring.ring_id,
      ring.ring_type,
      ringTypeLabel(ring.ring_type),
    ]);
  });
  if (rings.length === 0) {
    list.innerHTML = searchNoResultsHtml();
    return;
  }
  var typeIcons = { 'brew-recommend': SVG_ICONS.coffee, 'tapp-store': SVG_ICONS.puzzle, 'library-exchange': SVG_ICONS.library, 'instance-directory': SVG_ICONS.globe };
  var html = '';
  rings.forEach(function (ring) {
    var icon = typeIcons[ring.ring_type] || SVG_ICONS.ring;
    var name = ring.ring_name || ring.ring_id;
    var peerText = (ring.peer_count || 0) + ' ' + lang.peers;
    var activeClass = state.activeRingId === ring.ring_id ? ' conv-active' : '';
    html += '<button class="conv-item' + activeClass + '" data-ring-id="' + esc(ring.ring_id) + '">'
      + '<span class="conv-accent" aria-hidden="true"></span>'
      + '<div class="conv-avatar avatar-room" style="border-radius:12px;font-size:16px">' + icon + '</div>'
      + '<div class="conv-info">'
      + '<div class="conv-top"><span class="conv-name">' + esc(name) + '</span></div>'
      + '<div class="conv-bottom"><span class="conv-preview">' + esc(ringTypeLabel(ring.ring_type)) + ' · ' + esc(peerText) + '</span></div>'
      + '</div>'
      + '</button>';
  });
  list.innerHTML = html;
  list.querySelectorAll('.conv-item').forEach(function (btn) {
    btn.addEventListener('click', function () {
      openRingDetail(btn.dataset.ringId);
    });
  });
}

function updateRingCreateCategoryVisibility() {
  var type = ($('ring-type-select') || {}).value || 'brew-recommend';
  var wrap = $('ring-brew-category-wrap');
  if (!wrap) return;
  if (type === 'brew-recommend') {
    wrap.style.display = 'flex';
    loadBrewCategoriesForRingCreate();
  } else {
    wrap.style.display = 'none';
  }
}

function loadBrewCategoriesForRingCreate() {
  var select = $('ring-brew-category-select');
  var freeText = $('ring-brew-category-input');
  if (!select) return;
  // Keep the "all" option; rebuild the rest
  var allLabel = (lang.ringBrewCategoryAll || 'All my categories');
  select.innerHTML = '<option id="ring-brew-category-all" value="">' + esc(allLabel) + '</option>';
  if (freeText) {
    freeText.value = '';
    freeText.style.display = 'none';
  }
  if (typeof Tapp === 'undefined' || !Tapp.brewList || typeof Tapp.brewList.categories !== 'function') {
    // Fallback: free-text only
    if (freeText) freeText.style.display = '';
    select.style.display = 'none';
    return;
  }
  select.style.display = '';
  Tapp.brewList.categories().then(function (cats) {
    var list = Array.isArray(cats) ? cats : (cats && cats.categories) || [];
    list.forEach(function (c) {
      var name = (c && (c.name || c)) || '';
      if (!name) return;
      var opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      select.appendChild(opt);
    });
    // If no categories from API, allow free-text
    if (list.length === 0 && freeText) {
      freeText.style.display = '';
    }
  }).catch(function () {
    if (freeText) freeText.style.display = '';
    select.style.display = 'none';
  });
}

async function doCreateRing() {
  if (!requireAdminAction()) return;
  var input = $('ring-name-input');
  var btn = $('create-ring-btn');
  if (!input) return;
  var name = input.value.trim();
  if (!name) return;
  var type = ($('ring-type-select') || {}).value || 'brew-recommend';
  var req = { name: name, ring_type: type };
  if (type === 'brew-recommend') {
    var catSelect = $('ring-brew-category-select');
    var catInput = $('ring-brew-category-input');
    var cat = '';
    if (catSelect && catSelect.style.display !== 'none') {
      cat = (catSelect.value || '').trim();
    }
    if (!cat && catInput && catInput.style.display !== 'none') {
      cat = (catInput.value || '').trim();
    }
    if (cat) req.category = cat;
  }
  if (btn) { btn.disabled = true; btn.textContent = lang.creating; }
  try {
    await Tapp.federation.createRing(req);
    input.value = '';
    var catSel = $('ring-brew-category-select');
    if (catSel) catSel.value = '';
    var catIn = $('ring-brew-category-input');
    if (catIn) catIn.value = '';
    var d = $('ring-create-dialog');
    if (d) aroDismiss(d, { ms: 170 });
    loadRings();
  } catch (e) {
    notifyError(lang.createRingFail, e);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = lang.createRingBtn; }
  }
}

async function doLeaveRing(ringId) {
  if (!requireAdminAction()) return;
  try {
    await Tapp.federation.leaveRing(ringId);
    hideRingDetail();
    loadRings();
  } catch (e) {
    notifyError(lang.leaveRingFail, e);
  }
}

/** Copy the active ring's id for sharing with another instance. */
async function copyRingId() {
  var ring = state.ringDetail;
  var ringId = (ring && ring.ring_id) || state.activeRingId || '';
  if (!ringId) {
    try { Tapp.ui.showNotification({ title: lang.copyFail, type: 'error' }); } catch (e0) {}
    return;
  }
  var ok = await copyTextToClipboard(ringId, { silent: true });
  try {
    Tapp.ui.showNotification({
      title: ok ? (lang.ringIdCopied || lang.copied) : lang.copyFail,
      message: ok ? ringId : undefined,
      type: ok ? 'success' : 'error',
    });
  } catch (e1) {}
}

// ==================== Ring Detail (inline panel) ====================
function openRingDetail(ringId) {
  state.activeRingId = ringId;
  state.ringDetail = null;
  state.ringPeers = [];
  // Update sidebar active
  var list = $('ring-list');
  if (list) list.querySelectorAll('.conv-item').forEach(function (btn) {
    btn.classList.toggle('conv-active', btn.dataset.ringId === ringId);
  });
  // Show detail panel
  $('ring-empty-state').style.display = 'none';
  var detail = $('ring-detail');
  if (detail) {
    detail.style.display = '';
    aroPlayEnter(detail, 'aro-panel-enter');
  }
  // Optimistic ring_id fill (full detail arrives from loadRingDetail)
  var idLabelEl = $('ring-id-label');
  if (idLabelEl) idLabelEl.textContent = lang.ringId || 'Ring ID';
  var idValueEl = $('ring-id-value');
  if (idValueEl) {
    idValueEl.textContent = ringId || '';
    idValueEl.setAttribute('title', ringId || '');
  }
  var idCopyBtn = $('ring-id-copy');
  if (idCopyBtn) {
    idCopyBtn.disabled = !ringId;
    idCopyBtn.setAttribute('title', lang.copy || 'Copy');
  }
  // Mobile
  $('ring-sidebar').classList.add('sidebar-hidden-mobile');
  var main = detail ? detail.closest('.panel-main') : null;
  if (main) {
    main.classList.add('panel-main-show-mobile');
    aroPlayEnter(main, 'aro-panel-enter');
  }
  loadRingDetail(ringId);
}

function hideRingDetail() {
  state.activeRingId = null;
  state.ringDetail = null;
  state.ringPeers = [];
  var detail = $('ring-detail');
  if (detail) {
    detail.style.display = 'none';
    detail.classList.remove('aro-panel-enter');
  }
  var empty = $('ring-empty-state');
  if (empty) {
    empty.style.display = '';
    aroPlayEnter(empty, 'aro-panel-enter');
  }
  var sidebar = $('ring-sidebar');
  if (sidebar) {
    sidebar.classList.remove('sidebar-hidden-mobile');
    aroPlayEnter(sidebar, 'aro-panel-enter');
  }
  var main = detail ? detail.closest('.panel-main') : null;
  if (main) main.classList.remove('panel-main-show-mobile');
}

async function loadRingDetail(ringId) {
  try {
    var results = await Promise.all([
      Tapp.federation.getRing(ringId),
      Tapp.federation.getRingPeers(ringId)
    ]);
    if (state.activeRingId !== ringId) return; // user closed
    state.ringDetail = results[0];
    state.ringPeers = (results[1] && results[1].peers) || [];
    renderRingDetail();
  } catch (e) {
    console.error('[Aro] loadRingDetail error:', e);
  }
}

function renderRingDetail() {
  var ring = state.ringDetail;
  if (!ring) return;
  var typeIcons = { 'brew-recommend': SVG_ICONS.coffee, 'tapp-store': SVG_ICONS.puzzle, 'library-exchange': SVG_ICONS.library, 'instance-directory': SVG_ICONS.globe };
  var iconEl = $('ring-detail-icon');
  if (iconEl) iconEl.innerHTML = typeIcons[ring.ring_type] || SVG_ICONS.ring;
  var nameEl = $('ring-detail-name');
  // Prefer display name; ring_id is always shown separately in the id bar
  if (nameEl) nameEl.textContent = ring.ring_name || ring.ring_id;
  var metaEl = $('ring-detail-meta');
  if (metaEl) {
    var parts = [];
    parts.push('<span class="meta-badge">' + esc(ringTypeLabel(ring.ring_type)) + '</span>');
    parts.push('<span class="meta-badge">' + esc(state.ringPeers.length + ' ' + lang.peers) + '</span>');
    var ringCat = ring.gossip_config && (ring.gossip_config.category || ring.gossip_config.brew_category);
    if (ringCat) {
      parts.push('<span class="meta-badge">' + esc(String(ringCat)) + '</span>');
    }
    if (ring.last_sync_at) {
      try { parts.push('<span class="meta-badge">' + esc(timeAgo(ring.last_sync_at)) + '</span>'); } catch (e) {}
    }
    metaEl.innerHTML = parts.join('');
  }

  // Always show ring_id (separate from title) for cross-instance sharing
  var ringId = ring.ring_id || state.activeRingId || '';
  var idLabelEl = $('ring-id-label');
  if (idLabelEl) idLabelEl.textContent = lang.ringId || 'Ring ID';
  var idValueEl = $('ring-id-value');
  if (idValueEl) {
    idValueEl.textContent = ringId;
    idValueEl.setAttribute('title', ringId);
  }
  var idCopyBtn = $('ring-id-copy');
  if (idCopyBtn) {
    idCopyBtn.disabled = !ringId;
    idCopyBtn.setAttribute('title', lang.copy || 'Copy');
    idCopyBtn.setAttribute('aria-label', (lang.copy || 'Copy') + ' ' + (lang.ringId || 'Ring ID'));
  }

  // Sync / leave labels
  var syncLabel = $('ring-sync-label');
  if (syncLabel) syncLabel.textContent = lang.syncBtn;
  var leaveLabel = $('ring-leave-label');
  if (leaveLabel) leaveLabel.textContent = lang.leaveBtn;

  // Peer input
  var peerInput = $('ring-peer-input');
  if (peerInput) peerInput.placeholder = lang.addPeerPlaceholder;
  var addPeerBtn = $('ring-add-peer-btn');
  if (addPeerBtn) addPeerBtn.textContent = lang.addPeerBtn;
  applyAdminControls();

  // Render peers as member-item style
  var peersList = $('ring-peers-list');
  var peersEmpty = $('ring-peers-empty');
  if (!peersList) return;

  if (state.ringPeers.length === 0) {
    peersList.innerHTML = '';
    if (peersEmpty) { peersEmpty.style.display = ''; peersEmpty.querySelector('span').textContent = lang.emptyPeers; }
    return;
  }
  if (peersEmpty) peersEmpty.style.display = 'none';

  var html = '';
  state.ringPeers.forEach(function (peer) {
    var url = peer.actor_url || peer.peer_url || peer.url || peer;
    var urlStr = typeof url === 'string' ? url : JSON.stringify(url);
    var initial = SVG_ICONS.globe;
    html += '<div class="member-item">'
      + '<div class="member-avatar" style="border-radius:6px;font-size:12px">' + initial + '</div>'
      + '<div class="member-info">'
      + '<div class="member-name">' + esc(urlStr) + '</div>'
      + '</div>'
      + (state.isAdmin ? '<button class="member-kick ring-peer-remove-btn" data-peer-url="' + esc(typeof url === 'string' ? url : '') + '" title="Remove">'
      + '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>'
      + '</button>' : '')
      + '</div>';
  });
  peersList.innerHTML = html;
  applyAdminControls();

  peersList.querySelectorAll('.ring-peer-remove-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      doRemovePeer(btn.dataset.peerUrl);
    });
  });
}

async function doAddPeer() {
  if (!requireAdminAction()) return;
  var input = $('ring-peer-input');
  var btn = $('ring-add-peer-btn');
  if (!input || !state.activeRingId) return;
  var peerUrl = input.value.trim();
  if (!peerUrl) return;
  if (btn) btn.disabled = true;
  try {
    await Tapp.federation.addPeer(state.activeRingId, { peer: peerUrl });
    input.value = '';
    loadRingDetail(state.activeRingId);
  } catch (e) {
    notifyError(lang.addPeerFail, e);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function doRemovePeer(peerUrl) {
  if (!requireAdminAction()) return;
  if (!state.activeRingId || !peerUrl) return;
  try {
    await Tapp.federation.removePeer(state.activeRingId, peerUrl);
    loadRingDetail(state.activeRingId);
  } catch (e) {
    notifyError(lang.removePeerFail, e);
  }
}

async function doTriggerSync() {
  if (!requireAdminAction()) return;
  if (!state.activeRingId) return;
  var btn = $('ring-sync-btn');
  var statusEl = $('ring-sync-status');
  if (btn) btn.disabled = true;
  if (statusEl) { statusEl.style.display = ''; statusEl.className = 'ring-sync-bar'; statusEl.textContent = lang.syncing; }
  try {
    await Tapp.federation.triggerSync(state.activeRingId);
    if (statusEl) { statusEl.className = 'ring-sync-bar ring-sync-ok'; statusEl.textContent = lang.syncSuccess; }
    // Refresh detail after sync
    loadRingDetail(state.activeRingId);
  } catch (e) {
    if (statusEl) { statusEl.className = 'ring-sync-bar ring-sync-err'; statusEl.textContent = lang.syncFail + errorSuffix(e); }
  } finally {
    if (btn) btn.disabled = false;
    // Auto-hide status after 3s
    setTimeout(function () {
      if (statusEl) statusEl.style.display = 'none';
    }, 3000);
  }
}

// ==================== Event Binding ====================
function bindEvents() {
  // Aro nav
  document.querySelectorAll('.aro-nav-item').forEach(function (btn) {
    btn.addEventListener('click', function () { switchView(btn.dataset.view); });
  });

  // Ring create dialog
  var ringCreateOpenBtn = $('ring-create-open-btn');
  if (ringCreateOpenBtn) ringCreateOpenBtn.addEventListener('click', function () {
    if (!requireAdminAction()) return;
`

const PAGE_MOD_EVENTS = `\
    var d = $('ring-create-dialog');
    if (d) {
      d.classList.remove('aro-leaving');
      d.style.display = 'flex';
    }
    if (typeof updateRingCreateCategoryVisibility === 'function') updateRingCreateCategoryVisibility();
  });
  var ringTypeSelect = $('ring-type-select');
  if (ringTypeSelect) ringTypeSelect.addEventListener('change', function () {
    if (typeof updateRingCreateCategoryVisibility === 'function') updateRingCreateCategoryVisibility();
  });
  var ringCreateClose = $('ring-create-close');
  if (ringCreateClose) ringCreateClose.addEventListener('click', function () {
    var d = $('ring-create-dialog');
    if (d) aroDismiss(d, { ms: 170 });
  });
  var ringCreateOverlay = $('ring-create-dialog');
  if (ringCreateOverlay) ringCreateOverlay.addEventListener('click', function (e) {
    if (e.target === ringCreateOverlay) aroDismiss(ringCreateOverlay, { ms: 170 });
  });

  // Ring create submit
  var createRingBtn = $('create-ring-btn');
  if (createRingBtn) createRingBtn.addEventListener('click', doCreateRing);
  var ringNameInput = $('ring-name-input');
  if (ringNameInput) ringNameInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); doCreateRing(); }
  });

  // Ring detail inline panel events
  var ringBackBtn = $('ring-back-btn');
  if (ringBackBtn) ringBackBtn.addEventListener('click', hideRingDetail);
  var ringIdCopyBtn = $('ring-id-copy');
  if (ringIdCopyBtn) ringIdCopyBtn.addEventListener('click', copyRingId);
  var ringSyncBtn = $('ring-sync-btn');
  if (ringSyncBtn) ringSyncBtn.addEventListener('click', doTriggerSync);
  var ringManageBtn = $('ring-manage-btn');
  if (ringManageBtn) ringManageBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    var dd = $('ring-manage-dropdown');
    if (dd) dd.classList.toggle('open');
  });
  var ringLeaveBtn2 = $('ring-leave-btn');
  if (ringLeaveBtn2) ringLeaveBtn2.addEventListener('click', async function () {
    var dd = $('ring-manage-dropdown'); if (dd) dd.classList.remove('open');
    if (state.activeRingId && (await aroConfirm(lang.leaveRingConfirm, true))) {
      doLeaveRing(state.activeRingId);
    }
  });
  // Close ring manage menu on outside click
  document.addEventListener('click', function (e) {
    var dd = $('ring-manage-dropdown');
    if (!dd || !dd.classList.contains('open')) return;
    var wrap = dd.closest('.manage-wrap') || dd.parentElement;
    if (wrap && wrap.contains(e.target)) return;
    dd.classList.remove('open');
  });
  var ringAddPeerBtn = $('ring-add-peer-btn');
  if (ringAddPeerBtn) ringAddPeerBtn.addEventListener('click', doAddPeer);
  var ringPeerInput = $('ring-peer-input');
  if (ringPeerInput) ringPeerInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); doAddPeer(); }
  });

  // Feed: refresh, tabs, follow, stat clicks
  var refreshFeedBtn = $('refresh-feed-btn');
  if (refreshFeedBtn) refreshFeedBtn.addEventListener('click', function () { loadFeed(); });
  var refreshFeedMobileBtn = $('refresh-feed-mobile-btn');
  if (refreshFeedMobileBtn) refreshFeedMobileBtn.addEventListener('click', function () { loadFeed(); });
  document.querySelectorAll('.feed-nav-item').forEach(function (btn) {
    btn.addEventListener('click', function () { switchFeedSubTab(btn.dataset.sub); });
  });
  document.querySelectorAll('.feed-mobile-tab').forEach(function (btn) {
    btn.addEventListener('click', function () { switchFeedSubTab(btn.dataset.sub); });
  });
  var feedFollowBtn = $('feed-follow-btn');
  if (feedFollowBtn) feedFollowBtn.addEventListener('click', doFollow);
  var feedFollowInput = $('feed-follow-input');
  if (feedFollowInput) feedFollowInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); doFollow(); }
  });
  var feedFollowClose = $('feed-follow-dialog-close');
  if (feedFollowClose) feedFollowClose.addEventListener('click', closeFollowDialog);
  var feedFollowOverlay = $('feed-follow-dialog');
  if (feedFollowOverlay) feedFollowOverlay.addEventListener('click', function (e) {
    if (e.target === feedFollowOverlay) closeFollowDialog();
  });

  // Unified feed + menu (Post / Follow)
  function onFeedPlusClick(e) {
    e.stopPropagation();
    toggleFeedPlusMenu(e.currentTarget);
  }
  var feedPlusBtn = $('feed-plus-btn');
  if (feedPlusBtn) feedPlusBtn.addEventListener('click', onFeedPlusClick);
  var feedPlusMobileBtn = $('feed-plus-mobile-btn');
  if (feedPlusMobileBtn) feedPlusMobileBtn.addEventListener('click', onFeedPlusClick);
  document.querySelectorAll('[data-feed-plus]').forEach(function (item) {
    item.addEventListener('click', function (e) {
      e.stopPropagation();
      handleFeedPlusAction(item.getAttribute('data-feed-plus'));
    });
  });
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (t && (t.closest('#feed-plus-wrap') || t.closest('#feed-plus-wrap-mobile'))) return;
    closeFeedPlusMenu();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var menuOpen = document.querySelector('.feed-plus-menu.open');
    if (menuOpen) {
      e.preventDefault();
      closeFeedPlusMenu();
      return;
    }
    var composeDlg = $('feed-compose-dialog');
    if (composeDlg && composeDlg.style.display !== 'none') {
      e.preventDefault();
      closeComposer();
      return;
    }
    var followDlg = $('feed-follow-dialog');
    if (followDlg && followDlg.style.display !== 'none') {
      e.preventDefault();
      closeFollowDialog();
    }
  });

  // Feed freeform note composer (modal)
  var composeCancel = $('feed-compose-cancel');
  if (composeCancel) composeCancel.addEventListener('click', function () { closeComposer(); });
  var composeDialogClose = $('feed-compose-dialog-close');
  if (composeDialogClose) composeDialogClose.addEventListener('click', function () { closeComposer(); });
  var composeOverlay = $('feed-compose-dialog');
  if (composeOverlay) composeOverlay.addEventListener('click', function (e) {
    if (e.target === composeOverlay) closeComposer();
  });
  var composePublish = $('feed-compose-publish');
  if (composePublish) composePublish.addEventListener('click', publishComposeNote);
  var composeImageBtn = $('feed-compose-image-btn');
  var composeImageInput = $('feed-compose-image-input');
  if (composeImageBtn && composeImageInput) {
    composeImageBtn.addEventListener('click', function () { composeImageInput.click(); });
    composeImageInput.addEventListener('change', function () {
      addComposeFiles(composeImageInput.files, 'image');
      composeImageInput.value = '';
      // New attach clears "text-only draft" notice for this session.
      if (composeAttachments.length) {
        composeDraftTextOnly = false;
        setComposeDraftNotice(false);
      }
    });
  }
  var composeVideoBtn = $('feed-compose-video-btn');
  var composeVideoInput = $('feed-compose-video-input');
  if (composeVideoBtn && composeVideoInput) {
    composeVideoBtn.addEventListener('click', function () { composeVideoInput.click(); });
    composeVideoInput.addEventListener('change', function () {
      addComposeFiles(composeVideoInput.files, 'video');
      composeVideoInput.value = '';
      if (composeAttachments.length) {
        composeDraftTextOnly = false;
        setComposeDraftNotice(false);
      }
    });
  }
  document.querySelectorAll('[data-fed-toggle]').forEach(function (summary) {
    summary.addEventListener('click', function (e) {
      if (e.target && (e.target.closest('[data-copy-fed]') || e.target.closest('[data-fed-toggle-button]'))) return;
      toggleFeedProfileSummary(summary.closest('[data-fed-profile]'));
    });
    summary.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleFeedProfileSummary(summary.closest('[data-fed-profile]'));
      }
    });
  });
  document.querySelectorAll('[data-fed-toggle-button]').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      toggleFeedProfileDetails(btn.closest('[data-fed-profile]'));
    });
  });
  document.querySelectorAll('[data-copy-fed]').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      copyFederationIdentity(btn.dataset.copyFed);
    });
  });
  document.addEventListener('click', function (e) {
    if (e.target && e.target.closest('[data-fed-profile]')) return;
    closeFeedProfilePopovers();
  });
  window.addEventListener('resize', function () { closeFeedProfilePopovers(); });

  // Messenger events
  var sendBtn = $('send-btn');
  if (sendBtn) sendBtn.addEventListener('click', doSend);

  var attachBtn = $('attach-btn');
  if (attachBtn) attachBtn.addEventListener('click', function (e) { e.stopPropagation(); toggleAttachMenu(); });

  var attachImageInput = $('attach-image-input');
  if (attachImageInput) attachImageInput.addEventListener('change', function () { if (this.files[0]) handleFileSelect(this.files[0], 'image'); });

  var attachFileInput = $('attach-file-input');
  if (attachFileInput) attachFileInput.addEventListener('change', function () { if (this.files[0]) handleFileSelect(this.files[0]); });

  var input = $('msg-input');
  if (input) {
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
    });
    input.addEventListener('input', function () {
      autoResizeInput(this);
      updateSendState();
    });
  }
  updateSendState();

  var backBtn = $('back-btn');
  if (backBtn) {
    backBtn.addEventListener('click', function () {
      var sidebar = $('sidebar');
      var chat = $('chat-container');
      var members = $('member-panel');
      var empty = $('empty-state');
      if (sidebar) {
        sidebar.classList.remove('sidebar-hidden-mobile');
        aroPlayEnter(sidebar, 'aro-panel-enter');
      }
      if (chat) {
        chat.style.display = 'none';
        chat.classList.remove('aro-panel-enter');
      }
      if (members) {
        members.style.display = 'none';
        members.classList.remove('member-open-mobile');
        members.classList.remove('member-expanded-tablet');
      }
      if (empty) {
        empty.style.display = '';
        aroPlayEnter(empty, 'aro-panel-enter');
      }
      clearPendingAttach();
      closeAttachMenu();
      if (typeof clearQuote === 'function') clearQuote();
      closeMsgMenu();
      stopPolling();
      unsubscribeRealtime();
      state.activeKind = null;
      state.activeId = null;
      state.messages = [];
      state.messagesFp = '';
      state.skipMsgAppear = false;
      state.channelDetail = null;
      state.roomDetail = null;
      state.members = [];
      renderConvList();
      updateSendState();
    });
  }

  var memberBackBtn = $('member-back-btn');
  if (memberBackBtn) {
    memberBackBtn.addEventListener('click', function () {
      closeMemberPanel();
    });
  }

  // Create dialog events
  var createBtn = $('create-btn');
  if (createBtn) createBtn.addEventListener('click', showCreateDialog);

  var overlay = $('create-dialog');
  if (overlay) overlay.addEventListener('click', function (e) {
    if (e.target === overlay) hideCreateDialog();
  });

  var closeDialogBtn = $('create-dialog-close');
  if (closeDialogBtn) closeDialogBtn.addEventListener('click', hideCreateDialog);

  var tabChannel = $('create-tab-channel');
  if (tabChannel) tabChannel.addEventListener('click', function () { switchCreateTab('channel'); });

  var tabRoom = $('create-tab-room');
  if (tabRoom) tabRoom.addEventListener('click', function () { switchCreateTab('room'); });

  var createChannelBtn = $('create-channel-btn');
  if (createChannelBtn) createChannelBtn.addEventListener('click', doCreateChannel);

  var createRoomBtn = $('create-room-btn');
  if (createRoomBtn) createRoomBtn.addEventListener('click', doCreateRoom);

  // Enter key in create inputs
  var channelInput = $('create-channel-input');
  if (channelInput) channelInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); doCreateChannel(); }
  });
  var roomInput = $('create-room-input');
  if (roomInput) roomInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); doCreateRoom(); }
  });

  // Invite popover events
  var inviteToggle = $('invite-toggle');
  if (inviteToggle) inviteToggle.addEventListener('click', toggleInvitePopover);

  // List search (client-side filter)
  bindListSearch('conv-search', 'conv', function () {
    if (typeof renderConvList === 'function') renderConvList();
  });
  bindListSearch('ring-search', 'ring', function () {
    if (typeof renderRingsSidebar === 'function') renderRingsSidebar();
  });
  bindListSearch('feed-search', 'feed', function () {
    if (typeof renderFeedContent === 'function') renderFeedContent();
    if (typeof updateFeedHeader === 'function') updateFeedHeader();
  });
  bindListSearch('member-search', 'member', function () {
    if (typeof renderMembers === 'function') renderMembers();
  });

  // Chat history browser (search / filter / load older)
  if (typeof bindChatHistoryUi === 'function') bindChatHistoryUi();
  // Room files panel (group attachment library)
  if (typeof bindRoomFilesUi === 'function') bindRoomFilesUi();

  // Edit room dialog events
  var editRoomOverlay = $('edit-room-dialog');
  if (editRoomOverlay) editRoomOverlay.addEventListener('click', function (e) {
    if (e.target === editRoomOverlay) hideEditRoomDialog();
  });
  var editRoomCloseBtn = $('edit-room-close');
  if (editRoomCloseBtn) editRoomCloseBtn.addEventListener('click', hideEditRoomDialog);
  var editRoomSaveBtn = $('edit-room-save');
  if (editRoomSaveBtn) editRoomSaveBtn.addEventListener('click', doSaveRoom);

  // Esc closes topmost messenger overlays/menus (menus → pickers → dialogs)
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' && e.keyCode !== 27) return;
    // Message context menu
    if (typeof closeMsgMenu === 'function' && typeof _msgMenu !== 'undefined' && _msgMenu) {
      closeMsgMenu();
      e.preventDefault();
      return;
    }
    // Attach menu
    if (typeof closeAttachMenu === 'function' && typeof _attachMenu !== 'undefined' && _attachMenu) {
      closeAttachMenu();
      e.preventDefault();
      return;
    }
    // Invite popover
    if (typeof closeInvitePopover === 'function' && typeof _invitePopover !== 'undefined' && _invitePopover && _invitePopover.style.display !== 'none') {
      closeInvitePopover();
      e.preventDefault();
      return;
    }
    // Chat history panel
    if (typeof isChatHistoryOpen === 'function' && isChatHistoryOpen()) {
      closeChatHistory();
      e.preventDefault();
      return;
    }
    // Room files panel
    if (typeof isRoomFilesOpen === 'function' && isRoomFilesOpen()) {
      closeRoomFiles();
      e.preventDefault();
      return;
    }
    // Manage dropdown
    var manageDd = $('manage-dropdown');
    if (manageDd && manageDd.classList.contains('open')) {
      closeManageDropdown();
      e.preventDefault();
      return;
    }
    // Topmost dismissable overlay (forward / picker / confirm)
    var overlays = document.querySelectorAll('.forward-overlay, .picker-overlay, .confirm-overlay');
    if (overlays.length) {
      var top = overlays[overlays.length - 1];
      if (top.classList.contains('confirm-overlay')) {
        var cancelBtn = top.querySelector('.confirm-btn-cancel');
        if (cancelBtn) cancelBtn.click();
      } else {
        aroDismiss(top, { remove: true, ms: 160 });
      }
      e.preventDefault();
      return;
    }
    // Create / edit room dialogs
    var createDlg = $('create-dialog');
    if (createDlg && createDlg.style.display !== 'none') {
      hideCreateDialog();
      e.preventDefault();
      return;
    }
    var editDlg = $('edit-room-dialog');
    if (editDlg && editDlg.style.display !== 'none') {
      hideEditRoomDialog();
      e.preventDefault();
    }
  });
}

// ==================== Init ====================
async function init() {
  try {
    var user = await Tapp.context.getUser();
    var actorUrl = user ? normalizeFederationUrl(user.actor_url) : '';
    if (actorUrl) state.localActorUrl = actorUrl;
  } catch (e) { /* ignore */ }

  try {
`

const PAGE_MOD_INDEX = `\
    var localeRes = await Tapp.ui.getLocale();
    if (localeRes) setLocale(localeRes);
  } catch (e) { /* ignore */ }

  try {
    var settings = await Tapp.settings.getAll();
    if (settings && settings.pollInterval) {
      state.pollInterval = Math.max(5, Math.min(120, settings.pollInterval)) * 1000;
    }
    if (settings && typeof settings.notifyOnMessage !== 'undefined') {
      state.notifyOnMessage = !!settings.notifyOnMessage;
    }
  } catch (e) { /* ignore */ }

  // Load tapp acceptance states from storage
  try {
    var allStorage = await Tapp.storage.getAll();
    if (allStorage) {
      Object.keys(allStorage).forEach(function (k) {
        if (k.indexOf('tapp_accept_') === 0) {
          state.tappAcceptMap[k] = allStorage[k];
        }
      });
    }
  } catch (e) { /* ignore */ }

  await loadUserRole();
  await loadFederationIdentity();
  applyLabels();

  // -- Populate feed profile header from user context + federation identity --
  try {
    var user = await Tapp.context.getUser();
    if (user) {
      synthesizeFederationIdentityFromUser(user);
      // Merge federation identity avatar/name when context is empty
      if (state.identity) {
        if (!user.avatar_url && !user.avatar && state.identity.avatar_url) {
          user.avatar_url = state.identity.avatar_url;
          user.avatar = state.identity.avatar_url;
        }
        if (!user.display_name && state.identity.display_name) {
          user.display_name = state.identity.display_name;
        }
      }
      renderFeedProfileUser(user);
      // Update nav feed tab avatar + username
      var navAvatar = $('nav-feed-avatar');
      if (navAvatar) {
        var navAvatarUrl = user.avatar_url || user.avatar || '';
        navAvatar.innerHTML = avatarContentHtml(navAvatarUrl, user.display_name || user.username || '?');
      }
      var navName = $('nav-feed-label');
      if (navName) navName.textContent = user.display_name || user.username || '';
    } else if (state.identity) {
      renderFeedProfileUser({
        username: state.identity.username,
        display_name: state.identity.display_name || state.identity.username,
        avatar_url: state.identity.avatar_url || '',
        avatar: state.identity.avatar_url || '',
      });
      var navAvatarFallback = $('nav-feed-avatar');
      if (navAvatarFallback) {
        navAvatarFallback.innerHTML = avatarContentHtml(
          state.identity.avatar_url || '',
          state.identity.display_name || state.identity.username || '?'
        );
      }
      var navNameFallback = $('nav-feed-label');
      if (navNameFallback) {
        navNameFallback.textContent = state.identity.display_name || state.identity.username || '';
      }
    }
  } catch (e) {
    if (state.identity) {
      try {
        renderFeedProfileUser({
          username: state.identity.username,
          display_name: state.identity.display_name || state.identity.username,
          avatar_url: state.identity.avatar_url || '',
          avatar: state.identity.avatar_url || '',
        });
      } catch (e2) { /* ignore */ }
    }
  }
  // Last resort: never leave avatar as bare "?" with empty name when we have something.
  try {
    var nameEl = document.querySelector('[data-feed-display-name]');
    var av = document.querySelector('[data-feed-avatar]');
    if (nameEl && !String(nameEl.textContent || '').trim()) {
      var fallbackName = (state.identity && (state.identity.display_name || state.identity.username))
        || (state.isGuest ? (lang.guest || '访客') : (lang.me || '我'));
      nameEl.textContent = fallbackName;
      if (av && (!av.innerHTML || av.textContent === '?' || av.textContent.trim() === '?')) {
        av.textContent = (fallbackName[0] || '?').toUpperCase();
      }
      var navName = $('nav-feed-label');
      if (navName && !String(navName.textContent || '').trim()) navName.textContent = fallbackName;
      var navAv = $('nav-feed-avatar');
      if (navAv && (navAv.textContent || '').trim() === '?') {
        navAv.textContent = (fallbackName[0] || '?').toUpperCase();
      }
    }
  } catch (e3) { /* ignore */ }
  renderFederationIdentity();
  applyAdminControls();
  applyRoleControls();

  bindEvents();
  if (!state.isGuest) {
    bindRealtimeListeners();
    await loadConversations();
  }
  await loadFeed();

  // Handle launch params
  var launchParams = window._TAPP_LAUNCH_PARAMS || {};
  if (!state.isGuest && launchParams.view && ['messages', 'feed', 'rings'].indexOf(launchParams.view) !== -1) {
    switchView(launchParams.view);
  } else if (launchParams.view === 'timeline' || launchParams.view === 'profile') {
    switchView('feed');
  }
  if (!state.isGuest && launchParams.channel) {
    switchView('messages');
    openConversation('channel', launchParams.channel);
  } else if (!state.isGuest && launchParams.room) {
    switchView('messages');
    openConversation('room', launchParams.room);
  }

  applyDialogLabels();

  Tapp.ui.onLocaleChange(function (newLocale) {
    setLocale(newLocale);
    applyLabels();
    applyDialogLabels();
    renderConvList();
    renderChatHeader();
    renderMembers();
    renderFederationIdentity();
    if (state.currentView === 'feed') { renderFeedContent(); }
    else if (state.currentView === 'rings') { renderRingsSidebar(); if (state.activeRingId) renderRingDetail(); }
  });
}

// ==================== Entry ====================
if (window._TAPP_MODE === 'page' || window._TAPP_HAS_HTML) {
  Tapp.lifecycle.onReady(function () {
    init();
  });

  Tapp.lifecycle.onDestroy(function () {
    stopPolling();
    unsubscribeRealtime();
  });
}
`

const PAGE_MODULES: Record<string, string> = {
  'i18n.js': PAGE_MOD_I18N,
  'state.js': PAGE_MOD_STATE,
  'helpers.js': PAGE_MOD_HELPERS,
  'attachments.js': PAGE_MOD_ATTACHMENTS,
  'chat.js': PAGE_MOD_CHAT,
  'history.js': PAGE_MOD_HISTORY,
  'files.js': PAGE_MOD_FILES,
  'members.js': PAGE_MOD_MEMBERS,
  'api.js': PAGE_MOD_API,
  'views.js': PAGE_MOD_VIEWS,
  'events.js': PAGE_MOD_EVENTS,
  'index.js': PAGE_MOD_INDEX,
}

// ==================== Generated Monolith (from modules + inline LANG) ====================
function buildCoreCode(): string {
  const inlineLang = [
    '  // ==================== i18n ====================',
    `  var LANG = ${
      JSON.stringify(ARO_I18N, null, 2)
        .split('\n')
        .map((l, i) => (i === 0 ? l : `  ${l}`))
        .join('\n')
      };`,
    '',
    '  var lang = LANG.zh;',
    "  var currentLocale = 'zh';",
    '',
    '  function setLocale(locale) {',
    "    currentLocale = locale || 'zh';",
    "    var key = currentLocale.startsWith('zh') ? 'zh' : currentLocale.startsWith('ja') ? 'ja' : 'en';",
    '    lang = LANG[key] || LANG.en;',
    '  }',
  ].join('\n')

  const otherModules = [
    PAGE_MOD_STATE,
    PAGE_MOD_HELPERS,
    PAGE_MOD_ATTACHMENTS,
    PAGE_MOD_CHAT,
    PAGE_MOD_HISTORY,
    PAGE_MOD_FILES,
    PAGE_MOD_MEMBERS,
    PAGE_MOD_API,
    PAGE_MOD_VIEWS,
    PAGE_MOD_EVENTS,
    PAGE_MOD_INDEX,
  ]
    .map((m) =>
      m
        .split('\n')
        .map((l) => (l ? `  ${l}` : l))
        .join('\n'),
    )
    .join('\n\n')

  return [
    '(function () {',
    "  'use strict';",
    '',
    inlineLang,
    '',
    otherModules,
    '})();',
  ].join('\n')
}

const CORE_CODE = buildCoreCode()

// ==================== Manifest ====================
const manifest: TappManifest = {
  id: 'com.myriad.aro',
  name: 'Aro',
  version: '1.0.0',
  minSystemVersion: '0.2.1',
  description: '社交中心，统一管理消息、时间线、环网与个人资料',
  locales: {
    'en-US': {
      description:
        'Social hub for messages, timeline, ring network and profile in one place',
    },
    'ja-JP': {
      description:
        'メッセージ・タイムライン・リングネット・プロフィールをまとめるソーシャルハブ',
    },
  },
  category: 'social',
  main: 'index.js',
  author: {
    name: 'Myriad Team',
    url: 'https://github.com/Myriad-Dreamin',
  },
  permissions: [
    'storage',
    'ui:notification',
    'ui:theme',
    'federation:read',
    'federation:write',
    'federation:message',
    'federation:files',
    'platform:read',
    'report:read',
    'tappList:read',
    'tappList:manage',
    'brew:read',
  ],
  iconSvg:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>',
  themeColor: '#6366f1',
  hasPage: true,
  // 声明真实后台需求：关窗后仍由 headless core 轮询新消息并通知。
  backgroundRequirements: ['notification'],
  settings: [
    { key: 'pollInterval', type: 'number', defaultValue: 15, label: '轮询间隔 (秒)', min: 5, max: 120, step: 5 },
    { key: 'notifyOnMessage', type: 'toggle', defaultValue: true, label: '新消息通知' },
  ],
  pageModules: [
    'i18n.js',
    'state.js',
    'helpers.js',
    'attachments.js',
    'chat.js',
    'history.js',
    'files.js',
    'members.js',
    'api.js',
    'views.js',
    'events.js',
    'index.js',
  ],
}

// ==================== Code Structure ====================
const codeStructure: TappCodeStructure = {
  core: CORE_CODE,
  styles: STYLES,
  pageHtml: PAGE_HTML,
  i18n: ARO_I18N,
  pageModules: PAGE_MODULES,
  pageModuleOrder: manifest.pageModules,
}

// ==================== Export ====================
export const aroTapp: ExampleTapp = {
  manifest,
  code: codeStructure,
  tags: [
    'official',
    'federation',
    'social',
    'messenger',
    'timeline',
    'rings',
    'profile',
  ],
}
