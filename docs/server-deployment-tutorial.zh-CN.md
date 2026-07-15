# Hyper Trading Agent 服务器部署与自动发布教程

本教程面向需要把 [Hyper Trading Agent](https://github.com/970thunder/Hyper-Trading-Agent) 部署到公网服务器，并在代码测试通过后自动更新生产环境的管理员。

默认部署方案：Ubuntu 22.04/24.04、Docker Compose、Nginx、HTTPS、PostgreSQL + pgvector、Redis 和 GitHub Actions。完成后，用户只访问 `https://agent.example.com`；应用 API、数据库和 Redis 不直接暴露到公网。

> 重要：生产服务器不用于日常开发。开发在本地分支完成，合并到 GitHub 的 `main` 后，由 GitHub Actions 自动部署通过 CI 的提交。`.env.production`、证书、数据库和任何 API 密钥永远不提交到 Git。

## 1. 最终架构

```text
开发电脑
  │ git push / Pull Request
  ▼
GitHub main ──> CI（后端测试、前端构建、前端测试）
  │ CI 成功后触发
  ▼
GitHub Actions ── SSH（固定主机指纹）──> Ubuntu 服务器
                                             │
                                             ▼
                                    deploy-production.sh
                                             │
                                             ▼
     Internet ── HTTPS ──> Nginx ──> API + Worker ──> PostgreSQL + pgvector
                                        │                    │
                                        └──── Redis ──────────┘
```

生产 Compose 项目名称固定为 `hyper-trading-agent`，包含以下服务：

| 服务 | 用途 | 是否公开暴露 |
| --- | --- | --- |
| `gateway` | Nginx，HTTPS、限流和安全响应头 | 是，仅 `80/443` |
| `api` | 登录、会话、Agent、模型和知识库 API | 否，只绑定 `127.0.0.1:8899` |
| `worker` | 后台任务和队列消费 | 否 |
| `postgres` | 商业数据、RAG 元数据和 pgvector 向量 | 否 |
| `redis` | 运行时队列与缓存 | 否 |
| `migrations` | 启动时执行版本化 SQL migration | 否，一次性任务 |

## 2. 部署前准备

准备以下资源：

1. 一台 Ubuntu 22.04 或 24.04 服务器，建议至少 4 vCPU、8 GB 内存、80 GB SSD。文档解析、向量化和回测任务较多时建议 8 vCPU、16 GB 内存。
2. 一个域名，例如 `agent.example.com`，并可控制 DNS。
3. GitHub 仓库管理员权限，可配置 Environment、Secrets 和分支保护。
4. 一个生产模型供应商密钥，例如 SiliconFlow。不要使用个人开发环境密钥。
5. 可用的 SSH 管理入口。建议禁用 root 直接登录，仅使用普通管理员账号和 SSH key。

DNS 中先增加一条记录：

| 类型 | 主机记录 | 值 |
| --- | --- | --- |
| `A` | `agent` | 服务器公网 IPv4 |
| `AAAA` | `agent` | 服务器公网 IPv6，可选 |

等待解析生效后，在自己的电脑执行：

```bash
nslookup agent.example.com
```

输出应包含该服务器的公网 IP。以下示例统一使用：

```text
域名：agent.example.com
服务器目录：/opt/hyper-trading-agent
部署用户：hyperdeploy
```

请将它们替换为实际值。

## 3. 初始化 Ubuntu 服务器

以具备 `sudo` 权限的管理员登录服务器。先升级基础软件并开放必要端口：

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y ca-certificates curl git ufw

sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose
```

不要开放 `8899`、`5432`、`6379`、`9090` 或 `3000` 到公网。生产系统由 Nginx 作为唯一公网入口。

### 3.1 安装 Docker Engine 与 Compose v2

按 Docker Ubuntu 官方软件源安装：

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo \"$VERSION_CODENAME\") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
docker --version
docker compose version
```

### 3.2 创建专用部署账户和目录

`hyperdeploy` 只负责拉取代码和管理 Docker，不应作为日常登录用户或数据库用户使用：

```bash
sudo useradd --create-home --shell /bin/bash hyperdeploy
sudo usermod -aG docker hyperdeploy
sudo install -d -o hyperdeploy -g hyperdeploy -m 0750 /opt/hyper-trading-agent
id hyperdeploy
```

重新登录该账户后 Docker 组才完全生效。可用下面命令确认：

```bash
sudo -u hyperdeploy -H docker version
```

## 4. 配置服务器读取 GitHub 仓库的密钥

这里的密钥用于 **服务器从 GitHub 拉取代码**。它与后面 GitHub Actions 用来登录服务器的密钥不同，建议严格分离。

在服务器生成一个只读部署密钥：

```bash
sudo -u hyperdeploy -H ssh-keygen -t ed25519 -C "hyper-trading-agent-server-readonly" -f /home/hyperdeploy/.ssh/id_ed25519 -N ""
sudo -u hyperdeploy -H sed -n '1p' /home/hyperdeploy/.ssh/id_ed25519.pub
```

复制输出的公钥，在 GitHub 仓库中依次进入：

```text
Settings -> Deploy keys -> Add deploy key
```

名称可填写 `production-server-readonly`，粘贴公钥，**不要**勾选 `Allow write access`。

回到服务器，先确认 GitHub 主机指纹并测试 SSH：

```bash
sudo -u hyperdeploy -H ssh-keyscan -H github.com >> /home/hyperdeploy/.ssh/known_hosts
sudo -u hyperdeploy -H ssh -T git@github.com
```

最后一条通常显示认证成功但不提供 shell；这属于正常现象。对于高安全环境，应先从 GitHub 官方公布的指纹核对 `ssh-keyscan` 的结果，再写入 `known_hosts`。

## 5. 克隆项目并填写生产配置

以 `hyperdeploy` 身份克隆本仓库，然后从模板创建生产环境文件：

```bash
sudo -u hyperdeploy -H git clone git@github.com:970thunder/Hyper-Trading-Agent.git /opt/hyper-trading-agent
sudo -u hyperdeploy -H cp /opt/hyper-trading-agent/.env.production.example /opt/hyper-trading-agent/.env.production
sudo -u hyperdeploy -H chmod 600 /opt/hyper-trading-agent/.env.production
sudo -u hyperdeploy -H nano /opt/hyper-trading-agent/.env.production
```

至少设置下面项目。示例中的尖括号是占位符，不要原样保留：

```env
POSTGRES_PASSWORD=<随机数据库密码>
API_AUTH_KEY=<随机远程 API 密钥>
VIBE_TRADING_SECRET_KEY=<Fernet 格式的应用加密密钥>
VIBE_TRADING_COOKIE_SECURE=true
VIBE_TRADING_COOKIE_SAMESITE=lax
VIBE_TRADING_COOKIE_DOMAIN=
API_BIND=127.0.0.1
API_PORT=8899
VIBE_TRADING_TRUST_DOCKER_LOOPBACK=0
CORS_ORIGINS=https://agent.example.com
HYPER_TRADING_ALLOW_SELF_REGISTRATION=0
HYPER_TRADING_PLATFORM_ADMIN_EMAILS=owner@example.com

LANGCHAIN_PROVIDER=siliconflow
LANGCHAIN_MODEL_NAME=deepseek-ai/DeepSeek-V3.2
SILICONFLOW_BASE_URL=https://api.siliconflow.cn/v1
SILICONFLOW_API_KEY=<生产 SiliconFlow 密钥>

HYPER_TRADING_RUNTIME_JOB_BACKEND=redis-postgres
HYPER_TRADING_RUNTIME_JOB_QUEUE=hyper:runtime:jobs
HYPER_TRADING_VECTOR_STORAGE=postgres-pgvector
HYPER_TRADING_PGVECTOR_DIMENSIONS=1024
```

在服务器本机生成密码和 Fernet 密钥，复制各自的输出到 `.env.production`：

```bash
openssl rand -base64 36
openssl rand -base64 48
python3 -c "import base64, secrets; print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())"
```

依次用于 `POSTGRES_PASSWORD`、`API_AUTH_KEY`、`VIBE_TRADING_SECRET_KEY`。请把原始密钥保存到企业密码管理器或 Secret Manager，不能保存到提交历史、截图、聊天记录或任务日志。

### 5.1 关键配置说明

| 配置 | 生产建议 | 原因 |
| --- | --- | --- |
| `API_BIND` | `127.0.0.1` | API 不直接被公网访问 |
| `VIBE_TRADING_COOKIE_SECURE` | `true` | HTTPS 下 cookie 仅安全传输 |
| `CORS_ORIGINS` | 精确 HTTPS 域名 | 禁止 `*` 和 HTTP 地址 |
| `HYPER_TRADING_ALLOW_SELF_REGISTRATION` | `0` | 默认不能匿名注册 |
| `HYPER_TRADING_PLATFORM_ADMIN_EMAILS` | 首个管理员邮箱 | 仅授予 `/platform` 系统管理员能力 |
| `HYPER_TRADING_PGVECTOR_DIMENSIONS` | `1024` | 与默认 `BAAI/bge-m3` embedding 维度一致 |

组织 Owner 和 Platform Admin 是两个概念。Owner 管理本组织成员、模型和知识库；只有明确写入 `HYPER_TRADING_PLATFORM_ADMIN_EMAILS` 的账号拥有全局 `/platform` 管理能力。

如果启用私有 S3/MinIO 保存原始上传文件，再设置：

```env
HYPER_TRADING_OBJECT_STORAGE_BACKEND=s3
HYPER_TRADING_OBJECT_STORAGE_ENDPOINT=http://minio:9000
HYPER_TRADING_OBJECT_STORAGE_BUCKET=hyper-trading-documents
HYPER_TRADING_OBJECT_STORAGE_ACCESS_KEY=<访问密钥>
HYPER_TRADING_OBJECT_STORAGE_SECRET_KEY=<访问密钥密码>
MINIO_ROOT_USER=<管理员用户名>
MINIO_ROOT_PASSWORD=<管理员密码>
```

首次启动命令需额外使用 `--profile object-storage`。未配置对象存储时保留默认 `local`，适用于单机部署。

## 6. 申请 HTTPS 证书

正式环境必须启用 HTTPS。以下使用 Let's Encrypt 的 Certbot 独立模式，在首次部署前申请证书：

```bash
sudo apt install -y certbot
sudo certbot certonly --standalone -d agent.example.com --email owner@example.com --agree-tos --no-eff-email
```

命令成功后，将证书复制到项目需要的目录：

```bash
sudo install -d -o hyperdeploy -g hyperdeploy -m 0700 /opt/hyper-trading-agent/certs
sudo install -o hyperdeploy -g hyperdeploy -m 0600 /etc/letsencrypt/live/agent.example.com/fullchain.pem /opt/hyper-trading-agent/certs/fullchain.pem
sudo install -o hyperdeploy -g hyperdeploy -m 0600 /etc/letsencrypt/live/agent.example.com/privkey.pem /opt/hyper-trading-agent/certs/privkey.pem
```

测试续期任务：

```bash
sudo certbot renew --dry-run
```

证书续期后需要把最新证书复制到 `certs/` 并重载 Nginx。推荐创建 Certbot deploy hook。使用 `sudoedit /etc/letsencrypt/renewal-hooks/deploy/hyper-trading-agent` 新建文件并写入以下内容，将域名替换为实际域名：

```bash
#!/usr/bin/env bash
set -euo pipefail

APP_DIR=/opt/hyper-trading-agent
DOMAIN=agent.example.com

install -d -o hyperdeploy -g hyperdeploy -m 0700 "$APP_DIR/certs"
install -o hyperdeploy -g hyperdeploy -m 0600 \
  "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" "$APP_DIR/certs/fullchain.pem"
install -o hyperdeploy -g hyperdeploy -m 0600 \
  "/etc/letsencrypt/live/$DOMAIN/privkey.pem" "$APP_DIR/certs/privkey.pem"

runuser -u hyperdeploy -- bash -lc \
  "cd '$APP_DIR' && docker compose --env-file .env.production -f docker-compose.prod.yml -f docker-compose.server.yml -f docker-compose.tls.yml exec -T gateway nginx -s reload"
```

设置权限后，再跑一次模拟续期：

```bash
sudo chmod 700 /etc/letsencrypt/renewal-hooks/deploy/hyper-trading-agent
sudo certbot renew --dry-run
```

如果公司已有 WAF、负载均衡或 CDN 终止 TLS，可由它托管证书。此时使用 HTTP 网关叠加层，并在部署环境中设置 `HYPER_TRADING_DEPLOY_TLS=0`；同时必须保证上游到用户浏览器仍为 HTTPS，并正确传递 `X-Forwarded-Proto`。

## 7. 首次 Docker 部署

切换到项目目录，用部署脚本启动。它会执行以下保护：

- 拒绝覆盖服务器工作树中的已跟踪修改；
- 只允许部署 `origin/main` 上可达的提交；
- 校验 Compose 配置；
- 构建并更新服务，运行 SQL migration；
- 验证服务状态、健康检查、匿名访问边界、pgvector 和表结构。

```bash
sudo -u hyperdeploy -H bash -lc '
  cd /opt/hyper-trading-agent
  chmod 700 scripts/deploy-production.sh scripts/verify-production.sh
  HYPER_TRADING_ENABLE_TLS=1 ./scripts/deploy-production.sh
'
```

若使用 MinIO，再改为：

```bash
sudo -u hyperdeploy -H bash -lc '
  cd /opt/hyper-trading-agent
  docker compose --profile object-storage --env-file .env.production -f docker-compose.prod.yml -f docker-compose.server.yml -f docker-compose.tls.yml up --build -d
'
```

检查服务和日志：

```bash
sudo -u hyperdeploy -H bash -lc 'cd /opt/hyper-trading-agent && docker compose --env-file .env.production -f docker-compose.prod.yml -f docker-compose.server.yml -f docker-compose.tls.yml ps'
sudo -u hyperdeploy -H bash -lc 'cd /opt/hyper-trading-agent && docker compose --env-file .env.production -f docker-compose.prod.yml logs --tail=200 api worker gateway'
curl --fail --silent https://agent.example.com/health
```

预期健康检查响应包含：

```json
{"status":"healthy"}
```

## 8. 创建首个组织和管理员

服务健康后，在服务器内部执行 bootstrap。密码应使用独立、足够长的生产密码；不要使用测试密码。

```bash
sudo -u hyperdeploy -H bash -lc '
  cd /opt/hyper-trading-agent
  SILICONFLOW_KEY="$(sed -n "s/^SILICONFLOW_API_KEY=//p" .env.production)"
  docker compose --env-file .env.production -f docker-compose.prod.yml exec api \
    python -m src.commercial.bootstrap \
    --email owner@example.com \
    --password "<强随机登录密码>" \
    --organization "Hyper Research" \
    --display-name "平台管理员" \
    --provider siliconflow \
    --model deepseek-ai/DeepSeek-V3.2 \
    --base-url https://api.siliconflow.cn/v1 \
    --api-key "$SILICONFLOW_KEY"
'
```

此命令会创建：

1. 一个组织；
2. 该组织的 Owner；
3. 加密保存的默认模型提供商配置。

浏览器打开 `https://agent.example.com`，先以该账号登录，再在系统中创建其他成员、模型配置和知识库。匿名访问只显示登录页；公开自注册默认关闭。

## 9. 配置 GitHub 自动部署

### 9.1 创建 Actions 登录服务器的专用密钥

这个密钥让 GitHub Actions 登录服务器运行部署脚本。它不能替代第 4 节服务器访问 GitHub 的只读密钥。

在安全的管理电脑生成一对新的部署密钥：

```bash
ssh-keygen -t ed25519 -C "github-actions-hyper-trading-production" -f ./hyper-trading-production-actions -N ""
```

将 `hyper-trading-production-actions.pub` 内容追加到服务器的 `/home/hyperdeploy/.ssh/authorized_keys`。建议用 `sudoedit` 编辑该文件并确认权限：

```bash
sudo chmod 700 /home/hyperdeploy/.ssh
sudo chmod 600 /home/hyperdeploy/.ssh/authorized_keys
sudo chown -R hyperdeploy:hyperdeploy /home/hyperdeploy/.ssh
```

私钥 `hyper-trading-production-actions` 仅保存到 GitHub Secret，生成后不要上传到网盘、聊天软件或代码仓库。

### 9.2 创建 GitHub Production Environment

在仓库中进入：

```text
Settings -> Environments -> New environment -> production
```

建议启用 Required reviewers。这样即使 `main` 已经通过 CI，也需要指定发布负责人确认后才会触发服务器更新。

在 `production` Environment 中添加以下 Secrets：

| Secret 名称 | 填写内容 |
| --- | --- |
| `HYPER_TRADING_DEPLOY_HOST` | `agent.example.com` 或服务器 IP |
| `HYPER_TRADING_DEPLOY_USER` | `hyperdeploy` |
| `HYPER_TRADING_DEPLOY_PORT` | `22` 或实际 SSH 端口 |
| `HYPER_TRADING_DEPLOY_PATH` | `/opt/hyper-trading-agent` |
| `HYPER_TRADING_DEPLOY_SSH_KEY` | `hyper-trading-production-actions` 私钥完整内容 |
| `HYPER_TRADING_DEPLOY_KNOWN_HOSTS` | 服务器 SSH 主机公钥的固定 known_hosts 行 |

生成 `HYPER_TRADING_DEPLOY_KNOWN_HOSTS` 前，必须先从可信途径核对服务器 SSH 指纹。确认后在管理电脑执行：

```bash
ssh-keyscan -H -p 22 agent.example.com
```

将输出完整粘贴到 Secret 中。不要为了省事设置 `StrictHostKeyChecking=no`，工作流已强制校验固定主机指纹。

在同一个 `production` Environment 的 Variables 中增加：

| Variable 名称 | 值 | 适用场景 |
| --- | --- | --- |
| `HYPER_TRADING_DEPLOY_TLS` | `1` | 项目内 Nginx 管理 HTTPS，推荐 |
| `HYPER_TRADING_DEPLOY_TLS` | `0` | 由外部受信任网关终止 TLS |

不要把 `POSTGRES_PASSWORD`、`SILICONFLOW_API_KEY`、`API_AUTH_KEY`、`VIBE_TRADING_SECRET_KEY` 放进 GitHub Secrets。它们只保存在生产服务器的 `.env.production` 或企业 Secret Manager。

### 9.3 自动部署的触发规则

仓库中的 `.github/workflows/test.yml` 负责 `CI`：后端测试、前端构建、前端测试。`.github/workflows/deploy-production.yml` 只在以下条件都满足时发布：

1. `main` 上的 CI 运行成功；
2. CI 来自当前仓库，而非外部 fork；
3. GitHub `production` Environment 审批通过（如启用审批）；
4. 部署提交仍是 `origin/main` 的祖先。

部署脚本会使用确定的 commit SHA 进入 detached HEAD，这在服务器上是正常的，不能在服务器工作目录直接开发或修改已跟踪文件。

## 10. 日常开发与一键上线流程

推荐使用 Pull Request：

```bash
git checkout main
git pull --ff-only origin main
git checkout -b feature/knowledge-improvement

# 开发、进行必要的本地检查、提交代码
git add <本次修改的文件>
git commit -m "feat(knowledge): 改进知识库检索"
git push -u origin feature/knowledge-improvement
```

然后在 GitHub 创建 Pull Request 到 `main`：

1. PR CI 成功后进行代码审查；
2. 合并到 `main`；
3. GitHub 自动触发 `Deploy Production`；
4. 如果启用 `production` 审批，在 Actions 页面点击批准；
5. 工作流成功即代表目标服务器已重建并完成基础健康校验。

对已经允许直接推送 `main` 的小型团队，也可以：

```bash
git push origin HEAD:main
```

推送不是直接 SSH 发布；它只触发 GitHub CI，CI 成功后才自动部署。因此开发人员不需要登录生产服务器执行更新命令。生产分支建议开启保护规则，要求 PR、通过 CI 和至少一名审批人。

### 10.1 从 GitHub 手动再次发布

需要重新发布已测试的版本时，在 GitHub 进入：

```text
Actions -> Deploy Production -> Run workflow
```

输入 `main` 或指定的已验证 commit SHA，点击运行。工作流仍会拒绝不属于 `main` 历史的提交。适用于容器重启、发布失败后的重试和明确指定版本的回滚。

## 11. 验证、监控与排障

### 11.1 常用服务器命令

以下命令都在 `/opt/hyper-trading-agent` 执行：

```bash
cd /opt/hyper-trading-agent

docker compose --env-file .env.production -f docker-compose.prod.yml -f docker-compose.server.yml -f docker-compose.tls.yml ps
docker compose --env-file .env.production -f docker-compose.prod.yml -f docker-compose.server.yml -f docker-compose.tls.yml logs --tail=200 api
docker compose --env-file .env.production -f docker-compose.prod.yml -f docker-compose.server.yml -f docker-compose.tls.yml logs --tail=200 worker
docker compose --env-file .env.production -f docker-compose.prod.yml -f docker-compose.server.yml -f docker-compose.tls.yml logs --tail=200 gateway

HYPER_TRADING_ENABLE_TLS=1 ./scripts/verify-production.sh
curl --fail --silent http://127.0.0.1:8899/health
```

`verify-production.sh` 只做无破坏验证：服务运行状态、`/health`、匿名访问 `/sessions` 返回 `401`、pgvector 可用性和 `rag_vector_chunks` migration。

### 11.2 常见问题

| 现象 | 排查与处理 |
| --- | --- |
| Actions 无法 SSH | 检查部署用户、端口、私钥、公钥是否在 `authorized_keys`、安全组和 `HYPER_TRADING_DEPLOY_KNOWN_HOSTS` 是否匹配 |
| Actions 报“not contained in origin/main” | 只能部署已经合并到 `main` 的 SHA；重新选择 `main` 或正确的历史 SHA |
| `gateway` 无法启动 | 检查 `certs/fullchain.pem`、`certs/privkey.pem` 存在且可读，确认 `80/443` 未被其他服务占用 |
| 登录失败或 cookie 不保存 | HTTPS 下 `VIBE_TRADING_COOKIE_SECURE=true`；`CORS_ORIGINS` 必须是精确的 `https://` 域名；检查浏览器没有访问 HTTP 地址 |
| 模型调用失败 | 先在系统模型配置中运行连接测试，再检查生产供应商额度、区域和模型权限；不要把密钥写入日志 |
| 向量检索不可用 | 检查 `postgres`、migration、`HYPER_TRADING_VECTOR_STORAGE=postgres-pgvector` 与 embedding 维度；运行 `verify-production.sh` |
| 部署脚本拒绝覆盖本地修改 | 不要在服务器编辑跟踪文件。先检查 `git status`，将真正的配置放入 `.env.production` 或受控配置目录 |
| API 端口能被公网访问 | 立刻检查云安全组/UFW，确保未开放 `8899`，且 `.env.production` 的 `API_BIND=127.0.0.1` |

### 11.3 查看 GitHub 发布日志

进入：

```text
Actions -> Deploy Production -> 对应运行记录
```

重点查看 `Validate deployment configuration`、`Configure SSH trust` 和 `Deploy tested main commit` 三个步骤。不要在 Actions 日志中打印 `.env.production`、证书或密钥。

## 12. 回滚策略

应用代码回滚可通过 GitHub 手动发布完成：

1. 在 Actions 的历史成功运行中找到上一个稳定版本 SHA；
2. 进入 `Deploy Production -> Run workflow`；
3. 填入该 SHA 并运行；
4. 观察生产环境审批和发布日志；
5. 在服务器运行 `HYPER_TRADING_ENABLE_TLS=1 ./scripts/verify-production.sh`。

部署脚本允许该 SHA 的前提是它仍在 `main` 的提交历史中。

> 数据库 migration 通常不可逆。代码回滚不会自动撤销数据库 schema 或数据变化。包含 migration 的发布前必须备份数据库和应用卷；需要数据回滚时，先在隔离环境演练恢复流程。

详细步骤参见：[备份与恢复演练](operations-backup-restore.md)。密钥泄露、供应商密钥更新或应用根密钥轮换参见：[密钥轮换](operations-secret-rotation.md)。

## 13. 运营基线清单

首次上线前确认：

- [ ] DNS 已指向服务器，`80/443` 防火墙放通。
- [ ] Docker Compose v2 可运行，`hyperdeploy` 已加入 `docker` 组。
- [ ] `.env.production` 权限为 `600`，未被 Git 跟踪。
- [ ] `API_BIND=127.0.0.1`、HTTPS cookie、精确 CORS 和 Platform Admin 邮箱已配置。
- [ ] TLS 证书已申请、已复制到 `certs/`，续期 hook 已验证。
- [ ] 首个组织 Owner 已创建，默认模型已在界面中测试。
- [ ] GitHub `production` Environment、SSH Secrets、固定 known_hosts 和审批规则已配置。
- [ ] `Deploy Production` 运行成功，`verify-production.sh` 通过。
- [ ] PostgreSQL、Docker 卷和对象存储已配置备份；至少完成一次恢复演练。

每次发布后确认：

- [ ] GitHub CI 成功，且 `Deploy Production` 使用了预期 SHA。
- [ ] `gateway`、`api`、`worker`、`postgres`、`redis` 均为运行状态。
- [ ] 公网 HTTPS 健康检查成功，未登录用户只能看到登录界面。
- [ ] 模型连接、一次 Agent 对话、知识库检索和后台任务状态正常。
- [ ] 不存在异常的 4xx/5xx 日志、模型调用失败或队列积压。

## 14. 相关文档

- [自动部署技术说明](deployment-automation.md)
- [服务器与 Nginx/TLS 部署说明](deployment-server.md)
- [备份与恢复演练](operations-backup-restore.md)
- [密钥轮换与加密迁移](operations-secret-rotation.md)
- [生产环境变量模板](../.env.production.example)
