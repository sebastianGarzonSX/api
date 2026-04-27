import { Router } from 'express'
import { authenticate } from '../middleware/auth.js'
import { requireRole } from '../middleware/requireRole.js'
import { runSync } from '../services/syncService.js'
import { syncLock } from '../services/syncLock.js'
import type { ApiError } from '../types/index.js'

// =============================================================================
// POST /api/sync
// =============================================================================
// Dispara una sincronización manual con GoHighLevel.
// Solo accesible para rol 'admin'.
//
// La sincronización corre de forma asíncrona — el endpoint retorna 202
// inmediatamente y el proceso continúa en background.
// Para seguimiento, ver logs del servidor.
// =============================================================================

export const syncRouter = Router()

// GET /api/sync/status — cualquier admin puede consultarlo
syncRouter.get('/status', authenticate, requireRole('admin'), (_req, res) => {
  res.json({ running: syncLock.running })
})

syncRouter.post('/', authenticate, requireRole('admin'), async (req, res) => {
  if (!syncLock.acquire()) {
    const err: ApiError = {
      error:  'Sincronización ya en curso (cron o manual anterior). Espera a que termine.',
      code:   'SYNC_IN_PROGRESS',
      status: 409,
    }
    res.status(409).json(err)
    return
  }

  const force = req.query['full'] === 'true'

  // Responder 202 inmediatamente — sync corre en background
  res.status(202).json({
    message: force
      ? 'Sincronización COMPLETA iniciada. Re-descarga todos los datos de GHL.'
      : 'Sincronización incremental iniciada. Solo datos nuevos desde el último sync.',
  })

  runSync(force)
    .then((result) => { console.log('[Sync manual] Completado:', result) })
    .catch((err)   => { console.error('[Sync manual] Error:', err) })
    .finally(()    => { syncLock.release() })
})
