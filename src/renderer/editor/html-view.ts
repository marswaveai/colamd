import { $view } from '@milkdown/kit/utils'
import { htmlSchema } from '@milkdown/kit/preset/commonmark'
import type { NodeViewConstructor } from '@milkdown/kit/prose/view'
import { sanitizeHTMLFragment } from './sanitize'

export const htmlView = $view(htmlSchema.node, (): NodeViewConstructor => {
  return (node) => {
    const dom = document.createElement('span')
    dom.classList.add('milkdown-html-inline')
    const rawHtml = typeof node.attrs.value === 'string' ? node.attrs.value : ''
    dom.innerHTML = sanitizeHTMLFragment(rawHtml)
    return {
      dom,
      stopEvent: () => true
    }
  }
})
