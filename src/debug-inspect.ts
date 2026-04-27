/**
 * Inspecciona la estructura completa de datos de GHL:
 * contacto completo, oportunidad completa, pipelines, y fuentes únicas.
 * Correr: npx tsx src/debug-inspect.ts
 */
import 'dotenv/config'

const BASE = 'https://services.leadconnectorhq.com'
const KEY  = process.env.GHL_API_KEY!
const LOC  = process.env.GHL_LOCATION_ID!
const h    = {
  'Authorization': `Bearer ${KEY}`,
  'Version':       '2021-07-28',
  'Content-Type':  'application/json',
}

async function get<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: h })
  return r.json() as Promise<T>
}

async function main() {
  // ── 1. Contacto completo ──────────────────────────────────────────────────
  const contacts = await get<any>(`${BASE}/contacts/?locationId=${LOC}&limit=3`)
  console.log('\n=== CONTACTO (objeto completo) ===')
  console.log(JSON.stringify(contacts.contacts[0], null, 2))
  console.log('\n--- META de paginación ---')
  console.log(JSON.stringify(contacts.meta, null, 2))

  // ── 2. Sources únicas de los últimos contactos (muestra) ─────────────────
  const sample = await get<any>(`${BASE}/contacts/?locationId=${LOC}&limit=100`)
  const sources = [...new Set(sample.contacts.map((c: any) => c.source).filter(Boolean))]
  const tags    = [...new Set(sample.contacts.flatMap((c: any) => c.tags ?? []))].slice(0, 30)
  console.log('\n=== SOURCES únicos (muestra 100 contactos) ===')
  console.log(sources)
  console.log('\n=== TAGS únicos (muestra, primeros 30) ===')
  console.log(tags)

  // ── 3. Oportunidad completa ───────────────────────────────────────────────
  const opps = await get<any>(`${BASE}/opportunities/search?location_id=${LOC}&limit=3&page=1`)
  console.log('\n=== OPORTUNIDAD (objeto completo) ===')
  console.log(JSON.stringify(opps.opportunities[0], null, 2))

  // ── 4. Pipelines disponibles ─────────────────────────────────────────────
  const pipelines = await get<any>(`${BASE}/opportunities/pipelines?locationId=${LOC}`)
  console.log('\n=== PIPELINES ===')
  console.log(JSON.stringify(pipelines, null, 2))
}

main().catch(console.error)
