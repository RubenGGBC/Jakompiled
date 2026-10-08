import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../saves.js',import.meta.url),'utf8');
function setup() {
 const records=new Map();const storage={getItem:k=>records.get(k)??null,setItem:(k,v)=>records.set(k,v)};
 const window={dispatchEvent(){}};
 runInNewContext(source,{window,localStorage:storage,Uint8Array,atob,btoa,CustomEvent:class{},console:{info(){},error(){}}});
 return {api:window.JakompiledSaveStorage,records,storage};
}
test('todos los bytes se conservan entre instancias y los slots se aíslan',()=>{
 const {api,records}=setup();const bytes=Uint8Array.from({length:133120},(_,i)=>i%256);
 api.save('jak2',0,bytes);api.save('jak2',2,Uint8Array.of(42));
 const second=setup();for(const [k,v]of records)second.records.set(k,v);
 assert.deepEqual(second.api.load('jak2',0,bytes.length),bytes);
 assert.deepEqual(second.api.load('jak2',2,1),Uint8Array.of(42));
 assert.equal(second.api.load('jak2',1,1),null);assert.equal(second.api.load('jak1',0,1),null);
});
test('un fallo de cuota no sobrescribe la última partida',()=>{
 const {api,records,storage}=setup();api.save('jak2',0,Uint8Array.of(123));const old=[...records];
 storage.setItem=()=>{throw new DOMException('Cuota agotada','QuotaExceededError');};
 assert.throws(()=>api.save('jak2',0,Uint8Array.of(231)),/Cuota/);assert.deepEqual([...records],old);
});
test('rechaza guardados corruptos y tamaños incorrectos',()=>{
 const {api,records}=setup();records.set('jakompiled:saves:v1:jak2:0','{');assert.throws(()=>api.load('jak2',0,1));
 api.save('jak2',0,Uint8Array.of(1));assert.throws(()=>api.load('jak2',0,2),/tamaño/);
 assert.throws(()=>api.save('jak2',8,Uint8Array.of(1)),/Banco/);
});
