# Notification catalog

Myriad separates three concepts that previously overlapped:

- **Source**: the product surface that emitted the event. This owns the icon.
- **Event key**: the exact user-configurable event, such as success vs failure.
- **Notification type**: the persisted presentation shape used for history compatibility.

User preferences are stored on `users.notification_preferences`. New notifications are filtered
before persistence and SSE delivery. Existing history is not retroactively deleted.

## Source icons

Only eight source icons are required. Individual events reuse their source icon; priority, title,
and color communicate status, so the UI does not need 28 unrelated pictograms.

| Source key | Product | Icon source |
| --- | --- | --- |
| `agent` | Arael tasks | Project Arael/module sparkle icon (`LuSparkles`) |
| `heartbeat` | Arael Heartbeat | Activity pulse (`LuActivity`) |
| `mcp` | MCP tool servers | Server (`LuServer`) |
| `brew` | Brew | The exact cup SVG used by `NavigationIsland` |
| `tapp` | Tapp runtime | Project `MyriadStoreIcon` |
| `updater` | System updater | Refresh cycle (`LuRefreshCw`) |
| `federation` | Aro | The exact paper-plane path used by Aro messenger navigation |
| `system` | Myriad system | Information (`LuInfo`) |

The reusable implementation lives in
`frontend/src/components/notifications/NotificationIcons.tsx`.

## Persisted presentation types

These are intentionally broader than event keys so old history remains readable:

| Source | `notification_type` values |
| --- | --- |
| Arael | `task_progress`, `task_completed`, `task_failed`, `task_cancelled`, `agent_clarification` |
| Heartbeat | `heartbeat_result` |
| MCP | `mcp_server_status` |
| Brew | `brew_new_items`, `brew_source_error` |
| Tapp | `tapp_notification` |
| Updater | `updater_status` |
| Aro | `federation_message`, `federation_follow`, `federation_invite` |
| System | `system_info` |

## Configurable events

| Source | Event key | Current producer |
| --- | --- | --- |
| Arael | `agent.task_progress` | Agent run hub progress |
| Arael | `agent.task_completed` | Agent run terminal success |
| Arael | `agent.task_failed` | Agent run terminal failure |
| Arael | `agent.task_cancelled` | User-cancelled run |
| Arael | `agent.clarification` | Run waiting for user input |
| Heartbeat | `heartbeat.succeeded` | Heartbeat scheduled task success |
| Heartbeat | `heartbeat.failed` | Heartbeat scheduled task failure |
| MCP | `mcp.connected` | MCP server connection/recovery |
| MCP | `mcp.disconnected` | MCP server connection/restart failure |
| Brew | `brew.new_items` | Feed refresh with new items |
| Brew | `brew.source_error` | Feed reaches the consecutive-error threshold |
| Tapp | `tapp.message` | Tapp queued informational notification |
| Tapp | `tapp.warning` | Tapp queued warning |
| Tapp | `tapp.error` | Tapp error or scheduled task failure |
| Updater | `updater.submitted` | Update/rollback job accepted |
| Updater | `updater.running` | Update/rollback job running |
| Updater | `updater.succeeded` | Update/rollback completed |
| Updater | `updater.failed` | Update/rollback failed |
| Updater | `updater.needs_manual` | Recovery requires an operator |
| Updater | `updater.unknown` | Backend could not confirm the final state |
| Aro | `federation.channel_message` | Incoming direct message |
| Aro | `federation.room_message` | Incoming room message |
| Aro | `federation.new_follower` | Incoming follow |
| Aro | `federation.follow_accepted` | Outgoing follow accepted |
| Aro | `federation.channel_invite` | Incoming direct-channel request |
| Aro | `federation.room_invite` | Incoming room invitation |
| Aro | `federation.channel_accepted` | Direct channel accepted |
| System | `system.info` | Reserved for Myriad system information |

`system.info` remains in the catalog for compatibility and future system notices; there is no
current producer. In-page Tapp UI notifications and synchronous request responses remain local and
ephemeral to avoid duplicating the same event in the persistent notification center.
