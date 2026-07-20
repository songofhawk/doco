import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

export const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000/app-api/v1'

export type CurrentUser = {
  id: string
  email: string
  name?: string | null
  avatarUrl?: string | null
  appearanceTheme?: AppearanceTheme
}

export type AppearanceTheme = 'simple' | 'paper'

type AuthContextValue = {
  user: CurrentUser | null
  loading: boolean
  googleClientId: string
  signInWithGoogleCredential(credential: string): Promise<void>
  requestEmailCode(email: string): Promise<{ expiresInSeconds: number; retryAfterSeconds: number }>
  signInWithEmailCode(email: string, code: string): Promise<void>
  signOut(): Promise<void>
  updateAppearance(theme: AppearanceTheme): Promise<void>
  refresh(): Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

function apiUrl(path: string) {
  if (/^https?:\/\//.test(path)) return path
  return `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`
}

export function apiFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  const hasBody = init.body !== undefined && init.body !== null
  const isFormData = typeof FormData !== 'undefined' && init.body instanceof FormData
  if (hasBody && !isFormData && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  return fetch(apiUrl(path), {
    ...init,
    headers,
    credentials: 'include',
  })
}

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [googleClientId, setGoogleClientId] = useState('')

  const refresh = useCallback(async () => {
    try {
      const res = await apiFetch('/auth/me')
      if (!res.ok) {
        setUser(null)
        return
      }
      const data = await res.json()
      setUser(data.user)
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    apiFetch('/config/public')
      .then(async (res) => res.ok ? res.json() : null)
      .then((data) => setGoogleClientId(typeof data?.googleClientId === 'string' ? data.googleClientId : ''))
      .catch(() => setGoogleClientId(''))
  }, [])

  const signInWithGoogleCredential = useCallback(async (credential: string) => {
    const res = await apiFetch('/auth/google', {
      method: 'POST',
      body: JSON.stringify({ credential }),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || 'Google 登录失败')
    }

    const data = await res.json()
    setUser(data.user)
  }, [])

  const requestEmailCode = useCallback(async (email: string) => {
    const res = await apiFetch('/auth/email/code', {
      method: 'POST',
      body: JSON.stringify({ email }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || '验证码发送失败')
    }
    return res.json()
  }, [])

  const signInWithEmailCode = useCallback(async (email: string, code: string) => {
    const res = await apiFetch('/auth/email/verify', {
      method: 'POST',
      body: JSON.stringify({ email, code }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || '邮箱登录失败')
    }
    const data = await res.json()
    setUser(data.user)
  }, [])

  const signOut = useCallback(async () => {
    await apiFetch('/auth/logout', { method: 'POST' }).catch(() => {})
    setUser(null)
  }, [])

  const updateAppearance = useCallback(async (appearanceTheme: AppearanceTheme) => {
    setUser(current => current ? { ...current, appearanceTheme } : current)
    const res = await apiFetch('/auth/preferences', {
      method: 'PATCH',
      body: JSON.stringify({ appearanceTheme }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || '外观设置保存失败')
    }
    const data = await res.json()
    setUser(data.user)
  }, [])

  const value = useMemo<AuthContextValue>(() => ({
    user,
    loading,
    googleClientId,
    signInWithGoogleCredential,
    requestEmailCode,
    signInWithEmailCode,
    signOut,
    updateAppearance,
    refresh,
  }), [
    user,
    loading,
    googleClientId,
    signInWithGoogleCredential,
    requestEmailCode,
    signInWithEmailCode,
    signOut,
    updateAppearance,
    refresh,
  ])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}
