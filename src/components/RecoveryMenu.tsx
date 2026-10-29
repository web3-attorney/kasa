/**
 * RecoveryMenu — simple account info panel (passkeys removed).
 * Wallet is developer-controlled; no recovery phrase needed.
 */
import { Shield, Info } from 'lucide-react'

interface Props {
  address?: string
}

export default function RecoveryMenu({ address }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Shield style={{ width: '18px', height: '18px', color: 'var(--acc)' }} />
        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--t1)' }}>Security</h3>
      </div>
      <div style={{ padding: '14px', borderRadius: '14px', background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
        <div style={{ fontSize: '11px', color: 'var(--t3)', marginBottom: '4px' }}>WALLET ADDRESS</div>
        <div style={{ fontSize: '12px', fontFamily: 'monospace', color: 'var(--t1)', wordBreak: 'break-all' }}>{address ?? '—'}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '14px', borderRadius: '14px', background: 'rgba(232,255,31,.05)', border: '1px solid rgba(232,255,31,.12)' }}>
        <Info style={{ width: '15px', height: '15px', color: 'var(--acc)', flexShrink: 0, marginTop: '1px' }} />
        <p style={{ margin: 0, fontSize: '12px', color: 'var(--t2)', lineHeight: 1.6 }}>
          Your wallet is secured by Circle and managed by Kasa on your behalf. Transactions are signed server-side. To recover access, sign in again with your email — your wallet address will always be the same.
        </p>
      </div>
    </div>
  )
}
