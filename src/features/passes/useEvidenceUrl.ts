import { useQuery } from '@tanstack/react-query'
import { getDownloadURL, ref } from 'firebase/storage'
import { storage } from '@/lib/firebase'

/**
 * Download URL for a stored evidence path. Cached for a long time: evidence is never overwritten (each attempt has
 * its own folder), so a path always maps to the same photo. Storage rules decide who may ask.
 */
export function useEvidenceUrl(path: string | null | undefined) {
  return useQuery({
    queryKey: ['evidenceUrl', path],
    enabled: Boolean(path),
    staleTime: 6 * 60 * 60_000,
    gcTime: 12 * 60 * 60_000,
    retry: 1,
    queryFn: () => getDownloadURL(ref(storage, path as string)),
  })
}
