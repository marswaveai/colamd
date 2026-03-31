import { $view } from '@milkdown/kit/utils'
import { htmlSchema } from '@milkdown/kit/preset/commonmark'
import type { NodeViewConstructor } from '@milkdown/kit/prose/view'

const ALLOWED_HTML_TAGS = new Set([
  'kbd', 'mark', 'sub', 'sup', 'br', 'hr', 'abbr', 'del', 'ins',
  'span', 'div', 'details', 'summary', 'small', 'strong', 'em',
  'code', 'pre', 'b', 'i', 'u', 's', 'table', 'thead', 'tbody',
  'tr', 'th', 'td', 'blockquote', 'ul', 'ol', 'li', 'p', 'a',
  'img', 'figure', 'figcaption', 'ruby', 'rt', 'rp'
])

const DANGEROUS_ATTR_RE = /\bon\w+\s*=/i

function sanitizeInlineHTML(raw: string): string {
  // Allow safe inline HTML, strip dangerous content
  const doc = new DOMParser().parseFromString(raw, 'text/html')
  const walk = (node: Element): void => {
    // Remove event handler attributes
    for (const attr of Array.from(node.attributes)) {
      if (DANGEROUS_ATTR_RE.test(attr.name)) {
        node.removeAttribute(attr.name)
      }
    }
    // Remove non-allowed tags but keep their text content
    for (const child of Array.from(node.children)) {
      if (!ALLOWED_HTML_TAGS.has(child.tagName.toLowerCase())) {
        child.replaceWith(...Array.from(child.childNodes))
      } else {
        walk(child)
      }
    }
  }
  walk(doc.body)
  return doc.body.innerHTML
}

export const htmlView = $view(htmlSchema.node, (): NodeViewConstructor => {
  return (node) => {
    const dom = document.createElement('span')
    dom.classList.add('milkdown-html-inline')
    const rawHtml = typeof node.attrs.value === 'string' ? node.attrs.value : ''
    dom.innerHTML = sanitizeInlineHTML(rawHtml)
    return {
      dom,
      stopEvent: () => true
    }
  }
})
