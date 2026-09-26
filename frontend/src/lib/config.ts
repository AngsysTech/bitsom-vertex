// Runtime switches. MOCK must keep working all day (AGENTS.md §8).
//   VITE_MOCK=false  → talk to the FastAPI backend at VITE_API_URL (default /api, proxied by Vite)
//   ?mock=0 / ?mock=1 in the URL overrides the env for a quick flip.

const fromUrl = new URLSearchParams(window.location.search).get('mock')

export const MOCK = fromUrl != null ? fromUrl !== '0' && fromUrl !== 'false' : import.meta.env.VITE_MOCK !== 'false'

export const API_URL: string = import.meta.env.VITE_API_URL || '/api'

/** Student thread polls while an escalation is open (contracts.ts §10). */
export const POLL_MS = 3000

/** Display name for advisor replies; the contract has no advisor entity. */
export const ADVISOR_NAME = 'Dr. Kavita Rao'

export const DEFAULT_AGENT = 'academic_coach'

/** Coach DM starters (UI brief v2 §4). */
export const COACH_STARTERS = ['What should I study this week?', 'Run my weekly review', 'Am I on track?']
