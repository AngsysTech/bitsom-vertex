import { useWS } from '@/store/workspace'
import type { StudentId } from '@/types'
import { DEFAULT_AGENT } from './config'
import { navigate } from './route'

/** Reload the workspace for another student; lands on the Academic Coach unless in the advisor view. */
export function switchStudent(id: StudentId) {
  const s = useWS.getState()
  void s.selectStudent(id)
  if (s.route.view !== 'advisor') {
    s.set({ rail: 'home' })
    navigate(`/dm/${DEFAULT_AGENT}`)
  }
}
