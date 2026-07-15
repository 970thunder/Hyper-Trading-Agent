# 宝塔面板镜像部署教程

本方案适用于“服务器不保存 Git 仓库源码，只拉取经过 CI 验证的 Docker 镜像”的 Hyper Trading Agent 生产部署。前端、后端和 SQL migration 已包含在同一个 GHCR 镜像中；宝塔负责 Docker Compose、域名、HTTPS 和反向代理。

## 1. 与源码部署的区别

| 项目 | 源码部署 | 宝塔镜像部署，推荐 |
| --- | --- | --- |
| 服务器内容 | Git 仓库、脚本、配置、数据 | Compose、少量脚本、配置、数据 |
| 更新动作 | `git fetch` 后在服务器构建 | `docker compose pull` 后重启 |
| Node/Python 编译 | 服务器进行 | GitHub Actions 进行 |
| 回滚 | 检出历史提交后构建 | 切换到历史镜像 SHA |
| 适合场景 | 需要在服务器调试 | 宝塔、常规生产交付 |

请二选一。不要让源码部署的 `docker-compose.prod.yml` 和本教程的 `docker-compose.yml` 在同一个 Docker Compose 项目、同一组数据卷中同时运行。

## 2. 上线前需要准备的信息

配置前请准备以下项目。除域名和公开服务器地址外，不要在聊天中发送任何真实密钥。

| 配置项 | 示例 | 用途 |
| --- | --- | --- |
| 域名 | `agent.example.com` | 宝塔网站与 HTTPS 证书 |
| 服务器公网 IP、SSH 端口 | `203.0.113.10:22` | 仅自动发布需要 |
| GitHub Package 可见性 | public 或 private | 决定服务器是否需要 GHCR 登录 |
| GHCR 只读 PAT | `read:packages` | 私有镜像拉取需要 |
| SiliconFlow 或其他模型密钥 | 保存在 `.env` | 默认模型与 embedding |
| 初始 Owner 邮箱与强密码 | `owner@example.com` | 创建首个组织管理员 |
| 自动发布 SSH 密钥 | 单独的一对 ed25519 key | GitHub Actions 登录服务器需要 |

如果 GitHub Container Registry 包保持 private，创建一个仅有 `read:packages` 权限的 fine-grained PAT。服务器执行一次登录即可：

```bash
echo "$GHCR_READ_TOKEN" | docker login ghcr.io -u 970thunder --password-stdin
```

不要把 PAT 写入 `.env`、Compose 文件或 GitHub Action 日志。镜像不包含生产密钥；密钥只放在服务器的 `.env`。

## 3. GitHub 会如何生成镜像

`main` 的 CI 完成后，工作流会在 CI 内部构建并推送：

```text
ghcr.io/970thunder/hyper-trading-agent:sha-<40 位提交 SHA>
ghcr.io/970thunder/hyper-trading-agent:main
```

自动部署始终使用 `sha-<40 位提交 SHA>`，可精确知道生产运行的是哪个版本，也能回滚。`main` 仅适合首次手工验证或受控更新。

首次将本功能合并到 `main` 后，等待 GitHub Actions 中的 `CI` 成功，确认其 `Publish production image` job 成功，再在 GitHub 仓库的 Packages 页面确认镜像已经出现。

## 4. 在宝塔创建 Docker Compose 项目

### 4.1 安装宝塔组件

在宝塔面板安装或确认：

1. `Docker 管理器` 插件；
2. `Nginx`；
3. `SSL` 或 Let's Encrypt 证书功能。

服务器防火墙只需允许 `80`、`443` 和管理用 SSH 端口。禁止向公网开放 `8899`、`5432` 和 `6379`。

### 4.2 创建项目文件

在宝塔文件管理器建立目录，例如：

```text
/www/wwwroot/hyper-trading-agent
```

从仓库下载下列文件，并放入该目录：

| 仓库文件 | 宝塔目录中的文件名 |
| --- | --- |
| `deploy/baota/docker-compose.registry.yml` | `docker-compose.yml` |
| `deploy/baota/env.example` | `.env`，复制后编辑 |
| `deploy/baota/nginx-sse.conf` | 仅作 Nginx 配置参考 |
| `scripts/deploy-registry-production.sh` | `scripts/deploy-registry-production.sh`，自动发布需要 |
| `scripts/verify-registry-production.sh` | `scripts/verify-registry-production.sh`，自动发布需要 |

也可在 SSH 中创建目录并设置脚本权限：

```bash
mkdir -p /www/wwwroot/hyper-trading-agent/scripts
chmod 700 /www/wwwroot/hyper-trading-agent/scripts/*.sh
chmod 600 /www/wwwroot/hyper-trading-agent/.env
```

宝塔 Docker 管理器中创建 Compose 项目时，选择该目录的 `docker-compose.yml`。不要启用“构建镜像”；此项目只会从 GHCR 拉取镜像。

### 4.3 编辑 `.env`

从 `env.example` 复制后，至少修改以下值：

```env
HYPER_TRADING_IMAGE=ghcr.io/970thunder/hyper-trading-agent
HYPER_TRADING_IMAGE_TAG=main

POSTGRES_PASSWORD=<强随机数据库密码>
API_AUTH_KEY=<强随机远程 API 密钥>
VIBE_TRADING_SECRET_KEY=<Fernet 格式密钥>
VIBE_TRADING_COOKIE_SECURE=true
API_BIND=127.0.0.1
API_PORT=8899
CORS_ORIGINS=https://agent.example.com
HYPER_TRADING_PLATFORM_ADMIN_EMAILS=owner@example.com

SILICONFLOW_API_KEY=<生产模型密钥>
```

在服务器生成前三个值：

```bash
openssl rand -base64 36
openssl rand -base64 48
python3 -c "import base64, secrets; print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())"
```

三行输出分别可用于 `POSTGRES_PASSWORD`、`API_AUTH_KEY`、`VIBE_TRADING_SECRET_KEY`。保留模板中的：

```env
HYPER_TRADING_RUNTIME_JOB_BACKEND=redis-postgres
HYPER_TRADING_VECTOR_STORAGE=postgres-pgvector
HYPER_TRADING_PGVECTOR_DIMENSIONS=1024
```

`1024` 对应默认 SiliconFlow `BAAI/bge-m3` embedding。如以后更换 embedding 模型，必须确认其维度并进行受控的数据迁移。

### 4.4 首次拉取并启动

在宝塔 Docker Compose 项目页面点击启动，或通过 SSH：

```bash
cd /www/wwwroot/hyper-trading-agent
docker compose --env-file .env -f docker-compose.yml config --quiet
docker compose --env-file .env -f docker-compose.yml pull
docker compose --env-file .env -f docker-compose.yml up -d
docker compose --env-file .env -f docker-compose.yml ps
```

首次启动会依次启动 PostgreSQL、Redis、数据库 migration、API 和 worker。migration 会校验历史 SQL 文件的 checksum；发现已发布 migration 被改写时会停止，而不是静默修改生产数据库。

## 5. 在宝塔创建网站与 HTTPS

1. 在“网站”中新建纯静态网站，域名填写 `agent.example.com`。
2. 在网站的“反向代理”中新增代理，目标 URL 填写 `http://127.0.0.1:8899`。
3. 在 SSL 页面为该域名申请 Let's Encrypt 证书，开启强制 HTTPS。
4. 打开网站的 Nginx 配置，将 `deploy/baota/nginx-sse.conf` 中内容放在 `server { ... }` 内部，保留宝塔生成的常规 `location /` 反向代理。
5. 保存后在宝塔执行 Nginx 配置检查和重载。

SSE 片段会关闭 Agent 事件流的缓冲，设置 1 小时读取超时，并阻止公网访问 `/metrics`、`/docs`、`/openapi.json` 和 `/redoc`。普通 API 路由继续走宝塔生成的代理规则。

浏览器访问：

```text
https://agent.example.com/health
```

应返回：

```json
{"status":"healthy"}
```

## 6. 创建首个组织 Owner

在宝塔终端或 SSH 中执行。密码必须是独立的生产密码：

```bash
cd /www/wwwroot/hyper-trading-agent
SILICONFLOW_KEY="$(sed -n 's/^SILICONFLOW_API_KEY=//p' .env)"
docker compose --env-file .env -f docker-compose.yml exec api \
  python -m src.commercial.bootstrap \
  --email owner@example.com \
  --password '<强随机登录密码>' \
  --organization 'Hyper Research' \
  --display-name '平台管理员' \
  --provider siliconflow \
  --model deepseek-ai/DeepSeek-V3.2 \
  --base-url https://api.siliconflow.cn/v1 \
  --api-key "$SILICONFLOW_KEY"
```

随后打开域名并以 Owner 登录。默认关闭公开注册，其他成员在系统组织管理中创建。

## 7. 更新与回滚

### 手工更新

宝塔 Docker 项目页面点击拉取并重建，或运行：

```bash
cd /www/wwwroot/hyper-trading-agent
docker compose --env-file .env -f docker-compose.yml pull
docker compose --env-file .env -f docker-compose.yml up -d
```

在 `.env` 中把 `HYPER_TRADING_IMAGE_TAG` 设置为某个 `sha-<40 位提交 SHA>` 后再执行上述命令，可发布指定版本或回滚。数据卷不会因为应用重启被删除。

### 自动更新

要让 GitHub 在 `main` CI 成功后自动更新宝塔服务器：

1. 在 GitHub `Settings -> Environments -> production` 创建或打开 `production` 环境。
2. 添加 Secrets：

| Secret | 值 |
| --- | --- |
| `HYPER_TRADING_DEPLOY_HOST` | 服务器 IP 或域名 |
| `HYPER_TRADING_DEPLOY_USER` | 有 Docker 权限的部署用户 |
| `HYPER_TRADING_DEPLOY_PORT` | SSH 端口，通常为 `22` |
| `HYPER_TRADING_DEPLOY_PATH` | `/www/wwwroot/hyper-trading-agent` |
| `HYPER_TRADING_DEPLOY_SSH_KEY` | 该部署用户的专用私钥 |
| `HYPER_TRADING_DEPLOY_KNOWN_HOSTS` | 已核验的服务器 SSH known_hosts 行 |

3. 在仓库 `Settings -> Secrets and variables -> Actions -> Variables` 添加非敏感的 Repository Variables：

| Variable | 值 |
| --- | --- |
| `HYPER_TRADING_DEPLOY_MODE` | `registry` |
| `HYPER_TRADING_IMAGE` | `ghcr.io/970thunder/hyper-trading-agent`，可选 |

4. 把部署私钥对应的公钥加入服务器部署用户的 `~/.ssh/authorized_keys`。
5. 确认服务器项目目录里已有本教程第 4.2 节列出的两个脚本并具备执行权限。

配置完成后，流程为：

```text
合并 Pull Request 到 main
  -> CI 成功
  -> 构建并推送 sha-<commit> 镜像
  -> Deploy Registry Production 自动拉取该精确镜像
  -> 运行健康、匿名权限、pgvector、migration 校验
```

可在 GitHub `Actions -> Deploy Registry Production -> Run workflow` 中手动输入 `main` 或历史 `sha-<commit>` 标签，以便重试和回滚。建议为 `production` Environment 启用 Required reviewers。

## 8. 日常检查与故障处理

```bash
cd /www/wwwroot/hyper-trading-agent
docker compose --env-file .env -f docker-compose.yml ps
docker compose --env-file .env -f docker-compose.yml logs --tail=200 api
docker compose --env-file .env -f docker-compose.yml logs --tail=200 worker
curl --fail --silent http://127.0.0.1:8899/health
```

| 问题 | 处理方式 |
| --- | --- |
| `pull access denied` | 检查 GHCR package 可见性，或重新执行 `docker login ghcr.io` 并确认 PAT 含 `read:packages` |
| 网站 502 | 检查 `api` 日志、端口是否仅为 `127.0.0.1:8899`，以及宝塔反向代理目标是否正确 |
| 对话一直等待 | 确认宝塔 Nginx 已加入 SSE 配置并重载；检查 `/sessions/.../events` 没有被缓存 |
| 登录后立刻失效 | `CORS_ORIGINS` 必须为实际 HTTPS 域名，`VIBE_TRADING_COOKIE_SECURE=true` |
| migration 失败 | 不要修改已发布 migration；先备份 PostgreSQL，再检查 migration checksum 与应用镜像版本 |
| 要回滚 | 设置已验证的历史 `sha-<commit>` 标签，拉取并 `up -d`；数据库 migration 不会自动回退 |

生产备份和密钥轮换仍然必须执行，详见：[备份与恢复演练](operations-backup-restore.md) 和 [密钥轮换](operations-secret-rotation.md)。
