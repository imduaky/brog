import { FLOW_DIAGRAM, MARKDOWN_DEMO, RANDOM_SCRIPT } from './seed/demo.ts'
import { PROJECT_README } from './seed/readme.ts'

/**
 * Files of the initial commit: the layout notes, and one example series that shows
 * the project README followed by every Markdown feature.
 */
export const SEED_FILES: Record<string, string> = {
  'README.md': `# Blog content

This repository is managed by brog.

- \`<series>/meta.yaml\`        series title / description / cover
- \`<series>/<n>/meta.yaml\`    chapter title / tags / cover / summary / preview
- \`<series>/<n>/content.md\`   chapter body
- \`<series>/<n>/img/\`         images
- \`<series>/<n>/js/\`          scripts for live demos
`,
  '示例/meta.yaml': `title: 示例
description: 项目说明与 brog 支持的全部功能演示
`,
  '示例/1/meta.yaml': `title: '示例：Markdown 全部功能'
tags:
  - 示例
  - Markdown
summary: 项目说明，以及 brog 支持的全部 Markdown 扩展语法的演示。
preview:
  text: 项目说明，以及 brog 支持的全部 Markdown 扩展语法的演示。
  theme:
    light: '#c8d8e6'
    dark: '#2d3d4d'
`,
  '示例/1/content.md': `${PROJECT_README}\n${MARKDOWN_DEMO}`,
  '示例/1/js/random.js': RANDOM_SCRIPT,
  '示例/1/img/流程示意_0.svg': FLOW_DIAGRAM,
}
