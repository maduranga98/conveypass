// Which Firebase project a script talks to. Pure, so it can be tested; the scripts do the I/O.
export type EnvName = 'emulator' | 'staging' | 'prod'

export interface Firebaserc {
  projects?: Record<string, string | undefined>
}

export interface Target {
  env: EnvName
  /** `undefined` for the emulator (it uses the default project id). */
  projectId: string | undefined
}

const PLACEHOLDER = /replace|placeholder|your-|todo|changeme/i

export const isEnvName = (v: string | undefined): v is EnvName => v === 'emulator' || v === 'staging' || v === 'prod'

/**
 * `--env emulator|staging|prod`. Staging and production read their project id from the `.firebaserc` alias of the same
 * name and refuse a placeholder. Production additionally needs `--confirm-production`: nothing touches it by accident.
 */
export function resolveTarget(input: { env: string | undefined; confirmProduction: boolean; firebaserc: Firebaserc; projectOverride?: string | undefined }): Target {
  const { env, confirmProduction, firebaserc, projectOverride } = input
  if (!isEnvName(env)) throw new Error('--env must be "emulator", "staging" or "prod"')
  if (env === 'emulator') return { env, projectId: undefined }
  if (env === 'prod' && !confirmProduction) throw new Error('refusing to touch production without --confirm-production')
  const projectId = projectOverride ?? firebaserc.projects?.[env]
  if (!projectId) throw new Error(`no project for "${env}": add it to .firebaserc (projects.${env}) or set FIREBASE_PROJECT_ID`)
  if (PLACEHOLDER.test(projectId)) throw new Error(`.firebaserc projects.${env} is still a placeholder ("${projectId}"): put the real project id there`)
  return { env, projectId }
}

export const loopback = (hostPort: string | undefined): boolean => Boolean(hostPort && /^(127\.\d+\.\d+\.\d+|localhost|\[::1\]):\d+$/.test(hostPort))
