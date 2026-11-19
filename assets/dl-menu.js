// Header "Download" dropdown. Hover opens on mouse devices >= 900 px (180 ms close delay), click/tap toggles, Esc and outside click close.
(function(){
  var d=document.querySelector('.dl-menu'); if(!d) return;
  document.addEventListener('click',function(e){ if(d.open&&!d.contains(e.target)) d.open=false; });
  document.addEventListener('keydown',function(e){ if(e.key==='Escape'&&d.open){ d.open=false; var s=d.querySelector('summary'); if(s&&d.contains(document.activeElement)) s.focus(); } });
  if(!(window.matchMedia&&window.matchMedia('(hover:hover) and (pointer:fine)').matches)) return;
  var t=null, wide=function(){ return window.innerWidth>=900; };
  d.addEventListener('mouseenter',function(){ if(!wide()) return; clearTimeout(t); t=setTimeout(function(){ d.open=true; },80); });
  d.addEventListener('mouseleave',function(){ if(!wide()) return; clearTimeout(t); t=setTimeout(function(){ d.open=false; },180); });
})();
