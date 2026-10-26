/**
 * The project README, shown at the top of the example article. Kept identical to the
 * repository's README.md (a test checks this), so the example always matches the project.
 */
export const PROJECT_README = `# brog

一个用 Git 管理文章的个人博客程序。文章是一个真实的 Git 仓库：读者可以 clone 阅读，你可以在网页里编辑、提交、发布，也可以直接用 \`git push\` 推送。

## 功能

- **在线编辑**：左侧 Markdown 源码，右侧与线上一致的实时预览，自动保存到工作区。
- **Markdown 扩展**：提示框、可折叠块、内容标签页、按键、高亮、上下标、KaTeX 公式、流程图、脚注、任务列表、代码行号与高亮行、可运行的 JS 示例。完整示例见「示例」合集。
- **版本管理**：每篇文章有自己的提交历史，可以对比任意两个版本，可以回退（reset）或撤销某个提交（revert）。
- **发布（Push）**：工作区的修改只有点击发布后读者才能看到。
- **Git 服务**：任何人都可以 clone 已发布的内容。持有 token 的人可以 push 和拉取完整的草稿。
- **标签与搜索**：标签可以选择和组合筛选；支持全文搜索文章，也可以搜索提交说明。
- **外观**：阅读底色（亮色和暗色分别设置），首页背景色，文章卡片的预览颜色。
- **前后端一体**：一个程序同时提供页面和 API，也可以只部署后端或只部署前端。
- **分享链接**：文章可以生成 \`域名/sh/xxxx\` 形式的短链接（4 位字母与数字）。域名可以在后台「设置 → 服务」中配置为短域名，留空则使用主站域名。
- **评论**（可选，默认关闭）：评论存放在 GitHub Discussions，每篇文章一个讨论。读者无需 GitHub 账号。在后台「设置 → 评论」配置并测试后开启。

## 快速开始

### Docker（推荐）

\`\`\`bash
docker run -d --name brog -p 8080:8080 -v brog-data:/app/data ghcr.io/imduaky/brog:latest
docker logs brog   # 首次启动会打印管理密码
\`\`\`

打开 http://localhost:8080 。在任意页面（输入框之外）连续按 \`w\` 三次，输入管理密码进入后台。

### Docker Compose（带 nginx 与 gzip）

\`\`\`bash
docker compose up -d --build   # 打开 http://localhost:8080
docker compose logs brog       # 首次启动会打印管理密码
\`\`\`

nginx 配置在 \`deploy/nginx/conf.d/brog.conf\`（整个目录挂载到 \`/etc/nginx/conf.d\`）。经过 nginx 时，请在后台「设置 → 服务」中开启「反向代理之后」，否则所有访客共用同一个限流计数。

### 从源码运行

需要 Node.js 24、pnpm 11 和系统的 \`git\`。

\`\`\`bash
pnpm install
pnpm dev          # 开发：服务端 :8080，前端 :5173
pnpm build        # 构建前端与后端
pnpm start        # 运行 dist/server/main.mjs
\`\`\`

## 配置

没有配置文件。启动参数（监听地址、端口、数据目录）通过命令行或环境变量设置，例如 \`pnpm start -- --port 9000\` 或 \`BROG_PORT=9000\`，见 \`node dist/server/main.mjs --help\`。其余设置（站点标题、导航、友链、Git 用户名、Cookie、CORS、搜索等）都在后台「设置」中修改，保存后立即生效。

评论需要环境变量 \`BROG_GITHUB_TOKEN\`（一个能读写目标仓库 Discussions 的 GitHub 令牌）。它只从环境变量读取，不会保存到数据库，也不会在页面上显示。例如 \`BROG_GITHUB_TOKEN=... pnpm start\`，Docker 中为 \`docker run -e BROG_GITHUB_TOKEN=...\`。

管理密码不写在配置里。首次启动时打印在控制台，之后每次启动都会生成新的随机密码，直到你在后台「设置」中修改它。忘记密码时运行 \`pnpm reset-password\`（Docker 中为 \`docker exec brog node dist/server/main.mjs reset-password\`）。

## 使用 Git

\`\`\`bash
git clone https://your-domain/git/blog.git                 # 匿名：只能看到已发布的内容
git clone https://owner:TOKEN@your-domain/git/full/blog.git  # 带 token：完整内容，可 push
\`\`\`

token 在后台「Git Token」中创建，用户名为后台「设置 → 服务」中的 Git 用户名（默认 \`owner\`）。推送只允许 \`main\` 分支。推送后的内容需要在后台点击「发布」才会对读者可见。

## 内容格式

\`\`\`
<合集>/
  meta.yaml          合集：标题、简介、封面
  <n>/
    meta.yaml        文章：标题、标签、封面、摘要、预览信息
    content.md       正文
    img/             图片，粘贴时按标题自动命名，如 开始-第一步_1.webp
    js/              供 JS 示例引用的脚本
\`\`\`

## 项目结构

\`\`\`
src/shared/     前后端共用的类型、路径规则、颜色与哈希
src/server/     服务端：Hono 路由、SQLite、git 仓库、Markdown 渲染
src/web/        前端：React、React Router、shadcn/ui
tests/          vitest 测试
AGENTS.md       设计决策与开发约定
\`\`\`

## 开发

\`\`\`bash
pnpm typecheck    # 类型检查
pnpm test         # 测试
\`\`\`

设计决策、API 和约定见 [AGENTS.md](https://github.com/imduaky/brog/blob/main/AGENTS.md)。

## 许可

MIT，见 [LICENSE](https://github.com/imduaky/brog/blob/main/LICENSE)。
`
