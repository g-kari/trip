import type { ReactNode } from 'react'

/**
 * Simple markdown renderer for item notes.
 * Supports:
 * - **bold** text
 * - *italic* text
 * - - bullet lists
 * - [links](url)
 *
 * XSS-safe: all text is escaped, only safe HTML is generated.
 */

type MarkdownNode =
  | { type: 'text'; content: string }
  | { type: 'bold'; content: string }
  | { type: 'italic'; content: string }
  | { type: 'link'; text: string; url: string }

interface MarkdownLine {
  isBullet: boolean
  nodes: MarkdownNode[]
}


// Validate URL to prevent javascript: and data: URLs
function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.origin)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

// Parse inline markdown (bold, italic, links)
function parseInline(text: string): MarkdownNode[] {
  const nodes: MarkdownNode[] = []

  // Combined regex for bold, italic, and links
  // Order matters: bold (**) before italic (*) to avoid conflicts
  const inlinePattern = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(\[([^\]]+)\]\(([^)]+)\))/g

  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = inlinePattern.exec(text)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      nodes.push({ type: 'text', content: text.slice(lastIndex, match.index) })
    }

    if (match[1]) {
      // Bold: **text**
      nodes.push({ type: 'bold', content: match[2] })
    } else if (match[3]) {
      // Italic: *text*
      nodes.push({ type: 'italic', content: match[4] })
    } else if (match[5]) {
      // Link: [text](url)
      const linkText = match[6]
      const linkUrl = match[7]
      if (isValidUrl(linkUrl)) {
        nodes.push({ type: 'link', text: linkText, url: linkUrl })
      } else {
        // Invalid URL, render as plain text
        nodes.push({ type: 'text', content: match[5] })
      }
    }

    lastIndex = match.index + match[0].length
  }

  // Add remaining text
  if (lastIndex < text.length) {
    nodes.push({ type: 'text', content: text.slice(lastIndex) })
  }

  // If no matches, return the entire text as a single node
  if (nodes.length === 0) {
    nodes.push({ type: 'text', content: text })
  }

  return nodes
}

// Parse markdown text into lines
function parseMarkdown(text: string): MarkdownLine[] {
  const lines = text.split('\n')
  return lines.map((line) => {
    // Check for bullet list (- or * at start, followed by space)
    const bulletMatch = line.match(/^[-*]\s+(.*)$/)
    if (bulletMatch) {
      return {
        isBullet: true,
        nodes: parseInline(bulletMatch[1]),
      }
    }
    return {
      isBullet: false,
      nodes: parseInline(line),
    }
  })
}

// Render a single node to React element
function renderNode(node: MarkdownNode, key: number): ReactNode {
  switch (node.type) {
    case 'bold':
      return <strong key={key} className="md-bold">{node.content}</strong>
    case 'italic':
      return <em key={key} className="md-italic">{node.content}</em>
    case 'link':
      return (
        <a
          key={key}
          href={node.url}
          target="_blank"
          rel="noopener noreferrer"
          className="md-link"
        >
          {node.text}
        </a>
      )
    case 'text':
    default:
      return node.content
  }
}

interface MarkdownTextProps {
  text: string
  className?: string
}

export function MarkdownText({ text, className = '' }: MarkdownTextProps) {
  if (!text) return null

  const parsed = parseMarkdown(text)

  // Group consecutive bullet lines
  const elements: ReactNode[] = []
  let currentBulletGroup: MarkdownLine[] = []

  parsed.forEach((line, lineIndex) => {
    if (line.isBullet) {
      currentBulletGroup.push(line)
    } else {
      // Flush bullet group if any
      if (currentBulletGroup.length > 0) {
        elements.push(
          <ul key={`ul-${lineIndex}`} className="md-list">
            {currentBulletGroup.map((bulletLine, bulletIndex) => (
              <li key={bulletIndex} className="md-list-item">
                {bulletLine.nodes.map((node, nodeIndex) => renderNode(node, nodeIndex))}
              </li>
            ))}
          </ul>
        )
        currentBulletGroup = []
      }

      // Add regular line (skip empty lines at the start/end)
      const hasContent = line.nodes.some(
        (node) => node.type !== 'text' || node.content.trim() !== ''
      )
      if (hasContent || elements.length > 0) {
        elements.push(
          <span key={`line-${lineIndex}`} className="md-line">
            {line.nodes.map((node, nodeIndex) => renderNode(node, nodeIndex))}
            {lineIndex < parsed.length - 1 && !parsed[lineIndex + 1].isBullet && <br />}
          </span>
        )
      }
    }
  })

  // Flush remaining bullet group
  if (currentBulletGroup.length > 0) {
    elements.push(
      <ul key="ul-final" className="md-list">
        {currentBulletGroup.map((bulletLine, bulletIndex) => (
          <li key={bulletIndex} className="md-list-item">
            {bulletLine.nodes.map((node, nodeIndex) => renderNode(node, nodeIndex))}
          </li>
        ))}
      </ul>
    )
  }

  return (
    <div className={`markdown-text ${className}`.trim()}>
      {elements}
    </div>
  )
}
