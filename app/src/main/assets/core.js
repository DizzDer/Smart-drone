(function (root) {
  'use strict';
  // Protocol v1: fixed 20-byte, little-endian BLE notification, no MTU negotiation.
  function decode(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length !== 20) throw Error('Ожидается пакет из 20 байт');
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (v.getUint8(0) !== 1) throw Error('Неизвестная версия протокола');
    const flags = v.getUint8(1);
    if (flags & 0xf0) throw Error('Некорректные флаги');
    const t = {seq:v.getUint16(2,true), temp:v.getInt16(4,true)/100,
      smoke:v.getUint16(6,true), lat:v.getInt32(8,true)/1e7,
      lon:v.getInt32(12,true)/1e7, altitude:v.getInt16(16,true)/10,
      battery:v.getUint8(18), flame:!!(flags&1), gps:!!(flags&2),
      sensors:!!(flags&4), camera:!!(flags&8)};
    if (t.temp < -70 || t.temp > 380 || t.smoke>4095 || t.battery>100 ||
        (t.gps && (Math.abs(t.lat)>90 || Math.abs(t.lon)>180)) || v.getUint8(19)!==0)
      throw Error('Показания вне диапазона');
    return t;
  }
  class Detector {
    constructor(){ this.reset(); }
    reset(){ this.last=null; this.seq=null; this.hot=0; this.cool=0; this.active=false; }
    accept(t, now) {
      if(this.seq !== null) {
        const delta=(t.seq-this.seq+65536)%65536;
        if(delta===0 || delta>32767) return {ignored:true};
      }
      if(this.last!==null && now-this.last>5000) {this.hot=0; this.cool=0;}
      this.seq=t.seq; this.last=now;
      if(!t.sensors){this.hot=0;this.cool=0;return {state:'fault',alarm:false,active:this.active};}
      // Educational thresholds only; raw MQ-2 ADC is NOT ppm.
      const votes=Number(t.temp>=60)+Number(t.smoke>=1800)+Number(t.flame);
      this.hot=votes>=2?this.hot+1:0;
      this.cool=votes===0?this.cool+1:0;
      const alarm=!this.active && this.hot>=3;
      if(alarm)this.active=true;
      if(this.cool>=5)this.active=false;
      return {state:this.active?'alarm':votes?'suspect':'normal',alarm,active:this.active};
    }
    stale(now){return this.last===null || now-this.last>5000;}
  }
  const api={decode,Detector};
  if(typeof module!=='undefined' && module.exports)module.exports=api;
  else root.FireCore=api;
})(typeof globalThis!=='undefined'?globalThis:this);
