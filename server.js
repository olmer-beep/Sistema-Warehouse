const express = require('express');
const fs = require('fs');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const path = require('path');
const app = express();

app.use(express.static('public')); // Asegúrate que tus HTML estén en una carpeta llamada 'public'
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
    // Extraemos los headers de las llaves del primer objeto
    const headers = Object.keys(data[0]).map(k => ({ id: k, title: k }));
    const writer = createCsvWriter({
        path: DB_PATH,
        header: headers
    });
    await writer.writeRecords(data);
};

// --- 3. RUTAS DEL SISTEMA ---

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
    
    // Obtener categorías únicas para el selector
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

// D. Proceso Masivo de ENTRADA (entrada.html)
app.post('/api/process-bulk-entry', async (req, res) => {
    const itemsEntrada = req.body; // Array de {item, qty, mc, loc}
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
    const itemsPicking = req.body; // Array de {item, pick, mc_val, loc}
    try {
        let data = await leerCSV(DB_PATH);
        itemsPicking.forEach(pick => {
            const idx = data.findIndex(p => p.ITEM.toString().trim() === pick.item.toString().trim());
            if (idx !== -1) {
                const stockActual = parseInt(data[idx].STOCK) || 0;
                // Restamos y aseguramos que no baje de 0
                data[idx].STOCK = Math.max(0, stockActual - parseInt(pick.pick));
                if (pick.mc_val) data[idx].MC = pick.mc_val;
                if (pick.loc) data[idx].loc = pick.loc.toUpperCase();
            }
        });
        await guardarCSV(data);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// --- INICIO ---
const PORT = 4000;
app.listen(PORT, () => {
    console.log(`\n==========================================`);
    console.log(`🚀 BETTERDEALS LOGISTICS - ONLINE`);
    console.log(`📡 PUERTO: ${PORT}`);
    console.log(`📂 CSV: ${DB_PATH || '⚠️ NO ENCONTRADO'}`);
    console.log(`==========================================\n`);
});