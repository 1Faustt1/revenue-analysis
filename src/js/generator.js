/* generator.js — генерация конкурсных списков для 4 дней и 4 программ
   Формирует списки с учётом указанных в ТЗ количеств и пересечений.
*/
(function(global){
  // Programs info
  const PROGRAMS = [
    {code:'PM', seats:40},
    {code:'IVT', seats:50},
    {code:'ITSS', seats:30},
    {code:'IB', seats:20}
  ];

  // Day specs (counts per program)
  const DAYS = {
    '2025-08-01': {PM:60, IVT:100, ITSS:50, IB:70},
    '2025-08-02': {PM:380, IVT:370, ITSS:350, IB:260},
    '2025-08-03': {PM:1000, IVT:1150, ITSS:1050, IB:800},
    '2025-08-04': {PM:1240, IVT:1390, ITSS:1240, IB:1190}
  };

  // Intersections (pairs, triples, quads) simplified from ТЗ for each day.
  // We'll use the pair and triple/quad numbers to create overlapping applicants.
  const INTERSECTIONS = {
    '2025-08-01': {
      pairs: {PM_IVT:22, PM_ITSS:17, PM_IB:20, IVT_ITSS:19, IVT_IB:22, ITSS_IB:17},
      triples: {PM_IVT_ITSS:5, PM_IVT_IB:5, IVT_ITSS_IB:5, PM_ITSS_IB:5, PM_IVT_ITSS_IB:3}
    },
    '2025-08-02': {
      pairs: {PM_IVT:190, PM_ITSS:190, PM_IB:150, IVT_ITSS:190, IVT_IB:140, ITSS_IB:120},
      triples: {PM_IVT_ITSS:70, PM_IVT_IB:70, IVT_ITSS_IB:70, PM_ITSS_IB:70, PM_IVT_ITSS_IB:50}
    },
    '2025-08-03': {
      pairs: {PM_IVT:760, PM_ITSS:600, PM_IB:410, IVT_ITSS:750, IVT_IB:460, ITSS_IB:500},
      triples: {PM_IVT_ITSS:500, PM_IVT_IB:260, IVT_ITSS_IB:300, PM_ITSS_IB:250, PM_IVT_ITSS_IB:200}
    },
    '2025-08-04': {
      pairs: {PM_IVT:1090, PM_ITSS:1110, PM_IB:1070, IVT_ITSS:1050, IVT_IB:1040, ITSS_IB:1090},
      triples: {PM_IVT_ITSS:1020, PM_IVT_IB:1020, IVT_ITSS_IB:1000, PM_ITSS_IB:1040, PM_IVT_ITSS_IB:1000}
    }
  };

  // Simple seeded RNG for reproducibility
  function rng(seed){
    let s = seed >>> 0;
    return function(){
      s = Math.imul(1664525, s) + 1013904223 | 0;
      return ((s >>> 0) / 4294967296);
    }
  }

  // Create a unique id pool using a global counter
  let globalId = 1000;

  // Helper to create applicant record
  function makeApplicant(id, dayRnd){
    // scores random but reproducible
    const physics = Math.floor(dayRnd()*100);
    const rus = Math.floor(dayRnd()*100);
    const math = Math.floor(dayRnd()*100);
    const indiv = Math.floor(dayRnd()*10);
    const sum = physics + rus + math + indiv;
    // consent probability higher on final day to satisfy ТЗ.
    const consent = dayRnd() > 0.5;
    const priority = 1 + Math.floor(dayRnd()*4);
    return {id, consent, priority, physics, rus, math, indiv, sum};
  }

  // Main generation for one day: tries to honor pair/triple intersections
  function generateForDay(dayKey){
    const specs = DAYS[dayKey];
    const inter = INTERSECTIONS[dayKey];
    const daySeed = (new Date(dayKey)).getTime() & 0xffffffff;
    const rnd = rng(daySeed || 42);

    // Pools for overlaps
    const programCodes = ['PM','IVT','ITSS','IB'];
    const lists = {PM:[], IVT:[], ITSS:[], IB:[]};

    // First generate quad-intersection pool if specified in triples.quad (we used last triple property as quad)
    const quadCount = inter.triples && inter.triples.PM_IVT_ITSS_IB ? inter.triples.PM_IVT_ITSS_IB : 0;

    const allocateApplicants = (count, progs) => {
      const ids = [];
      for(let i=0;i<count;i++){
        const id = globalId++;
        const a = makeApplicant(id, rnd);
        progs.forEach(p=> lists[p].push(Object.assign({},a,{program:p})));
        ids.push(id);
      }
      return ids;
    }

    // Create quads
    if(quadCount>0) allocateApplicants(quadCount, programCodes);

    // Triples
    const triples = [
      {k:['PM','IVT','ITSS'],n:inter.triples.PM_IVT_ITSS},
      {k:['PM','IVT','IB'],n:inter.triples.PM_IVT_IB},
      {k:['IVT','ITSS','IB'],n:inter.triples.IVT_ITSS_IB},
      {k:['PM','ITSS','IB'],n:inter.triples.PM_ITSS_IB}
    ];
    triples.forEach(t=>{ if(t.n>0) allocateApplicants(t.n,t.k)});

    // Pairs
    const pairs = [
      {k:['PM','IVT'],n:inter.pairs.PM_IVT},
      {k:['PM','ITSS'],n:inter.pairs.PM_ITSS},
      {k:['PM','IB'],n:inter.pairs.PM_IB},
      {k:['IVT','ITSS'],n:inter.pairs.IVT_ITSS},
      {k:['IVT','IB'],n:inter.pairs.IVT_IB},
      {k:['ITSS','IB'],n:inter.pairs.ITSS_IB}
    ];
    pairs.forEach(p=>{ if(p.n>0) allocateApplicants(p.n,p.k)});

    // After allocating overlaps, fill each program to required count with unique applicants
    programCodes.forEach(p=>{
      const need = specs[p] - lists[p].length;
      if(need>0){
        allocateApplicants(need,[p]);
      }
    });

    // Ensure final-day consent counts exceed places
    if(dayKey === '2025-08-04'){
      // boost consent probability: set consent=true for many random ones
      Object.keys(lists).forEach(p=>{
        const list = lists[p];
        // make sure at least seats+10 consenting
        const seats = PROGRAMS.find(x=>x.code===p).seats;
        list.forEach((item,idx)=>{ if(rnd()>0.3) item.consent=true });
        // force extra consents
        const consenting = list.filter(x=>x.consent).length;
        let i=0;
        while(consenting + i <= seats+1 && i<list.length){ list[i].consent = true; i++; }
      });
    }

    // Shuffle lists to avoid all-high-scores in front
    Object.keys(lists).forEach(p=>{
      const arr = lists[p];
      arr.sort((a,b)=>b.sum - a.sum); // sort by sum descending
    });

    return lists;
  }

  // Public API
  global.Generator = {
    generateAll: function(){
      const res = {};
      Object.keys(DAYS).forEach(d=> res[d]=generateForDay(d));
      return res;
    }
  };

})(window);
