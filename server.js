const express = require('express');
const fs = require('fs');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const path = require('path');
const app = express();

app.use(express.static('public'));
app.use(express.json({ limit: '50mb' }));

// --- CARPETA DE FOTOS ---
const FOTOS_PATH = path.join(__dirname, 'fotos');
app.use('/fotos', express.static(FOTOS_PATH));

// Endpoint foto por item
app.get('/api/foto/:item', (req, res) => {
    const item = req.params.item.toString().trim();
    const exts = ['jpg', 'jpeg', 'png', 'webp', 'JPG', 'JPEG', 'PNG'];
    for (const ext of exts) {
        const ruta = path.join(FOTOS_PATH, `${item}.${ext}`);
        if (fs.existsSync(ruta)) {
            return res.json({ found: true, url: `/fotos/${item}.${ext}` });
        }
    }
    res.json({ found: false });
});

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

// --- CSV MAESTRO (Warehouse Counter Part) ---
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
    const writer = createCsvWriter({ path: DB_PATH, header: headers });
    await writer.writeRecords(data);
};

// Cache warehouse
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
function invalidateWarehouseCache() { warehouseCache = null; }

// ================================================================
// RUTAS ORIGINALES
// ================================================================

// A. Buscador
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

// B. Inventario Maestro con Filtros
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

// C. Actualización Individual
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

// C2. Alias /update
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
        } else { res.status(404).json({ success: false }); }
    } catch (e) { res.status(500).json({ success: false }); }
});

// D. Entrada Masiva
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

// E. Picking Masivo
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
// RUTAS WAREHOUSE MAESTRO
// ================================================================

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
            if (contenido.charCodeAt(0) === 0xFEFF) contenido = contenido.substring(1);
            fs.writeFileSync(WAREHOUSE_CSV_PATH, contenido);
            invalidateWarehouseCache();
            const lineas = contenido.split('\n').filter(l => l.trim()).length - 1;
            res.json({ success: true, message: 'Archivo maestro actualizado', registros: lineas, timestamp: new Date().toISOString() });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    }
);

app.get('/api/warehouse-item/:item', async (req, res) => {
    try {
        const map = await getWarehouseMap();
        const info = map[req.params.item.toString().trim()] || null;
        res.json(info);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/warehouse-status', (req, res) => {
    if (!fs.existsSync(WAREHOUSE_CSV_PATH)) return res.json({ loaded: false });
    const stats = fs.statSync(WAREHOUSE_CSV_PATH);
    res.json({ loaded: true, lastUpdate: stats.mtime, size: stats.size });
});

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
                cat: item.categoria || '',
                desc: item.Description || '',
                shortDesc: item['short desc'] || '',
                loc: item.loc || '',
                stockLocal, stockWarehouse, diferencia,
                encontrado: !!wh,
                salina: wh ? (parseInt(wh.SALINA) || 0) : null,
                priceOB: wh ? wh.PriceOB : null,
                all: wh ? wh.ALL : null,
                stmaria: wh ? wh.STMARIA : null,
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
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Retorna TODOS los items del maestro como mapa {itemNumber: row}
// Usado por pedidos.html para lookups masivos sin múltiples requests
app.get('/api/warehouse-all', async (req, res) => {
    try {
        if (!fs.existsSync(WAREHOUSE_CSV_PATH)) return res.json({ loaded: false, map: {} });
        const map = await getWarehouseMap();
        res.json({ loaded: true, map });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ================================================================
// PEDIDOS: Persiste MAXIMOS del CSV de pedidos en servidor
// ================================================================
const PEDIDOS_PATH = path.join(__dirname, 'pedidos_maximos.json');

function splitCSVLineSrv(line) {
    const result = []; let current = ''; let inQuotes = false;
    for (let i = 0; i < (line || '').length; i++) {
        const ch = line[i];
        if (ch === '"') { inQuotes = !inQuotes; }
        else if (ch === ',' && !inQuotes) { result.push(current); current = ''; }
        else { current += ch; }
    }
    result.push(current);
    return result;
}

// Subir CSV pedidos → persiste en servidor
app.post('/api/upload-pedidos',
    express.raw({ limit: '20mb', type: () => true }),
    (req, res) => {
        try {
            let contenido;
            if (Buffer.isBuffer(req.body)) contenido = req.body.toString('utf8');
            else if (typeof req.body === 'string') contenido = req.body;
            else return res.status(400).json({ success: false, error: 'Sin contenido' });
            if (contenido.charCodeAt(0) === 0xFEFF) contenido = contenido.substring(1);

            const lineas = contenido.split(/\r?\n/);
            const mapa = {};
            let count = 0;
            for (let i = 1; i < lineas.length; i++) {
                const cols = splitCSVLineSrv(lineas[i]);
                if (!cols || cols.length < 5) continue;
                const cat = (cols[0]||'').trim(), item = (cols[1]||'').trim();
                const desc = (cols[2]||'').trim(), shortDesc = (cols[3]||'').trim();
                const max = parseInt(cols[4]) || 0;
                if (!item || item==='TEMPLATE' || cat==='UNDEFINED' || cat==='SERVICE') continue;
                if (!cat || !item || max <= 0) continue;
                mapa[item] = { cat, desc, shortDesc, max };
                count++;
            }
            const payload = { items: mapa, updatedAt: new Date().toISOString(), total: count };
            fs.writeFileSync(PEDIDOS_PATH, JSON.stringify(payload));
            res.json({ success: true, total: count, updatedAt: payload.updatedAt });
        } catch (e) { res.status(500).json({ success: false, error: e.message }); }
    }
);

// Leer datos de pedidos
app.get('/api/pedidos-data', (req, res) => {
    if (!fs.existsSync(PEDIDOS_PATH)) return res.json({ loaded: false, items: {}, updatedAt: null });
    try {
        const data = JSON.parse(fs.readFileSync(PEDIDOS_PATH, 'utf8'));
        res.json({ loaded: true, items: data.items || {}, updatedAt: data.updatedAt, total: data.total });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Actualizar MAX de un ítem (edición manual en pantalla)
app.patch('/api/pedidos-data/:item', (req, res) => {
    const itemKey = req.params.item;
    try {
        if (!fs.existsSync(PEDIDOS_PATH)) return res.status(404).json({ error: 'No hay datos' });
        const data = JSON.parse(fs.readFileSync(PEDIDOS_PATH, 'utf8'));
        if (data.items[itemKey]) {
            data.items[itemKey].max = parseInt(req.body.max) || data.items[itemKey].max;
        } else {
            data.items[itemKey] = req.body;
        }
        data.updatedAt = new Date().toISOString();
        fs.writeFileSync(PEDIDOS_PATH, JSON.stringify(data));
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Agregar ítem manualmente al mapa
app.post('/api/pedidos-data', (req, res) => {
    try {
        let data = { items: {}, updatedAt: new Date().toISOString(), total: 0 };
        if (fs.existsSync(PEDIDOS_PATH)) {
            try { data = JSON.parse(fs.readFileSync(PEDIDOS_PATH, 'utf8')); } catch(e) {}
        }
        const { item, cat, desc, shortDesc, max } = req.body;
        if (!item || !max) return res.status(400).json({ error: 'item y max requeridos' });
        data.items[item] = { cat: cat||'MANUAL', desc: desc||'', shortDesc: shortDesc||'', max: parseInt(max) };
        data.updatedAt = new Date().toISOString();
        data.total = Object.keys(data.items).length;
        fs.writeFileSync(PEDIDOS_PATH, JSON.stringify(data));
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ================================================================
// SYNC EN TIEMPO REAL — Server-Sent Events (SSE)
// ================================================================
const sseClients = { entrada: new Set(), picking: new Set() };

// Cliente se conecta al stream → recibe actualizaciones en vivo
app.get('/api/sync/stream/:lista', (req, res) => {
    const lista = req.params.lista;
    if (!sseClients[lista]) return res.status(400).end();

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    sseClients[lista].add(res);

    // Enviar estado actual al conectarse
    const filePath = lista === 'entrada'
        ? path.join(__dirname, 'sync_entrada.json')
        : path.join(__dirname, 'sync_picking.json');
    if (fs.existsSync(filePath)) {
        try { res.write(`data: ${fs.readFileSync(filePath, 'utf8')}\n\n`); } catch(e) {}
    }

    // Heartbeat cada 25s para mantener conexión viva
    const hb = setInterval(() => { try { res.write(': hb\n\n'); } catch(e) {} }, 25000);

    req.on('close', () => {
        sseClients[lista].delete(res);
        clearInterval(hb);
    });
});

// Guardar lista y transmitir a todos los dispositivos conectados
app.post('/api/sync/:lista', (req, res) => {
    const lista = req.params.lista;
    if (!sseClients[lista]) return res.status(400).json({ error: 'Lista inválida' });
    try {
        const deviceId = req.body.deviceId || '';
        const payload = JSON.stringify({ items: req.body.items || [], deviceId });
        const filePath = lista === 'entrada'
            ? path.join(__dirname, 'sync_entrada.json')
            : path.join(__dirname, 'sync_picking.json');
        fs.writeFileSync(filePath, payload);
        // Broadcast a todos los clientes conectados
        sseClients[lista].forEach(client => {
            try { client.write(`data: ${payload}\n\n`); } catch(e) { sseClients[lista].delete(client); }
        });
        res.json({ success: true, clients: sseClients[lista].size });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ================================================================
// ANALÍTICA: CSV ventas 3 meses + historial costos
// ================================================================
const SOLD_PATH   = path.join(__dirname, 'analytics_sold.json');
const COSTOS_PATH = path.join(__dirname, 'analytics_costos.json');

// Upload CSV ventas 3 meses
app.post('/api/upload-sold',
    express.raw({ limit: '30mb', type: () => true }),
    (req, res) => {
        try {
            let txt = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body);
            if (txt.charCodeAt(0) === 0xFEFF) txt = txt.substring(1);
            const lines = txt.split(/\r?\n/).filter(l => l.trim());
            const map = {};
            for (let i = 1; i < lines.length; i++) {
                const cols = lines[i].split(',');
                const item = (cols[0]||'').trim();
                if (!item) continue;
                map[item] = {
                    desc:    (cols[1]||'').trim(),
                    stMaria: parseInt(cols[2]) || 0,
                    salina:  parseInt(cols[3]) || 0,
                    total:   parseInt(cols[4]) || 0
                };
            }
            fs.writeFileSync(SOLD_PATH, JSON.stringify({ map, updatedAt: new Date().toISOString() }));
            res.json({ success: true, total: Object.keys(map).length });
        } catch(e) { res.status(500).json({ error: e.message }); }
    }
);

// Upload CSV historial costos
app.post('/api/upload-costos',
    express.raw({ limit: '50mb', type: () => true }),
    (req, res) => {
        try {
            let txt = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body);
            if (txt.charCodeAt(0) === 0xFEFF) txt = txt.substring(1);
            const lines = txt.split(/\r?\n/).filter(l => l.trim());
            // parse header
            const header = splitCSVLineSrv(lines[0]);
            const idx = {
                shortD:   header.indexOf('SHORT D'),
                item:     header.indexOf('ITEM'),
                longDesc: header.indexOf('Long Description'),
                ship:     header.indexOf('SHIP'),
                control:  header.indexOf('CONTROL'),
                invoice:  header.indexOf('INVOICE'),
                pagina:   header.indexOf('PAGINA'),
                vendor:   header.indexOf('VENDOR'),
                duty:     header.indexOf('DUTY'),
                price:    header.indexOf('UNIT PRICE'),
                ncarga:   header.indexOf('N# CARGA'),
                fecha:    header.indexOf('FECHA'),
                qty:      header.indexOf('QTY TOTAL'),
                cat:      header.indexOf('CATEGORIA'),
                extPrice: header.indexOf('EXT PRICE'),
            };
            const map = {};
            for (let i = 1; i < lines.length; i++) {
                const c = splitCSVLineSrv(lines[i]);
                const item = (c[idx.item]||'').trim();
                if (!item) continue;
                const row = {
                    shortD:   (c[idx.shortD]||'').trim(),
                    longDesc: (c[idx.longDesc]||'').trim(),
                    invoice:  (c[idx.invoice]||'').trim(),
                    pagina:   (c[idx.pagina]||'').trim(),
                    vendor:   (c[idx.vendor]||'').trim(),
                    duty:     (c[idx.duty]||'').trim(),
                    price:    (c[idx.price]||'').trim(),
                    ncarga:   (c[idx.ncarga]||'').trim(),
                    fecha:    (c[idx.fecha]||'').trim(),
                    qty:      parseInt(c[idx.qty]) || 0,
                    cat:      (c[idx.cat]||'').trim(),
                    extPrice: (c[idx.extPrice]||'').trim(),
                };
                if (!map[item]) map[item] = [];
                map[item].push(row);
            }
            fs.writeFileSync(COSTOS_PATH, JSON.stringify({ map, updatedAt: new Date().toISOString() }));
            res.json({ success: true, items: Object.keys(map).length });
        } catch(e) { res.status(500).json({ error: e.message }); }
    }
);

// Status de archivos analítica
app.get('/api/analytics-status', (req, res) => {
    const sold   = fs.existsSync(SOLD_PATH)   ? JSON.parse(fs.readFileSync(SOLD_PATH,'utf8'))   : null;
    const costos = fs.existsSync(COSTOS_PATH) ? JSON.parse(fs.readFileSync(COSTOS_PATH,'utf8')) : null;
    res.json({
        sold:   sold   ? { loaded: true, total: Object.keys(sold.map).length,   updatedAt: sold.updatedAt }   : { loaded: false },
        costos: costos ? { loaded: true, items: Object.keys(costos.map).length, updatedAt: costos.updatedAt } : { loaded: false }
    });
});

// Datos completos de un ítem para analítica
app.get('/api/analytics/:item', async (req, res) => {
    try {
        const item = req.params.item.trim();
        const sold   = fs.existsSync(SOLD_PATH)   ? JSON.parse(fs.readFileSync(SOLD_PATH,'utf8')).map   : {};
        const costos = fs.existsSync(COSTOS_PATH) ? JSON.parse(fs.readFileSync(COSTOS_PATH,'utf8')).map : {};
        const maestro = await getWarehouseMap();

        const soldData   = sold[item]   || null;
        const historial  = costos[item] || [];
        const maestroRow = maestro[item]|| null;

        // Ordenar historial por fecha desc
        historial.sort((a, b) => {
            const da = new Date(a.fecha), db = new Date(b.fecha);
            return db - da;
        });

        const ultimo = historial[0] || null;

        res.json({
            item,
            sold: soldData,
            historial,
            ultimo,
            maestro: maestroRow,
            totalActual: maestroRow ? (parseInt(maestroRow.ALL) || 0) : null
        });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Todos los ítems para la tabla general de analítica
app.get('/api/analytics-all', async (req, res) => {
    try {
        if (!fs.existsSync(SOLD_PATH) || !fs.existsSync(COSTOS_PATH)) {
            return res.json({ loaded: false, items: [] });
        }
        const sold   = JSON.parse(fs.readFileSync(SOLD_PATH,'utf8')).map;
        const costos = JSON.parse(fs.readFileSync(COSTOS_PATH,'utf8')).map;
        const maestro = await getWarehouseMap();

        // Unión de todos los ítems
        const allItems = new Set([...Object.keys(sold), ...Object.keys(costos)]);
        const result = [];

        for (const item of allItems) {
            const s = sold[item] || null;
            const hist = (costos[item] || []).sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
            const ult = hist[0] || null;
            const m = maestro[item] || null;

            result.push({
                item,
                desc:        s ? s.desc : (ult ? ult.longDesc : ''),
                cat:         ult ? ult.cat : '',
                totalActual: m ? (parseInt(m.ALL) || 0) : null,
                vendido3m:   s ? s.total : 0,
                stMaria:     s ? s.stMaria : 0,
                salina:      s ? s.salina : 0,
                ultimaFecha: ult ? ult.fecha : '',
                ultimoInvoice: ult ? ult.invoice : '',
                ultimoPrecio:  ult ? ult.price : '',
                ultimoNCarga:  ult ? ult.ncarga : '',
                vendor:        ult ? ult.vendor : '',
                entradasTotales: hist.length
            });
        }

        res.json({ loaded: true, items: result });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// ================================================================
// CSV COMPARA PRECIO (fuente principal para recomendaciones)
// ================================================================
const COMPARA_PATH = path.join(__dirname, 'compara_precio.json');

app.post('/api/upload-compara',
    express.raw({ limit: '50mb', type: () => true }),
    (req, res) => {
        try {
            let txt = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body);
            if (txt.charCodeAt(0) === 0xFEFF) txt = txt.substring(1);
            const lines = txt.split(/\r?\n/).filter(l => l.trim());
            const header = splitCSVLineSrv(lines[0]);
            const map = {};
            let count = 0;
            for (let i = 1; i < lines.length; i++) {
                const c = splitCSVLineSrv(lines[i]);
                if (!c || c.length < 6) continue;
                const item = (c[2]||'').trim(); // col C = ITEM
                if (!item) continue;
                map[item] = {
                    cat:          (c[0]||'').trim(),   // A CATEG
                    shortD:       (c[1]||'').trim(),   // B SHORT D
                    desc:         (c[3]||'').trim(),   // D DESCRIPCION
                    invoice:      (c[4]||'').trim(),   // E INVOICE
                    qtyLastInv:   parseFloat(c[5])||0, // F QTY LAST INV
                    duty:         (c[6]||'').trim(),   // G DUTY
                    page:         (c[7]||'').trim(),   // H PAGE
                    vendor:       (c[8]||'').trim(),   // I VENDOR
                    ncarga:       (c[9]||'').trim(),   // J N# CARGA
                    dateLastIn:   (c[10]||'').trim(),  // K DATE LAST IN
                    priceLastIn:  (c[11]||'').trim(),  // L UNIT PRICE LAST IN
                    currentPrice: (c[12]||'').trim(),  // M CURRENT PRICE
                    inventario:   parseFloat(c[18])||0,// S INVENTARIO NETO
                    ventas3m:     parseFloat(c[19])||0,// T last 3 month sold
                    lastDaysSold: (c[20]||'').trim(),  // U LAST DAYS SOLD
                    loc:          (c[21]||'').trim(),  // V LOC
                    margen:       (c[34]||'').trim(),  // AI MARGEN
                    lastCost:     (c[35]||'').trim(),  // AJ LAST COST
                    priceVenta:   (c[36]||'').trim(),  // AK PRICE VENTA
                };
                count++;
            }
            fs.writeFileSync(COMPARA_PATH, JSON.stringify({ map, updatedAt: new Date().toISOString(), total: count }));
            res.json({ success: true, total: count, updatedAt: new Date().toISOString() });
        } catch(e) { res.status(500).json({ error: e.message }); }
    }
);

app.get('/api/compara-status', (req, res) => {
    if (!fs.existsSync(COMPARA_PATH)) return res.json({ loaded: false });
    try {
        const d = JSON.parse(fs.readFileSync(COMPARA_PATH, 'utf8'));
        res.json({ loaded: true, total: d.total, updatedAt: d.updatedAt });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/compara-all', (req, res) => {
    if (!fs.existsSync(COMPARA_PATH)) return res.json({ loaded: false, map: {} });
    try {
        const d = JSON.parse(fs.readFileSync(COMPARA_PATH, 'utf8'));
        res.json({ loaded: true, map: d.map });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/compara/:item', (req, res) => {
    if (!fs.existsSync(COMPARA_PATH)) return res.json(null);
    try {
        const d = JSON.parse(fs.readFileSync(COMPARA_PATH, 'utf8'));
        res.json(d.map[req.params.item.trim()] || null);
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// --- INICIO ---
const PORT = 4000;
app.listen(PORT, () => {
    console.log(`\n==========================================`);
    console.log(`🚀 BETTERDEALS LOGISTICS - ONLINE`);
    console.log(`📡 PUERTO: ${PORT}`);
    console.log(`📂 CSV Local: ${DB_PATH || '⚠️ NO ENCONTRADO'}`);
    console.log(`📂 CSV Maestro: ${fs.existsSync(WAREHOUSE_CSV_PATH) ? 'CARGADO ✓' : '⏳ Pendiente'}`);
    console.log(`==========================================\n`);
});