(function (global) {
  const PROGRAMS = ["PM", "IVT", "ITSS", "IB"];

  const DAY_SPECS = {
    "2025-08-01": {
      totals: { PM: 60, IVT: 100, ITSS: 50, IB: 70 },
      pair: { PM_IVT: 22, PM_ITSS: 17, PM_IB: 20, IVT_ITSS: 19, IVT_IB: 22, ITSS_IB: 17 },
      triple: { PM_IVT_ITSS: 5, PM_IVT_IB: 5, IVT_ITSS_IB: 5, PM_ITSS_IB: 5, ALL: 3 },
      consentRate: 0.25,
      scoreShift: { PM: 10, IVT: 7, ITSS: 5, IB: 8 }
    },
    "2025-08-02": {
      totals: { PM: 380, IVT: 370, ITSS: 350, IB: 260 },
      pair: { PM_IVT: 190, PM_ITSS: 190, PM_IB: 150, IVT_ITSS: 190, IVT_IB: 140, ITSS_IB: 120 },
      triple: { PM_IVT_ITSS: 70, PM_IVT_IB: 70, IVT_ITSS_IB: 70, PM_ITSS_IB: 70, ALL: 50 },
      consentRate: 0.62,
      scoreShift: { PM: 18, IVT: 15, ITSS: 9, IB: 12 }
    },
    "2025-08-03": {
      totals: { PM: 1000, IVT: 1150, ITSS: 1050, IB: 800 },
      pair: { PM_IVT: 760, PM_ITSS: 600, PM_IB: 410, IVT_ITSS: 750, IVT_IB: 460, ITSS_IB: 500 },
      triple: { PM_IVT_ITSS: 500, PM_IVT_IB: 260, IVT_ITSS_IB: 300, PM_ITSS_IB: 250, ALL: 200 },
      consentRate: 0.66,
      scoreShift: { PM: 27, IVT: 22, ITSS: 4, IB: 6 }
    },
    "2025-08-04": {
      totals: { PM: 1240, IVT: 1390, ITSS: 1240, IB: 1190 },
      pair: { PM_IVT: 1090, PM_ITSS: 1110, PM_IB: 1070, IVT_ITSS: 1050, IVT_IB: 1040, ITSS_IB: 1090 },
      triple: { PM_IVT_ITSS: 1020, PM_IVT_IB: 1020, IVT_ITSS_IB: 1000, PM_ITSS_IB: 1040, ALL: 1000 },
      consentRate: 0.82,
      scoreShift: { PM: 36, IVT: 22, ITSS: 8, IB: 29 }
    }
  };

  const ORDER = ["2025-08-01", "2025-08-02", "2025-08-03", "2025-08-04"];

  function seededRandom(seed) {
    let s = seed >>> 0;
    return function () {
      s = (Math.imul(1664525, s) + 1013904223) | 0;
      return (s >>> 0) / 4294967296;
    };
  }

  function maskKey(arr) {
    return arr.slice().sort().join("|");
  }

  function decodeMask(key) {
    return key.split("|");
  }

  function buildRegionCounts(spec) {
    const q = spec.triple.ALL;

    const abc = spec.triple.PM_IVT_ITSS - q;
    const abd = spec.triple.PM_IVT_IB - q;
    const bcd = spec.triple.IVT_ITSS_IB - q;
    const acd = spec.triple.PM_ITSS_IB - q;

    const ab = spec.pair.PM_IVT - abc - abd - q;
    const ac = spec.pair.PM_ITSS - abc - acd - q;
    const ad = spec.pair.PM_IB - abd - acd - q;
    const bc = spec.pair.IVT_ITSS - abc - bcd - q;
    const bd = spec.pair.IVT_IB - abd - bcd - q;
    const cd = spec.pair.ITSS_IB - acd - bcd - q;

    const pm = spec.totals.PM;
    const ivt = spec.totals.IVT;
    const itss = spec.totals.ITSS;
    const ib = spec.totals.IB;

    const sA = pm - (ab + ac + ad + abc + abd + acd + q);
    const sB = ivt - (ab + bc + bd + abc + abd + bcd + q);
    const sC = itss - (ac + bc + cd + abc + acd + bcd + q);
    const sD = ib - (ad + bd + cd + abd + acd + bcd + q);

    const regions = new Map();
    regions.set(maskKey(["PM"]), sA);
    regions.set(maskKey(["IVT"]), sB);
    regions.set(maskKey(["ITSS"]), sC);
    regions.set(maskKey(["IB"]), sD);
    regions.set(maskKey(["PM", "IVT"]), ab);
    regions.set(maskKey(["PM", "ITSS"]), ac);
    regions.set(maskKey(["PM", "IB"]), ad);
    regions.set(maskKey(["IVT", "ITSS"]), bc);
    regions.set(maskKey(["IVT", "IB"]), bd);
    regions.set(maskKey(["ITSS", "IB"]), cd);
    regions.set(maskKey(["PM", "IVT", "ITSS"]), abc);
    regions.set(maskKey(["PM", "IVT", "IB"]), abd);
    regions.set(maskKey(["PM", "ITSS", "IB"]), acd);
    regions.set(maskKey(["IVT", "ITSS", "IB"]), bcd);
    regions.set(maskKey(["PM", "IVT", "ITSS", "IB"]), q);

    for (const [k, v] of regions.entries()) {
      if (v < 0) {
        throw new Error("Некорректные пересечения в ТЗ для региона " + k + ": " + v);
      }
    }

    return regions;
  }

  function createApplicantProfile(id, rnd, daySpec, programs) {
    const basePhysics = 45 + Math.floor(rnd() * 56);
    const baseRus = 45 + Math.floor(rnd() * 56);
    const baseMath = 45 + Math.floor(rnd() * 56);
    const indiv = Math.floor(rnd() * 11);

    const preferred = PROGRAMS.slice().sort(function () { return rnd() - 0.5; });
    const priorityByProgram = {};
    preferred.forEach(function (p, idx) {
      priorityByProgram[p] = idx + 1;
    });

    let consent = rnd() < daySpec.consentRate;
    if (daySpec === DAY_SPECS["2025-08-01"] && programs.length === 1 && rnd() < 0.4) {
      consent = false;
    }

    const bestProgram = preferred[0];
    const boost = daySpec.scoreShift[bestProgram] || 0;

    const physics = Math.min(100, basePhysics + Math.floor(boost * 0.35));
    const rus = Math.min(100, baseRus + Math.floor(boost * 0.35));
    const math = Math.min(100, baseMath + Math.floor(boost * 0.4));
    const sum = physics + rus + math + indiv;

    return {
      id: id,
      consent: consent,
      scores: { physics: physics, rus: rus, math: math, indiv: indiv, sum: sum },
      priorityByProgram: priorityByProgram
    };
  }

  function regionSlots(regionCounts) {
    const slots = [];
    for (const [region, count] of regionCounts.entries()) {
      for (let i = 0; i < count; i++) {
        slots.push(region);
      }
    }
    return slots;
  }

  function rotateArray(arr, offset) {
    if (!arr.length) return arr;
    const n = ((offset % arr.length) + arr.length) % arr.length;
    return arr.slice(n).concat(arr.slice(0, n));
  }

  function ensureFinalDayConsents(dayLists) {
    const seatMap = { PM: 40, IVT: 50, ITSS: 30, IB: 20 };
    for (const program of PROGRAMS) {
      const list = dayLists[program];
      const required = seatMap[program] + 5;
      let current = list.filter(function (x) { return x.consent; }).length;
      if (current > required) continue;
      const sorted = list.slice().sort(function (a, b) { return b.sum - a.sum; });
      for (let i = 0; i < sorted.length && current <= required; i++) {
        if (!sorted[i].consent) {
          sorted[i].consent = true;
          current += 1;
        }
      }
      const byId = new Map(sorted.map(function (x) { return [x.id, x.consent]; }));
      list.forEach(function (x) {
        x.consent = byId.get(x.id);
      });
    }
  }

  function buildDayLists(day, idStart) {
    const daySpec = DAY_SPECS[day];
    const rnd = seededRandom(Number(day.replace(/-/g, "")) + 7919);
    const regions = buildRegionCounts(daySpec);
    const slots = regionSlots(regions);
    const rotated = rotateArray(slots, Math.floor(rnd() * slots.length));

    const byProgram = { PM: [], IVT: [], ITSS: [], IB: [] };
    let nextId = idStart;

    for (const slot of rotated) {
      const programs = decodeMask(slot);
      const profile = createApplicantProfile(nextId, rnd, daySpec, programs);
      nextId += 1;

      for (const program of programs) {
        byProgram[program].push({
          id: profile.id,
          consent: profile.consent,
          priority: profile.priorityByProgram[program],
          physics: profile.scores.physics,
          rus: profile.scores.rus,
          math: profile.scores.math,
          indiv: profile.scores.indiv,
          sum: profile.scores.sum
        });
      }
    }

    for (const p of PROGRAMS) {
      byProgram[p].sort(function (a, b) {
        if (b.sum !== a.sum) return b.sum - a.sum;
        return a.id - b.id;
      });
    }

    if (day === "2025-08-04") {
      ensureFinalDayConsents(byProgram);
    }

    return { lists: byProgram, nextId: nextId };
  }

  function generateAll() {
    const all = {};
    let idCounter = 100000;

    for (const day of ORDER) {
      const out = buildDayLists(day, idCounter);
      all[day] = out.lists;

      // Небольшое пересечение ID между днями для демонстрации обновления.
      idCounter = out.nextId - Math.floor((out.nextId - idCounter) * 0.08);
    }

    return all;
  }

  function getSpecs() {
    return JSON.parse(JSON.stringify(DAY_SPECS));
  }

  global.Generator = {
    generateAll: generateAll,
    getSpecs: getSpecs,
    programs: PROGRAMS.slice()
  };
})(window);
