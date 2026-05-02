import { Router } from 'express'
import { supabaseAdmin } from '../lib/supabase.js'
import { authenticate } from '../middleware/auth.js'
import { requireRole } from '../middleware/requireRole.js'

export const adminRouter = Router()

const adminAuth = [authenticate, requireRole('admin')]

// GET /api/admin/users
adminRouter.get('/users', ...adminAuth, async (_req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('id, name, email, role, plan, meta_account_id, status, created_at, last_login')
      .order('created_at', { ascending: false })
    if (error) { res.status(500).json({ error: error.message }); return }
    res.json(data ?? [])
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' })
  }
})

// POST /api/admin/set-role
adminRouter.post('/set-role', ...adminAuth, async (req, res) => {
  try {
    const { userId, role } = req.body as { userId: string; role: string }
    if (!userId || !role) { res.status(400).json({ error: 'userId y role requeridos' }); return }
    await supabaseAdmin.from('users').update({ role }).eq('id', userId)
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' })
  }
})

// POST /api/admin/set-plan
adminRouter.post('/set-plan', ...adminAuth, async (req, res) => {
  try {
    const { userId, plan } = req.body as { userId: string; plan: string }
    if (!userId || !plan) { res.status(400).json({ error: 'userId y plan requeridos' }); return }
    await supabaseAdmin.from('users').update({ plan }).eq('id', userId)
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' })
  }
})

// POST /api/admin/delete-user
adminRouter.post('/delete-user', ...adminAuth, async (req, res) => {
  try {
    const { userId } = req.body as { userId: string }
    if (!userId) { res.status(400).json({ error: 'userId requerido' }); return }
    await supabaseAdmin.auth.admin.deleteUser(userId)
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' })
  }
})

// GET /api/admin/find-sale
adminRouter.get('/find-sale', ...adminAuth, async (req, res) => {
  try {
    const { txid, buyer } = req.query as Record<string, string>
    if (!txid && !buyer) { res.status(400).json({ error: 'txid o buyer requerido' }); return }

    let query = supabaseAdmin.from('hotmart_sales').select('*')
    if (txid)  query = query.ilike('transaction_id', `%${txid}%`)
    if (buyer) query = query.or(`buyer_name.ilike.%${buyer}%,buyer_email.ilike.%${buyer}%`)

    const { data, error } = await query.order('sale_date', { ascending: false }).limit(20)
    if (error) { res.status(500).json({ error: error.message }); return }
    res.json({ found: (data?.length ?? 0) > 0, sales: data ?? [] })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' })
  }
})

// POST /api/admin/update-sale
adminRouter.post('/update-sale', ...adminAuth, async (req, res) => {
  try {
    const { id, userId, commission } = req.body as { id: string; userId: string; commission: number }
    if (!id) { res.status(400).json({ error: 'id requerido' }); return }
    await supabaseAdmin.from('hotmart_sales').update({ commission }).eq('id', id)
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' })
  }
})

// POST /api/admin/copy-sale
adminRouter.post('/copy-sale', ...adminAuth, async (req, res) => {
  try {
    const { originalId, targetUserId, commission } = req.body as {
      originalId: string; targetUserId: string; commission?: number
    }
    if (!originalId || !targetUserId) { res.status(400).json({ error: 'originalId y targetUserId requeridos' }); return }

    const { data: orig, error } = await supabaseAdmin
      .from('hotmart_sales')
      .select('*')
      .eq('id', originalId)
      .single()
    if (error || !orig) { res.status(404).json({ error: 'Venta original no encontrada' }); return }

    const newId = `${targetUserId}_${(orig as any).transaction_id}_copy_${Date.now()}`
    const { data: newSale, error: insErr } = await supabaseAdmin
      .from('hotmart_sales')
      .insert({
        ...(orig as object),
        id:         newId,
        user_id:    targetUserId,
        commission: commission ?? (orig as any).commission,
      })
      .select()
      .single()
    if (insErr) { res.status(500).json({ error: insErr.message }); return }
    res.json(newSale)
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' })
  }
})

// POST /api/admin/delete-sale
adminRouter.post('/delete-sale', ...adminAuth, async (req, res) => {
  try {
    const { id } = req.body as { id: string }
    if (!id) { res.status(400).json({ error: 'id requerido' }); return }
    await supabaseAdmin.from('hotmart_sales').delete().eq('id', id)
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' })
  }
})

// POST /api/admin/manual-sale
adminRouter.post('/manual-sale', ...adminAuth, async (req, res) => {
  try {
    const { txid, userId, product, buyer, commission, saleDate } = req.body as {
      txid: string; userId: string; product?: string; buyer?: string; commission: number; saleDate?: string
    }
    if (!txid || !userId || commission == null) {
      res.status(400).json({ error: 'txid, userId y commission son requeridos' }); return
    }
    const { data, error } = await supabaseAdmin
      .from('hotmart_sales')
      .insert({
        id:             `${userId}_${txid}`,
        user_id:        userId,
        transaction_id: txid,
        product_name:   product ?? null,
        buyer_name:     buyer  ?? null,
        amount:         commission,
        commission,
        status:         'approved',
        sale_date:      saleDate ? new Date(saleDate).toISOString() : new Date().toISOString(),
      })
      .select()
      .single()
    if (error) { res.status(500).json({ error: error.message }); return }
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' })
  }
})

// ── Announcement admin routes ─────────────────────────────────────────────────

// GET /api/admin/announcements — all banners (admin)
adminRouter.get('/announcements', ...adminAuth, async (_req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('announcements')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) { res.status(500).json({ error: error.message }); return }
    res.json(data ?? [])
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' })
  }
})

// POST /api/admin/announcements — create or delete
adminRouter.post('/announcements', ...adminAuth, async (req, res) => {
  try {
    const body = req.body as { id?: string; message?: string; type?: string; emoji?: string; _delete?: boolean }
    if (body._delete && body.id) {
      await supabaseAdmin.from('announcements').delete().eq('id', body.id)
      res.json({ success: true }); return
    }
    if (!body.message) { res.status(400).json({ error: 'message requerido' }); return }
    const { data, error } = await supabaseAdmin
      .from('announcements')
      .insert({ message: body.message, type: body.type ?? 'info', emoji: body.emoji ?? '📢' })
      .select()
      .single()
    if (error) { res.status(500).json({ error: error.message }); return }
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' })
  }
})

// POST /api/admin/announcements/toggle
adminRouter.post('/announcements/toggle', ...adminAuth, async (req, res) => {
  try {
    const { id, active } = req.body as { id: string; active: boolean }
    if (!id) { res.status(400).json({ error: 'id requerido' }); return }
    await supabaseAdmin.from('announcements').update({ active }).eq('id', id)
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' })
  }
})

// ── Tutorial admin routes ─────────────────────────────────────────────────────

// POST /api/admin/tutorials
adminRouter.post('/tutorials', ...adminAuth, async (req, res) => {
  try {
    const { videos } = req.body as { videos: Record<string, string> }
    if (!videos) { res.status(400).json({ error: 'videos requerido' }); return }
    await supabaseAdmin.from('tutorials_config').upsert({ id: 1, videos })
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' })
  }
})

// POST /api/admin/billing/checkout — upgrade redirect
adminRouter.post('/billing/checkout', authenticate, async (req, res) => {
  try {
    const { plan } = req.body as { plan: string }
    const links: Record<string, string> = {
      pro:    process.env.HOTMART_URL_PRO    ?? 'https://hotmart.com',
      agency: process.env.HOTMART_URL_AGENCY ?? 'https://hotmart.com',
    }
    const url = links[plan]
    if (!url) { res.status(400).json({ error: 'Plan inválido' }); return }
    res.json({ url })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' })
  }
})
