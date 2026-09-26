// One interface, two implementations: the in-browser mock server (MOCK=true) and the FastAPI client.
import { MOCK } from '@/lib/config'
import type { Api } from './client'
import { httpApi } from './http'

export type { Api, CalendarStatus, NewLecture, Workspace } from './client'
export { ApiError } from './client'

/** The mock is imported on first use, so real mode never loads (or breaks on) mock code. */
function lazyMock(): Api {
  let mod: Promise<Api> | undefined
  const load = () => (mod ??= import('./mock/server').then((m) => m.mockApi))
  return new Proxy({} as Api, {
    get:
      (_target, key) =>
      (...args: unknown[]) =>
        load().then((a) => (a[key as keyof Api] as (...x: unknown[]) => unknown)(...args)),
  })
}

export const api: Api = MOCK ? lazyMock() : httpApi
