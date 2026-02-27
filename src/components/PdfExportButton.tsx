import { useState } from 'react'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import type { Trip, Day, Item } from '../types'
import { formatCost } from '../utils'
import { DownloadIcon } from './Icons'

type PdfExportButtonProps = {
  tripId: string
  tripTitle: string
  asMenuItem?: boolean
  onComplete?: () => void
}

// Format date for PDF display
function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  const days = ['日', '月', '火', '水', '木', '金', '土']
  const dayOfWeek = days[d.getDay()]
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} (${dayOfWeek})`
}

// Format date range for PDF header
function formatDateRange(start: string | null, end: string | null): string {
  if (!start || !end) return ''
  const s = new Date(start)
  const e = new Date(end)
  const fmt = (d: Date) => `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
  return `${fmt(s)} - ${fmt(e)}`
}

// Generate print-friendly HTML for PDF
function generatePrintHtml(trip: Trip, days: Day[], items: Item[]): string {
  const getItemsForDay = (dayId: string) =>
    items
      .filter((item) => item.dayId === dayId)
      .sort((a, b) => {
        if (a.timeStart && b.timeStart) return a.timeStart.localeCompare(b.timeStart)
        return a.sort - b.sort
      })

  return `
    <div style="font-family: 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', sans-serif; color: #3d2e1f; padding: 20px;">
      <h1 style="font-size: 24px; margin: 0 0 8px 0; font-weight: 600;">${escapeHtml(trip.title)}</h1>
      <p style="color: #8c7b6b; margin: 0 0 24px 0; font-size: 14px;">
        ${formatDateRange(trip.startDate, trip.endDate)}
      </p>
      ${days
        .sort((a, b) => a.sort - b.sort)
        .map((day, index) => {
          const dayItems = getItemsForDay(day.id)
          return `
            <div style="margin-bottom: 24px;">
              <h2 style="font-size: 16px; font-weight: 500; border-bottom: 1px solid #d9d0c5; padding-bottom: 8px; margin: 0 0 12px 0;">
                Day ${index + 1} - ${formatDate(day.date)}
              </h2>
              ${dayItems.length === 0 ? `
                <div style="padding: 8px 0; color: #b5a899; font-size: 14px;">
                  予定がありません
                </div>
              ` : dayItems.map(item => `
                <div style="display: flex; gap: 16px; padding: 8px 0; border-bottom: 1px solid #e8e2da;">
                  <span style="width: 50px; min-width: 50px; color: #8c7b6b; font-size: 13px;">${escapeHtml(item.timeStart || '-')}</span>
                  <div style="flex: 1;">
                    <div style="font-weight: 500; font-size: 14px; margin-bottom: 2px;">${escapeHtml(item.title)}</div>
                    <div style="font-size: 12px; color: #8c7b6b;">
                      ${item.area ? `<span style="margin-right: 8px;">${escapeHtml(item.area)}</span>` : ''}
                      ${item.cost && item.cost > 0 ? `<span>${formatCost(item.cost)}</span>` : ''}
                    </div>
                    ${item.note ? `<div style="font-size: 12px; color: #6b5a4a; margin-top: 4px;">${escapeHtml(item.note)}</div>` : ''}
                  </div>
                </div>
              `).join('')}
              ${day.notes ? `
                <div style="margin-top: 12px; padding: 8px; background: #f6f3ee; border-radius: 6px;">
                  <div style="font-size: 12px; color: #8c7b6b; margin-bottom: 4px;">メモ</div>
                  <div style="font-size: 13px; color: #3d2e1f;">${escapeHtml(day.notes)}</div>
                </div>
              ` : ''}
            </div>
          `
        }).join('')}
      ${getTotalCost(items) > 0 ? `
        <div style="margin-top: 24px; padding-top: 16px; border-top: 2px solid #d9d0c5; display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 14px; color: #8c7b6b;">合計費用</span>
          <span style="font-size: 18px; font-weight: 600; color: #3d2e1f;">${formatCost(getTotalCost(items))}</span>
        </div>
      ` : ''}
    </div>
  `
}

function escapeHtml(text: string): string {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

function getTotalCost(items: Item[]): number {
  return items.reduce((sum, item) => sum + (item.cost || 0), 0)
}

export function PdfExportButton({ tripId, tripTitle, asMenuItem, onComplete }: PdfExportButtonProps) {
  const [generating, setGenerating] = useState(false)

  const generatePdf = async () => {
    setGenerating(true)
    try {
      // Fetch trip data
      const res = await fetch(`/api/trips/${tripId}`)
      if (!res.ok) {
        throw new Error('Failed to fetch trip data')
      }
      const data = await res.json() as { trip: Trip }
      const trip = data.trip

      // Create a temporary container for rendering
      const printContainer = document.createElement('div')
      printContainer.className = 'pdf-export-container'
      printContainer.style.cssText = `
        position: absolute;
        left: -9999px;
        top: 0;
        width: 210mm;
        padding: 10mm;
        background: white;
        box-sizing: border-box;
      `

      // Generate HTML content
      printContainer.innerHTML = generatePrintHtml(
        trip,
        trip.days || [],
        trip.items || []
      )
      document.body.appendChild(printContainer)

      // Wait for fonts to load
      await document.fonts.ready

      // Capture with html2canvas
      const canvas = await html2canvas(printContainer, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        windowWidth: 794, // A4 width in pixels at 96dpi
      })

      // Remove the temporary container
      document.body.removeChild(printContainer)

      // Create PDF
      const imgData = canvas.toDataURL('image/png')
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
      })

      const imgWidth = 210 // A4 width in mm
      const pageHeight = 297 // A4 height in mm
      const imgHeight = (canvas.height * imgWidth) / canvas.width
      let heightLeft = imgHeight
      let position = 0

      // Add first page
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)
      heightLeft -= pageHeight

      // Add additional pages if needed
      while (heightLeft > 0) {
        position = heightLeft - imgHeight
        pdf.addPage()
        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)
        heightLeft -= pageHeight
      }

      // Generate filename
      const filename = `${tripTitle.replace(/[/\\?%*:|"<>]/g, '-')}.pdf`
      pdf.save(filename)
    } catch (error) {
      console.error('PDF generation failed:', error)
      alert('PDFの生成に失敗しました')
    } finally {
      setGenerating(false)
      onComplete?.()
    }
  }

  if (asMenuItem) {
    return (
      <button
        className="more-menu-item"
        onClick={generatePdf}
        disabled={generating}
      >
        <DownloadIcon size={14} /> {generating ? 'PDF生成中…' : 'PDF出力'}
      </button>
    )
  }

  return (
    <button
      className="btn-icon"
      onClick={generatePdf}
      disabled={generating}
      title="PDFをダウンロード"
    >
      {generating ? <span className="btn-loading" /> : <DownloadIcon size={16} />}
    </button>
  )
}
