(function (global) {
  const DB_NAME = "admissions";
  const STORE = "entries";
  const DAY_INDEX = "day";
  const PROGRAM_INDEX = "program";
  const seatMap = { PM: 40, IVT: 50, ITSS: 30, IB: 20 };
  const programs = Object.keys(seatMap);
  let db = null;

  function openDB() {
    return new Promise(function (resolve, reject) {
      if (db) return resolve(db);

      const req = indexedDB.open(DB_NAME, 2);
      req.onupgradeneeded = function (e) {
        const d = e.target.result;
        if (d.objectStoreNames.contains(STORE)) {
          d.deleteObjectStore(STORE);
        }
        const store = d.createObjectStore(STORE, { keyPath: "key" });
        store.createIndex(DAY_INDEX, DAY_INDEX, { unique: false });
        store.createIndex(PROGRAM_INDEX, PROGRAM_INDEX, { unique: false });
      };
      req.onsuccess = function (e) {
        db = e.target.result;
        resolve(db);
      };
      req.onerror = function (e) {
        reject(e.target.error);
      };
    });
  }

  function clearDB() {
    return openDB().then(function (d) {
      return new Promise(function (resolve, reject) {
        const tx = d.transaction(STORE, "readwrite");
        tx.objectStore(STORE).clear();
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function (e) { reject(e.target.error); };
      });
    });
  }

  function getAll() {
    return openDB().then(function (d) {
      return new Promise(function (resolve, reject) {
        const tx = d.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function (e) { reject(e.target.error); };
      });
    });
  }

  function getByDay(day) {
    return openDB().then(function (d) {
      return new Promise(function (resolve, reject) {
        const tx = d.transaction(STORE, "readonly");
        const idx = tx.objectStore(STORE).index(DAY_INDEX);
        const req = idx.getAll(IDBKeyRange.only(day));
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function (e) { reject(e.target.error); };
      });
    });
  }

  function toKey(day, program, id) {
    return day + "_" + program + "_" + id;
  }

  function normalizeEntry(day, program, item) {
    return {
      key: toKey(day, program, item.id),
      day: day,
      program: program,
      id: Number(item.id),
      consent: Boolean(item.consent),
      priority: Number(item.priority),
      physics: Number(item.physics),
      rus: Number(item.rus),
      math: Number(item.math),
      indiv: Number(item.indiv),
      sum: Number(item.sum)
    };
  }

  function updateFromLists(lists, day) {
    return openDB().then(function (d) {
      return new Promise(function (resolve, reject) {
        const t0 = performance.now();
        const tx = d.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);

        const newMap = new Map();
        programs.forEach(function (program) {
          (lists[program] || []).forEach(function (item) {
            const obj = normalizeEntry(day, program, item);
            newMap.set(obj.key, obj);
          });
        });

        const idx = store.index(DAY_INDEX);
        const req = idx.getAll(IDBKeyRange.only(day));

        req.onsuccess = function () {
          const existing = req.result || [];
          const existingKeys = new Set(existing.map(function (x) { return x.key; }));
          const nextKeys = new Set(newMap.keys());

          let deleted = 0;
          let put = 0;

          existing.forEach(function (row) {
            if (!nextKeys.has(row.key)) {
              store.delete(row.key);
              deleted += 1;
            }
          });

          newMap.forEach(function (row) {
            store.put(row);
            put += 1;
          });

          tx.oncomplete = function () {
            const elapsed = performance.now() - t0;
            resolve({ deleted: deleted, put: put, elapsedMs: elapsed, wasEmpty: existingKeys.size === 0 });
          };
        };

        req.onerror = function (e) {
          reject(e.target.error);
        };

        tx.onerror = function (e) {
          reject(e.target.error);
        };
      });
    });
  }

  function rowsToProgramLists(rows) {
    const lists = { PM: [], IVT: [], ITSS: [], IB: [] };
    rows.forEach(function (r) {
      if (!lists[r.program]) lists[r.program] = [];
      lists[r.program].push({
        id: r.id,
        consent: r.consent,
        priority: r.priority,
        physics: r.physics,
        rus: r.rus,
        math: r.math,
        indiv: r.indiv,
        sum: r.sum
      });
    });
    return lists;
  }

  function computeFromLists(lists) {
    const candidateMap = new Map();

    programs.forEach(function (program) {
      (lists[program] || []).forEach(function (entry) {
        if (!entry.consent) return;

        const id = Number(entry.id);
        if (!candidateMap.has(id)) {
          candidateMap.set(id, {
            id: id,
            sum: Number(entry.sum),
            apps: []
          });
        }

        const c = candidateMap.get(id);
        if (Number(entry.sum) > c.sum) c.sum = Number(entry.sum);
        c.apps.push({ program: program, priority: Number(entry.priority), sum: Number(entry.sum) });
      });
    });

    const candidates = Array.from(candidateMap.values());
    candidates.forEach(function (c) {
      c.apps.sort(function (a, b) { return a.priority - b.priority; });
    });

    candidates.sort(function (a, b) {
      if (b.sum !== a.sum) return b.sum - a.sum;
      return a.id - b.id;
    });

    const admittedByProgram = { PM: [], IVT: [], ITSS: [], IB: [] };
    const admittedPriorityCount = {
      PM: [0, 0, 0, 0],
      IVT: [0, 0, 0, 0],
      ITSS: [0, 0, 0, 0],
      IB: [0, 0, 0, 0]
    };

    candidates.forEach(function (c) {
      for (const app of c.apps) {
        if (admittedByProgram[app.program].length < seatMap[app.program]) {
          admittedByProgram[app.program].push({ id: c.id, sum: c.sum, priority: app.priority });
          if (app.priority >= 1 && app.priority <= 4) {
            admittedPriorityCount[app.program][app.priority - 1] += 1;
          }
          break;
        }
      }
    });

    programs.forEach(function (p) {
      admittedByProgram[p].sort(function (a, b) {
        if (b.sum !== a.sum) return b.sum - a.sum;
        return a.id - b.id;
      });
    });

    const passing = {};
    const stats = {};

    programs.forEach(function (program) {
      const all = lists[program] || [];
      const admitted = admittedByProgram[program];
      passing[program] = admitted.length < seatMap[program] ? "НЕДОБОР" : admitted[seatMap[program] - 1].sum;

      const appliedByPriority = [0, 0, 0, 0];
      all.forEach(function (x) {
        if (x.priority >= 1 && x.priority <= 4) {
          appliedByPriority[x.priority - 1] += 1;
        }
      });

      stats[program] = {
        totalApplications: all.length,
        seats: seatMap[program],
        appliedByPriority: appliedByPriority,
        enrolledByPriority: admittedPriorityCount[program]
      };
    });

    return {
      admitted: admittedByProgram,
      passing: passing,
      stats: stats
    };
  }

  function computeAdmissionsForDay(day) {
    return getByDay(day).then(function (rows) {
      return computeFromLists(rowsToProgramLists(rows));
    });
  }

  function computeAdmissionsFromAllRows(allRowsByDay, day) {
    const lists = allRowsByDay[day] || { PM: [], IVT: [], ITSS: [], IB: [] };
    return computeFromLists(lists);
  }

  global.DB = {
    openDB: openDB,
    clearDB: clearDB,
    getAll: getAll,
    getByDay: getByDay,
    updateFromLists: updateFromLists,
    computeFromLists: computeFromLists,
    computeAdmissionsForDay: computeAdmissionsForDay,
    computeAdmissionsFromAllRows: computeAdmissionsFromAllRows,
    rowsToProgramLists: rowsToProgramLists,
    seatMap: Object.assign({}, seatMap)
  };
})(window);
