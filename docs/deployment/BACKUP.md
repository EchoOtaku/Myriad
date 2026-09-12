# 整站备份与恢复

快速开始里的 `pg_dump` 只覆盖数据库。形象 atlas、Tapp 安装、Agent 记忆和
小组件字体在 `backend_data`（容器内 `/app/data`）。密钥在部署目录的 `.env`。
这三样都要带上，才能从空机器恢复。

`cache` / `backend_cache` 可再生，不要当灾备。Updater 对 `./pgdata` 的文件级
快照只服务升级回滚，**不是**整站备份。

## 备份

允许短暂停 backend，避免写库与写盘交叉。

```bash
bash scripts/extra/backup.sh backup
# 或
bash scripts/extra/backup.sh backup --out /var/backups/myriad-20260101
```

产物目录（权限 700）里有：

| 文件 | 内容 |
| --- | --- |
| `postgres.dump` | `pg_dump -Fc` |
| `backend_data.tar.gz` | named volume `*_backend_data`（brew / tapps / agent / site） |
| `env` | 当时的 `.env`（含 JWT、数据库口令等） |
| `MANIFEST.txt` | 时间戳与包含清单，不含秘密值 |

脚本不会把 `.env` 打进日志。备份目录应与主机权限一并保管。

原生部署没有 Docker volume 时，用
[NATIVE_DEPLOYMENT.md](NATIVE_DEPLOYMENT.md) 的 `pg_dump` + `tar` `data/`。

## 恢复

会覆盖当前库、数据卷和 `.env`。现有 `.env` 会先复制为 `.env.bak.restore`。

```bash
bash scripts/extra/backup.sh restore --from /var/backups/myriad-20260101
```

恢复后检查 `/health` 与 `/ready`。`/health` 只表示进程存活；业务就绪看
`db_connected`（最近一次探测）、`migrations_applied`、`routes_full`。

## 不要做的事

- 只备份 SQL、不备份 `backend_data`：Tapp 与形象文件会丢。
- 把 Updater 的 `./pgdata` 快照当整站备份。
- 把 `backend_cache` 打进灾备包。
- 在聊天、工单或日志里粘贴 `.env`。
