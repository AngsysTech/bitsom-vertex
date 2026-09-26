import { resetCompanion } from '@/store/companion'
import { useWS } from '@/store/workspace'
import type { StudentId } from '@/types'
import { DEFAULT_AGENT } from './config'
import { navigate } from './route'

/** Reload the workspace for another student; lands on the Academic Coach unless in the advisor view. */
export function switchStudent(id: StudentId) {
  const s = useWS.getState()
  if (s.recording) return // the switcher says "stop the recording first"
  resetCompanion()
  void s.selectStudent(id)
  if (s.route.view !== 'advisor') {
    s.set({ rail: 'home' })
    navigate(`/dm/${DEFAULT_AGENT}`)
  }
}

/** Ask the coach in its DM (the Calendar page's "Rebuild plan", starters elsewhere). */
export function askCoach(text: string) {
  const s = useWS.getState()
  s.set({ rail: 'home', tab: 'messages' })
  navigate(`/dm/${DEFAULT_AGENT}`)
  void s.send(DEFAULT_AGENT, text)
}
