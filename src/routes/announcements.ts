import { Router } from 'express'
import { supabaseAdmin } from '../lib/supabase.js'
import { authenticate } from '../middleware/auth.js'
import { requireRole } from '../middleware/requireRole.js'

export const announcementsRouter = Router()

// GET /api/announcements — public (no auth required for display)
announcementsRouter.get('/', async (_req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('announcements')
      .select('id, message, type, emoji, active, created_at')
      .eq('active', true)
      .order('created_at', { ascending: false })
    if (error) { res.status(500).json({ error: error.message }); return }
    res.json(data ?? [])
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' })
  }
})

// GET /api/admin/announcements — admin: all banners
announcementsRouter.get('/admin', authenticate, requireRole('admin'), async (_req, res) => {
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
announcementsRouter.post('/admin', authenticate, requireRole('admin'), async (req, res) => {
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
announcementsRouter.post('/admin/toggle', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { id, active } = req.body as { id: string; active: boolean }
    if (!id) { res.status(400).json({ error: 'id requerido' }); return }
    await supabaseAdmin.from('announcements').update({ active }).eq('id', id)
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' })
  }
})
