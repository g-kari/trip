import { useEffect, useRef, useState } from 'react'
import QRCodeLib from 'qrcode'
import { useToast } from '../hooks/useToast'

interface QRCodeModalProps {
  url: string
  title: string
  onClose: () => void
}

export function QRCodeModal({ url, title, onClose }: QRCodeModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isReady, setIsReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const { showSuccess, showError } = useToast()

  useEffect(() => {
    async function generateQR() {
      if (!canvasRef.current) return

      try {
        await QRCodeLib.toCanvas(canvasRef.current, url, {
          width: 200,
          margin: 2,
          color: {
            dark: '#3d2e1f',
            light: '#ffffff',
          },
        })
        setIsReady(true)
        setError(null)
      } catch (err) {
        console.error('Failed to generate QR code:', err)
        setError('QRコードの生成に失敗しました')
      }
    }

    generateQR()
  }, [url])

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      showSuccess('URLをコピーしました')
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy URL:', err)
      showError('コピーに失敗しました')
    }
  }

  function downloadQRCode() {
    if (!canvasRef.current) return

    try {
      const canvas = canvasRef.current

      // Create a new canvas with white background and padding
      const paddedCanvas = document.createElement('canvas')
      const padding = 32
      paddedCanvas.width = canvas.width + padding * 2
      paddedCanvas.height = canvas.height + padding * 2

      const ctx = paddedCanvas.getContext('2d')
      if (!ctx) {
        showError('ダウンロードに失敗しました')
        return
      }

      // Fill white background
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, paddedCanvas.width, paddedCanvas.height)

      // Draw QR code centered
      ctx.drawImage(canvas, padding, padding)

      // Add title text below QR code
      ctx.fillStyle = '#3d2e1f'
      ctx.font = '14px "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(title, paddedCanvas.width / 2, paddedCanvas.height - 8)

      // Download the image
      const dataUrl = paddedCanvas.toDataURL('image/png')
      const link = document.createElement('a')
      link.download = `${title.replace(/[^a-zA-Z0-9\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/g, '_')}_qrcode.png`
      link.href = dataUrl
      link.click()

      showSuccess('QRコードをダウンロードしました')
    } catch (err) {
      console.error('Failed to download QR code:', err)
      showError('ダウンロードに失敗しました')
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal qr-modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title">QRコードで共有</h2>

        <div className="qr-modal-content">
          {error ? (
            <div className="qr-modal-error">{error}</div>
          ) : (
            <>
              <div className="qr-modal-code-wrapper">
                <canvas
                  ref={canvasRef}
                  className={`qr-modal-canvas ${isReady ? '' : 'loading'}`}
                />
                {!isReady && <div className="qr-modal-loading" />}
              </div>

              <div className="qr-modal-url">
                <span className="qr-modal-url-text">{url}</span>
              </div>
            </>
          )}
        </div>

        <div className="qr-modal-actions">
          <button
            type="button"
            className="btn-outline qr-modal-btn"
            onClick={downloadQRCode}
            disabled={!isReady}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            ダウンロード
          </button>

          <button
            type="button"
            className={`btn-outline qr-modal-btn ${copied ? 'copied' : ''}`}
            onClick={copyUrl}
          >
            {copied ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
            {copied ? 'コピー完了' : 'URLをコピー'}
          </button>
        </div>

        <button className="btn-text modal-close" onClick={onClose}>
          閉じる
        </button>
      </div>
    </div>
  )
}
