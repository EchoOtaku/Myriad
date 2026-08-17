# 安装控制面只留安装暗号，删除引导令牌

Status: accepted

Supersedes: [0022](0022-first-run-browser-setup.md)

0022 把首次安装从 loopback + 引导令牌里解放出来，但令牌文件、请求头和破窗路径还留着。那条路径认领之后走不到，用户面已经没有职能。

决定：删掉 `.bootstrap-token` / `MYRIAD_BOOTSTRAP_TOKEN` / `X-Bootstrap-Token`。安装写操作的用户钥匙只剩 `MYRIAD_SETUP_SECRET`。编排预置了暗号时，连库、建表、创建所有者都要对上；向导自己填库则不预置、不挡。认领标记仍负责关掉向导窗口。

## 理由

- 两把钥匙叠在首次安装上，小白会被卡死。令牌只能从机器上抄，暗号已经在生成器链接和 `.env` 里。
- 令牌剩下的「向导还开着」可以靠进程窗口 + `.bootstrap-claimed` 完成，不必再生成一枚秘密。
- 库挂了重开 setup 改宿主密钥这条破窗，认领标记已经挡住。修库，不要再发明第二把钥匙。

## Consequences

没有安装暗号的未认领实例，谁先做完向导谁就是站长。这是自托管首次安装的常规取舍。旧磁盘上的 `.bootstrap-token` 在打开向导或认领时删除，不当凭证用。
