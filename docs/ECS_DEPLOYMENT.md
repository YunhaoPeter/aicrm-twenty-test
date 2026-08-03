# 阿里云 ECS 部署记录（Twenty CRM / AI Native CRM）

> 记录日期：2026-08-03
> 来源对话：Codex 会话 `019fab52-bf9d-7af1-b07d-01e7be96a976`（2026-07-29 ~ 2026-08-03）
> 说明：本文档记录 Twenty CRM 部署到阿里云 ECS 的完整方法、遇到的问题及最终运行状态。所有密钥、Token、密码均已脱敏，实际值只存在于 ECS 的 `.env` 与对话历史中，不要提交到 Git。

## 1. 项目与环境概览

| 项 | 值 |
|---|---|
| 项目 | Twenty CRM 二次开发版（Peter 的 AI Native CRM） |
| 源码仓库 | `twentyhq/twenty`（官方），本地 fork 已推送到 `YunhaoPeter/aicrm-twenty-test` |
| ECS 公网 IP | `8.153.204.48` |
| 系统 | Alibaba Cloud Linux 3.2104 LTS 64 位 |
| 内存 | 初始 2GB，2026-07-29 升配到 4GB（实测约 3.5Gi，全服务运行后剩余约 1.1Gi） |
| 登录方式 | root 密码登录（密码已脱敏）；SSH 端口 22 |
| 部署目录 | `/opt/twenty-crm` |
| 访问地址 | `http://8.153.204.48:3000` |

安全组（本实例安全组 `sg-uf6bp3p9nw8hfhdhtqdr`）开放端口：22、80、443、3000（3000 为部署时手动添加），另有系统默认的 RDP 3389 与 ICMP。

## 2. 部署前需要处理的阿里云配置

### 2.1 SSH 连不上（Connection reset by peer）

现象：TCP 22 端口能连通，但 SSH 协议握手阶段被 `Connection reset by peer`。

排查结果：服务器内部 `sshd_config`、iptables、`hosts.allow/deny` 均正常；ECS 上的 `AliYunDun` / `AliHips`（云安全中心主机入侵防御）在协议层拦截了 SSH。

解决办法：
1. 阿里云控制台 → 云安全中心 → 主机防护设置 → 暴力破解防护，一键关闭（或把本机公网 IP 加入白名单）。
2. 后续维护中 SSH 再次被拦截过，需要重新关闭/加白名单；本机 IP 曾为 `117.28.248.131`。
3. 临时方案：通过阿里云 Workbench 远程连接（不走 22 端口）进入服务器执行命令。

### 2.2 Docker Hub 拉取超时

国内访问 Docker Hub 不稳定，需配置镜像加速，最终可用的镜像源：

- `https://registry.cn-hangzhou.aliyuncs.com`
- `https://docker.m.daocloud.io`
- `https://docker.1ms.run`（最终主用）

## 3. Docker 与 Docker Compose 安装

ECS 为 Alibaba Cloud Linux 3（RHEL 系），官方 `get.docker.com` 脚本不可用，改用阿里云 Docker CE 镜像源：

```bash
yum-config-manager --add-repo https://mirrors.aliyun.com/docker-ce/linux/centos/docker-ce.repo
sed -i 's/\$releasever/8/g' /etc/yum.repos.d/docker-ce.repo
yum install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
systemctl enable --now docker
docker --version && docker compose version
```

过程中还试过静态二进制方案（`docker-27.4.0.tgz` + `docker-compose-linux-x86_64` v2.29.2），最终以包管理器安装的 Docker CE + compose plugin 为准。

## 4. 部署目录与 Compose 文件

```bash
mkdir -p /opt/twenty-crm && cd /opt/twenty-crm
curl -sL https://raw.githubusercontent.com/twentyhq/twenty/main/packages/twenty-docker/docker-compose.yml -o docker-compose.yml
```

官方 compose 定义 4 个服务：`server`（3000）、`worker`、`db`（PostgreSQL 16）、`redis`。后续为了使用本地构建的补丁镜像，在 `server` / `worker` 服务下临时加过 `pull_policy: never`，避免每次启动去 Docker Hub 拉取超时。

## 5. `.env` 配置（脱敏模板）

```bash
cd /opt/twenty-crm
TAG=guarded
PG_DATABASE_USER=postgres
PG_DATABASE_PASSWORD=<openssl rand -hex 16 生成，勿含特殊字符>
PG_DATABASE_HOST=db
PG_DATABASE_PORT=5432
REDIS_URL=redis://redis:6379
SERVER_URL=http://8.153.204.48:3000
STORAGE_TYPE=local
ENCRYPTION_KEY=<openssl rand -base64 32 生成>
FALLBACK_ENCRYPTION_KEY=
APP_SECRET=
DISABLE_DB_MIGRATIONS=true
DISABLE_CRON_JOBS_REGISTRATION=true
```

说明：
- 首次部署时 `DISABLE_DB_MIGRATIONS` 留空让 entrypoint 自动迁移，但曾出现“报 Successfully migrated DB! 但 core 表为 0”的假成功；最终改为手动迁移（见第 6 节），迁移完成后置为 `true`。
- `TAG` 最终为 `guarded`（使用打了 Admin Panel 补丁的本地镜像）。
- `DISABLE_CRON_JOBS_REGISTRATION=true` 可避免 worker 启动时重复注册 cron/迁移导致崩溃。

## 6. 数据库初始化与迁移

正确流程（避免 entrypoint 迁移假成功）：

```bash
cd /opt/twenty-crm
docker compose down -v --remove-orphans

# 只启动数据库和 Redis
docker compose up -d db redis
sleep 15

# 手动执行初始化迁移（绕过 entrypoint）
docker compose run --rm --entrypoint "" server yarn database:init:prod

# 校验表数量（core / metadata schema 应非空）
docker compose exec -T db psql -U postgres -d default -c \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema IN ('core','metadata');"

# 迁移完成后关闭自动迁移，再启动 server
sed -i 's/DISABLE_DB_MIGRATIONS=false/DISABLE_DB_MIGRATIONS=true/' .env
docker compose up -d server
```

## 7. 启动与健康检查

```bash
cd /opt/twenty-crm
docker compose up -d
docker compose ps
curl -sf http://localhost:3000/healthz
```

- server 健康检查：`curl --fail http://localhost:3000/healthz`，返回 `{"status":"ok"}` 即正常。
- 外部访问：`http://8.153.204.48:3000`（需安全组开放 3000）。

## 8. 运行时补丁（管理员面板 / AI Provider）

ECS 上所有代码修改都针对容器内**编译后的 JS**，本地 TypeScript 源码未改动。

### 8.1 管理员面板 403（`AdminPanelGuard`）

根因：`/admin-panel` 独立 GraphQL 端点缺少 JWT 认证中间件，`request.user` 为 null，`AdminPanelGuard` 返回 403。

修复：修改编译产物 `admin-panel-guard.js`，当 `request.user` 为空时解析 Authorization header 中的 JWT（校验 `sub` 存在即放行）。补丁文件全文见 [CODE_CHANGES.md](CODE_CHANGES.md)。

镜像制作：

```bash
cd /opt/twenty-crm
cat > Dockerfile.guard << 'EOF'
FROM twentycrm/twenty:latest
COPY correct-guard.js /app/packages/twenty-server/dist/engine/guards/admin-panel-guard.js
EOF
docker build -t twentycrm/twenty:guarded -f Dockerfile.guard .
sed -i 's/TAG=latest/TAG=guarded/' .env
docker compose up -d server
```

曾先通过 `docker compose cp` 直接改运行中容器并 `docker commit` 成 `twentycrm/twenty:patched`，但 require 路径写错导致 `MODULE_NOT_FOUND`，已废弃。

### 8.2 AI Provider 下拉框空白（`getModelsDevProviders` 返回空）

根因：自托管实例没有 models.dev 提供商数据，`getModelsDevProviders` 返回 `[]`，前端 Select 组件在 options 为空时直接不渲染。

修复：修改编译产物 `admin-panel.resolver.js`，空结果时返回一个默认 OpenAI 兼容 provider：

```js
async getModelsDevProviders() {
    try {
        var suggestions = await this.modelsDevCatalogService.getProviderSuggestions();
        if (suggestions && suggestions.length > 0) return suggestions;
    } catch (e) {}
    return [{ id: "openai", modelCount: 0, npm: "@ai-sdk/openai" }];
}
```

镜像制作：

```bash
cd /opt/twenty-crm
cat > Dockerfile.resolver << 'EOF'
FROM twentycrm/twenty:guarded
COPY admin-panel.resolver.js /app/packages/twenty-server/dist/engine/core-modules/admin-panel/admin-panel.resolver.js
EOF
docker build -t twentycrm/twenty:resolved -f Dockerfile.resolver .
sed -i 's/TAG=guarded/TAG=resolved/' .env
docker compose up -d server
```

后续为稳定性把运行标签回退到 `guarded`；`resolved` 镜像保留在 ECS 上，重新启用时改 `.env` 的 `TAG=resolved` 即可。

## 9. DeepSeek AI 提供商配置

通过管理员面板 GraphQL 端点直接添加（需带用户 JWT，Token 已脱敏）：

```bash
curl -s -X POST http://localhost:3000/admin-panel \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -d '{"query":"mutation{addAiProvider(providerName:\"deepseek\",providerConfig:{npm:\"@ai-sdk/openai-compatible\",label:\"Deepseek V4\",apiKey:\"<DEEPSEEK_API_KEY>\",baseUrl:\"https://api.deepseek.com\"})}"}'
```

模型名注意点：DeepSeek API 直接测试 `deepseek-chat`、`deepseek-v4-flash`、`deepseek-v4-pro` 均可调用；Twenty 的模型名必须填**精确的 API model id**。曾出现错误：`The supported API model names are deepseek-v4-pro or deepseek-v4-flash, but you passed DeepSeek V4 Pro (deepseek-v4-pro)`，原因是配置里带了大写/空格。推荐：

| Model name（API 名称） | Display name（显示名称） |
|---|---|
| `deepseek-v4-flash` | Deepseek V4 Flash |
| `deepseek-chat` | Deepseek Chat |

## 10. Worker 与 AI 聊天

AI 聊天链路：前端 `SendChatMessage` → `/metadata` 写入消息 → Worker（BullMQ）调 DeepSeek → SSE 推回前端。

- 官方镜像包含 worker：`/app/packages/twenty-server/dist/queue-worker/`，启动命令为 compose 中的 `yarn worker:prod`。
- 启动：`docker compose up -d worker`。
- 2GB 内存下同时跑 server + worker 会 OOM（四个服务约 1.85GB），表现为 502 / SSH 和 3000 端口失联；升配到 4GB 后稳定。
- Worker 崩溃的另一原因：`DISABLE_DB_MIGRATIONS=false` 时启动即跑迁移失败；置为 `true` 后正常。
- 前端本地代理（如 `127.0.0.1:7897`）可能拦截 SSE 流，排查 AI 无响应时可先关闭本地代理。

## 11. GitHub 同步记录

- 本地仓库原本是 `twentyhq/twenty` 的浅克隆，直接推送完整历史会报 `remote unpack failed / index-pack failed`（本地缺少历史对象）。
- 旧仓库 `YunhaoPeter/ai-crm-twenty-test` 推送失败后，新建 `YunhaoPeter/aicrm-twenty-test`。
- 使用 orphan 分支生成无历史的干净快照：

```bash
git checkout --orphan initial-clean
git add -A
git commit -m "Initial commit: Twenty CRM fork for secondary development"
git push https://<GITHUB_TOKEN>@github.com/YunhaoPeter/aicrm-twenty-test.git HEAD:main
```

- 仓库含 `.github/workflows`，GitHub Token 需要同时勾选 `repo` 与 `workflow` 权限，否则推送被拒。
- 本地另有一条 `main` 分支保留官方历史，并提交了 `feat: add start-twenty deployment helper script`（`packages/twenty-docker/start-twenty.sh`）。
- 注意：`git remote -v` 中曾把 Token 直接拼进 remote URL（`yunhao`），Token 已暴露在对话/仓库配置中，建议尽快在 GitHub 吊销并改用 `git credential` 或 SSH。

## 12. 常用维护命令

```bash
cd /opt/twenty-crm
docker compose ps                 # 查看状态
docker compose logs -f server     # server 日志
docker compose logs -f worker     # worker 日志
docker compose up -d              # 启动全部
docker compose down               # 停止（不加 -v，保留数据）
docker compose down -v            # 停止并清空数据库卷（慎用）
curl http://localhost:3000/healthz
```

## 13. 问题时间线（摘要）

| 时间 | 问题 | 结论/修复 |
|---|---|---|
| 07-29 00:42~02:04 | SSH 握手被重置 | 阿里云安全中心暴力破解防护/AliHips 拦截；关闭防护或加白名单 |
| 07-29 02:04~03:09 | Docker Hub 超时 | 换阿里云/1ms/DaoCloud 镜像加速 |
| 07-29 03:20~05:04 | “无法访问后端” | 迁移假成功，core 表为 0；手动跑 `database:init:prod` 后恢复 |
| 07-29 05:36~06:15 | 管理员面板 403 | 编译产物 `AdminPanelGuard` 补丁 + `guarded` 镜像 |
| 07-29 06:34~07:07 | AI Provider 页面空白 | resolver 返回空数组；补丁默认 provider + `resolved` 镜像，后用 API 直接添加 DeepSeek |
| 07-29 07:13~08:13 | AI 聊天无响应 | Worker 未启动 + OOM；启动 worker、升配 4GB、`DISABLE_DB_MIGRATIONS=true` |
| 07-29 07:59~08:09 | 502 / 服务失联 | 2GB OOM；升配到 4GB 后 server+worker 稳定 |
| 07-29 08:13 | 模型名错误 | 填精确 API model id（`deepseek-v4-flash` / `deepseek-chat`） |
| 08-03 | 推送 GitHub 失败 | 浅克隆历史缺失 + workflow 权限；orphan 单提交推送到新仓库成功 |
