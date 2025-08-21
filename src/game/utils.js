export function shuffleArray(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
export const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
export function pickRandom(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
