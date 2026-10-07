import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { strings } from '@/lib/strings'
import type { ReportRow } from '@/types/reports'

const t = strings.reports.contractorChart
const num = (v: unknown): number => (typeof v === 'number' ? v : 0)

function Hatch() {
  return (
    <defs>
      <pattern id="hatch-r" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="6" height="6" fill="#e0e7ff" />
        <line x1="0" y1="0" x2="0" y2="6" stroke="#4f46e5" strokeWidth="3" />
      </pattern>
      <pattern id="dots-r" width="6" height="6" patternUnits="userSpaceOnUse">
        <rect width="6" height="6" fill="#fee2e2" />
        <circle cx="3" cy="3" r="1.5" fill="#dc2626" />
      </pattern>
    </defs>
  )
}

/** Submissions, checked in and rejections per contractor. Fills differ in pattern, not only in colour. */
export function ContractorActivityChart({ rows }: { rows: ReportRow[] }) {
  const data = rows.filter((r) => !r.isTotal).map((r) => ({ name: String(r.contractor), submissions: num(r.submissions), checkedIn: num(r.checkedIn), rejections: num(r.rejections) }))
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
        <Hatch />
        <CartesianGrid vertical={false} stroke="#e2e8f0" />
        <XAxis dataKey="name" tick={{ fontSize: 12 }} tickLine={false} />
        <YAxis allowDecimals={false} tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
        <Tooltip />
        <Legend />
        <Bar dataKey="submissions" name={t.submissions} fill="#475569" />
        <Bar dataKey="checkedIn" name={t.checkedIn} fill="url(#hatch-r)" stroke="#4f46e5" />
        <Bar dataKey="rejections" name={t.rejections} fill="url(#dots-r)" stroke="#dc2626" />
      </BarChart>
    </ResponsiveContainer>
  )
}

/** Horizontal bars: one value per name (rejections by reason). */
export function CountChart({ rows, label }: { rows: ReportRow[]; label: string }) {
  const data = rows.map((r) => ({ name: String(r.name), count: num(r.count) }))
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
        <CartesianGrid horizontal={false} stroke="#e2e8f0" />
        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
        <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 12 }} tickLine={false} />
        <Tooltip />
        <Bar dataKey="count" name={label} fill="#475569" />
      </BarChart>
    </ResponsiveContainer>
  )
}

/** Median and p90 minutes per approval stage. */
export function TurnaroundChart({ rows }: { rows: ReportRow[] }) {
  const data = rows.map((r) => ({ name: String(r.metric), median: num(r.median), p90: num(r.p90) }))
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
        <Hatch />
        <CartesianGrid vertical={false} stroke="#e2e8f0" />
        <XAxis dataKey="name" tick={{ fontSize: 12 }} tickLine={false} />
        <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} unit=" min" />
        <Tooltip />
        <Legend />
        <Bar dataKey="median" name="Median" fill="#475569" />
        <Bar dataKey="p90" name="p90" fill="url(#hatch-r)" stroke="#4f46e5" />
      </BarChart>
    </ResponsiveContainer>
  )
}
