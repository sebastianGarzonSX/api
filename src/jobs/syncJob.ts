import cron from 'node-cron'
import { runSync } from '../services/syncService.js'
import { syncLock } from '../services/syncLock.js'

// Default cada 30 min — el sync incremental es rápido y no necesita cada 15.
const SCHEDULE = process.env.SYNC_CRON_SCHEDULE ?? '*/30 * * * *'

export function startSyncJob(): void {
  if (!cron.validate(SCHEDULE)) {
    console.error(`[SyncJob] Expresión cron inválida: "${SCHEDULE}". Job no iniciado.`)
    return
  }

  cron.schedule(SCHEDULE, async () => {
    if (!syncLock.acquire()) {
      console.log('[SyncJob] Sync ya en curso (cron o manual) — saltando.')
      return
    }
    try {
      const result = await runSync()
      if (result.errors.length > 0) {
        console.error('[SyncJob] Errores:', result.errors)
      }
    } catch (err) {
      console.error('[SyncJob] Error inesperado:', err)
    } finally {
      syncLock.release()
    }
  })

  console.log(`[SyncJob] Iniciado. Schedule: "${SCHEDULE}"`)
}
