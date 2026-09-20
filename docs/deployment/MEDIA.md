# 媒体资产：备份、恢复与旧目录

持久媒体在 `DATA_DIR/media`（compose 里是 `backend_data` 的 `media` 子路径）。
外链抓取缓存在 `CACHE_DIR/images`（`backend_cache`），可再生，不进灾备。

新上传、生成、编辑和联邦附件都写入媒体服务。Web 进程提供公开与鉴权读取；
联邦 worker 停掉不影响本站媒体。历史 `/media/federation/…` 与
`/api/phantasi/image-cache/…` 只通过已登记别名读取，不再从请求 URL 拼接磁盘路径。

## 备份与恢复

与 [BACKUP.md](BACKUP.md) 相同：Postgres + `backend_data` + `.env`。
不要挂 `backend_cache` 当恢复条件。生成图、人设、贴纸、手帐上传和联邦附件
应能从数据卷里的 `media/` 读回。旧公开地址靠别名，不靠缓存卷。

回滚到理解新资产模型的版本。不能拿任意更旧的二进制直接对着新库启动。
扩展阶段若仍保留旧列和旧目录，可回到兼容读的版本；新写入切换之后不行。

## 不要做的事

- 启动时扫描整个 `federation_media` 或 `cache/images` 当常规写入。
- 部署脚本里 `rm -rf` 清旧媒体目录来「完成迁移」。
- 把 image-cache 当永久素材备份。
- 未另行授权就对生产做破坏性迁移或删除旧副本。

显式、有界的目录迁移工具仍在代码里（`migrate_catalog_batch`），由 Web/schema
管理者触发，worker 不各自扫盘。引用未核对完的资产禁止批量删除。
