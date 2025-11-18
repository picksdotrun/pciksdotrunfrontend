import { createContext, useContext, useEffect, useRef, useState } from 'react'

const NowContext = createContext(Date.now())

export function NowProvider({ children, intervalMs = 1000 }) {
  const [now, setNow] = useState(Date.now())
  const timerRef = useRef(null)
  useEffect(() => {
    timerRef.current = setInterval(() => setNow(Date.now()), intervalMs)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [intervalMs])
  return (
    <NowContext.Provider value={now}>{children}</NowContext.Provider>
  )
}

export function useNow() {
  return useContext(NowContext)
}

