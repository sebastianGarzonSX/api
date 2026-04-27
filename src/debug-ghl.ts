/**
 * Script de diagnóstico GHL — correr desde la carpeta api/:
 *   npx tsx src/debug-ghl.ts
 *
 * No necesita servidor corriendo. Lee el .env directamente.
 */
import 'dotenv/config'

const GHL_BASE_URL = 'https://services.leadconnectorhq.com'
const API_KEY      = process.env.GHL_API_KEY
const LOCATION_ID  = process.env.GHL_LOCATION_ID

console.log('\n=== DEBUG GHL ===')
console.log('GHL_API_KEY    :', API_KEY ? `${API_KEY.slice(0, 20)}...` : '❌ NO DEFINIDA')
console.log('GHL_LOCATION_ID:', LOCATION_ID || '❌ NO DEFINIDA')
console.log()

if (!API_KEY || !LOCATION_ID) {
  console.error('Faltan variables. Verifica api/.env')
  process.exit(1)
}

const headers = {
  'Authorization': `Bearer ${API_KEY}`,
  'Version':       '2021-07-28',
  'Content-Type':  'application/json',
}

async function test(label: string, url: string) {
  console.log(`--- ${label} ---`)
  console.log('URL:', url)
  try {
    const res = await fetch(url, { headers })
    console.log('Status:', res.status, res.statusText)
    const body = await res.json()
    console.log('Respuesta:', JSON.stringify(body, null, 2).slice(0, 800))
  } catch (err) {
    console.error('Error de red:', err)
  }
  console.log()
}

async function main() {
  // 1. Verificar que el token es válido pidiendo info del location
  await test(
    '1. Info del location',
    `${GHL_BASE_URL}/locations/${LOCATION_ID}`
  )

  // 2. Primera página de contactos
  await test(
    '2. Contactos (primera página)',
    `${GHL_BASE_URL}/contacts/?locationId=${LOCATION_ID}&limit=5`
  )

  // 3. Primera página de oportunidades
  await test(
    '3. Oportunidades (primera página)',
    `${GHL_BASE_URL}/opportunities/search?location_id=${LOCATION_ID}&limit=5&page=1`
  )
}

main().catch(console.error)
