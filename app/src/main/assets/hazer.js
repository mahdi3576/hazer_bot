// ==UserScript==
// @name         ربات حاضر
// @namespace    hazer
// @version      2.0
// @description  زدن خودکار «حاضر» در نظرسنجی‌های روبیکا و شاد (اسکن گروه‌ها، انتخاب چندتایی، تشخیص با کلمه)
// @match        https://web.rubika.ir/*
// @match        https://web.shad.ir/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';
  if (window.__hazerLoaded) return;
  window.__hazerLoaded = true;

  // ------------------------------------------------------------------ تنظیمات
  const KEY = 'hazer_v1_' + location.hostname;
  const DEF = {
    include: 'حاضر',
    exclude: 'غایب, غیبت, غیر, نیستم, نیستیم, تایید معلم, تاییدیه معلم',
    interval: 5,
    click: 'mouse', // mouse | touch
    fs: 16,
    chats: [],
    selected: [],
    notify: true,
    wasRunning: false,
    sched: { on: false, week: [[], [], [], [], [], [], []], offDay: '' },
    hist: [],
  };
  let cfg = Object.assign({}, DEF);
  try { Object.assign(cfg, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) {} };
  if (!cfg.sched || !Array.isArray(cfg.sched.week)) cfg.sched = { on: !!(cfg.sched && cfg.sched.on), week: [[], [], [], [], [], [], []], offDay: '' };
  if (!Array.isArray(cfg.hist)) cfg.hist = [];
  // پل به برنامه اندروید (اعلان)؛ روی کامپیوتر از اعلان مرورگر استفاده می‌شود
  const nat = (fn, ...a) => { try { if (window.HazerNative && window.HazerNative[fn]) window.HazerNative[fn](...a); } catch (e) {} };
  function notifyUser(text) {
    if (cfg.notify === false) return;
    if (window.HazerNative) { nat('notify', 'ربات حاضر', text); return; }
    try { if ('Notification' in window && Notification.permission === 'granted') new Notification('ربات حاضر', { body: text }); } catch (e) {}
  }
  // برنامه هفتگی: روزها از شنبه (۰) تا جمعه (۶)؛ هر روز چند کلاس {chat, from, to}
  const dayIdx = (d) => (d.getDay() + 1) % 7;
  const pmin = (t) => { const x = String(t || '0:0').split(':').map(Number); return (x[0] || 0) * 60 + (x[1] || 0); };
  const todayStr = () => { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };
  const offToday = () => cfg.sched.offDay === todayStr();
  // گروه‌هایی که همین الان باید زیر نظر باشند
  function activeChats() {
    const sc = cfg.sched;
    if (offToday()) return [];
    if (!sc.on) return cfg.chats.filter((n) => cfg.selected.includes(n));
    const now = new Date(), m = now.getHours() * 60 + now.getMinutes(), out = [];
    (sc.week[dayIdx(now)] || []).forEach((c) => {
      if (m >= pmin(c.from) && m <= pmin(c.to) && !out.includes(c.chat)) out.push(c.chat);
    });
    return out;
  }
  const inSchedule = () => activeChats().length > 0;
  const hasPlan = () => cfg.sched.on ? cfg.sched.week.some((d) => d.length) : cfg.selected.some((n) => cfg.chats.includes(n));

  // ------------------------------------------------------------ منطق تشخیص گزینه
  const norm = (s) => String(s || '').toLowerCase()
    .replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/[ۀة]/g, 'ه')
    .replace(/[أإآ]/g, 'ا').replace(/ؤ/g, 'و').replace(/ئ/g, 'ی')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[\u200c\u200f\u200e]/g, '').replace(/\s+/g, '');
  const words = (t) => String(t || '').split(/[,،\n;؛]+/).map((w) => w.trim()).filter(Boolean);
  function decide(text, include, exclude) {
    const t = norm(text);
    if (exclude.some((w) => norm(w) && t.includes(norm(w)))) return false;
    return include.some((w) => norm(w) && t.includes(norm(w)));
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ------------------------------------------------------------------- کلیک
  function fire(el, type, Ctor, extra) {
    el.dispatchEvent(new Ctor(type, Object.assign({ bubbles: true, cancelable: true, composed: true, view: window }, extra)));
  }
  function clickEl(el) {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const o = { clientX: x, clientY: y, button: 0 };
    if (cfg.click === 'touch' && typeof Touch !== 'undefined' && typeof TouchEvent !== 'undefined') {
      const t = new Touch({ identifier: Date.now(), target: el, clientX: x, clientY: y });
      fire(el, 'touchstart', TouchEvent, { touches: [t], targetTouches: [t], changedTouches: [t] });
      fire(el, 'touchend', TouchEvent, { touches: [], targetTouches: [], changedTouches: [t] });
      return;
    }
    fire(el, 'pointerdown', PointerEvent, o);
    fire(el, 'mousedown', MouseEvent, o);
    fire(el, 'pointerup', PointerEvent, o);
    fire(el, 'mouseup', MouseEvent, o);
    fire(el, 'click', MouseEvent, o);
  }

  // ------------------------------------------------------------- لیست چت‌ها
  const visible = (e) => !!(e && (e.offsetParent || (e.getClientRects && e.getClientRects().length)));
  // عنوان چت‌ها: اول با کلاس معمول، اگر نبود هر عنوانی که داخل پیام‌ها نباشد
  function listItems() {
    const out = [];
    const add = (el, t) => { const name = (t.innerText || '').trim(); if (name) out.push({ el, name }); };
    document.querySelectorAll('.chatlist-chat').forEach((el) => {
      const t = el.querySelector('.peer-title');
      if (t) add(el, t);
    });
    if (out.length) return out;
    document.querySelectorAll('.peer-title').forEach((t) => {
      if (t.closest('[data-mid], .bubble, .poll, .poll-answer')) return;
      add(t.closest('a, li, [data-peer-id], [data-dialog-id], .row') || t, t);
    });
    return out;
  }
  function scrollableParent(el) {
    while (el && el !== document.body && el !== document.documentElement) {
      if (el.scrollHeight > el.clientHeight + 5 && /(auto|scroll)/.test(getComputedStyle(el).overflowY)) return el;
      el = el.parentElement;
    }
    return null;
  }
  function scroller() {
    const first = listItems()[0];
    if (first) {
      const sc = scrollableParent(first.el);
      if (sc) return sc;
    }
    return scrollableParent(document.querySelector('ul.chatlist') || document.querySelector('.chatlist'));
  }
  function diag() {
    const all = [...document.querySelectorAll('.peer-title')];
    let chain = '', e = all[0];
    for (let i = 0; i < 4 && e; i++) {
      chain += (e.tagName || '') + '.' + String(e.className || '').split(/\s+/).slice(0, 3).join('.') + ' < ';
      e = e.parentElement;
    }
    return 'peer-title=' + all.length + ' chatlist-chat=' + document.querySelectorAll('.chatlist-chat').length +
      ' | ' + chain;
  }
  async function scan() {
    const seen = new Set(), names = [];
    const sc = scroller();
    let stable = 0;
    for (let i = 0; i < 60; i++) {
      const before = seen.size;
      listItems().forEach((x) => { if (!seen.has(x.name)) { seen.add(x.name); names.push(x.name); } });
      if (seen.size === before) { if (++stable >= 3) break; } else stable = 0;
      if (!sc) break;
      sc.scrollTop = sc.scrollHeight;
      await sleep(700);
    }
    if (sc) sc.scrollTop = 0;
    return names;
  }
  function setInput(inp, v) {
    const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    d.set.call(inp, v);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  }
  async function openChat(name) {
    const n = norm(name);
    let el = null;
    const items = listItems();
    const it = items.find((x) => norm(x.name) === n) || items.find((x) => norm(x.name).includes(n));
    if (it) el = it.el;
    if (!el) {
      const inp = document.querySelector('.input-search input') || document.querySelector('input[type="text"]');
      if (!inp) throw new Error('search box not found');
      setInput(inp, '');
      setInput(inp, name);
      await sleep(1600);
      const cand = [...document.querySelectorAll('.peer-title')].filter((e) => visible(e) && norm(e.innerText).includes(n));
      if (!cand.length) throw new Error('not found');
      el = cand[0];
    }
    el.scrollIntoView({ block: 'center' });
    clickEl(el.querySelector ? (el.querySelector('.peer-title') || el) : el);
    await sleep(1500);
  }

  // ------------------------------------------------------------ نظرسنجی‌ها
  function readPolls() {
    const nodes = [...document.querySelectorAll('.poll-answer-text')];
    const groups = new Map();
    nodes.forEach((el) => {
      const box = el.closest('.poll') || el.closest('[data-mid]') ||
        (el.parentElement && el.parentElement.parentElement) || el.parentElement;
      if (!groups.has(box)) groups.set(box, []);
      groups.get(box).push(el);
    });
    const out = [];
    groups.forEach((els, box) => {
      const bubble = box.closest('[data-mid]') || box;
      const mid = (bubble.getAttribute && bubble.getAttribute('data-mid')) || '';
      const sig = mid + '|' + els.map((e) => e.innerText.trim()).join('/');
      const answers = els.map((el) => {
        const a = el.closest('.poll-answer') || el.parentElement;
        const chosen = !!(a && (a.querySelector('input:checked') || /chosen|voted|selected|checked/i.test(a.className || '')));
        return { el, a, text: el.innerText.trim(), chosen };
      });
      out.push({ sig, answers });
    });
    return out;
  }

  // ------------------------------------------------------------- حلقه اصلی
  let running = false, loopToken = 0;
  const voted = new Set(), skipped = new Set(), opened = new Set();

  async function waitFor(ms, token) {
    const end = Date.now() + ms;
    while (Date.now() < end && running && token === loopToken) await sleep(200);
  }

  // ترمیم خودکار: صفحه را دوباره بارگذاری می‌کند و ربات بعد از آن خودش ادامه می‌دهد
  function recover(reason) {
    const K = 'hazer_rec_' + location.hostname;
    let arr = []; try { arr = JSON.parse(localStorage.getItem(K) || '[]'); } catch (e) {}
    const now = Date.now(); arr = arr.filter((t) => now - t < 600000); arr.push(now);
    try { localStorage.setItem(K, JSON.stringify(arr)); } catch (e) {}
    loopToken++; running = false;
    if (arr.length > 5) {
      log('چند بار پشت سر هم مشکل پیش آمد؛ ربات متوقف شد. اینترنت و ورود به حساب را بررسی کن.');
      setRunning(false); return;
    }
    log(reason + ' — بارگذاری مجدد صفحه...');
    setTimeout(() => location.reload(), 1500);
  }
  function addHist(chat, text) {
    cfg.hist.push({ t: Date.now(), chat, text });
    if (cfg.hist.length > 300) cfg.hist.splice(0, cfg.hist.length - 300);
    save(); renderHist();
    notifyUser('«حاضر» زده شد در ' + chat);
  }

  async function runLoop(token) {
    const inc = words(cfg.include), exc = words(cfg.exclude);
    let current = null, idx = 0, fails = 0, waiting = false;
    voted.clear(); skipped.clear(); opened.clear();
    while (running && token === loopToken) {
      const chats = activeChats();
      if (!chats.length) {
        if (!cfg.sched.on && !offToday()) { log('گروهی انتخاب نشده'); setRunning(false); break; }
        if (!waiting) {
          waiting = true; current = null;
          log(offToday() ? 'امروز تعطیل است؛ ربات تا فردا منتظر می‌ماند' : 'الان کلاسی نیست؛ منتظر می‌مانم...');
          paintPill();
        }
        await waitFor(20000, token);
        continue;
      }
      if (waiting) { waiting = false; current = null; log('ساعت کلاس شد: ' + chats.join('، ')); paintPill(); }
      const name = chats[idx++ % chats.length];
      try {
        if (current !== name) {
          await openChat(name);
          current = name; fails = 0;
          if (!opened.has(name)) { opened.add(name); log('«' + name + '» باز شد، در حال نظارت'); }
        }
        for (const p of readPolls()) {
          const key = name + '||' + p.sig;
          if (voted.has(key)) continue;
          if (p.answers.some((a) => a.chosen)) { voted.add(key); continue; }
          const pick = p.answers.find((a) => decide(a.text, inc, exc));
          if (!pick) {
            if (!skipped.has(key)) { skipped.add(key); log('«' + name + '»: گزینه مناسبی نبود (' + p.answers.map((a) => a.text).join(' / ').slice(0, 70) + ')'); }
            continue;
          }
          const target = (pick.a && pick.a.querySelector('.poll-line')) || pick.a || pick.el;
          clickEl(target);
          voted.add(key);
          log('«' + name + '»: روی «' + pick.text + '» زده شد ✅');
          addHist(name, pick.text);
          await sleep(800);
        }
      } catch (e) {
        current = null;
        if (++fails >= 5) { recover('صفحه پاسخ نمی‌دهد'); return; }
        log('«' + name + '» باز نشد، دوباره تلاش می‌کنم');
        await sleep(1500);
      }
      await waitFor(chats.length === 1 ? Math.max(2, cfg.interval) * 1000 : 1000, token);
    }
  }

  // ---------------------------------------------------------------- رابط
  const host = document.createElement('div');
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;';
  document.documentElement.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
<style>
:host{all:initial}
:host{
 --b0:#0a2124;--b1:#0f2e32;--b2:#164046;--b3:#1f565c;
 --chalk:#f4efe2;--mut:#9cbab4;--line:#ffffff1c;
 --y:#ffc93c;--y2:#d99600;--y3:#8a5d00;--yd:#3a2a00;
 --g:#4ee3a0;--g2:#1c9c68;
 --r:#ff705f;--r2:#bd3a28;--rd:#2a0b07;
}
*{box-sizing:border-box;font-family:"Vazirmatn","Vazir","Segoe UI",Tahoma,sans-serif;-webkit-tap-highlight-color:transparent}
.fab{position:fixed;left:.9em;bottom:.9em;width:3.9em;height:3.9em;border-radius:50%;border:0;cursor:pointer;font-size:1em;
 display:flex;align-items:center;justify-content:center;
 background:radial-gradient(circle at 32% 26%,#fff6c4 0,#ffd75e 26%,var(--y) 55%,var(--y2) 100%);
 box-shadow:inset -.2em -.35em .6em #a0640066,inset .15em .2em .35em #ffffffb0,0 .3em 0 var(--y3),0 .8em 1em #000a}
.fab span{font-size:1.5em;filter:drop-shadow(0 .06em .05em #0006)}
.fab:active{transform:translateY(.2em);box-shadow:inset -.2em -.35em .6em #a0640066,inset .15em .2em .35em #ffffffb0,0 .1em 0 var(--y3),0 .3em .6em #000a}
.fab.on{background:radial-gradient(circle at 32% 26%,#d8ffec 0,#7af2bb 28%,var(--g) 58%,var(--g2) 100%);
 box-shadow:inset -.2em -.35em .6em #0a5a3a66,inset .15em .2em .35em #ffffffb0,0 .3em 0 #136b46,0 .8em 1em #000a;animation:pulse 2.2s infinite}
@keyframes pulse{0%,100%{filter:none}50%{filter:drop-shadow(0 0 .7em #4ee3a0aa)}}
.sheet{position:fixed;display:none;flex-direction:column;direction:rtl;color:var(--chalk);overflow:hidden;
 background:radial-gradient(#ffffff0d .07em,transparent .08em) 0 0/1.4em 1.4em,
  radial-gradient(90% 45% at 90% -8%,#2f7a80aa,transparent 62%),
  linear-gradient(180deg,var(--b1),var(--b0))}
.sheet.open{display:flex}
.sheet.phone{inset:0;border-radius:0}
.sheet.desk{top:.8em;bottom:.8em;left:.8em;width:30em;border-radius:1.5em;border:1px solid var(--line);box-shadow:0 2em 5em #000c,inset 0 .1em 0 #ffffff14}
.hd{display:flex;align-items:center;gap:.7em;padding:1em 1.1em .7em}
.logo{width:2.9em;height:2.9em;border-radius:.95em;display:flex;align-items:center;justify-content:center;font-size:1.1em;
 background:linear-gradient(160deg,#ffe48f,var(--y) 55%,var(--y2));
 box-shadow:inset 0 .12em 0 #fffa,inset 0 -.15em .2em #a0640055,0 .25em 0 var(--y3),0 .55em .8em #0008}
.ttl{flex:1;line-height:1.35}
.ttl b{display:block;font-size:1.2em;font-weight:900;text-shadow:0 .08em 0 #0006}
.ttl small{color:var(--mut);font-size:.78em}
.pill{display:flex;align-items:center;gap:.5em;padding:.4em .85em;border-radius:2em;background:#0000004d;
 box-shadow:inset 0 .12em .3em #000b,0 1px 0 #ffffff14;font-size:.78em;color:var(--mut);white-space:nowrap}
.dot{width:.8em;height:.8em;border-radius:50%;background:radial-gradient(circle at 35% 30%,#7f9a95,#33504c);box-shadow:inset 0 -.1em .15em #0008}
.pill.on{color:#b9ffe0}
.pill.on .dot{background:radial-gradient(circle at 35% 30%,#eafff4,var(--g) 55%,var(--g2));box-shadow:0 0 .7em #4ee3a0cc,inset 0 -.1em .15em #0a5a3a88}
.x{width:2.5em;height:2.5em;border-radius:.85em;border:0;color:var(--chalk);font:inherit;cursor:pointer;
 background:linear-gradient(180deg,var(--b3),var(--b2));box-shadow:inset 0 .1em 0 #ffffff2a,0 .2em 0 #06171a,0 .4em .6em #0006}
.x:active{transform:translateY(.17em);box-shadow:inset 0 .1em 0 #ffffff2a,0 .03em 0 #06171a}
.tabs{display:flex;gap:.25em;margin:.3em 1.1em .5em;padding:.3em;background:#0000004d;border-radius:1.1em;
 box-shadow:inset 0 .18em .45em #000c,0 1px 0 #ffffff14}
.tab{flex:1;border:0;background:transparent;color:var(--mut);font:inherit;font-weight:800;font-size:.8em;padding:.75em .1em;white-space:nowrap;border-radius:.8em;cursor:pointer}
.tab.on{background:linear-gradient(180deg,#ffdc72,var(--y));color:var(--yd);transform:translateY(-.08em);
 box-shadow:inset 0 .1em 0 #fffa,0 .2em 0 var(--y2),0 .4em .6em #0007}
.body{flex:1;overflow-y:auto;padding:.5em 1.1em 1.2em;-webkit-overflow-scrolling:touch}
.page{display:none}.page.on{display:block}
.card{background:linear-gradient(180deg,#ffffff14,#ffffff09);border:1px solid var(--line);border-radius:1.1em;padding:.95em;
 box-shadow:inset 0 .1em 0 #ffffff18,0 .3em 0 #06171a,0 .7em 1.1em #0006;margin-bottom:.5em}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:.6em;margin-bottom:1em;perspective:42em}
.stat{background:linear-gradient(180deg,#ffffff1c,#ffffff0a);border:1px solid var(--line);border-radius:1em;padding:.75em .3em .6em;text-align:center;
 transform:rotateX(9deg);transform-origin:50% 100%;box-shadow:inset 0 .1em 0 #ffffff22,0 .35em 0 #06171a,0 .8em 1em #0007}
.stat b{display:block;font-size:1.75em;font-weight:900;color:var(--y);line-height:1.3;
 text-shadow:0 .035em 0 var(--y2),0 .07em 0 #a87000,0 .105em 0 var(--y3),0 .2em .2em #0009}
.stat span{font-size:.74em;color:var(--mut)}
.row2{display:flex;gap:.55em;margin-bottom:.9em}
.btn{white-space:nowrap;border:0;cursor:pointer;font:inherit;font-weight:800;font-size:.95em;border-radius:.95em;padding:.8em 1em;
 color:var(--yd);background:linear-gradient(180deg,#ffdc72,var(--y));
 box-shadow:inset 0 .1em 0 #fffa,0 .25em 0 var(--y2),0 .5em .7em #0006;transition:transform .08s,box-shadow .08s}
.btn:active{transform:translateY(.22em);box-shadow:inset 0 .1em 0 #fffa,0 .03em 0 var(--y2),0 .1em .2em #0006}
.btn:disabled{opacity:.55}
.btn.g{color:var(--chalk);font-weight:700;background:linear-gradient(180deg,#2b6a70,var(--b3));
 box-shadow:inset 0 .1em 0 #ffffff30,0 .25em 0 #06171a,0 .5em .7em #0006}
.btn.g:active{box-shadow:inset 0 .1em 0 #ffffff30,0 .03em 0 #06171a,0 .1em .2em #0006}
.btn.sm{padding:.65em .9em;font-size:.88em}
input[type=text],input[type=number],input[type=time],select{width:100%;background:#00000040;color:var(--chalk);border:1px solid #ffffff14;
 border-radius:.9em;padding:.8em .9em;font:inherit;font-size:.95em;text-align:right;outline:none;min-width:0;box-shadow:inset 0 .15em .4em #000b}
input::placeholder{color:#7d9a94}
input:focus,select:focus{border-color:var(--y);box-shadow:inset 0 .15em .4em #000b,0 0 0 .18em #ffc93c33}
select option{color:#111}
input[type=time]{direction:ltr;text-align:center}
.list{border-radius:1.1em;background:#0000003d;box-shadow:inset 0 .2em .55em #000c,0 1px 0 #ffffff14;overflow:hidden}
.item{display:flex;align-items:center;gap:.8em;padding:.85em .9em;cursor:pointer;border-bottom:1px solid #ffffff0f}
.item:last-child{border-bottom:0}
.item.on{background:#4ee3a014;box-shadow:inset -.28em 0 0 var(--g)}
.av{width:2.6em;height:2.6em;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;font-weight:900;color:#fff;font-size:.95em;
 background-image:radial-gradient(circle at 32% 26%,#ffffffb8,#ffffff00 46%),radial-gradient(circle at 72% 90%,#0000007a,#0000 62%);
 box-shadow:inset 0 -.18em .3em #0005,inset 0 .1em .15em #fff6,0 .22em .4em #0008;text-shadow:0 .06em .1em #0007}
.nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.98em;font-weight:600}
.sw{position:relative;width:2.9em;height:1.65em;border-radius:2em;background:#00000070;flex:none;transition:.18s;
 box-shadow:inset 0 .2em .35em #000d,0 1px 0 #ffffff1c}
.sw::after{content:"";position:absolute;top:.2em;right:.2em;width:1.25em;height:1.25em;border-radius:50%;transition:.18s;
 background:radial-gradient(circle at 35% 28%,#fff,#ddd7c6 58%,#a9a392);box-shadow:0 .15em .25em #000a,inset 0 -.1em .15em #0003}
.item.on .sw{background:linear-gradient(180deg,var(--g2),var(--g));box-shadow:inset 0 .2em .35em #0a5a3acc,0 1px 0 #ffffff1c}
.item.on .sw::after{right:1.45em}
.empty{padding:2.2em 1em;text-align:center;color:var(--mut);line-height:2.1;font-size:.95em}
.empty .big{font-size:2.6em;display:block;margin-bottom:.2em;filter:drop-shadow(0 .1em .1em #0008)}
.lb{color:var(--mut);font-size:.82em;margin:.9em .2em .45em}
.two{display:grid;grid-template-columns:1fr 1fr;gap:.6em}
.step{display:flex;align-items:center;gap:.6em}
.step .btn{width:3em;padding:.6em 0}
.step b{flex:1;text-align:center;font-weight:900;font-size:1.1em}
.log{display:flex;flex-direction:column;gap:.5em}
.ln{background:#00000033;border-radius:.9em;padding:.65em .85em;font-size:.88em;line-height:1.8;border-right:.28em solid #ffffff2a;box-shadow:inset 0 .1em .25em #0008}
.ln.ok{border-right-color:var(--g);background:#4ee3a014}
.ln .t{color:var(--mut);direction:ltr;display:block;font-size:.8em}
.chips{display:flex;gap:.4em}
.chip{position:relative;flex:1;text-align:center;padding:.7em 0;border-radius:.85em;color:var(--mut);font-weight:800;cursor:pointer;font-size:.92em;
 background:linear-gradient(180deg,#2b6a70,var(--b3));box-shadow:inset 0 .1em 0 #ffffff2a,0 .22em 0 #06171a,0 .4em .5em #0005}
.chip:active{transform:translateY(.18em);box-shadow:inset 0 .1em 0 #ffffff2a,0 .03em 0 #06171a}
.chip.on{background:linear-gradient(180deg,#ffdc72,var(--y));color:var(--yd);box-shadow:inset 0 .1em 0 #fffa,0 .22em 0 var(--y2),0 .4em .5em #0006}
.chip.has::after{content:'';display:block;width:.42em;height:.42em;border-radius:50%;background:var(--g);margin:.22em auto 0;box-shadow:0 0 .4em #4ee3a0}
.cls{background:linear-gradient(180deg,#ffffff14,#ffffff09);border:1px solid var(--line);border-radius:1em;padding:.7em;margin-bottom:.7em;
 box-shadow:inset 0 .1em 0 #ffffff18,0 .25em 0 #06171a,0 .5em .8em #0005}
.cls .top{display:flex;gap:.5em;margin-bottom:.5em}
.cls .del{flex:none;width:3em;border:0;border-radius:.8em;color:var(--rd);font:inherit;font-weight:900;cursor:pointer;
 background:linear-gradient(180deg,#ff9a8c,var(--r));box-shadow:inset 0 .1em 0 #fff8,0 .2em 0 var(--r2),0 .35em .5em #0006}
.cls .del:active{transform:translateY(.17em);box-shadow:inset 0 .1em 0 #fff8,0 .03em 0 var(--r2)}
.hint{color:var(--mut);font-size:.82em;line-height:1.9;margin:.8em .2em}
.ft{padding:.8em 1.1em calc(1em + env(safe-area-inset-bottom,0px));background:linear-gradient(0deg,var(--b0) 62%,#0a212400)}
.start{width:100%;border:0;cursor:pointer;font:inherit;font-weight:900;font-size:1.25em;padding:.95em;border-radius:1.15em;color:var(--yd);
 background:linear-gradient(180deg,#ffe38e,var(--y) 58%,#f2b520);
 box-shadow:inset 0 .13em 0 #fffb,inset 0 -.15em .25em #b8800044,0 .4em 0 var(--y2),0 .8em 1.3em #000a;transition:transform .08s,box-shadow .08s;text-shadow:0 .05em 0 #fff6}
.start:active{transform:translateY(.32em);box-shadow:inset 0 .13em 0 #fffb,inset 0 -.15em .25em #b8800044,0 .08em 0 var(--y2),0 .3em .6em #000a}
.start.stop{color:var(--rd);background:linear-gradient(180deg,#ffb0a4,var(--r) 58%,#ea5846);
 box-shadow:inset 0 .13em 0 #fffa,inset 0 -.15em .25em #a0200f44,0 .4em 0 var(--r2),0 .8em 1.3em #000a}
.start.stop:active{box-shadow:inset 0 .13em 0 #fffa,0 .08em 0 var(--r2),0 .3em .6em #000a}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style>

<button class="fab" id="fab"><span>✋</span></button>
<div class="sheet" id="sheet">
  <div class="hd">
    <div class="logo">✋</div>
    <div class="ttl"><b>ربات حاضر</b><small id="site"></small></div>
    <div class="pill" id="pill"><i class="dot"></i><span id="pt">متوقف</span></div>
    <button class="x" id="close">✕</button>
  </div>
  <div class="tabs">
    <button class="tab on" data-t="groups">گروه‌ها</button>
    <button class="tab" data-t="sched">برنامه</button>
    <button class="tab" data-t="settings">تنظیمات</button>
    <button class="tab" data-t="log">گزارش</button>
    <button class="tab" data-t="hist">تاریخچه</button>
  </div>
  <div class="body">
    <div class="page on" id="p-groups">
      <div class="stats">
        <div class="stat"><b id="s1">0</b><span>پیدا شده</span></div>
        <div class="stat"><b id="s2">0</b><span>انتخاب شده</span></div>
        <div class="stat"><b id="s3">0</b><span>امروز زده شد</span></div>
      </div>
      <div class="row2">
        <button class="btn sm" id="scan">⟳ اسکن گروه‌ها</button>
        <input type="text" id="q" placeholder="جستجو...">
      </div>
      <div class="row2">
        <button class="btn g sm" id="all">انتخاب همه</button>
        <button class="btn g sm" id="none">هیچ‌کدام</button>
      </div>
      <div class="list" id="list"></div>
      <div class="lb">افزودن دستی (اگر اسکن پیدایش نکرد)</div>
      <div class="row2">
        <input type="text" id="add" placeholder="اسم گروه یا کانال">
        <button class="btn g sm" id="addb">+ افزودن</button>
      </div>
    </div>

    <div class="page" id="p-sched">
      <div class="list"><div class="item" id="sch_on"><span class="nm">برنامه هفتگی (کلاس‌های هر روز)</span><i class="sw"></i></div></div>
      <div class="lb">روز را انتخاب کن و کلاس‌هایش را بنویس</div>
      <div class="chips" id="days"></div>
      <div id="classes" style="margin-top:.8em"></div>
      <div class="row2">
        <button class="btn sm" id="addc">+ افزودن کلاس</button>
        <button class="btn g sm" id="off">😴 امروز تعطیل</button>
      </div>
      <div class="card" style="margin-top:.4em"><span id="sstate"></span></div>
      <div class="hint">وقتی برنامه روشن است، ربات فقط در ساعت هر کلاس سراغ همان گروه می‌رود و بیرون از آن منتظر می‌ماند. اگر برنامه خاموش باشد، گروه‌های تیک‌خورده در تب «گروه‌ها» همیشه زیر نظرند.</div>
    </div>

    <div class="page" id="p-settings">
      <div class="list" style="margin-bottom:.8em"><div class="item" id="ntf"><span class="nm">اعلان و لرزش بعد از زدن «حاضر»</span><i class="sw"></i></div></div>
      <div class="card">
        <div class="lb" style="margin-top:0">بزن اگر گزینه این کلمه را داشت</div>
        <input type="text" id="inc">
        <div class="lb">نزن اگر این کلمه‌ها را داشت (با کاما)</div>
        <input type="text" id="exc">
        <div class="two">
          <div><div class="lb">فاصله بررسی (ثانیه)</div><input type="number" id="int" min="2" max="120"></div>
          <div><div class="lb">روش کلیک</div><select id="clk"><option value="mouse">موس</option><option value="touch">لمس</option></select></div>
        </div>
        <div class="lb">اندازه نوشته‌ها و دکمه‌ها</div>
        <div class="step"><button class="btn g" id="fm">−</button><b id="fv"></b><button class="btn g" id="fp">+</button></div>
      </div>
    </div>

    <div class="page" id="p-log"><div class="log" id="log"></div></div>

    <div class="page" id="p-hist">
      <div class="stats">
        <div class="stat"><b id="h1">0</b><span>امروز</span></div>
        <div class="stat"><b id="h2">0</b><span>۷ روز اخیر</span></div>
        <div class="stat"><b id="h3">0</b><span>کل</span></div>
      </div>
      <div class="log" id="hlist"></div>
      <div class="row2" style="margin-top:.8em"><button class="btn g sm" id="hclr">پاک کردن تاریخچه</button></div>
    </div>
  </div>
  <div class="ft"><button class="start" id="start">▶ شروع</button></div>
</div>`;
  const $ = (id) => root.getElementById(id);
  const sheet = $('sheet');
  const fa = (n) => { try { return Number(n).toLocaleString('fa-IR'); } catch (e) { return String(n); } };

  // ---------------- اندازه: در حالت «Desktop site» گوشی، پنل را به اندازه واقعی صفحه گوشی برمی‌گرداند
  const coarse = () => { try { return matchMedia('(pointer:coarse)').matches || navigator.maxTouchPoints > 0; } catch (e) { return false; } };
  function uiScale() {
    if (!coarse()) return 1; // کامپیوتر: بدون بزرگ‌نمایی
    const dev = Math.max(1, Math.min(screen.width || innerWidth, screen.height || innerWidth));
    return Math.max(1, Math.min(4, innerWidth / dev));
  }
  function applyFs() {
    const k = uiScale();
    const phone = coarse() || innerWidth < 700;
    sheet.className = 'sheet ' + (phone ? 'phone' : 'desk') + (sheet.classList.contains('open') ? ' open' : '');
    const px = cfg.fs * k;
    sheet.style.fontSize = px + 'px';
    $('fab').style.fontSize = px + 'px';
    $('fv').textContent = fa(cfg.fs);
  }
  window.addEventListener('resize', applyFs);

  // ---------------- گزارش
  function log(msg) {
    const d = document.createElement('div');
    d.className = 'ln' + (msg.includes('✅') ? ' ok' : '');
    const m = document.createElement('span'); m.textContent = msg;
    const t = document.createElement('span'); t.className = 't'; t.textContent = new Date().toLocaleTimeString('en-GB');
    d.append(m, t);
    const box = $('log'); box.append(d);
    while (box.children.length > 80) box.removeChild(box.firstChild);
    $('p-log').scrollTop = 1e9;
  }

  // ---------------- لیست
  const COLORS = ['#ff7a59', '#f2a516', '#2fc795', '#4aa8f0', '#9b7df2', '#f0629a', '#88c43c', '#e08a45'];
  function colorOf(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; }
  function updCount() {
    $('s1').textContent = fa(cfg.chats.length);
    $('s2').textContent = fa(cfg.selected.filter((n) => cfg.chats.includes(n)).length);
  }
  function renderList() {
    const box = $('list'); box.innerHTML = '';
    const q = norm($('q').value); let shown = 0;
    cfg.chats.forEach((n) => {
      if (q && !norm(n).includes(q)) return; shown++;
      const on = cfg.selected.includes(n);
      const it = document.createElement('div'); it.className = 'item' + (on ? ' on' : '');
      const av = document.createElement('div'); av.className = 'av'; av.style.backgroundColor = colorOf(n);
      av.textContent = [...n.trim()][0] || '؟';
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = n;
      const sw = document.createElement('i'); sw.className = 'sw';
      it.append(av, nm, sw);
      it.onclick = () => {
        const now = !cfg.selected.includes(n);
        cfg.selected = cfg.selected.filter((x) => x !== n); if (now) cfg.selected.push(n);
        it.classList.toggle('on', now); save(); updCount();
      };
      box.append(it);
    });
    if (!shown) {
      const e = document.createElement('div'); e.className = 'empty';
      e.innerHTML = cfg.chats.length ? '<span class="big">🔍</span>موردی پیدا نشد'
        : '<span class="big">📭</span>هنوز گروهی نیست.<br>دکمه «اسکن گروه‌ها» را بزن<br>یا اسم گروه را دستی اضافه کن.';
      box.append(e);
    }
    updCount();
  }
  function paintPill() {
    const wait = running && !inSchedule();
    $('pill').className = 'pill' + (running && !wait ? ' on' : '');
    $('pt').textContent = !running ? 'متوقف' : (offToday() ? 'تعطیل امروز' : (wait ? 'منتظر ساعت کلاس' : 'در حال اجرا'));
  }
  function setRunning(v) {
    running = v; cfg.wasRunning = v; save();
    const b = $('start'); b.textContent = v ? '■ توقف' : '▶ شروع'; b.className = 'start' + (v ? ' stop' : '');
    $('fab').classList.toggle('on', v);
    paintPill();
  }
  const sameDay = (a, b) => a.toDateString() === b.toDateString();
  function renderHist() {
    const h = cfg.hist, now = new Date(), wk = Date.now() - 7 * 864e5;
    const today = h.filter((x) => sameDay(new Date(x.t), now)).length;
    $('s3').textContent = fa(today); $('h1').textContent = fa(today);
    $('h2').textContent = fa(h.filter((x) => x.t >= wk).length); $('h3').textContent = fa(h.length);
    const box = $('hlist'); box.innerHTML = '';
    if (!h.length) { box.innerHTML = '<div class="empty"><span class="big">🗒️</span>هنوز چیزی ثبت نشده</div>'; return; }
    h.slice(-100).reverse().forEach((x) => {
      const d = document.createElement('div'); d.className = 'ln ok';
      const m = document.createElement('span'); m.textContent = x.chat + ' — ' + x.text;
      const t = document.createElement('span'); t.className = 't'; t.style.direction = 'rtl';
      try { t.textContent = new Date(x.t).toLocaleString('fa-IR', { weekday: 'long', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
      catch (e) { t.textContent = new Date(x.t).toLocaleString(); }
      d.append(m, t); box.append(d);
    });
  }
  const DAYN = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];
  let editDay = dayIdx(new Date());
  function chatOptions(sel) {
    const names = cfg.chats.slice(); if (sel && !names.includes(sel)) names.push(sel);
    return names.map((n) => '<option value="' + n.replace(/"/g, '&quot;') + '"' + (n === sel ? ' selected' : '') + '>' + n.replace(/</g, '&lt;') + '</option>').join('');
  }
  function renderSched() {
    $('sch_on').classList.toggle('on', !!cfg.sched.on);
    $('ntf').classList.toggle('on', cfg.notify !== false);
    const box = $('days'); box.innerHTML = '';
    DAYN.forEach((n, i) => {
      const c = document.createElement('div');
      c.className = 'chip' + (i === editDay ? ' on' : '') + (cfg.sched.week[i].length ? ' has' : ''); c.textContent = n;
      c.onclick = () => { editDay = i; renderSched(); };
      box.append(c);
    });
    const list = $('classes'); list.innerHTML = '';
    const arr = cfg.sched.week[editDay];
    if (!arr.length) {
      list.innerHTML = '<div class="empty"><span class="big">🗓️</span>برای این روز کلاسی نیست.<br>«افزودن کلاس» را بزن.</div>';
    }
    arr.forEach((c, i) => {
      const row = document.createElement('div'); row.className = 'cls';
      row.innerHTML = '<div class="top"><select>' + chatOptions(c.chat) + '</select><button class="del">✕</button></div>' +
        '<div class="two"><input type="time" class="f"><input type="time" class="t"></div>';
      const f = row.querySelector('.f'), t = row.querySelector('.t'), sel = row.querySelector('select');
      f.value = c.from; t.value = c.to;
      sel.onchange = () => { c.chat = sel.value; save(); updSched(); };
      f.onchange = () => { c.from = f.value || '08:00'; save(); updSched(); };
      t.onchange = () => { c.to = t.value || '09:30'; save(); updSched(); };
      row.querySelector('.del').onclick = () => { arr.splice(i, 1); save(); renderSched(); };
      list.append(row);
    });
    $('off').textContent = offToday() ? '↩ لغو تعطیلی امروز' : '😴 امروز تعطیل';
    updSched();
  }
  function updSched() {
    let t;
    if (offToday()) t = '😴 امروز تعطیل است؛ ربات تا فردا کاری نمی‌کند.';
    else if (!cfg.sched.on) t = 'برنامه هفتگی خاموش است؛ گروه‌های تیک‌خورده همیشه زیر نظرند.';
    else {
      const now = new Date(), m = now.getHours() * 60 + now.getMinutes(), act = activeChats();
      if (act.length) t = '🟢 الان کلاس: ' + act.join('، ');
      else {
        const next = (cfg.sched.week[dayIdx(now)] || []).filter((c) => pmin(c.from) > m).sort((a, b) => pmin(a.from) - pmin(b.from))[0];
        if (next) {
          const d = pmin(next.from) - m, h = Math.floor(d / 60), mm = d % 60;
          t = '⏳ کلاس بعدی: ' + next.chat + ' ساعت ' + next.from + ' (' + (h ? h + ' ساعت و ' : '') + mm + ' دقیقه دیگر)';
        } else t = '⏸ امروز کلاس دیگری نمانده.';
      }
    }
    $('sstate').textContent = t;
    paintPill();
  }
  function readSettings() {
    cfg.include = $('inc').value; cfg.exclude = $('exc').value;
    cfg.interval = Math.max(2, Math.min(120, parseInt($('int').value, 10) || 5)); cfg.click = $('clk').value; save();
  }
  function tab(name) {
    root.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b.dataset.t === name));
    ['groups', 'sched', 'settings', 'log', 'hist'].forEach((t) => $('p-' + t).classList.toggle('on', t === name));
    $('p-log').scrollTop = 1e9;
  }

  root.querySelectorAll('.tab').forEach((b) => { b.onclick = () => tab(b.dataset.t); });
  $('fab').onclick = () => { sheet.classList.add('open'); applyFs(); };
  $('close').onclick = () => { sheet.classList.remove('open'); applyFs(); };
  $('sch_on').onclick = () => { cfg.sched.on = !cfg.sched.on; save(); renderSched(); };
  $('ntf').onclick = () => { cfg.notify = cfg.notify === false; save(); renderSched(); };
  $('addc').onclick = () => {
    if (!cfg.chats.length) { log('اول گروه‌ها را اسکن کن یا دستی اضافه کن.'); tab('groups'); return; }
    cfg.sched.week[editDay].push({ chat: cfg.chats[0], from: '08:00', to: '09:30' });
    if (!cfg.sched.on) cfg.sched.on = true;
    save(); renderSched();
  };
  $('off').onclick = () => {
    cfg.sched.offDay = offToday() ? '' : todayStr(); save();
    log(offToday() ? 'امروز تعطیل شد؛ ربات تا فردا کاری نمی‌کند' : 'تعطیلی امروز لغو شد');
    renderSched();
  };
  $('hclr').onclick = () => { cfg.hist = []; save(); renderHist(); };
  $('fm').onclick = () => { cfg.fs = Math.max(10, cfg.fs - 2); applyFs(); save(); };
  $('fp').onclick = () => { cfg.fs = Math.min(40, cfg.fs + 2); applyFs(); save(); };
  $('q').oninput = renderList;
  $('all').onclick = () => {
    const q = norm($('q').value);
    cfg.chats.forEach((n) => { if ((!q || norm(n).includes(q)) && !cfg.selected.includes(n)) cfg.selected.push(n); });
    save(); renderList();
  };
  $('none').onclick = () => {
    const q = norm($('q').value);
    cfg.selected = cfg.selected.filter((n) => !(!q || norm(n).includes(q)));
    save(); renderList();
  };
  function addChat() {
    const v = $('add').value.trim(); if (!v) return;
    if (!cfg.chats.includes(v)) cfg.chats.push(v);
    if (!cfg.selected.includes(v)) cfg.selected.push(v);
    $('add').value = ''; save(); renderList();
  }
  $('addb').onclick = addChat;
  $('add').onkeydown = (e) => { if (e.key === 'Enter') addChat(); };
  ['inc', 'exc', 'int', 'clk'].forEach((i) => { $(i).onchange = readSettings; });

  $('scan').onclick = async () => {
    const b = $('scan'); b.disabled = true; b.textContent = '⏳ در حال اسکن...';
    try {
      log('در حال خواندن لیست گروه‌ها ...');
      const names = await scan();
      names.forEach((n) => { if (!cfg.chats.includes(n)) cfg.chats.push(n); });
      save(); renderList();
      log(names.length + ' چت پیدا شد.');
      if (!names.length) { log('اطلاعات فنی: ' + diag()); tab('log'); }
    } catch (e) { log('اسکن ناموفق: ' + e.message); }
    b.disabled = false; b.textContent = '⟳ اسکن گروه‌ها';
  };

  $('start').onclick = () => {
    if (running) { loopToken++; setRunning(false); log('متوقف شد'); return; }
    readSettings();
    if (cfg.sched.on && !cfg.sched.week.some((d) => d.length)) { log('برای برنامه هفتگی حداقل یک کلاس اضافه کن.'); tab('sched'); return; }
    if (!cfg.sched.on && !cfg.selected.some((n) => cfg.chats.includes(n))) { log('حداقل یک گروه را انتخاب کن.'); tab('groups'); return; }
    if (!words(cfg.include).length) { log('کلمه‌ای برای زدن وارد نشده.'); tab('settings'); return; }
    try { if (!window.HazerNative && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch (e) {}
    setRunning(true);
    log(cfg.sched.on ? 'شروع شد (برنامه هفتگی)' : 'شروع شد (' + cfg.selected.filter((n) => cfg.chats.includes(n)).length + ' گروه/کانال)');
    runLoop(++loopToken);
  };

  // مقدار اولیه
  $('site').textContent = location.hostname.includes('shad') ? 'شاد' : 'روبیکا';
  $('inc').value = cfg.include; $('exc').value = cfg.exclude; $('int').value = cfg.interval; $('clk').value = cfg.click;
  applyFs(); renderList(); renderSched(); renderHist();
  setInterval(updSched, 30000);
  // ادامه خودکار بعد از بارگذاری مجدد یا باز شدن دوباره برنامه
  if (cfg.wasRunning && hasPlan() && words(cfg.include).length) {
    log('ادامه خودکار ربات...');
    setTimeout(() => { if (!running) { setRunning(true); runLoop(++loopToken); } }, 4000);
  } else if (cfg.wasRunning) { cfg.wasRunning = false; save(); }
  window.__hazer = { decide, norm, words, readPolls, scan, openChat, inSchedule, activeChats, cfg };
})();
