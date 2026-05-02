import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function main() {
  console.log('\n=== DIAGNÓSTICO DE SALUD DE DATOS ===\n')

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
    supabase.from('leads').select('id', { count: 'exact', head: true }),
    supabase.from('leads').select('id', { count: 'exact', head: true }).not('attribution_ad_id', 'is', null),
    supabase.from('leads').select('id', { count: 'exact', head: true }).not('tags', 'eq', '{}'),
    supabase.from('leads').select('id', { count: 'exact', head: true }).not('custom_fields', 'is', null),
    supabase.from('leads').select('id', { count: 'exact', head: true }).not('city', 'is', null),
    supabase.from('leads').select('id', { count: 'exact', head: true }).eq('interaction_status', 'interacted'),
    supabase.from('leads').select('attribution_ad_id, attribution_ad_name').not('attribution_ad_id', 'is', null).limit(500),
    supabase.rpc('get_lead_tags', {
      p_since: new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10),
      p_until: new Date().toISOString().slice(0, 10),
    }),
    supabase.from('pipelines').select('id, name'),
    supabase.from('pipeline_stages').select('id, pipeline_id, name, position').order('position'),
    supabase.from('meta_campaigns').select('campaign_id, campaign_name, spend, impressions, clicks, date_start, date_stop').order('date_start', { ascending: false }).limit(50),
    supabase.from('meta_ads').select('ad_id, ad_name, ad_status, spend, campaign_name').order('spend', { ascending: false }).limit(50),
    supabase.from('sync_state').select('key, value'),
    supabase.from('opportunities').select('id', { count: 'exact', head: true }),
    supabase.from('opportunities').select('id', { count: 'exact', head: true }).eq('status', 'won'),
    supabase.from('hotmart_sales').select('id', { count: 'exact', head: true }),
  ])

  const total        = leadsTotal.count ?? 0
  const withAttrib   = leadsWithAttribution.count ?? 0
  const withTags     = leadsWithTags.count ?? 0
  const withCF       = leadsWithCustomFields.count ?? 0
  const withCity     = leadsWithCity.count ?? 0
  const withInteract = leadsWithInteraction.count ?? 0

  console.log('── LEADS ──')
  console.log(`  Total:              ${total}`)
  console.log(`  Con atribución:     ${withAttrib} (${total > 0 ? ((withAttrib / total) * 100).toFixed(1) : 0}%)`)
  console.log(`  Sin atribución:     ${total - withAttrib}`)
  console.log(`  Con tags:           ${withTags}`)
  console.log(`  Con custom fields:  ${withCF}`)
  console.log(`  Con ciudad:         ${withCity}`)
  console.log(`  Con interacción:    ${withInteract}`)

  console.log('\n── OPORTUNIDADES ──')
  console.log(`  Total:              ${opportunitiesTotal.count ?? 0}`)
  console.log(`  Ganadas (won):      ${opportunitiesWon.count ?? 0}`)

  console.log('\n── HOTMART ──')
  console.log(`  Ventas registradas: ${hotmartSalesCount.count ?? 0}`)

  // Cruce de atribución
  const adIdSet   = new Set((topAttributionAds.data ?? []).map((r: any) => r.attribution_ad_id))
  const metaAdIds = new Set((metaAdsData.data ?? []).map((r: any) => r.ad_id))
  const matched   = [...adIdSet].filter(id => metaAdIds.has(id))

  console.log('\n── CRUCE GHL ↔ META ──')
  console.log(`  Ad IDs únicos en leads:   ${adIdSet.size}`)
  console.log(`  Ads en tabla meta_ads:     ${metaAdIds.size}`)
  console.log(`  Coinciden:                 ${matched.length}`)
  console.log(`  Sin coincidencia:          ${adIdSet.size - matched.length}`)
  console.log(`  Match rate:                ${adIdSet.size > 0 ? ((matched.length / adIdSet.size) * 100).toFixed(1) : 'N/A'}%`)

  // Tags de clase
  const allTags   = (topTags.data ?? []) as Array<{ tag: string; cnt: number }>
  const classTags = allTags.filter((t: any) => t.tag?.toLowerCase().startsWith('clase '))

  console.log('\n── CLASES EN VIVO (tags) ──')
  console.log(`  Tags "clase *" encontrados: ${classTags.length}`)
  for (const t of classTags.slice(0, 15)) {
    console.log(`    ${t.tag}  (${t.cnt} leads)`)
  }

  // Pipelines
  const pipelines = pipelinesData.data ?? []
  const stages    = stagesData.data ?? []

  console.log('\n── PIPELINES ──')
  for (const p of pipelines) {
    const ps = stages.filter((s: any) => s.pipeline_id === p.id).sort((a: any, b: any) => a.position - b.position)
    console.log(`  ${(p as any).name}`)
    for (const s of ps) {
      console.log(`    ${(s as any).position}. ${(s as any).name}`)
    }
  }

  // Meta campaigns recientes
  const camps = (metaCampaignsData.data ?? []).slice(0, 10)

  console.log('\n── META CAMPAIGNS (10 más recientes) ──')
  for (const c of camps) {
    console.log(`  ${(c as any).campaign_name}`)
    console.log(`    spend: $${(c as any).spend}  |  clicks: ${(c as any).clicks}  |  impressions: ${(c as any).impressions}  |  ${(c as any).date_start} → ${(c as any).date_stop}`)
  }

  // Meta ads top por gasto
  const ads = (metaAdsData.data ?? []).slice(0, 10)

  console.log('\n── META ADS (10 top por gasto) ──')
  for (const a of ads) {
    console.log(`  [${(a as any).ad_status}] ${(a as any).ad_name}  —  $${(a as any).spend}  (campaña: ${(a as any).campaign_name})`)
  }

  // Sync state
  console.log('\n── SYNC STATE ──')
  for (const s of (syncStateData.data ?? [])) {
    console.log(`  ${(s as any).key}: ${(s as any).value}`)
  }

  console.log('\n=== FIN DEL DIAGNÓSTICO ===\n')
}

main().catch(err => { console.error('Error:', err); process.exit(1) })
