const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
function setup(){
  let now=0,interval;
  class Element {constructor(){this.textContent='';this.value='normal';this.dataset={};this.children=[];this.attrs={};}append(...e){this.children.push(...e);}replaceChildren(){this.children=[];}setAttribute(k,v){this.attrs[k]=v;}showModal(){}close(){}}
  const els={};const el=id=>els[id]||(els[id]=new Element());
  class Clock extends Date{constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}}
  const ctx={document:{getElementById:el,createElement:()=>new Element()},localStorage:{getItem:()=>null,setItem:()=>{}},setInterval:f=>interval=f,Date:Clock,console};ctx.window=ctx;
  vm.createContext(ctx);
  const root=path.join(__dirname,'../app/src/main/assets');
  vm.runInContext(fs.readFileSync(path.join(root,'core.js'),'utf8'),ctx);
  vm.runInContext(fs.readFileSync(path.join(root,'app.js'),'utf8'),ctx);
  return {el,ctx,tick:()=>{now+=1000;interval();}};
}
test('UI controller: simulator -> fire -> recovery -> loss -> stopped',()=>{
  const {el,tick}=setup();el('start').onclick();assert.equal(el('status').dataset.state,'normal');
  el('scenario').value='fire';tick();tick();assert.equal(el('status').dataset.state,'suspect');tick();assert.equal(el('status').dataset.state,'alarm');assert.equal(el('events').children.length,1);
  tick();tick();assert.equal(el('events').children.length,1);
  el('scenario').value='normal';for(let i=0;i<5;i++)tick();assert.equal(el('status').dataset.state,'normal');
  el('scenario').value='loss';for(let i=0;i<6;i++)tick();assert.equal(el('status').dataset.state,'stale');assert.equal(el('temp').textContent,'—');
  el('start').onclick();assert.equal(el('status').dataset.state,'idle');el('clear').onclick();assert.equal(el('events').children[0].textContent,'Событий пока нет.');
});
test('browser BLE action reports native requirement; pause clears readings',()=>{const {el,ctx}=setup();el('ble').onclick();assert.match(el('message').textContent,/Android/);el('start').onclick();ctx.nativePaused();assert.equal(el('status').dataset.state,'idle');assert.equal(el('temp').textContent,'—');});
