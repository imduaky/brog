# brog — AGENTS.md

个人博客程序。TypeScript + React 前端，Node 服务端，Git 仓库作为文章存储，SQLite 作为索引与元数据存储。
本文件同时是设计文档和给 AI 代理的工作约定。实现与本文不一致时，以本文为准并同步修改本文。

文中的名称（系列、章节、标题）都是占位符，不是默认值。代码里不得把任何示例名称当作默认值、占位文字或种子内容。

---

## 1. 目标

- 管理员（博主）在线用 Markdown 编辑文章，支持 mkdocs-material 风格的扩展语法。
- 每篇文章有自己的提交历史。管理员可以 reset 到某个版本，也可以 revert 某个提交，还可以对比任意两个提交。
- 文章仓库本身是一个 Git 服务器：任何人可以 clone 阅读，持有 token 的人可以 push。
- 后端和前端在同一个程序里交付，同时支持只打包后端或只打包前端（前后端分离部署）。
- 后端暴露 API，方便第三方做管理面板。
- 界面统一、简洁、直角。可点击区域悬停时必须有明显的反馈。

---

## 2. 已确认的设计决策

问答中确认过的取舍。改动这些决策前必须先询问。

| 主题 | 决策 |
| --- | --- |
| 管理入口 | 在任意非输入区域连续按 `w` 三次（1.5 秒内）弹出密码框。文档原先同时写了三次和两次，以三次为准。 |
| 密码传输 | 浏览器计算 `sha256(password)` 的十六进制后发送。服务端用 bcrypt（cost 12）对比，库中只存 `bcrypt(sha256hex)`。 |
| 会话 | HttpOnly cookie `brog_session`，有效期 7 天。每次校验会话都把过期时间顺延到"现在 + 7 天"，数据库写入至多每小时一次。修改密码会吊销其它会话。 |
| 密码初始化 | 密码不在配置文件里。首次启动在控制台打印随机密码。只要管理员没设置过密码，每次启动都重新生成并打印，并提醒修改。`pnpm reset-password` 可以回到这一状态。 |
| Git 存储 | 磁盘上的真实 bare 仓库，由系统 `git http-backend` 提供 smart HTTP。SQLite 只存元数据（图片映射、token、会话、设置、索引缓存、全文索引）。 |
| 分支 | 只有一个 `main`，不做其它分支。 |
| 网页上的 Commit | 写入工作区，然后像 git 一样暂存、提交。提交不会改变读者看到的内容。 |
| 网页上的 Push（发布） | 把"已发布提交"指针移动到当前工作区版本，并重建索引。读者看到的内容只在这一步变化。 |
| 匿名 clone | 只拿到已发布版本（`public.git`，与 `blog.git` 共享对象）。 |
| 带 token 的 clone/push | 见第 6.2 节。 |
| 外部 push 与未提交修改 | 外部 push 只更新 `main`，不会自动发布。如果工作区有未提交修改，先 stash，应用 push 后 reset 到新版本，再把修改重新应用（即 rebase 语义）。冲突时保留冲突标记并在后台提示；无法应用时修改保留在 stash 中。 |
| reset | 作用于整个仓库，使用 git 的 `soft` / `mixed` / `hard` 三种模式，默认 `soft`。reset 前会列出被移出的提交。 |
| revert | 生成一个新的反向提交（merge commit 使用 `-m 1`）。 |
| 对比（compare） | 任意两个提交的 diff，形式为 `base...head`，hash 可以直接输入。读者只能对比已发布历史中的提交。 |
| 图片 | 粘贴或拖入图片后转换为 webp，按标题命名后存入仓库的 `img/`。对外只暴露哈希链接 `/images/{hash}`。 |
| 文章元数据 | 标题、标签名、封面、摘要、系列名、预览信息等存在 `meta.yaml`，随 git 版本化。SQLite 只缓存索引。 |
| 预览信息 | 每篇文章的 `preview` 块：`text`（首页卡片上的文字）与 `theme`（卡片颜色，亮色与暗色各一个）。与正文和摘要无关，可以手动设置。留空时卡片文字依次回退到摘要、正文第一段。 |
| 外观 | 阅读底色（全站，亮/暗各一个）由一个颜色推导出所有界面颜色，默认米黄色（亮）与暖深灰（暗）。首页背景色只用于首页，亮/暗各一个。在后台「设置 → 外观」中修改。背景图功能已删除。 |
| 标签 | 标签目录存在 SQLite：每个标签有一个唯一且稳定的键和一个可修改的名称。文章的标签名仍写在 `meta.yaml`，编辑时从目录中选择。读者页用键做筛选，改名不会断开链接。多选筛选为同时包含全部所选标签（AND）。 |
| 站点设置 | 标题、简介、页脚文字、页脚链接、是否显示克隆地址、文章列表布局（自动 / 单列 / 双列，默认自动），由管理员在页面上设置，存在 SQLite。`brog.yaml` 的 `site.title` / `site.description` 只在尚未保存过设置时作为初始值。 |
| 首页布局 | 默认自动：页面宽度 ≥ 1024px 时双列，否则单列。内容最大宽度为 1024px（双列）或 768px（单列），防止过宽。 |
| 页头 | 导航在页头正中，左侧为站点标题，右侧为搜索和主题切换。向下滚动时页头收起，向上滚动时立即出现，回到顶部时始终显示。收起时粘性面板的顶部位置同步变化。管理端有自己的页头，不收起。 |
| 搜索 | 文章全文搜索（SQLite FTS5，trigram）、文章标题/标签/摘要、提交说明。只索引已发布内容（管理员的提交搜索覆盖全部提交）。全文索引可以在配置中关闭。 |
| 读者 API | 一次请求返回元数据、渲染后的正文、TOC、历史和上下篇（bundle），同时拆分出 meta / content / source / history 小接口。 |
| 阅读页布局 | 四栏：目录（可隐藏）\| 正文 \| 原文（可隐藏）\| 历史（可隐藏）。分隔线可拖动调整宽度，每栏有自己的隐藏开关。各栏打开和关闭时宽度以动画过渡。右下角功能区提供回到顶部和各栏开关，可以缩小为一个按钮。窄屏下各栏改为抽屉。布局偏好保存在浏览器本地。 |
| 文章实时编辑 | 左侧 CodeMirror 源码，右侧与线上渲染一致的实时预览，自动保存到工作区（不是协同编辑）。预览随源码滚动同步。 |
| 渲染方式 | Vite SPA。后端在文章页 HTML 中注入 `title` / `description` / `og:*`，兼顾分享卡片和基础 SEO。 |
| 动效 | 为交互提供短促的动画（120–260ms），不做炫技。包括：可折叠块展开/收起（高度与透明度）、阅读页面板开关（宽度）、页面切换淡入、列表卡片依次出现、按钮按下反馈、页头收起、功能区弹出、标签选中、图表和图片淡入。尊重系统的"减少动态效果"设置（全局关闭过渡）。见第 6.14 节。 |
| 行悬停 | 代码块、原文、diff 中的每一行，鼠标悬停时加一层阴影，方便读者区分行。 |
| JS 插入 | 在沙箱 iframe 中运行（`sandbox="allow-scripts"`，没有同源权限，拿不到管理员 cookie）。 |
| UI | shadcn/ui（Radix 底座）+ Tailwind CSS v4。米色底、暖色文字，支持深色模式。圆角规则见第 12 节：贴在一起的结构区域保持直角，相互分开的元素使用小圆角（4–8px）。 |
| 运行时与包管理 | Node 24，pnpm 11。服务端框架 Hono。 |
| 评论区 | 第二阶段（见第 11 节）。 |

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
  shared/          前后端共用：类型（types.ts）、路径规则（paths.ts）、颜色（color.ts：校验、混色、对比文字、预设）、sha256.ts（纯 JS 的摘要，供没有 crypto.subtle 的 HTTP 站点登录）
  server/
    main.ts        CLI 入口：serve / reset-password
    bootstrap.ts   启动：打开数据库、初始化仓库、生成密码、组装应用
    app.ts         Hono 应用：安全头、CSRF 校验、路由挂载、错误处理
    config.ts      brog.yaml 的 schema 与解析
    db.ts          SQLite 连接与迁移（PRAGMA user_version）
    context.ts     应用上下文与公共工具
    auth/          password.ts（sha256 / bcrypt）、session.ts、tokens.ts（git token + 限流）
    git/           exec.ts（git 子进程）、repo.ts（BlogRepo：工作区、提交、reset、对比、搜索提交、外部 push 同步）、
                   catfile.ts（长驻 cat-file 读对象）、http.ts（smart HTTP 桥接）
    content/       service.ts（发布、索引、全文索引、读者数据、搜索、对比、图片、工作区操作）、
                   meta.ts（meta.yaml，含预览信息）、tags.ts（标签目录）、site-settings.ts（站点设置与外观）、
                   seed.ts（初始内容：说明文件与「示例」系列）、seed/（示例用的 README 副本、Markdown 演示、脚本与图）
    markdown/      render.ts（渲染入口）、containers.ts（提示框 / 标签页 / 按键）、
                   sanitize.ts、heading-context.ts（图片命名用的标题上下文）
    routes/        auth.ts、public.ts（读者 API：站点、文章、搜索、对比）、admin.ts（管理 API）、
                   git.ts、web.ts（SPA 托管与 meta 注入）
    util/          mutex.ts、lru.ts
  web/
    main.tsx       入口、路由表；/admin 只有已登录时才会懒加载管理端代码
    styles.css     设计 token、圆角、Markdown 样式、动画、行悬停
    lib/api.ts     API 客户端（CSRF 头、VITE_API_BASE、sha256）
    hooks/         use-theme、use-session、use-key-sequence（www 快捷键）、use-site、
                   use-media（响应式）、use-debounced、use-header-autohide（页头收起）
    components/    站点布局（页头收起）、搜索对话框、管理员登录框、Markdown 视图（展开动画）、TOC、
                   提交树（commit-tree）、源码视图、diff 视图、面板标题、拖动分隔条、阅读页功能区、文章卡片（带颜色）、
                   颜色选择（color-field）、页面底色同步（site-theme）
    components/ui/ shadcn 生成的组件（sonner 已改为不依赖 next-themes）
    pages/         首页、系列、标签（选择、筛选、管理员改名与新增）、文章阅读页、对比页（读者与管理员共用）
    admin/         工作区（dashboard）、编辑器（含首页预览）、历史、Token、设置（站点、外观、密码）
tests/             vitest：工作流、搜索与对比、标签、外观与预览、示例内容、sha256、Markdown
brog.example.yaml  配置模板（brog.yaml 不入库）
Dockerfile         多阶段镜像：编译阶段、生产依赖、运行阶段（非 root 用户，数据目录为卷）
.dockerignore      镜像构建忽略的文件
.github/workflows/docker.yml   推送 main 与 v* 标签时构建 linux/amd64、linux/arm64 镜像并推送到 GHCR
tsdown.config.ts   服务端打包
vite.config.ts     前端构建与开发代理
```

---

## 5. 内容仓库格式

仓库 `data/git/workspace` 就是博客内容，也是 `git clone` 得到的结构：

```
README.md                     仓库说明（初始提交只包含这一个文件，没有示例内容）
<系列>/                        系列文件夹（文件夹名即系列标识）
  meta.yaml                   系列：title / description / cover
  <n>/                        第 n 篇（编号即文章序号，从 1 开始）
    meta.yaml                 文章：title / tags / cover / summary
    content.md                正文
    img/                      图片，命名规则见第 6.4 节
    js/                       供 live demo 引用的脚本
```

规则：

- 系列文件夹名、章节编号、图片文件名都经过 `shared/paths.ts` 校验，不允许 `.`、`..`、路径分隔符和控制字符。
- `meta.yaml` 解析失败时使用默认值，不让一个坏文件拖垮整站。
- 新建文章时编号为系列中的下一个数字。

---

## 6. 功能细节

### 6.1 认证与管理入口

- 读者页面看不到任何管理入口。在页面上连续按 `w` 三次（1.5 秒内，且焦点不在输入框或编辑器中）才弹出登录框。已登录时直接进入 `/admin`。
- `/admin/*` 在未登录时返回 404，且不会下载管理端的代码包。
- 登录失败每个 IP 每 15 分钟最多 10 次。计数保存在内存中，重启后清零。
- 所有非 GET 的 `/api/*` 请求必须带 `x-brog-request: 1`（浏览器跨域时需要预检，CSRF 防护）。
- 生产环境必须使用 HTTPS。sha256 作为"密码"在明文 HTTP 上可以被重放。

### 6.2 Git 服务

| 地址 | 匿名 | 带 token |
| --- | --- | --- |
| `/git/blog.git` | clone/fetch 已发布版本 | 完整 `main`（含草稿）；可 push |
| `/git/full/blog.git` | 401，要求认证 | 完整 `main`；可 push |

- `/git/full/blog.git` 是为写作者设计的入口。git 客户端只有收到 401 才会发送凭据，所以它会主动要求认证。
- 认证方式：HTTP Basic，用户名为 `site.owner`（配置中的 `site.owner`，不是站点标题），密码为管理页面签发的 token（前缀 `brog_`，服务端只保存 sha256）。
- 只允许推送 `refs/heads/main`（`pre-receive` 钩子）。内部引用对客户端隐藏。
- 管理页面可以新建、列出、吊销 token，并显示最近使用时间。

### 6.3 编辑、提交、发布

1. 编辑器自动保存到工作区（防抖 800ms），离开页面前若有未保存内容会提示。
2. 文章页的"提交"只暂存并提交这篇文章的文件（以及系列的 `meta.yaml`）。其它修改在工作区页面处理。
3. 工作区页面有完整的 git 操作：暂存、取消暂存、丢弃、查看差异、提交，以及发布（Push）。
4. 发布前显示待发布的提交列表。工作区版本与已发布版本一致时，发布按钮禁用。
5. 发布时只重新索引内容有变化的文章（见第 6.9 节）。

### 6.4 图片

- 粘贴或拖入图片：前端上传到 `POST /api/admin/images`，后端用 sharp 转为 webp（质量 82，自动旋转）。非法图片返回 400。上传上限 20 MB。
- 文件名：`<标题链>_<序号>.webp`。标题链是从一级标题到当前小节的所有标题，用 `-` 连接，特殊字符替换为空格后用 `_` 连接，最长 60 字符。
  - 规则示例：在一级标题 `A` 下的二级标题 `B` 的第二张图片 → `A-B_1.webp`。
  - 序号从 0 开始，按"同一小节内、光标之前"的图片数计算。文件已存在时递增。
- 文件保存在 `<系列>/<n>/img/`，随 git 提交。编辑器插入相对路径 `![](img/xxx.webp)`。
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

### 6.6 JS 示例

- 只有 `js live` 或 `html live` 代码块会被执行，并且只在 `sandbox="allow-scripts"` 的 iframe 中执行。
- iframe 使用 `srcdoc`，因此拿不到站点 cookie、DOM 或管理接口。
- iframe 高度由 iframe 内的 `postMessage` 自动调整。

### 6.7 读者页面

- 文章页布局（宽度 ≥ 1280px）：目录 | 正文 | 原文 | 历史。
  - 每栏顶部有标题和隐藏开关。目录的开关在目录上方。栏始终挂载，关闭时宽度动画收到 0，内容不被挤压。
  - 分隔线可以拖动调整宽度，双击复原，或用方向键微调。宽度范围：目录 160–420px，原文 280–900px，历史 200–460px。
  - 布局偏好（哪些栏打开、宽度、功能区是否缩小）保存在浏览器本地 `localStorage`。
- 右下角功能区：回到顶部、目录、原文、历史。可以缩小为一个按钮，再次点击展开。
- 窄屏（< 1280px）：各栏改为从两侧滑出的抽屉，由功能区打开。
- 原文：文章的 Markdown 源码，逐行显示行号，可复制。读取的是已发布版本（或 `?rev=` 指定的历史版本）。
- 历史：提交树。每个版本一个圆点，连成一条竖线，当前阅读的版本填充。点击行即切换到该版本。每行右侧的图标与上一版本对比。最新版本标注"最新"。
- 历史版本：`?rev=<oid>` 只允许已发布提交的祖先。页面顶部会提示正在阅读旧版本，并提供返回最新版本的入口。
- 首页文章列表：默认自动（宽屏双列），也可在站点设置中固定为单列或双列。系列列表、系列详情、标签页。
- 页头收起：向下滚动超过 80px 时收起，向上滚动任意距离即出现。搜索对话框打开时保持出现。
- 页脚：文字、链接和克隆地址都由站点设置控制。

### 6.8 站点设置

管理员在"设置 → 站点"中修改，保存后立即生效，读者页面通过 `GET /api/site` 读取。

| 设置 | 说明 |
| --- | --- |
| 站点标题、站点简介 | 页头、首页、页面 `<title>` 与 meta 标签 |
| 文章列表布局 | 自动（宽屏双列，默认）、单列或双列 |
| 页脚文字 | 纯文本 |
| 页脚链接 | 最多 12 个，名称 ≤ 40 字，地址只允许 `http(s)://`、`mailto:`、站内路径 `/...` 和锚点 `#...` |
| 在页脚显示克隆地址 | 布尔值 |

- 尚未保存过站点设置时，标题和简介取自 `brog.yaml` 的 `site` 段。保存之后数据库中的值优先，修改 yaml 不再生效。
- `site.owner` 不在站点设置中，它是 git 推送的用户名，只能在配置文件中修改。

### 6.9 搜索

- 入口：页头的"搜索"按钮，或键盘 `/`、`Ctrl+K`。输入防抖 200ms，少于两个字符不查询。
- 文章搜索：
  - 3 个字符及以上：FTS5 trigram 索引，`MATCH` 查询。
  - 2 个字符：对全文做子串扫描。
  - 结果排序用 `bm25`，标题权重高于正文。结果中的匹配文字用 `<mark>` 高亮，片段由服务端生成，只包含纯文本标记（`\u0002` / `\u0003`），前端不解析 HTML。
- 增量索引：每次发布只重新索引内容或元数据的 blob 指纹有变化的文章，删除的文章同时移除索引。
- 全文索引可以在 `search.fullText: false` 时关闭。关闭后只搜索标题、标签和摘要，搜索结果页会提示。
- 提交搜索：按提交说明（主题和正文）搜索，大小写不敏感，最多 30 条，每条列出涉及的文章。
  - 读者：只搜已发布历史。管理员：搜全部提交，包括未发布的。
  - 点击提交结果打开该提交与父提交的对比。
- 文章搜索的读者结果只包含已发布内容。

### 6.10 对比（compare）

- 路由：读者 `/compare/<base>...<head>`，管理员 `/admin/compare/<base>...<head>`，可选 `?path=<系列>/<n>` 只看一篇文章。
- 两端可以是任意提交的 hash（4 位及以上的十六进制前缀）。顶部可以直接输入两个 hash，也可以交换两端。
- 页面显示两端提交的信息、文件数、增删行数，以及每个文件的 diff（新增、修改、删除、二进制）。
- diff 带新旧行号。每行悬停有阴影。单个文件可以折叠。
- 读者只能对比已发布历史中的提交。管理员可以对比任意提交。
- 差异内容超过 1 MB 时，超出部分只显示文件名和行数统计，页面会提示。
- 入口：历史页面（管理员）可以勾选两个提交点"对比所选"；每个 hash 都是链接，指向它与父提交的对比；读者历史树的图标与上一版本对比。

### 6.11 编辑器

- 左侧源码，右侧预览。预览在每种布局下都保持渲染，切换布局不会出现空白或转圈。预览保留上一次结果直到新结果到达，所以正文不会因重新渲染而跳动。
- 滚动同步：源码滚动时，预览按块的源码行号对齐，相邻两块之间线性插值。方向只有一个（源码 → 预览）。
- 自动保存：防抖 800ms。Ctrl/Cmd+S 立即保存。
- CodeMirror 的扩展只依赖稳定的回调，输入时不会重新配置编辑器（这是之前跳动的原因）。

### 6.12 站点渲染与 SEO

- 文章页和系列页的 HTML 由服务端注入 `<title>`、`description`、`og:title`、`og:description`、`og:type`、`og:image`。
- 其它页面使用站点设置中的标题和简介。

### 6.13 标签

- 标签目录（SQLite 表 `tags`）：每个标签有唯一键（8 位，随机生成，不变）和名称（可改，1–30 字，不含逗号）。
- 文章的标签名写在 `meta.yaml`。发布时，索引把每篇文章的标签保存为 `{键, 名称}`，读者看到的是上次发布时的名称。
- 标签页（`/tags`）：
  - 读者：只显示已有文章使用的标签，卡片上显示篇数。单击选中或取消，选中状态写在 URL（`?tags=键,键`），可以分享。选中多个时只显示同时带有全部所选标签的文章（AND）。
  - 管理员（同一页面，已登录时）：可以双击标签修改名称（或选中后按 F2），回车保存，Esc 取消。末尾的 `+` 新增标签。未使用的标签显示为虚线卡片。
  - 单击在管理员视图中延迟约 220ms 才生效，以免与双击冲突。
- 改名：更新目录，并把工作区中所有使用它的 `meta.yaml` 改为新名称（工作区修改，和正文一样需要提交与发布）。发布前读者仍看到旧名称。
- 编辑器的标签：文章信息中从目录里选择（多选），输入目录中没有的名称会先加入目录。
- 限制：目录中的标签没有删除操作。目录存在 SQLite，不随 git 版本化（见第 11.3 节）。

### 6.14 外观

- 颜色只有一个来源：阅读底色（`paper`，亮/暗各一个）。`--background` 设为底色，`--foreground` 按底色亮度自动选黑字或白字，其余颜色（卡片、边框、输入框、强调）都从这两个颜色混合得出。因此换一个底色，整站一起变。
- 阅读底色用于所有页面。首页背景（`home.color`）只作用于首页，固定在视口背后，不随列表滚动。
- 背景图功能曾经存在（上传到 SQLite、遮罩、`/media/...` 路由），已在第一版之前删除。数据库迁移中有一步删除了它的表。
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

## 7. API 概览

公开（只读，只返回已发布内容，部分接口对管理员会话放宽）：

- `GET /api/site`：站点设置（`settings`）、克隆地址、已发布提交。
- `GET /api/articles[?tags=<键>,<键>&series=]`：`tags` 为标签键，多个时取交集。
- `GET /api/series`、`GET /api/series/:series`。
- `GET /api/tags`：有文章使用的标签，含篇数。
- `GET /api/articles/:series/:chapter`：bundle（meta + content + history + prev/next）。
- `GET /api/articles/:series/:chapter/meta|content|source|history`，支持 `?rev=`（history 除外）。
- `GET /api/search?q=&scope=all|articles|commits`：返回 `articles`、`commits`、`fullText`。
- `GET /api/compare?base=<hash>&head=<hash>[&path=<系列>/<n>]`：读者只能用已发布提交。
- `GET /images/:hash`。

会话：`GET /api/auth/session`、`POST /api/auth/login`（`{ password: sha256hex }`）、`POST /api/auth/logout`、`POST /api/auth/password`、`GET /api/auth/password-status`。

管理（需要会话）：

- 站点：`PUT /api/admin/site-settings`（外观与文字设置一起保存；图片版本号由服务端维护）。
- 工作区：`GET /api/admin/status`、`tree`、`files`、`file`（GET/PUT/DELETE）、`file-at`、`workspace/raw`。
- 文章：`POST /api/admin/chapters`、`GET|PUT /api/admin/meta/:series/:chapter`、`GET|PUT /api/admin/series-meta/:series`、`POST /api/admin/preview`、`POST /api/admin/images`。
- 标签：`GET /api/admin/tags`（含未使用的标签）、`POST /api/admin/tags`（新增，重名 409）、`PUT /api/admin/tags/:key`（改名，重名 409，同时改写工作区中的 `meta.yaml`）。
- Git：`stage`、`unstage`、`discard`、`diff`、`commit`、`log`、`commits/:oid`、`reset`、`revert`、`publish`、`status/dismiss-warning`。
- Token：`GET|POST /api/admin/tokens`、`DELETE /api/admin/tokens/:id`。

错误格式统一为 `{ "error": "..." }`。

---

## 8. 配置

`brog.yaml`（从 `brog.example.yaml` 复制）。没有 `--config` 时，如果当前目录有 `brog.yaml` 就使用它，否则使用内置默认值。

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `server.host` / `server.port` | `0.0.0.0` / `8080` | 监听地址 |
| `server.baseUrl` | 无 | 对外地址，用于 clone 地址、meta 标签和 Secure cookie 判断 |
| `server.serveWeb` | `true` | 是否由后端托管前端。关闭后只提供 API 与 git |
| `server.webDist` | `./dist/web` | 前端构建目录 |
| `server.trustProxy` | `false` | 是否信任 `X-Forwarded-For`（只在反向代理后开启） |
| `server.corsOrigins` | `[]` | 独立部署的前端来源（需要带 cookie） |
| `data.dir` | `./data` | `brog.db`、`git/` 所在目录。迁移时整个目录拷贝即可 |
| `site.title` / `site.description` | `My Blog` / 空 | 只作为初始值，保存过站点设置后以数据库为准（见第 6.8 节） |
| `site.owner` | `owner` | git 推送的用户名（只允许字母、数字、`._-`） |
| `site.language` | `zh-CN` | 页面语言 |
| `auth.sessionDays` | `7` | 会话有效期（每次访问续期） |
| `auth.cookieSecure` | `auto` | `auto` 在 `baseUrl` 为 https 时开启 |
| `auth.cookieSameSite` | `lax` | 独立部署的前端在不同站点时需要 `none`（同时需要 Secure） |
| `search.fullText` | `true` | 索引文章正文。关闭后只搜索标题、标签和摘要 |
| `git.binary` | `git` | git 可执行文件 |
| `git.authorEmail` / `authorName` | `brog@localhost` / `site.owner` | 网页提交使用的作者信息 |

---

## 9. 开发、构建与部署

### 9.1 开发

```bash
pnpm install
cp brog.example.yaml brog.yaml   # 可选
pnpm dev                         # 服务端 :8080，前端 :5173（代理 /api /git /images 到 :8080）
```

首次启动会在控制台打印管理密码。

### 9.2 构建与运行

```bash
pnpm build          # = pnpm build:web（dist/web）+ pnpm build:server（dist/server/main.mjs）
pnpm start          # 运行 dist/server/main.mjs
pnpm reset-password # 忘记密码时使用
pnpm test
pnpm typecheck
```

前后端一体：直接运行 `dist/server/main.mjs`，`server.serveWeb: true`。

### 9.3 前后端拆分

- 只打包后端：`pnpm build:server`，把 `dist/server/` 和运行时依赖（`package.json` 的 `dependencies`，包含原生模块 better-sqlite3、sharp）部署到服务器。配置中设置 `server.serveWeb: false`，并列出前端来源到 `server.corsOrigins`。已验证：只安装生产依赖后，服务端和 sqlite 原生模块可以正常运行。
- 只打包前端：`VITE_API_BASE=https://api.example.com pnpm build:web`，把 `dist/web/` 部署到任意静态托管。后端 `auth.cookieSameSite: none`，`cookieSecure` 为 true，并配置 `corsOrigins`。已验证：API 地址被正确写入产物。
- 注意：跨站 cookie 需要 HTTPS 与 `SameSite=None; Secure`。
- 服务端会缓存 `index.html` 模板。前端重新构建后需要重启服务端。

---

### 9.4 Docker 镜像与发布

- 镜像由 `Dockerfile` 构建，四个阶段：编译依赖（`deps`）、编译前后端（`build`）、生产依赖（`prod-deps`）、运行（`runtime`）。运行阶段只有生产依赖、`dist/` 和 `git`，以非 root 用户（`node`）运行，`/app/data` 是卷。
- 本地构建与运行：`docker build -t brog:local .`，`docker run -d -p 8080:8080 -v brog-data:/app/data brog:local`，然后 `docker logs` 查看管理密码。
- 自定义配置：把 `brog.yaml` 挂载到 `/app/brog.yaml`，服务端会自动读取。
- 健康检查：`/api/site` 返回 200 即健康。
- 发布：`.github/workflows/docker.yml` 在推送 `main` 时发布 `main` 标签；推送 `v*` 标签（如 `v0.1.0`）时发布 `0.1.0`、`0.1`，以及 `latest`。镜像推送到 `ghcr.io/imduaky/brog`，平台为 linux/amd64 与 linux/arm64。
- 第一版：`v0.1.0`。
- 新建的 GHCR 包默认是私有的。要公开，需要在 GitHub 的 Packages 页面修改可见性。

## 10. 测试

- `tests/workflow.test.ts`：认证（错误密码、CSRF、7 天 cookie）、发布可见性、历史版本访问、reset 三种模式、revert、图片命名与 hash 访问、非法图片返回 400、git 匿名与认证的 clone/push、token 错误、非 main 分支被拒绝、外部 push 后的 rebase、发布后匿名可见。
- `tests/search-compare.test.ts`：全文搜索（3 字符、2 字符）、草稿不可搜、发布后重新索引、全文关闭时只搜标题、提交搜索的可见范围、对比（管理员任意提交、读者仅已发布、文件范围、非法 revision 与路径）、原文接口、站点设置的优先级与链接校验。
- `tests/tags.test.ts`：目录的新增（去重、去空、长度与逗号校验）、读者与管理员看到的标签范围、meta 编辑时自动登记、按键的 AND 筛选、改名保留键并改写工作区、改名后发布才对读者生效、重名与不存在的键。
- `tests/appearance.test.ts`：预览文字与颜色在首页列表中的优先级、暗色自动推导、空预览不写入、外观默认值、颜色的校验、首页背景色按亮暗保存。
- `tests/seed.test.ts`：示例内容与 `README.md` 完全一致；全新安装即发布示例；示例正文以项目 README 开头，之后渲染 Markdown 的每一项功能（提示框、可折叠、标签页、代码标题与行号、高亮行、按键、标记、上下标、公式、脚注、任务列表、表格、删除线、缩写、定义列表、流程图、图片、两种 JS 示例、属性、允许的原始 HTML），且不会出现可执行的脚本。
- `tests/sha256.test.ts`：纯 JS 的 SHA-256 与 Node 的 crypto 结果一致（边界长度、UTF-8、300 个随机输入）。
- `tests/markdown.test.ts`：提示框 / 标签页 / TOC / 图片路径 / 安全过滤 / 沙箱 demo / 图片命名上下文 / `data-line` / 展开结构（动画框与内层分离）。

当前结果：43 个测试通过，`tsc --noEmit` 通过，服务端与前端都能构建，Docker 镜像可以在本机构建并运行（arm64）。

前端没有单元测试。以下项目在无头 Chromium 中验证过（脚本在 /tmp，没有纳入仓库）：

- 登录、编辑自动保存、提交、发布、读者看到新内容（端到端）。
- 阅读页：四栏布局、拖动分隔条（宽度随拖动变化）、功能区缩小与展开、回到顶部、目录开关、窄屏抽屉。
- 展开动画：收起状态高度为 0，展开过程中高度依次变化（实测 12 → 65 → 98 → 111 → 116px）。
- 行悬停：悬停后应用 box-shadow（实测）。
- 搜索对话框：输入后显示高亮片段。
- 对比页：diff 渲染、文件折叠。
- 编辑器：源码滚动到 600/1200/2800px 时，预览分别对齐到 746/1463/3334px；输入时两端滚动位置不变；布局偏移事件为 0。
- 控制台无报错。

性能（合成数据，1000 篇、每篇约 4 KB，本机测量）：三字符 MATCH 0.02–0.7 ms，两字符子串扫描约 3.7 ms，只标题/摘要 0.2 ms，单篇增量索引 0.8 ms，全量重建 76 ms。

---

## 11. 待办与已知限制

### 11.1 第二阶段：GitHub 同步与评论（未实现）

- 每次发布（Push）后，可选择同步到 GitHub：
  - 只同步提交历史：生成一个历史文件（包含每次提交的消息），推送到 GitHub。避免空提交。
  - 同步内容：每篇文章的内容一并同步。
- 新文章发布时，可选创建一个 Issue 或 Discussion 作为评论区。两者在配置中二选一。
- 评论获取：兼容 giscus / utterances 的约定（按路径或标题匹配），前端可以直接嵌入现有评论组件。
- 配置项与 token 的存放位置在实现前需要再次确认。

### 11.2 已知限制

- 单分支、线性历史。提交树是一条线，没有分叉。
- 草稿中上传的图片一旦被渲染或上传过，就可以通过 `/images/{hash}` 访问。hash 是 128 位，不可猜测，但它不是访问控制。
- 限流计数在内存中，重启后清零。
- 镜像在本机只验证了 arm64。amd64 由 GitHub Actions 构建，本机没有验证。
- 服务端依赖系统 `git`，git 版本需要支持 `http-backend` 与 smart HTTP。
- 单进程。SQLite 使用 WAL，不支持多实例部署。
- 外部 push 与网页编辑并发时，依赖 `repo.lock` 串行化。跨进程并发不受保护。
- 搜索只覆盖已发布内容的正文、标题、标签和摘要。管理员的草稿内容不可搜索（提交说明可以搜索）。
- 两字符的文章搜索是子串扫描，文章数量很大时会变慢。可以把查询改为至少三个字符，或关闭全文索引。
- 提交搜索只看提交说明，不看作者和文件内容。最多 30 条。
- 对比的差异内容上限为 1 MB。
- 编辑器的滚动同步只有源码 → 预览一个方向。
- 文章摘要取自第一段，因此第一段中的文字也会匹配（全文关闭时尤其明显）。
- 布局偏好保存在浏览器本地，换一台设备不会同步。
- 标签目录没有删除操作。删除一个标签需要先从所有文章中移除，目前界面不提供。
- 标签目录存在 SQLite，不随 git 版本化。数据库丢失后，标签名会在下一次发布时从文章 `meta.yaml` 重新登记，键会重新生成（未测试）。
- 行悬停只作用于代码、原文、diff 中的行。正文段落不加。

### 11.3 需要用户确认的推断

以下内容不是问答中明确确认的，是实现时的推断，请检查：

- 外部 `git push` 只更新 main，不自动发布。依据是"只有管理员在网页上 Push 才更新已发布的提交"。
- 为带 token 的写作者新增了 `/git/full/blog.git`，用于让 git 客户端在需要时发送凭据。原需求只写了 `/git/` 和 `owner` + token。
- 会话"续期"：每次访问顺延服务端过期时间，但 cookie 的 Max-Age 只在每小时写库时刷新。
- 站点标题和简介：保存后以数据库为准，`brog.yaml` 的同名字段只作为初始值。替代方案是完全只读 yaml，但那样页面元素无法在页面上配置。
- 页脚链接允许 `http(s)`、`mailto`、站内路径和锚点，禁止 `javascript:` 与协议相对地址。
- 文章列表单列/双列是站点级设置，不是每个读者各自的偏好。
- 阅读页四栏布局的断点定为 1280px，布局偏好保存在浏览器本地。
- 全文搜索默认开启（基于上面的性能测量）。如果你不想让搜索读取正文，改为 `search.fullText: false`。
- 管理员的搜索结果包括未发布的提交，文章结果只包括已发布的内容。
- 行悬停阴影只加在代码、原文、diff 的行上。正文段落不加，因为段落折行后"一行"的含义不明确。如果需要，可以扩展到段落。
- "收起动画卡顿"的原因是动画框保留了 `padding-bottom` 和 `margin-bottom`，高度归零后仍留下一段空白，动画结束时突然消失。已把间距移到内层，并把 `open` 属性的改变推迟到动画结束之后。
- "内容的隐藏和显示没有具体动画"：按字面理解为阅读页面板的隐藏和显示没有过渡，因此改为宽度动画。若指的是别的内容，请说明。
- 标签目录放在 SQLite 而不是 git，是按你的回答（"数据库存的是 tag 列表"）实施的。代价是标签的增删改没有历史，也不能随仓库迁移。
- 管理员的双击改名是页面内编辑。选中用单击，改名用双击或 F2。单击在管理员视图中延迟 220ms 生效。
- 页头收起只作用于站点页头。管理端的页头固定不动。
- 首页双列的断点定为 1024px（Tailwind `lg`），与双列时的最大宽度一致。
- 标签的管理员视图计数来自已发布文章。工作区里新增但未发布的文章不计入篇数。
- 首页背景的图片存入 SQLite（BLOB），上限 8 MB 输入、2400px 输出。数据库体积会随图片增长，但一般只有两张图。

---

## 12. 给 AI 代理的约定

- 遇到设计取舍（尤其是 Git 语义、认证、存储格式、对外 API）先询问用户，不要擅自决定。
- 改变已确认的决策前，先更新第 2 节并征得同意。
- 依赖选择：优先成熟的库；优先查询 npm 上的最新版本；不要引入过时的版本。
- 代码风格：TypeScript strict；服务端 ESM，导入带 `.ts` 扩展名；注释只写必要的"为什么"；与周围代码保持一致的命名和写法。
- 文案使用中文，面向读者和管理员，不写后端实现细节（哈希算法、索引结构、git 内部引用等）。
- 样式只使用 `src/web/styles.css` 中定义的 token，不要硬编码颜色。圆角使用 token（`rounded-sm` / `rounded-md` / `rounded-lg`），不使用 `rounded-full`（状态圆点除外）。可点击的元素必须有悬停反馈（`clickable` 工具类或按钮样式）。
- 圆角：贴在一起、形成整体的结构区域（页头、阅读面板、表格、分隔线两侧）保持直角，只靠边框分隔。相互分开的元素（卡片、标签、按钮、输入框、列表项、带边框的提示块）使用小圆角（`rounded-sm` 4px、`rounded-md` 6px、`rounded-lg` 8px）。不要出现"有间隙又没有圆角"的组合：加间隙的元素一定要有圆角。
- 颜色：页面颜色只通过 `--background` / `--foreground` 和由它们混合的 token 指定。不要写死米色、白色或深色的十六进制值。
- 动画优先使用 `transform` 和 `opacity`。只在必要时改变 `height`（可折叠块）或 `width`（阅读页面板）。时长 120–260ms。见第 6.14 节。必须尊重 `prefers-reduced-motion`。
- 示例名称（系列、章节、标题）不得进入代码的默认值、占位文字或种子内容。测试数据使用中性名称。
- 修改后运行 `pnpm typecheck` 和 `pnpm test`，涉及前端的改动还要构建 `pnpm build:web`，并重启服务端后再在浏览器中验证。
- 提交（commit）只在用户明确要求时进行。用户检查完毕之前不要提交。
- 不要把 `brog.yaml`、`data/`、`dist/`、`node_modules/` 加入版本控制（已在 `.gitignore` 中）。
