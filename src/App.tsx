import { useState, useCallback } from 'react'
import {
  Wallet, ArrowUpRight, ArrowLeftRight, PiggyBank,
  Clock, Link, Shield, History, LogOut, Zap, Fingerprint, ExternalLink, Users,
} from 'lucide-react'
import LiquidNavbar, { type LiquidNavItem } from './components/ui/liquid-glass-navbar'
import LiquidTile from './components/ui/liquid-tile'

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

const TABS: Tab[] = ['home', 'send', 'fx', 'save', 'history', 'more']

const NAV_ITEMS: LiquidNavItem[] = [
  { label: 'Home',    fx: 'glow',  icon: <Wallet         width={18} height={18} /> },
  { label: 'Send',    fx: 'plane', icon: <ArrowUpRight   width={18} height={18} /> },
  { label: 'FX',      fx: 'spin',  icon: <ArrowLeftRight width={18} height={18} /> },
  { label: 'Save',    fx: 'drop',  icon: <PiggyBank      width={18} height={18} /> },
  { label: 'History', fx: 'wave',  icon: <History        width={18} height={18} /> },
  { label: 'More',    fx: 'pop',   icon: <Shield         width={18} height={18} /> },
]

const MORE_TABS: MoreTab[] = ['schedule', 'paylink', 'limits', 'contacts']

const MORE_NAV_ITEMS: LiquidNavItem[] = [
  { label: 'Scheduled', fx: 'glow', icon: <Clock  width={16} height={16} /> },
  { label: 'Pay Link',  fx: 'wave', icon: <Link   width={16} height={16} /> },
  { label: 'Limits',    fx: 'spin', icon: <Shield width={16} height={16} /> },
  { label: 'Contacts',  fx: 'pop',  icon: <Users  width={16} height={16} /> },
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
    background: 'var(--surface)', border: '1px solid var(--border)',
    boxShadow: '0 1px 3px rgba(13,21,38,.06), 0 4px 16px rgba(13,21,38,.05)',
  }

  const renderMoreTab = () => {
    switch (moreTab) {
      case 'schedule':
        return (
          <div style={{ ...card, padding: '22px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '18px' }}>
              <Clock style={{ width: '18px', height: '18px', color: 'var(--acc)' }} />
              <span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--t1)' }}>Scheduled Payments</span>
            </div>
            <ScheduledPayments walletId={session.walletId} />
          </div>
        )
      case 'paylink':
        return (
          <div style={{ ...card, padding: '22px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '18px' }}>
              <Link style={{ width: '18px', height: '18px', color: 'var(--acc)' }} />
              <span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--t1)' }}>Payment Link</span>
              <span style={{ fontSize: '12px', color: 'var(--t3)', marginLeft: '4px' }}>Request USDC from anyone</span>
            </div>
            <PaymentRequest walletId={session.walletId} walletAddress={session.address} username={session.username} />
          </div>
        )
      case 'limits':
        return (
          <div style={{ ...card, padding: '22px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '18px' }}>
              <Shield style={{ width: '18px', height: '18px', color: 'var(--acc)' }} />
              <span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--t1)' }}>Spending Limits</span>
            </div>
            <SpendingLimits walletId={session.walletId} />
          </div>
        )
      case 'contacts':
        return (
          <div style={{ ...card, padding: '22px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '18px' }}>
              <Users style={{ width: '18px', height: '18px', color: 'var(--acc)' }} />
              <span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--t1)' }}>Contacts</span>
              <span style={{ fontSize: '12px', color: 'var(--t3)', marginLeft: '4px' }}>Saved wallets</span>
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
                <LiquidTile key={tile.label}
                  onClick={() => { setTab(tile.tab); if (tile.more) setMoreTab(tile.more) }}
                  style={{ ...card, padding: '16px', textAlign: 'left', width: '100%' }}>
                  <div style={{ color: 'var(--acc)', marginBottom: '8px' }}>{tile.icon}</div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--t1)' }}>{tile.label}</div>
                  <div style={{ fontSize: '11px', color: 'var(--t3)', marginTop: '2px' }}>{tile.sub}</div>
                </LiquidTile>
              ))}
            </div>

          </div>
        )
      case 'send':
        return (
          <div style={{ ...card, padding: '22px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '18px' }}>
              <ArrowUpRight style={{ width: '18px', height: '18px', color: 'var(--acc)' }} />
              <span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--t1)' }}>Send USDC</span>
              <span style={{ fontSize: '12px', color: 'var(--t3)', marginLeft: '4px' }}>To any @username or address · with memo</span>
            </div>
            <InternalSend walletId={session.walletId} walletAddress={session.address} email={session.email} />
          </div>
        )
      case 'fx':
        return (
          <div style={{ ...card, padding: '22px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '18px' }}>
              <ArrowLeftRight style={{ width: '18px', height: '18px', color: 'var(--acc)' }} />
              <span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--t1)' }}>FX Payment Router</span>
            </div>
            <FxRouter walletId={session.walletId} walletAddress={session.address} />
          </div>
        )
      case 'save':
        return (
          <div style={{ ...card, padding: '22px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '18px' }}>
              <PiggyBank style={{ width: '18px', height: '18px', color: 'var(--acc)' }} />
              <span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--t1)' }}>Auto-Save</span>
            </div>
            <AutoSave walletId={session.walletId} walletAddress={session.address} />
          </div>
        )
      case 'history':
        return (
          <div style={{ ...card, padding: '22px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '18px' }}>
              <History style={{ width: '18px', height: '18px', color: 'var(--acc)' }} />
              <span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--t1)' }}>Transaction History</span>
            </div>
            <TransactionHistory walletId={session.walletId} walletAddress={session.address} refreshKey={historyKey} />
          </div>
        )
      case 'more':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* Sub-nav — Liquid Glass light tone */}
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <LiquidNavbar
                items={MORE_NAV_ITEMS}
                active={MORE_TABS.indexOf(moreTab)}
                onChange={(idx) => { setMoreTab(MORE_TABS[idx]) }}
                tone="light"
                style={{ width: '100%', justifyContent: 'space-between' }}
              />
            </div>
            {renderMoreTab()}
            {/* Developer section — hidden by default */}
            <div style={{ marginTop: '8px', borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
              <button onClick={() => setShowDev(v => !v)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '11px', color: 'var(--t3)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Zap style={{ width: '11px', height: '11px' }} />
                {showDev ? 'Hide developer tools' : 'Developer'}
              </button>
              {showDev && (
                <div style={{ ...card, padding: '22px', marginTop: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                    <Fingerprint style={{ width: '18px', height: '18px', color: 'var(--acc)' }} />
                    <span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--t1)' }}>Agent Identity</span>
                    <span style={{ fontSize: '11px', color: 'var(--t3)', marginLeft: '4px' }}>ERC-8004</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {([
                      ['AGENT NAME', 'Kasa'],
                      ['USERNAME', `@${session.username}`],
                      ['WALLET', session.address],
                      ['STANDARD', 'ERC-8004 · x402 Payment Gate'],
                    ] as [string, string][]).map(([label, val]) => (
                      <div key={label} style={{ padding: '12px 14px', borderRadius: '14px', background: 'rgba(11,19,43,.05)', border: '1px solid var(--border)' }}>
                        <div style={{ fontSize: '11px', color: 'var(--t3)', marginBottom: '4px' }}>{label}</div>
                        <div style={{ fontSize: label === 'WALLET' ? '11px' : '14px', fontWeight: 600, color: label === 'STANDARD' ? 'var(--acc)' : 'var(--t1)', fontFamily: label === 'WALLET' ? 'monospace' : undefined, wordBreak: 'break-all' }}>{val}</div>
                      </div>
                    ))}
                    <a href="/api/agent.json" target="_blank" rel="noopener noreferrer"
                      style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '12px 14px', borderRadius: '14px', background: 'rgba(108,99,255,.08)', border: '1px solid rgba(108,99,255,.2)', color: 'var(--acc)', fontSize: '13px', fontWeight: 600, textDecoration: 'none' }}>
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
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', fontFamily: 'Geist, sans-serif', display: 'flex', flexDirection: 'column', maxWidth: '480px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ padding: '16px 20px 0', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <img src="/logo.svg?v=3" alt="Kasa" style={{ width: '38px', height: '38px', flexShrink: 0, borderRadius: '10px' }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--t1)', letterSpacing: '-.02em' }}>Kasa</div>
          <div style={{ fontSize: '11px', color: 'var(--t3)' }}>@{session.username}</div>
        </div>
        <NotificationBell walletId={session.walletId} walletAddress={session.address} onNewTx={handleNewTx} />

        <button onClick={handleSignOut}
          style={{ display: 'flex', alignItems: 'center', gap: '4px', height: '28px', padding: '0 10px', borderRadius: '8px', background: 'rgba(255,255,255,.6)', border: '1px solid var(--border)', color: 'var(--t2)', fontSize: '11px', cursor: 'pointer' }}>
          <LogOut style={{ width: '11px', height: '11px' }} />
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, padding: '16px 16px 80px', overflowY: 'auto' }}>
        {renderTab()}
      </div>

      {/* Bottom nav — Liquid Glass light tone */}
      <div style={{ position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: '480px', display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '10px 12px 18px', background: '#DCEBF5', zIndex: 50 }}>
        <LiquidNavbar
          items={NAV_ITEMS}
          active={TABS.indexOf(tab)}
          onChange={(idx) => { setTab(TABS[idx]) }}
          tone="light"
          style={{ width: '100%', justifyContent: 'space-between' }}
        />
      </div>
    </div>
  )
}
