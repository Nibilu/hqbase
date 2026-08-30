# Fork 维护与同步策略（Nibilu/hqbase）

本文档定义 `Nibilu/hqbase`（fork）与 `HQBase/hqbase`（upstream）之间的同步节奏与开发流程，作为 fork 上定制工作的最低约束。

## 仓库结构

| 仓库 | 角色 | 默认分支 | 用途 |
|---|---|---|---|
| `HQBase/hqbase` | upstream | `main` | 仅消费，不直接 push |
| `Nibilu/hqbase` | fork / 开发基线 | `main` | 定制 + 部署的承载 |

`Nibilu/hqbase` 必须在每次 PR 合并前与 `HQBase/hqbase:main` 同步到可线性 rebase 的状态。

## 分支命名规范

| 前缀 | 用途 | 例子 |
|---|---|---|
| `custom/fou-<scope>-<short>` | FOU 项目（hqbase shared inbox）相关工作 | `custom/fou-x4-requirements-intake` |
| `feat/<scope>-<short>` | 上游未涵盖的通用新功能 | `feat/audit-export-csv` |
| `fix/<scope>-<short>` | 紧急修复 | `fix/oauth-redirect-loop` |
| `chore/<scope>-<short>` | 杂项（依赖、文档、CI） | `chore/bump-pnpm-12` |

**禁止**：

- 直接 commit 到 `main`
- 使用 `agent/<user>/<ticket>` 之外的旧风格前缀（仅在 agent 自动分支时使用）

## 同步节奏

| 频率 | 动作 | 负责人 |
|---|---|---|
| 每周一 | `git fetch upstream && git rebase upstream/main` 准备 rebase PR | Mika（自动脚本）或人为手动 |
| 每次 PR 合并前 | `git rebase upstream/main` + 解决冲突 | PR 作者 |
| upstream 大版本发布后 24h | 创建 `chore/sync-upstream-<date>` PR | Mika |

冲突高发路径（按经验排序）：

1. `migrations/` 和 `migrations-after-deploy/`：upstream 新增 schema 时与定制 schema 重名 → 用前缀 `custom_*`
2. `package.json` + `pnpm-lock.yaml`：依赖版本冲突 → 优先 upstream，定制依赖放 `dependencies.optional` 或本地 patch
3. `wrangler.toml` 与 `.hqbase/deployments/*`：binding 名称冲突 → 定制 binding 用 `CUSTOM_*` 前缀
4. `biome.json` 与 `.github/workflows/*`：lint/CI 规则升级 → 立刻跟进，避免漂移

## PR 流程

1. 从 `main` 切出 `custom/fou-x4-requirements-intake` 形式的分支
2. 提交 commit，commit message 格式：`FOU-39: 简短描述`（带 issue key 便于 web 自动 link）
3. 推送到 `Nibilu/hqbase`（**当前 amber 机器 git credential 失效，统一走 Contents API 或 token helper**，见下方"无 git 推送权限时的回退路径"）
4. 标题以 `FOU-NN:` 前缀，让 Multica 平台自动 link（同时具备 close intent 需 `Closes FOU-NN` 在 body）
5. 合并：fork owner（verykang）人工 merge，或 admin 配 auto-merge

## 回灌 upstream（可选）

定制稳定后若值得贡献给 upstream：

- 新建 `HQBase/hqbase` 上的 PR，base = `main`，title = `Closes HQBase#<upstream-issue>`
- 如果是定制专属功能（仅 Nibilu 需要），**不**回灌
- 上游 license = AGPL-3.0，定制代码同样以 AGPL-3.0 发布

## 无 git 推送权限时的回退路径

amber 机器的 `~/.git-credentials` 已失效（401），但 `.hermes/.env` 中的 GitHub PAT 有 `repo` scope。可走 Contents API 推送：

```bash
# 使用 push-via-api.py 把分支上的新文件直推到 fork
python3 push-via-api.py
```

这种推送会丢失 commit history 中的中间节点，只保留 HEAD 状态——**仅适合文档/配置**，不适合代码改动。代码改动必须解决 git credential 后再 push。

## 每周 rebase 脚本（占位）

```bash
#!/usr/bin/env bash
# /home/amber/multica_workspaces/.../workdir/scripts/sync-upstream.sh
set -euo pipefail
cd "$(dirname "$0")/.."
git fetch upstream
git checkout main
git rebase upstream/main
# resolve conflicts here if any
git push origin main
```

尚未启用 cron，待 Stage 3 部署稳定后再开。

— 维护：Mika（FOU-X1 owner）
