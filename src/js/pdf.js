(function (global) {
  function drawChart(labels, datasets) {
    return new Promise(function (resolve) {
      const canvas = document.createElement("canvas");
      canvas.width = 1000;
      canvas.height = 420;
      const ctx = canvas.getContext("2d");

      const chart = new Chart(ctx, {
        type: "line",
        data: {
          labels: labels,
          datasets: datasets
        },
        options: {
          responsive: false,
          animation: false,
          plugins: { legend: { display: true } },
          scales: {
            y: { beginAtZero: true }
          }
        }
      });

      setTimeout(function () {
        const img = canvas.toDataURL("image/png");
        chart.destroy();
        resolve(img);
      }, 80);
    });
  }

  function blockImage(title, lines) {
    const canvas = document.createElement("canvas");
    const width = 1200;
    const lineHeight = 26;
    const top = 50;
    const totalHeight = Math.max(420, top + (lines.length + 2) * lineHeight);
    canvas.width = width;
    canvas.height = totalHeight;

    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, totalHeight);
    ctx.fillStyle = "#111827";

    ctx.font = "bold 30px Arial";
    ctx.fillText(title, 30, 40);

    ctx.font = "18px Arial";
    let y = top + 20;
    lines.forEach(function (line) {
      ctx.fillText(line, 30, y);
      y += lineHeight;
    });

    return canvas.toDataURL("image/png");
  }

  function buildStatsLines(stats) {
    const names = { PM: "ПМ", IVT: "ИВТ", ITSS: "ИТСС", IB: "ИБ" };
    const rows = [];

    rows.push("Статистика по образовательным программам:");
    rows.push("ОП | Всего заявлений | Мест | 1 пр. | 2 пр. | 3 пр. | 4 пр. | Зач.1 | Зач.2 | Зач.3 | Зач.4");

    ["PM", "IVT", "ITSS", "IB"].forEach(function (p) {
      const s = stats[p];
      const a = s.appliedByPriority;
      const e = s.enrolledByPriority;
      rows.push(
        names[p] +
          " | " + s.totalApplications +
          " | " + s.seats +
          " | " + a[0] +
          " | " + a[1] +
          " | " + a[2] +
          " | " + a[3] +
          " | " + e[0] +
          " | " + e[1] +
          " | " + e[2] +
          " | " + e[3]
      );
    });

    return rows;
  }

  async function createReport(day, allListsByDay) {
    const { jsPDF } = window.jspdf;
    const now = new Date();

    const current = DB.computeAdmissionsFromAllRows(allListsByDay, day);

    const summaryLines = [];
    summaryLines.push("Дата/время формирования: " + now.toLocaleString("ru-RU"));
    summaryLines.push("Отчет по дню приемной кампании: " + day);
    summaryLines.push("");
    summaryLines.push("Проходные баллы:");
    ["PM", "IVT", "ITSS", "IB"].forEach(function (p) {
      summaryLines.push(p + ": " + current.passing[p]);
    });

    const doc = new jsPDF({ unit: "pt", format: "a4" });

    const summaryImg = blockImage("Анализ поступления: отчет", summaryLines);
    doc.addImage(summaryImg, "PNG", 20, 20, 555, 360);

    const days = ["2025-08-01", "2025-08-02", "2025-08-03", "2025-08-04"];
    const series = { PM: [], IVT: [], ITSS: [], IB: [] };

    days.forEach(function (d) {
      const out = DB.computeAdmissionsFromAllRows(allListsByDay, d);
      ["PM", "IVT", "ITSS", "IB"].forEach(function (p) {
        const val = out.passing[p];
        series[p].push(val === "НЕДОБОР" ? 0 : Number(val));
      });
    });

    const datasets = [
      { label: "ПМ", data: series.PM, borderColor: "#be123c", fill: false },
      { label: "ИВТ", data: series.IVT, borderColor: "#1d4ed8", fill: false },
      { label: "ИТСС", data: series.ITSS, borderColor: "#0f766e", fill: false },
      { label: "ИБ", data: series.IB, borderColor: "#854d0e", fill: false }
    ];

    const chartImg = await drawChart(["01.08", "02.08", "03.08", "04.08"], datasets);
    doc.addPage();
    doc.text("Динамика проходных баллов (за 4 дня)", 30, 36);
    doc.addImage(chartImg, "PNG", 30, 50, 535, 225);

    const statsLines = buildStatsLines(current.stats);
    const statsImg = blockImage("Статистика по ОП", statsLines);
    doc.addImage(statsImg, "PNG", 30, 290, 535, 220);

    ["PM", "IVT", "ITSS", "IB"].forEach(function (p) {
      doc.addPage();
      const lines = [];
      lines.push("Список зачисленных на программу " + p + ":");
      const admitted = current.admitted[p] || [];
      if (!admitted.length) {
        lines.push("НЕТ ЗАЧИСЛЕННЫХ");
      } else {
        admitted.forEach(function (a, i) {
          lines.push(String(i + 1).padStart(2, "0") + ". ID " + a.id + " | Сумма: " + a.sum + " | Приоритет: " + a.priority);
        });
      }
      const img = blockImage("Зачисленные - " + p, lines);
      doc.addImage(img, "PNG", 20, 20, 555, 780);
    });

    doc.save("report-" + day + ".pdf");
  }

  global.Report = { createReport: createReport };
})(window);
