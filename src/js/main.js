(function () {
  const daySelect = document.getElementById("day-select");
  const programSelect = document.getElementById("program-select");
  const consentFilter = document.getElementById("consent-filter");
  const searchInput = document.getElementById("search-id");
  const sortSelect = document.getElementById("sort-select");

  const generateBtn = document.getElementById("generate-btn");
  const loadDayBtn = document.getElementById("load-day-btn");
  const clearDbBtn = document.getElementById("clear-db-btn");
  const reportBtn = document.getElementById("report-btn");
  const importInput = document.getElementById("import-csv");

  const statusEl = document.getElementById("status");
  const summaryCards = document.getElementById("summary-cards");
  const programTableBody = document.querySelector("#program-table tbody");
  const cascadeTableBody = document.querySelector("#cascade-table tbody");

  const ORDER_DAYS = ["2025-08-01", "2025-08-02", "2025-08-03", "2025-08-04"];
  const programName = { PM: "ПМ", IVT: "ИВТ", ITSS: "ИТСС", IB: "ИБ" };

  let generatedLists = {};

  function setStatus(text) {
    statusEl.textContent = "Статус: " + text;
  }

  function getSelectedDay() {
    return daySelect.value;
  }

  function rowToViewModel(row) {
    return {
      id: row.id,
      day: row.day,
      program: row.program,
      priority: row.priority,
      consent: row.consent,
      physics: row.physics,
      rus: row.rus,
      math: row.math,
      indiv: row.indiv,
      sum: row.sum
    };
  }

  function flattenLists(dayLists, day) {
    const out = [];
    ["PM", "IVT", "ITSS", "IB"].forEach(function (p) {
      (dayLists[p] || []).forEach(function (x) {
        out.push(Object.assign({ day: day, program: p }, x));
      });
    });
    return out;
  }

  async function sourceRowsForDay(day) {
    const rows = await DB.getByDay(day);
    if (rows.length) return rows.map(rowToViewModel);

    if (generatedLists[day]) {
      return flattenLists(generatedLists[day], day).map(rowToViewModel);
    }

    return [];
  }

  function applyFilters(rows) {
    const selectedProgram = programSelect.value;
    const selectedConsent = consentFilter.value;
    const query = searchInput.value.trim();
    const sort = sortSelect.value;

    let filtered = rows.slice();

    if (selectedProgram !== "ALL") {
      filtered = filtered.filter(function (r) { return r.program === selectedProgram; });
    }

    if (selectedConsent === "yes") {
      filtered = filtered.filter(function (r) { return r.consent; });
    }
    if (selectedConsent === "no") {
      filtered = filtered.filter(function (r) { return !r.consent; });
    }

    if (query) {
      filtered = filtered.filter(function (r) { return String(r.id).includes(query); });
    }

    if (sort === "sum_desc") filtered.sort(function (a, b) { return b.sum - a.sum || a.id - b.id; });
    if (sort === "sum_asc") filtered.sort(function (a, b) { return a.sum - b.sum || a.id - b.id; });
    if (sort === "id_asc") filtered.sort(function (a, b) { return a.id - b.id; });

    return filtered;
  }

  function renderProgramTable(rows) {
    programTableBody.innerHTML = "";
    rows.forEach(function (r) {
      const tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" + r.id + "</td>" +
        "<td>" + programName[r.program] + "</td>" +
        "<td>" + r.priority + "</td>" +
        "<td>" + (r.consent ? "Да" : "Нет") + "</td>" +
        "<td>" + r.physics + "</td>" +
        "<td>" + r.rus + "</td>" +
        "<td>" + r.math + "</td>" +
        "<td>" + r.indiv + "</td>" +
        "<td>" + r.sum + "</td>";
      programTableBody.appendChild(tr);
    });
  }

  function renderCascadeTable(rows) {
    cascadeTableBody.innerHTML = "";

    const byId = new Map();
    rows.forEach(function (r) {
      if (!byId.has(r.id)) {
        byId.set(r.id, { id: r.id, consent: r.consent, sum: r.sum, apps: [] });
      }
      const x = byId.get(r.id);
      x.consent = x.consent || r.consent;
      x.sum = Math.max(x.sum, r.sum);
      x.apps.push({ program: r.program, priority: r.priority });
    });

    const unified = Array.from(byId.values()).sort(function (a, b) {
      return b.sum - a.sum || a.id - b.id;
    });

    unified.forEach(function (item) {
      item.apps.sort(function (a, b) { return a.priority - b.priority; });
      const cascade = item.apps.map(function (a) {
        return programName[a.program] + "(" + a.priority + ")";
      }).join(" > ");

      const tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" + item.id + "</td>" +
        "<td>" + (item.consent ? "Да" : "Нет") + "</td>" +
        "<td>" + item.sum + "</td>" +
        "<td>" + cascade + "</td>";
      cascadeTableBody.appendChild(tr);
    });
  }

  function renderSummary(dayRows, admission) {
    const counts = { PM: 0, IVT: 0, ITSS: 0, IB: 0 };
    dayRows.forEach(function (r) { counts[r.program] += 1; });

    const blocks = [];
    ["PM", "IVT", "ITSS", "IB"].forEach(function (p) {
      const pass = admission.passing[p];
      const admitted = (admission.admitted[p] || []).length;
      const seats = DB.seatMap[p];
      blocks.push(
        "<article class='mini-card'>" +
          "<h3>" + programName[p] + "</h3>" +
          "<p>Заявлений: <b>" + counts[p] + "</b></p>" +
          "<p>Мест: <b>" + seats + "</b></p>" +
          "<p>Зачислено: <b>" + admitted + "</b></p>" +
          "<p>Проходной: <b>" + pass + "</b></p>" +
        "</article>"
      );
    });

    summaryCards.innerHTML = blocks.join("");
  }

  async function renderAll() {
    const day = getSelectedDay();
    const rows = await sourceRowsForDay(day);
    const filtered = applyFilters(rows);

    renderProgramTable(filtered);
    renderCascadeTable(rows);

    const lists = DB.rowsToProgramLists(rows);
    const admission = DB.computeFromLists(lists);
    renderSummary(rows, admission);
  }

  function csvRowValue(raw) {
    const x = (raw || "").trim();
    return x.replace(/^"|"$/g, "").replace(/""/g, "\"");
  }

  function parseCsv(text) {
    const normalized = text.replace(/\r/g, "");
    const lines = normalized.split("\n").filter(function (x) { return x.trim().length > 0; });
    if (!lines.length) return [];

    const sep = lines[0].includes(";") ? ";" : ",";

    function splitQuoted(line) {
      const out = [];
      let cur = "";
      let q = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (q) {
          if (ch === '"') {
            if (line[i + 1] === '"') {
              cur += '"';
              i += 1;
            } else {
              q = false;
            }
          } else {
            cur += ch;
          }
        } else {
          if (ch === '"') q = true;
          else if (ch === sep) {
            out.push(cur);
            cur = "";
          } else cur += ch;
        }
      }
      out.push(cur);
      return out;
    }

    const header = splitQuoted(lines[0]).map(function (h) { return csvRowValue(h).replace(/^\uFEFF/, ""); });
    const objects = [];

    for (let i = 1; i < lines.length; i++) {
      const fields = splitQuoted(lines[i]);
      const obj = {};
      for (let j = 0; j < header.length; j++) {
        obj[header[j]] = csvRowValue(fields[j] || "");
      }
      objects.push(obj);
    }

    return objects;
  }

  async function importCsvFile(file) {
    const text = await file.text();
    const rows = parseCsv(text);
    if (!rows.length) {
      setStatus("CSV пустой или поврежден");
      return;
    }

    const byDay = {};
    rows.forEach(function (r) {
      const day = r.Day || r.day || r.date || getSelectedDay();
      const rawProgram = (r.Program || r.program || r.OP || r.op || "").toUpperCase();
      const p = rawProgram === "ПМ" ? "PM" : rawProgram === "ИВТ" ? "IVT" : rawProgram === "ИТСС" ? "ITSS" : rawProgram === "ИБ" ? "IB" : rawProgram;
      if (!["PM", "IVT", "ITSS", "IB"].includes(p)) return;

      if (!byDay[day]) byDay[day] = { PM: [], IVT: [], ITSS: [], IB: [] };
      byDay[day][p].push({
        id: Number(r.ID || r.id),
        consent: /^(1|true|yes|да)$/i.test(String(r.Consent || r.consent || "")),
        priority: Number(r.Priority || r.priority || 1),
        physics: Number(r.Physics || r.physics || 0),
        rus: Number(r.Rus || r.rus || 0),
        math: Number(r.Math || r.math || 0),
        indiv: Number(r.Indiv || r.indiv || 0),
        sum: Number(r.Sum || r.sum || 0)
      });
    });

    for (const day of Object.keys(byDay)) {
      await DB.updateFromLists(byDay[day], day);
    }

    setStatus("Импорт CSV завершен");
    await renderAll();
  }

  function validateCounts(generated) {
    const specs = Generator.getSpecs();
    const report = [];

    for (const day of ORDER_DAYS) {
      const lists = generated[day];
      const spec = specs[day];
      if (!lists || !spec) continue;

      const setByProgram = {};
      ["PM", "IVT", "ITSS", "IB"].forEach(function (p) {
        setByProgram[p] = new Set((lists[p] || []).map(function (x) { return x.id; }));
      });

      report.push(day + ":");
      ["PM", "IVT", "ITSS", "IB"].forEach(function (p) {
        const actual = setByProgram[p].size;
        report.push("  " + p + " total=" + actual + " (ТЗ=" + spec.totals[p] + ")");
      });

      function inter(a, b) {
        let n = 0;
        setByProgram[a].forEach(function (id) { if (setByProgram[b].has(id)) n += 1; });
        return n;
      }

      function inter3(a, b, c) {
        let n = 0;
        setByProgram[a].forEach(function (id) {
          if (setByProgram[b].has(id) && setByProgram[c].has(id)) n += 1;
        });
        return n;
      }

      const p2 = spec.pair;
      const p3 = spec.triple;
      report.push(
        "  Pair: PM-IVT=" + inter("PM", "IVT") + "(" + p2.PM_IVT + ")," +
        " PM-ITSS=" + inter("PM", "ITSS") + "(" + p2.PM_ITSS + ")," +
        " PM-IB=" + inter("PM", "IB") + "(" + p2.PM_IB + ")," +
        " IVT-ITSS=" + inter("IVT", "ITSS") + "(" + p2.IVT_ITSS + ")," +
        " IVT-IB=" + inter("IVT", "IB") + "(" + p2.IVT_IB + ")," +
        " ITSS-IB=" + inter("ITSS", "IB") + "(" + p2.ITSS_IB + ")"
      );
      report.push(
        "  Triple/quad: PM-IVT-ITSS=" + inter3("PM", "IVT", "ITSS") + "(" + p3.PM_IVT_ITSS + ")," +
        " PM-IVT-IB=" + inter3("PM", "IVT", "IB") + "(" + p3.PM_IVT_IB + ")," +
        " IVT-ITSS-IB=" + inter3("IVT", "ITSS", "IB") + "(" + p3.IVT_ITSS_IB + ")," +
        " PM-ITSS-IB=" + inter3("PM", "ITSS", "IB") + "(" + p3.PM_ITSS_IB + ")"
      );
    }

    return report.join("\n");
  }

  async function handleGenerate() {
    setStatus("Генерация данных...");
    generatedLists = Generator.generateAll();

    const report = validateCounts(generatedLists);
    console.log(report);

    setStatus("Списки сгенерированы. Сначала выберите день и нажмите 'Загрузить выбранный день в БД'.");
    await renderAll();
  }

  async function handleLoadDay() {
    const day = getSelectedDay();
    if (!generatedLists[day]) {
      setStatus("Для выбранного дня нет данных. Сначала выполните генерацию или импорт CSV.");
      return;
    }

    const t0 = performance.now();
    const result = await DB.updateFromLists(generatedLists[day], day);
    const dt = performance.now() - t0;

    setStatus(
      "День " + day + " загружен: добавлено/обновлено " + result.put +
      ", удалено " + result.deleted +
      ", время " + dt.toFixed(1) + " мс"
    );

    await renderAll();
  }

  async function handleClearDb() {
    const ok = confirm("Очистить локальную БД конкурсных списков?");
    if (!ok) return;
    await DB.clearDB();
    setStatus("БД очищена");
    await renderAll();
  }

  async function handleReport() {
    const allByDay = {};

    for (const d of ORDER_DAYS) {
      const rows = await sourceRowsForDay(d);
      allByDay[d] = DB.rowsToProgramLists(rows);
    }

    await Report.createReport(getSelectedDay(), allByDay);
    setStatus("PDF отчет сформирован");
  }

  generateBtn.addEventListener("click", function () {
    handleGenerate().catch(function (e) {
      console.error(e);
      setStatus("Ошибка генерации: " + e.message);
    });
  });

  loadDayBtn.addEventListener("click", function () {
    handleLoadDay().catch(function (e) {
      console.error(e);
      setStatus("Ошибка загрузки в БД: " + e.message);
    });
  });

  clearDbBtn.addEventListener("click", function () {
    handleClearDb().catch(function (e) {
      console.error(e);
      setStatus("Ошибка очистки БД: " + e.message);
    });
  });

  reportBtn.addEventListener("click", function () {
    handleReport().catch(function (e) {
      console.error(e);
      setStatus("Ошибка формирования PDF: " + e.message);
    });
  });

  importInput.addEventListener("change", function (e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    importCsvFile(file).catch(function (err) {
      console.error(err);
      setStatus("Ошибка импорта CSV: " + err.message);
    }).finally(function () {
      e.target.value = "";
    });
  });

  [daySelect, programSelect, consentFilter, sortSelect].forEach(function (el) {
    el.addEventListener("change", function () {
      renderAll().catch(function (e) {
        console.error(e);
        setStatus("Ошибка отрисовки: " + e.message);
      });
    });
  });

  searchInput.addEventListener("input", function () {
    renderAll().catch(function (e) {
      console.error(e);
      setStatus("Ошибка отрисовки: " + e.message);
    });
  });

  window.addEventListener("load", function () {
    renderAll().catch(function (e) {
      console.error(e);
      setStatus("Ошибка инициализации: " + e.message);
    });
  });
})();
