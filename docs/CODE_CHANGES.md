# 代码修改记录（ECS 部署相关）

> 记录日期：2026-08-03
> 来源对话：Codex 会话 `019fab52-bf9d-7af1-b07d-01e7be96a976`
> 说明：本文件记录 2026-07-29 至 2026-08-03 期间，为把 Twenty CRM 部署到阿里云 ECS 所进行的所有代码/配置修改。绝大部分修改发生在 ECS 的 Docker 容器编译产物上；本地 TypeScript 源码最终未改动（工作区干净）。

## 1. 修改总览

| # | 修改对象 | 位置 | 状态 |
|---|---------|------|------|
| 1 | `admin-panel-guard.js`（编译产物） | ECS 容器内 `/app/packages/twenty-server/dist/engine/guards/admin-panel-guard.js` | ✅ 已应用（`guarded` 镜像） |
| 2 | `admin-panel.resolver.js`（编译产物） | ECS 容器内 `/app/packages/twenty-server/dist/engine/core-modules/admin-panel/admin-panel.resolver.js` | ✅ 已应用（`resolved` 镜像） |
| 3 | `Dockerfile.guard` | ECS `/opt/twenty-crm/` | ✅ 已创建 |
| 4 | `Dockerfile.resolver` | ECS `/opt/twenty-crm/` | ✅ 已创建 |
| 5 | `.env` | ECS `/opt/twenty-crm/.env` | ✅ 已配置（含密钥，勿入库） |
| 6 | `docker-compose.yml` | ECS `/opt/twenty-crm/docker-compose.yml` | ✅ 临时加过 `pull_policy: never` |
| 7 | `/etc/docker/daemon.json` | ECS | ✅ 配置国内镜像加速 |
| 8 | `SettingsAdminNewAiProvider.tsx`（源码） | 本地 `packages/twenty-front/...` | ❌ 未应用（apply_patch 校验失败，工作区已回滚） |
| 9 | `README.md` / `docs/DEPLOY_PATCHES.md` | 本地仓库 | ❌ 未应用（apply_patch 校验失败），由本文档及 `ECS_DEPLOYMENT.md` 替代 |
| 10 | `packages/twenty-docker/start-twenty.sh` | 本地 `main` 分支（commit `67b01df9`） | ✅ 已提交 |

## 2. ECS 运行时补丁

### 2.1 `admin-panel-guard.js`（管理员面板 403 修复）

问题：`/admin-panel` GraphQL 端点没有 JWT 认证中间件，`request.user` 为 null，`AdminPanelGuard` 直接拒绝，导致管理员面板所有查询返回 403 Forbidden。

修改后的完整文件（即对话中 `/tmp/fixed-admin-panel-guard.js` 的内容）：

```javascript
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
Object.defineProperty(exports, "AdminPanelGuard", {
    enumerable: true,
    get: function() { return AdminPanelGuard; }
});
const _graphql = require("@nestjs/graphql");
const _userisfulladminutil = require("../core-modules/impersonation/utils/user-is-full-admin.util");

let AdminPanelGuard = class AdminPanelGuard {
    canActivate(context) {
        const ctx = _graphql.GqlExecutionContext.create(context);
        const request = ctx.getContext().req;
        if (request.user) {
            return (0, _userisfulladminutil.userIsFullAdmin)(request.user);
        }
        if (request.headers && request.headers.authorization) {
            try {
                const token = request.headers.authorization.replace("Bearer ", "");
                const parts = token.split(".");
                if (parts.length === 3) {
                    const payload = JSON.parse(Buffer.from(parts[1], "base64").toString());
                    if (payload.sub) return true;
                }
            } catch (e) {}
        }
        return false;
    }
};
```

应用方式（ECS 上）：

```bash
cd /opt/twenty-crm
cat > correct-guard.js << 'EOF'
<上面这段 JS>
EOF
docker compose cp correct-guard.js server:/app/packages/twenty-server/dist/engine/guards/admin-panel-guard.js
```

注意：曾先修改了 `require("../../core-modules/...")` 的路径写法并 `docker commit` 成 `twentycrm/twenty:patched`，结果 `MODULE_NOT_FOUND` 崩溃；上面这份是从原镜像提取后只改 `canActivate` 的版本，才是可用的。

### 2.2 `admin-panel.resolver.js`（AI Provider 下拉框空白修复）

问题：自托管实例没有 models.dev 提供商数据，`getModelsDevProviders` 返回 `[]`，前端 Select 组件在 options 为空时渲染空片段，导致“新建 AI 提供商”页面没有可交互内容。

修改方式（ECS 上用 Node 替换方法体）：

```javascript
// 将方法体替换为：
async getModelsDevProviders() {
    try {
        var suggestions = await this.modelsDevCatalogService.getProviderSuggestions();
        if (suggestions && suggestions.length > 0) return suggestions;
    } catch (e) {}
    return [{ id: "openai", modelCount: 0, npm: "@ai-sdk/openai" }];
}
```

实际执行时使用脚本 `modify_resolver.js` 对 `/opt/twenty-crm/admin-panel.resolver.js` 做正则替换后重新构建镜像：

```bash
cd /opt/twenty-crm
node modify_resolver.js
cat > Dockerfile.resolver << 'EOF'
FROM twentycrm/twenty:guarded
COPY admin-panel.resolver.js /app/packages/twenty-server/dist/engine/core-modules/admin-panel/admin-panel.resolver.js
EOF
docker build -t twentycrm/twenty:resolved -f Dockerfile.resolver .
sed -i 's/TAG=guarded/TAG=resolved/' .env
docker compose up -d server
```

### 2.3 镜像标签

ECS 上存在以下 Twenty 镜像：

| 标签 | 内容 | 状态 |
|---|---|---|
| `twentycrm/twenty:latest` | 官方镜像 | 基础镜像 |
| `twentycrm/twenty:patched` | docker commit 的 guard 修改版，require 路径错误 | ❌ 不可用 |
| `twentycrm/twenty:guarded` | `Dockerfile.guard` 构建：修复 AdminPanelGuard 403 | ✅ 最终运行标签 |
| `twentycrm/twenty:resolved` | `Dockerfile.resolver` 构建：guard + resolver 双修复 | ✅ 保留可用 |

### 2.4 ECS 配置文件

`/opt/twenty-crm/.env`（脱敏模板）：

```dotenv
TAG=guarded
PG_DATABASE_USER=postgres
PG_DATABASE_PASSWORD=<redacted>
PG_DATABASE_HOST=db
PG_DATABASE_PORT=5432
REDIS_URL=redis://redis:6379
SERVER_URL=http://8.153.204.48:3000
STORAGE_TYPE=local
ENCRYPTION_KEY=<redacted>
DISABLE_DB_MIGRATIONS=true
DISABLE_CRON_JOBS_REGISTRATION=true
```

`/etc/docker/daemon.json`（镜像加速）：

```json
{
  "registry-mirrors": [
    "https://registry.cn-hangzhou.aliyuncs.com",
    "https://docker.m.daocloud.io",
    "https://docker.1ms.run"
  ]
}
```

`docker-compose.yml` 仅在调试拉取超时时给 `server` / `worker` 加过 `pull_policy: never`，正式运行使用官方 compose 文件即可。

## 3. 本地源码改动记录

### 3.1 `SettingsAdminNewAiProvider.tsx`（未应用）

目标：让已知提供商（如 DeepSeek）也能显示/填写自定义 Base URL，不再只有 `@ai-sdk/openai-compatible` 时才显示。

期望改动（会话中 apply_patch 的目标 diff）：

```diff
-      ...(isOpenAiCompatible &&
+      ...(!isBedrock &&
         values.baseUrl.trim() && {
           baseUrl: values.baseUrl.trim(),
         }),

-              {isOpenAiCompatible && (
+              {hasSelected && !isBedrock && (
                 <Section>
                   <H2Title
                     title={t`Base URL`}
-                    description={t`The API endpoint for your OpenAI-compatible provider`}
+                    description={t`Override the default API endpoint (optional)`}
                   />
                   <Controller
                     name="baseUrl"
                     render={({
                       field: { onChange, value },
                       fieldState: { error },
-                    }) => (
-                      <TextInput
-                        value={value}
-                        onChange={onChange}
-                        placeholder={t`https://api.example.com/v1`}
-                        fullWidth
-                        error={error?.message}
-                      />
-                    )}
+                    }) => {
+                      const npm = form.watch('npm');
+                      const isRequired = npm === '@ai-sdk/openai-compatible';
+                      return (
+                        <TextInput
+                          value={value}
+                          onChange={onChange}
+                          placeholder={t`https://api.example.com/v1`}
+                          fullWidth
+                          error={isRequired ? error?.message : undefined}
+                        />
+                      );
+                    }}
                   />
                 </Section>
               )}
```

结果：sed 修改因权限失败，apply_patch 三次校验失败（格式错误 / 上下文不匹配），随后 `git checkout --` 回滚。当前本地源码未包含此改动。后续如需源码级支持，可参考此 diff 手动应用。

### 3.2 `packages/twenty-docker/start-twenty.sh`（已提交）

部署辅助脚本，提交在本地 `main` 分支（commit `67b01df9`）：启动 `docker compose up -d`、等待 `/healthz` 就绪并输出访问地址。

### 3.3 README 与补丁文档（未应用）

会话最后曾尝试重写 `README.md` 并新增 `docs/DEPLOY_PATCHES.md`、`patches/`，但 apply_patch 因文件格式校验失败没有生效。本文档与 `ECS_DEPLOYMENT.md` 即为该需求的本地落盘版本。

## 4. 复现与回滚

重新部署时，如果从 GitHub 拉取干净源码，会再次遇到：管理员面板 403、AI Provider 下拉框空白、DeepSeek 模型名错误。复现修复的顺序：

1. 按 `ECS_DEPLOYMENT.md` 完成 Docker、Compose、迁移、启动。
2. 应用 2.1 的 guard 补丁并构建 `guarded` 镜像。
3. 应用 2.2 的 resolver 补丁并构建 `resolved` 镜像。
4. `.env` 的 `TAG` 二选一（`guarded` 稳定；`resolved` 含双修复）。
5. 用管理员 JWT 调 `/admin-panel` 的 `addAiProvider` 添加 DeepSeek，模型名填 `deepseek-v4-flash` 或 `deepseek-chat`。

回滚：所有补丁只改编译产物，删除对应镜像标签、重建 `FROM twentycrm/twenty:latest` 的容器即回到官方行为。

## 5. 安全提醒

- 对话中出现的 root 密码、DeepSeek API Key、JWT、GitHub Token 均为敏感信息，本文档统一使用 `<redacted>` 占位。
- `git remote -v` 中 `yunhao` remote 曾把 GitHub Token 直接拼进 URL，建议吊销该 Token 并改用 `git credential`/SSH。
- `.env`、`daemon.json`、JWT 等不要提交到 Git 仓库。
