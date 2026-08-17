# 首次未认领安装走浏览器向导，令牌与 loopback 只留给破窗

Status: accepted

安装控制面曾经把 loopback 闸和 `.bootstrap-token` 叠在所有 setup 写操作上。Docker 里浏览器经过捆绑 proxy，backend 看到的原始 TCP peer 不是 loopback；令牌又只在宿主文件里。结果是 VPS 上的首次安装必须先设 `MYRIAD_ALLOW_REMOTE_BOOTSTRAP=true`，再 SSH 去抄令牌。编排已经给出的安装暗号也过不了这两道闸。

决定：把「首次未认领」和「已配置破窗」拆开。

**首次未认领**：库已连且还没有站长，或 CONFIG_MODE 且没有真实 `DATABASE_URL`。浏览器向导可远程完成，不要求引导令牌。编排预置了 `MYRIAD_SETUP_SECRET` 时，创建第一个所有者仍必须对上暗号。`MYRIAD_ALLOW_REMOTE_BOOTSTRAP=false` 仍可强制本机。

**已认领之后**：磁盘上的认领标记阻止重开向导。库挂了先修库，不把 setup 重新挂到公网。引导令牌和 loopback 闸仍留在授权函数里，只在这扇窗被显式打开时生效；`MYRIAD_ALLOW_REMOTE_BOOTSTRAP=false` 仍可强制首次安装也只走本机。转发头继续忽略，避免公网 proxy 把自己变成 loopback。

## 理由

- 未认领窗口的授权前提是「还没有站长」。再要一份只能从机器上抄出来的令牌，等于把目标用户锁在向导外。
- 安装暗号已经是编排路径的所有者钥匙；它只应挡抢站长，不应再叠一层对小白不可达的网络闸。
- 库故障后重开 setup 仍能改宿主密钥。那扇窗继续 fail-closed，不随首次安装一起放宽。

## Consequences

未认领实例在公网暴露期间，谁先做完向导谁就是站长——没有安装暗号时这是竞态。这是自托管首次安装的常规取舍。认领之后能力被消耗，破窗规则恢复。
