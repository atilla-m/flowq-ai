import { Fragment, type ReactNode } from 'react'

function safeHref(href: string) {
  return /^(?:https?:\/\/|mailto:|\/(?!\/)|#)/i.test(href) ? href : undefined
}

/** Small, HTML-free renderer for the formatting used in WhatsApp agent messages. */
function inline(text: string, depth = 0): ReactNode {
  if (depth > 4) return text
  const pattern = /(`[^`\n]+`|\*\*[^\n]+?\*\*|__[^\n]+?__|\*[^*\n]+\*|_[^_\n]+_|\[[^\]\n]+\]\([^\s)]+\))/g
  const nodes: ReactNode[] = []
  let from = 0
  for (const match of text.matchAll(pattern)) {
    const at = match.index!
    nodes.push(text.slice(from, at))
    const token = match[0]
    const key = `${at}-${token}`
    if (token.startsWith('`')) nodes.push(<code key={key}>{token.slice(1, -1)}</code>)
    else if (token.startsWith('**') || token.startsWith('__')) nodes.push(<strong key={key}>{inline(token.slice(2, -2), depth + 1)}</strong>)
    else if (token.startsWith('[')) {
      const link = token.match(/^\[([^\]]+)\]\((.+)\)$/)!
      const href = safeHref(link[2])
      nodes.push(href ? <a key={key} href={href} target="_blank" rel="noopener noreferrer">{inline(link[1], depth + 1)}</a> : link[1])
    } else nodes.push(<em key={key}>{inline(token.slice(1, -1), depth + 1)}</em>)
    from = at + token.length
  }
  nodes.push(text.slice(from))
  return nodes
}

export function Markdown({ text, className = '' }: { text?: string; className?: string }) {
  if (!text) return null
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  while (i < lines.length) {
    if (!lines[i].trim()) { i++; continue }
    const bullet = lines[i].match(/^\s*(?:([-*+])|\d+[.)])\s+(.+)$/)
    const start = i
    if (bullet) {
      const ordered = !bullet[1]
      const items: ReactNode[] = []
      while (i < lines.length) {
        const item = lines[i].match(/^\s*(?:([-*+])|\d+[.)])\s+(.+)$/)
        if (!item || Boolean(item[1]) === ordered) break
        items.push(<li key={i}>{inline(item[2])}</li>)
        i++
      }
      blocks.push(ordered ? <ol key={start} start={Number.parseInt(lines[start], 10)}>{items}</ol> : <ul key={start}>{items}</ul>)
    } else {
      const paragraph: ReactNode[] = []
      while (i < lines.length && lines[i].trim() && !/^\s*(?:[-*+]|\d+[.)])\s+/.test(lines[i])) {
        paragraph.push(<Fragment key={i}>{i > start && <br />}{inline(lines[i])}</Fragment>)
        i++
      }
      blocks.push(<p key={start}>{paragraph}</p>)
    }
  }
  return <div className={`message-markdown ${className}`}>{blocks}</div>
}
