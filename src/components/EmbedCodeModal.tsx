import { useState } from 'react'
import { CopyIcon } from './Icons'

type EmbedCodeModalProps = {
  tripId: string
  tripTitle: string
  onClose: () => void
}

export function EmbedCodeModal({ tripId, tripTitle, onClose }: EmbedCodeModalProps) {
  const [copied, setCopied] = useState(false)
  const [width, setWidth] = useState('100%')
  const [height, setHeight] = useState('600')

  const baseUrl = window.location.origin
  const embedUrl = `${baseUrl}/embed/${tripId}`
  const embedCode = `<iframe src="${embedUrl}" width="${width}" height="${height}px" frameborder="0" style="border-radius: 8px;" title="${tripTitle}"></iframe>`

  const handleCopy = async () => {
    await navigator.clipboard.writeText(embedCode)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content embed-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">埋め込みコード</h3>
          <button className="modal-close" onClick={onClose}>x</button>
        </div>

        <div className="embed-settings">
          <div className="embed-setting-row">
            <label>幅</label>
            <input
              type="text"
              className="input"
              value={width}
              onChange={e => setWidth(e.target.value)}
              placeholder="100% or 400"
            />
          </div>
          <div className="embed-setting-row">
            <label>高さ (px)</label>
            <input
              type="number"
              className="input"
              value={height}
              onChange={e => setHeight(e.target.value)}
            />
          </div>
        </div>

        <div className="embed-code-box">
          <pre className="embed-code">{embedCode}</pre>
          <button className="btn-icon embed-copy-btn" onClick={handleCopy} title="コピー">
            <CopyIcon size={16} />
          </button>
        </div>

        {copied && <p className="embed-copied">コピーしました</p>}

        <div className="embed-preview-section">
          <p className="embed-preview-label">プレビュー</p>
          <div className="embed-preview-frame">
            <iframe
              src={embedUrl}
              width="100%"
              height="300"
              frameBorder="0"
              title="プレビュー"
            />
          </div>
        </div>
      </div>
    </div>
  )
}
