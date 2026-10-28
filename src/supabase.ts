/**
 * Auth helpers — Resend-powered email OTP via Kasa server.
 * No Supabase dependency.
 */

export async function sendOtp(email: string): Promise<{ error: string | null }> {
  const res = await fetch('/api/auth/send-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  if (!res.ok) {
    const data = (await res.json()) as { error?: string }
    return { error: data.error ?? 'Failed to send code' }
  }
  return { error: null }
}

export async function verifyOtp(
  email: string,
  token: string,
): Promise<{ verified: boolean; userId: string | null; existingUsername: string | null; error: string | null }> {
  const res = await fetch('/api/auth/verify-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code: token }),
  })
  if (!res.ok) {
    const data = (await res.json()) as { error?: string }
    return { verified: false, userId: null, existingUsername: null, error: data.error ?? 'Verification failed' }
  }
  const data = (await res.json()) as { userId: string; existingUsername: string | null }
  return { verified: true, userId: data.userId, existingUsername: data.existingUsername ?? null, error: null }
}
