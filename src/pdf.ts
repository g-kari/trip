import { jsPDF } from 'jspdf';

interface PdfItem {
  title: string;
  timeStart: string | null;
  area: string | null;
  cost: number | null;
  note: string | null;
  mapUrl: string | null;
}

interface PdfDay {
  date: string;
  items: PdfItem[];
}

interface PdfTripData {
  title: string;
  startDate: string | null;
  endDate: string | null;
  days: PdfDay[];
}

// Format date for display
function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const days = ['日', '月', '火', '水', '木', '金', '土'];
  const dayOfWeek = days[d.getDay()];
  return `${d.getMonth() + 1}/${d.getDate()} (${dayOfWeek})`;
}

// Format date range
function formatDateRange(start: string | null, end: string | null): string {
  if (!start || !end) return '';
  const s = new Date(start);
  const e = new Date(end);
  const fmt = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
  return `${fmt(s)} - ${fmt(e)}`;
}

// Format cost
function formatCost(cost: number): string {
  return `¥${cost.toLocaleString()}`;
}

export async function generateTripPdf(trip: PdfTripData): Promise<ArrayBuffer> {
  // Create PDF document (A4 size)
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  // Helper to add new page if needed
  function checkNewPage(neededHeight: number) {
    if (y + neededHeight > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
  }

  // Title
  doc.setFontSize(24);
  doc.text(trip.title, pageWidth / 2, y, { align: 'center' });
  y += 12;

  // Date range
  if (trip.startDate && trip.endDate) {
    doc.setFontSize(12);
    doc.setTextColor(128, 128, 128);
    doc.text(formatDateRange(trip.startDate, trip.endDate), pageWidth / 2, y, { align: 'center' });
    doc.setTextColor(0, 0, 0);
    y += 15;
  } else {
    y += 8;
  }

  // Days and items
  trip.days.forEach((day, dayIndex) => {
    checkNewPage(20);

    // Day header
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    const dayLabel = `Day ${dayIndex + 1} - ${formatDate(day.date)}`;
    doc.text(dayLabel, margin, y);
    y += 8;

    // Divider line
    doc.setDrawColor(200, 200, 200);
    doc.line(margin, y, pageWidth - margin, y);
    y += 6;

    // Items
    if (day.items.length === 0) {
      checkNewPage(10);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(150, 150, 150);
      doc.text('予定がありません', margin + 5, y);
      doc.setTextColor(0, 0, 0);
      y += 10;
    } else {
      day.items.forEach((item) => {
        checkNewPage(25);

        // Time and title
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        const timeStr = item.timeStart || '--:--';
        doc.text(timeStr, margin, y);
        doc.setFont('helvetica', 'normal');
        doc.text(item.title, margin + 20, y);
        y += 5;

        // Area and cost
        const metaItems: string[] = [];
        if (item.area) metaItems.push(item.area);
        if (item.cost) metaItems.push(formatCost(item.cost));
        if (metaItems.length > 0) {
          doc.setFontSize(9);
          doc.setTextColor(100, 100, 100);
          doc.text(metaItems.join(' | '), margin + 20, y);
          doc.setTextColor(0, 0, 0);
          y += 4;
        }

        // Note
        if (item.note) {
          doc.setFontSize(9);
          doc.setTextColor(80, 80, 80);
          // Word wrap for long notes
          const noteLines = doc.splitTextToSize(item.note, contentWidth - 25);
          noteLines.forEach((line: string) => {
            checkNewPage(5);
            doc.text(line, margin + 20, y);
            y += 4;
          });
          doc.setTextColor(0, 0, 0);
        }

        y += 4;
      });
    }

    y += 6;
  });

  // Calculate total cost
  const totalCost = trip.days.reduce((sum, day) => {
    return sum + day.items.reduce((itemSum, item) => itemSum + (item.cost || 0), 0);
  }, 0);

  if (totalCost > 0) {
    checkNewPage(15);
    y += 5;
    doc.setDrawColor(200, 200, 200);
    doc.line(margin, y, pageWidth - margin, y);
    y += 8;
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text(`合計費用: ${formatCost(totalCost)}`, pageWidth - margin, y, { align: 'right' });
  }

  // Footer with branding
  doc.setFontSize(8);
  doc.setTextColor(180, 180, 180);
  doc.text('旅程 - trip.0g0.workers.dev', pageWidth / 2, pageHeight - 10, { align: 'center' });

  // Return as ArrayBuffer
  return doc.output('arraybuffer');
}
