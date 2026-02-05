/* pdf.js — формирование PDF отчёта с использованием jsPDF и Chart.js (Canvas toDataURL)
   Экспорт: createReport(day, generatedLists)
*/
(async function(global){
  // Create a small canvas to draw chart; returns dataURL
  function drawLineChart(labels, datasets){
    return new Promise((res)=>{
      const canvas = document.createElement('canvas'); canvas.width=800; canvas.height=400;
      const ctx = canvas.getContext('2d');
      const chart = new Chart(ctx, {
        type: 'line', data: {labels, datasets},
        options:{plugins:{legend:{display:true}},responsive:false,interaction:{mode:'index'}}
      });
      // give Chart some time to render then destroy it
      setTimeout(()=>{ const dataUrl = canvas.toDataURL('image/png'); chart.destroy(); res(dataUrl); }, 450);
    });
  }

  function createTextImage(title, blocks){
    const canvas = document.createElement('canvas');
    const width = 792; // about A4 portrait at 72dpi
    const lineHeight = 20;
    // estimate height
    let linesCount = 2; // header + spacing
    blocks.forEach(b=> linesCount += (b.lines ? b.lines.length : 1) + 1);
    const height = Math.max(300, linesCount * lineHeight + 80);
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    // background
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,canvas.width,canvas.height);
    // title
    ctx.fillStyle = '#0b1220'; ctx.font = 'bold 18px Inter, Roboto, sans-serif';
    ctx.fillText(title, 20, 30);
    // content
    ctx.fillStyle = '#10203b'; ctx.font = '14px Inter, Roboto, sans-serif';
    let y = 60;
    blocks.forEach(block=>{
      if(block.title){ ctx.font = '600 14px Inter, Roboto, sans-serif'; ctx.fillText(block.title, 20, y); y += lineHeight; }
      ctx.font = '14px Inter, Roboto, sans-serif';
      if(block.lines){
        block.lines.forEach(l=>{ ctx.fillText(l, 30, y); y += lineHeight; });
      }
      y += 6;
    });
    return canvas.toDataURL('image/png');
  }

  async function createReport(day, generatedLists, admissions){
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({orientation:'portrait',unit:'pt',format:'a4'});

    // Header + passing scores + admitted lists rendered via Canvas (preserves UTF-8/Cyrillic)
    const blocks = [];
    const now = new Date();
    blocks.push({title: `Отчёт — ${day}` , lines: [`Сформирован: ${now.toLocaleString()}`]});

    const passLines = [];
    Object.keys(admissions.passing || {}).forEach(p=> passLines.push(`${p}: ${admissions.passing[p]}`));
    blocks.push({title: 'Проходные баллы:', lines: passLines});

    Object.keys(admissions.admitted || {}).forEach(p=>{
      const list = admissions.admitted[p] || [];
      const lines = list.map(a=> `${a.id} — ${a.sum}`);
      blocks.push({title: `Зачисленные (${p}):`, lines: lines.length ? lines : ['(пусто)']});
    });

    const imgHeader = createTextImage(`Отчёт — ${day}`, blocks);
    // load image to measure natural size and compute proper height for given width
    const headerImgEl = new Image();
    headerImgEl.src = imgHeader;
    await new Promise((r)=> { headerImgEl.onload = r; headerImgEl.onerror = r; });
    const w = 555;
    const h = headerImgEl.naturalWidth ? (w * (headerImgEl.naturalHeight / headerImgEl.naturalWidth)) : 150;
    doc.addImage(imgHeader, 'PNG', 20, 20, w, h);

    // Build dynamic passing data across all generated days
    const dayKeys = Object.keys(generatedLists).sort();
    const labels = dayKeys.map(d => { const dt = new Date(d); return dt.toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'}) });
    const codes = ['PM','IVT','ITSS','IB'];
    const passingByProgram = {PM:[],IVT:[],ITSS:[],IB:[]};
    for(const dKey of dayKeys){
      const out = await DB.computeAdmissionsFromLists(generatedLists, dKey);
      codes.forEach(c=>{
        const v = out.passing[c];
        passingByProgram[c].push(v === 'НЕДОБОР' ? 0 : (Number(v) || 0));
      });
    }

    const palette = ['#f94144','#f3722c','#577590','#4caf50'];
    const datasets = codes.map((c,idx)=>({label:c, data:passingByProgram[c], borderColor:palette[idx], fill:false}));

    // produce chart image
    const chartImg = await drawLineChart(labels, datasets);
    doc.addPage();
    doc.addImage(chartImg,'PNG',40,60,500,220);

    // Save
    doc.save(`report-${day}.pdf`);
  }

  global.Report = { createReport };
})(window);