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
    theme: 'dark',
    sound: true,
    onb: false,
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
    celebrate(chat);
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

  // ---------------------------------------------------------------- اجزای مشترک رابط
/* ===== بخش مشترک رابط (ماسکوت، درس‌ها، حلقه، صدا) ===== */
const SUBJ = [
  [/ریاض|حسابان|هندس|آمار|جبر|گسسته|احتمال/, '📐', '#4aa8f0'],
  [/فیزیک/, '⚡', '#f2a516'],
  [/شیمی/, '⚗️', '#2fc795'],
  [/زیست|علوم|بیولوژ/, '🧬', '#88c43c'],
  [/ادب|فارسی|نگارش|املا|انشا/, '📖', '#f0629a'],
  [/عرب/, '📜', '#e08a45'],
  [/انگلیس|زبان|english/i, '🌍', '#9b7df2'],
  [/دین|قرآن|معارف|اسلام/, '📿', '#2fc795'],
  [/تاریخ|جغراف|اجتماع|مطالعات/, '🗺️', '#e08a45'],
  [/ورزش|تربیت/, '⚽', '#88c43c'],
  [/هنر|نقاش|طراحی/, '🎨', '#f0629a'],
  [/کامپیوتر|رایانه|فناوری|برنامه‌?نویس/, '💻', '#4aa8f0'],
  [/فلسفه|منطق|روان/, '🧠', '#9b7df2'],
];
const PAL = ['#ff7a59', '#f2a516', '#2fc795', '#4aa8f0', '#9b7df2', '#f0629a', '#88c43c', '#e08a45'];
function subj(name) {
  const n = String(name || '');
  for (const s of SUBJ) if (s[0].test(n)) return { icon: s[1], color: s[2] };
  let h = 0; for (const c of n) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return { icon: '📚', color: PAL[h % PAL.length] };
}
const MASCOT = '<svg viewBox="0 0 108 108" xmlns="http://www.w3.org/2000/svg">' +
  '<defs><linearGradient id="mg" x1="0" y1="36" x2="0" y2="84" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ffe9a0"/><stop offset=".5" stop-color="#ffc93c"/><stop offset="1" stop-color="#e0a000"/></linearGradient></defs>' +
  '<g class="mz"><text class="z z1" x="78" y="30" fill="#9cbab4" font-size="13" font-weight="900">z</text><text class="z z2" x="88" y="19" fill="#9cbab4" font-size="10" font-weight="900">z</text></g>' +
  '<g class="spark"><text x="14" y="30" font-size="12">✨</text><text x="82" y="26" font-size="10">✨</text></g>' +
  '<g class="head">' +
  '<rect x="52" y="25" width="4" height="13" rx="2" fill="#d99600"/>' +
  '<circle class="ant" cx="54" cy="23" r="5" fill="#4ee3a0"/><circle class="halo" cx="54" cy="23" r="8.5" fill="#4ee3a0" opacity=".25"/>' +
  '<rect x="21" y="52" width="8" height="17" rx="4" fill="#b87a00"/><rect x="79" y="52" width="8" height="17" rx="4" fill="#b87a00"/>' +
  '<rect x="27" y="40" width="54" height="48" rx="14" fill="#8a5d00"/><rect x="27" y="36" width="54" height="48" rx="14" fill="url(#mg)"/>' +
  '<rect x="33" y="38.5" width="42" height="5" rx="2.5" fill="#fff" opacity=".35"/>' +
  '<rect x="33" y="43" width="42" height="29" rx="9" fill="#0b2a2e"/>' +
  '<g class="e e-open"><g class="scan"><circle cx="46" cy="55" r="5" fill="#4ee3a0"/><circle cx="62" cy="55" r="5" fill="#4ee3a0"/><circle cx="44.4" cy="53.4" r="1.6" fill="#eafff4"/><circle cx="60.4" cy="53.4" r="1.6" fill="#eafff4"/></g></g>' +
  '<g class="e e-line"><path d="M41 56 H51 M57 56 H67" stroke="#4ee3a0" stroke-width="2.8" stroke-linecap="round"/></g>' +
  '<g class="e e-half"><path d="M41 56 A5 5 0 0 1 51 56 Z M57 56 A5 5 0 0 1 67 56 Z" fill="#4ee3a0"/></g>' +
  '<g class="e e-happy"><path d="M41 58 Q46 50 51 58 M57 58 Q62 50 67 58" fill="none" stroke="#4ee3a0" stroke-width="2.8" stroke-linecap="round"/></g>' +
  '<path class="mouth m-smile" d="M47 64 Q54 69.5 61 64" fill="none" stroke="#4ee3a0" stroke-width="2.6" stroke-linecap="round"/>' +
  '<path class="mouth m-open" d="M46 63 Q54 74 62 63 Z" fill="#4ee3a0"/>' +
  '<path class="mouth m-flat" d="M49 65 H59" fill="none" stroke="#4ee3a0" stroke-width="2.4" stroke-linecap="round"/>' +
  '</g></svg>';
const MASCOT_CSS = `
.mas{width:5.4em;height:5.4em;flex:none;filter:drop-shadow(0 .35em .4em #0007)}
.mas svg{width:100%;height:100%;overflow:visible}
.mas .e-line,.mas .e-half,.mas .e-happy,.mas .m-open,.mas .m-flat,.mas .mz,.mas .spark{display:none}
.mas .head{animation:bob 3.2s ease-in-out infinite;transform-origin:54px 84px}
.mas .scan{animation:scan 3.4s ease-in-out infinite}
.mas .ant{animation:blink 1.6s infinite}
@keyframes bob{50%{transform:translateY(-1.5px)}}
@keyframes scan{0%,100%{transform:translateX(-2px)}50%{transform:translateX(2px)}}
@keyframes blink{50%{opacity:.35}}
.mas.sleep .e-open,.mas.sleep .m-smile{display:none}.mas.sleep .e-line,.mas.sleep .m-flat,.mas.sleep .mz{display:inline}
.mas.sleep .ant{fill:#6f8e88;animation:none}.mas.sleep .halo{display:none}.mas.sleep .head{animation:none}
.mas.sleep .z{animation:zz 2.4s infinite}.mas.sleep .z2{animation-delay:1.1s}
@keyframes zz{0%{opacity:0;transform:translate(0,6px)}40%{opacity:1}100%{opacity:0;transform:translate(4px,-6px)}}
.mas.wait .e-open{display:none}.mas.wait .e-half{display:inline}.mas.wait .m-smile{display:none}.mas.wait .m-flat{display:inline}
.mas.wait .ant{fill:#f2a516;animation:blink 1.2s infinite}.mas.wait .halo{fill:#f2a516}
.mas.happy .e-open,.mas.happy .m-smile{display:none}.mas.happy .e-happy,.mas.happy .m-open,.mas.happy .spark{display:inline}
.mas.happy .head{animation:hop .5s ease-in-out infinite}
@keyframes hop{50%{transform:translateY(-4px) rotate(-3deg)}}
.ring{width:4.6em;height:4.6em;position:relative;flex:none}
.ring svg{width:100%;height:100%;transform:rotate(-90deg)}
.ring .tr{fill:none;stroke:#00000055;stroke-width:6}
.ring .pg{fill:none;stroke-width:6;stroke-linecap:round;transition:stroke-dashoffset .8s,stroke .3s}
.ring .tx{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1.1}
.ring .tx b{font-size:1.25em;font-weight:900}.ring .tx small{font-size:.62em;opacity:.7}
.burst{position:fixed;inset:0;display:none;align-items:center;justify-content:center;pointer-events:none;z-index:5}
.burst.go{display:flex}
.burst .hand{width:7.5em;height:7.5em;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:3.6em;
 background:radial-gradient(circle at 32% 26%,#fff6c4,#ffd75e 30%,#ffc93c 58%,#d99600);
 box-shadow:inset -.2em -.3em .6em #a0640066,inset .15em .2em .35em #ffffffb0,0 0 0 0 #ffc93c99,0 1em 2em #000a;animation:pop 1.5s cubic-bezier(.2,1.4,.4,1) forwards}
.burst .hand::after{content:'';position:absolute;width:7.5em;height:7.5em;border-radius:50%;border:.25em solid #ffc93c;animation:rip 1.5s ease-out forwards}
.burst .txt{position:absolute;margin-top:11em;font-weight:900;font-size:1.3em;color:#fff;text-shadow:0 .1em .4em #000c;animation:fade 1.5s forwards}
.burst i{position:absolute;width:.7em;height:.7em;border-radius:50%;background:var(--y);animation:fly 1.3s ease-out forwards}
@keyframes pop{0%{transform:scale(.2) rotate(-25deg);opacity:0}30%{transform:scale(1.15) rotate(8deg);opacity:1}55%{transform:scale(1) rotate(-4deg)}85%{opacity:1}100%{transform:scale(.9);opacity:0}}
@keyframes rip{0%{transform:scale(1);opacity:.9}100%{transform:scale(2.3);opacity:0}}
@keyframes fade{0%,20%{opacity:0;transform:translateY(.5em)}40%,80%{opacity:1;transform:none}100%{opacity:0}}
@keyframes fly{0%{transform:translate(0,0) scale(1);opacity:1}100%{transform:translate(var(--dx),var(--dy)) scale(.2);opacity:0}}
`;
function setMascot(el, st) { el.className = 'mas ' + st; }
function ringSet(el, p, color, big, small) {
  const C = 2 * Math.PI * 26;
  const pg = el.querySelector('.pg');
  pg.style.strokeDasharray = C; pg.style.strokeDashoffset = C * (1 - Math.max(0, Math.min(1, p))); pg.style.stroke = color;
  el.querySelector('b').textContent = big; el.querySelector('small').textContent = small;
}
const RING_HTML = '<svg viewBox="0 0 64 64"><circle class="tr" cx="32" cy="32" r="26"/><circle class="pg" cx="32" cy="32" r="26"/></svg><div class="tx"><b>—</b><small></small></div>';
let _ac = null;
function chime() {
  try {
    _ac = _ac || new (window.AudioContext || window.webkitAudioContext)();
    const t = _ac.currentTime;
    [[659.25, 0], [880, 0.13]].forEach(([f, d]) => {
      const o = _ac.createOscillator(), g = _ac.createGain();
      o.type = 'sine'; o.frequency.value = f; o.connect(g); g.connect(_ac.destination);
      g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.18, t + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.28);
      o.start(t + d); o.stop(t + d + 0.3);
    });
  } catch (e) {}
}
function burstGo(el, text) {
  el.innerHTML = '<div class="hand">✋</div><div class="txt"></div>';
  el.querySelector('.txt').textContent = text || 'حاضر!';
  for (let i = 0; i < 14; i++) {
    const s = document.createElement('i'), a = (i / 14) * 6.283, r = 90 + Math.random() * 70;
    s.style.setProperty('--dx', Math.cos(a) * r + 'px'); s.style.setProperty('--dy', Math.sin(a) * r + 'px');
    s.style.background = ['#ffc93c', '#4ee3a0', '#fff6c4', '#ff7a59'][i % 4]; s.style.animationDelay = (Math.random() * .15) + 's';
    el.append(s);
  }
  el.classList.remove('go'); void el.offsetWidth; el.classList.add('go');
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('go'), 1600);
}
/* وضعیت برنامه: {kind: off|manual|now|next|done|empty|idle, chat, from, to, mins, frac} */
function planInfo(sched, d, off, selectedCount) {
  const pm = (t) => { const x = String(t || '0:0').split(':').map(Number); return (x[0] || 0) * 60 + (x[1] || 0); };
  if (off) return { kind: 'off' };
  if (!sched.on) return { kind: 'manual', n: selectedCount };
  const m = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60, day = (d.getDay() + 1) % 7;
  const arr = sched.week[day] || [];
  const cur = arr.filter((c) => m >= pm(c.from) && m < pm(c.to)).sort((a, b) => pm(a.from) - pm(b.from))[0];
  if (cur) { const len = Math.max(1, pm(cur.to) - pm(cur.from)); return { kind: 'now', chat: cur.chat, from: cur.from, to: cur.to, mins: Math.ceil(pm(cur.to) - m), frac: (m - pm(cur.from)) / len }; }
  const nx = arr.filter((c) => pm(c.from) > m).sort((a, b) => pm(a.from) - pm(b.from))[0];
  if (nx) return { kind: 'next', chat: nx.chat, from: nx.from, to: nx.to, mins: Math.ceil(pm(nx.from) - m), frac: 1 - Math.min(pm(nx.from) - m, 60) / 60 };
  return { kind: arr.length ? 'done' : 'empty' };
}
function minText(m, fa) {
  if (m >= 60) return fa(Math.floor(m / 60)) + ' ساعت' + (m % 60 ? ' و ' + fa(m % 60) + ' دقیقه' : '');
  return fa(m) + ' دقیقه';
}
function timelineDraw(box, arr, now, fa, SUBJf) {
  // محور ۶ تا ۲۲
  const A = 6 * 60, B = 22 * 60, pm = (t) => { const x = String(t || '0:0').split(':').map(Number); return (x[0] || 0) * 60 + (x[1] || 0); };
  box.innerHTML = '';
  const bar = document.createElement('div'); bar.className = 'tlbar';
  for (let h = 6; h <= 22; h += 2) { const t = document.createElement('i'); t.className = 'tick'; t.style.right = ((h * 60 - A) / (B - A) * 100) + '%'; t.innerHTML = '<span>' + fa(h) + '</span>'; bar.append(t); }
  arr.forEach((c) => {
    const f = Math.max(A, pm(c.from)), t = Math.min(B, pm(c.to)); if (t <= f) return;
    const s = SUBJf(c.chat), b = document.createElement('div'); b.className = 'blk';
    b.style.right = ((f - A) / (B - A) * 100) + '%'; b.style.width = ((t - f) / (B - A) * 100) + '%';
    b.style.background = 'linear-gradient(180deg,' + s.color + ',' + s.color + 'bb)'; b.textContent = s.icon; b.title = c.chat;
    bar.append(b);
  });
  if (now != null && now >= A && now <= B) { const l = document.createElement('div'); l.className = 'nowl'; l.style.right = ((now - A) / (B - A) * 100) + '%'; bar.append(l); }
  box.append(bar);
}
const TL_CSS = `
.tlbar{position:relative;height:3.4em;border-radius:.9em;background:var(--well);box-shadow:inset 0 .2em .5em var(--inset);margin:.4em 0 1.6em}
.tlbar .tick{position:absolute;top:0;bottom:0;width:1px;background:var(--line)}
.tlbar .tick span{position:absolute;top:100%;margin-top:.3em;transform:translateX(50%);font-size:.7em;color:var(--mut)}
.tlbar .blk{position:absolute;top:.35em;bottom:.35em;border-radius:.6em;display:flex;align-items:center;justify-content:center;font-size:1.05em;box-shadow:inset 0 .1em 0 #ffffff55,0 .15em 0 #0006;overflow:hidden;min-width:1.4em}
.tlbar .nowl{position:absolute;top:-.3em;bottom:-.3em;width:.2em;border-radius:1em;background:var(--r);box-shadow:0 0 .6em var(--r)}
.tlbar .nowl::before{content:'';position:absolute;top:-.25em;left:-.25em;width:.7em;height:.7em;border-radius:50%;background:var(--r)}
`;

  // ---------------------------------------------------------------- رابط
  const host = document.createElement('div');
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;';
  document.documentElement.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
<style>
:host{all:initial}
:host{
 --y:#ffc93c;--y2:#d99600;--y3:#8a5d00;--yd:#3a2a00;
 --g:#4ee3a0;--g2:#1c9c68;--r:#ff705f;--r2:#bd3a28;--rd:#2a0b07;
}
*{box-sizing:border-box;font-family:"Vazirmatn","Vazir","Segoe UI",Tahoma,sans-serif;-webkit-tap-highlight-color:transparent}
.sheet{--b0:#0a2124;--b1:#0f2e32;--b2:#164046;--b3:#1f565c;--txt:#f4efe2;--mut:#9cbab4;--line:#ffffff1c;
 --well:#0000003d;--inset:#000c;--edge:#06171a;--card:#ffffff14;--card2:#ffffff09;--glow:#2f7a80aa;--hi:#ffffff2a;--btn1:#2b6a70;--field:#00000040}
.sheet.light{--b0:#dcebe9;--b1:#f2f8f7;--b2:#d4e6e4;--b3:#c4ddda;--txt:#12353a;--mut:#4f7a78;--line:#0b3a3f22;
 --well:#0b3a3f12;--inset:#0b3a3f40;--edge:#a8c8c5;--card:#ffffffcc;--card2:#ffffff99;--glow:#8fd0cf99;--hi:#ffffffcc;--btn1:#e1f0ee;--field:#ffffffd0}

.fab{position:fixed;left:.9em;bottom:.9em;width:3.9em;height:3.9em;border-radius:50%;border:0;cursor:pointer;font-size:1em;
 display:flex;align-items:center;justify-content:center;
 background:radial-gradient(circle at 32% 26%,#fff6c4 0,#ffd75e 26%,var(--y) 55%,var(--y2) 100%);
 box-shadow:inset -.2em -.35em .6em #a0640066,inset .15em .2em .35em #ffffffb0,0 .3em 0 var(--y3),0 .8em 1em #000a}
.fab span{font-size:1.5em;filter:drop-shadow(0 .06em .05em #0006)}
.fab:active{transform:translateY(.2em);box-shadow:inset -.2em -.35em .6em #a0640066,inset .15em .2em .35em #ffffffb0,0 .1em 0 var(--y3),0 .3em .6em #000a}
.fab.on{background:radial-gradient(circle at 32% 26%,#d8ffec 0,#7af2bb 28%,var(--g) 58%,var(--g2) 100%);
 box-shadow:inset -.2em -.35em .6em #0a5a3a66,inset .15em .2em .35em #ffffffb0,0 .3em 0 #136b46,0 .8em 1em #000a;animation:pulse 2.2s infinite}
@keyframes pulse{0%,100%{filter:none}50%{filter:drop-shadow(0 0 .7em #4ee3a0aa)}}

.sheet{position:fixed;display:none;flex-direction:column;direction:rtl;color:var(--txt);overflow:hidden;
 background:radial-gradient(90% 45% at 90% -8%,var(--glow),transparent 62%),linear-gradient(180deg,var(--b1),var(--b0))}
.sheet.open{display:flex}
.sheet.phone{inset:0;border-radius:0}
.sheet.desk{top:.8em;bottom:.8em;left:.8em;width:30em;border-radius:1.5em;border:1px solid var(--line);box-shadow:0 2em 5em #000c}

.hd{display:flex;align-items:center;gap:.6em;padding:1em 1.1em .7em}
.logo{width:3em;height:3em;flex:none;filter:drop-shadow(0 .3em .4em #0007)}
.logo img{width:100%;height:100%;display:block}
.ttl{flex:1;line-height:1.35;min-width:0}
.ttl b{display:block;font-size:1.2em;font-weight:900}
.ttl small{color:var(--mut);font-size:.78em}
.pill{display:flex;align-items:center;gap:.5em;padding:.4em .85em;border-radius:2em;background:var(--well);
 box-shadow:inset 0 .12em .3em var(--inset);font-size:.78em;color:var(--mut);white-space:nowrap}
.dot{width:.8em;height:.8em;border-radius:50%;background:radial-gradient(circle at 35% 30%,#7f9a95,#33504c);box-shadow:inset 0 -.1em .15em #0008}
.pill.on{color:var(--g2)}
.pill.on .dot{background:radial-gradient(circle at 35% 30%,#eafff4,var(--g) 55%,var(--g2));box-shadow:0 0 .7em #4ee3a0cc,inset 0 -.1em .15em #0a5a3a88}
.x{width:2.5em;height:2.5em;flex:none;border-radius:.85em;border:0;color:var(--txt);font:inherit;cursor:pointer;
 background:linear-gradient(180deg,var(--b3),var(--b2));box-shadow:inset 0 .1em 0 var(--hi),0 .2em 0 var(--edge),0 .4em .6em #0004}
.x:active{transform:translateY(.17em);box-shadow:inset 0 .1em 0 var(--hi),0 .03em 0 var(--edge)}

.tabs{display:flex;gap:.25em;margin:.3em 1.1em .5em;padding:.3em;background:var(--well);border-radius:1.1em;box-shadow:inset 0 .18em .45em var(--inset)}
.tab{flex:1;border:0;background:transparent;color:var(--mut);font:inherit;font-weight:800;font-size:.8em;padding:.75em .1em;white-space:nowrap;border-radius:.8em;cursor:pointer}
.tab.on{background:linear-gradient(180deg,#ffdc72,var(--y));color:var(--yd);transform:translateY(-.08em);box-shadow:inset 0 .1em 0 #fffa,0 .2em 0 var(--y2),0 .4em .6em #0005}

.body{flex:1;overflow-y:auto;padding:.5em 1.1em 1.2em;-webkit-overflow-scrolling:touch}
.page{display:none}.page.on{display:block}
.card{background:linear-gradient(180deg,var(--card),var(--card2));border:1px solid var(--line);border-radius:1.1em;padding:.95em;
 box-shadow:inset 0 .1em 0 var(--hi),0 .3em 0 var(--edge),0 .7em 1.1em #0003;margin-bottom:.9em}
.hero{display:flex;align-items:center;gap:.8em;padding:.8em .9em;background:linear-gradient(135deg,var(--card),var(--card2) 60%,#ffc93c14)}
.hero .ht{flex:1;min-width:0;line-height:1.7}
.hero .ht b{display:block;font-size:1.02em;font-weight:900}
.hero .ht span{color:var(--mut);font-size:.82em}

.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:.6em;margin-bottom:1em;perspective:42em}
.stat{background:linear-gradient(180deg,var(--card),var(--card2));border:1px solid var(--line);border-radius:1em;padding:.75em .3em .6em;text-align:center;
 transform:rotateX(9deg);transform-origin:50% 100%;box-shadow:inset 0 .1em 0 var(--hi),0 .35em 0 var(--edge),0 .8em 1em #0003}
.stat b{display:block;font-size:1.75em;font-weight:900;color:var(--y);line-height:1.3;
 text-shadow:0 .035em 0 var(--y2),0 .07em 0 #a87000,0 .105em 0 var(--y3),0 .2em .2em #0006}
.stat span{font-size:.74em;color:var(--mut)}
.row2{display:flex;gap:.55em;margin-bottom:.9em}

.btn{white-space:nowrap;border:0;cursor:pointer;font:inherit;font-weight:800;font-size:.95em;border-radius:.95em;padding:.8em 1em;
 color:var(--yd);background:linear-gradient(180deg,#ffdc72,var(--y));
 box-shadow:inset 0 .1em 0 #fffa,0 .25em 0 var(--y2),0 .5em .7em #0004;transition:transform .08s,box-shadow .08s}
.btn:active{transform:translateY(.22em);box-shadow:inset 0 .1em 0 #fffa,0 .03em 0 var(--y2),0 .1em .2em #0004}
.btn:disabled{opacity:.55}
.btn.g{color:var(--txt);font-weight:700;background:linear-gradient(180deg,var(--btn1),var(--b3));
 box-shadow:inset 0 .1em 0 var(--hi),0 .25em 0 var(--edge),0 .5em .7em #0003}
.btn.g:active{box-shadow:inset 0 .1em 0 var(--hi),0 .03em 0 var(--edge),0 .1em .2em #0003}
.btn.sm{padding:.65em .9em;font-size:.88em}

input[type=text],input[type=number],input[type=time],select{width:100%;background:var(--field);color:var(--txt);border:1px solid var(--line);
 border-radius:.9em;padding:.8em .9em;font:inherit;font-size:.95em;text-align:right;outline:none;min-width:0;box-shadow:inset 0 .15em .4em var(--inset)}
input::placeholder{color:var(--mut);opacity:.7}
input:focus,select:focus{border-color:var(--y);box-shadow:inset 0 .15em .4em var(--inset),0 0 0 .18em #ffc93c33}
select option{color:#111}
input[type=time]{direction:ltr;text-align:center}

.list{border-radius:1.1em;background:var(--well);box-shadow:inset 0 .2em .55em var(--inset);overflow:hidden}
.item{display:flex;align-items:center;gap:.8em;padding:.85em .9em;cursor:pointer;border-bottom:1px solid var(--line)}
.item:last-child{border-bottom:0}
.item.on{background:#4ee3a014;box-shadow:inset -.28em 0 0 var(--g)}
.av{width:2.6em;height:2.6em;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;font-size:1.15em;
 background-image:radial-gradient(circle at 32% 26%,#ffffffb8,#ffffff00 46%),radial-gradient(circle at 72% 90%,#0000007a,#0000 62%);
 box-shadow:inset 0 -.18em .3em #0005,inset 0 .1em .15em #fff6,0 .22em .4em #0006}
.nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.98em;font-weight:600}
.sw{position:relative;width:2.9em;height:1.65em;border-radius:2em;background:var(--inset);flex:none;transition:.18s;box-shadow:inset 0 .2em .35em var(--inset)}
.sw::after{content:"";position:absolute;top:.2em;right:.2em;width:1.25em;height:1.25em;border-radius:50%;transition:.18s;
 background:radial-gradient(circle at 35% 28%,#fff,#ddd7c6 58%,#a9a392);box-shadow:0 .15em .25em #0008,inset 0 -.1em .15em #0003}
.item.on .sw{background:linear-gradient(180deg,var(--g2),var(--g))}
.item.on .sw::after{right:1.45em}
.empty{padding:2.2em 1em;text-align:center;color:var(--mut);line-height:2.1;font-size:.95em}
.empty .big{font-size:2.6em;display:block;margin-bottom:.2em;filter:drop-shadow(0 .1em .1em #0006)}
.lb{color:var(--mut);font-size:.82em;margin:.9em .2em .45em}
.two{display:grid;grid-template-columns:1fr 1fr;gap:.6em}
.step{display:flex;align-items:center;gap:.6em}
.step .btn{width:3em;padding:.6em 0}
.step b{flex:1;text-align:center;font-weight:900;font-size:1.1em}

.log{display:flex;flex-direction:column;gap:.5em}
.ln{background:var(--well);border-radius:.9em;padding:.65em .85em;font-size:.88em;line-height:1.8;border-right:.28em solid var(--line);box-shadow:inset 0 .1em .25em var(--inset)}
.ln.ok{border-right-color:var(--g);background:#4ee3a014}
.ln .t{color:var(--mut);direction:ltr;display:block;font-size:.8em}

.chips{display:flex;gap:.4em}
.chip{position:relative;flex:1;text-align:center;padding:.7em 0;border-radius:.85em;color:var(--mut);font-weight:800;cursor:pointer;font-size:.92em;
 background:linear-gradient(180deg,var(--btn1),var(--b3));box-shadow:inset 0 .1em 0 var(--hi),0 .22em 0 var(--edge),0 .4em .5em #0003}
.chip:active{transform:translateY(.18em);box-shadow:inset 0 .1em 0 var(--hi),0 .03em 0 var(--edge)}
.chip.on{background:linear-gradient(180deg,#ffdc72,var(--y));color:var(--yd);box-shadow:inset 0 .1em 0 #fffa,0 .22em 0 var(--y2),0 .4em .5em #0004}
.chip.has::after{content:'';display:block;width:.42em;height:.42em;border-radius:50%;background:var(--g);margin:.22em auto 0;box-shadow:0 0 .4em #4ee3a0}
.cls{background:linear-gradient(180deg,var(--card),var(--card2));border:1px solid var(--line);border-right:.4em solid var(--c,var(--y));border-radius:1em;padding:.7em;margin-bottom:.7em;
 box-shadow:inset 0 .1em 0 var(--hi),0 .25em 0 var(--edge),0 .5em .8em #0003}
.cls .top{display:flex;gap:.5em;margin-bottom:.5em;align-items:center}
.cls .ic{width:2.4em;height:2.4em;flex:none;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--c);
 box-shadow:inset 0 -.15em .25em #0004,inset 0 .1em .12em #fff6,0 .15em .3em #0005}
.cls .del{flex:none;width:3em;height:2.8em;border:0;border-radius:.8em;color:var(--rd);font:inherit;font-weight:900;cursor:pointer;
 background:linear-gradient(180deg,#ff9a8c,var(--r));box-shadow:inset 0 .1em 0 #fff8,0 .2em 0 var(--r2),0 .35em .5em #0004}
.cls .del:active{transform:translateY(.17em);box-shadow:inset 0 .1em 0 #fff8,0 .03em 0 var(--r2)}
.hint{color:var(--mut);font-size:.82em;line-height:1.9;margin:.8em .2em}

.chart{display:flex;align-items:flex-end;gap:.5em;height:8em;padding-top:1em}
.chart .col{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;gap:.3em}
.chart .bar{width:100%;max-width:2.4em;border-radius:.6em .6em .3em .3em;background:linear-gradient(180deg,var(--btn1),var(--b3));box-shadow:inset 0 .1em 0 var(--hi),0 .15em 0 var(--edge);min-height:.35em;transition:height .6s}
.chart .col.today .bar{background:linear-gradient(180deg,#ffdc72,var(--y));box-shadow:inset 0 .1em 0 #fffa,0 .15em 0 var(--y2)}
.chart .n{font-size:.78em;font-weight:800;color:var(--txt)}.chart .d{font-size:.72em;color:var(--mut)}

.ft{padding:.8em 1.1em calc(1em + env(safe-area-inset-bottom,0px));background:linear-gradient(0deg,var(--b0) 62%,transparent)}
.start{width:100%;border:0;cursor:pointer;font:inherit;font-weight:900;font-size:1.25em;padding:.95em;border-radius:1.15em;color:var(--yd);
 background:linear-gradient(180deg,#ffe38e,var(--y) 58%,#f2b520);
 box-shadow:inset 0 .13em 0 #fffb,inset 0 -.15em .25em #b8800044,0 .4em 0 var(--y2),0 .8em 1.3em #0007;transition:transform .08s,box-shadow .08s;text-shadow:0 .05em 0 #fff6}
.start:active{transform:translateY(.32em);box-shadow:inset 0 .13em 0 #fffb,inset 0 -.15em .25em #b8800044,0 .08em 0 var(--y2),0 .3em .6em #0007}
.start.stop{color:var(--rd);background:linear-gradient(180deg,#ffb0a4,var(--r) 58%,#ea5846);
 box-shadow:inset 0 .13em 0 #fffa,inset 0 -.15em .25em #a0200f44,0 .4em 0 var(--r2),0 .8em 1.3em #0007}
.start.stop:active{box-shadow:inset 0 .13em 0 #fffa,0 .08em 0 var(--r2),0 .3em .6em #0007}

.onb{position:absolute;inset:0;z-index:4;display:none;flex-direction:column;align-items:center;justify-content:center;padding:1.5em;text-align:center;
 background:radial-gradient(90% 45% at 50% 0%,var(--glow),transparent 70%),linear-gradient(180deg,var(--b1),var(--b0))}
.onb.show{display:flex}
.onb .mas{width:9em;height:9em}
.onb h2{margin:.6em 0 .2em;font-size:1.5em;font-weight:900}
.onb p{margin:0 0 1.2em;color:var(--mut);line-height:2;max-width:22em}
.onb .dots{display:flex;gap:.5em;margin-bottom:1.2em}
.onb .dots i{width:.6em;height:.6em;border-radius:50%;background:var(--inset);transition:.2s}
.onb .dots i.on{background:var(--y);width:1.6em;border-radius:1em}
.onb .btns{display:flex;gap:.6em;width:100%;max-width:22em}.onb .btns .btn{flex:1}
.onb .skip{margin-top:.8em;background:none;border:0;color:var(--mut);font:inherit;cursor:pointer}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style>

<button class="fab" id="fab"><span>✋</span></button>
<div class="burst" id="burst"></div>
<div class="sheet" id="sheet">
  <div class="hd">
    <div class="logo"><img alt="" src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDggMTA4IiB3aWR0aD0iNTEyIiBoZWlnaHQ9IjUxMiI+PGRlZnM+PGNsaXBQYXRoIGlkPSJyYyI+PHBhdGggZD0iTTI2LDAgTDgyLDAgUTEwOCwwIDEwOCwyNiBMMTA4LDgyIFExMDgsMTA4IDgyLDEwOCBMMjYsMTA4IFEwLDEwOCAwLDgyIEwwLDI2IFEwLDAgMjYsMCBaIi8+PC9jbGlwUGF0aD48bGluZWFyR3JhZGllbnQgaWQ9ImcwIiBncmFkaWVudFVuaXRzPSJ1c2VyU3BhY2VPblVzZSIgeDE9IjAiIHkxPSIwIiB4Mj0iMTA4IiB5Mj0iMTA4Ij48c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiMxZjZhNzAiLz48c3RvcCBvZmZzZXQ9IjAuNTUiIHN0b3AtY29sb3I9IiMwZjNhNDAiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiMwNzFiMWUiLz48L2xpbmVhckdyYWRpZW50PjxsaW5lYXJHcmFkaWVudCBpZD0iZzExIiBncmFkaWVudFVuaXRzPSJ1c2VyU3BhY2VPblVzZSIgeDE9IjAiIHkxPSIzNiIgeDI9IjAiIHkyPSI4NCI+PHN0b3Agb2Zmc2V0PSIwIiBzdG9wLWNvbG9yPSIjZmZlOWEwIi8+PHN0b3Agb2Zmc2V0PSIwLjUiIHN0b3AtY29sb3I9IiNmZmM5M2MiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiNlMGEwMDAiLz48L2xpbmVhckdyYWRpZW50PjxsaW5lYXJHcmFkaWVudCBpZD0iZzIxIiBncmFkaWVudFVuaXRzPSJ1c2VyU3BhY2VPblVzZSIgeDE9IjAiIHkxPSI2OCIgeDI9IjAiIHkyPSI5MCI+PHN0b3Agb2Zmc2V0PSIwIiBzdG9wLWNvbG9yPSIjOGJmNWM0Ii8+PHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjMWM5YzY4Ii8+PC9saW5lYXJHcmFkaWVudD48L2RlZnM+PGcgY2xpcC1wYXRoPSJ1cmwoI3JjKSI+PHBhdGggZD0iTTAsMCBMMTA4LDAgUTEwOCwwIDEwOCwwIEwxMDgsMTA4IFExMDgsMTA4IDEwOCwxMDggTDAsMTA4IFEwLDEwOCAwLDEwOCBMMCwwIFEwLDAgMCwwIFoiIGZpbGw9InVybCgjZzApIi8+PHBhdGggZD0iTTI4LDE2IEE1Niw1NiAwIDEsMCAxNDAsMTYgQTU2LDU2IDAgMSwwIDI4LDE2IFoiIGZpbGw9IiM0ZmIzYjgiIG9wYWNpdHk9IjAuMDciLz48cGF0aCBkPSJNNDIsMTYgQTQyLDQyIDAgMSwwIDEyNiwxNiBBNDIsNDIgMCAxLDAgNDIsMTYgWiIgZmlsbD0iIzRmYjNiOCIgb3BhY2l0eT0iMC4wNyIvPjxwYXRoIGQ9Ik01NiwxNiBBMjgsMjggMCAxLDAgMTEyLDE2IEEyOCwyOCAwIDEsMCA1NiwxNiBaIiBmaWxsPSIjNGZiM2I4IiBvcGFjaXR5PSIwLjA3Ii8+PC9nPjxwYXRoIGQ9Ik01NCwyNSBMNTQsMjUgUTU2LDI1IDU2LDI3IEw1NiwzNiBRNTYsMzggNTQsMzggTDU0LDM4IFE1MiwzOCA1MiwzNiBMNTIsMjcgUTUyLDI1IDU0LDI1IFoiIGZpbGw9IiNkOTk2MDAiLz48cGF0aCBkPSJNNDUuNSwyMyBBOC41LDguNSAwIDEsMCA2Mi41LDIzIEE4LjUsOC41IDAgMSwwIDQ1LjUsMjMgWiIgZmlsbD0iIzRlZTNhMCIgb3BhY2l0eT0iMC4yNSIvPjxwYXRoIGQ9Ik00OSwyMyBBNSw1IDAgMSwwIDU5LDIzIEE1LDUgMCAxLDAgNDksMjMgWiIgZmlsbD0iIzRlZTNhMCIvPjxwYXRoIGQ9Ik01MC45LDIxLjYgQTEuNywxLjcgMCAxLDAgNTQuMzAwMDAwMDAwMDAwMDA0LDIxLjYgQTEuNywxLjcgMCAxLDAgNTAuOSwyMS42IFoiIGZpbGw9IiNlYWZmZjQiIG9wYWNpdHk9IjAuOSIvPjxwYXRoIGQ9Ik0yNSw1MiBMMjUsNTIgUTI5LDUyIDI5LDU2IEwyOSw2NSBRMjksNjkgMjUsNjkgTDI1LDY5IFEyMSw2OSAyMSw2NSBMMjEsNTYgUTIxLDUyIDI1LDUyIFoiIGZpbGw9IiNiODdhMDAiLz48cGF0aCBkPSJNODMsNTIgTDgzLDUyIFE4Nyw1MiA4Nyw1NiBMODcsNjUgUTg3LDY5IDgzLDY5IEw4Myw2OSBRNzksNjkgNzksNjUgTDc5LDU2IFE3OSw1MiA4Myw1MiBaIiBmaWxsPSIjYjg3YTAwIi8+PHBhdGggZD0iTTQxLDQwIEw2Nyw0MCBRODEsNDAgODEsNTQgTDgxLDc0IFE4MSw4OCA2Nyw4OCBMNDEsODggUTI3LDg4IDI3LDc0IEwyNyw1NCBRMjcsNDAgNDEsNDAgWiIgZmlsbD0iIzhhNWQwMCIvPjxwYXRoIGQ9Ik00MSwzNiBMNjcsMzYgUTgxLDM2IDgxLDUwIEw4MSw3MCBRODEsODQgNjcsODQgTDQxLDg0IFEyNyw4NCAyNyw3MCBMMjcsNTAgUTI3LDM2IDQxLDM2IFoiIGZpbGw9InVybCgjZzExKSIvPjxwYXRoIGQ9Ik0zNS41LDM4LjUgTDcyLjUsMzguNSBRNzUsMzguNSA3NSw0MS4wIEw3NSw0MS4wIFE3NSw0My41IDcyLjUsNDMuNSBMMzUuNSw0My41IFEzMyw0My41IDMzLDQxLjAgTDMzLDQxLjAgUTMzLDM4LjUgMzUuNSwzOC41IFoiIGZpbGw9IiNmZmZmZmYiIG9wYWNpdHk9IjAuMzUiLz48cGF0aCBkPSJNNDIsNDMgTDY2LDQzIFE3NSw0MyA3NSw1MiBMNzUsNjMgUTc1LDcyIDY2LDcyIEw0Miw3MiBRMzMsNzIgMzMsNjMgTDMzLDUyIFEzMyw0MyA0Miw0MyBaIiBmaWxsPSIjMGIyYTJlIi8+PHBhdGggZD0iTTQyLDQzIEw2Niw0MyBRNzUsNDMgNzUsNTIgTDc1LDYzIFE3NSw3MiA2Niw3MiBMNDIsNzIgUTMzLDcyIDMzLDYzIEwzMyw1MiBRMzMsNDMgNDIsNDMgWiIgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMCIgc3Ryb2tlPSIjMGY0YTUwIiBzdHJva2Utd2lkdGg9IjEiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIvPjxwYXRoIGQ9Ik00MSw1NSBBNSw1IDAgMSwwIDUxLDU1IEE1LDUgMCAxLDAgNDEsNTUgWiIgZmlsbD0iIzRlZTNhMCIvPjxwYXRoIGQ9Ik01Nyw1NSBBNSw1IDAgMSwwIDY3LDU1IEE1LDUgMCAxLDAgNTcsNTUgWiIgZmlsbD0iIzRlZTNhMCIvPjxwYXRoIGQ9Ik00Mi44LDUzLjQgQTEuNiwxLjYgMCAxLDAgNDYuMCw1My40IEExLjYsMS42IDAgMSwwIDQyLjgsNTMuNCBaIiBmaWxsPSIjZWFmZmY0IiBvcGFjaXR5PSIwLjk1Ii8+PHBhdGggZD0iTTU4LjgsNTMuNCBBMS42LDEuNiAwIDEsMCA2Mi4wLDUzLjQgQTEuNiwxLjYgMCAxLDAgNTguOCw1My40IFoiIGZpbGw9IiNlYWZmZjQiIG9wYWNpdHk9IjAuOTUiLz48cGF0aCBkPSJNNDcsNjQgUTU0LDY5LjUgNjEsNjQiIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzRlZTNhMCIgc3Ryb2tlLXdpZHRoPSIyLjYiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIvPjxwYXRoIGQ9Ik02NCw3OSBBMTQsMTQgMCAxLDAgOTIsNzkgQTE0LDE0IDAgMSwwIDY0LDc5IFoiIGZpbGw9IiMwYjJhMmUiLz48cGF0aCBkPSJNNjYuNSw3OSBBMTEuNSwxMS41IDAgMSwwIDg5LjUsNzkgQTExLjUsMTEuNSAwIDEsMCA2Ni41LDc5IFoiIGZpbGw9InVybCgjZzIxKSIvPjxwYXRoIGQ9Ik03Mi40LDc5LjQgTDc2LjYsODMuNiBMODQsNzQuOCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjZmZmZmZmIiBzdHJva2Utd2lkdGg9IjMuNCIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8+PC9zdmc+"></div>
    <div class="ttl"><b>ربات حاضر</b><small id="site"></small></div>
    <div class="pill" id="pill"><i class="dot"></i><span id="pt">متوقف</span></div>
    <button class="x" id="thm">🌙</button>
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
      <div class="card hero"><div class="mas sleep" id="mas"></div><div class="ht"><b id="hT"></b><span id="hS"></span></div><div class="ring" id="ring"></div></div>
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
      <div class="card" style="margin-top:.9em"><div class="lb" style="margin:0">نمای روز</div><div id="tl"></div></div>
      <div id="classes"></div>
      <div class="row2">
        <button class="btn sm" id="addc">+ افزودن کلاس</button>
        <button class="btn g sm" id="off">😴 امروز تعطیل</button>
      </div>
      <div class="card" style="margin-top:.4em"><span id="sstate"></span></div>
      <div class="hint">وقتی برنامه روشن است، ربات فقط در ساعت هر کلاس سراغ همان گروه می‌رود و بیرون از آن منتظر می‌ماند. اگر برنامه خاموش باشد، گروه‌های تیک‌خورده در تب «گروه‌ها» همیشه زیر نظرند.</div>
    </div>

    <div class="page" id="p-settings">
      <div class="list" style="margin-bottom:.8em">
        <div class="item" id="ntf"><span class="nm">اعلان و لرزش بعد از زدن «حاضر»</span><i class="sw"></i></div>
        <div class="item" id="snd"><span class="nm">صدای کوتاه بعد از زدن «حاضر»</span><i class="sw"></i></div>
      </div>
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
      <div class="row2"><button class="btn g sm" id="onbAgain">نمایش دوباره‌ی راهنما</button></div>
    </div>

    <div class="page" id="p-log"><div class="log" id="log"></div></div>

    <div class="page" id="p-hist">
      <div class="stats">
        <div class="stat"><b id="h1">0</b><span>امروز</span></div>
        <div class="stat"><b id="h2">0</b><span>۷ روز اخیر</span></div>
        <div class="stat"><b id="h3">0</b><span>کل</span></div>
      </div>
      <div class="card"><div class="lb" style="margin:0">«حاضر»های ۷ روز اخیر</div><div class="chart" id="chart"></div></div>
      <div class="log" id="hlist"></div>
      <div class="row2" style="margin-top:.8em"><button class="btn g sm" id="hclr">پاک کردن تاریخچه</button></div>
    </div>
  </div>
  <div class="ft"><button class="start" id="start">▶ شروع</button></div>
  <div class="onb" id="onb"></div>
</div>`;
  const $ = (id) => root.getElementById(id);
  const sheet = $('sheet');
  const faS = (t) => String(t).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
  { const xs = document.createElement('style'); xs.textContent = MASCOT_CSS + TL_CSS; root.append(xs); }
  $('mas').innerHTML = MASCOT; $('ring').innerHTML = RING_HTML;
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
    sheet.className = 'sheet ' + (phone ? 'phone' : 'desk') + (cfg.theme === 'light' ? ' light' : '') + (sheet.classList.contains('open') ? ' open' : '');
    $('thm').textContent = cfg.theme === 'light' ? '🌙' : '☀️';
    $('burst').style.fontSize = (cfg.fs * k) + 'px';
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
      const sj = subj(n), av = document.createElement('div'); av.className = 'av'; av.style.backgroundColor = sj.color;
      av.textContent = sj.icon;
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
  let happyUntil = 0, happyT = 0;
  function celebrate(chat) {
    burstGo($('burst'), 'حاضر شد: ' + chat);
    if (cfg.sound !== false) chime();
    if (cfg.notify !== false) nat('vibrate');
    happyUntil = Date.now() + 5000; clearTimeout(happyT); happyT = setTimeout(paintHero, 5100);
    paintHero();
  }
  function paintHero() {
    const selN = cfg.selected.filter((n) => cfg.chats.includes(n)).length;
    const info = planInfo(cfg.sched, new Date(), offToday(), selN);
    let st = 'sleep', T = '', S = '';
    if (!running) { T = 'ربات متوقف است'; S = hasPlan() ? 'دکمه «شروع» را بزن' : 'اول گروه‌ها را اسکن و انتخاب کن'; }
    else if (info.kind === 'off') { T = 'امروز تعطیل 😴'; S = 'ربات تا فردا منتظر می‌ماند'; }
    else if (info.kind === 'manual') { st = 'watch'; T = 'در حال نظارت'; S = fa(info.n) + ' گروه زیر نظر است'; }
    else if (info.kind === 'now') { st = 'watch'; T = 'کلاس «' + info.chat + '»'; S = 'در حال نظارت • تا ساعت ' + faS(info.to); }
    else if (info.kind === 'next') { st = 'wait'; T = 'منتظر کلاس بعدی'; S = '«' + info.chat + '» ساعت ' + faS(info.from); }
    else { st = 'wait'; T = 'امروز کلاسی نمانده'; S = 'ربات منتظر می‌ماند'; }
    if (Date.now() < happyUntil) { st = 'happy'; T = 'حاضر شد! 🎉'; }
    setMascot($('mas'), st);
    $('hT').textContent = T; $('hS').textContent = S;
    const rg = $('ring');
    if (info.kind === 'now') ringSet(rg, info.frac, '#4ee3a0', fa(info.mins), 'مانده');
    else if (info.kind === 'next') ringSet(rg, info.frac, '#ffc93c', fa(info.mins >= 60 ? Math.floor(info.mins / 60) : info.mins), info.mins >= 60 ? 'ساعت' : 'دقیقه');
    else ringSet(rg, 0, '#9cbab4', '—', '');
  }
  function paintPill() {
    paintHero();
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
    const days = []; for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); days.push(d); }
    const counts = days.map((d) => h.filter((x) => sameDay(new Date(x.t), d)).length), mx = Math.max(1, ...counts);
    const ch = $('chart'); ch.innerHTML = '';
    days.forEach((d, i) => {
      const c = document.createElement('div'); c.className = 'col' + (i === 6 ? ' today' : '');
      c.innerHTML = '<span class="n"></span><div class="bar"></div><span class="d"></span>';
      c.querySelector('.n').textContent = counts[i] ? fa(counts[i]) : '';
      c.querySelector('.bar').style.height = (counts[i] / mx * 70) + '%';
      c.querySelector('.d').textContent = DAYN[(d.getDay() + 1) % 7]; ch.append(c);
    });
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
      const sj = subj(c.chat); row.style.setProperty('--c', sj.color);
      row.innerHTML = '<div class="top"><span class="ic">' + sj.icon + '</span><select>' + chatOptions(c.chat) + '</select><button class="del">✕</button></div>' +
        '<div class="two"><input type="time" class="f"><input type="time" class="t"></div>';
      const f = row.querySelector('.f'), t = row.querySelector('.t'), sel = row.querySelector('select');
      f.value = c.from; t.value = c.to;
      sel.onchange = () => { c.chat = sel.value; save(); renderSched(); };
      f.onchange = () => { c.from = f.value || '08:00'; save(); updSched(); };
      t.onchange = () => { c.to = t.value || '09:30'; save(); updSched(); };
      row.querySelector('.del').onclick = () => { arr.splice(i, 1); save(); renderSched(); };
      list.append(row);
    });
    $('off').textContent = offToday() ? '↩ لغو تعطیلی امروز' : '😴 امروز تعطیل';
    $('snd').classList.toggle('on', cfg.sound !== false);
    updSched();
  }
  function drawTl() {
    const n = new Date(), isToday = editDay === dayIdx(n);
    timelineDraw($('tl'), cfg.sched.week[editDay] || [], isToday ? n.getHours() * 60 + n.getMinutes() : null, fa, subj);
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
    drawTl();
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
  $('fab').onclick = () => { sheet.classList.add('open'); applyFs(); if (!cfg.onb) showOnb(0); };
  $('thm').onclick = () => { cfg.theme = cfg.theme === 'light' ? 'dark' : 'light'; save(); applyFs(); };
  $('snd').onclick = () => { cfg.sound = cfg.sound === false; save(); renderSched(); if (cfg.sound) chime(); };
  $('onbAgain').onclick = () => { tab('groups'); showOnb(0); };
  const ONB = [
    { st: 'happy', t: 'سلام! من حاضرکم ✋', p: 'توی گروه‌ها و کانال‌های روبیکا و شاد مراقبم و وقتی نظرسنجی «حاضر» آمد، فوری می‌زنم.' },
    { st: 'watch', t: '۱) گروه‌ها را پیدا کن', p: 'در تب «گروه‌ها» دکمه‌ی «اسکن» را بزن و گروه‌های کلاس‌هایت را روشن کن.' },
    { st: 'wait', t: '۲) برنامه هفتگی (اختیاری)', p: 'در تب «برنامه» کلاس‌های هر روز و ساعتشان را بنویس تا فقط سر ساعت سراغ همان گروه بروم.' },
    { st: 'watch', t: '۳) شروع را بزن', p: 'بقیه‌اش با من. بعد از هر «حاضر» اعلان، لرزش و صدا می‌گیری.' },
  ];
  function showOnb(i) {
    const o = $('onb'), s = ONB[i], last = i === ONB.length - 1;
    o.innerHTML = '<div class="mas ' + s.st + '">' + MASCOT + '</div><h2></h2><p></p><div class="dots"></div><div class="btns"></div><button class="skip">رد کردن</button>';
    o.querySelector('h2').textContent = s.t; o.querySelector('p').textContent = s.p;
    ONB.forEach((_, k) => { const d = document.createElement('i'); if (k === i) d.className = 'on'; o.querySelector('.dots').append(d); });
    const nb = document.createElement('button'); nb.className = 'btn'; nb.textContent = last ? 'شروع کنیم' : 'بعدی';
    nb.onclick = () => { if (last) closeOnb(); else showOnb(i + 1); };
    o.querySelector('.btns').append(nb);
    o.querySelector('.skip').onclick = closeOnb;
    o.classList.add('show');
  }
  function closeOnb() { $('onb').classList.remove('show'); cfg.onb = true; save(); }
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
  setInterval(paintHero, 15000);
  paintHero();
  // ادامه خودکار بعد از بارگذاری مجدد یا باز شدن دوباره برنامه
  if (cfg.wasRunning && hasPlan() && words(cfg.include).length) {
    log('ادامه خودکار ربات...');
    setTimeout(() => { if (!running) { setRunning(true); runLoop(++loopToken); } }, 4000);
  } else if (cfg.wasRunning) { cfg.wasRunning = false; save(); }
  window.__hazer = { decide, norm, words, readPolls, scan, openChat, inSchedule, activeChats, cfg };
})();
