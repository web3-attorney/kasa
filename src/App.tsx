import { useState, useCallback } from 'react'
import {
  Wallet, ArrowUpRight, ArrowLeftRight, PiggyBank,
  Clock, Link, Shield, History, LogOut, Zap, Fingerprint, ExternalLink, Users,
} from 'lucide-react'

import AuthScreen from './components/AuthScreen'
import WalletDashboard from './components/WalletDashboard'
import InternalSend from './components/InternalSend'
import FxRouter from './components/FxRouter'
import AutoSave from './components/AutoSave'
import ScheduledPayments from './components/ScheduledPayments'
import PaymentRequest from './components/PaymentRequest'
import SpendingLimits from './components/SpendingLimits'
import TransactionHistory from './components/TransactionHistory'
import NotificationBell from './components/NotificationBell'
import Contacts from './components/Contacts'
import { loadSession, clearSession } from './kasaWallet'

interface KasaSession {
  userId: string; username: string; walletId: string; address: string; email: string
}

type Tab = 'home' | 'send' | 'fx' | 'save' | 'history' | 'more'
type MoreTab = 'schedule' | 'paylink' | 'limits' | 'contacts'

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'home',    label: 'Home',    icon: <Wallet         style={{ width: 16, height: 16 }} /> },
  { id: 'send',    label: 'Send',    icon: <ArrowUpRight   style={{ width: 16, height: 16 }} /> },
  { id: 'fx',      label: 'FX',      icon: <ArrowLeftRight style={{ width: 16, height: 16 }} /> },
  { id: 'save',    label: 'Save',    icon: <PiggyBank      style={{ width: 16, height: 16 }} /> },
  { id: 'history', label: 'History', icon: <History        style={{ width: 16, height: 16 }} /> },
  { id: 'more',    label: 'More',    icon: <Shield         style={{ width: 16, height: 16 }} /> },
]

const MORE_TABS: { id: MoreTab; label: string; sub: string; icon: React.ReactNode }[] = [
  { id: 'schedule', label: 'Scheduled',   sub: 'Recurring payments',    icon: <Clock   style={{ width: 18, height: 18 }} /> },
  { id: 'paylink',  label: 'Pay Link',    sub: 'Request money',         icon: <Link    style={{ width: 18, height: 18 }} /> },
  { id: 'limits',   label: 'Limits',      sub: 'Daily spend cap',       icon: <Shield  style={{ width: 18, height: 18 }} /> },
  { id: 'contacts', label: 'Contacts',   sub: 'Saved wallets',          icon: <Users   style={{ width: 18, height: 18 }} /> },
]

export default function App() {
  const [session, setSession]   = useState<KasaSession | null>(() => loadSession())
  const [tab, setTab]           = useState<Tab>('home')
  const [moreTab, setMoreTab]   = useState<MoreTab>('schedule')
  const [historyKey, setHistoryKey] = useState(0)
  const [showDev, setShowDev]       = useState(false)

  const handleAuth = (userId: string, username: string, walletId: string, address: string, email: string) => {
    setSession({ userId, username, walletId, address, email })
  }

  const handleNewTx = useCallback(() => { setHistoryKey(k => k + 1) }, [])

  const handleSignOut = () => { clearSession(); setSession(null); setTab('home') }

  if (!session) return <AuthScreen onAuth={handleAuth} />

  const card: React.CSSProperties = {
    position: 'relative', borderRadius: '24px', overflow: 'hidden',
    background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.10)',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,.08)',
  }

  const renderMoreTab = () => {
    switch (moreTab) {
      case 'schedule':
        return (
          <div style={{ ...card, padding: '22px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '18px' }}>
              <Clock style={{ width: '18px', height: '18px', color: '#E8FF1F' }} />
              <span style={{ fontSize: '16px', fontWeight: 700, color: '#fff' }}>Scheduled Payments</span>
            </div>
            <ScheduledPayments walletId={session.walletId} />
          </div>
        )
      case 'paylink':
        return (
          <div style={{ ...card, padding: '22px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '18px' }}>
              <Link style={{ width: '18px', height: '18px', color: '#E8FF1F' }} />
              <span style={{ fontSize: '16px', fontWeight: 700, color: '#fff' }}>Payment Link</span>
              <span style={{ fontSize: '12px', color: 'rgba(255,255,255,.4)', marginLeft: '4px' }}>Request USDC from anyone</span>
            </div>
            <PaymentRequest walletId={session.walletId} walletAddress={session.address} username={session.username} />
          </div>
        )
      case 'limits':
        return (
          <div style={{ ...card, padding: '22px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '18px' }}>
              <Shield style={{ width: '18px', height: '18px', color: '#E8FF1F' }} />
              <span style={{ fontSize: '16px', fontWeight: 700, color: '#fff' }}>Spending Limits</span>
            </div>
            <SpendingLimits walletId={session.walletId} />
          </div>
        )
      case 'contacts':
        return (
          <div style={{ ...card, padding: '22px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '18px' }}>
              <Users style={{ width: '18px', height: '18px', color: '#E8FF1F' }} />
              <span style={{ fontSize: '16px', fontWeight: 700, color: '#fff' }}>Contacts</span>
              <span style={{ fontSize: '12px', color: 'rgba(255,255,255,.4)', marginLeft: '4px' }}>Saved wallets</span>
            </div>
            <Contacts walletId={session.walletId} />
          </div>
        )
    }
  }

  const renderTab = () => {
    switch (tab) {
      case 'home':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <WalletDashboard walletId={session.walletId} walletAddress={session.address} username={session.username} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              {[
                { label: 'Send USDC',   sub: 'Pay anyone instantly',    tab: 'send' as Tab,    icon: <ArrowUpRight   style={{ width: 20, height: 20 }} /> },
                { label: 'Pay Link',    sub: 'Request money',           tab: 'more' as Tab,    icon: <Link           style={{ width: 20, height: 20 }} />, more: 'paylink' as MoreTab },
                { label: 'Auto-Save',   sub: 'Set % rules',             tab: 'save' as Tab,    icon: <PiggyBank      style={{ width: 20, height: 20 }} /> },
                { label: 'Scheduled',   sub: 'Recurring payments',      tab: 'more' as Tab,    icon: <Clock          style={{ width: 20, height: 20 }} />, more: 'schedule' as MoreTab },
                { label: 'FX Route',    sub: 'USDC ↔ EURC',             tab: 'fx' as Tab,      icon: <ArrowLeftRight style={{ width: 20, height: 20 }} /> },
                { label: 'History',     sub: 'All transactions',        tab: 'history' as Tab, icon: <History        style={{ width: 20, height: 20 }} /> },
              ].map(tile => (
                <button key={tile.label} onClick={() => { setTab(tile.tab); if (tile.more) setMoreTab(tile.more) }}
                  style={{ ...card, padding: '16px', cursor: 'pointer', border: 'none', textAlign: 'left', transition: 'background .2s' }}>
                  <div style={{ color: '#E8FF1F', marginBottom: '8px' }}>{tile.icon}</div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#fff' }}>{tile.label}</div>
                  <div style={{ fontSize: '11px', color: 'rgba(255,255,255,.4)', marginTop: '2px' }}>{tile.sub}</div>
                </button>
              ))}
            </div>
            <div style={{ ...card, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Zap style={{ width: '16px', height: '16px', color: '#E8FF1F', flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: '12px', fontWeight: 600, color: '#fff' }}>x402 Payment Gate</div>
                <div style={{ fontSize: '11px', color: 'rgba(255,255,255,.4)' }}>Active — $0.01 USDC per agent call</div>
              </div>
              <div style={{ marginLeft: 'auto', width: '8px', height: '8px', borderRadius: '50%', background: '#22c55e' }} />
            </div>
          </div>
        )
      case 'send':
        return (
          <div style={{ ...card, padding: '22px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '18px' }}>
              <ArrowUpRight style={{ width: '18px', height: '18px', color: '#E8FF1F' }} />
              <span style={{ fontSize: '16px', fontWeight: 700, color: '#fff' }}>Send USDC</span>
              <span style={{ fontSize: '12px', color: 'rgba(255,255,255,.4)', marginLeft: '4px' }}>To any @username or address · with memo</span>
            </div>
            <InternalSend walletId={session.walletId} walletAddress={session.address} email={session.email} />
          </div>
        )
      case 'fx':
        return (
          <div style={{ ...card, padding: '22px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '18px' }}>
              <ArrowLeftRight style={{ width: '18px', height: '18px', color: '#E8FF1F' }} />
              <span style={{ fontSize: '16px', fontWeight: 700, color: '#fff' }}>FX Payment Router</span>
            </div>
            <FxRouter walletId={session.walletId} walletAddress={session.address} />
          </div>
        )
      case 'save':
        return (
          <div style={{ ...card, padding: '22px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '18px' }}>
              <PiggyBank style={{ width: '18px', height: '18px', color: '#E8FF1F' }} />
              <span style={{ fontSize: '16px', fontWeight: 700, color: '#fff' }}>Auto-Save</span>
            </div>
            <AutoSave walletId={session.walletId} walletAddress={session.address} />
          </div>
        )
      case 'history':
        return (
          <div style={{ ...card, padding: '22px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '18px' }}>
              <History style={{ width: '18px', height: '18px', color: '#E8FF1F' }} />
              <span style={{ fontSize: '16px', fontWeight: 700, color: '#fff' }}>Transaction History</span>
            </div>
            <TransactionHistory walletId={session.walletId} walletAddress={session.address} refreshKey={historyKey} />
          </div>
        )
      case 'more':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* Sub-nav */}
            <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '2px' }}>
              {MORE_TABS.map(t => (
                <button key={t.id} onClick={() => setMoreTab(t.id)}
                  style={{ flexShrink: 0, height: '34px', padding: '0 14px', borderRadius: '10px', border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: 600, transition: 'all .15s',
                    background: moreTab === t.id ? 'var(--acc)' : 'rgba(255,255,255,.08)',
                    color: moreTab === t.id ? '#0b0b0c' : 'rgba(255,255,255,.6)' }}>
                  {t.label}
                </button>
              ))}
            </div>
            {renderMoreTab()}
            {/* Developer section — hidden by default */}
            <div style={{ marginTop: '8px', borderTop: '1px solid rgba(255,255,255,.06)', paddingTop: '12px' }}>
              <button onClick={() => setShowDev(v => !v)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '11px', color: 'rgba(255,255,255,.2)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Zap style={{ width: '11px', height: '11px' }} />
                {showDev ? 'Hide developer tools' : 'Developer'}
              </button>
              {showDev && (
                <div style={{ ...card, padding: '22px', marginTop: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                    <Fingerprint style={{ width: '18px', height: '18px', color: '#E8FF1F' }} />
                    <span style={{ fontSize: '16px', fontWeight: 700, color: '#fff' }}>Agent Identity</span>
                    <span style={{ fontSize: '11px', color: 'rgba(255,255,255,.3)', marginLeft: '4px' }}>ERC-8004</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {([
                      ['AGENT NAME', 'Kasa'],
                      ['USERNAME', `@${session.username}`],
                      ['WALLET', session.address],
                      ['STANDARD', 'ERC-8004 · x402 Payment Gate'],
                    ] as [string, string][]).map(([label, val]) => (
                      <div key={label} style={{ padding: '12px 14px', borderRadius: '14px', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)' }}>
                        <div style={{ fontSize: '11px', color: 'rgba(255,255,255,.4)', marginBottom: '4px' }}>{label}</div>
                        <div style={{ fontSize: label === 'WALLET' ? '11px' : '14px', fontWeight: 600, color: label === 'STANDARD' ? 'var(--acc)' : '#fff', fontFamily: label === 'WALLET' ? 'monospace' : undefined, wordBreak: 'break-all' }}>{val}</div>
                      </div>
                    ))}
                    <a href="/api/agent.json" target="_blank" rel="noopener noreferrer"
                      style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '12px 14px', borderRadius: '14px', background: 'rgba(232,255,31,.06)', border: '1px solid rgba(232,255,31,.15)', color: '#E8FF1F', fontSize: '13px', fontWeight: 600, textDecoration: 'none' }}>
                      <ExternalLink style={{ width: '13px', height: '13px' }} /> View Agent Card
                    </a>
                  </div>
                </div>
              )}
            </div>
          </div>
        )
      default: return null
    }
  }

  return (
    <div style={{ minHeight: '100dvh', background: '#0b0b0c', fontFamily: 'Geist, sans-serif', display: 'flex', flexDirection: 'column', maxWidth: '480px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ padding: '16px 20px 0', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{ width: '36px', height: '36px', borderRadius: '12px', background: 'rgba(232,255,31,.12)', border: '1px solid rgba(232,255,31,.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Fingerprint style={{ width: '18px', height: '18px', color: '#E8FF1F' }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '16px', fontWeight: 700, color: '#fff', letterSpacing: '-.02em' }}>Kasa</div>
          <div style={{ fontSize: '11px', color: 'rgba(255,255,255,.4)' }}>@{session.username}</div>
        </div>
        <NotificationBell walletId={session.walletId} onNewTx={handleNewTx} />
        <button onClick={() => window.open('/api/agent.json', '_blank')} title="x402 active"
          style={{ display: 'flex', alignItems: 'center', gap: '4px', height: '28px', padding: '0 10px', borderRadius: '8px', background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)', color: 'rgba(255,255,255,.6)', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>
          <Zap style={{ width: '11px', height: '11px', color: '#E8FF1F' }} /> x402
        </button>
        <button onClick={handleSignOut}
          style={{ display: 'flex', alignItems: 'center', gap: '4px', height: '28px', padding: '0 10px', borderRadius: '8px', background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)', color: 'rgba(255,255,255,.4)', fontSize: '11px', cursor: 'pointer' }}>
          <LogOut style={{ width: '11px', height: '11px' }} />
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, padding: '16px 16px 80px', overflowY: 'auto' }}>
        {renderTab()}
      </div>

      {/* Bottom nav */}
      <div style={{ position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: '480px', background: 'rgba(11,11,12,.92)', borderTop: '1px solid rgba(255,255,255,.08)', backdropFilter: 'blur(20px)', display: 'flex', zIndex: 50 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ flex: 1, padding: '10px 4px 12px', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', color: tab === t.id ? '#E8FF1F' : 'rgba(255,255,255,.35)', transition: 'color .2s' }}>
            {t.icon}
            <span style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '.02em' }}>{t.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
