import { Router } from 'express'
import { supabaseAdmin } from '../lib/supabase.js'
import { authenticate } from '../middleware/auth.js'

export const utmRouter = Router()

// ── Funnel Links CRUD ───────────────────────────────────────────────────────

// GET /api/utm/funnel-links
utmRouter.get('/funnel-links', authenticate, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('funnel_links')
      .select('*')
      .eq('user_id', req.user!.id)
      .order('created_at', { ascending: false })
    if (error) { res.status(500).json({ error: error.message }); return }
    res.json(data ?? [])
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' })
  }
})

// POST /api/utm/funnel-links
utmRouter.post('/funnel-links', authenticate, async (req, res) => {
  try {
    const { label, base_url, category } = req.body as { label: string; base_url: string; category?: string }
    if (!label || !base_url) { res.status(400).json({ error: 'label y base_url requeridos' }); return }
    const { data, error } = await supabaseAdmin
      .from('funnel_links')
      .insert({ user_id: req.user!.id, label, base_url, category: category ?? 'general' })
      .select()
      .single()
    if (error) { res.status(500).json({ error: error.message }); return }
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' })
  }
})

// DELETE /api/utm/funnel-links/:id
utmRouter.delete('/funnel-links/:id', authenticate, async (req, res) => {
  try {
    const { error } = await supabaseAdmin
      .from('funnel_links')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user!.id)
    if (error) { res.status(500).json({ error: error.message }); return }
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' })
  }
})

// ── UTM Conventions CRUD ────────────────────────────────────────────────────

// GET /api/utm/conventions
utmRouter.get('/conventions', authenticate, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('utm_conventions')
      .select('*')
      .eq('user_id', req.user!.id)
      .order('param')
    if (error) { res.status(500).json({ error: error.message }); return }
    res.json(data ?? [])
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' })
  }
})

// POST /api/utm/conventions
utmRouter.post('/conventions', authenticate, async (req, res) => {
  try {
    const { param, value } = req.body as { param: string; value: string }
    if (!param || !value) { res.status(400).json({ error: 'param y value requeridos' }); return }
    const { data, error } = await supabaseAdmin
      .from('utm_conventions')
      .upsert({ user_id: req.user!.id, param, value }, { onConflict: 'user_id,param,value' })
      .select()
      .single()
    if (error) { res.status(500).json({ error: error.message }); return }
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' })
  }
})

// DELETE /api/utm/conventions/:id
utmRouter.delete('/conventions/:id', authenticate, async (req, res) => {
  try {
    const { error } = await supabaseAdmin
      .from('utm_conventions')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user!.id)
    if (error) { res.status(500).json({ error: error.message }); return }
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' })
  }
})

// ── UTM Stats (Hotmart) ────────────────────────────────────────────────────

// GET /api/utm/stats?group=campaign|content&since=&until=&tz=
utmRouter.get('/stats', authenticate, async (req, res) => {
  try {
    const q     = req.query as Record<string, string>
    const group = q['group'] === 'content' ? 'utm_content' : 'utm_campaign'
    const tz    = parseInt(q['tz'] ?? '0', 10)
    const tzOff = isNaN(tz) ? 0 : tz

    const now   = new Date(Date.now() + tzOff * 3_600_000)
    const today = now.toISOString().slice(0, 10)
    const since = q['since'] ?? new Date(now.getTime() - 29 * 86_400_000).toISOString().slice(0, 10)
    const until = q['until'] ?? today

    let query = supabaseAdmin
      .from('hotmart_sales')
      .select('commission, amount, status, utm_campaign, utm_content')
      .gte('sale_date', since + 'T00:00:00')
      .lte('sale_date', until + 'T23:59:59')

    if (req.user!.role !== 'admin') {
      query = query.eq('user_id', req.user!.id)
    }

    const { data, error } = await query
    if (error) { res.status(500).json({ error: error.message }); return }

    const rows    = data ?? []
    const approved = rows.filter((s: any) => s.status === 'approved' || s.status === 'complete')

    // Group by utm_campaign or utm_content
    const byKey = new Map<string, { sales: number; revenue: number }>()
    for (const s of approved) {
      const key = (s as any)[group] || '(sin tracking)'
      const cur = byKey.get(key) ?? { sales: 0, revenue: 0 }
      cur.sales++
      cur.revenue += (s as any).commission || (s as any).amount || 0
      byKey.set(key, cur)
    }

    // Always include "(sin tracking)"
    if (!byKey.has('(sin tracking)')) {
      const untracked = approved.filter((s: any) => !(s as any)[group])
      byKey.set('(sin tracking)', {
        sales:   untracked.length,
        revenue: untracked.reduce((sum: number, s: any) => sum + (s.commission || s.amount || 0), 0),
      })
    }

    const result = [...byKey.entries()]
      .map(([label, m]) => ({ label, ...m }))
      .sort((a, b) => b.revenue - a.revenue)

    res.json({ rows: result, since, until })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' })
  }
})
