---
name: Dev & Deploy
slug: dev-deploy
version: 1.4.0
description: 快速创建并部署 Web 应用到 Cloudflare Pages；包含文件覆盖、Git推送与系统修改的安全确认机制。
metadata: {"clawdbot":{"emoji":"🚀","requires":{"bins":["node","git","gh","wrangler"],"env":["CLOUDFLARE_API_TOKEN"]},"os":["darwin","linux","win32"]}}
---

# Dev & Deploy Skill

快速开发并部署 Web 应用到 Cloudflare Pages，可选推送到 GitHub。

## 目标与范围

- 创建项目（基础页面 / 自定义 / 复用已有目录）
- 可选创建并推送 GitHub 仓库
- 可选部署到 Cloudflare Pages
- 访问测试与基础重试

## AI 执行原则与安全限制（重要）

为避免破坏性行为和数据丢失，Agent 在执行此工作流时**必须**遵守以下确认流程，**严禁在未获明确授权时进行高危自动化操作**：

1. **执行计划确认**：在调用 `deploy.js` 之前，必须简要向用户说明将要执行的参数和动作，并征得用户同意。
2. **项目名称 (`--name`) 必填**：脚本强制要求提供 `--name` 参数。如果用户未提供，Agent **必须**先向用户询问，不能随意编造或假定项目名称。
3. **覆盖与文件修改**：如果目标目录已存在，或使用了 `--in-place`、`--source` 可能导致现有文件被覆盖，**必须**先向用户发出明确警告并获取授权。
4. **远程推送与创建仓库**：在进行 Git 提交、推送远程仓库或使用 GitHub CLI 创建仓库前，**必须**征求用户同意。若未经明确同意，必须加上 `--skip-github`。
5. **部署权限**：需要部署但未设置 `CLOUDFLARE_API_TOKEN` 时，必须暂停并请求用户提供或由用户执行授权。
6. **重要安全限制**：需要使用 `brew` 或 `npm install -g` 安装全局依赖（如 `gh`, `wrangler`）时，**必须**先向用户申请权限，禁止在未授权时悄悄篡改系统环境。
7. **数据库配置询问**：如果项目需要 Cloudflare D1 数据库，**必须**先询问用户 `database_id`（通过 `wrangler d1 create <name>` 获取），不能留空或使用占位符。
8. **Durable Objects 免费版确认**：如果项目使用 Durable Objects，**必须**询问用户是否使用免费版（默认是），免费版需使用 `new_sqlite_classes` 而非 `new_classes`。

### 失败恢复策略

1. 读取错误信息并定位缺失项（依赖、登录、权限、参数）。  
2. 自动补齐后立即重试原命令。  
3. 连续失败时给出“最小下一步动作”，再请求用户输入。  

## 前置检查与自动补齐

按需检查（不是所有命令都必须执行）：

```bash
node -v
git --version
gh --version
wrangler --version
gh auth status
wrangler whoami
```

安装指引（缺什么装什么，**但在执行系统级安装前必须征求用户同意**）：

```bash
# macOS
brew install node
brew install git
brew install gh
npm install -g wrangler
```

## Cloudflare Token 指引（部署时必看）

- Token 管理页：<https://dash.cloudflare.com/profile/api-tokens>
- 官方文档：<https://developers.cloudflare.com/fundamentals/api/get-started/create-token/>

快速步骤：

1. 打开 Token 管理页，点击 `Create Token`。  
2. 选择可用于 Pages/Wrangler 部署的模板（如 `Edit Cloudflare Workers`），或自定义最小权限。  
3. 资源范围限制到目标账号。  
4. 创建后复制 token（通常只显示一次）。  
5. 在当前终端注入：

```bash
export CLOUDFLARE_API_TOKEN=your_token_here
```

> 注意：在脚本、CI、AI Agent 等非交互环境中，即使执行过 `wrangler login`，也仍可能需要 `CLOUDFLARE_API_TOKEN`。

## 使用方法

### 1) 自定义开发

```bash
node dev_deploy/deploy.js --name my-app --custom
```

### 2) 部署已有项目（复制到默认目录）

```bash
node dev_deploy/deploy.js --name my-app --source ./existing-project
```

### 3) 原地部署已有项目

```bash
node dev_deploy/deploy.js --name my-app --source ./existing-project --in-place
```

## 参数说明

| 参数 | 说明 | 示例 |
|------|------|------|
| `--name` | 项目名称（必填，小写字母/数字/短横线） | `todo-app` |
| `--custom` | 自定义开发模式 | - |
| `--source` | 已有项目目录 | `./my-project` |
| `--in-place` | 原地部署（不复制） | - |
| `--projects-dir` | 默认项目目录 | `~/projects` |
| `--config` | 配置文件路径 | `~/.config/dev-deploy/config.json` |
| `--branch` | Git 分支名 | `main` |
| `--public` | 创建公开仓库（默认私有） | - |
| `--skip-test` | 跳过访问测试 | - |
| `--skip-github` | 跳过 GitHub 创建和推送 | - |
| `--skip-deploy` | 跳过 Cloudflare 部署 | - |

## 配置优先级

命令行参数 > 环境变量 > 配置文件 > 默认值

环境变量：

```bash
export CLOUDFLARE_API_TOKEN=your_token_here
export PROJECTS_DIR=~/projects
export TEST_DELAY=5000
export MAX_RETRIES=3
export DEFAULT_DOMAIN=pages.dev
export DEFAULT_BRANCH=main
export PAGES_BUILD_OUTPUT_DIR=.
export DEV_DEPLOY_CONFIG=~/.config/dev-deploy/config.json
```

配置文件默认路径（取首个存在的）：

- `~/.config/dev-deploy/config.json`
- `~/.dev-deploy.json`

## 标准执行流程（AI 必须严格遵循安全确认）

1. **解析目标与参数**：识别是否需要 GitHub / Cloudflare，明确必要的参数（如 `--name`）。
2. **计划确认**：向用户展示计划执行的命令及可能产生的文件/环境变更，等待用户授权。
3. **环境检查与授权依赖安装**：在征得同意的前提下，安装缺失的依赖。
4. **执行 `deploy.js`**：根据授权的参数执行脚本。
5. **异常处理**：失败则按报错提示用户或在授权范围内重试。
6. **返回结果**：输出本地路径、线上 URL 及后续的未完成项（若有）。  

## 常见错误 -> 立即动作

- `wrangler: command not found` -> `npm install -g wrangler`  
- `gh: command not found` -> `brew install gh`（或跳过 GitHub）  
- `non-interactive environment ... CLOUDFLARE_API_TOKEN` -> 注入 `CLOUDFLARE_API_TOKEN` 后重试  
- `gh auth status` 失败 -> `gh auth login` 后重试  
- 访问测试失败 -> 增大 `TEST_DELAY` 或 `MAX_RETRIES`  
