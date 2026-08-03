# Git 分支与发布工作流（AI Native CRM）

> 本文档是日常开发、版本管理、生产发布的完整流程。远端仓库：`YunhaoPeter/aicrm-twenty-test`（本地 remote 名 `yunhao`），官方上游：`twentyhq/twenty`（remote 名 `origin`）。

## 1. 当前 Git 现状

- GitHub `main`：干净 fork 快照（已包含 Agent 文档与 ECS 补丁，commit `cf6891dc`）。
- 本地 `initial-clean`：与 GitHub `main` 内容一致，当前默认开发基线。
- 本地 `main`：保留官方历史的分支（含 `start-twenty.sh`），建议改名为 `upstream-main` 避免混淆。
- 远端：`yunhao` 指向自己的仓库；`origin` 指向官方 Twenty。

## 2. 一次性初始化（只做一次）

```bash
cd /Users/peteryhzhang/Documents/AI\ Native\ CRM/twenty

# 1. 基于 GitHub main 创建 develop（日常集成分支）
git fetch yunhao
git checkout -b develop yunhao/main
git push -u yunhao develop

# 2. 把本地带官方历史的 main 改名，避免与生产 main 混淆
git branch -m main upstream-main

# 3. 本地以后统一用 develop 作为开发基线
git checkout develop
```

GitHub 设置里建议：
- `main` / `develop` 开启分支保护：要求 PR 审查通过后才能合并。
- 禁止直接 push 到 `main`，保证生产分支只从 release 流程进入。

## 3. 日常开发流程（本地修改 → 分支 → 合入）

```bash
# 1. 同步 develop 到最新
git checkout develop
git pull yunhao develop

# 2. 从 develop 切功能分支（命名：feature/xxx、fix/xxx、docs/xxx）
git checkout -b feature/xxx develop

# 3. 本地修改代码，随时查看改动
git status
git diff

# 4. 分步提交，message 遵循约定式提交
git add <具体文件>
git commit -m "feat: 增加 XX 功能"
git commit -m "fix: 修复 XX 问题"

# 5. 推送功能分支
git push -u yunhao feature/xxx

# 6. 在 GitHub 上开 PR：feature/xxx -> develop
#    等 review 通过后合并，合并方式建议 squash merge 或 merge commit

# 7. 合并后清理本地/远端分支
git push yunhao --delete feature/xxx
git checkout develop
git pull yunhao develop
git branch -d feature/xxx
```

分支命名建议：

| 前缀 | 用途 | 示例 |
|---|---|---|
| `feature/*` | 新功能 | `feature/ai-provider-page` |
| `fix/*` | 缺陷修复 | `fix/admin-panel-403` |
| `docs/*` | 文档 | `docs/git-workflow` |
| `refactor/*` | 重构 | `refactor/worker-startup` |
| `chore/*` | 杂项/构建 | `chore/ci-image-build` |

Commit message 建议：`feat:` / `fix:` / `docs:` / `refactor:` / `chore:` / `ci:` + 简短说明。

## 4. 生产发布流程

```bash
# 1. 从 develop 切 release 分支做发布前验证
git checkout -b release/v1.2.0 develop

# 2. 本地按该 commit 构建镜像验证（见 patches/build-images.sh）
#    验证通过后合入 main
git checkout main
git pull yunhao main
git merge --no-ff release/v1.2.0
git tag -a v1.2.0 -m "release v1.2.0"
git push yunhao main --tags

# 3. 部署 ECS：拉取对应 tag 的镜像/代码，改 .env 的 TAG 后重启
cd /opt/twenty-crm
docker compose pull
sed -i 's/TAG=guarded/TAG=v1.2.0/' .env
docker compose up -d

# 4. 把 release 变更并回 develop，删除 release 分支
git checkout develop
git merge --ff-only release/v1.2.0
git push yunhao develop
git branch -d release/v1.2.0
git push yunhao --delete release/v1.2.0
```

版本号规则：`v<major>.<minor>.<patch>`。破坏性变更升 major，新功能升 minor，修复升 patch。

## 5. 本地与 ECS 保持一致

1. Git 是唯一事实源：本地和 ECS 都从 Git 拿代码，ECS 不再手工改文件。
2. 每次发布用同一个镜像标签（`aicrm/twenty:<git-sha>` 或 `v1.2.0`），本地和 ECS 跑同一个构建产物。
3. ECS 运行时补丁已入库到 `patches/`，构建镜像时必须走 `patches/build-images.sh`，防止补丁丢失。
4. `.env` 不入 Git；本地/ECS 各自填值，只允许 `SERVER_URL`、密钥等环境差异。
5. 数据库迁移受控执行：升级前确认 `DISABLE_DB_MIGRATIONS=true`，手动跑 `yarn database:init:prod`。

## 6. 同步官方上游

```bash
git fetch origin
git checkout develop
git merge origin/main
# 解决冲突后提交推送
```

## 7. 常见问题

- **push 被拒（non-fast-forward）**：`git pull yunhao develop --rebase` 后再推。
- **误把代码提交到 main**：不要在本地直接改 main，把改动 cherry-pick 到 feature 分支后让 main 保持干净。
- **分支误删**：`git reflog` 找回 commit，再重建分支。
- **需要紧急修复**：从 `main` 切 `fix/*`，修复后 PR 到 `main`，再 cherry-pick 到 `develop`。
