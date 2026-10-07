import { useInfiniteQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { SearchField } from '@/components/ui/SearchField'
import { PageSpinner } from '@/components/ui/Spinner'
import { listTenants } from '@/lib/api'
import { strings } from '@/lib/strings'
import type { TenantRow } from '@/types/platform'

const t = strings.platform.tenants

/** Read only: name, created, timezone, admin and two counts. Nothing else about a workspace reaches this screen. */
export default function TenantsPage() {
  const [search, setSearch] = useState('')
  const q = useInfiniteQuery({
    queryKey: ['platform', 'tenants'],
    queryFn: ({ pageParam }) => listTenants(pageParam ? { cursor: pageParam } : {}),
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 0,
  })
  const all = useMemo(() => q.data?.pages.flatMap((p) => p.tenants) ?? [], [q.data])
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return all
    return all.filter((r) => [r.name, r.adminName, r.adminEmail].some((v) => v?.toLowerCase().includes(needle)))
  }, [all, search])

  const columns: Column<TenantRow>[] = [
    { key: 'name', header: t.columns.name, primary: true, cell: (r) => <span className="font-medium text-slate-900">{r.name}</span> },
    { key: 'created', header: t.columns.created, cell: (r) => format(new Date(r.createdAt), 'd MMM yyyy') },
    { key: 'tz', header: t.columns.timezone, cell: (r) => r.timezone },
    {
      key: 'admin',
      header: t.columns.admin,
      cell: (r) => (r.adminName || r.adminEmail ? <>{r.adminName}<span className="block text-xs text-slate-500">{r.adminEmail}</span></> : strings.common.none),
    },
    { key: 'users', header: t.columns.users, className: 'tabular-nums', cell: (r) => r.userCount },
    { key: 'vehicles', header: t.columns.vehicles, className: 'tabular-nums', cell: (r) => r.vehicleCount },
  ]

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">{t.title}</h1>
        <p className="mt-1 text-sm text-slate-500">{t.intro}</p>
      </header>
      <SearchField label={t.search} placeholder={t.searchPlaceholder} value={search} onChange={(e) => setSearch(e.target.value)} />
      {q.isPending ? (
        <PageSpinner />
      ) : q.isError ? (
        <ErrorState message={t.loadFailed} onRetry={() => void q.refetch()} />
      ) : all.length === 0 ? (
        <EmptyState title={t.empty} />
      ) : rows.length === 0 ? (
        <EmptyState title={t.noMatch} />
      ) : (
        <DataTable caption={t.title} columns={columns} rows={rows} rowKey={(r) => r.tenantId} />
      )}
      {q.hasNextPage && (
        <div className="flex justify-center">
          <Button variant="secondary" loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>{t.loadMore}</Button>
        </div>
      )}
    </div>
  )
}
