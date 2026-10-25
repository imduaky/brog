import sanitizeHtml from 'sanitize-html'

const MATHML_TAGS = [
  'math', 'semantics', 'annotation', 'mrow', 'mi', 'mo', 'mn', 'ms', 'mtext', 'mspace', 'msup', 'msub',
  'msubsup', 'mfrac', 'msqrt', 'mroot', 'mtable', 'mtr', 'mtd', 'mover', 'munder', 'munderover',
  'mstyle', 'mpadded', 'menclose', 'mphantom', 'merror',
]
const MATHML_ATTRS = [
  'xmlns', 'display', 'encoding', 'mathvariant', 'stretchy', 'fence', 'separator', 'lspace', 'rspace',
  'width', 'height', 'depth', 'displaystyle', 'scriptlevel', 'columnalign', 'rowspacing', 'columnspacing',
  'accent', 'accentunder', 'minsize', 'maxsize', 'movablelimits', 'notation', 'linethickness', 'voffset',
]

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    ...sanitizeHtml.defaults.allowedTags,
    'img', 'details', 'summary', 'figure', 'figcaption', 'iframe', 'input', 'label', 'kbd', 'mark',
    'sub', 'sup', 'abbr', 'dl', 'dt', 'dd', 'del', 'ins', 's', 'small', 'span', 'section', 'u',
    'svg', 'path', 'line', 'g',
    ...MATHML_TAGS,
  ],
  allowedAttributes: {
    '*': ['class', 'id', 'style', 'title', 'lang', 'dir', 'aria-*', 'data-*', 'role', 'tabindex'],
    a: ['href', 'name', 'target', 'rel'],
    img: ['src', 'alt', 'width', 'height', 'loading', 'decoding'],
    iframe: ['src', 'srcdoc', 'sandbox', 'loading', 'width', 'height', 'allow', 'allowfullscreen', 'referrerpolicy'],
    input: ['type', 'checked', 'disabled', 'name'],
    label: ['for'],
    details: ['open'],
    ol: ['start', 'type', 'reversed'],
    li: ['value'],
    td: ['align', 'colspan', 'rowspan'],
    th: ['align', 'colspan', 'rowspan', 'scope'],
    svg: ['xmlns', 'width', 'height', 'viewbox', 'viewBox', 'preserveaspectratio', 'preserveAspectRatio', 'fill'],
    path: ['d', 'fill', 'stroke'],
    line: ['x1', 'x2', 'y1', 'y2', 'stroke', 'stroke-width'],
    ...Object.fromEntries(MATHML_TAGS.map((t) => [t, MATHML_ATTRS])),
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: { img: ['http', 'https', 'data'] },
  allowProtocolRelative: false,
  parseStyleAttributes: false,
  exclusiveFilter: (frame) => frame.tag === 'input' && !['checkbox', 'radio'].includes(frame.attribs.type ?? ''),
  transformTags: {
    // Every frame is sandboxed. Inline documents (srcdoc) never get same-origin access,
    // so demo scripts cannot touch the blog's cookies or DOM.
    iframe: (tagName, attribs) => {
      const external = !attribs.srcdoc && /^https:\/\//i.test(attribs.src ?? '')
      return {
        tagName,
        attribs: {
          ...attribs,
          sandbox: external ? 'allow-scripts allow-same-origin allow-popups allow-presentation' : 'allow-scripts',
        },
      }
    },
  },
}

export function sanitize(html: string): string {
  return sanitizeHtml(html, OPTIONS)
}
