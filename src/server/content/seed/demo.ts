/** Markdown demo: every extension the renderer supports. */
export const MARKDOWN_DEMO = `---

# Markdown 全部扩展语法

这一节演示 brog 支持的全部 Markdown 语法。每一段都可以直接复制到你自己的文章里使用。

## 基础语法

**粗体**、*斜体*、~~删除线~~、\`行内代码\`，以及 [外部链接](https://github.com/imduaky/brog)。输入的网址会自动变成链接：https://example.com

> 引用块。
>
> > 嵌套的引用块。

- 无序列表
  - 嵌套列表
    - 第三层
- 另一项

1. 有序列表
2. 第二项
3. 第三项

## 任务列表

- [x] 已完成的任务
- [ ] 尚未完成的任务

## 表格

| 语法 | 效果 | 对齐 |
| :--- | :---: | ---: |
| \`!!!\` | 提示框 | 左对齐 |
| \`===\` | 内容标签页 | 居中 |
| \`++key++\` | 按键 | 右对齐 |

## 提示框

!!! note "注意"
    普通提示框。内部可以写任何 Markdown：

    - 列表
    - \`代码\`

!!! tip
    不写标题时，标题使用类型名。

!!! warning "谨慎"
    可用的类型：note、tip、success、question、warning、danger、example、quote 等。

!!! danger "危险操作"
    删除前请先确认。

??? info "可折叠，默认收起"
    点击标题展开或收起，展开和收起都有动画。

???+ question "可折叠，默认展开"
    \`???+\` 表示默认展开。

## 内容标签页

=== "C"

    \`\`\`c title="hello.c" linenums="1" hl_lines="3"
    #include <stdio.h>

    int main(void) {
        printf("hello, brog\\n");
        return 0;
    }
    \`\`\`

=== "Python"

    \`\`\`python
    print("hello, brog")
    \`\`\`

=== "Shell"

    \`\`\`bash
    pnpm dev
    \`\`\`

## 代码块

上面的 C 示例演示了标题（\`title\`）、行号（\`linenums\`）和高亮行（\`hl_lines\`）。悬停在任意一行上会出现阴影，方便区分行。

\`\`\`ts
const greet = (name: string) => \`hello, \${name}\`
\`\`\`

## 按键、标记与上下标

按 ++ctrl+s++ 保存，按 ++cmd+shift+p++ 打开命令面板（macOS）。

==高亮的文字==，水的化学式是 H~2~O，质能方程是 E = mc^2^。

## 数学公式

行内公式 $e^{i\\pi} + 1 = 0$ 可以直接写在句子中间。

$$
\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}
$$

## 脚注

这里有一个脚注[^1]，还有一个命名的脚注[^brog]。

[^1]: 脚注内容会显示在文章末尾。
[^brog]: 脚注也可以包含 \`代码\`。

## 缩写与定义列表

HTML 是超文本标记语言的缩写。

*[HTML]: HyperText Markup Language

术语
: 定义的第一行。
: 定义的第二行。

## 流程图

\`\`\`mermaid
flowchart LR
  编辑 --> Commit --> Push --> 发布
\`\`\`

## 图片

图片使用相对路径。粘贴图片时会自动命名为「标题_序号.webp」并放入文章的 \`img\` 目录：

![流程示意](img/流程示意_0.svg)

## 可运行的示例

下面的脚本在沙箱 iframe 中运行，拿不到站点的登录状态。

\`\`\`js live height="120"
const app = document.getElementById('app')
const btn = document.createElement('button')
btn.textContent = '点我生成随机数'
btn.onclick = () => (btn.textContent = String(Math.random()).slice(0, 8))
app.append(btn)
\`\`\`

也可以引用章节目录里的脚本文件：

\`\`\`js live src="js/random.js" height="80"
\`\`\`

## 属性

这段文字带有 \`lead\` 类名。 {.lead}

## 原始 HTML

原始 HTML 会经过白名单过滤：<kbd>Esc</kbd> 可以显示，但 \`<script>\` 标签会被移除。

## 分隔线

---

到这里就是全部语法。
`

/** Used by the live demo that references js/random.js. */
export const RANDOM_SCRIPT = `// 供示例文章引用：生成随机数并显示在页面上。
const app = document.getElementById('app')
const out = document.createElement('p')
const roll = () => (out.textContent = \`随机数：\${Math.floor(Math.random() * 100)}\`)
const btn = document.createElement('button')
btn.textContent = '再来一次'
btn.onclick = roll
app.append(out, btn)
roll()
`

/** Used by the image example. */
export const FLOW_DIAGRAM = `<svg xmlns="http://www.w3.org/2000/svg" width="620" height="110" viewBox="0 0 620 110" font-family="sans-serif" font-size="15">
  <g fill="#ece1c6" stroke="#2b261e" stroke-width="1.2">
    <rect x="10" y="35" width="120" height="40" rx="4"/>
    <rect x="170" y="35" width="120" height="40" rx="4"/>
    <rect x="330" y="35" width="120" height="40" rx="4"/>
    <rect x="490" y="35" width="120" height="40" rx="4"/>
  </g>
  <g fill="#2b261e" text-anchor="middle">
    <text x="70" y="60">编辑</text>
    <text x="230" y="60">Commit</text>
    <text x="390" y="60">Push</text>
    <text x="550" y="60">发布</text>
  </g>
  <g stroke="#2b261e" stroke-width="1.2" fill="#2b261e">
    <line x1="130" y1="55" x2="165" y2="55"/>
    <polygon points="165,51 172,55 165,59"/>
    <line x1="290" y1="55" x2="325" y2="55"/>
    <polygon points="325,51 332,55 325,59"/>
    <line x1="450" y1="55" x2="485" y2="55"/>
    <polygon points="485,51 492,55 485,59"/>
  </g>
</svg>
`
