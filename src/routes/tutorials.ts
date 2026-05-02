import { Router } from 'express'
import { supabaseAdmin } from '../lib/supabase.js'
import { authenticate } from '../middleware/auth.js'
import { requireRole } from '../middleware/requireRole.js'

export const tutorialsRouter = Router()

// GET /api/tutorials
tutorialsRouter.get('/', authenticate, async (_req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('tutorials_config')
      .select('videos')
      .eq('id', 1)
      .single()
    if (error) { res.json({ videos: {} }); return }
    res.json({ videos: (data as any)?.videos ?? {} })
  } catch {
    res.json({ videos: {} })
  }
})

// POST /api/admin/tutorials
tutorialsRouter.post('/admin', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { videos } = req.body as { videos: Record<string, string> }
    if (!videos) { res.status(400).json({ error: 'videos requerido' }); return }
    await supabaseAdmin
      .from('tutorials_config')
      .upsert({ id: 1, videos })
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' })
  }
})
