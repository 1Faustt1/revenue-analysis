/* db.js — простая обёртка для IndexedDB со схемой:
   DB: admissions, store: entries (key: `${id}_${program}`)
   Каждый объект: {key, id, program, day, consent, priority, physics, rus, math, indiv, sum}
*/
(function(global){
  const DB_NAME = 'admissions';
  const STORE = 'entries';
  let db = null;

  function openDB(){
    return new Promise((resolve,reject)=>{
      if(db) return resolve(db);
      const req = indexedDB.open(DB_NAME,1);
      req.onupgradeneeded = e => {
        const d = e.target.result;
        if(!d.objectStoreNames.contains(STORE)){
          const store = d.createObjectStore(STORE,{keyPath:'key'});
          store.createIndex('program','program',{unique:false});
          store.createIndex('day','day',{unique:false});
        }
      };
      req.onsuccess = e => { db = e.target.result; resolve(db) };
      req.onerror = e => reject(e.target.error);
    });
  }

  // clear DB
  function clearDB(){
    return openDB().then(d=> new Promise((res,rej)=>{
      const tx = d.transaction(STORE,'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = ()=> res();
      tx.onerror = e => rej(e.target.error);
    }));
  }

  // get all entries
  function getAll(){
    return openDB().then(d=> new Promise((res,rej)=>{
      const tx = d.transaction(STORE,'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = ()=> res(req.result);
      req.onerror = e=> rej(e.target.error);
    }));
  }

  // get by program
  function getByProgram(program){
    return openDB().then(d=> new Promise((res,rej)=>{
      const tx = d.transaction(STORE,'readonly');
      const idx = tx.objectStore(STORE).index('program');
      const req = idx.getAll(IDBKeyRange.only(program));
      req.onsuccess = ()=> res(req.result);
      req.onerror = e => rej(e.target.error);
    }));
  }

  // Update DB to match lists for a given day (lists = {PM:[...], IVT:[], ITSS:[], IB:[]})
  // Implements: if DB empty -> insert all; else -> delete entries not in lists, add new, update existing (priority to latest list)
  function updateFromLists(lists, day){
    return openDB().then(d=> new Promise(async (res,rej)=>{
      try{
        // collect new keys for the provided day only
        const newMap = new Map();
        Object.keys(lists).forEach(program=>{
          lists[program].forEach(item=>{
            const key = `${item.id}_${program}`;
            const obj = Object.assign({},item,{program,day,key});
            newMap.set(key,obj);
          });
        });

        const tx = d.transaction(STORE,'readwrite');
        const store = tx.objectStore(STORE);

        // read existing keys only for this day (do not touch other days)
        const existing = await new Promise((res2,rej2)=>{
          try{
            const idx = store.index('day');
            const r = idx.getAllKeys(IDBKeyRange.only(day));
            r.onsuccess = ()=> res2(r.result);
            r.onerror = e=> rej2(e.target.error);
          }catch(e){
            // fallback: read all keys and filter by day
            const r2 = store.getAll();
            r2.onsuccess = ()=> res2(r2.result.filter(x=> x.day === day).map(x=> x.key));
            r2.onerror = e=> rej2(e.target.error);
          }
        });

        // Determine deletions (only keys for this day that are not present in newMap)
        const toDelete = existing.filter(k=> !newMap.has(k));
        const toPut = Array.from(newMap.values());

        // Perform deletions
        toDelete.forEach(k=> store.delete(k));
        // Perform puts (will add or update)
        toPut.forEach(o=> store.put(o));

        tx.oncomplete = ()=> res({deleted:toDelete.length,put:toPut.length});
        tx.onerror = e => rej(e.target.error);

      }catch(err){ rej(err) }
    }));
  }

  // Helper: compute admissions from lists for a given day (pure function, used by PDF and DB wrapper)
  function computeFromLists(lists){
    const seats = {PM:40,IVT:50,ITSS:30,IB:20};
    // ensure arrays (only consenting candidates are considered for admission calculation)
    const programs = {};
    Object.keys(seats).forEach(p=> programs[p] = (lists[p] || []).filter(x=> x.consent).slice());
    // sort by sum desc
    Object.keys(programs).forEach(p=> programs[p].sort((a,b)=>b.sum - a.sum));

    // initial selection (by id)
    const selections = {};
    const pointers = {};
    Object.keys(seats).forEach(p=>{
      selections[p] = programs[p].slice(0, seats[p]).map(x=> x.id);
      pointers[p] = selections[p].length;
    });

    let changed = true;
    while(changed){
      changed = false;
      // map id -> selected programs
      const assigned = {};
      Object.keys(selections).forEach(p=>{
        selections[p].forEach(id=>{
          if(!assigned[id]) assigned[id]=[];
          assigned[id].push(p);
        });
      });

      // resolve conflicts by applicant priority (lower number = higher priority)
      Object.keys(assigned).forEach(id=>{
        const plist = assigned[id];
        if(plist.length<=1) return;
        let bestP = plist[0]; let bestPr = 999;
        plist.forEach(p=>{
          const obj = programs[p].find(x=> x.id===id);
          const pr = obj && obj.priority ? obj.priority : 99;
          if(pr < bestPr){ bestPr = pr; bestP = p }
        });
        // remove from other programs
        plist.forEach(p=>{ if(p!==bestP){
          const idx = selections[p].indexOf(id);
          if(idx>=0){ selections[p].splice(idx,1); changed=true }
        }});
      });

      // fill vacancies
      Object.keys(selections).forEach(p=>{
        const arr = programs[p];
        while(selections[p].length < seats[p] && pointers[p] < arr.length){
          const candidate = arr[pointers[p]];
          pointers[p]++;
          if(!candidate) continue;
          const id = candidate.id;
          // skip if already assigned elsewhere
          let already = false;
          Object.keys(selections).forEach(op=>{ if(selections[op].includes(id)) already = true; });
          if(!already){ selections[p].push(id); changed=true; }
        }
      });
    }

    // Build admitted arrays and passing scores
    const admitted = {};
    const passing = {};
    const stats = {};
    Object.keys(seats).forEach(p=>{
      admitted[p] = selections[p].map(id=> programs[p].find(x=> x.id===id)).filter(Boolean);
      if(admitted[p].length < seats[p]) passing[p] = 'НЕДОБОР'; else passing[p] = admitted[p][admitted[p].length-1].sum;
      stats[p] = { totalApplications: (lists[p]||[]).length, seats: seats[p], appliedByPriority:[0,0,0,0] };
      (lists[p]||[]).forEach(a=>{ if(a.priority>=1 && a.priority<=4) stats[p].appliedByPriority[a.priority-1]++ });
    });

    return {admitted, passing, stats};
  }

  // Compute admissions using generated lists (allLists is object: dayKey-> lists)
  function computeAdmissionsFromLists(allLists, day){
    const lists = allLists[day] || {PM:[],IVT:[],ITSS:[],IB:[]};
    return Promise.resolve(computeFromLists(lists));
  }

  // Compute admissions for given day — reads DB entries and uses the same logic
  function computeAdmissionsForDay(day){
    return openDB().then(d=> new Promise((res,rej)=>{
      const tx = d.transaction(STORE,'readonly');
      const idx = tx.objectStore(STORE).index('day');
      const req = idx.getAll(IDBKeyRange.only(day));
      req.onsuccess = ()=>{
        const all = req.result;
        const lists = {PM:[],IVT:[],ITSS:[],IB:[]};
        all.forEach(a=>{ if(!lists[a.program]) lists[a.program]=[]; lists[a.program].push(a); });
        const out = computeFromLists(lists);
        res(out);
      };
      req.onerror = e=> rej(e.target.error);
    }));
  }

  global.DB = { openDB, clearDB, getAll, getByProgram, updateFromLists, computeAdmissionsForDay, computeAdmissionsFromLists };
})(window);