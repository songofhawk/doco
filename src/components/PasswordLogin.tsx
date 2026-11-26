import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth'

export default function PasswordLogin() {
  const { signInWithPassword, signUpWithPassword } = useAuth()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      if (mode === 'register') await signUpWithPassword(email.trim(), password)
      else await signInWithPassword(email.trim(), password)
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="lp-login-password" onSubmit={submit}>
      <div className="lp-login-switch">
        <button type="button" className={mode === 'login' ? 'is-active' : ''} onClick={() => { setMode('login'); setError('') }}>密码登录</button>
        <button type="button" className={mode === 'register' ? 'is-active' : ''} onClick={() => { setMode('register'); setError('') }}>注册新账号</button>
      </div>
      <label htmlFor="pw-email">邮箱地址</label>
      <input id="pw-email" type="email" className="lp-login-input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
      <label htmlFor="pw-password">密码{mode === 'register' ? '（至少 8 位）' : ''}</label>
      <input id="pw-password" type="password" className="lp-login-input" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} required />
      {error && <p className="lp-login-error">{error}</p>}
      <button type="submit" className="lp-login-submit" disabled={submitting}>
        {submitting ? '处理中…' : mode === 'register' ? '注册并登录' : '登录'}
      </button>
    </form>
  )
}
