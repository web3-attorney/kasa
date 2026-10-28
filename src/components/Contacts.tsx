/**
 * Contacts — address book. Save wallet addresses with friendly names.
 * Accessible from the More tab and as a picker inside InternalSend.
 */
import { useState, useEffect, useCallback } from 'react'
import { UserPlus, Trash2, Edit3, Check, X, Copy, Users } from 'lucide-react'
import { apiFetch } from '@/kasaWallet'
import { isAddress } from 'viem'
import { toast } from 'sonner'

export interface Contact {
  id: string
  name: string
  address: string
  memo?: string
  createdAt: number
}

interface Props {
  walletId?: string
  /** If provided, renders as a compact picker — tapping a contact calls onSelect */
  pickerMode?: boolean
  onSelect?: (contact: Contact) => void
}

const card: React.CSSProperties = {
  padding: '14px 16px', borderRadius: '16px',
  background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)',
}

export default function Contacts({ walletId, pickerMode, onSelect }: Props) {
  const [list, setList]           = useState<Contact[]>([])
  const [loading, setLoading]     = useState(false)
  const [showAdd, setShowAdd]     = useState(false)
  const [editId, setEditId]       = useState<string | null>(null)

  // add form
  const [newName, setNewName]     = useState('')
  const [newAddr, setNewAddr]     = useState('')
  const [newMemo, setNewMemo]     = useState('')
  const [adding, setAdding]       = useState(false)

  // edit form
  const [editName, setEditName]   = useState('')
  const [editMemo, setEditMemo]   = useState('')

  const load = useCallback(async () => {
    if (!walletId) return
    setLoading(true)
    try {
      const res = await apiFetch(`/api/contacts?walletId=${encodeURIComponent(walletId)}`)
      if (res.ok) setList(await res.json() as Contact[])
    } finally { setLoading(false) }
  }, [walletId])

  // eslint-disable-next-line react/set-state-in-effect
  useEffect(() => { void load() }, [load])

  const handleAdd = async () => {
    if (!walletId || !newName.trim() || !isAddress(newAddr.trim())) return
    setAdding(true)
    try {
      const res = await apiFetch('/api/contacts', {
        method: 'POST',
        body: JSON.stringify({ walletId, name: newName.trim(), address: newAddr.trim(), memo: newMemo.trim() }),
      })
      const data = await res.json() as Contact & { error?: string }
      if (!res.ok) { toast.error(data.error ?? 'Failed to save'); return }
      setList(prev => [data, ...prev])
      setNewName(''); setNewAddr(''); setNewMemo(''); setShowAdd(false)
      toast.success(`${data.name} saved`)
    } finally { setAdding(false) }
  }

  const handleDelete = async (id: string, name: string) => {
    if (!walletId) return
    const res = await apiFetch(`/api/contacts/${id}`, {
      method: 'DELETE',
      body: JSON.stringify({ walletId }),
    })
    if (res.ok) {
      setList(prev => prev.filter(c => c.id !== id))
      toast.success(`${name} removed`)
    }
  }

  const handleEdit = async (id: string) => {
    if (!walletId || !editName.trim()) return
    const res = await apiFetch(`/api/contacts/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ walletId, name: editName.trim(), memo: editMemo.trim() }),
    })
    if (res.ok) {
      setList(prev => prev.map(c => c.id === id ? { ...c, name: editName.trim(), memo: editMemo.trim() } : c))
      setEditId(null)
      toast.success('Contact updated')
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 12px', borderRadius: '10px',
    background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
    color: '#fff', fontSize: '14px', outline: 'none', boxSizing: 'border-box',
  }

  const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>

      {/* Header */}
      {!pickerMode && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Users style={{ width: 15, height: 15, color: '#E8FF1F' }} />
            <p style={{ margin: 0, fontSize: '11px', fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'rgba(255,255,255,.35)' }}>
              {list.length} contact{list.length !== 1 ? 's' : ''}
            </p>
          </div>
          <button onClick={() => setShowAdd(v => !v)}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', borderRadius: '10px', background: showAdd ? 'rgba(232,255,31,.15)' : 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)', color: showAdd ? '#E8FF1F' : '#fff', fontSize: '12px', cursor: 'pointer' }}>
            <UserPlus style={{ width: 13, height: 13 }} />
            Add contact
          </button>
        </div>
      )}

      {pickerMode && (
        <p style={{ margin: '0 0 4px', fontSize: '11px', fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'rgba(255,255,255,.35)' }}>
          Saved contacts
        </p>
      )}

      {/* Add form */}
      {showAdd && !pickerMode && (
        <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: '8px', borderColor: 'rgba(232,255,31,.2)' }}>
          <input style={inputStyle} placeholder="Name (e.g. Alice)" value={newName} onChange={e => setNewName(e.target.value)} />
          <input style={{ ...inputStyle, borderColor: newAddr && !isAddress(newAddr) ? 'rgba(239,68,68,.5)' : 'rgba(255,255,255,.1)' }}
            placeholder="0x wallet address" value={newAddr} onChange={e => setNewAddr(e.target.value)} />
          <input style={inputStyle} placeholder="Note (optional)" value={newMemo} onChange={e => setNewMemo(e.target.value)} />
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => void handleAdd()} disabled={adding || !newName.trim() || !isAddress(newAddr.trim())}
              style={{ flex: 1, padding: '10px', borderRadius: '10px', background: '#E8FF1F', color: '#0b0b0c', fontSize: '13px', fontWeight: 700, border: 'none', cursor: adding ? 'wait' : 'pointer', opacity: !newName.trim() || !isAddress(newAddr.trim()) ? 0.4 : 1 }}>
              {adding ? 'Saving…' : 'Save contact'}
            </button>
            <button onClick={() => setShowAdd(false)}
              style={{ padding: '10px 14px', borderRadius: '10px', background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)', color: 'rgba(255,255,255,.5)', fontSize: '13px', cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Contact list */}
      {loading && <p style={{ margin: 0, fontSize: '13px', color: 'rgba(255,255,255,.3)', textAlign: 'center', padding: '20px' }}>Loading…</p>}

      {!loading && list.length === 0 && (
        <div style={{ ...card, textAlign: 'center', padding: '28px 16px' }}>
          <Users style={{ width: 28, height: 28, color: 'rgba(255,255,255,.15)', margin: '0 auto 10px' }} />
          <p style={{ margin: 0, fontSize: '13px', color: 'rgba(255,255,255,.3)' }}>
            {pickerMode ? 'No contacts saved yet' : 'No contacts yet — add one above'}
          </p>
        </div>
      )}

      {list.map(c => (
        <div key={c.id} style={{ ...card, cursor: pickerMode ? 'pointer' : 'default' }}
          onClick={() => pickerMode && onSelect?.(c)}>

          {editId === c.id && !pickerMode ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <input style={inputStyle} value={editName} onChange={e => setEditName(e.target.value)} placeholder="Name" />
              <input style={inputStyle} value={editMemo} onChange={e => setEditMemo(e.target.value)} placeholder="Note (optional)" />
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={() => void handleEdit(c.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '7px 14px', borderRadius: '8px', background: '#E8FF1F', color: '#0b0b0c', fontSize: '12px', fontWeight: 700, border: 'none', cursor: 'pointer' }}>
                  <Check style={{ width: 12, height: 12 }} /> Save
                </button>
                <button onClick={() => setEditId(null)}
                  style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '7px 14px', borderRadius: '8px', background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)', color: 'rgba(255,255,255,.5)', fontSize: '12px', cursor: 'pointer' }}>
                  <X style={{ width: 12, height: 12 }} /> Cancel
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
              {/* Avatar + info */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'rgba(232,255,31,.15)', border: '1px solid rgba(232,255,31,.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: '15px', fontWeight: 700, color: '#E8FF1F' }}>
                  {c.name.charAt(0).toUpperCase()}
                </div>
                <div style={{ minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</p>
                  <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'rgba(255,255,255,.4)', fontFamily: 'monospace' }}>{shortAddr(c.address)}</p>
                  {c.memo && <p style={{ margin: '2px 0 0', fontSize: '11px', color: 'rgba(255,255,255,.3)' }}>{c.memo}</p>}
                </div>
              </div>

              {/* Actions */}
              {!pickerMode && (
                <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                  <button title="Copy address" onClick={e => { e.stopPropagation(); void navigator.clipboard.writeText(c.address); toast.success('Copied') }}
                    style={{ padding: '7px', borderRadius: '8px', background: 'transparent', border: '1px solid rgba(255,255,255,.08)', color: 'rgba(255,255,255,.4)', cursor: 'pointer' }}>
                    <Copy style={{ width: 13, height: 13 }} />
                  </button>
                  <button title="Edit" onClick={() => { setEditId(c.id); setEditName(c.name); setEditMemo(c.memo ?? '') }}
                    style={{ padding: '7px', borderRadius: '8px', background: 'transparent', border: '1px solid rgba(255,255,255,.08)', color: 'rgba(255,255,255,.4)', cursor: 'pointer' }}>
                    <Edit3 style={{ width: 13, height: 13 }} />
                  </button>
                  <button title="Delete" onClick={() => void handleDelete(c.id, c.name)}
                    style={{ padding: '7px', borderRadius: '8px', background: 'transparent', border: '1px solid rgba(239,68,68,.2)', color: 'rgba(239,68,68,.6)', cursor: 'pointer' }}>
                    <Trash2 style={{ width: 13, height: 13 }} />
                  </button>
                </div>
              )}

              {pickerMode && (
                <div style={{ padding: '5px 12px', borderRadius: '8px', background: 'rgba(232,255,31,.1)', border: '1px solid rgba(232,255,31,.2)', fontSize: '12px', color: '#E8FF1F', flexShrink: 0 }}>
                  Send
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
