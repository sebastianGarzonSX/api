import { Router } from 'express'
import { createHmac } from 'crypto'
import { supabaseAdmin } from '../lib/supabase.js'
import { authenticate } from '../middleware/auth.js'

export const utmRouter = Router()

// ── Meta API helpers ────────────────────────────────────────────────────────

const META_BASE = 'https://graph.facebook.com/v20.0'

function metaToken(): string {
  const t = process.env.META_ACCESS_TOKEN
  if (!t) throw new Error('META_ACCESS_TOKEN no configurado')
  return t
}

function metaProof(token: string): string | undefined {
  const secret = process.env.META_APP_SECRET
  if (!secret) return undefined
  return createHmac('sha256', secret).update(token).digest('hex')
}

function metaAccountId(account: string): string {
  if (account === 'eventos') {
    const id = process.env.META_AD_ACCOUNT_ID_EVENTOS
    if (!id) throw new Error('META_AD_ACCOUNT_ID_EVENTOS no configurado')
    return id
  }
  const id = process.env.META_AD_ACCOUNT_ID
  if (!id) throw new Error('META_AD_ACCOUNT_ID no configurado')
  return id
}

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

// ── Meta Ads — Diagnóstico ──────────────────────────────────────────────────

// GET /api/utm/meta/ads/:adId/inspect
// Devuelve el estado real de un anuncio: status, creative_id y url_tags actuales.
utmRouter.get('/meta/ads/:adId/inspect', authenticate, async (req, res) => {
  try {
    const token = metaToken()
    const proof = metaProof(token)

    const params = new URLSearchParams({
      fields:       'id,name,status,effective_status,creative{id,url_tags,object_story_spec}',
      access_token: token,
      ...(proof ? { appsecret_proof: proof } : {}),
    })
    const r = await fetch(`${META_BASE}/${req.params.adId}?${params}`)
    const text = await r.text()
    console.log(`[Meta UTM inspect] ${req.params.adId} → ${r.status}: ${text}`)

    if (!r.ok) { res.status(r.status).json({ error: text }); return }
    res.json(JSON.parse(text))
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' })
  }
})

// ── Meta Ads — Campañas ─────────────────────────────────────────────────────

// GET /api/utm/meta/campaigns?account=main|eventos
utmRouter.get('/meta/campaigns', authenticate, async (req, res) => {
  try {
    const token     = metaToken()
    const accountId = metaAccountId((req.query['account'] as string) ?? 'main')
    const proof     = metaProof(token)

    const params = new URLSearchParams({
      fields:       'id,name,status,objective',
      limit:        '200',
      access_token: token,
      ...(proof ? { appsecret_proof: proof } : {}),
    })

    const r = await fetch(`${META_BASE}/act_${accountId}/campaigns?${params}`)
    if (!r.ok) {
      const body = await r.text().catch(() => '')
      res.status(r.status).json({ error: `Meta API: ${body}` }); return
    }
    const data = await r.json() as { data?: unknown[] }
    res.json(data.data ?? [])
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' })
  }
})

// GET /api/utm/meta/campaigns/:campaignId/ads
utmRouter.get('/meta/campaigns/:campaignId/ads', authenticate, async (req, res) => {
  try {
    const token = metaToken()
    const proof = metaProof(token)

    const params = new URLSearchParams({
      fields:       'id,name,status,effective_status,creative{id,url_tags}',
      limit:        '200',
      access_token: token,
      ...(proof ? { appsecret_proof: proof } : {}),
    })

    const r = await fetch(`${META_BASE}/${req.params.campaignId}/ads?${params}`)
    if (!r.ok) {
      const body = await r.text().catch(() => '')
      res.status(r.status).json({ error: `Meta API: ${body}` }); return
    }
    const data = await r.json() as { data?: unknown[] }
    res.json(data.data ?? [])
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' })
  }
})

// POST /api/utm/meta/ads/:adId/url-tags
// Body: { url_tags: string }
//
// Estrategia (en orden):
//   1. Intentar editar el creative directamente (funciona si no ha tenido entregas).
//   2. Si Meta lo rechaza (creative bloqueado), duplicar el creative con url_tags
//      y reasignarlo al anuncio — flujo oficial para anuncios activos con historial.
utmRouter.post('/meta/ads/:adId/url-tags', authenticate, async (req, res) => {
  try {
    const token   = metaToken()
    const proof   = metaProof(token)
    const urlTags = (req.body as { url_tags?: string }).url_tags ?? ''
    const adId    = req.params.adId

    // ── Paso 1: leer creative_id y account_id del anuncio ───────────────────
    const adFields = new URLSearchParams({
      fields:       'account_id,creative{id,name,object_story_spec,asset_feed_spec,url_tags}',
      access_token: token,
      ...(proof ? { appsecret_proof: proof } : {}),
    })
    const adGetRes  = await fetch(`${META_BASE}/${adId}?${adFields}`)
    const adGetText = await adGetRes.text()
    console.log(`[Meta UTM] GET ad/${adId} → ${adGetRes.status}: ${adGetText.slice(0, 300)}`)

    if (!adGetRes.ok) {
      res.status(adGetRes.status).json({ error: `Meta API (get ad): ${adGetText}` }); return
    }
    const adData  = JSON.parse(adGetText) as {
      account_id?: string
      creative?: {
        id: string
        name?: string
        object_story_spec?: Record<string, unknown>
        asset_feed_spec?:   Record<string, unknown>
        url_tags?:          string
      }
    }
    const creative   = adData.creative
    const accountId  = adData.account_id
    if (!creative?.id || !accountId) {
      res.status(404).json({ error: 'No se encontró creative o account_id del anuncio' }); return
    }

    // ── Paso 2: intentar edición directa del creative ───────────────────────
    const directBody = new URLSearchParams({
      url_tags:     urlTags,
      access_token: token,
      ...(proof ? { appsecret_proof: proof } : {}),
    })
    const directRes  = await fetch(`${META_BASE}/${creative.id}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    directBody.toString(),
    })
    const directText = await directRes.text()
    console.log(`[Meta UTM] PATCH creative/${creative.id} → ${directRes.status}: ${directText}`)

    if (directRes.ok) {
      res.json({ success: true, method: 'direct_edit', creative_id: creative.id }); return
    }

    // ── Paso 3: duplicar creative con url_tags y reasignar al anuncio ────────
    // Meta bloquea edición de creatives con historial de entregas.
    // Solución: crear un nuevo creative idéntico con url_tags y asignarlo al ad.
    console.log(`[Meta UTM] edición directa rechazada (${directRes.status}), duplicando creative...`)

    const newCreativeBody: Record<string, string> = {
      access_token: token,
      url_tags:     urlTags,
      ...(proof ? { appsecret_proof: proof } : {}),
    }

    // Copiar name con sufijo para identificarlo
    if (creative.name) {
      newCreativeBody['name'] = `${creative.name} [utm]`
    }

    // Copiar object_story_spec si existe (ads de imagen, video, carrusel)
    if (creative.object_story_spec) {
      newCreativeBody['object_story_spec'] = JSON.stringify(creative.object_story_spec)
    }

    // Copiar asset_feed_spec si existe (ads dinámicos / DCO)
    if (creative.asset_feed_spec) {
      newCreativeBody['asset_feed_spec'] = JSON.stringify(creative.asset_feed_spec)
    }

    // degrees_of_freedom_spec NO se copia: Meta lo marca como obsoleto (subcode 3858504)
    // y rechaza la creación si se incluye. Las "mejoras estándar" de Advantage+ no
    // se pueden transferir al nuevo creative vía API.

    const createParams = new URLSearchParams(newCreativeBody)
    const createRes    = await fetch(`${META_BASE}/act_${accountId}/adcreatives`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    createParams.toString(),
    })
    const createText = await createRes.text()
    console.log(`[Meta UTM] CREATE creative → ${createRes.status}: ${createText}`)

    if (!createRes.ok) {
      res.status(createRes.status).json({
        error:           `No se pudo crear el nuevo creative: ${createText}`,
        direct_edit_err: directText,
      }); return
    }

    const newCreative = JSON.parse(createText) as { id: string }

    // ── Paso 4: asignar nuevo creative al anuncio ────────────────────────────
    const assignBody = new URLSearchParams({
      creative:     JSON.stringify({ creative_id: newCreative.id }),
      access_token: token,
      ...(proof ? { appsecret_proof: proof } : {}),
    })
    const assignRes  = await fetch(`${META_BASE}/${adId}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    assignBody.toString(),
    })
    const assignText = await assignRes.text()
    console.log(`[Meta UTM] ASSIGN creative to ad/${adId} → ${assignRes.status}: ${assignText}`)

    if (!assignRes.ok) {
      res.status(assignRes.status).json({
        error:        `Creative creado (${newCreative.id}) pero no se pudo asignar: ${assignText}`,
        new_creative: newCreative.id,
      }); return
    }

    res.json({
      success:         true,
      method:          'duplicate_and_assign',
      old_creative_id: creative.id,
      new_creative_id: newCreative.id,
    })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' })
  }
})
