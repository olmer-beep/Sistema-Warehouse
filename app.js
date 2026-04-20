<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>BetterDeals Logistics Pro</title>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.23/jspdf.plugin.autotable.min.js"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700;800&display=swap" rel="stylesheet">
    <style>
        :root { --primary: #1e40af; --bg: #f1f5f9; --card: #ffffff; --border: #e2e8f0; --green: #10b981; --red: #ef4444; }
        body { font-family: 'Inter', sans-serif; background: var(--bg); margin: 0; padding: 20px; }
        .main-container { max-width: 1100px; margin: 0 auto; background: var(--card); border-radius: 16px; box-shadow: 0 10px 25px rgba(0,0,0,0.1); overflow: hidden; }
        .header { background: var(--primary); color: white; padding: 25px 40px; display: flex; justify-content: space-between; align-items: center; }
        .search-area { width: 45%; position: relative; }
        #search-input { width: 100%; padding: 12px 20px; border-radius: 30px; border: none; outline: none; }
        #sug-box { position: absolute; background: white; width: 100%; z-index: 100; border-radius: 12px; box-shadow: 0 8px 16px rgba(0,0,0,0.2); color: black; display: none; margin-top: 8px; max-height: 250px; overflow-y: auto; }
        .s-item { padding: 12px 20px; cursor: pointer; border-bottom: 1px solid #f1f5f9; font-size: 14px; }
        .s-item:hover { background: #eff6ff; }
        .content { display: grid; grid-template-columns: 1.8fr 1fr; gap: 30px; padding: 40px; }
        .field { display: flex; flex-direction: column; margin-bottom: 15px; }
        label { font-size: 11px; font-weight: 800; color: #64748b; text-transform: uppercase; margin-bottom: 6px; }
        input { padding: 14px; border: 1px solid var(--border); border-radius: 8px; font-size: 15px; }
        .editable { border: 2px solid var(--primary); font-weight: bold; }
        .loc-input { background: #fef3c7 !important; border-color: #f59e0b !important; }
        .inv-grid { background: #f8fafc; padding: 20px; border-radius: 12px; border: 1px solid var(--border); display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; }
        .stat-card { background: white; padding: 15px; border-radius: 10px; border: 1px solid var(--border); text-align: center; }
        .btn { padding: 14px 20px; border: none; border-radius: 8px; color: white; font-weight: 700; cursor: pointer; text-transform: uppercase; transition: 0.2s; }
        .btn-plus { background: var(--green); } .btn-minus { background: var(--red); }
        #modal-picking { display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); z-index:1000; padding:40px; }
        .modal-body { background: white; max-width: 950px; margin: 0 auto; border-radius: 16px; padding: 40px; height: 80vh; overflow-y: auto; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th { background: #f8fafc; padding: 12px; text-align: left; font-size: 12px; }
        td { padding: 12px; border-bottom: 1px solid #f1f5f9; font-size: 14px; }
        .pick-badge { background: #fee2e2; color: #dc2626; padding: 4px 8px; border-radius: 4px; font-weight: 800; }
    </style>
</head>
<body>
    <div class="main-container">
        <div class="header">
            <div style="font-weight: 800;">BETTERDEALS LOGISTICS</div>
            <div class="search-area">
                <input type="text" id="search-input" placeholder="Buscar producto...">
                <div id="sug-box"></div>
            </div>
            <button class="btn" style="background: #6366f1;" onclick="abrirPicking()">📋 Picking List</button>
        </div>
        <div class="content">
            <div>
                <div style="display: flex; gap:20px">
                    <div class="field" style="flex:1"><label>Item No.</label><input type="text" id="v-item" readonly></div>
                    <div class="field" style="flex:2"><label>Descripción</label><input type="text" id="v-desc" readonly></div>
                </div>
                <div class="field"><label>Locación N# 1</label><input type="text" id="id-loc" class="editable loc-input"></div>
                <div class="inv-grid">
                    <div class="stat-card" style="grid-column: span 2;"><label>Stock</label><div id="v-stock-txt" style="font-size:32px; font-weight:800; color:var(--primary);">0</div></div>
                    <div class="stat-card"><label>MC</label><input type="number" id="id-mc" class="editable" style="width:100%; text-align:center;" oninput="recalcular()"></div>
                    <div class="stat-card"><label>Cajas</label><div id="v-box-txt" style="font-size:24px; font-weight:700;">0</div></div>
                </div>
            </div>
            <div style="display:flex; flex-direction:column; gap:10px; background:#f8fafc; padding:20px; border-radius:12px;">
                <label>Ajuste Manual</label>
                <input type="number" id="q-ajuste" style="font-size:24px; text-align:center;">
                <button class="btn btn-plus" onclick="actualizar(1)">+ Aumentar</button>
                <button class="btn btn-minus" onclick="actualizar(-1)">- Descontar</button>
            </div>
        </div>
    </div>

    <div id="modal-picking">
        <div class="modal-body">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <h2>Picking List</h2>
                <div style="display:flex; gap:10px;">
                    <button class="btn btn-plus" onclick="exportarPDF()">📥 PDF</button>
                    <button class="btn" style="background:#059669;" onclick="confirmarMovimiento()">✅ Confirmar y Descontar Bodega</button>
                    <button class="btn" style="background:#64748b" onclick="cerrarPicking()">Cerrar</button>
                </div>
            </div>
            <table id="tabla-pick">
                <thead><tr><th>ITEM</th><th>DESC</th><th>TIENDA/MAX</th><th>BODEGA</th><th>SACAR</th></tr></thead>
                <tbody id="body-pick"></tbody>
            </table>
        </div>
    </div>

    <script>
        const sInput = document.getElementById('search-input');
        const sugBox = document.getElementById('sug-box');
        let currentItem = null, pickingData = [];

        sInput.addEventListener('input', async () => {
            const q = sInput.value.trim();
            if(q.length < 2) return;
            const res = await fetch(`/search?q=${q}`);
            const data = await res.json();
            sugBox.innerHTML = ''; sugBox.style.display = 'block';
            data.forEach(i => {
                const d = document.createElement('div'); d.className = 's-item';
                d.innerHTML = `<b>${i.ITEM}</b> - ${i.Description}`;
                d.onclick = () => {
                    currentItem = i;
                    document.getElementById('v-item').value = i.ITEM;
                    document.getElementById('v-desc').value = i.Description;
                    document.getElementById('id-loc').value = i.loc || "";
                    document.getElementById('v-stock-txt').innerText = i.STOCK;
                    document.getElementById('id-mc').value = i.MC || "";
                    recalcular(); sugBox.style.display = 'none'; sInput.value = '';
                };
                sugBox.appendChild(d);
            });
        });

        function recalcular() {
            const s = parseInt(document.getElementById('v-stock-txt').innerText) || 0;
            const m = parseInt(document.getElementById('id-mc').value) || 0;
            if(m <= 0) { document.getElementById('v-box-txt').innerText = s > 0 ? 1 : 0; return; }
            document.getElementById('v-box-txt').innerText = Math.ceil(s / m);
        }

        async function actualizar(sig) {
            if(!currentItem) return;
            const aj = parseInt(document.getElementById('q-ajuste').value) || 0;
            let ns = parseInt(document.getElementById('v-stock-txt').innerText) + (aj * sig);
            const res = await fetch('/update', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ item: currentItem.ITEM, nuevoStock: ns < 0 ? 0 : ns, nuevoMC: document.getElementById('id-mc').value, nuevaLoc: document.getElementById('id-loc').value })
            });
            if(res.ok) { document.getElementById('v-stock-txt').innerText = ns < 0 ? 0 : ns; recalcular(); }
        }

        async function abrirPicking() {
            const res = await fetch('/picking-list');
            pickingData = await res.json();
            document.getElementById('body-pick').innerHTML = pickingData.map(p => `
                <tr><td>${p.item}</td><td>${p.desc}</td><td>${p.sal}/${p.max}</td><td>${p.wh}</td><td><span class="pick-badge">${p.pick}</span></td></tr>
            `).join('');
            document.getElementById('modal-picking').style.display = 'block';
        }

        async function confirmarMovimiento() {
            if(!pickingData.length) return;
            if(!confirm("¿Confirmas que has sacado estos productos? Se restarán de la Bodega y se sumarán a Tienda en el sistema.")) return;

            const res = await fetch('/confirm-picking', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(pickingData)
            });

            if(res.ok) {
                alert("✅ Inventario de Bodega actualizado con éxito.");
                cerrarPicking();
            }
        }

        function cerrarPicking() { document.getElementById('modal-picking').style.display = 'none'; }
        
        function exportarPDF() {
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();
            doc.text("PICKING LIST - BETTERDEALS", 14, 15);
            doc.autoTable({ startY: 20, head: [['ITEM', 'DESC', 'TIENDA/MAX', 'BODEGA', 'PICK']], body: pickingData.map(p => [p.item, p.desc, `${p.sal}/${p.max}`, p.wh, p.pick]) });
            doc.save("picking.pdf");
        }
    </script>
</body>
</html>