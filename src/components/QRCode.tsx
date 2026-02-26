import { useEffect, useState } from 'react'
import QRCodeLib from 'qrcode'

interface QRCodeProps {
  value: string
  size?: number
}

export function QRCode({ value, size = 150 }: QRCodeProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function generateQR() {
      try {
        const url = await QRCodeLib.toDataURL(value, {
          width: size,
          margin: 2,
          color: {
            dark: '#3d2e1f', // Match theme text color
            light: '#ffffff',
          },
        })
        setDataUrl(url)
        setError(null)
      } catch (err) {
        console.error('Failed to generate QR code:', err)
        setError('QRコードの生成に失敗しました')
      }
    }

    generateQR()
  }, [value, size])

  if (error) {
    return <div className="qr-code-error">{error}</div>
  }

  if (!dataUrl) {
    return <div className="qr-code-loading" style={{ width: size, height: size }} />
  }

  return (
    <div className="qr-code-container">
      <img
        src={dataUrl}
        alt="QRコード"
        width={size}
        height={size}
        className="qr-code-image"
      />
    </div>
  )
}
