import { Editor, rootCtx, defaultValueCtx, editorViewCtx, serializerCtx, remarkPluginsCtx } from '@milkdown/kit/core'
import { DOMSerializer } from '@milkdown/kit/prose/model'
import remarkBreaks from 'remark-breaks'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { history } from '@milkdown/kit/plugin/history'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import { clipboard } from '@milkdown/kit/plugin/clipboard'
import { replaceAll } from '@milkdown/kit/utils'
import { htmlView } from './html-view'

import '@milkdown/kit/prose/view/style/prosemirror.css'

let editorInstance: Editor | null = null
let previousNodeTexts: string[] = []
let diffFadeoutTimer: ReturnType<typeof setTimeout> | null = null

const inlineStyles: Record<string, string> = {
  'h1': 'font-size:1.8em;font-weight:700;margin:1em 0 .5em;padding-bottom:.3em;border-bottom:1px solid #eee;',
  'h2': 'font-size:1.4em;font-weight:600;margin:1em 0 .5em;padding-bottom:.25em;border-bottom:1px solid #eee;',
  'h3': 'font-size:1.2em;font-weight:600;margin:.8em 0 .4em;',
  'h4': 'font-weight:600;margin:.8em 0 .4em;',
  'h5': 'font-weight:600;margin:.8em 0 .4em;',
  'h6': 'font-weight:600;margin:.8em 0 .4em;',
  'p': 'margin:.5em 0;line-height:1.75;',
  'strong': 'font-weight:600;',
  'a': 'color:#0969da;text-decoration:none;',
  'code': 'background:rgba(175,184,193,0.2);padding:2px 6px;border-radius:3px;font-size:.875em;font-family:Menlo,Monaco,monospace;',
  'pre': 'background:#f6f8fa;padding:16px;border-radius:6px;overflow-x:auto;margin:1em 0;',
  'blockquote': 'border-left:4px solid #ddd;padding-left:16px;margin:1em 0;color:#666;',
  'ul': 'padding-left:24px;margin:.5em 0;',
  'ol': 'padding-left:24px;margin:.5em 0;',
  'li': 'margin:.25em 0;',
  'table': 'border-collapse:collapse;width:100%;margin:1em 0;',
  'th': 'border:1px solid #ddd;padding:8px 12px;text-align:left;font-weight:600;background:#f6f8fa;',
  'td': 'border:1px solid #ddd;padding:8px 12px;text-align:left;',
  'hr': 'border:none;border-top:2px solid #ddd;margin:2em 0;',
  'img': 'max-width:100%;',
}

function enhanceClipboard(e: ClipboardEvent): void {
  const html = e.clipboardData?.getData('text/html')
  if (!html) return

  const doc = new DOMParser().parseFromString(html, 'text/html')

  for (const [tag, style] of Object.entries(inlineStyles)) {
    doc.querySelectorAll(tag).forEach((el) => {
      ;(el as HTMLElement).setAttribute('style', style)
    })
  }

  doc.querySelectorAll('pre code').forEach((el) => {
    ;(el as HTMLElement).setAttribute('style', 'background:none;padding:0;font-size:.875em;line-height:1.6;font-family:Menlo,Monaco,monospace;')
  })

  e.clipboardData?.setData('text/html', doc.body.innerHTML)
}

const defaultContent = `# Welcome to ColaMD

Start typing here...
`

// --- Agent Diff View ---

function snapshotNodes(root: HTMLElement): string[] {
  const pm = root.querySelector('.ProseMirror')
  if (!pm) return []
  const texts: string[] = []
  for (const child of pm.children) {
    texts.push(child.textContent || '')
  }
  return texts
}

function applyDiffHighlight(root: HTMLElement): void {
  if (previousNodeTexts.length === 0) return
  const pm = root.querySelector('.ProseMirror')
  if (!pm) return

  const children = Array.from(pm.children)
  for (let i = 0; i < children.length; i++) {
    const node = children[i] as HTMLElement
    const currentText = node.textContent || ''
    const prevText = i < previousNodeTexts.length ? previousNodeTexts[i] : null

    if (prevText === null || currentText !== prevText) {
      node.classList.add('agent-diff-added')
    }
  }

  scheduleDiffFadeout(root)
}

function scheduleDiffFadeout(root: HTMLElement): void {
  if (diffFadeoutTimer) clearTimeout(diffFadeoutTimer)
  diffFadeoutTimer = setTimeout(() => {
    root.querySelectorAll('.agent-diff-added').forEach((el) => {
      el.classList.add('agent-diff-fadeout')
      el.addEventListener('animationend', () => {
        el.classList.remove('agent-diff-added', 'agent-diff-fadeout')
      }, { once: true })
    })
    diffFadeoutTimer = null
  }, 5000)
}

// --- Editor ---

export async function createEditor(
  rootId: string,
  onChange?: (markdown: string) => void
): Promise<Editor> {
  const root = document.getElementById(rootId)
  if (!root) throw new Error(`Element #${rootId} not found`)

  editorInstance = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root)
      ctx.set(defaultValueCtx, defaultContent)
      ctx.set(remarkPluginsCtx, [{ plugin: remarkBreaks, options: undefined }])
      if (onChange) {
        ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
          onChange(markdown)
        })
      }
    })
    .use(commonmark)
    .use(gfm)
    .use(history)
    .use(listener)
    .use(clipboard)
    .use(htmlView)
    .create()

  // Enhance clipboard with inline styles for rich text paste
  root.addEventListener('copy', enhanceClipboard)
  root.addEventListener('cut', enhanceClipboard)

  // Cmd+click to open links
  root.addEventListener('click', (e) => {
    if (!(e.metaKey || e.ctrlKey)) return
    const link = (e.target as HTMLElement).closest('a')
    if (!link) return
    const href = link.getAttribute('href')
    if (href) {
      e.preventDefault()
      window.electronAPI.openExternal(href)
    }
  })

  return editorInstance
}

export function getMarkdown(): string {
  if (!editorInstance) return ''
  let markdown = ''
  editorInstance.action((ctx) => {
    const serializer = ctx.get(serializerCtx)
    const view = ctx.get(editorViewCtx)
    markdown = serializer(view.state.doc)
  })
  return markdown
}

export function getHTML(): string {
  if (!editorInstance) return ''
  let html = ''
  editorInstance.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const div = document.createElement('div')
    const fragment = DOMSerializer.fromSchema(view.state.schema).serializeFragment(view.state.doc.content)
    div.appendChild(fragment)
    html = div.innerHTML
  })
  return html
}

export function setMarkdown(content: string, showDiff: boolean = false): void {
  if (!editorInstance) return
  const root = document.getElementById('editor')

  if (showDiff && root) {
    previousNodeTexts = snapshotNodes(root)
  }

  editorInstance.action(replaceAll(content))

  if (showDiff && root) {
    requestAnimationFrame(() => applyDiffHighlight(root))
  }
}
