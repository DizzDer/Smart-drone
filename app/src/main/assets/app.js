'use strict';
const $=id=>document.getElementById(id), detector=new FireCore.Detector();
let running=false, source='sim', seq=0, ticks=0, origin=null, latest=null, staleShown=false;
let events=[];
try { const saved=JSON.parse(localStorage.getItem('firescout.events')||'[]'); if(Array.isArray(saved))events=saved.filter(e=>e&&typeof e.time==='string'&&typeof e.where==='string'&&typeof e.source==='string').slice(0,100); } catch(_){}
function message(text){$('message').textContent=text;}
function status(state,title,text){$('status').dataset.state=state;$('stateTitle').textContent=title;$('stateText').textContent=text;}
function renderEvents(){
  $('events').replaceChildren();
  if(!events.length){const p=document.createElement('p');p.className='note';p.textContent='Событий пока нет.';$('events').append(p);}
  events.forEach(e=>{const row=document.createElement('div');row.className='event';const b=document.createElement('b');b.textContent='Возможный пожар';const small=document.createElement('small');small.textContent=`${e.time} · ${e.source} · ${e.where}`;row.append(b,small);$('events').append(row);});
}
function save(){try{localStorage.setItem('firescout.events',JSON.stringify(events));}catch(_){message('Журнал доступен только до закрытия: сохранение недоступно.');}}
function clearReadings(){['temp','smoke','flame','altitude'].forEach(id=>$(id).textContent='—');$('coords').textContent='GPS: —';$('distance').textContent='От старта: —';$('battery').textContent='Заряд: —';$('drone').setAttribute('visibility','hidden');$('age').textContent='Пакетов ещё нет';}
function reset(){detector.reset();origin=null;latest=null;staleShown=false;clearReadings();}
function receive(t){
  const result=detector.accept(t,Date.now());if(result.ignored)return;
  latest=t;staleShown=false;
  $('temp').textContent=t.sensors?t.temp.toFixed(1):'—';$('smoke').textContent=t.sensors?t.smoke:'—';$('flame').textContent=t.sensors?(t.flame?'Есть':'Нет'):'—';$('altitude').textContent=t.altitude.toFixed(1);$('battery').textContent=`Заряд: ${t.battery}%`;
  $('camera').textContent=t.camera?'модуль заявлен, видео не передаётся':'видеопоток не подключён';
  if(t.gps){
    if(!origin)origin={lat:t.lat,lon:t.lon};
    const north=(t.lat-origin.lat)*111320,east=(t.lon-origin.lon)*111320*Math.cos(origin.lat*Math.PI/180), distance=Math.hypot(north,east), radius=Math.max(10,Math.ceil(distance/10)*10);
    $('drone').setAttribute('visibility','visible');$('drone').setAttribute('transform',`translate(${200+east*80/radius} ${115-north*80/radius})`);
    $('scale').textContent=`КРУГ: ${radius} М`;$('coords').textContent=`${t.lat.toFixed(6)}, ${t.lon.toFixed(6)}`;$('distance').textContent=`От старта: ${distance.toFixed(1)} м`;
  }else{$('coords').textContent='GPS: нет фиксации';$('distance').textContent='От старта: —';$('drone').setAttribute('visibility','hidden');}
  const names={normal:'Признаков пожара нет',suspect:'Есть подозрительный сигнал',alarm:'Возможный пожар',fault:'Датчики не готовы'};
  const details={normal:'Текущие показания ниже учебных порогов.',suspect:'Ожидаем подтверждение в следующих пакетах.',alarm:'Тревога сохраняется до пяти спокойных пакетов подряд.',fault:'Оценка пожара недоступна. Проверь состояние датчиков.'};
  status(result.state,names[result.state],details[result.state]+(result.state==='fault'&&result.active?' Предыдущая тревога не снята.':'')+(source==='sim'?' Это симуляция.':''));
  if(result.alarm){
    const where=t.gps?`GPS дрона: ${t.lat.toFixed(6)}, ${t.lon.toFixed(6)}`:'GPS недоступен';
    events.unshift({time:new Date().toLocaleString('ru-RU'),source:source==='sim'?'СИМУЛЯЦИЯ':'BLE',where});events=events.slice(0,100);save();renderEvents();
    const body=(source==='sim'?'СИМУЛЯЦИЯ. ':'')+where;
    if(window.Android)Android.alert(body);else if('Notification'in window&&Notification.permission==='granted')new Notification('FireScout: возможный пожар',{body});
  }
}
function tick(){
  if(!running||source!=='sim')return;
  if($('scenario').value==='loss')return;
  ticks++;const fire=$('scenario').value==='fire',single=$('scenario').value==='false';
  const angle=ticks/12, r=ticks===1?0:4;
  receive({seq:seq++%65536,temp:fire?78+Math.sin(ticks)*3:25+Math.sin(ticks)*1.5,smoke:fire?2400+Math.round(Math.sin(ticks)*60):350+Math.round(Math.cos(ticks)*30),flame:fire||single,lat:43.238949+r*Math.cos(angle)/111320,lon:76.889709+r*Math.sin(angle)/(111320*Math.cos(43.238949*Math.PI/180)),altitude:5,battery:92,gps:true,sensors:true,camera:false});
}
$('start').onclick=()=>{
  if(source==='sim'&&running){running=false;status('idle','Симуляция остановлена','Показания не обновляются.');$('start').textContent='Начать симуляцию';clearReadings();return;}
  if(window.Android)Android.disconnect();source='sim';running=true;ticks=0;reset();$('scenario').disabled=false;$('mode').textContent='СИМУЛЯТОР · ОФЛАЙН';$('start').textContent='Остановить';message('Искусственные данные, один пакет в секунду.');tick();
};
$('scenario').onchange=()=>{if(running&&source==='sim')message('Сценарий изменён. Наблюдай за показаниями и статусом.');};
$('clear').onclick=()=>{events=[];save();renderEvents();};
$('notify').onclick=async()=>{if(window.Android){Android.enableNotifications();return;}if(!('Notification'in window)){message('Системные уведомления доступны в Android-приложении.');return;}try{const p=await Notification.requestPermission();message(p==='granted'?'Уведомления включены.':'Уведомления не разрешены. События останутся в журнале.');}catch(_){message('Браузер не разрешает уведомления для локального файла. Используй Android-приложение.');}};
$('ble').onclick=()=>{if(!window.Android){message('BLE доступен в Android-приложении. Здесь можно проверить симуляцию.');return;}running=false;source='ble';reset();$('scenario').disabled=true;$('mode').textContent='BLUETOOTH LE';$('start').textContent='Начать симуляцию';$('devices').replaceChildren();$('deviceDialog').showModal();status('idle','Поиск устройства','Ожидаем подключение и первый пакет.');Android.scan();};
$('closeDialog').onclick=()=>{$('deviceDialog').close();if(window.Android)Android.stopScan();};
window.nativeDevice=(address,name)=>{if(document.getElementById(address))return;const b=document.createElement('button');b.id=address;b.textContent=`${name||'FireScout'} · ${address}`;b.onclick=()=>{$('deviceDialog').close();Android.connect(address);};$('devices').append(b);};
window.nativeStatus=text=>message(text);
window.nativeDisconnected=()=>{if(source==='ble'){reset();status('stale','Связь потеряна','Новых показаний нет. Подключись к устройству повторно.');}};
window.nativePacket=values=>{if(source!=='ble')return;try{receive(FireCore.decode(Uint8Array.from(values)));}catch(e){message('Ошибка пакета: '+e.message);}};
window.nativePaused=()=>{running=false;reset();$('start').textContent='Начать симуляцию';status('idle','Мониторинг приостановлен','Приложение было свёрнуто. Запусти симуляцию или подключись заново.');};
setInterval(()=>{tick();if(detector.last!==null&&((source==='sim'&&running)||source==='ble')){$('age').textContent=`Пакет: ${Math.floor((Date.now()-detector.last)/1000)} с назад`;if(detector.stale(Date.now())&&!staleShown){staleShown=true;clearReadings();status('stale','Нет свежих данных',detector.active?'Связь потеряна. Предыдущая тревога не снята.':'Более 5 секунд без пакетов. Оценка пожара недоступна.');}}else if(running&&$('scenario').value==='loss')status('stale','Нет связи','Сценарий потери связи: данные не поступают.');},1000);
renderEvents();

