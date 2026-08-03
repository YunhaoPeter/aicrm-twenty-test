# ECS 运行时补丁（同步到本地与 Git）

本目录保存 2026-07-29 在阿里云 ECS 上手工应用到 Twenty 容器编译产物里的补丁，目的是让补丁进入 Git、可在本地与 ECS 复现，不再出现“生产有补丁、仓库没有”的漂移。

## 文件说明

| 文件 | 用途 |
|---|---|
| `admin-panel-guard.js` | 修复 `/admin-panel` 403 的完整编译产物（基于 v2.24.1 原文件，只改 `canActivate`） |
| `modify_resolver.js` | 修复 AI Provider 空列表的 Node 脚本（替换 `getModelsDevProviders` 方法） |
| `Dockerfile.guard` | 构建 `twentycrm/twenty:guarded`：叠加 guard 补丁 |
| `Dockerfile.resolver` | 构建 `twentycrm/twenty:resolved`：在 guarded 基础上叠加 resolver 补丁 |
| `build-images.sh` | 一键构建 `guarded` 与 `resolved` 两个镜像 |
| `env.example` | 环境变量模板（本地/ECS 各自复制为 `.env` 后填值，不要提交真实 `.env`） |

## 一、把 ECS 上的修改拉回本地（核对用）

这些文件来自部署对话记录；落地前建议与 ECS 上的实际文件 diff 一次，确认无遗漏：

```bash
# 在本地 Mac 执行
mkdir -p /tmp/ecs-sync && cd /tmp/ecs-sync
scp root@8.153.204.48:/opt/twenty-crm/correct-guard.js ./correct-guard.js
scp root@8.153.204.48:/opt/twenty-crm/modify_resolver.js ./modify_resolver.js
scp root@8.153.204.48:/opt/twenty-crm/Dockerfile.guard ./Dockerfile.guard
scp root@8.153.204.48:/opt/twenty-crm/Dockerfile.resolver ./Dockerfile.resolver

# 对比仓库里的版本
diff -u /Users/peteryhzhang/Documents/AI\ Native\ CRM/twenty/patches/admin-panel-guard.js correct-guard.js
diff -u /Users/peteryhzhang/Documents/AI\ Native\ CRM/twenty/patches/modify_resolver.js modify_resolver.js
```

也可以直接从运行中的容器拉原始/已修改文件：

```bash
cd /opt/twenty-crm
docker compose cp server:/app/packages/twenty-server/dist/engine/guards/admin-panel-guard.js ./admin-panel-guard.js
docker compose cp server:/app/packages/twenty-server/dist/engine/core-modules/admin-panel/admin-panel.resolver.js ./admin-panel.resolver.js
```

## 二、在本地用同一套流程构建镜像

前提：本机 Docker 可用，已有 `twentycrm/twenty:latest`（v2.24.1 基线）。

```bash
cd /Users/peteryhzhang/Documents/AI\ Native\ CRM/twenty/patches
chmod +x build-images.sh modify_resolver.js
./build-images.sh
```

脚本会依次：构建 `guarded` → 从 `guarded` 镜像导出编译后的 resolver → 应用 resolver 补丁 → 构建 `resolved`。

本地与 ECS 保持一致的方式：两边 `.env` 都用同一个 `TAG`（如 `guarded` 或 `resolved`），并从同一 Git commit 构建镜像。

## 三、提交到 Git

```bash
cd /Users/peteryhzhang/Documents/AI\ Native\ CRM/twenty
git add Agent.md docs/ patches/
git commit -m "docs: add Agent guide and sync ECS runtime patches"
git push yunhao initial-clean:main
```

注意：`packages/twenty-docker/.env` 与任何真实密钥都不能提交；只提交 `patches/env.example`。

## 四、当前镜像标签

| 标签 | 内容 | 状态 |
|---|---|---|
| `twentycrm/twenty:latest` | 官方 v2.24.1 基线 | 基础镜像 |
| `twentycrm/twenty:patched` | 早期 docker commit，require 路径错误 | 废弃 |
| `twentycrm/twenty:guarded` | guard 补丁 | 当前 ECS 运行标签 |
| `twentycrm/twenty:resolved` | guard + resolver 双补丁 | 可用，未作为默认 |
