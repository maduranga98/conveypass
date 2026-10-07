import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { strings } from '@/lib/strings'
import type { TrendDay } from '@/types/reports'

const t = strings.dashboard.trend

/** Submitted and checked in as bars (the second hatched), rejected as a line with markers: shape, not colour, tells them apart. */
export default function TrendChart({ days }: { days: TrendDay[] }) {
  const data = days.map((d) => ({ day: `${d.dateKey.slice(6, 8)}/${d.dateKey.slice(4, 6)}`, submitted: d.submitted, checkedIn: d.checkedIn, rejected: d.rejected }))
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
        <defs>
          <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="#e0e7ff" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="#4f46e5" strokeWidth="3" />
          </pattern>
        </defs>
        <CartesianGrid vertical={false} stroke="#e2e8f0" />
        <XAxis dataKey="day" tick={{ fontSize: 12 }} tickLine={false} interval="preserveStartEnd" />
        <YAxis allowDecimals={false} tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
        <Tooltip />
        <Legend />
        <Bar dataKey="submitted" name={t.series.submitted} fill="#475569" radius={[3, 3, 0, 0]} />
        <Bar dataKey="checkedIn" name={t.series.checkedIn} fill="url(#hatch)" stroke="#4f46e5" radius={[3, 3, 0, 0]} />
        <Line dataKey="rejected" name={t.series.rejected} type="monotone" stroke="#dc2626" strokeWidth={2} strokeDasharray="5 3" dot={{ r: 3 }} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
