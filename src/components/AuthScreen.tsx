/**
 * AuthScreen — email OTP sign-in with username picker.
 * Steps: email → otp → username → wallet creation
 */
import { useState, useEffect, useRef } from 'react'
import { Fingerprint, Mail, Loader2, ArrowRight, AtSign, CheckCircle2, XCircle } from 'lucide-react'
import { sendOtp, verifyOtp } from '@/supabase'
import { getOrCreateWallet, saveSession, apiFetch } from '@/kasaWallet'
import { toast } from 'sonner'

type Step = 'email' | 'otp' | 'username' | 'wallet'
interface Props {
  onAuth: (userId: string, username: string, walletId: string, address: string, email: string) => void
}

export default function AuthScreen({ onAuth }: Props) {
  const [step, setStep]       = useState<Step>('email')
  const [email, setEmail]     = useState('')
  const [otp, setOtp]         = useState('')
  const [userId, setUserId]   = useState('')
  const [username, setUsername] = useState('')
  const [checking, setChecking] = useState(false)
  const [available, setAvailable] = useState<boolean | null>(null)
  const [availReason, setAvailReason] = useState('')
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Derived validation (no effect needed for format check)
  const formatOk = /^[a-z0-9_]{3,20}$/.test(username)

  // Debounced availability check — only runs when format is valid
  /* eslint-disable react/set-state-in-effect */
  useEffect(() => {
    setAvailable(null); setAvailReason('')
    if (!username || !formatOk) return
    setChecking(true)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      void (async () => {
        try {
          const res = await apiFetch(`/api/registry/check?username=${encodeURIComponent(username)}`)
          const data = await res.json() as { available: boolean; reason?: string }
          setAvailable(data.available)
          setAvailReason(data.reason ?? '')
        } finally { setChecking(false) }
      })()
    }, 500)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [username, formatOk])
  /* eslint-enable react/set-state-in-effect */

  const handleSendOtp = async () => {
    if (!email.trim()) return
    setLoading(true)
    const { error } = await sendOtp(email.trim().toLowerCase())
    if (error) { toast.error(error) } else { toast.success('Code sent — check your inbox'); setStep('otp') }
    setLoading(false)
  }

  const handleVerifyOtp = async () => {
    if (otp.length < 6) return
    setLoading(true)
    try {
      const { verified, userId: uid, existingUsername, error } = await verifyOtp(email.trim().toLowerCase(), otp.trim())
      if (!verified || error) throw new Error(error ?? 'Verification failed')
      if (!uid) throw new Error('No user ID returned')
      setUserId(uid)
      if (existingUsername) {
        // Returning user — skip username step, go straight to wallet
        setStep('wallet')
        const { walletId, address, token, username: confirmedUsername } = await getOrCreateWallet(uid, existingUsername)
        saveSession(uid, confirmedUsername, walletId, address, email.trim().toLowerCase(), token)
        onAuth(uid, confirmedUsername, walletId, address, email.trim().toLowerCase())
      } else {
        // New user — show username picker
        const suggested = email.split('@')[0].replace(/[^a-z0-9_]/gi, '').toLowerCase().slice(0, 20)
        setUsername(suggested)
        setStep('username')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Verification failed')
    }
    setLoading(false)
  }

  const handleChooseUsername = async () => {
    if (!username || !formatOk || available === false) return
    setLoading(true)
    setStep('wallet')
    try {
      const { walletId, address, token, username: confirmedUsername } = await getOrCreateWallet(userId, username)
      saveSession(userId, confirmedUsername, walletId, address, email.trim().toLowerCase(), token)
      onAuth(userId, confirmedUsername, walletId, address, email.trim().toLowerCase())
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Wallet creation failed')
      setStep('username')
    }
    setLoading(false)
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '14px 16px', borderRadius: '14px',
    background: '#fff', border: '1.5px solid var(--border-strong)',
    color: 'var(--t1)', fontSize: '16px', outline: 'none', fontFamily: 'Geist, sans-serif',
    transition: 'border-color .2s', boxSizing: 'border-box',
  }
  const btnStyle = (disabled: boolean): React.CSSProperties => ({
    width: '100%', height: '52px', borderRadius: '16px',
    background: disabled ? 'rgba(255,255,255,.08)' : 'var(--acc, var(--acc))',
    border: 'none', color: disabled ? 'var(--t3)' : 'var(--accent-fg)',
    fontWeight: 700, fontSize: '15px', cursor: disabled ? 'not-allowed' : 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
    transition: 'all .2s', fontFamily: 'Geist, sans-serif',
  })

  return (
    <div style={{
      minHeight: '100dvh', background: 'var(--bg)', display: 'flex',
      flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '24px', fontFamily: 'Geist, sans-serif',
    }}>
      {/* Logo */}
      <div style={{ marginBottom: '32px', textAlign: 'center' }}>
        <div style={{
          width: '64px', height: '64px', borderRadius: '20px',
          background: 'linear-gradient(135deg,#cde3f0,#DCEBF5)',
          border: '1.5px solid rgba(232,255,31,.25)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 16px', boxShadow: '0 0 32px rgba(232,255,31,.08)',
        }}>
          <Fingerprint style={{ width: '32px', height: '32px', color: 'var(--acc)' }} />
        </div>
        <h1 style={{ margin: 0, fontSize: '28px', fontWeight: 700, letterSpacing: '-.03em', color: 'var(--t1)' }}>Kasa</h1>
        <p style={{ margin: '4px 0 0', fontSize: '14px', color: 'var(--t3)' }}>Your onchain treasury</p>
      </div>

      {/* Card */}
      <div style={{
        width: '100%', maxWidth: '380px',
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: '24px', padding: '28px 24px',
        boxShadow: '0 1px 3px rgba(13,21,38,.06), 0 4px 16px rgba(13,21,38,.05)',
      }}>

        {/* ── Email step ── */}
        {step === 'email' && (
          <>
            <h2 style={{ margin: '0 0 6px', fontSize: '18px', fontWeight: 700, color: 'var(--t1)' }}>Sign in or create account</h2>
            <p style={{ margin: '0 0 20px', fontSize: '13px', color: 'var(--t3)' }}>We'll send a one-time code to your email.</p>
            <div style={{ position: 'relative', marginBottom: '16px' }}>
              <Mail style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', width: 16, height: 16, color: 'var(--t3)' }} />
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void handleSendOtp() }}
                placeholder="you@email.com" autoFocus style={{ ...inputStyle, paddingLeft: '40px' }} />
            </div>
            <button onClick={() => void handleSendOtp()} disabled={loading || !email.trim()} style={btnStyle(loading || !email.trim())}>
              {loading ? <Loader2 style={{ width: 16, height: 16, animation: 'spin 1s linear infinite' }} /> : <><ArrowRight style={{ width: 16, height: 16 }} />Send code</>}
            </button>
          </>
        )}

        {/* ── OTP step ── */}
        {step === 'otp' && (
          <>
            <h2 style={{ margin: '0 0 6px', fontSize: '18px', fontWeight: 700, color: 'var(--t1)' }}>Enter your code</h2>
            <p style={{ margin: '0 0 20px', fontSize: '13px', color: 'var(--t3)' }}>Sent to <strong style={{ color: 'var(--t1)' }}>{email}</strong></p>
            <input type="text" inputMode="numeric" maxLength={6} value={otp}
              onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={e => { if (e.key === 'Enter') void handleVerifyOtp() }}
              placeholder="000000" autoFocus
              style={{ ...inputStyle, textAlign: 'center', fontSize: '28px', letterSpacing: '12px', fontWeight: 700, marginBottom: '16px' }} />
            <button onClick={() => void handleVerifyOtp()} disabled={loading || otp.length < 6} style={btnStyle(loading || otp.length < 6)}>
              {loading ? <Loader2 style={{ width: 16, height: 16, animation: 'spin 1s linear infinite' }} /> : <><ArrowRight style={{ width: 16, height: 16 }} />Verify code</>}
            </button>
            <button onClick={() => setStep('email')} style={{ marginTop: '12px', width: '100%', background: 'transparent', border: 'none', color: 'var(--t3)', fontSize: '13px', cursor: 'pointer', padding: '8px' }}>
              Use a different email
            </button>
          </>
        )}

        {/* ── Username step ── */}
        {step === 'username' && (
          <>
            <h2 style={{ margin: '0 0 6px', fontSize: '18px', fontWeight: 700, color: 'var(--t1)' }}>Choose your username</h2>
            <p style={{ margin: '0 0 20px', fontSize: '13px', color: 'var(--t3)' }}>
              This is your Kasa handle — others can send you money at <span style={{ color: 'var(--acc)' }}>@{username || 'you'}</span>
            </p>
            <div style={{ position: 'relative', marginBottom: '8px' }}>
              <AtSign style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', width: 16, height: 16, color: 'var(--t3)' }} />
              <input type="text" value={username}
                onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20))}
                onKeyDown={e => { if (e.key === 'Enter' && available) void handleChooseUsername() }}
                placeholder="yourname" autoFocus
                style={{
                  ...inputStyle, paddingLeft: '40px', paddingRight: '40px',
                  borderColor: available === true ? 'var(--success)' : available === false ? 'var(--danger)' : 'var(--border-strong)',
                }} />
              <div style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)' }}>
                {checking && <Loader2 style={{ width: 15, height: 15, color: 'var(--t3)', animation: 'spin 1s linear infinite' }} />}
                {!checking && available === true && <CheckCircle2 style={{ width: 15, height: 15, color: 'var(--success)' }} />}
                {!checking && available === false && <XCircle style={{ width: 15, height: 15, color: 'var(--danger)' }} />}
              </div>
            </div>
            <div style={{ minHeight: '20px', marginBottom: '16px' }}>
              {available === true && <p style={{ margin: 0, fontSize: '12px', color: 'var(--success)' }}>@{username} is available</p>}
              {available === false && availReason && <p style={{ margin: 0, fontSize: '12px', color: 'var(--danger)' }}>{availReason}</p>}
              {username && !formatOk && <p style={{ margin: 0, fontSize: '12px', color: 'var(--danger)' }}>3–20 chars, letters/numbers/underscore only</p>}
              {!username && <p style={{ margin: 0, fontSize: '12px', color: 'var(--t3)' }}>3–20 characters, letters/numbers/underscore</p>}
            </div>
            <button onClick={() => void handleChooseUsername()} disabled={loading || !formatOk || available === false} style={btnStyle(loading || !formatOk || available === false)}>
              {loading ? <Loader2 style={{ width: 16, height: 16, animation: 'spin 1s linear infinite' }} /> : <><ArrowRight style={{ width: 16, height: 16 }} />Continue</>}
            </button>
          </>
        )}

        {/* ── Wallet creation step ── */}
        {step === 'wallet' && (
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <Loader2 style={{ width: '32px', height: '32px', color: 'var(--acc)', animation: 'spin 1s linear infinite', margin: '0 auto 16px' }} />
            <p style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--t1)' }}>Setting up your wallet…</p>
            <p style={{ margin: '6px 0 0', fontSize: '13px', color: 'var(--t3)' }}>Registering @{username} onchain</p>
          </div>
        )}

      </div>

      <p style={{ marginTop: '24px', fontSize: '12px', color: 'rgba(255,255,255,.2)' }}>
        Arc Testnet · Funds have no real-world value
      </p>
    </div>
  )
}
