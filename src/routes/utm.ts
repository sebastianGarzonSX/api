import { Router } from 'express'
import { supabaseAdmin } from '../lib/supabase.js'
import { authenticate } from '../middleware/auth.js'

export const utmRouter = Router()

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
