import type React from 'react'
import type { Locale } from '../../i18n'
import type {
  NotificationEventDefinition,
  NotificationEventKey,
  NotificationPreferences,
  NotificationSourceKey,
} from '../../services/notificationPreferencesApi'
import { useMemo } from 'react'
import { useI18n } from '../../contexts/I18nContext'
import { cloneNotificationPreferences } from '../../services/notificationPreferencesApi'
import { NotificationSourceIcon } from '../notifications/NotificationIcons'
import {
  CheckboxGroupItem,
  SettingGroup,
  SettingSection,
  SwitchItem,
} from '../settings'
import './NotificationConfigSection.css'

interface NotificationConfigSectionProps {
  title: string
  icon?: React.ReactNode
  description?: string
  sectionId?: string
  preferences: NotificationPreferences
  sources: NotificationSourceKey[]
  events: NotificationEventDefinition[]
  loading?: boolean
  onChange: (preferences: NotificationPreferences) => void
}

const SOURCE_TEXT: Record<
  Locale,
  Record<NotificationSourceKey, { title: string; description: string }>
> = {
  'zh-CN': {
    agent: {
      title: 'Arael 任务',
      description: '任务进度、结果、取消与澄清请求',
    },
    heartbeat: {
      title: 'Heartbeat',
      description: 'Arael 后台定时任务执行结果',
    },
    mcp: { title: 'MCP 服务', description: '工具服务器连接和断开状态' },
    brew: { title: 'Brew', description: '订阅源新内容与连续抓取错误' },
    tapp: { title: 'Tapp', description: 'Tapp 主动消息、警告和任务错误' },
    updater: { title: '系统更新', description: '更新、回滚及人工恢复状态' },
    federation: { title: 'Aro', description: '联邦消息、关注和邀请' },
    system: { title: '系统', description: 'Myriad 自身的重要信息' },
  },
  'en-US': {
    agent: {
      title: 'Arael Tasks',
      description: 'Task progress, results, cancellation and clarification',
    },
    heartbeat: {
      title: 'Heartbeat',
      description: 'Results from Arael background schedules',
    },
    mcp: { title: 'MCP Services', description: 'Tool server connection state' },
    brew: {
      title: 'Brew',
      description: 'New feed items and repeated fetch errors',
    },
    tapp: {
      title: 'Tapp',
      description: 'App messages, warnings and task errors',
    },
    updater: {
      title: 'System Update',
      description: 'Update, rollback and recovery status',
    },
    federation: {
      title: 'Aro',
      description: 'Federated messages, follows and invitations',
    },
    system: {
      title: 'System',
      description: 'Important information from Myriad',
    },
  },
  'ja-JP': {
    agent: {
      title: 'Arael タスク',
      description: '進行状況、結果、キャンセル、確認要求',
    },
    heartbeat: {
      title: 'Heartbeat',
      description: 'Arael バックグラウンド定期処理の結果',
    },
    mcp: { title: 'MCP サービス', description: 'ツールサーバーの接続状態' },
    brew: { title: 'Brew', description: '新着フィードと連続取得エラー' },
    tapp: { title: 'Tapp', description: 'アプリの通知、警告、タスクエラー' },
    updater: {
      title: 'システム更新',
      description: '更新、ロールバック、復旧状態',
    },
    federation: { title: 'Aro', description: '連合メッセージ、フォロー、招待' },
    system: { title: 'システム', description: 'Myriad からの重要なお知らせ' },
  },
}

const EVENT_TEXT: Record<Locale, Record<NotificationEventKey, string>> = {
  'zh-CN': {
    'agent.task_progress': '任务进度',
    'agent.task_completed': '任务完成',
    'agent.task_failed': '任务失败',
    'agent.task_cancelled': '任务取消',
    'agent.clarification': '等待回答',
    'heartbeat.succeeded': '定时任务成功',
    'heartbeat.failed': '定时任务失败',
    'mcp.connected': 'MCP 已连接',
    'mcp.disconnected': 'MCP 断开或失败',
    'brew.new_items': '发现新内容',
    'brew.source_error': '订阅源连续失败',
    'tapp.message': '普通消息',
    'tapp.warning': '警告',
    'tapp.error': '错误与任务失败',
    'updater.submitted': '任务已提交',
    'updater.running': '任务执行中',
    'updater.succeeded': '更新成功',
    'updater.failed': '更新失败',
    'updater.needs_manual': '需要人工处理',
    'updater.unknown': '状态无法确认',
    'federation.channel_message': '私信新消息',
    'federation.room_message': '群聊新消息',
    'federation.new_follower': '新的关注者',
    'federation.follow_accepted': '关注已通过',
    'federation.channel_invite': '私信邀请',
    'federation.room_invite': '群组邀请',
    'federation.channel_accepted': '私信通道已建立',
    'federation.room_invite_accepted': '群组邀请已接受',
    'system.info': '系统信息',
  },
  'en-US': {
    'agent.task_progress': 'Task progress',
    'agent.task_completed': 'Task completed',
    'agent.task_failed': 'Task failed',
    'agent.task_cancelled': 'Task cancelled',
    'agent.clarification': 'Waiting for an answer',
    'heartbeat.succeeded': 'Scheduled task succeeded',
    'heartbeat.failed': 'Scheduled task failed',
    'mcp.connected': 'MCP connected',
    'mcp.disconnected': 'MCP disconnected or failed',
    'brew.new_items': 'New content found',
    'brew.source_error': 'Feed repeatedly failed',
    'tapp.message': 'Message',
    'tapp.warning': 'Warning',
    'tapp.error': 'Error or task failure',
    'updater.submitted': 'Job submitted',
    'updater.running': 'Job running',
    'updater.succeeded': 'Update succeeded',
    'updater.failed': 'Update failed',
    'updater.needs_manual': 'Manual recovery required',
    'updater.unknown': 'Status cannot be confirmed',
    'federation.channel_message': 'Direct message',
    'federation.room_message': 'Room message',
    'federation.new_follower': 'New follower',
    'federation.follow_accepted': 'Follow accepted',
    'federation.channel_invite': 'Direct-message invitation',
    'federation.room_invite': 'Room invitation',
    'federation.channel_accepted': 'Direct channel established',
    'federation.room_invite_accepted': 'Room invite accepted',
    'system.info': 'System information',
  },
  'ja-JP': {
    'agent.task_progress': 'タスクの進行状況',
    'agent.task_completed': 'タスク完了',
    'agent.task_failed': 'タスク失敗',
    'agent.task_cancelled': 'タスクキャンセル',
    'agent.clarification': '回答待ち',
    'heartbeat.succeeded': '定期タスク成功',
    'heartbeat.failed': '定期タスク失敗',
    'mcp.connected': 'MCP 接続',
    'mcp.disconnected': 'MCP 切断または失敗',
    'brew.new_items': '新着コンテンツ',
    'brew.source_error': 'フィードの連続失敗',
    'tapp.message': 'メッセージ',
    'tapp.warning': '警告',
    'tapp.error': 'エラーまたはタスク失敗',
    'updater.submitted': 'ジョブ送信済み',
    'updater.running': 'ジョブ実行中',
    'updater.succeeded': '更新成功',
    'updater.failed': '更新失敗',
    'updater.needs_manual': '手動対応が必要',
    'updater.unknown': '状態を確認できません',
    'federation.channel_message': 'ダイレクトメッセージ',
    'federation.room_message': 'ルームメッセージ',
    'federation.new_follower': '新しいフォロワー',
    'federation.follow_accepted': 'フォロー承認',
    'federation.channel_invite': 'DM 招待',
    'federation.room_invite': 'ルーム招待',
    'federation.channel_accepted': 'DM チャンネル確立',
    'federation.room_invite_accepted': 'ルーム招待が承認されました',
    'system.info': 'システム情報',
  },
}

const UI_TEXT = {
  'zh-CN': {
    master: '启用通知中心',
    masterDesc: '关闭后不再创建新的通知，已有历史仍会保留',
    delivery: '展示方式',
    island: '智能岛轮播',
    islandDesc: '新通知到达时在顶部控制岛展示',
    toast: 'Toast 通知',
    toastDesc: '新通知到达时使用全局提示',
    browser: '浏览器系统通知',
    browserDesc: '页面位于后台且浏览器已授权时展示',
    sourceEnabled: '允许此来源',
    locations: '显示位置',
    locationsDesc: '与上方全局展示开关共同生效',
    events: '通知事件',
    panelLocation: '通知面板',
    toastLocation: 'Toast',
    islandLocation: '智能岛',
    browserLocation: '系统通知',
  },
  'en-US': {
    master: 'Enable notification center',
    masterDesc:
      'No new notifications are created when disabled; history is kept',
    delivery: 'Presentation',
    island: 'Control-island carousel',
    islandDesc: 'Show new notifications in the top control island',
    toast: 'Toast notifications',
    toastDesc: 'Use global alerts when new notifications arrive',
    browser: 'Browser system notifications',
    browserDesc: 'Show while the page is in the background when permitted',
    sourceEnabled: 'Allow this source',
    locations: 'Display locations',
    locationsDesc: 'Combined with the global presentation switches above',
    events: 'Notification events',
    panelLocation: 'Notification panel',
    toastLocation: 'Toast',
    islandLocation: 'Control island',
    browserLocation: 'System notification',
  },
  'ja-JP': {
    master: '通知センターを有効にする',
    masterDesc: '無効時は新規通知を作成せず、履歴は保持します',
    delivery: '表示方法',
    island: 'コントロールアイランド',
    islandDesc: '新着通知を上部のコントロールアイランドに表示',
    toast: 'Toast 通知',
    toastDesc: '新着通知をグローバル表示',
    browser: 'ブラウザー通知',
    browserDesc: '許可済みでページがバックグラウンドの時に表示',
    sourceEnabled: 'この送信元を許可',
    locations: '表示場所',
    locationsDesc: '上部のグローバル表示設定と組み合わせて適用します',
    events: '通知イベント',
    panelLocation: '通知パネル',
    toastLocation: 'Toast',
    islandLocation: 'コントロールアイランド',
    browserLocation: 'システム通知',
  },
} satisfies Record<Locale, Record<string, string>>

export const NotificationConfigSection: React.FC<
  NotificationConfigSectionProps
> = ({
  title,
  icon,
  description,
  sectionId,
  preferences,
  sources,
  events,
  loading = false,
  onChange,
}) => {
  const { locale } = useI18n()
  const sourceText = SOURCE_TEXT[locale]
  const eventText = EVENT_TEXT[locale]
  const ui = UI_TEXT[locale]

  const eventsBySource = useMemo(
    () =>
      Object.fromEntries(
        sources.map((source) => [
          source,
          events.filter((event) => event.source === source),
        ]),
      ) as Record<NotificationSourceKey, typeof events>,
    [events, sources],
  )

  const update = (mutate: (draft: NotificationPreferences) => void) => {
    const next = cloneNotificationPreferences(preferences)
    mutate(next)
    onChange(next)
  }

  return (
    <SettingSection
      sectionId={sectionId}
      title={title}
      icon={icon}
      description={description}
    >
      <SettingGroup>
        <SwitchItem
          itemKey="notifications-enabled"
          label={ui.master}
          description={ui.masterDesc}
          value={preferences.enabled}
          loading={loading}
          onChange={(value) => update((draft) => void (draft.enabled = value))}
        />
      </SettingGroup>

      <SettingGroup title={ui.delivery}>
        <SwitchItem
          itemKey="notifications-island"
          label={ui.island}
          description={ui.islandDesc}
          value={preferences.delivery.island}
          disabled={!preferences.enabled}
          loading={loading}
          onChange={(value) =>
            update((draft) => void (draft.delivery.island = value))
          }
        />
        <SwitchItem
          itemKey="notifications-toast"
          label={ui.toast}
          description={ui.toastDesc}
          value={preferences.delivery.toast}
          disabled={!preferences.enabled}
          loading={loading}
          onChange={(value) =>
            update((draft) => void (draft.delivery.toast = value))
          }
        />
        <SwitchItem
          itemKey="notifications-browser"
          label={ui.browser}
          description={ui.browserDesc}
          value={preferences.delivery.browser}
          disabled={!preferences.enabled}
          loading={loading}
          onChange={(value) =>
            update((draft) => void (draft.delivery.browser = value))
          }
        />
      </SettingGroup>

      <div className="notification-source-grid">
        {sources.map((source) => (
          <SettingGroup
            key={source}
            title={sourceText[source].title}
            description={sourceText[source].description}
            icon={<NotificationSourceIcon source={source} />}
            className="notification-source-group"
          >
            <SwitchItem
              itemKey={`notification-source-${source}`}
              label={ui.sourceEnabled}
              value={preferences.sources[source]}
              disabled={!preferences.enabled}
              loading={loading}
              onChange={(value) =>
                update((draft) => void (draft.sources[source] = value))
              }
            />
            <CheckboxGroupItem
              label={ui.locations}
              description={ui.locationsDesc}
              options={[
                {
                  key: 'panel',
                  label: ui.panelLocation,
                  value: preferences.locations[source].panel,
                },
                {
                  key: 'toast',
                  label: ui.toastLocation,
                  value: preferences.locations[source].toast,
                },
                {
                  key: 'island',
                  label: ui.islandLocation,
                  value: preferences.locations[source].island,
                },
                {
                  key: 'browser',
                  label: ui.browserLocation,
                  value: preferences.locations[source].browser,
                },
              ]}
              disabled={
                !preferences.enabled ||
                !preferences.sources[source] ||
                loading
              }
              className="notification-switch-group notification-location-switches"
              onChange={(key, value) =>
                update(
                  (draft) =>
                    void (draft.locations[source][
                      key as keyof NotificationPreferences['locations'][NotificationSourceKey]
                    ] = value),
                )
              }
            />
            <CheckboxGroupItem
              label={ui.events}
              options={eventsBySource[source].map((event) => ({
                key: event.key,
                label: eventText[event.key] || event.key,
                value: preferences.events[event.key],
              }))}
              disabled={
                !preferences.enabled ||
                !preferences.sources[source] ||
                loading
              }
              className="notification-switch-group notification-event-switches"
              onChange={(key, value) =>
                update(
                  (draft) =>
                    void (draft.events[key as NotificationEventKey] = value),
                )
              }
            />
          </SettingGroup>
        ))}
      </div>
    </SettingSection>
  )
}

export default NotificationConfigSection
