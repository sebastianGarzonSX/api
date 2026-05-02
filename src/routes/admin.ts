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

// GET /api/admin/data-health — diagnostic report on data quality
adminRouter.get('/data-health', ...adminAuth, async (_req, res) => {
  try {
    const [
      leadsTotal,
      leadsWithAttribution,
      leadsWithTags,
      leadsWithCustomFields,
      leadsWithCity,
      leadsWithInteraction,
      topAttributionAds,
      topTags,
      pipelinesData,
      stagesData,
      metaCampaignsData,
      metaAdsData,
      syncStateData,
      opportunitiesTotal,
      opportunitiesWon,
      hotmartSalesCount,
    ] = await Promise.all([
      supabaseAdmin.from('leads').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('leads').select('id', { count: 'exact', head: true }).not('attribution_ad_id', 'is', null),
      supabaseAdmin.from('leads').select('id', { count: 'exact', head: true }).not('tags', 'eq', '{}'),
      supabaseAdmin.from('leads').select('id', { count: 'exact', head: true }).not('custom_fields', 'is', null),
      supabaseAdmin.from('leads').select('id', { count: 'exact', head: true }).not('city', 'is', null),
      supabaseAdmin.from('leads').select('id', { count: 'exact', head: true }).eq('interaction_status', 'interacted'),
      supabaseAdmin.from('leads').select('attribution_ad_id, attribution_ad_name').not('attribution_ad_id', 'is', null).limit(500),
      supabaseAdmin.rpc('get_lead_tags', { p_since: new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10), p_until: new Date().toISOString().slice(0, 10) }),
      supabaseAdmin.from('pipelines').select('id, name'),
      supabaseAdmin.from('pipeline_stages').select('id, pipeline_id, name, position').order('position'),
      supabaseAdmin.from('meta_campaigns').select('campaign_id, campaign_name, spend, impressions, clicks, date_start, date_stop').order('date_start', { ascending: false }).limit(50),
      supabaseAdmin.from('meta_ads').select('ad_id, ad_name, ad_status, spend, campaign_name').order('spend', { ascending: false }).limit(50),
      supabaseAdmin.from('sync_state').select('key, value'),
      supabaseAdmin.from('opportunities').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('opportunities').select('id', { count: 'exact', head: true }).eq('status', 'won'),
      supabaseAdmin.from('hotmart_sales').select('id', { count: 'exact', head: true }),
    ])

    const total         = leadsTotal.count ?? 0
    const withAttrib    = leadsWithAttribution.count ?? 0
    const withTags      = leadsWithTags.count ?? 0
    const withCF        = leadsWithCustomFields.count ?? 0
    const withCity      = leadsWithCity.count ?? 0
    const withInteract  = leadsWithInteraction.count ?? 0

    const adIdSet = new Set((topAttributionAds.data ?? []).map((r: any) => r.attribution_ad_id))
    const metaAdIds = new Set((metaAdsData.data ?? []).map((r: any) => r.ad_id))
    const matchedAds = [...adIdSet].filter(id => metaAdIds.has(id))

    const classTags = ((topTags.data ?? []) as Array<{ tag: string; cnt: number }>)
      .filter((t: any) => t.tag?.toLowerCase().startsWith('clase '))

    res.json({
      generated_at: new Date().toISOString(),
      leads: {
        total,
        with_attribution: withAttrib,
        without_attribution: total - withAttrib,
        attribution_rate: total > 0 ? `${((withAttrib / total) * 100).toFixed(1)}%` : '0%',
        with_tags: withTags,
        with_custom_fields: withCF,
        with_city: withCity,
        with_interaction: withInteract,
      },
      opportunities: {
        total: opportunitiesTotal.count ?? 0,
        won: opportunitiesWon.count ?? 0,
      },
      hotmart_sales: {
        total: hotmartSalesCount.count ?? 0,
      },
      attribution_cross_check: {
        unique_ad_ids_in_leads: adIdSet.size,
        total_meta_ads_in_db: metaAdIds.size,
        matched_ads: matchedAds.length,
        unmatched_lead_ads: adIdSet.size - matchedAds.length,
        match_rate: adIdSet.size > 0 ? `${((matchedAds.length / adIdSet.size) * 100).toFixed(1)}%` : 'N/A',
      },
      clase_en_vivo: {
        tags_found: classTags.length,
        tags: classTags.slice(0, 20),
      },
      pipelines: (pipelinesData.data ?? []).map((p: any) => ({
        id: p.id,
        name: p.name,
        stages: (stagesData.data ?? [])
          .filter((s: any) => s.pipeline_id === p.id)
          .sort((a: any, b: any) => a.position - b.position)
          .map((s: any) => ({ name: s.name, position: s.position })),
      })),
      meta_campaigns: {
        total_in_db: (metaCampaignsData.data ?? []).length,
        recent: (metaCampaignsData.data ?? []).slice(0, 10).map((c: any) => ({
          id: c.campaign_id,
          name: c.campaign_name,
          spend: c.spend,
          impressions: c.impressions,
          date_start: c.date_start,
          date_stop: c.date_stop,
        })),
      },
      meta_ads: {
        total_in_db: (metaAdsData.data ?? []).length,
        top_by_spend: (metaAdsData.data ?? []).slice(0, 10).map((a: any) => ({
          ad_id: a.ad_id,
          name: a.ad_name,
          status: a.ad_status,
          spend: a.spend,
          campaign: a.campaign_name,
        })),
      },
      sync_state: Object.fromEntries(
        (syncStateData.data ?? []).map((s: any) => [s.key, s.value])
      ),
    })
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
