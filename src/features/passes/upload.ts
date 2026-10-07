import { ref, uploadBytesResumable } from 'firebase/storage'
import { storage } from '@/lib/firebase'

/** Uploads one evidence photo. Rejects when it fails or when `signal` aborts (the upload is cancelled). */
export function uploadEvidence(
  path: string,
  blob: Blob,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('aborted', 'AbortError'))
    const task = uploadBytesResumable(ref(storage, path), blob, {
      contentType: 'image/jpeg',
      cacheControl: 'private, max-age=3600',
    })
    const cancel = () => task.cancel()
    signal.addEventListener('abort', cancel, { once: true })
    task.on(
      'state_changed',
      (snap) => onProgress(snap.totalBytes > 0 ? snap.bytesTransferred / snap.totalBytes : 0),
      (err) => {
        signal.removeEventListener('abort', cancel)
        reject(err)
      },
      () => {
        signal.removeEventListener('abort', cancel)
        resolve()
      },
    )
  })
}
