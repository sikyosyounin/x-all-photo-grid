const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.join(__dirname, '..') + path.sep;
const CHANNEL = 'x-all-photo-grid-v1';
const id = '1234567890123456789';
const urls = Array.from({length:20}, (_,i)=>`https://pbs.twimg.com/media/test${i}.jpg`);
const timers = [];
const messages = [];
let bridgeMessage;
class XHR { addEventListener() {} send() {} }
const fetchFn = () => Promise.resolve('unchanged');
const sendFn = XHR.prototype.send;
const windowBridge = {postMessage: value => messages.push(value), addEventListener: (kind,fn)=>{bridgeMessage=fn;}};
// A write to either networking entry point must fail this regression test.
Object.defineProperty(windowBridge,'fetch',{get:()=>fetchFn,set:()=>{throw new Error('fetch overwritten');}});
Object.defineProperty(XHR.prototype,'send',{get:()=>sendFn,set:()=>{throw new Error('XHR overwritten');}});

class Element {
  constructor(tag) { this.tagName=tag; this.children=[]; this.attrs={}; this.className=''; this.parentElement=null; }
  get isConnected() { return this === docRoot || Boolean(this.parentElement?.isConnected); }
  append(...nodes) { for(const node of nodes){node.parentElement=this;this.children.push(node);} }
  setAttribute(k,v) { this.attrs[k]=v; }
  removeAttribute(k) { delete this.attrs[k]; }
  contains(node) { return node===this || this.children.some(child=>child.contains(node)); }
  remove() { if(this.parentElement){this.parentElement.children=this.parentElement.children.filter(c=>c!==this);this.parentElement=null;} }
  before(node) { const p=this.parentElement;node.parentElement=p;p.children.splice(p.children.indexOf(this),0,node); }
  addEventListener() {}
  closest(selector) {
    for(let n=this;n;n=n.parentElement) {
      if(selector==='article' && n.tagName==='article')return n;
      if(selector.includes('.xapg-grid') && (n.className==='xapg-grid'||n.attrs['data-xapg-hidden']||n.attrs.role==='dialog')) return n;
    } return null;
  }
  querySelector(selector) {
    if(selector.includes('tweetText')) return null;
    const match=selector.match(/status\/(\d+)\/photo/);
    return all(this).find(n=>n.tagName==='a' && n.href?.includes(`/status/${match?.[1]}/photo/`))||null;
  }
  querySelectorAll() { return all(this).filter(n=>n.tagName==='a'); }
}
function all(node) { return node.children.flatMap(child=>[child,...all(child)]); }
const docRoot = new Element('html');
const article = new Element('article');docRoot.append(article);
article.__reactFiber$fixture = {memoizedProps:{},return:{memoizedProps:{tweet:{rest_id:id,legacy:{extended_entities:{media:urls.map(url=>({type:'photo',media_url_https:url}))}}}},return:null}};
const bridge = {document:{querySelectorAll:()=>[article]},window:windowBridge,location:{origin:'https://x.com',href:'https://x.com/home'}, XMLHttpRequest:XHR, URL, setTimeout:fn=>timers.push(fn)};
vm.runInNewContext(fs.readFileSync(root+'bridge.js','utf8'),bridge);
function nativeGallery() {
  const gallery=new Element('div');
  for(let i=1;i<=6;i++){const a=new Element('a');a.href=`https://x.com/example/status/${id}/photo/${i}`;gallery.append(a);}
  const frame=new Element('div');frame.className='fixed-height-overflow-hidden';
  const absolute=new Element('div');absolute.className='absolute';
  const spacer=new Element('div');spacer.className='aspect-ratio-spacer';
  absolute.append(gallery);frame.append(spacer,absolute);article.append(frame);
  gallery.frame=frame;return gallery;
}
let native=nativeGallery();let onMessage;let onMutation;
const context={document:{documentElement:docRoot,createElement:tag=>new Element(tag),querySelectorAll:()=>all(docRoot).filter(n=>n.tagName==='a')},window:{addEventListener:(kind,fn)=>{onMessage=fn;},postMessage(){}},location:{origin:'https://x.com',href:'https://x.com/home'},URL,setTimeout:fn=>timers.push(fn),MutationObserver:class{constructor(fn){onMutation=fn;}observe(){}}};
vm.runInNewContext(fs.readFileSync(root+'content.js','utf8'),context);
function flush() { while(timers.length)timers.shift()(); }
async function main() {
  assert.equal(windowBridge.fetch,fetchFn);
  assert.equal(XHR.prototype.send,sendFn);
  assert.equal(await windowBridge.fetch(),'unchanged');
  bridgeMessage({source:windowBridge,origin:'https://x.com',data:{channel:CHANNEL,kind:'request',ids:[id]}});flush();
  assert.equal(messages.at(-1).posts[0].urls.length,20);
  onMessage({source:context.window,origin:'https://x.com',data:messages.at(-1)});flush();
  let grid=article.children.find(n=>n.className==='xapg-grid');
  assert.equal(grid.children.length,20);
  assert.equal(native.frame.attrs['data-xapg-hidden'],'true');
  assert.equal(grid.parentElement,article,'grid must be OUTSIDE the fixed-size media frame');
  assert.equal(grid.children[19].href,`https://x.com/example/status/${id}/photo/20`);
  assert.equal(new URL(grid.children[19].children[0].src).searchParams.get('name'),'small');
  onMutation();flush();
  assert.equal(article.children.filter(n=>n.className==='xapg-grid').length,1);
  native.remove();native=nativeGallery();onMutation();flush();
  assert.equal(article.children.filter(n=>n.className==='xapg-grid').length,1);
  assert.equal(native.frame.attrs['data-xapg-hidden'],'true');
  native.remove();native=nativeGallery();
  onMessage({source:context.window,origin:'https://x.com',data:{channel:CHANNEL,kind:'photos',posts:[{id,urls:urls.slice(0,8)}]}});flush();
  grid=article.children.find(n=>n.className==='xapg-grid');
  assert.equal(grid.children.length,8);
  assert.equal(grid.children[7].children[1].textContent,'8');
  assert.equal(grid.parentElement,article);
  assert.equal(native.frame.attrs['data-xapg-hidden'],'true');
  // Missing internal data must produce no response and leave the native post alone.
  article.__reactFiber$fixture = null;
  const before=messages.length;
  bridgeMessage({source:windowBridge,origin:'https://x.com',data:{channel:CHANNEL,kind:'request',ids:[id]}});flush();
  assert.equal(messages.length,before);
  console.log('PASS: networking unchanged, React data, 8/20 thumbnails, numbering, placement outside fixed-height wrappers, no duplicates, re-render recovery');
}
main().catch(error=>{console.error(error);process.exitCode=1;});

