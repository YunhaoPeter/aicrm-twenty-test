# Peter 的 AI Native CRM（Twenty CRM 二次开发版）

> 本文档是 Agent 的项目背景与操作手册。新对话开始后，请先通读本文档，再按需阅读 `docs/ECS_DEPLOYMENT.md` 与 `docs/CODE_CHANGES.md`，不要在缺少上下文的情况下修改部署或执行破坏性操作。

## 1. 项目定位

- 项目名称：AI Native CRM（Peter 专属二次开发版）。
- 上游：开源 [Twenty CRM](https://github.com/twentyhq/twenty)，当前基线版本 `v2.24.1`。
- 目标：在 Twenty CRM 基础上构建 AI 原生 CRM，包括 AI 提供商接入、智能助手、聊天流式输出、自动化等。
- 代码仓库：本目录 `twenty/` 是唯一代码仓库；GitHub 远端为 `YunhaoPeter/aicrm-twenty-test`（`main` 分支是干净 fork 快照 `f4734276`）。
- 工作区说明：上层 `/Users/peteryhzhang/Documents/AI Native CRM` 是外壳目录，包含一个无提交的 Git 仓库和本仓库；业务代码全部在 `twenty/` 内。

## 2. 技术架构

### 2.1 技术栈

- 前端：React + TypeScript + Vite（`packages/twenty-front`）。
- 后端：NestJS + GraphQL（`packages/twenty-server`），包含 `/graphql`、`/metadata`、`/admin-panel` 三个 GraphQL 端点。
- 数据库：PostgreSQL 16。
- 队列/缓存：Redis + BullMQ（worker 处理 AI 等异步任务）。
- AI：OpenAI 兼容接口，已接入 DeepSeek（`https://api.deepseek.com`），流式输出走 SSE。
- 存储：默认 `local` 本地卷（未接 S3/OSS）。

### 2.2 核心目录

```text
packages/
├── twenty-front/       # 前端应用
├── twenty-server/      # 后端服务（NestJS）
├── twenty-docker/      # Docker Compose 部署配置（本地与 ECS 共用）
├── twenty-ui/          # UI 组件库
├── twenty-shared/      # 共享类型与工具
└── ...
docs/
├── ECS_DEPLOYMENT.md   # ECS 部署完整记录
└── CODE_CHANGES.md     # 代码/运行时补丁记录
```

### 2.3 服务拓扑（Docker Compose）

| 服务 | 镜像 | 端口 | 作用 |
|---|---|---|---|
| `server` | `twentycrm/twenty:${TAG}` | 3000 | 前端静态资源 + NestJS API + GraphQL |
| `worker` | 同上 | - | BullMQ worker，处理 AI 聊天等异步任务 |
| `db` | `postgres:16` | 5432（容器内） | PostgreSQL，库名 `default` |
| `redis` | `redis` | 6379（容器内） | Redis 队列/缓存 |

## 3. 当前部署拓扑（重要）

### 3.1 本地 Docker（开发/测试环境）

- Compose 项目：`twenty`，配置文件：`packages/twenty-docker/docker-compose.yml`。
- 数据/密钥：`packages/twenty-docker/.env`（已被 `.gitignore` 忽略，不提交）。
- 运行状态（2026-08-03 实测）：`twenty-server-1`（healthy，映射 `0.0.0.0:3000`）、`twenty-worker-1`、`twenty-db-1`、`twenty-redis-1` 全部运行中。
- 镜像：`twentycrm/twenty:latest`（官方镜像，digest `sha256:cd812094...`，`APP_VERSION=v2.24.1`，未打自托管补丁）。
- 关键配置：`SERVER_URL=http://localhost:3000`，`STORAGE_TYPE=local`；server 的 `DISABLE_DB_MIGRATIONS` 为空，worker 由 compose 固定为 `true`。
- 开发模式另有 `docker-compose.dev.yml`（只启动 Postgres + Redis，端口 5432/6379，用于直接跑源码 `yarn start`）。
- 访问：`http://localhost:3000`。

### 3.2 阿里云 ECS（生产环境）

- 地址：`8.153.204.48`，系统 Alibaba Cloud Linux 3.2104 LTS，内存 4GB（曾因 2GB OOM）。
- 部署目录：`/opt/twenty-crm`（compose 文件 + `.env` + 补丁 Dockerfile + 补丁 JS）。
- 镜像：`twentycrm/twenty:guarded`（管理员面板 guard 补丁）为当前运行标签；`twentycrm/twenty:resolved`（guard + resolver 双补丁）保留可用；`patched` 因 require 路径错误已废弃。
- 关键配置：`SERVER_URL=http://8.153.204.48:3000`，`DISABLE_DB_MIGRATIONS=true`，`DISABLE_CRON_JOBS_REGISTRATION=true`，`STORAGE_TYPE=local`。
- 安全组开放：22、80、443、3000。
- 运行时补丁（只在 ECS 编译产物上，未写回源码）：
  1. `admin-panel-guard.js`：修复 `/admin-panel` 403（JWT 中间件缺失），对应补丁文件 `patches/correct-guard.js`。
  2. `admin-panel.resolver.js`：`getModelsDevProviders` 空数组时返回默认 OpenAI provider，修复 AI Provider 页面空白。
- 访问：`http://8.153.204.48:3000`。

### 3.3 两者关系

- 同一套源码、同一个上游基线 `v2.24.1`。
- 本地 = 官方镜像原样运行，代表“上游默认行为”。
- ECS = 官方镜像 + 两个运行时补丁 + 生产配置，代表“当前生产行为”。
- 差异来自**运行时修改没有回流到 Git/源码**，这正是后续要做一致性治理的原因。

### 3.4 主要差异表

| 维度 | 本地 Docker | ECS |
|---|---|---|
| 镜像标签 | `twentycrm/twenty:latest` | `twentycrm/twenty:guarded`（/`resolved`） |
| 运行时补丁 | 无 | guard + resolver 补丁 |
| SERVER_URL | `http://localhost:3000` | `http://8.153.204.48:3000` |
| DISABLE_DB_MIGRATIONS | server 空 / worker true | true |
| DISABLE_CRON_JOBS_REGISTRATION | server 空 / worker true | true |
| 内存 | 本机 Docker 资源充足 | 4GB（曾 2GB OOM） |
| 数据 | 本地 Docker volume | ECS Docker volume |
| 维护方式 | `docker compose` 直接管理 | SSH + `docker compose` |
| 补丁是否入 Git | 否 | 否（需治理） |

## 4. Git 与版本管理（目标工作流）

### 4.1 当前 Git 状态

- 远端：`origin` = 官方 `twentyhq/twenty`；`yunhao` = `YunhaoPeter/aicrm-twenty-test`（已去掉 URL 内嵌 Token，请用 `git credential`/SSH 认证）。
- 分支：
  - `initial-clean`：干净 fork 根（单提交 `f4734276`），已作为 GitHub `main` 推送。
  - `main`：保留官方历史的分支，比 `origin/main` 多一个 `start-twenty.sh` 提交（`67b01df9`）。
- 未提交内容：`docs/`（部署与补丁文档）、`patches/`（ECS 运行时补丁复现文件）、本 `Agent.md`。

### 4.2 推荐分支模型

| 分支 | 用途 | 说明 |
|---|---|---|
| `main` | 生产 | 只接受 release 合并，代码与 ECS 生产保持一致 |
| `develop` | 集成/预发 | 日常功能合并到这里，做联调和预发布验证 |
| `feature/*` | 功能开发 | 从 `develop` 切出，完成后 PR 回 `develop` |
| `fix/*` | 缺陷修复 | 同 feature，紧急修复可 PR 到 `main` |
| `release/*`、tag `v*` | 发布 | 从 `develop` 切 release 分支，验证后合入 `main` 并打 tag |

建议下一步把 `initial-clean` 作为新的 `main` 基础（或把 `develop` 从 `initial-clean` 切出），避免与带官方历史的旧 `main` 混淆。

### 4.3 日常开发流程

```bash
# 1. 同步并建分支
git checkout develop
git pull yunhao develop
git checkout -b feature/xxx

# 2. 本地代码开发/测试（任选）
#    A. 源码模式：docker compose -f docker-compose.dev.yml up -d + yarn start
#    B. Docker 生产镜像模式：cd packages/twenty-docker && docker compose up -d

# 3. 提交并推送
git add -A && git commit -m "feat: xxx"
git push yunhao feature/xxx

# 4. 在 GitHub 提 PR 到 develop，合并后删除 feature 分支
```

### 4.4 生产发布流程

```bash
# 1. develop 验证通过后切 release
git checkout -b release/v0.x.y develop
git checkout main && git merge --no-ff release/v0.x.y
git tag v0.x.y
git push yunhao main --tags

# 2. ECS 拉代码/镜像并发布
#    （推荐 CI/CD 自动做，手动时参考 docs/ECS_DEPLOYMENT.md）
ssh root@8.153.204.48
cd /opt/twenty-crm
git pull  # 如果 ECS 用 Git 部署
export TAG=v0.x.y
docker compose pull
docker compose up -d
```

### 4.5 保持本地与 ECS 一致的六条原则

1. **Git 是唯一事实源**：本地和 ECS 都只从 Git 拿代码/配置，ECS 上不再手工改文件。
2. **同一镜像标签**：本地和 ECS 使用同一个构建产物（如 `aicrm/twenty:<git-sha>` 或 release tag），禁止一边 `latest`、一边 `guarded` 漂移。
3. **补丁入库**：guard/resolver 补丁已整理到 `patches/`（`correct-guard.js`、`modify_resolver.js`、两个 Dockerfile、`build-images.sh`），本地与 ECS 用同一套构建流程应用，避免“生产有补丁、本地没有”。2026-08-03 已核对：guard 补丁与 ECS 生产一致；resolver 补丁当时未真正进入 ECS 的 `resolved` 镜像，需重新构建。使用方式见 `patches/README.md`。
4. **配置分离**：`.env` 不入 Git，维护 `.env.example`；本地/ECS 各自填值，仅允许 `SERVER_URL`、密钥等环境差异。
5. **迁移受控**：升级版本时手动跑迁移（`yarn database:init:prod`），不要在每次启动时自动迁移；`DISABLE_DB_MIGRATIONS=true` 作为稳定运行默认。
6. **CI/CD 同步**：push/merge 后由 CI 构建镜像并推送镜像仓库，ECS 只执行 `pull + up`；没有镜像仓库前，先保证两边用同一 Git commit + 同一构建脚本。

### 4.6 同步官方上游

```bash
git fetch origin
git checkout initial-clean
git merge origin/main   # 或 git rebase origin/main
# 处理冲突后按分支模型合并到 develop/main
```

## 5. 常用命令速查

### 5.1 本地

```bash
cd /Users/peteryhzhang/Documents/AI\ Native\ CRM/twenty/packages/twenty-docker
docker compose up -d            # 启动
docker compose ps               # 状态
docker compose logs -f server   # server 日志
docker compose logs -f worker   # worker 日志
docker compose down             # 停止（保留数据）
docker compose down -v          # 停止并清库（慎用）
curl http://localhost:3000/healthz
```

### 5.2 ECS

```bash
ssh root@8.153.204.48
cd /opt/twenty-crm
docker compose ps
docker compose logs -f server
docker compose logs -f worker
docker compose up -d
```

### 5.3 数据库迁移

```bash
cd /opt/twenty-crm   # 或本地对应目录
docker compose run --rm --entrypoint "" server yarn database:init:prod
docker compose exec -T db psql -U postgres -d default -c \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema IN ('core','metadata');"
```

## 6. 已知问题与补丁

| 问题 | 根因 | 修复位置 | 状态 |
|---|---|---|---|
| 管理员面板 403 | `/admin-panel` 缺 JWT 中间件，`request.user` 为 null | `admin-panel-guard.js`（编译产物） | ECS 已修复，补丁已同步到 `patches/correct-guard.js` |
| AI Provider 页面空白 | `getModelsDevProviders` 返回空数组，Select 不渲染 | `admin-panel.resolver.js`（编译产物） | ECS 已修复，未入 Git |
| DeepSeek 模型名报错 | 配置里带空格/大写，未填精确 API model id | 配置 `deepseek-v4-flash` / `deepseek-chat` | 已解决 |
| AI 聊天无回复 | worker 未启动 / OOM | 启动 worker；ECS 升 4GB；`DISABLE_DB_MIGRATIONS=true` | 已解决 |
| Docker Hub 拉取超时 | 国内网络 | `/etc/docker/daemon.json` 配国内镜像加速 | 已解决（仅 ECS） |
| 本地代理拦截 SSE | 本机代理端口如 `127.0.0.1:7897` | 排查 AI 流式输出时先关本地代理 | 已知注意点 |

补丁全文、Dockerfile 和复现步骤见 `docs/CODE_CHANGES.md`。

## 7. Agent 行为约定

1. 新对话先读本文件；涉及部署再读 `docs/ECS_DEPLOYMENT.md`、`docs/CODE_CHANGES.md`。
2. 永远不要在输出、文档、Git 提交里写入真实密钥：root 密码、DeepSeek API Key、JWT、GitHub Token 一律用 `<redacted>`/`<your-token>`。
3. ECS 为生产环境：默认只读；修改前先确认用户意图，所有代码改动先落 Git。
4. 日常任务默认操作 `twenty/` 仓库；上层外壳目录只是工作区容器。
5. 遇到本地/ECS 差异时，先对照第 3.4 节差异表再下结论。
6. 代码修改遵循 Twenty 现有模块边界和本地模式，避免无关重构。

## 8. 相关文档

- `docs/ECS_DEPLOYMENT.md`：ECS 部署步骤、.env 模板、迁移、问题时间线。
- `docs/CODE_CHANGES.md`：全部补丁内容、镜像标签、复现与回滚。
- `docs/GIT_WORKFLOW.md`：日常开发、分支管理、生产发布的完整流程。
- `patches/README.md`：把 ECS 修改同步到本地/Git 的操作步骤与镜像构建脚本。
- `packages/twenty-docker/`：Compose 文件、`.env.example`、`start-twenty.sh`。
