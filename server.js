const express = require('express');
const fs = require('fs');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const path = require('path');
const app = express();

app.use(express.static('public'));
app.use(express.json({ limit: '50mb' }));

// --- 1. BUSCADOR DINÁMICO DEL ARCHIVO CSV ---
function encontrarCSV() {
    const nombreExacto = 'Untitled spreadsheet - Sheet1.csv';
    const rutaExacta = path.join(__dirname, nombreExacto);
    if (fs.existsSync(rutaExacta)) return rutaExacta;
    const archivos = fs.readdirSync(__dirname);
    const f = archivos.find(a => a.toLowerCase().includes('untitled spreadsheet') && a.endsWith('.csv'));
    return f ? path.join(__dirname, f) : null;
}

let DB_PATH = encontrarCSV();

// --- RUTA DEL CSV MAESTRO (Warehouse Counter Part) ---
const WAREHOUSE_CSV_PATH = path.join(__dirname, 'warehouse_master.csv');

// --- 2. FUNCIONES DE LECTURA Y ESCRITURA ---
const leerCSV = (ruta) => {
    return new Promise((resolve) => {
        const resultados = [];
        if (!ruta || !fs.existsSync(ruta)) return resolve([]);
        fs.createReadStream(ruta)
            .pipe(csv())
            .on('data', (data) => {
                const limpio = {};
                for (let key in data) {
                    if (key) {
                        const valor = data[key] ? data[key].trim() : "";
                        limpio[key.trim()] = valor;
                    }
                }
                resultados.push(limpio);
            })
            .on('end', () => resolve(resultados));
    });
};

const guardarCSV = async (data) => {
    if (!data || data.length === 0) return;
    const headers = Object.keys(data[0]).map(k => ({ id: k, title: k }));
    const writer = createCsvWriter({
        path: DB_PATH,
        header: headers
    });
    await writer.writeRecords(data);
};

// --- Cache del warehouse para eficiencia ---
let warehouseCache = null;
async function getWarehouseMap() {
    if (warehouseCache) return warehouseCache;
    const rows = await leerCSV(WAREHOUSE_CSV_PATH);
    const map = {};
    rows.forEach(r => {
        const key = (r['Item Number'] || '').toString().trim();
        if (key) map[key] = r;
    });
    warehouseCache = map;
    return map;
}
function invalidateWarehouseCache() {
    warehouseCache = null;
}

// ================================================================
// RUTAS EXISTENTES (tu código original, sin tocar)
// ================================================================

// A. Buscador para Sugerencias (index.html y picking.html)
app.get('/search', async (req, res) => {
    const q = (req.query.q || "").toUpperCase().trim();
    if (!DB_PATH) return res.status(500).json({ error: "Archivo CSV no encontrado" });
    const data = await leerCSV(DB_PATH);
    if (q === "") return res.json(data);
    const filtered = data.filter(i =>
        (i.ITEM && i.ITEM.toString().includes(q)) ||
        (i.Description && i.Description.toUpperCase().includes(q)) ||
        (i['short desc'] && i['short desc'].toUpperCase().includes(q))
    ).slice(0, 50);
    res.json(filtered);
});

// B. Inventario Maestro con Filtros (inventario.html)
app.get('/api/inventario-completo', async (req, res) => {
    const { categoria, q } = req.query;
    const data = await leerCSV(DB_PATH);
    const categorias = [...new Set(data.map(item => item.categoria || 'GENERAL'))];
    let filtrados = data;
    if (categoria && categoria !== 'TODAS') {
        filtrados = filtrados.filter(p => (p.categoria || 'GENERAL') === categoria);
    }
    if (q) {
        const query = q.toUpperCase();
        filtrados = filtrados.filter(p =>
            p.ITEM.includes(query) || p.Description.toUpperCase().includes(query)
        );
    }
    res.json({ productos: filtrados, categorias });
});

// C. Actualización Individual (index.html)
app.post('/update-stock', async (req, res) => {
    const { item, stock, mc, location } = req.body;
    try {
        let data = await leerCSV(DB_PATH);
        const idx = data.findIndex(p => p.ITEM.toString().trim() === item.toString().trim());
        if (idx !== -1) {
            data[idx].STOCK = stock;
            data[idx].MC = mc;
            data[idx].loc = location ? location.toUpperCase() : (data[idx].loc || "");
            await guardarCSV(data);
            res.json({ success: true });
        } else { res.status(404).json({ success: false, message: "Item no encontrado" }); }
    } catch (error) { res.status(500).json({ success: false }); }
});

// C2. Alias /update (el index.html original usa esta ruta)
app.post('/update', async (req, res) => {
    const { item, nuevoStock, nuevoMC, nuevaLoc } = req.body;
    try {
        let data = await leerCSV(DB_PATH);
        const idx = data.findIndex(p => p.ITEM.toString().trim() === item.toString().trim());
        if (idx !== -1) {
            data[idx].STOCK = nuevoStock;
            if (nuevoMC !== undefined && nuevoMC !== null && nuevoMC !== '') data[idx].MC = nuevoMC;
            if (nuevaLoc !== undefined) data[idx].loc = (nuevaLoc || "").toUpperCase();
            await guardarCSV(data);
            res.json({ success: true });
        } else {
            res.status(404).json({ success: false });
        }
    } catch (e) { res.status(500).json({ success: false }); }
});

// D. Proceso Masivo de ENTRADA (entrada.html)
app.post('/api/process-bulk-entry', async (req, res) => {
    const itemsEntrada = req.body;
    try {
        let data = await leerCSV(DB_PATH);
        itemsEntrada.forEach(entrada => {
            const idx = data.findIndex(p => p.ITEM.toString().trim() === entrada.item.toString().trim());
            if (idx !== -1) {
                const stockActual = parseInt(data[idx].STOCK) || 0;
                data[idx].STOCK = stockActual + parseInt(entrada.qty);
                if (entrada.mc) data[idx].MC = entrada.mc;
                if (entrada.loc) data[idx].loc = entrada.loc.toUpperCase();
            }
        });
        await guardarCSV(data);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// E. Proceso Masivo de PICKING / SALIDA (picking.html)
app.post('/api/process-bulk-picking', async (req, res) => {
    const itemsPicking = req.body;
    try {
        let data = await leerCSV(DB_PATH);
        itemsPicking.forEach(pick => {
            const idx = data.findIndex(p => p.ITEM.toString().trim() === pick.item.toString().trim());
            if (idx !== -1) {
                const stockActual = parseInt(data[idx].STOCK) || 0;
                data[idx].STOCK = Math.max(0, stockActual - parseInt(pick.pick));
                if (pick.mc_val) data[idx].MC = pick.mc_val;
                if (pick.loc) data[idx].loc = pick.loc.toUpperCase();
            }
        });
        await guardarCSV(data);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ================================================================
// NUEVAS RUTAS: SISTEMA MAESTRO WAREHOUSE (solo las agregadas hoy)
// ================================================================

// Upload del CSV maestro - usa express.raw con type: () => true para capturar CUALQUIER Content-Type
app.post('/api/upload-warehouse',
    express.raw({ limit: '50mb', type: () => true }),
    (req, res) => {
        try {
            let contenido;
            if (Buffer.isBuffer(req.body)) {
                contenido = req.body.toString('utf8');
            } else if (typeof req.body === 'string') {
                contenido = req.body;
            } else {
                return res.status(400).json({ success: false, error: 'No se recibió contenido' });
            }

            if (!contenido || contenido.length < 10) {
                return res.status(400).json({ success: false, error: 'Archivo vacío o inválido' });
            }

            // Quitar BOM (Byte Order Mark) si existe
            if (contenido.charCodeAt(0) === 0xFEFF) {
                contenido = contenido.substring(1);
            }

            fs.writeFileSync(WAREHOUSE_CSV_PATH, contenido);
            invalidateWarehouseCache();

            const lineas = contenido.split('\n').filter(l => l.trim()).length - 1;
            console.log(`✓ CSV Maestro actualizado: ${lineas} registros (${contenido.length} bytes)`);

            res.json({
                success: true,
                message: 'Archivo maestro actualizado correctamente',
                registros: lineas,
                bytes: contenido.length,
                timestamp: new Date().toISOString()
            });
        } catch (e) {
            console.error('Error upload-warehouse:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    }
);

// Info del warehouse para un ítem específico
app.get('/api/warehouse-item/:item', async (req, res) => {
    try {
        const map = await getWarehouseMap();
        const info = map[req.params.item.toString().trim()] || null;
        res.json(info);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Estado del archivo maestro
app.get('/api/warehouse-status', (req, res) => {
    if (!fs.existsSync(WAREHOUSE_CSV_PATH)) {
        return res.json({ loaded: false });
    }
    const stats = fs.statSync(WAREHOUSE_CSV_PATH);
    res.json({
        loaded: true,
        lastUpdate: stats.mtime,
        size: stats.size
    });
});

// Comparación: Stock Local vs columna I (WAREHOUSE)
app.get('/api/comparacion', async (req, res) => {
    try {
        const mainData = await leerCSV(DB_PATH);
        const warehouseMap = await getWarehouseMap();

        const resultado = mainData.map(item => {
            const itemKey = (item.ITEM || '').toString().trim();
            const wh = warehouseMap[itemKey];
            const stockLocal = parseInt(item.STOCK) || 0;
            const stockWarehouse = wh ? (parseInt(wh.WAREHOUSE) || 0) : null;
            const diferencia = wh ? (stockLocal - stockWarehouse) : null;

            return {
                item: itemKey,
                desc: item.Description || '',
                shortDesc: item['short desc'] || '',
                loc: item.loc || '',
                stockLocal,
                stockWarehouse,
                diferencia,
                encontrado: !!wh,
                priceOB: wh ? wh.PriceOB : null,
                all: wh ? wh.ALL : null,
                stmaria: wh ? wh.STMARIA : null,
                salina: wh ? wh.SALINA : null,
                stmwh: wh ? wh.STMWH : null,
            };
        });

        const stats = {
            total: resultado.length,
            encontrados: resultado.filter(r => r.encontrado).length,
            no_encontrados: resultado.filter(r => !r.encontrado).length,
            coinciden: resultado.filter(r => r.encontrado && r.diferencia === 0).length,
            difieren: resultado.filter(r => r.encontrado && r.diferencia !== 0).length,
            faltante_local: resultado.filter(r => r.encontrado && r.diferencia < 0).length,
            sobrante_local: resultado.filter(r => r.encontrado && r.diferencia > 0).length,
        };

        res.json({ items: resultado, stats });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- INICIO ---
const PORT = 4000;
app.listen(PORT, () => {
    console.log(`\n==========================================`);
    console.log(`🚀 BETTERDEALS LOGISTICS - ONLINE`);
    console.log(`📡 PUERTO: ${PORT}`);
    console.log(`📂 CSV Local: ${DB_PATH || '⚠️ NO ENCONTRADO'}`);
    console.log(`📂 CSV Maestro: ${fs.existsSync(WAREHOUSE_CSV_PATH) ? 'CARGADO ✓' : '⏳ Pendiente de subir'}`);
    console.log(`==========================================\n`);
});