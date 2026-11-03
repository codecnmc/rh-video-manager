import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react'
import { AssemblyPlaybackCoordinator } from './assembly-playback-coordinator'

const PlaybackContext = createContext<AssemblyPlaybackCoordinator | null>(null)

export function AssemblyPlaybackScope({ active, children }: { active: boolean; children: ReactNode }) {
  const coordinator = useRef(new AssemblyPlaybackCoordinator())
  useEffect(() => { if (!active) coordinator.current.pauseAll() }, [active])
  return <PlaybackContext.Provider value={coordinator.current}>{children}</PlaybackContext.Provider>
}

export function useAssemblyPlaybackLease(pause: () => void): () => void {
  const coordinator = useContext(PlaybackContext)
  const owner = useRef({})
  const latestPause = useRef(pause)
  latestPause.current = pause
  useEffect(() => coordinator?.register(owner.current, () => latestPause.current()), [coordinator])
  return () => coordinator?.claim(owner.current)
}
