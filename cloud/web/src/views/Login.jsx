import React, { useState } from 'react'
import { api } from '../api.js'
import { I, Logo } from '../ui.jsx'
import { useI18n, LangSelect } from '../i18n.jsx'

/* guestReturn opens an admin-password overlay while browsing, allowing elevation or cancellation back to the library. */
export default function Login({ onOk, guestReturn, onCancel }) {
  const { t } = useI18n()
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [shake, setShake] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (!pw || busy) return
    setBusy(true); setErr('')
    try {
      const r = await api.login(pw)
      onOk(r.role)
    } catch (e) {
      setErr(e.message || t('login.fail'))
      setShake(true)
      setTimeout(() => setShake(false), 420)
    } finally { setBusy(false) }
  }

  return (
    <div className={`login-wrap ${guestReturn ? 'login-overlay' : ''}`}>
      <form className={`login-card ${shake ? 'shake' : ''}`} onSubmit={submit}>
        <div className="logo"><Logo size={34} /> {t('brand')}</div>
        <div className="sub">
          {guestReturn ? t('login.adminLogin') : t('brandSub')}
        </div>
        <input type="password"
               placeholder={guestReturn ? t('login.adminPassword') : t('login.password')}
               value={pw} autoFocus
               autoComplete="current-password"
               onChange={(e) => setPw(e.target.value)} />
        <button className="btn primary" disabled={busy}>
          {busy ? <I.spin /> : guestReturn ? t('login.signIn') : t('login.enter')}
        </button>
        {guestReturn && (
          <button type="button" className="btn ghost" onClick={onCancel}>
            {t('login.backBrowse')}
          </button>
        )}
        <div className="login-err">{err}</div>
        <div className="login-lang"><LangSelect /></div>
      </form>
    </div>
  )
}
