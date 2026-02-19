import './App.css'

// Sample data for demo — will be replaced with API calls
const sampleTrips = [
  {
    id: '1',
    title: '京都・奈良',
    startDate: '2026-03-20',
    endDate: '2026-03-23',
    days: [
      {
        id: 'd1',
        label: 'Day 1',
        date: '3/20 (金)',
        items: [
          { id: 'i1', time: '10:00', title: '京都駅 到着', area: '京都駅', note: '新幹線のぞみ' },
          { id: 'i2', time: '11:30', title: '伏見稲荷大社', area: '伏見', note: '千本鳥居を散策', cost: 0 },
          { id: 'i3', time: '14:00', title: '錦市場', area: '中京区', note: '昼食・食べ歩き', cost: 2000 },
          { id: 'i4', time: '16:00', title: 'ホテルチェックイン', area: '四条', note: '' },
        ],
      },
      {
        id: 'd2',
        label: 'Day 2',
        date: '3/21 (土)',
        items: [
          { id: 'i5', time: '09:00', title: '嵐山 竹林の小径', area: '嵐山', note: '早朝がおすすめ' },
          { id: 'i6', time: '12:00', title: '天龍寺', area: '嵐山', note: '庭園が見どころ', cost: 500 },
          { id: 'i7', time: '15:00', title: '金閣寺', area: '北区', note: '', cost: 400 },
        ],
      },
    ],
  },
  {
    id: '2',
    title: '台北 週末旅行',
    startDate: '2026-04-10',
    endDate: '2026-04-12',
    days: [],
  },
]

function formatDateRange(start: string, end: string): string {
  const s = new Date(start)
  const e = new Date(end)
  const fmt = (d: Date) =>
    `${d.getMonth() + 1}/${d.getDate()}`
  return `${fmt(s)} – ${fmt(e)}`
}

function formatCost(cost: number): string {
  return `¥${cost.toLocaleString()}`
}

type Trip = (typeof sampleTrips)[number]
type Day = Trip['days'][number]

function App() {
  // In the future this will use state + API fetching
  const trips = sampleTrips
  const selectedTrip = trips[0]

  return (
    <div className="app">
      <header className="header">
        <span className="header-logo">旅程</span>
      </header>

      <main className="main">
        {/* Trip detail: day timeline */}
        {selectedTrip && (
          <>
            <div className="hero" style={{ padding: 'var(--space-7) 0 var(--space-5)' }}>
              <h1 className="hero-title">{selectedTrip.title}</h1>
              <p className="hero-subtitle">
                {formatDateRange(selectedTrip.startDate, selectedTrip.endDate)}
              </p>
            </div>

            {selectedTrip.days.map((day: Day) => (
              <div key={day.id} className="day-section">
                <div className="day-header">
                  <span className="day-label">{day.label}</span>
                  <span className="day-date">{day.date}</span>
                </div>
                {day.items.map((item) => (
                  <div key={item.id} className="timeline-item">
                    <span className="timeline-time">{item.time}</span>
                    <div className="timeline-content">
                      <span className="timeline-title">{item.title}</span>
                      <div className="timeline-meta">
                        {item.area && <span>{item.area}</span>}
                        {item.cost != null && item.cost > 0 && (
                          <span>{formatCost(item.cost)}</span>
                        )}
                      </div>
                      {item.note && (
                        <p className="timeline-note">{item.note}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </>
        )}

        {/* Trip list section */}
        <div className="trip-list-section">
          <div className="section-header">
            <span className="section-title">trips</span>
            <button className="btn-outline">あたらしい旅程</button>
          </div>

          {trips.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">—</div>
              <p className="empty-state-text">
                まだ旅程がありません。<br />
                あたらしい旅程をつくりましょう。
              </p>
            </div>
          ) : (
            trips.map((trip) => (
              <div key={trip.id} className="trip-card">
                <div className="trip-card-title">{trip.title}</div>
                <div className="trip-card-date">
                  {formatDateRange(trip.startDate, trip.endDate)}
                </div>
              </div>
            ))
          )}
        </div>
      </main>

      <footer className="footer">
        <span className="footer-text">旅程</span>
      </footer>
    </div>
  )
}

export default App
