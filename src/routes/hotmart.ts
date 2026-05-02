import { Router } from 'express'
import { supabaseAdmin } from '../lib/supabase.js'
import { authenticate } from '../middleware/auth.js'

export const hotmartRouter = Router()

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseDateParam(
  q: Record<string, string>,
  userId: string,
): { since: string; until: string } {
  const now   = new Date()
  const tz    = parseInt(q['tz'] ?? '0', 10)
  const tzOff = isNaN(tz) ? 0 : tz
  const local = new Date(now.getTime() + tzOff * 3_600_000)

  const today    = local.toISOString().slice(0, 10)
  const date     = q['date']
  const sincePar = q['since']
  const untilPar = q['until']

  if (sincePar && untilPar) return { since: sincePar, until: untilPar }

  if (date === 'today')     return { since: today, until: today }
  if (date === 'yesterday') {
    const y = new Date(local.getTime() - 86_400_000).toISOString().slice(0, 10)
    return { since: y, until: y }
  }
  if (date === 'last_7d')  return { since: new Date(local.getTime() - 6  * 86_400_000).toISOString().slice(0, 10), until: today }
  if (date === 'last_14d') return { since: new Date(local.getTime() - 13 * 86_400_000).toISOString().slice(0, 10), until: today }
  if (date === 'this_month') {
    const f = new Date(local.getFullYear(), local.getMonth(), 1)
    return { since: f.toISOString().slice(0, 10), until: today }
  }
  if (date === 'last_month') {
    const f = new Date(local.getFullYear(), local.getMonth() - 1, 1)
    const l = new Date(local.getFullYear(), local.getMonth(), 0)
    return { since: f.toISOString().slice(0, 10), until: l.toISOString().slice(0, 10) }
  }
  // default last 30 days
  return { since: new Date(local.getTime() - 29 * 86_400_000).toISOString().slice(0, 10), until: today }
}

// ── GET /api/hotmart/sales ────────────────────────────────────────────────────
hotmartRouter.get('/sales', authenticate, async (req, res) => {
  try {
    const q     = req.query as Record<string, string>
    const range = parseDateParam(q, req.user!.id)

    // Admin ve todas las ventas; cliente solo las suyas
    let query = supabaseAdmin
      .from('hotmart_sales')
      .select('*')
      .gte('sale_date', range.since + 'T00:00:00')
      .lte('sale_date', range.until + 'T23:59:59')
      .order('sale_date', { ascending: false })

    if (req.user!.role !== 'admin') {
      query = query.eq('user_id', req.user!.id)
    }

    const { data, error } = await query
    if (error) { res.status(500).json({ error: error.message }); return }

    const sales   = data ?? []
    const approved = sales.filter((s: any) => s.status === 'approved' || s.status === 'complete')
    const revenue  = approved.reduce((s: number, x: any) => s + (x.commission || x.amount || 0), 0)
    const refunds  = sales.filter((s: any) => ['canceled','refunded','chargeback'].includes(s.status))
      .reduce((s: number, x: any) => s + (x.commission || x.amount || 0), 0)

    res.json({
      sales,
      totals: {
        total:      sales.length,
        approved:   approved.length,
        revenue,
        refunds,
        net:        revenue - refunds,
        avg_ticket: approved.length > 0 ? revenue / approved.length : 0,
      },
      since: range.since,
      until: range.until,
    })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' })
  }
})

// ── POST /api/hotmart/save-token ──────────────────────────────────────────────
hotmartRouter.post('/save-token', authenticate, async (req, res) => {
  try {
    const { token, email } = req.body as { token: string; email?: string }
    if (!token) { res.status(400).json({ error: 'token requerido' }); return }
    const updates: Record<string, string> = { hotmart_token: token }
    if (email) updates['hotmart_email'] = email
    await supabaseAdmin.from('users').update(updates).eq('id', req.user!.id)
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' })
  }
})

// ── POST /webhook/hotmart ──────────────────────────────────────────────────────
// URL pública: /webhook/hotmart?user_id=UUID
hotmartRouter.post('/webhook', async (req, res) => {
  try {
    const userId = req.query['user_id'] as string | undefined
    if (!userId) { res.status(400).json({ error: 'user_id requerido' }); return }

    const body = req.body as Record<string, unknown>
    const event = (body['event'] as string) ?? (body['type'] as string) ?? ''

    // Hotmart webhook payload structure
    const purchase = (body['data'] as Record<string, unknown>)?.['purchase'] as Record<string, unknown>
      ?? body as Record<string, unknown>
    const buyer    = (body['data'] as Record<string, unknown>)?.['buyer'] as Record<string, unknown>
      ?? body['buyer'] as Record<string, unknown>
      ?? {}
    const product  = (body['data'] as Record<string, unknown>)?.['product'] as Record<string, unknown>
      ?? body['product'] as Record<string, unknown>
      ?? {}

    const txId     = (purchase?.['transaction'] as string) ?? (purchase?.['order_id'] as string) ?? Date.now().toString()
    const status   = mapHotmartStatus(event)
    const offerPrice = (purchase?.['original_offer_price'] as Record<string, unknown>)?.['value']
    const priceVal   = (purchase?.['price'] as Record<string, unknown>)?.['value']
    const commVal    = (purchase?.['commission'] as Record<string, unknown>)?.['value']
    const amount   = parseFloat(String(offerPrice ?? priceVal ?? 0))
    const commission = parseFloat(String(commVal ?? priceVal ?? amount))
    const saleDate = purchase?.['approved_date']
      ? new Date(Number(purchase['approved_date'])).toISOString()
      : new Date().toISOString()

    // UTM params — stored in tracking/src
    const tracking = (body['data'] as Record<string, unknown>)?.['tracking'] as Record<string, unknown> ?? {}
    const utmCampaign = (tracking['utm_campaign'] as string)
      ?? (tracking['source_sck'] as string)
      ?? null
    const utmContent  = (tracking['utm_content'] as string) ?? null

    // Upsert sale
    const { error } = await supabaseAdmin
      .from('hotmart_sales')
      .upsert({
        id:             `${userId}_${txId}`,
        user_id:        userId,
        transaction_id: txId,
        product_name:   (product?.['name'] as string) ?? null,
        buyer_name:     (buyer?.['name'] as string) ?? null,
        buyer_email:    (buyer?.['email'] as string) ?? null,
        amount,
        commission,
        status,
        sale_date:      saleDate,
        utm_campaign:   utmCampaign,
        utm_content:    utmContent,
        payment_type:   ((purchase?.['payment'] as Record<string, unknown>)?.['type'] as string) ?? null,
      }, { onConflict: 'id' })

    if (error) console.error('[Hotmart webhook] DB error:', error.message)

    // Send push notification for new sale
    if (status === 'approved' || status === 'complete') {
      triggerPushForSale(userId, amount, commission).catch(() => {})
    }

    res.json({ received: true })
  } catch (err) {
    console.error('[Hotmart webhook]', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' })
  }
})

function mapHotmartStatus(event: string): string {
  const map: Record<string, string> = {
    PURCHASE_APPROVED:      'approved',
    PURCHASE_COMPLETE:      'complete',
    PURCHASE_CANCELED:      'canceled',
    PURCHASE_REFUNDED:      'refunded',
    PURCHASE_CHARGEBACK:    'chargeback',
    PURCHASE_BILLET_PRINTED: 'pending',
  }
  return map[event] ?? 'pending'
}

async function triggerPushForSale(userId: string, amount: number, commission: number) {
  const vapidKey    = process.env.VAPID_PRIVATE_KEY
  const vapidEmail  = process.env.VAPID_EMAIL
  const vapidPublic = process.env.VAPID_PUBLIC_KEY
  if (!vapidKey || !vapidEmail || !vapidPublic) return

  const { data: subs } = await supabaseAdmin
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('user_id', userId)

  if (!subs?.length) return

  // Dynamic import of web-push to avoid hard dependency at startup
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/ban-ts-comment
    // @ts-ignore — web-push is an optional runtime dependency
    const webpush = await import('web-push') as any
    webpush.setVapidDetails(`mailto:${vapidEmail}`, vapidPublic, vapidKey)

    const payload = JSON.stringify({
      type:    'SALE_SOUND',
      title:   '💰 ¡Nueva venta!',
      body:    `Comisión: $${commission.toFixed(2)}`,
      amount,
      commission,
    })

    await Promise.allSettled(
      subs.map((sub: any) =>
        webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload)
      )
    )
  } catch { /* web-push not installed */ }
}
