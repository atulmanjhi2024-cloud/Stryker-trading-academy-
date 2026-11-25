// every page with a .footer-grid footer has exactly one row of the 4 social links
const fs=require('fs'),path=require('path');
const want=['https://x.com/thetradezoro','https://www.instagram.com/thetradezoro/','https://www.youtube.com/@tradezoro','https://discord.gg/M4d4gTr5c3'];
let n=0,bad=[];
(function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){if(e.name==='node_modules'||e.name.startsWith('.'))continue;const p=path.join(d,e.name);
 if(e.isDirectory())walk(p);else if(e.name.endsWith('.html')){const m=fs.readFileSync(p,'utf8').match(/<footer[\s\S]*?<\/footer>/);
  if(!m||!m[0].includes('footer-grid'))continue;n++;const rows=m[0].split('class="fs-row"').length-1;
  const ok=rows===1&&want.every(u=>m[0].includes('href="'+u+'" target="_blank" rel="noopener me"'));if(!ok)bad.push(p);}}})('.');
console.log('footers',n,'bad',bad.length);if(bad.length||n<360){console.log(bad);process.exit(1)}
