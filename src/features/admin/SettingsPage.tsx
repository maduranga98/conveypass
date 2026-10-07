import { useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { ErrorState } from '@/components/ui/ErrorState'
import { Input, Select } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { updateTenantSettings } from '@/lib/api'
import { DEFAULT_TIMEZONE } from '@/lib/dates'
import {
  DEFAULT_CHECKLIST,
  DEFAULT_PASS_SETTINGS,
  type ChecklistItemDef,
  type PassSettings,
} from '@/lib/defaultChecklist'
import { DEFAULT_REJECTION_REASONS, type RejectionReasonDef } from '@/lib/defaultRejectionReasons'
import { slaOf, type SlaSettings } from '@/lib/defaultSla'
import { DEFAULT_GATES, MIN_GATES, type GateDef } from '@/lib/gates'
import { apiErrorMessage } from '@/lib/errors'
import { strings } from '@/lib/strings'
import { useSession } from '@/features/auth/useAuth'
import { markSettingsVisited } from '@/features/onboarding/storage'
import { useTenant } from '@/features/passes/queries'
import type { Tenant } from '@/types'
import { gateNameOk, MAX_REASONS, MIN_REASONS, reasonLabelOk, retentionOk, slaOk } from './reasons'
import { RejectionReasonsEditor } from './RejectionReasonsEditor'
import { GatesEditor } from './GatesEditor'
import { RetentionEditor } from './RetentionEditor'
import { SlaEditor } from './SlaEditor'
import { AdminsCard } from './AdminsCard'

const t = strings.admin.settings
const MAX_ITEMS = 12

/** Ids are generated once, when an item is added, and never edited: passes keep answers by id. */
const newId = (): string => `custom_${Math.random().toString(36).slice(2, 8)}`
const labelOk = (label: string): boolean => label.trim().length >= 3 && label.trim().length <= 60

interface Baseline {
  checklist: ChecklistItemDef[]
  settings: PassSettings
  reasons: RejectionReasonDef[]
  gates: GateDef[]
  sla: SlaSettings
  retentionDays: number
}

const baselineOf = (tenant: Tenant | null): Baseline => ({
  checklist: tenant?.checklist && tenant.checklist.length > 0 ? tenant.checklist : [...DEFAULT_CHECKLIST],
  settings: { ...DEFAULT_PASS_SETTINGS, ...tenant?.passSettings },
  reasons: tenant?.rejectionReasons && tenant.rejectionReasons.length > 0 ? tenant.rejectionReasons : [...DEFAULT_REJECTION_REASONS],
  gates: tenant?.gates && tenant.gates.length > 0 ? tenant.gates : [...DEFAULT_GATES],
  sla: slaOf(tenant),
  retentionDays: tenant?.retentionDays ?? 0,
})

function SettingsForm({ tenant, tenantId }: { tenant: Tenant | null; tenantId: string }) {
  const queryClient = useQueryClient()
  const usingDefaults = !tenant?.checklist || tenant.checklist.length === 0
  const [baseline, setBaseline] = useState<Baseline>(() => baselineOf(tenant))
  const [items, setItems] = useState<ChecklistItemDef[]>(baseline.checklist)
  const [settings, setSettings] = useState<PassSettings>(baseline.settings)
  const [reasons, setReasons] = useState<RejectionReasonDef[]>(baseline.reasons)
  const usingDefaultReasons = !tenant?.rejectionReasons || tenant.rejectionReasons.length === 0
  const [gates, setGates] = useState<GateDef[]>(baseline.gates)
  const usingDefaultGates = !tenant?.gates || tenant.gates.length === 0
  const [sla, setSla] = useState<SlaSettings>(baseline.sla)
  const usingDefaultSla = !tenant?.sla
  const [retention, setRetention] = useState<number>(baseline.retentionDays)
  const [confirmRetention, setConfirmRetention] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)

  const dirty =
    JSON.stringify({ items, settings, reasons, gates, sla, retention }) !==
    JSON.stringify({ items: baseline.checklist, settings: baseline.settings, reasons: baseline.reasons, gates: baseline.gates, sla: baseline.sla, retention: baseline.retentionDays })
  const retentionChanged = !Object.is(retention, baseline.retentionDays)
  const slaChanged = JSON.stringify(sla) !== JSON.stringify(baseline.sla)
  const reasonsChanged = JSON.stringify(reasons) !== JSON.stringify(baseline.reasons)
  const gatesChanged = JSON.stringify(gates) !== JSON.stringify(baseline.gates)
  const invalidLabels =
    items.some((i) => !labelOk(i.label)) || reasons.some((r) => !reasonLabelOk(r.label)) || gates.some((g) => !gateNameOk(g.name))
  const reasonCountBad = reasons.length < MIN_REASONS || reasons.length > MAX_REASONS || gates.length < MIN_GATES
  const problem = items.length === 0 ? t.needOne : null

  const update = (index: number, patch: Partial<ChecklistItemDef>) =>
    setItems((list) => list.map((it, i) => (i === index ? { ...it, ...patch } : it)))
  const move = (index: number, by: -1 | 1) =>
    setItems((list) => {
      const target = index + by
      if (target < 0 || target >= list.length) return list
      const next = [...list]
      const [moved] = next.splice(index, 1)
      if (moved) next.splice(target, 0, moved)
      return next
    })

  // Turning deletion on, or shortening the limit, asks first: it removes photos for good.
  const askOrSave = () => {
    setTouched(true)
    if (invalidLabels || problem || reasonCountBad || !slaOk(sla) || !retentionOk(retention)) return
    if (retentionChanged && retention !== 0 && (baseline.retentionDays === 0 || retention < baseline.retentionDays)) setConfirmRetention(true)
    else void save()
  }

  const save = async () => {
    setConfirmRetention(false)
    setTouched(true)
    if (invalidLabels || problem || reasonCountBad || !slaOk(sla) || !retentionOk(retention)) return
    setSaving(true)
    setError(null)
    const checklist = items.map((i) => ({ ...i, label: i.label.trim() }))
    const cleanReasons = reasons.map((r) => ({ ...r, label: r.label.trim() }))
    const cleanGates = gates.map((g) => ({ ...g, name: g.name.trim() }))
    try {
      // The default reasons are only written once the admin actually changes them (or already has their own).
      const saveReasons = reasonsChanged || !usingDefaultReasons
      const saveGates = gatesChanged || !usingDefaultGates
      await updateTenantSettings({
        passSettings: settings,
        checklist,
        ...(saveReasons ? { rejectionReasons: cleanReasons } : {}),
        ...(saveGates ? { gates: cleanGates } : {}),
        ...(slaChanged || !usingDefaultSla ? { sla } : {}),
        ...(retentionChanged ? { retentionDays: retention } : {}),
      })
      setItems(checklist)
      setReasons(cleanReasons)
      setGates(cleanGates)
      setBaseline({ checklist, settings, reasons: cleanReasons, gates: cleanGates, sla, retentionDays: retention })
      await queryClient.invalidateQueries({ queryKey: ['tenant', tenantId] })
      toast.success(t.saved)
    } catch (e) {
      setError(apiErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-8">
      <section aria-labelledby="chk-title" className="space-y-4">
        <div>
          <h2 id="chk-title" className="text-lg font-semibold">{t.checklistTitle}</h2>
          <p className="text-sm text-slate-500">{t.checklistHint}</p>
          {usingDefaults && <p className="mt-1 text-sm text-slate-500">{t.usingDefaults}</p>}
        </div>

        <ul className="space-y-3">
          {items.map((item, i) => (
            <li key={item.id} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
              <Input
                label={t.label}
                value={item.label}
                maxLength={60}
                error={touched && !labelOk(item.label) ? t.labelError : undefined}
                onChange={(e) => update(i, { label: e.target.value })}
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex min-h-10 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-indigo-600"
                    checked={item.failBlocks}
                    onChange={(e) => update(i, { failBlocks: e.target.checked })}
                  />
                  <span><span className="font-medium">{t.blocks}</span> <span className="text-slate-500">· {t.blocksHint}</span></span>
                </label>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" aria-label={`${t.moveUp}: ${item.label}`} disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp aria-hidden className="size-4" />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label={`${t.moveDown}: ${item.label}`} disabled={i === items.length - 1} onClick={() => move(i, 1)}>
                    <ArrowDown aria-hidden className="size-4" />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label={`${t.remove}: ${item.label}`} onClick={() => setItems((l) => l.filter((_, n) => n !== i))}>
                    <Trash2 aria-hidden className="size-4" />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
        {problem && <p role="alert" className="text-sm text-red-600">{problem}</p>}

        <Button
          variant="secondary"
          icon={<Plus aria-hidden className="size-4" />}
          disabled={items.length >= MAX_ITEMS}
          onClick={() => setItems((l) => [...l, { id: newId(), label: '', failBlocks: false }])}
        >
          {t.add}
        </Button>
        {items.length >= MAX_ITEMS && <p className="text-xs text-slate-500">{t.max}</p>}
      </section>

      <RejectionReasonsEditor items={reasons} onChange={setReasons} showErrors={touched} usingDefaults={usingDefaultReasons} />

      <GatesEditor items={gates} onChange={setGates} showErrors={touched} usingDefaults={usingDefaultGates} />

      <SlaEditor value={sla} onChange={setSla} showErrors={touched} usingDefaults={usingDefaultSla} />

      <RetentionEditor value={retention} onChange={setRetention} showErrors={touched} />

      <section aria-label={strings.admin.nav.settings} className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
        <label className="flex min-h-10 items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-indigo-600"
            checked={settings.requireLocation}
            onChange={(e) => setSettings((s) => ({ ...s, requireLocation: e.target.checked }))}
          />
          <span><span className="font-medium">{t.requireLocation}</span><br /><span className="text-slate-500">{t.requireLocationHint}</span></span>
        </label>
        <Select
          label={t.maxExtra}
          value={String(settings.maxExtraPhotos)}
          onChange={(e) => setSettings((s) => ({ ...s, maxExtraPhotos: Number(e.target.value) }))}
        >
          {[0, 1, 2].map((n) => <option key={n} value={n}>{n}</option>)}
        </Select>
        <Input label={t.timezone} value={tenant?.timezone ?? DEFAULT_TIMEZONE} readOnly hint={t.timezoneHint} />
      </section>

      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div>
        <Button loading={saving} disabled={!dirty} onClick={askOrSave}>
          {saving ? strings.common.saving : t.save}
        </Button>
      </div>
      <ConfirmDialog
        open={confirmRetention}
        title={strings.retention.confirmTitle}
        body={strings.retention.confirmBody(retention)}
        confirmLabel={strings.retention.confirm}
        tone="danger"
        onConfirm={() => void save()}
        onCancel={() => setConfirmRetention(false)}
      />
    </div>
  )
}

export default function SettingsPage() {
  const { claims } = useSession()
  const tenant = useTenant(claims.tenantId)
  // The onboarding checklist's last step: the admin has looked at the defaults (remembered on this device).
  useEffect(() => markSettingsVisited(claims.tenantId), [claims.tenantId])

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="mt-1 text-sm text-slate-500">{t.intro}</p>
      </div>
      {tenant.isPending ? (
        <div role="status" className="space-y-3">
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-28 w-full rounded-xl" />
        </div>
      ) : tenant.isError ? (
        <ErrorState message={t.loadFailed} onRetry={() => void tenant.refetch()} />
      ) : (
        <SettingsForm tenant={tenant.data} tenantId={claims.tenantId} />
      )}
      <AdminsCard />
    </div>
  )
}
