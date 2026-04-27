"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncRouter = void 0;
const express_1 = require("express");
const auth_js_1 = require("../middleware/auth.js");
const requireRole_js_1 = require("../middleware/requireRole.js");
const syncService_js_1 = require("../services/syncService.js");
const syncLock_js_1 = require("../services/syncLock.js");
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
exports.syncRouter = (0, express_1.Router)();
// GET /api/sync/status — cualquier admin puede consultarlo
exports.syncRouter.get('/status', auth_js_1.authenticate, (0, requireRole_js_1.requireRole)('admin'), (_req, res) => {
    res.json({ running: syncLock_js_1.syncLock.running });
});
exports.syncRouter.post('/', auth_js_1.authenticate, (0, requireRole_js_1.requireRole)('admin'), async (req, res) => {
    if (!syncLock_js_1.syncLock.acquire()) {
        const err = {
            error: 'Sincronización ya en curso (cron o manual anterior). Espera a que termine.',
            code: 'SYNC_IN_PROGRESS',
            status: 409,
        };
        res.status(409).json(err);
        return;
    }
    const force = req.query['full'] === 'true';
    // Responder 202 inmediatamente — sync corre en background
    res.status(202).json({
        message: force
            ? 'Sincronización COMPLETA iniciada. Re-descarga todos los datos de GHL.'
            : 'Sincronización incremental iniciada. Solo datos nuevos desde el último sync.',
    });
    (0, syncService_js_1.runSync)(force)
        .then((result) => { console.log('[Sync manual] Completado:', result); })
        .catch((err) => { console.error('[Sync manual] Error:', err); })
        .finally(() => { syncLock_js_1.syncLock.release(); });
});
