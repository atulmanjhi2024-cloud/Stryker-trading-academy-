(async () => { for (let i = 0; i < 50 && !window.__stkAxisTags; i++) await new Promise((r) => setTimeout(r, 200));
  const A = window.__stkAxisTags, p0 = A ? A.paints : 0; await new Promise((r) => setTimeout(r, 3000));
  return { qsaCalls: window.__qsaN, hitQueries: window.__qsaHit, idlePaints3s: A ? A.paints - p0 : -1, paintsTotal: A && A.paints, pineExecutes: (window.__pineTypes || {}).execute || 0, pineNotify: (window.__pineTypes || {}).notifyBars || 0 }; })()
