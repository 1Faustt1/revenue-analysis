/* main.js — свяжем UI, генератор и БД
   - Комментарии к логике внутри
*/
(function(){
  // Cache UI elements
  const genBtn = document.getElementById('generate-btn');
  const clearBtn = document.getElementById('clear-db');
  const exportBtn = document.getElementById('export-csv');
  const importInput = document.getElementById('import-csv');
  const searchInput = document.getElementById('search-id');
  const dayButtons = Array.from(document.querySelectorAll('.controls__day'));
  const reportBtn = document.getElementById('report-btn');
  const sidebarItems = Array.from(document.querySelectorAll('.sidebar__item'));
  const panelProgram = document.getElementById('panel-program');
  const tableBody = document.querySelector('#applicants-table tbody');
  const filterConsent = document.getElementById('filter-consent');
  const sortBy = document.getElementById('sort-by');

  let generated = {}; // generated lists per day
  let selectedDay = '2025-08-01';
  let selectedProgram = null; // null => all

  // status helper
  const statusEl = document.getElementById('status');
  function setStatus(msg){ if(statusEl) statusEl.textContent = `Статус: ${msg}`; } 
  setStatus('готов');

  // UI helpers
  function renderTable(rows){
    tableBody.innerHTML = '';
    rows.forEach(r=>{
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${r.id}</td><td>${r.program}</td><td>${r.priority}</td><td>${r.consent? 'Да':'Нет'}</td><td>${r.sum}</td>`;
      tableBody.appendChild(tr);
    });
  }

  // Build rows from generated lists (used when DB doesn't contain day data)
  function buildRowsFromLists(day,program){
    const lists = generated[day] || {};
    let rows = [];
    Object.keys(lists).forEach(p=>{
      if(program && p!==program) return;
      lists[p].forEach(item=> rows.push(Object.assign({program:p},item)));
    });
    return rows;
  }

  // Apply filters, search, program filter and sorting to any rows array
  function applyFiltersAndSort(rows, program){
    let out = rows.slice();
    // program filter (if provided)
    if(program){ out = out.filter(r=> String(r.program) === String(program)); }
    // filtering
    const f = filterConsent.value;
    if(f==='yes') out = out.filter(r=>r.consent);
    if(f==='no') out = out.filter(r=>!r.consent);
    // search by ID
    const q = (searchInput && searchInput.value.trim());
    if(q) out = out.filter(r=> String(r.id).includes(q));
    // sorting
    const s = sortBy.value;
    if(s==='sum-desc') out.sort((a,b)=>b.sum-a.sum);
    if(s==='sum-asc') out.sort((a,b)=>a.sum-b.sum);
    if(s==='id') out.sort((a,b)=>a.id-b.id);
    return out;
  }

  // Render table for currently selected day (prefer DB data if present)
  async function renderSelectedDay(program=null){
    const day = selectedDay;
    try{
      const all = await DB.getAll();
      const dbRows = all.filter(x=> x.day === day).map(x=> Object.assign({program:x.program}, x));
      let rows = dbRows.length ? dbRows : buildRowsFromLists(day, program);
      rows = applyFiltersAndSort(rows, program);
      renderTable(rows);
    }catch(err){
      // fallback to generated lists
      const rows = applyFiltersAndSort(buildRowsFromLists(day, program));
      renderTable(rows);
    }
  }

  // Export table to CSV (semicolon-separated for Excel compatibility)
  async function exportCSV(){
    // prefer DB rows for the selected day if available
    let rows = [];
    try{
      const all = await DB.getAll();
      const dbRows = all.filter(x=> x.day === selectedDay).map(x=> Object.assign({program:x.program}, x));
      rows = dbRows.length ? dbRows : buildRowsFromLists(selectedDay, selectedProgram);
    }catch(e){ rows = buildRowsFromLists(selectedDay, selectedProgram); }

    if(!rows.length){ alert('Нет данных для экспорта'); return; }
    const headers = ['ID','Program','Priority','Consent','Physics','Rus','Math','Indiv','Sum','Day'];
    const sep = ';';
    const lines = [];
    // BOM for Excel UTF-8
    lines.push('\uFEFF' + headers.join(sep));
    rows.forEach(r=>{
      const vals = [r.id, r.program, r.priority, r.consent ? 'Да' : 'Нет', r.physics, r.rus, r.math, r.indiv, r.sum, selectedDay];
      // escape semicolons and quotes
      const row = vals.map(v=> typeof v === 'string' ? `"${v.replace(/"/g,'""') }"` : v).join(sep);
      lines.push(row);
    });
    const blob = new Blob([lines.join('\n')], {type: 'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `applicants-${selectedDay}.csv`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  // CSV parsing helpers
  function parseLine(line, sep){
    const res=[]; let cur=''; let inQuotes=false;
    for(let i=0;i<line.length;i++){
      const ch = line[i];
      if(inQuotes){
        if(ch === '"'){
          if(line[i+1] === '"'){ cur += '"'; i++; } else { inQuotes = false; }
        } else { cur += ch; }
      } else {
        if(ch === '"'){ inQuotes = true; }
        else if(ch === sep){ res.push(cur); cur=''; }
        else { cur += ch; }
      }
    }
    res.push(cur);
    return res.map(s=> s.trim());
  }

  function parseCSV(text, sep=';'){
    const lines = text.replace(/\r/g,'').split('\n').filter(l=>l.trim() !== '');
    if(lines.length === 0) return [];
    const header = parseLine(lines[0], sep).map(h=>h.replace(/^\uFEFF/, '').trim());
    const data = [];
    for(let i=1;i<lines.length;i++){
      const fields = parseLine(lines[i], sep);
      if(fields.length === 1 && fields[0] === '') continue;
      const obj = {};
      header.forEach((h, idx)=> obj[h] = (fields[idx] !== undefined ? fields[idx] : '').trim());
      data.push(obj);
    }
    return data;
  }

  async function handleImportFile(file){
    try{
      setStatus(`Файл ${file.name} выбран. Чтение...`);
      const text = await file.text();
      // detect separator automatically
      const firstLine = text.replace(/\r/g,'').split('\n').find(l=>l && l.trim());
      const sep = firstLine && firstLine.indexOf(';') >= 0 ? ';' : (firstLine && firstLine.indexOf(',') >= 0 ? ',' : ';');
      setStatus(`Парсер: разделитель "${sep}"`);
      const rows = parseCSV(text, sep);
      if(!rows || !rows.length){ setStatus('Ошибка: файл пуст или неверный формат'); alert('Файл пуст или неверный формат'); return; }
      const daysMap = {};
      rows.forEach(r=>{
        const dayVal = r['Day'] || r['day'] || r['Дата'] || selectedDay;
        let dayKey = dayVal;
        if(dayKey && /^\d{2}\.\d{2}$/.test(dayKey)){
          const [d,m] = dayKey.split('.'); dayKey = `2025-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
        }
        if(!dayKey) dayKey = selectedDay;
        const programRaw = r['Program'] || r['program'] || r['Программа'] || r['OP'] || r['op'] || '';
        const progMap = {'ПМ':'PM','ИВТ':'IVT','ИТСС':'ITSS','ИБ':'IB','PM':'PM','IVT':'IVT','ITSS':'ITSS','IB':'IB'};
        const program = (progMap[programRaw] || programRaw || '').toString().trim();
        if(!program) return;
        if(!daysMap[dayKey]) daysMap[dayKey] = {PM:[],IVT:[],ITSS:[],IB:[]};
        const id = Number((r['ID'] || r['Id'] || r['id'] || '').toString().replace(/\D/g,'')) || 0;
        const physics = Number(r['Physics'] || r['physics'] || r['Физика'] || r['phys'] || 0);
        const rus = Number(r['Rus'] || r['rus'] || r['Рус'] || r['ru'] || 0);
        const math = Number(r['Math'] || r['math'] || r['Математика'] || r['maths'] || 0);
        const indiv = Number(r['Indiv'] || r['indiv'] || r['Индив'] || r['ind'] || 0);
        const sumVal = Number(r['Sum'] || r['sum'] || r['Сумма'] || 0);
        const sum = sumVal || (physics + rus + math + indiv);
        const priority = Number(r['Priority'] || r['priority'] || r['Приоритет'] || 1) || 1;
        const consentRaw = (r['Consent'] || r['consent'] || r['Согласие'] || '').toString();
        const consent = /^(y|yes|да|true|1|Да)$/i.test(consentRaw.trim());
        daysMap[dayKey][program].push({id, consent, priority, physics, rus, math, indiv, sum});
      });

      const keys = Object.keys(daysMap);
      if(!keys.length){ setStatus('Файл прочитан, но записей не обнаружено (проверьте заголовки).'); alert('Файл прочитан, но записей не обнаружено (проверьте заголовки).'); return; }

      setStatus(`Начинается импорт ${keys.length} дней...`);
      let totalPut = 0; let totalDel = 0; let totalTime = 0;
      for(const dKey of keys){
        const lists = daysMap[dKey];
        const t0 = performance.now();
        const res = await DB.updateFromLists(lists, dKey);
        const t1 = performance.now();
        totalPut += res.put; totalDel += res.deleted; totalTime += (t1-t0);
        setStatus(`Импорт для ${dKey}: добавлено/обновлено ${res.put}, удалено ${res.deleted}`);
      }

      setStatus(`Импорт завершён: добавлено/обновлено ${totalPut}, удалено ${totalDel}.`);
      alert(`Импорт завершён: добавлено/обновлено ${totalPut}, удалено ${totalDel}.`);

      const first = keys[0];
      if(first){
        selectedDay = first;
        // highlight day button if exists
        const b = document.querySelector(`.controls__day[data-day="${selectedDay}"]`);
        if(b){
          dayButtons.forEach(x=> x.removeAttribute('aria-selected'));
          b.setAttribute('aria-selected','true');
        }
      }

      // Render from DB for the selected day
      await renderSelectedDay(selectedProgram);

    }catch(err){ console.error(err); setStatus('Ошибка импорта: ' + (err && err.message || err)); alert('Ошибка импорта: ' + (err && err.message || err)); }
  }

  importInput && importInput.addEventListener('change', (e)=> {
    const f = e.target.files && e.target.files[0];
    if(!f) return;
    handleImportFile(f);
    e.target.value = '';
  });

  // Event handlers
  genBtn.addEventListener('click', async ()=>{
    setStatus('Генерация списков...');
    generated = Generator.generateAll();
    setStatus('Списки сгенерированы. Сохраняем в БД...');
    // automatically save generated lists for all days to DB
    let totalPut = 0; let totalDel = 0;
    const dayKeys = Object.keys(generated);
    for(const d of dayKeys){
      const t0 = performance.now();
      const res = await DB.updateFromLists(generated[d], d);
      const t1 = performance.now();
      totalPut += res.put; totalDel += res.deleted;
      console.log(`Saved ${d}: put=${res.put}, del=${res.deleted}, time=${(t1-t0).toFixed(1)}ms`);
    }
    setStatus(`Генерация и сохранение завершены: put=${totalPut}, del=${totalDel}`);
    alert(`Генерация завершена и списки сохранены в БД. Добавлено/обновлено: ${totalPut}, удалено: ${totalDel}`);
    // render current day from DB
    await renderSelectedDay(selectedProgram);
  });

  dayButtons.forEach(btn=> btn.addEventListener('click', async ()=>{
    dayButtons.forEach(b=> b.removeAttribute('aria-selected'));
    btn.setAttribute('aria-selected','true');
    selectedDay = btn.dataset.day;
    await renderSelectedDay(selectedProgram);
  }));

  sidebarItems.forEach(it=> it.addEventListener('click', async ()=>{
    sidebarItems.forEach(x=> x.removeAttribute('aria-selected'));
    it.setAttribute('aria-selected','true');
    const prog = it.dataset.program;
    selectedProgram = prog ? prog : null;
    panelProgram.textContent = selectedProgram || 'Все';
    await renderSelectedDay(selectedProgram);
  }));

  clearBtn.addEventListener('click', async ()=>{
    if(!confirm('Очистить локальную БД?')) return;
    await DB.clearDB();
    alert('БД очищена');
    await renderSelectedDay(selectedProgram);
  });



  reportBtn.addEventListener('click', async ()=>{
    try{
      setStatus('Формирование отчёта: подготовка данных...');
      // If we have generated lists, use them; otherwise build lists from DB data
      let listsSource = generated;
      if(!generated || Object.keys(generated).length === 0){
        const all = await DB.getAll();
        const temp = {};
        all.forEach(a=>{
          const d = a.day || selectedDay;
          if(!temp[d]) temp[d] = {PM:[],IVT:[],ITSS:[],IB:[]};
          const item = { id: a.id, consent: a.consent, priority: a.priority, physics: a.physics, rus: a.rus, math: a.math, indiv: a.indiv, sum: a.sum };
          if(!temp[d][a.program]) temp[d][a.program] = [];
          temp[d][a.program].push(item);
        });
        listsSource = temp;
      }

      const admissions = await DB.computeAdmissionsForDay(selectedDay);
      await Report.createReport(selectedDay, listsSource, admissions);
      setStatus('Отчёт сформирован');
    }catch(err){
      console.error(err);
      alert('Ошибка при формировании отчёта: ' + (err && err.message || err));
      setStatus('Ошибка формирования отчёта');
    }
  });

  exportBtn.addEventListener('click', exportCSV);
  searchInput && searchInput.addEventListener('input', async ()=>{
    await renderSelectedDay(selectedProgram);
  });

  filterConsent.addEventListener('change', async ()=>{
    await renderSelectedDay(selectedProgram);
  });
  sortBy.addEventListener('change', async ()=>{
    await renderSelectedDay(selectedProgram);
  });

  // On load: pre-select first day
  window.addEventListener('load', ()=>{
    document.querySelector('.controls__day[data-day="2025-08-01"]').click();
    const allBtn = document.querySelector('.sidebar__item[data-program=""]');
    if(allBtn){ allBtn.click(); }
  });
})();