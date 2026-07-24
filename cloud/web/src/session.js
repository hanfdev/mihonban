const SIGNED_OUT = Object.freeze({ ok: false, role: null, guest: false })

export async function sessionAfterLogout(client) {
  try {
    await client.logout()
    const session = await client.me()
    if (session?.ok && (session.role === 'user' || session.role === 'admin')) {
      return {
        ok: true,
        role: session.role,
        guest: session.guest === true,
      }
    }
  } catch { /* a failed logout cannot be treated as guest access */ }
  return SIGNED_OUT
}
