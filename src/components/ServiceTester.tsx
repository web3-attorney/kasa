import { useState } from 'react'
import { Send, Loader2, AlertCircle, Terminal } from 'lucide-react'

interface ServiceTesterProps {
  /** When false the endpoint is unreachable (server not running) and we show a notice */
  serverReady: boolean
}

export default function ServiceTester({ serverReady }: ServiceTesterProps) {
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'paid' | 'unpaid' | 'error'>('idle')
  const [headers, setHeaders] = useState<Record<string, string>>({})

  const callService = async () => {
    if (!query.trim()) return
    setStatus('loading')
    setResult(null)
    setHeaders({})

    try {
      // First try without payment — should get 402
      const unpaid = await fetch('/api/agent-service', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim() }),
      })

      const responseHeaders: Record<string, string> = {}
      unpaid.headers.forEach((val, key) => { responseHeaders[key] = val })
      setHeaders(responseHeaders)

      if (unpaid.status === 402) {
        setStatus('unpaid')
        const body: unknown = await (unpaid.json() as Promise<unknown>).catch((): unknown => ({}))
        setResult(JSON.stringify({ status: 402, message: 'Payment required (x402)', body }, null, 2))
        return
      }

      if (!unpaid.ok) {
        setStatus('error')
        setResult(`HTTP ${unpaid.status}: ${unpaid.statusText}`)
        return
      }

      const data: unknown = await (unpaid.json() as Promise<unknown>)
      setStatus('paid')
      setResult(JSON.stringify(data, null, 2))
    } catch (e: unknown) {
      setStatus('error')
      setResult(e instanceof Error ? e.message : 'Network error — is the backend running?')
    }
  }

  const statusColors: Record<string, string> = {
    idle: '',
    loading: 'text-[var(--muted)]',
    paid: 'text-emerald-600',
    unpaid: 'text-amber-600',
    error: 'text-red-600',
  }

  const statusLabel: Record<string, string> = {
    idle: '',
    loading: 'Calling service…',
    paid: '200 OK — paid response',
    unpaid: '402 Payment Required',
    error: 'Error',
  }

  return (
    <div className="space-y-4">
      {!serverReady && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Backend server not detected</p>
            <p className="mt-0.5 text-amber-700">
              Run <code className="font-mono bg-amber-100 px-1 rounded">bun run server</code> in the terminal to start the paid API.
              The tester below will hit a 404 until it is up.
            </p>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <label className="text-xs font-semibold uppercase tracking-widest text-[var(--muted)]">
          Query
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void callService() }}
            placeholder="Ask the agent something…"
            className="flex-1 px-4 py-3 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] text-[var(--ink)] text-sm placeholder:text-[var(--subtle)] focus:outline-none focus:ring-2 focus:ring-[var(--focus)] focus:border-transparent transition-all"
            disabled={status === 'loading'}
          />
          <button
            onClick={() => void callService()}
            disabled={!query.trim() || status === 'loading'}
            className="h-12 px-5 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white font-semibold text-sm transition-colors disabled:opacity-50 flex items-center gap-2 shrink-0"
          >
            {status === 'loading' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {status !== 'idle' && status !== 'loading' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Terminal className="w-3.5 h-3.5 text-[var(--muted)]" />
            <span className={`text-xs font-semibold ${statusColors[status]}`}>
              {statusLabel[status]}
            </span>
          </div>

          {Object.keys(headers).some((k) => k.toLowerCase().startsWith('x-payment')) && (
            <div className="text-xs font-mono bg-[var(--surface-muted)] border border-[var(--border)] rounded-xl p-3 space-y-1 overflow-x-auto">
              {Object.entries(headers)
                .filter(([k]) => k.toLowerCase().startsWith('x-payment'))
                .map(([k, v]) => (
                  <div key={k}>
                    <span className="text-[var(--muted)]">{k}: </span>
                    <span className="text-[var(--ink-2)] break-all">{v}</span>
                  </div>
                ))}
            </div>
          )}

          {result && (
            <pre className="text-xs font-mono bg-[var(--surface-muted)] border border-[var(--border)] rounded-xl p-4 overflow-x-auto text-[var(--ink-2)] whitespace-pre-wrap break-all leading-relaxed">
              {result}
            </pre>
          )}
        </div>
      )}

      <p className="text-xs text-[var(--subtle)]">
        Without a Circle Gateway wallet the server returns a{' '}
        <code className="font-mono bg-[var(--surface-muted)] px-1 rounded">402 Payment Required</code>{' '}
        with x402 challenge headers. Pay with a Circle agent wallet (
        <code className="font-mono bg-[var(--surface-muted)] px-1 rounded">circle services pay</code>
        ) to receive a 200 response.
      </p>
    </div>
  )
}
