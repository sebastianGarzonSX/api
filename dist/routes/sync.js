"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncRouter = void 0;
const express_1 = require("express");
const auth_js_1 = require("../middleware/auth.js");
const requireRole_js_1 = require("../middleware/requireRole.js");
const syncService_js_1 = require("../services/syncService.js");
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
// Flag para evitar ejecuciones paralelas desde múltiples admins
let syncInProgress = false;
exports.syncRouter.post('/', auth_js_1.authenticate, (0, requireRole_js_1.requireRole)('admin'), async (_req, res) => {
    if (syncInProgress) {
        const err = {
            error: 'Sincronización ya en curso. Espera a que termine.',
            code: 'SYNC_IN_PROGRESS',
            status: 409,
        };
        res.status(409).json(err);
        return;
    }
    // Responder inmediatamente — sync corre en background
    res.status(202).json({
        message: 'Sincronización iniciada. Los datos se actualizarán en breve.',
    });
    // Background
    syncInProgress = true;
    (0, syncService_js_1.runSync)()
        .then((result) => {
        console.log('[Sync manual] Completado:', result);
    })
        .catch((err) => {
        console.error('[Sync manual] Error:', err);
    })
        .finally(() => {
        syncInProgress = false;
    });
});
