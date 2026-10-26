# brog — AGENTS.md

个人博客程序。TypeScript + React 前端，Node 服务端，Git 仓库作为文章存储，SQLite 保存派生索引、运行时设置与少量元数据。

本文件是设计文档、实现说明、待办清单，同时是给 AI 代理的工作约定。只描述当前的设计与实现，不记录变更历史（历史见 git）。实现与本文不一致时，以本文为准并同步修改本文。

文中的名称（合集、章节、标题、页面名）都是占位符，不是默认值。代码里不得把任何示例名称当作默认值或占位文字。

---

## 1. 目标与设计理念

目标：

- 管理员（博主）在线用 Markdown 编辑文章，支持 mkdocs-material 风格的扩展语法。
- 每篇文章有自己的提交历史。管理员可以 reset 到某个版本、revert 某个提交、对比任意两个提交。
- 文章仓库本身是 Git 服务器：任何人可以 clone 阅读，持有 token 的人可以 push。
- 后端与前端在同一程序里交付，也支持只打包后端或只打包前端（前后端分离部署）。
- 后端暴露 API，方便第三方做管理面板。
- 界面统一、简洁、直角。可点击区域悬停时有明显反馈。

设计理念：

- **Git 是内容的事实来源。** 文章、页面、图片、标签名（`meta.yaml` 中）都在仓库里，有历史，可以 clone。SQLite 只保存派生索引和运行时状态。
- **读者只看到已发布内容。** 工作区的修改（Commit）不改变读者视图；发布（Push）是唯一改变读者视图的动作。
- **配置分两类。** 启动参数（监听地址、端口、数据目录）必须在打开数据库之前确定，通过命令行或环境变量给出；其余设置在后台保存到 SQLite，保存即生效，不需要重启。没有配置文件。
- **管理入口隐藏。** 读者页面没有任何管理入口；`/admin` 对未登录访问者返回 404，且不下载管理端代码。

---

## 2. 设计决策

改动这些决策前必须先询问用户。

| 主题 | 决策 |
| --- | --- |
| 管理入口 | 在任意非输入区域连续按 `w` 三次（1.5 秒内）弹出密码框。已登录时直接进入 `/admin`。 |
| 密码传输 | 浏览器计算 `sha256(password)` 的十六进制后发送。服务端用 bcrypt（cost 12）对比，库中只存 `bcrypt(sha256hex)`。 |
| 会话 | HttpOnly cookie `brog_session`，有效期默认 7 天（服务设置可改）。每次校验把过期时间顺延到"现在 + 有效期"，数据库写入至多每小时一次。修改密码会吊销其它会话。 |
| 密码初始化 | 密码不在配置里。首次启动在控制台打印随机密码。只要管理员没设置过密码，每次启动都重新生成并打印，并提醒修改。`pnpm reset-password` 回到这一状态。 |
| Git 存储 | 磁盘上的真实 bare 仓库，由系统 `git http-backend` 提供 smart HTTP。SQLite 只存元数据：图片映射、token、会话、设置、置顶、标签目录、索引缓存、全文索引。 |
| 分支 | 只有一个 `main`，不做其它分支。 |
| 网页上的 Commit | 写入工作区，然后像 git 一样暂存、提交。提交不改变读者看到的内容。 |
| 网页上的 Push（发布） | 把"已发布提交"指针移动到当前工作区版本，并重建索引。读者看到的内容只在这一步变化。 |
| 匿名 clone | 只拿到已发布版本（`public.git`，与 `blog.git` 共享对象）。 |
| 带 token 的 clone/push | 见 6.2。 |
| 外部 push 与未提交修改 | 外部 push 只更新 `main`，不自动发布。工作区有未提交修改时：先 stash，应用 push 后 reset 到新版本，再重新应用修改（rebase 语义）。冲突时保留冲突标记并在后台提示；无法应用时修改保留在 stash 中。 |
| reset | 作用于整个仓库，`soft` / `mixed` / `hard` 三种模式，默认 `soft`。reset 前列出被移出的提交。 |
| revert | 生成一个新的反向提交（merge commit 使用 `-m 1`）。 |
| 对比（compare） | 任意两个提交的 diff，形式 `base...head`，hash 可以直接输入。读者只能对比已发布历史中的提交。 |
| 图片 | 粘贴或拖入图片后转为 webp，按标题命名后存入仓库的 `img/`。对外只暴露哈希链接 `/images/{hash}`。 |
| 文章元数据 | 标题、标签名、封面、摘要、预览信息存在 `meta.yaml`，随 git 版本化。 |
| 预览信息 | 每篇文章的 `preview` 块：`text`（首页卡片文字）与 `theme`（卡片颜色，亮暗各一个）。与正文和摘要无关，可手动设置。 |
| 外观 | 阅读底色（全站，亮/暗各一个）推导出所有界面颜色，默认米黄色（亮）与暖深灰（暗）。首页背景色只用于首页，亮/暗各一个。在「设置 → 外观」中修改。不提供背景图。 |
| 标签 | 标签目录存在 SQLite：每个标签有唯一且稳定的键，以及可修改的名称。文章的标签名写在 `meta.yaml`，编辑时从目录中选择。读者页用键筛选，改名不断开链接。多选筛选为同时包含全部所选标签（AND）。目录不随 git 版本化：没有历史，但改名即时，链接稳定。 |
| 配置方式 | 启动参数：`--host`、`--port`、`--data`、`--web-dist`、`--api-only`、`--git`，或对应的 `BROG_*` 环境变量。其余设置在后台「设置」中修改，存在 SQLite，保存即生效。 |
| 服务设置 | 对外地址、Git 用户名、页面语言、登录有效期、Secure Cookie、SameSite、反向代理、允许的前端来源（CORS）、全文搜索开关、提交作者。存在 SQLite，「设置 → 服务」中修改。 |
| 站点设置 | 标题、简介、导航、友链、页脚文字与页脚链接、是否显示克隆地址、文章列表布局（自动 / 单列 / 双列，默认自动）。存在 SQLite。 |
| 置顶 | 文章、合集、标签可以置顶到首页列表顶部，按管理员指定的顺序显示。存在 SQLite（`pins` 表），立即生效，不随 git 版本化。只显示已发布的目标。 |
| 导航与自定义页面 | 导航项可以是内置页面（文章、合集、标签、友链）、自定义页面或外部链接。自定义页面在仓库 `_pages/<名称>/` 中，随发布生效：Markdown 页面与文章渲染相同；网页页面是 `index.html`，在沙箱 iframe 中运行。外部链接在新标签页打开。 |
| 友链 | 友链存在 SQLite，显示在独立的 `/links` 页面。没有友链时，导航中的友链项对读者隐藏。 |
| 页脚 | 左侧是页脚文字和页脚链接（工具页，如关于、订阅）；右侧是克隆地址（可关闭）和「Powered by brog」，后者链接到项目地址。 |
| 首页布局 | 默认自动：页面宽度 ≥ 1024px 时双列，否则单列。内容最大宽度 1024px（双列）或 768px（单列）。 |
| 页头 | 导航在页头正中，左侧站点标题，右侧搜索与主题切换。向下滚动超过 80px 时收起，向上滚动立即出现，回到顶部时始终显示。收起时粘性面板的顶部位置同步变化。管理端有自己的页头，不收起。窄屏下导航横向滚动。 |
| 搜索 | 读者搜索：文章全文（SQLite FTS5，trigram）、文章标题/标签/摘要、合集、标签。只索引已发布内容。提交说明只在管理员的历史页面搜索，覆盖全部提交（含未发布）。全文索引可在「设置 → 服务」中关闭。 |
| 读者 API | 一次请求返回 bundle（元数据、渲染后的正文、TOC、历史、上下篇），同时拆分出 meta / content / source / history 小接口。 |
| 阅读页布局 | 宽度 ≥ 1280px 时三栏：目录（可隐藏）\| 正文 \| 历史（可隐藏）。原文是独立页面 `/s/<合集>/<n>/source`，由功能区和文章头部进入。窄屏下目录与历史改为抽屉。 |
| 文章实时编辑 | 左侧 CodeMirror 源码，右侧与线上渲染一致的实时预览，自动保存到工作区（不是协同编辑）。预览随源码滚动同步。 |
| 渲染方式 | Vite SPA。后端在文章页、合集页的 HTML 中注入 `title`、`description`、`og:*`，兼顾分享卡片和基础 SEO。 |
| 动效 | 120–260ms 的短动画，不做炫技。尊重系统的"减少动态效果"设置。见 6.16。 |
| 行悬停 | 代码块、原文、diff 中的每一行，鼠标悬停时加一层阴影。 |
| JS 示例 | 在沙箱 iframe 中运行（`sandbox="allow-scripts"`，没有同源权限，拿不到管理员 cookie）。 |
| UI | shadcn/ui（Radix 底座）+ Tailwind CSS v4。米色底、暖色文字，支持深色模式。圆角规则见第 12 节。 |
| 运行时与包管理 | Node 24，pnpm 11。服务端框架 Hono。 |
| 分享链接 | 文章可以创建分享链接，形如 `<域名>/sh/xxxx`，`xxxx` 为 4 位 `a-zA-Z0-9`（共 14,776,336 个，大小写敏感）。链接域名在「设置 → 服务」中配置为短域名；留空时使用主站域名。链接只指向文章的当前发布版本，未发布的文章没有可用链接。每篇文章有一个游客链接，所有读者共用；管理员可以另外创建多个链接并停用。见 6.18。 |
| 评论 | 存放在 GitHub Discussions，由服务端代理读写，读者不需要 GitHub 账号。每篇文章路径对应一个讨论，第一条评论时创建。默认关闭，配置后在「设置 → 评论」中开启。令牌只来自环境变量 `BROG_GITHUB_TOKEN`，不入库、不显示。见 6.17。 |

---

## 3. 技术栈

版本以 `package.json` 为准。

- 运行时：Node 24、pnpm 11，系统需要安装 `git`（服务端调用 `git http-backend`）。
- 服务端：Hono 4、`@hono/node-server`、better-sqlite3（WAL 模式，FTS5 trigram）、bcryptjs、zod 4、yaml、sharp（图片转 webp）、sanitize-html。
- 渲染：markdown-it 15 及 `@mdit/plugin-*`（提示框、标签页、脚注、任务列表、高亮、上下标、缩写、定义列表、属性、KaTeX）、shiki 4（双主题代码高亮）。
- 前端：React 19、React Router 8（`createBrowserRouter`）、TanStack Query 5、Vite 8、Tailwind CSS 4（`@tailwindcss/vite`）、shadcn/ui（Radix）、lucide-react、sonner、CodeMirror 6（`@uiw/react-codemirror`）、mermaid 12（按需加载）。
- 工具：TypeScript 7、tsdown（服务端打包）、vitest 5、tsx、concurrently。

---

## 4. 目录结构

```
src/
  shared/          前后端共用：类型（types.ts）、路径规则（paths.ts）、颜色（color.ts：校验、混色、对比文字、预设）、
                   sha256.ts（纯 JS 摘要，供没有 crypto.subtle 的 HTTP 站点登录）
  server/
    main.ts        CLI 入口：serve / reset-password / reset-settings；启动参数解析
    bootstrap.ts   启动：打开数据库、初始化仓库、组装服务、生成密码、创建应用
    app.ts         Hono 应用：安全头、CSRF 校验、CORS（读取运行时设置）、路由挂载、错误处理
    config.ts      启动参数的类型与解析（命令行 > BROG_* 环境变量 > 默认值）
    server-settings.ts  服务设置：SQLite 存储、内存缓存、保存时通知监听者
    db.ts          SQLite 连接与迁移（PRAGMA user_version）
    context.ts     应用上下文与公共工具
    auth/          password.ts（sha256 / bcrypt）、session.ts、tokens.ts（git token 与限流）
    git/           exec.ts（git 子进程）、repo.ts（BlogRepo：工作区、提交、reset、对比、提交搜索、外部 push 同步）、
                   catfile.ts（长驻 cat-file 读对象）、http.ts（smart HTTP 桥接）
    content/       service.ts（发布、索引、全文索引、读者数据、搜索、对比、图片、工作区操作、自定义页面）、
                   meta.ts（meta.yaml，含预览信息）、tags.ts（标签目录）、site-settings.ts（站点设置、导航、友链、外观）、
                   pins.ts（置顶）、seed.ts（初始内容）、seed/（示例用的 README 副本、Markdown 演示、脚本与图）
    markdown/      render.ts（渲染入口，含沙箱页面包装）、containers.ts（提示框 / 标签页 / 按键）、
                   sanitize.ts、heading-context.ts（图片命名用的标题上下文）
    routes/        auth.ts、public.ts（读者 API，含评论）、admin.ts（管理 API，含评论设置与测试）、git.ts、web.ts（SPA 托管与 meta 注入）
    share/         links.ts（分享链接：生成编号、创建、停用、解析；只指向已发布文章）
    comments/      github.ts（GitHub GraphQL 客户端，只含评论需要的操作，并保存查询文本）、settings.ts（评论设置，SQLite）、
                   service.ts（评论的读写、文章与讨论的对应、配置检查与测试、列表缓存、发表限流）
    util/          mutex.ts、lru.ts
  web/
    main.tsx       入口与路由表；/admin 只有已登录时才懒加载管理端代码
    styles.css     设计 token、圆角、Markdown 样式、动画、行悬停
    lib/api.ts     API 客户端（CSRF 头、VITE_API_BASE、sha256）
    hooks/         use-theme、use-session、use-key-sequence（w 快捷键）、use-site、use-media、use-debounced、
                   use-header-autohide（页头收起）、use-pins（管理员置顶列表）
    components/    站点布局（页头、导航、页脚）、搜索对话框、管理员登录框、Markdown 视图（展开动画）、TOC、
                   提交树、源码视图、diff 视图、面板标题、拖动分隔条、阅读页功能区、文章卡片、置顶卡片、
                   置顶按钮、沙箱页面 iframe、颜色选择、页面底色同步
    components/ui/ shadcn 生成的组件（sonner 不依赖 next-themes）
    pages/         首页（含置顶）、合集、标签、文章阅读页（含评论区）、原文页、对比页（读者与管理员共用）、友链页、自定义页面
    admin/         工作区（文章与页面列表、更改、发布）、编辑器（文章与页面共用）、历史（含提交说明搜索）、
                   Token、设置（站点、导航、友链、置顶、外观、服务、密码；宽屏两列）
tests/             vitest：工作流、搜索与对比、标签、外观与预览、示例内容、设置与自定义页面、sha256、Markdown
Dockerfile         多阶段镜像：编译、生产依赖、运行（非 root 用户，数据目录为卷）
docker-compose.yml brog + nginx（gzip）；nginx 是唯一对外端口，brog 不发布端口
deploy/nginx/brog.conf  nginx 反向代理配置：gzip、Vary、/git/ 不压缩不缓冲、请求体上限 25 MB
.dockerignore      镜像构建忽略的文件
.github/workflows/docker.yml   推送 main 与 v* 标签时构建 linux/amd64、linux/arm64 镜像并推送到 GHCR
scripts/dev.mjs    开发入口：Vite（同进程）与 API 子进程，源码变化时重启 API（见 9.1）
tsdown.config.ts   服务端打包
vite.config.ts     前端构建与开发代理
```

---

## 5. 内容仓库格式

仓库 `data/git/workspace` 就是博客内容，也是 `git clone` 得到的结构：

```
README.md                     仓库说明
示例/                          仓库初始化时写入的演示合集（见 11.3）
<合集>/                        合集文件夹（文件夹名即合集标识，不以 _ 开头）
  meta.yaml                   合集：title / description / cover
  <n>/                        第 n 篇（编号即文章序号，从 1 开始）
    meta.yaml                 文章：title / tags / cover / summary / preview
    content.md                正文
    img/                      图片，命名规则见 6.4
    js/                       供 live demo 引用的脚本
_pages/                       自定义页面（以 _ 开头的目录保留给站点，不是合集）
  <名称>/                     页面地址为 /p/<名称>
    meta.yaml                 页面：title
    content.md                Markdown 页面（与文章相同的渲染）
    index.html                网页页面（在沙箱 iframe 中运行）
```

规则：

- 合集文件夹名、章节编号、页面名、图片文件名都经过 `shared/paths.ts` 校验，不允许 `.`、`..`、路径分隔符和控制字符。合集名不能以 `_` 开头。
- `meta.yaml` 解析失败时使用默认值，不让一个坏文件拖垮整站。
- 新建文章时编号为合集中的下一个数字。
- 页面目录同时有 `content.md` 与 `index.html` 时，按 Markdown 页面处理。

---

## 6. 功能细节

### 6.1 认证与管理入口

- 读者页面看不到任何管理入口。在页面上连续按 `w` 三次（1.5 秒内，且焦点不在输入框或编辑器中）弹出登录框。已登录时直接进入 `/admin`。
- `/admin/*` 在未登录时返回 404，且不会下载管理端的代码包。
- 登录失败每个 IP 每 15 分钟最多 10 次。计数保存在内存中，重启后清零。
- 所有非 GET 的 `/api/*` 请求必须带 `x-brog-request: 1`（浏览器跨域时需要预检，CSRF 防护）。
- 生产环境必须使用 HTTPS。sha256 作为"密码"在明文 HTTP 上可以被重放。

### 6.2 Git 服务

| 地址 | 匿名 | 带 token |
| --- | --- | --- |
| `/git/blog.git` | clone/fetch 已发布版本 | 完整 `main`（含草稿）；可 push |
| `/git/full/blog.git` | 401，要求认证 | 完整 `main`；可 push |

- `/git/full/blog.git` 是写作者入口。git 客户端只有收到 401 才会发送凭据，所以这个地址总是先要求认证。
- 认证方式：HTTP Basic。用户名为服务设置中的 Git 用户名（默认 `owner`，不是站点标题）；密码为管理页面签发的 token（前缀 `brog_`，服务端只保存 sha256）。
- 只允许推送 `refs/heads/main`（`pre-receive` 钩子）。内部引用对客户端隐藏。
- 管理页面可以新建、列出、吊销 token，并显示最近使用时间。

### 6.3 编辑、提交、发布

1. 编辑器自动保存到工作区（防抖 800ms），离开页面前若有未保存内容会提示。
2. 文章页的"提交"只暂存并提交这篇文章的文件（以及合集的 `meta.yaml`）。其它修改在工作区页面处理。
3. 工作区页面有完整的 git 操作：暂存、取消暂存、丢弃、查看差异、提交，以及发布（Push）。
4. 发布前显示待发布的提交列表。工作区版本与已发布版本一致时，发布按钮禁用。
5. 发布时只重新索引内容或元数据有变化的文章（见 6.9）。

### 6.4 图片

- 粘贴或拖入图片：前端上传到 `POST /api/admin/images`，后端用 sharp 转为 webp（质量 82，自动旋转）。非法图片返回 400。上传上限 20 MB。
- 文件名：`<标题链>_<序号>.webp`。标题链是从一级标题到当前小节的所有标题，用 `-` 连接，特殊字符替换为空格后用 `_` 连接，最长 60 字符。
  - 例：一级标题 `A` 下的二级标题 `B` 的第二张图片 → `A-B_1.webp`。
  - 序号从 0 开始，按"同一小节内、光标之前"的图片数计算。文件已存在时递增。
- 文件保存在 `<合集>/<n>/img/`，随 git 提交。编辑器插入相对路径 `![](img/xxx.webp)`。
- 对外链接：`/images/{hash}`。`hash` 是 webp 字节 sha256 的前 32 位十六进制。映射保存在 SQLite 的 `images` 表。响应带 `immutable` 缓存头和 CSP `sandbox`。

### 6.5 Markdown 扩展语法

在 `server/markdown/` 中实现，`containers.ts` 为自定义语法。

| 语法 | 效果 |
| --- | --- |
| `!!! note "标题"` + 缩进内容 | 提示框，类型包括 note / tip / warning / danger / success / question / example / quote 等 |
| `??? tip "标题"` / `???+` | 可折叠提示框（`???+` 默认展开）。展开与收起有动画，点击中途可以反向。 |
| `=== "标签名"` 后接缩进内容 | 内容标签页，连续的 `===` 组成一组（CSS 单选按钮实现）。切换时内容淡入。 |
| `++ctrl+s++` | 按键 |
| `==文字==` / `H~2~O` / `x^2^` | 高亮 / 下标 / 上标 |
| `$...$`、`$$...$$` | KaTeX 公式 |
| `` ```mermaid `` | 流程图（客户端按需加载 mermaid；渲染完成前预留高度，已渲染的图表按源码缓存） |
| `` ```c title="a.c" linenums="1" hl_lines="3" `` | 代码块：标题、行号、高亮行；双主题 shiki。每行悬停时加阴影。 |
| `` ```js live height="120" `` | 可运行示例（沙箱 iframe），也可写 `src="js/x.js"` 引用章节内的脚本。源码折叠面板展开有动画。 |
| `- [x]` / 脚注 / 缩写 / 定义列表 / `{.class}` 属性 | 与 mkdocs-material 对齐 |

- 原始 HTML 经过 sanitize-html 白名单过滤（`<script>`、事件属性、`javascript:` 链接都会被移除）。
- 目录（TOC）由标题生成。
- 相对链接中的 `content.md` 会被去掉，指向文章页。外链加 `target="_blank"`。
- 每个顶层块带 `data-line`（源码行号），编辑器据此同步预览滚动。

### 6.6 JS 示例与网页页面

- 只有 `js live` 或 `html live` 代码块会被执行，并且只在 `sandbox="allow-scripts"` 的 iframe 中执行。
- iframe 使用 `srcdoc`，因此拿不到站点 cookie、DOM 或管理接口。
- iframe 高度由 iframe 内的 `postMessage` 自动调整。
- 网页页面（`_pages/<名称>/index.html`）使用同样的沙箱，服务端只在 `<head>` 中加入高度上报脚本，不过滤页面内容。

### 6.7 读者页面

- 文章页（宽度 ≥ 1280px）为三栏：目录 | 正文 | 历史。
  - 每栏顶部有标题和隐藏开关。栏始终挂载，关闭时宽度动画收到 0，内容不被挤压。
  - 分隔线可以拖动调整宽度，双击复原，或用方向键微调。宽度范围：目录 160–420px，历史 200–460px。
  - 布局偏好（哪些栏打开、宽度、功能区是否缩小）保存在浏览器本地 `localStorage`。
- 右下角功能区：回到顶部、目录、原文（进入原文页）、历史。可以缩小为一个按钮，再次点击展开。缩小状态下点击功能区标题栏任意位置即可展开。
- 窄屏（< 1280px）：目录与历史改为从两侧滑出的抽屉，由功能区打开。
- 原文页 `/s/<合集>/<n>/source`（`?rev=` 可指定历史版本）：逐行显示行号，行号是链接（`#L12`），支持复制与下载。
- 历史：提交树。每个版本一个圆点，连成一条竖线，当前阅读的版本填充。点击行即切换到该版本。每行右侧的图标与上一版本对比。最新版本标注"最新"。
- 历史版本：`?rev=<oid>` 只允许已发布提交的祖先。页面顶部提示正在阅读旧版本，并提供返回最新版本的入口。
- 首页文章列表：默认自动（宽屏双列），也可在站点设置中固定为单列或双列。合集列表、合集详情、标签页。
- 页头收起：向下滚动超过 80px 时收起，向上滚动任意距离即出现。搜索对话框打开时保持出现。
- 导航：页头中间，顺序和内容由站点设置决定（见 6.8）。没有发布的自定义页面不出现在导航中；没有友链时「友链」项隐藏。
- 友链页 `/links`：友链卡片，点击在新标签页打开。
- 自定义页面 `/p/<名称>`：Markdown 页面的渲染与文章相同；网页页面在沙箱 iframe 中运行，高度由页面自动调整。
- 置顶：首页列表顶部先显示置顶项（文章、合集、标签），按管理员指定的顺序，之后是其余文章。置顶的文章不在下面重复出现。
- 页脚：左侧为页脚文字和页脚链接，右侧为克隆地址（可关闭）和「Powered by brog」。

### 6.8 站点设置

管理员在「设置」中修改，保存后立即生效，读者页面通过 `GET /api/site` 读取。站点设置页在宽屏（≥ 1024px）下分两列；每个卡片只保存自己的部分，互不影响其它卡片未保存的编辑。

| 设置 | 说明 |
| --- | --- |
| 站点标题、站点简介 | 页头、首页、页面 `<title>` 与 meta 标签。默认「My Blog」与空简介 |
| 文章列表布局 | 自动（宽屏双列，默认）、单列或双列 |
| 导航 | 最多 12 项，每项为内置页面（文章、合集、标签、友链）、自定义页面（从 `_pages/` 中选择）或外部链接（`http(s)://`）。顺序可以调整。名称 ≤ 20 字 |
| 友链 | 最多 200 条：名称、地址（`http(s)://`）、简介、头像地址（可选） |
| 页脚文字 | 纯文本 |
| 页脚链接 | 最多 12 个，名称 ≤ 40 字，地址只允许 `http(s)://`、`mailto:`、站内路径 `/...` 和锚点 `#...`。用于工具页（关于、订阅等） |
| 在页脚显示克隆地址 | 布尔值 |

- 管理端保存时发送的是部分字段（`PUT /api/admin/site-settings`），未出现的字段保持原值。

### 6.8.1 服务设置

在「设置 → 服务」中修改，保存后立即生效（不需要重启，见第 8 节）。

| 设置 | 默认 | 说明 |
| --- | --- | --- |
| 对外地址 | 空 | 克隆地址、分享卡片。空时使用访问时的地址。必须以 `http(s)://` 开头 |
| Git 用户名 | `owner` | 带 token 的 clone/push 使用，只允许字母、数字、`._-`，最长 64 字 |
| 页面语言 | `zh-CN` | 语言标签 |
| 提交作者 | 空（用 Git 用户名）、`brog@localhost` | 网页提交使用的作者名和邮箱 |
| 登录有效期 | 7 天 | 1–365 天，访问时续期 |
| Secure Cookie | 自动 | 自动：对外地址为 https 时开启；也可强制开启或关闭 |
| SameSite | Lax | Strict / Lax / None。None 必须同时开启 Secure，否则保存返回 400 |
| 反向代理之后 | 关 | 开启后按 `X-Forwarded-For` 识别访客 IP（登录与 git 认证的限流用）。经过 nginx（`deploy/nginx/brog.conf`）时必须开启，否则所有访客共用 nginx 的地址和同一个限流计数 |
| 独立部署的前端地址 | 空 | CORS 允许的来源，每行一个，只写协议和域名，最多 20 个 |
| 搜索文章正文 | 开 | 关闭后只搜索标题、标签和摘要；切换后自动重建索引 |
| 分享链接域名 | 空 | 文章分享链接使用的域名（短域名），例如 `https://s.example.com`，只写协议和域名。空时使用主站域名（对外地址，或访问时的地址） |

- 页面不是 HTTPS 却启用 Secure Cookie 时，保存前提示：此后浏览器不会保存登录状态，可在服务器上运行 `reset-settings` 恢复默认值。
- 启动参数不在页面上修改，见第 8 节。

### 6.8.2 置顶

- 在文章页（"置顶"按钮，位于标签旁）、合集页（标题旁）、标签页（选中一个标签后，标签栏旁）添加或取消。
- 设置页的「置顶」卡片可以排序和删除。顺序即首页的显示顺序。
- 目标未发布或已删除时，管理员视图显示"未发布或不存在"，读者不会看到。
- 只有管理员会看到按钮。读者端没有任何管理入口。

### 6.9 搜索

- 入口：页头的"搜索"按钮，或键盘 `/`、`Ctrl+K`。输入防抖 200ms，少于两个字符不查询。
- 搜索结果分三组：标签（点击跳到标签页）、合集（标题或简介匹配）、文章。
- 文章搜索：
  - 3 个字符及以上：FTS5 trigram 索引，`MATCH` 查询。
  - 2 个字符：对全文做子串扫描。
  - 结果按 `bm25` 排序，标题权重高于正文。匹配文字用 `<mark>` 高亮。片段由服务端生成，只包含纯文本标记（`\u0002` / `\u0003`），前端不解析 HTML。
- 增量索引：每次发布只重新索引内容或元数据的 blob 指纹有变化的文章，删除的文章同时移除索引。
- 全文索引在「设置 → 服务」中关闭（`fullText`）后，只搜索标题、标签和摘要，搜索结果会提示。切换后自动重建。
- 提交搜索（仅管理员）：在"历史"页面的搜索框中按提交说明（主题和正文）搜索，大小写不敏感，最多 30 条，每条列出涉及的文章，包括未发布的提交。点击提交打开该提交与父提交的对比。读者搜索不包含提交。
- 文章搜索的读者结果只包含已发布内容。
- 全文索引默认开启：三字符以上的查询走 trigram 索引，开销小；两字符查询是子串扫描，千篇级的内容量下仍可接受。

### 6.10 对比（compare）

- 路由：读者 `/compare/<base>...<head>`，管理员 `/admin/compare/<base>...<head>`，可选 `?path=<合集>/<n>` 只看一篇文章。
- 两端可以是任意提交的 hash（4 位及以上的十六进制前缀）。顶部可以直接输入两个 hash，也可以交换两端。
- 页面显示两端提交的信息、文件数、增删行数，以及每个文件的 diff（新增、修改、删除、二进制）。
- diff 带新旧行号。每行悬停有阴影。单个文件可以折叠。
- 读者只能对比已发布历史中的提交。管理员可以对比任意提交。
- 差异内容超过 1 MB 时，超出部分只显示文件名和行数统计，页面会提示。
- 入口：历史页面（管理员）勾选两个提交点"对比所选"；每个 hash 都是链接，指向它与父提交的对比；读者历史树的图标与上一版本对比。

### 6.11 编辑器

- 左侧源码，右侧预览。预览在每种布局下都保持渲染，切换布局不会出现空白或转圈。预览保留上一次结果直到新结果到达，所以正文不会因重新渲染而跳动。
- 滚动同步：源码滚动时，预览按块的源码行号对齐，相邻两块之间线性插值。方向只有一个（源码 → 预览）。
- 自动保存：防抖 800ms。Ctrl/Cmd+S 立即保存。
- CodeMirror 的扩展只依赖稳定的回调。输入时不重新配置编辑器，否则光标与滚动会跳动。

### 6.12 站点渲染与 SEO

- 文章页、合集页、自定义页面（`/p/<名称>`）的 HTML 由服务端注入 `<title>`、`description`、`og:title`、`og:description`、`og:type`、`og:image`。
- 其它页面使用站点设置中的标题和简介。

### 6.13 标签

- 标签目录（SQLite 表 `tags`）：每个标签有唯一键（8 位，随机生成，不变）和名称（可改，1–30 字，不含逗号）。
- 文章的标签名写在 `meta.yaml`。发布时，索引把每篇文章的标签保存为 `{键, 名称}`，读者看到的是上次发布时的名称。
- 标签页（`/tags`）：
  - 读者：只显示已有文章使用的标签，卡片上显示篇数。单击选中或取消，选中状态写在 URL（`?tags=键,键`），可以分享。选中多个时只显示同时带有全部所选标签的文章（AND）。
  - 管理员（同一页面，已登录时）：双击标签修改名称（或选中后按 F2），回车保存，Esc 取消。末尾的 `+` 新增标签。未使用的标签显示为虚线卡片。选中一个标签后，标签栏旁出现"置顶"按钮。
  - 单击在管理员视图中延迟约 220ms 才生效，以免与双击冲突。
  - 管理员视图的篇数只统计已发布的文章。
- 改名：更新目录，并把工作区中所有使用它的 `meta.yaml` 改为新名称（工作区修改，和正文一样需要提交与发布）。发布前读者仍看到旧名称。
- 编辑器的标签：文章信息中从目录里多选，输入目录中没有的名称会先加入目录。
- 限制：标签目录没有删除操作。
- 首页置顶的标签卡片打开该标签的筛选页。

### 6.14 外观

- 颜色只有一个来源：阅读底色（`paper`，亮/暗各一个）。`--background` 设为底色，`--foreground` 按底色亮度自动选黑字或白字，其余颜色（卡片、边框、输入框、强调）都从这两个颜色混合得出。换一个底色，整站一起变。
- 阅读底色用于所有页面。首页背景（`home.color`）只作用于首页，固定在视口背后，不随列表滚动。
- 亮色与暗色各自独立：阅读底色和首页背景色都分亮暗。
- 预览颜色的暗色默认由亮色推导（向暗色底色混合 72%）。在编辑器中可以改成任意颜色，或选择预设（预设都是亮/暗成对的）。

### 6.15 预览信息

- 首页卡片的文字：`preview.text`。留空时用摘要，再没有则用正文第一段。
- 首页卡片的颜色：`preview.theme`。卡片背景混入该颜色约 34%，左边缘为该颜色的 4px 色条。文章页的头部也用同一颜色的淡色底。
- 编辑器的"首页预览"区块设置这两项。摘要仍用于搜索和页面描述（`<meta name="description">`）。
- 只有非空的预览才写入 `meta.yaml`，因此没有预览的文章不会出现空的 `preview` 块。

### 6.16 动效

- 时长：120–260ms，统一缓动 `cubic-bezier(0.2, 0, 0, 1)`。超过 300ms 的动画不要加。
- 可折叠块：只动 `height` 和 `opacity` 两个属性。`open` 属性在动画结束后才改变，动画框不带 padding 和 margin（间距放在内层），因此收起时不会留下一段空白。点击中途可以反向。
- 阅读页面板：宽度动画。粘性槽位使用 `overflow: clip`，不能用 `hidden`，否则粘性定位失效。拖动时关闭过渡（`data-dragging`），避免拖动滞后。
- 页面切换：按路径为键的淡入（`motion-fade`）。列表卡片依次出现，每张延迟 30ms，最多 8 张。
- 按钮按下：`.clickable:active` 和按钮的 `:active` 缩放到 0.97，按下时 60ms，松开时 150ms 恢复。
- 弹出：功能区和小型输入框使用 `motion-pop`。
- 图表和图片：渲染完成后淡入。mermaid 在渲染完成前预留高度，避免跳动。
- 减少动态效果：全局把动画和过渡时长压到 1ms。JavaScript 驱动的动画在这种情况下直接跳到结束状态。

---

### 6.17 评论

- 默认关闭。关闭时读者页面没有评论区，`GET /api/comments/...` 返回 `enabled: false`，发表返回 403。管理员可以先保存配置，再开启。
- 生效条件（全部满足）：开关打开；环境变量 `BROG_GITHUB_TOKEN` 已设置；仓库与分类已保存。保存时在 GitHub 上核对：仓库存在、开启了 Discussions、分类属于该仓库。
- 对应关系：每篇文章路径 `<合集>/<n>` 对应一个讨论，标题为 `[brog] <合集>/<n>`。讨论 id 保存在 SQLite 的 `comment_threads` 表；第一条评论时创建，之后复用。改文章标题不影响它。换仓库时清空这张表。
- 读者发表：昵称（1–30 字，字母、数字、中文、空格和 `. _ -`）与正文（纯文本，1–2000 字）。写入 GitHub 时，正文前加一行 `**昵称**` 与空行。读者页据此显示「访客」标记；在 GitHub 上直接写的评论没有这一行，显示 GitHub 登录名与头像。
- 发表限流：每个 IP 每 10 分钟最多 5 次尝试，校验失败也计入。
- 显示：按时间升序，最多 100 条。列表在进程内缓存 60 秒，发表与删除后立即失效。正文按纯文本显示，不渲染 Markdown。GitHub 返回的链接与头像只保留 `https://` 地址。
- 管理员可以删除评论，删除直接作用于 GitHub 上的评论。
- 测试（「设置 → 评论 → 测试」）按顺序检查：令牌、连接（`viewer`）、仓库（存在且开启 Discussions）、分类、读取评论（已有讨论时读取评论数）、写入（不执行）。前面的检查失败时，后面的步骤不执行。测试只读：不在 GitHub 上创建或修改任何内容。写入权限在第一条评论发表时才会验证。
- 评论与发布无关：不随 git 版本化，不因发布或下线而改变。文章下线后，讨论仍保留在 GitHub 上。
- 只使用这些 GraphQL 操作：`viewer`、`repository`（含分类）、`createDiscussion`、`discussionComments`、`discussionCommentCount`、`addDiscussionComment`、`deleteDiscussionComment`。全部定义在 `src/server/comments/github.ts` 的 `QUERIES` 中。

### 6.18 分享链接

- 每篇文章有一个游客链接（`visitor = 1`），所有读者共用。读者在文章页点「分享」即可获得：首次请求时生成，之后所有人拿到同一个。读者无需登录，但 POST 需要 `x-brog-request` 头。
- 管理员在同一对话框中可以创建多个链接、复制、停用。列表中游客链接排在最前，并标记「游客链接」。
- 游客链接的数据库约束：`share_links` 上对 `visitor = 1` 的行建立唯一索引，每篇文章最多一个。服务层是同步执行的（better-sqlite3），因此“查找或创建”不会并发交错。
- 停用游客链接后，下一次游客请求会生成新的链接，旧链接返回 404。
- 链接格式：`<域名>/sh/<id>`，`id` 为 4 位，只用 `a-z A-Z 0-9`，大小写敏感。域名取「服务设置」中的分享链接域名；为空时取对外地址，再为空时取访问管理页面时的地址。
- 访问 `/sh/<id>` 返回 302，`Location` 为 `/s/<合集>/<n>`（相对地址，读者留在打开链接时的域名上）。响应带 `Cache-Control: no-cache`。
- 链接只指向文章的当前发布版本：文章未发布或已从发布版本中移除时，链接返回 404。未发布的文章不能创建链接（409）。
- 停用后链接返回 404，且不能恢复。
- 读者只能创建（获取）游客链接，不能删除。删除只能由管理员完成，管理员可以删除任何链接，包括游客链接。删除游客链接后，下一次游客请求会生成新的链接。
- 管理员可以删除任何链接（`DELETE /api/admin/shares/:id`），包括游客链接。
- 编号生成使用加密安全的随机数，与已有编号重复时重试（最多 50 次）。编号不是访问控制：链接只能指向已发布的内容，因此即使被枚举，也只暴露公开文章。

## 7. API 概览

公开（只读，只返回已发布内容，部分接口对管理员会话放宽）：

- `GET /api/site`：站点设置（`settings`，含导航与友链）、克隆地址、已发布提交、已发布的自定义页面（`pages`）。
- `GET /api/pins`：首页置顶项（已发布的文章、合集、标签），按管理员顺序。
- `GET /api/pages/:slug[?rev=]`：自定义页面。Markdown 页面返回渲染后的 HTML 与 TOC；网页页面返回放进沙箱的文档。
- `GET /api/articles[?tags=<键>,<键>&series=]`：`tags` 为标签键，多个时取交集。
- `GET /api/series`、`GET /api/series/:series`。
- `GET /api/tags`：有文章使用的标签，含篇数。
- `GET /api/articles/:series/:chapter`：bundle（meta + content + history + prev/next）。
- `GET /api/articles/:series/:chapter/meta|content|source|history`，支持 `?rev=`（history 除外）。
- `GET /api/search?q=`：返回 `articles`、`series`、`tags`、`fullText`。不含提交（提交搜索只在管理 API）。
- `GET /api/compare?base=<hash>&head=<hash>[&path=<合集>/<n>]`：读者只能用已发布提交。
- `GET /api/comments/:series/:chapter`：评论列表（`enabled`、`total`、`comments`）。未开启时 `enabled: false`。
- `POST /api/comments/:series/:chapter`：发表评论，body `{ name, text }`，成功返回 201。未开启 403，超出频率 429。
- `GET /sh/:id`：302 到文章；未知或未发布返回 404。
- `GET /images/:hash`。

会话：`GET /api/auth/session`、`POST /api/auth/login`（`{ password: sha256hex }`）、`POST /api/auth/logout`、`POST /api/auth/password`、`GET /api/auth/password-status`。

管理（需要会话）：

- 站点：`PUT /api/admin/site-settings`（部分更新：只写出现的字段）。
- 服务：`GET|PUT /api/admin/server-settings`（校验失败返回 400，保存即生效）。
- 置顶：`GET|PUT /api/admin/pins`（PUT 替换整个列表，数组顺序即显示顺序）。
- 页面：`GET|POST /api/admin/pages`（新建 `_pages/<名称>/`，重名 409）、`GET|PUT /api/admin/page-meta/:slug`。
- 历史：`GET /api/admin/search/commits?q=`（提交说明搜索，覆盖全部提交）。
- 工作区：`GET /api/admin/status`、`tree`、`files`、`file`（GET/PUT/DELETE）、`file-at`、`workspace/raw`。
- 文章：`POST /api/admin/chapters`、`GET|PUT /api/admin/meta/:series/:chapter`、`GET|PUT /api/admin/series-meta/:series`、`POST /api/admin/preview`（body 为 `{ dir, content }`，`dir` 为 `<合集>/<n>` 或 `_pages/<名称>`）、`POST /api/admin/images`（表单字段 `dir`，即 `<合集>/<n>` 或 `_pages/<名称>`）。
- 标签：`GET /api/admin/tags`（含未使用的标签）、`POST /api/admin/tags`（新增，重名 409）、`PUT /api/admin/tags/:key`（改名，重名 409，同时改写工作区中的 `meta.yaml`）。
- Git：`stage`、`unstage`、`discard`、`diff`、`commit`、`log`、`commits/:oid`、`reset`、`revert`、`publish`、`status/dismiss-warning`。
- Token：`GET|POST /api/admin/tokens`、`DELETE /api/admin/tokens/:id`。
- 分享链接：`GET|POST /api/admin/articles/:series/:chapter/shares`（列表与创建，创建仅限已发布文章，返回 201）、`DELETE /api/admin/shares/:id`（停用）。
- 游客链接（公开）：`GET /api/articles/:series/:chapter/share` 返回 `{ link }`，没有时为 `null`；`POST` 查找或创建并返回链接。未发布返回 409。没有删除接口，删除只能通过管理员 API。
- 评论：`GET|PUT /api/admin/comments/settings`（保存时在 GitHub 上核对仓库与分类）、`GET /api/admin/comments/categories?repo=`、`POST /api/admin/comments/test`（只读检查）、`DELETE /api/admin/comments/:id`（从 GitHub 删除）。

错误格式统一为 `{ "error": "..." }`。

---

## 8. 配置

没有配置文件。两类配置：

1. **启动参数**：只在进程启动时读取，决定数据库位置与监听。优先级：命令行 > 环境变量 > 默认值。

   | 命令行 | 环境变量 | 默认 | 说明 |
   | --- | --- | --- | --- |
   | `--host` | `BROG_HOST` | `0.0.0.0` | 监听地址 |
   | `--port` | `BROG_PORT` | `8080` | 监听端口（1–65535） |
   | `--data` | `BROG_DATA_DIR` | `./data` | `brog.db` 与 `git/` 所在目录，迁移时整个目录拷贝即可 |
   | `--web-dist` | `BROG_WEB_DIST` | `./dist/web` | 前端构建目录 |
   | `--api-only` | `BROG_SERVE_WEB=false` | 开 | 不托管前端，只提供 API 与 git |
   | `--git` | `BROG_GIT` | `git` | git 可执行文件 |

2. **仅环境变量**（不入库，不在页面显示）：`BROG_GITHUB_TOKEN`，评论使用的 GitHub 令牌；`BROG_GITHUB_API`，GitHub GraphQL 地址，默认 `https://api.github.com/graphql`，用于 GitHub Enterprise 或本地测试。

3. **服务设置**：存在 SQLite，在「设置 → 服务」中修改，默认值见 6.8.1。服务端在每次使用时读取当前值（不缓存在模块常量中），因此保存即对后续请求生效：会话有效期、Cookie、CORS、反向代理、提交作者、全文搜索开关（切换时重建索引）。`pnpm reset-settings` 删除已保存的服务设置，下次启动时使用默认值（见 11.2）。

命令（`dist/server/main.mjs` 是生产入口，开发时用 `pnpm` 脚本）：

```bash
node dist/server/main.mjs --help        # 列出启动参数
node dist/server/main.mjs reset-password  # 忘记密码时使用，下次启动打印新的随机密码
node dist/server/main.mjs reset-settings  # 恢复服务设置的默认值
```

---

## 9. 开发、构建与部署

### 9.1 开发

```bash
pnpm install
pnpm dev                         # 服务端 :8080，前端 :5173（代理 /api /git /images 到 :8080）
```

`pnpm dev` 运行 `scripts/dev.mjs`，它是唯一的开发进程：

- Vite 在同一进程中运行，前端修改通过 HMR 生效。
- API 是一个子进程（`node --import tsx src/server/main.ts`）。`src/server` 与 `src/shared` 中的 `.ts` / `.json` 变化后，它会在 150ms 防抖后重启。
- 停止：Ctrl+C、SIGTERM、SIGHUP 先停 API 子进程，再关闭 Vite。
- 运行器被强制结束（SIGKILL）时，API 子进程通过 IPC 通道断开而退出（`src/server/main.ts` 中的 `process.once('disconnect')`）；父进程 pnpm 被结束时，运行器在一秒内检测到父进程变化并自行停止。端口 8080 与 5173 不会被遗留进程占用。
- 运行器只依赖 Node 与 Vite 的 API，不依赖 `concurrently` 或 `tsx watch`。旧方式的问题是：`concurrently` 被强制结束时，`tsx watch`、它的子进程和 Vite 都会遗留并占用端口。

首次启动会在控制台打印管理密码。

### 9.2 构建与运行

```bash
pnpm build          # = pnpm build:web（dist/web）+ pnpm build:server（dist/server/main.mjs）
pnpm start          # 运行 dist/server/main.mjs
pnpm reset-password # 忘记密码时使用
pnpm reset-settings # 恢复服务设置默认值
pnpm test
pnpm typecheck
```

前后端一体：直接运行 `dist/server/main.mjs`（默认托管前端）。

### 9.3 前后端拆分

- 只打包后端：`pnpm build:server`，把 `dist/server/` 和运行时依赖（`package.json` 的 `dependencies`，包含原生模块 better-sqlite3、sharp）部署到服务器。启动时加 `--api-only`（或 `BROG_SERVE_WEB=false`），并在「设置 → 服务」中填写前端来源（独立部署的前端地址）。
- 只打包前端：`VITE_API_BASE=https://api.example.com pnpm build:web`，把 `dist/web/` 部署到任意静态托管。后端在「设置 → 服务」中把 SameSite 设为 None、Secure Cookie 设为开启，并填写前端来源。
- 跨站 cookie 需要 HTTPS 与 `SameSite=None; Secure`。
- 服务端会缓存 `index.html` 模板。前端重新构建后需要重启服务端。

### 9.4 Docker 镜像与发布

- 镜像由 `Dockerfile` 构建，四个阶段：编译依赖（`deps`）、编译前后端（`build`）、生产依赖（`prod-deps`）、运行（`runtime`）。运行阶段只有生产依赖、`dist/` 和 `git`，以非 root 用户（`node`）运行，`/app/data` 是卷。
- 本地构建与运行：`docker build -t brog:local .`，`docker run -d -p 8080:8080 -v brog-data:/app/data brog:local`，然后 `docker logs` 查看管理密码。
- 带 nginx 的组合：`docker compose up -d --build`（`docker-compose.yml`）。nginx 发布 8080 端口并做 gzip，brog 只在内部网络可达。`BROG_GITHUB_TOKEN` 从环境或 `.env` 读取。
- 自定义启动参数：通过环境变量，例如 `docker run -e BROG_PORT=9000 ...`。评论需要 `-e BROG_GITHUB_TOKEN=...`。其余设置在后台「设置」中修改。
- 健康检查：`/api/site` 返回 200 即健康。
- 发布：`.github/workflows/docker.yml` 在推送 `main` 时发布 `main` 标签；推送 `v*` 标签（如 `v0.1.0`）时发布 `0.1.0`、`0.1`，以及 `latest`。镜像推送到 `ghcr.io/imduaky/brog`，平台为 linux/amd64 与 linux/arm64。
- GHCR 包默认是私有的，要公开需要在 GitHub 的 Packages 页面修改可见性。

---

### 9.5 缓存（CDN）

应用本身不压缩响应。压缩由反向代理负责：仓库提供 `deploy/nginx/brog.conf`，开启 gzip、加 `Vary: Accept-Encoding`，`/git/` 不压缩。CDN 也可以压缩，二者不要同时开启。应用只决定哪些响应可以被共享缓存保存。策略集中在 `src/server/routes/public.ts` 的 `CACHE`：

| 策略 | `Cache-Control` | 用于 |
| --- | --- | --- |
| `live` | `public, max-age=0, s-maxage=60` | 站点信息、列表、标签、系列、置顶、搜索、文章的最新版本（bundle、meta、content、source、history）、自定义页面的最新版本、HTML 外壳（`/`、`/s/…`、`/admin/…`） |
| `fixed` | `public, max-age=31536000, immutable` | 带 `?rev=` 的内容与原文、自定义页面的历史版本、对比（读者）、`/images/{hash}`、`/assets/*`（哈希文件名） |
| `fresh` | `no-cache` | 评论、游客链接、`/sh/{id}` 跳转 |
| `private` | `private, no-store` | 管理员的对比（可以看到未发布的提交） |

- 浏览器对 `live` 每次都重新验证（`max-age=0` + ETag，得到 304）。共享缓存保存 60 秒，所以发布后最多 60 秒可见。发布没有主动清除缓存。
- 公开响应从不写 `Set-Cookie`。公开接口只读取会话（`Sessions.isValid`），不续期；续期只发生在管理端的请求上。
- 错误响应与未知路径没有缓存头（默认 `no-cache`），不会被共享缓存保存。
- HTML 外壳缓存 60 秒。重新部署后，旧外壳可能在这 60 秒内引用已删除的哈希资源，之后自动恢复。
- 这些策略只是声明。实际命中率取决于 CDN 的配置与流量。

## 10. 测试

自动化测试（vitest，服务端与共享代码）：

- `tests/workflow.test.ts`：认证（错误密码、CSRF、7 天 cookie）、发布可见性、历史版本访问、reset 三种模式、revert、图片命名与 hash 访问、非法图片返回 400、git 匿名与认证的 clone/push、token 错误、非 main 分支被拒绝、外部 push 后的 rebase、发布后匿名可见。
- `tests/search-compare.test.ts`：全文搜索（3 字符、2 字符）、草稿不可搜、发布后重新索引、全文关闭时只搜标题、提交搜索只在管理 API 且覆盖全部提交、读者搜索的合集与标签、对比（管理员任意提交、读者仅已发布、文件范围、非法 revision 与路径）、原文接口、站点设置的部分更新与链接校验。
- `tests/settings.test.ts`：启动参数的优先级与非法端口、服务设置的读取与保存（可立即生效）、校验（SameSite=None 需要 Secure、非法 owner 与 CORS 来源）、切换全文搜索后重建索引、导航与友链的校验、置顶的顺序与未发布目标、自定义页面（`_pages/` 不是合集、未发布不可见、网页页面保持沙箱）。
- `tests/tags.test.ts`：目录的新增（去重、去空、长度与逗号校验）、读者与管理员看到的标签范围、meta 编辑时自动登记、按键的 AND 筛选、改名保留键并改写工作区、改名后发布才对读者生效、重名与不存在的键。
- `tests/appearance.test.ts`：预览文字与颜色在首页列表中的优先级、暗色自动推导、空预览不写入、外观默认值、颜色的校验、首页背景色按亮暗保存。
- `tests/seed.test.ts`：示例内容与 `README.md` 完全一致；全新安装即发布示例；示例正文以项目 README 开头，之后渲染 Markdown 的每一项功能，且不会出现可执行的脚本。
- `tests/comments.test.ts`：评论默认关闭（读者看不到、发表 403、令牌不出现在响应中）、开启需要令牌、保存时核对仓库与分类、换仓库清空讨论映射、测试面板的各步骤（含令牌失效时跳过后续步骤、只读）、首条评论创建讨论并复用、访客与 GitHub 登录名的区分、输入校验、发表限流（5 次 / 10 分钟）、列表缓存与失效、管理员删除。使用内存中的 fake GitHub，不访问真实 GitHub。
- `tests/cache.test.ts`：各类公开响应的缓存策略（列表与最新版本为 `live`、固定版本与图片为 `immutable`、评论与游客链接为 `no-cache`、管理员对比为 `private`、错误不缓存）、公开响应不写 `Set-Cookie`（即使管理员已登录）。
- `tests/share.test.ts`：读者不能删除链接（游客链接与管理员链接都是 404，链接仍可访问）、管理员删除游客链接后读者得到新链接；游客链接（每篇一个、并发首次请求只生成一个、管理员链接与游客链接并存且游客链接排在前、未发布返回 409、POST 需要 CSRF 头、停用后重新生成）、编号格式与唯一性、分享域名的优先级（分享域名 > 对外地址 > 请求域名）、分享域名不能带路径、302 跳转与 `no-cache`、未发布文章不能创建链接、文章移除后链接失效、停用、未知与畸形编号、仅管理员可操作。
- `tests/sha256.test.ts`：纯 JS 的 SHA-256 与 Node 的 crypto 结果一致（边界长度、UTF-8、随机输入）。
- `tests/markdown.test.ts`：提示框 / 标签页 / TOC / 图片路径 / 安全过滤 / 沙箱 demo / 图片命名上下文 / `data-line` / 展开结构（动画框与内层分离）。

前端没有单元测试。端到端检查在无头 Chromium 中手工执行，脚本不入库。评论的端到端检查连接的是本地的 fake GitHub（`BROG_GITHUB_API` 指向它），没有连接真实 GitHub。检查项：

- 登录、编辑自动保存、提交、发布，读者看到新内容。
- 阅读页：三栏布局、拖动分隔条、功能区缩小与展开（点击标题栏）、回到顶部、目录与历史开关、窄屏抽屉。
- 展开动画：收起时高度为 0，展开过程中高度单调变化。
- 行悬停：悬停后应用 box-shadow。
- 搜索对话框：输入后显示高亮片段，无提交结果。
- 对比页：diff 渲染、文件折叠。
- 编辑器：源码滚动时预览对齐，输入时两端滚动位置不变，布局偏移为 0。
- 页头：在首页、合集、标签、文章页上，导航中心与页面中心重合（页面有、无滚动条时都成立）；窄屏下导航可横向滚动，不与标题和按钮重叠。
- 导航、友链、自定义页面（Markdown 与网页）、置顶的显示与顺序，页脚的 Powered by。
- 设置页在宽屏下为两列，各卡片独立保存。
- 控制台无报错。

---

## 11. 待办与已知限制

### 11.1 第二阶段：GitHub 同步（未实现）

- 每次发布（Push）后，可选择同步到 GitHub：
  - 只同步提交历史：生成一个历史文件（包含每次提交的消息），推送到 GitHub。避免空提交。
  - 同步内容：每篇文章的内容一并同步。
- 评论已实现，见 6.17。

### 11.2 已知限制与未完成项

- 单分支、线性历史。提交树是一条线，没有分叉。
- 草稿中上传的图片一旦被渲染或上传过，就可以通过 `/images/{hash}` 访问。hash 是 128 位，不可猜测，但它不是访问控制。
- 限流计数在内存中，重启后清零。
- 单进程。SQLite 使用 WAL，不支持多实例部署。
- 外部 push 与网页编辑并发时，依赖 `repo.lock` 串行化。跨进程并发不受保护。
- 服务设置由进程内的缓存提供。`reset-settings` 只修改数据库，正在运行的实例需要重启后才生效。
- 搜索只覆盖已发布内容的正文、标题、标签和摘要。管理员的草稿内容不可搜索（提交说明可以搜索）。
- 两字符的文章搜索是子串扫描，文章数量很大时会变慢。可以把查询改为至少三个字符，或关闭全文索引。
- 提交搜索只看提交说明，不看作者和文件内容。最多 30 条。
- 对比的差异内容上限为 1 MB。
- 编辑器的滚动同步只有源码 → 预览一个方向。
- 文章摘要取自第一段，因此第一段中的文字也会匹配（全文关闭时尤其明显）。
- 布局偏好保存在浏览器本地，换一台设备不会同步。
- 标签目录没有删除操作。删除一个标签需要先从所有文章中移除，目前界面不提供。
- 标签目录存在 SQLite，不随 git 版本化。数据库丢失后，标签名会在下一次发布时从文章 `meta.yaml` 重新登记，键会重新生成。此行为未经测试。
- 置顶与友链同样存在 SQLite，数据库丢失后需要重新设置。
- 网页页面（`index.html`）可以包含任意脚本，安全边界只靠 iframe 沙箱。外部导航链接不做内容检查，只校验协议。
- 行悬停只作用于代码、原文、diff 中的行。正文段落不加。
- 评论没有对真实 GitHub 做过端到端测试。测试与浏览器检查用的是 fake GitHub；GraphQL 操作已对照 GitHub 公开的 schema 校验（字段与参数），但令牌权限（Discussions 的读写）要到第一条真实评论发表时才能确认。
- 评论列表只取前 100 条，没有分页。
- 在 GitHub 上直接写的 Markdown 评论按纯文本显示。
- 访客身份只是读者自填的昵称，任何人都可以用任何昵称发表。目前只靠发表限流和管理员删除。
- 评论列表缓存在进程内存中（60 秒），与其它内存状态一样，重启后清零。
- 窄屏（< 640px）下导航不居中，改为横向滚动。
- 以下功能只通过 API 与部分界面验证，没有逐项在浏览器中完整操作：导航编辑、置顶排序、友链编辑、自定义页面的创建与编辑。
- 镜像在 arm64 上构建并运行过；amd64 由 GitHub Actions 构建，本地未验证。
- 服务端依赖系统 `git`，git 版本需要支持 `http-backend` 与 smart HTTP。

### 11.3 待确认的设计问题

- 「示例」合集是仓库初始化时写入的种子内容。第 12 节要求种子内容不使用示例名称，两者冲突，需要决定：保留示例合集，或改为空仓库加 README。
- 置顶与友链目前存 SQLite，与标签目录一致（不随 git 版本化）。如果希望它们有历史、可随仓库迁移，需要改为存入仓库。
- 全文搜索默认开启，搜索会读取文章正文。是否改为默认关闭。
- 阅读页三栏的断点（1280px）与首页双列的断点（1024px）是否需要按实际设备调整。
- 行悬停阴影是否扩展到正文段落。段落折行后"一行"的含义不明确，暂不加。
- 管理员的双击改名是页面内编辑，选中用单击，改名用双击或 F2。单击在管理员视图中延迟 220ms 生效。是否需要改成显式的编辑按钮。
- 外部链接的 `rel` 与安全属性（如 `noreferrer`）目前只对 `_blank` 链接设置，是否需要对所有外部地址统一处理。
- 评论是否需要 GitHub 登录，或发表后人工审核再显示。目前是读者无需账号、发表即显示。
- 评论是否支持 Markdown。目前是纯文本，理由是读者输入的内容不能渲染 Markdown 中的链接、图片与 HTML。

---

## 12. 给 AI 代理的约定

- 本文只描述当前的设计、实现与待办，不记录变更历史（历史见 git）。修改代码时同步更新本文相关章节。
- 遇到设计取舍（尤其是 Git 语义、认证、存储格式、对外 API）先询问用户，不要擅自决定。
- 改变第 2 节的决策前，先征得同意，并更新第 2 节。
- 依赖选择：优先成熟的库；优先查询 npm 上的最新版本；不要引入过时的版本。
- 代码风格：TypeScript strict；服务端 ESM，导入带 `.ts` 扩展名；注释只写必要的"为什么"；与周围代码保持一致的命名和写法。
- 运行时设置在使用处读取（`settings.get()`），不要在模块或请求之外缓存，否则保存后不会生效。
- 文案使用中文，面向读者和管理员，不写后端实现细节（哈希算法、索引结构、git 内部引用等）。
- 样式只使用 `src/web/styles.css` 中定义的 token，不要硬编码颜色。圆角使用 token（`rounded-sm` / `rounded-md` / `rounded-lg`），不使用 `rounded-full`（状态圆点除外）。可点击的元素必须有悬停反馈（`clickable` 工具类或按钮样式）。
- 圆角：贴在一起、形成整体的结构区域（页头、阅读面板、表格、分隔线两侧）保持直角，只靠边框分隔。相互分开的元素（卡片、标签、按钮、输入框、列表项、带边框的提示块）使用小圆角（`rounded-sm` 4px、`rounded-md` 6px、`rounded-lg` 8px）。加间隙的元素一定要有圆角。
- 颜色：页面颜色只通过 `--background` / `--foreground` 和由它们混合的 token 指定。不要写死米色、白色或深色的十六进制值。
- 管理端页头与公开页头一样使用三列网格：标签居中，窄屏下标签区域横向滚动。
- 窗口滚动条只在页面真的可滚动时出现。不要给 `html` 设 `overflow-y: scroll`（会让每个页面都有一条窗口滚动条）。居中行（页头、主体、页脚）使用 `frame` 工具类，它的右侧留白读取 `--sb-pad`（见 `src/web/lib/scrollbar.ts`），让页面有无滚动条时内容的位置一致。
- 可滚动的容器必须是定位元素（`relative`），否则其中绝对定位的子元素（如原生 `select`、表单输入）会逃出容器，把整个页面撑出滚动条。
- 动画优先使用 `transform` 和 `opacity`。只在必要时改变 `height`（可折叠块）或 `width`（阅读页面板）。时长 120–260ms。见 6.16。必须尊重 `prefers-reduced-motion`。
- 示例名称（合集、章节、标题）不得进入代码的默认值、占位文字。测试数据使用中性名称。种子内容的问题见 11.3。
- 修改后运行 `pnpm typecheck` 和 `pnpm test`，涉及前端的改动还要运行 `pnpm build:web`，并重启服务端后再在浏览器中验证。
- 提交（commit）只在用户明确要求时进行。用户检查完毕之前不要提交。
- 凭据（GitHub 令牌等）只来自环境变量，不得写入数据库、日志或接口响应。
- 不要把 `data/`、`dist/`、`node_modules/` 加入版本控制（已在 `.gitignore` 中）。
