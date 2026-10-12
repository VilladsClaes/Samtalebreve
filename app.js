/* ============================================================
   Dagens brev — skrivemaskinen
   ============================================================ */
(function () {
  'use strict';

  /* ---------- små hjælpere ---------- */
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const choice = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const blobRadius = () => {
    const r = () => (randInt(38, 66)) + '%';
    return `${r()} ${r()} ${r()} ${r()} / ${r()} ${r()} ${r()} ${r()}`;
  };

  /* ---------- elementer ---------- */
  const sheet = document.getElementById('sheet');
  const inkLayer = document.getElementById('inkLayer');
  const lineDate = document.getElementById('lineDate');
  const lineCompliment = document.getElementById('lineCompliment');
  const lineQuestion = document.getElementById('lineQuestion');
  const tape = document.getElementById('tape');
  const writing = document.getElementById('writing');
  const editor = document.getElementById('editor');
  const toolbar = document.getElementById('toolbar');
  const hint = document.getElementById('hint');
  const btnMusic = document.getElementById('btnMusic');
  const btnSound = document.getElementById('btnSound');
  const btnPrint = document.getElementById('btnPrint');
  const btnImage = document.getElementById('btnImage');
  const btnShare = document.getElementById('btnShare');
  const toast = document.getElementById('toast');

  /* ============================================================
     1. Blæk-styling: hvert anslag får sin egen "hårdhed"
     ============================================================ */
  function applyInk(el, strength) {
    strength = strength || 1;
    const r = Math.random();
    let op;
    if (r < 0.06) {
      op = rand(0.5, 0.68);            // et mat, gennemblødt anslag
      el.classList.add('wet');
    } else if (r < 0.085) {
      op = 1;                           // et lidt for hårdt / dobbelt anslag
      el.classList.add('dbl');
    } else {
      op = rand(0.78, 1);               // normalt anslag
    }
    el.style.setProperty('--o', clamp(op * strength, 0, 1).toFixed(3));
    el.style.setProperty('--rz', rand(-1.3, 1.3).toFixed(2) + 'deg');
    el.style.setProperty('--ty', rand(-0.6, 0.6).toFixed(2) + 'px');
    el.style.setProperty('--tx', rand(-0.5, 0.5).toFixed(2) + 'px');
    el.style.setProperty('--sc', (1 + rand(-0.02, 0.02)).toFixed(3));
    if (Math.random() < 0.07) el.style.color = 'rgba(33,37,52,.92)'; // en anelse blåsort
  }

  /* ============================================================
     2. Blækklatter
     ============================================================ */
  const MAX_SPLATS = 520;

  // én enkelt klat — uden videre kald, så antallet altid er begrænset
  function addSplat(x, y, opts) {
    opts = opts || {};
    const el = document.createElement('div');
    el.className = 'splat' + (opts.dry ? ' splat--dry' : '');
    const s = opts.size != null ? opts.size : rand(2, 6.5);
    el.style.setProperty('--s', s.toFixed(1) + 'px');
    el.style.setProperty('--a', (opts.alpha != null ? opts.alpha : rand(0.32, 0.78)).toFixed(2));
    el.style.setProperty('--rot', rand(-45, 45).toFixed(1) + 'deg');
    el.style.setProperty('--br', blobRadius());
    el.style.setProperty('--bl', rand(0.08, 0.42).toFixed(2) + 'px');
    el.style.left = x.toFixed(1) + 'px';
    el.style.top = y.toFixed(1) + 'px';
    inkLayer.appendChild(el);

    if (inkLayer.childElementCount > MAX_SPLATS) {
      inkLayer.removeChild(inkLayer.firstElementChild);
    }
  }

  // en klat med et par små satellitdråber (kun ét niveau)
  function makeSplat(x, y, opts) {
    opts = opts || {};
    addSplat(x, y, opts);
    if (Math.random() < 0.4) {
      const n = randInt(1, 3);
      for (let i = 0; i < n; i++) {
        const a = rand(0, Math.PI * 2);
        const d = rand(2.5, 9);
        addSplat(x + Math.cos(a) * d, y + Math.sin(a) * d, {
          size: rand(0.8, 2.1),
          alpha: rand(0.25, 0.6),
          dry: Math.random() < 0.6
        });
      }
    }
  }

  // find et punkts position i papirets koordinatsystem
  function pointOnSheet(rect) {
    const s = sheet.getBoundingClientRect();
    return { x: rect.left - s.left, y: rect.top - s.top };
  }

  /* ============================================================
     3. Lyd: skrivemaskine + klaver
     ============================================================ */
  let audio = null;

  function AudioEngine() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);

    this.sfx = this.ctx.createGain();
    this.sfx.gain.value = 1;
    this.sfx.connect(this.master);

    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = 0;
    const soft = this.ctx.createBiquadFilter();       // dæmpet klang
    soft.type = 'lowpass';
    soft.frequency.value = 2400;
    soft.Q.value = 0.3;
    this.musicBus.connect(soft);
    soft.connect(this.master);

    // støj-buffer til klik og papir
    const len = Math.floor(this.ctx.sampleRate * 1.2);
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this.piano = null;
    this.musicOn = false;
  }

  AudioEngine.prototype.resume = function () {
    if (this.ctx.state === 'suspended') this.ctx.resume();
  };

  // ét anslag på tangenten
  AudioEngine.prototype.key = function (kind) {
    const ctx = this.ctx, t = ctx.currentTime;
    const isSpace = kind === 'space';

    const src = ctx.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    src.playbackRate.value = rand(0.9, 1.15);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = isSpace ? rand(850, 1350) : rand(1700, 3400);
    bp.Q.value = rand(1.1, 2.6);
    const g = ctx.createGain();
    const dur = isSpace ? rand(0.035, 0.06) : rand(0.018, 0.038);
    const vol = isSpace ? rand(0.045, 0.085) : rand(0.06, 0.13);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(bp); bp.connect(g); g.connect(this.sfx);
    src.start(t); src.stop(t + dur + 0.03);

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(isSpace ? rand(140, 190) : rand(175, 265), t);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0, t);
    og.gain.linearRampToValueAtTime(vol * 0.85, t + 0.003);
    og.gain.exponentialRampToValueAtTime(0.0006, t + rand(0.05, 0.09));
    osc.connect(og); og.connect(this.sfx);
    osc.start(t); osc.stop(t + 0.12);
  };

  // den lille klokke ved linjens slutning
  AudioEngine.prototype.bell = function () {
    const ctx = this.ctx, t = ctx.currentTime;
    [1660, 2490, 3320].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * rand(0.995, 1.005);
      const g = ctx.createGain();
      const v = 0.055 / (i + 1);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(v, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0004, t + 0.9 - i * 0.16);
      o.connect(g); g.connect(this.sfx);
      o.start(t); o.stop(t + 1.0);
    });
  };

  // vognretur / ny linje
  AudioEngine.prototype.carriage = function () {
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(2600, t);
    bp.frequency.exponentialRampToValueAtTime(520, t + 0.16);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.06, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0006, t + 0.2);
    src.connect(bp); bp.connect(g); g.connect(this.sfx);
    src.start(t); src.stop(t + 0.24);
  };

  // papir der føres ind
  AudioEngine.prototype.paperFeed = function () {
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(420, t);
    bp.frequency.linearRampToValueAtTime(1500, t + 0.55);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.12);
    g.gain.linearRampToValueAtTime(0.022, t + 0.42);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.8);
    src.connect(bp); bp.connect(g); g.connect(this.sfx);
    src.start(t); src.stop(t + 0.85);
  };

  /* ---- klaveret: få, langsomme, bløde toner med meget rum ---- */

  function makeIR(ctx, dur, decay) {
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  function Piano(ctx, out) {
    this.ctx = ctx;
    this.out = out;
    this.pre = ctx.createGain();
    this.pre.gain.value = 1;

    const conv = ctx.createConvolver();
    conv.buffer = makeIR(ctx, 3.4, 2.4);
    const wet = ctx.createGain(); wet.gain.value = 0.72;
    const dry = ctx.createGain(); dry.gain.value = 0.28;
    this.pre.connect(conv); conv.connect(wet); wet.connect(out);
    this.pre.connect(dry); dry.connect(out);

    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.frequency.value = 2300;
    this.tone.Q.value = 0.4;
    this.tone.connect(this.pre);

    this.step = 0;
    this.nextTime = 0;
    this.timer = null;
    this.prog = [
      [45, 57, 60, 64],   // Am
      [41, 53, 57, 60],   // F
      [48, 55, 60, 64],   // C
      [43, 55, 58, 62],   // G
      [45, 55, 59, 64],   // Am9
      [38, 50, 53, 57]    // Dm
    ];
  }

  Piano.prototype.note = function (midi, when, dur, vel) {
    const ctx = this.ctx;
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(vel, when + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0004, when + dur);
    env.connect(this.tone);

    const partials = [[1, 1], [2, 0.42], [3, 0.19], [4, 0.085], [6, 0.03], [8, 0.014]];
    for (let i = 0; i < partials.length; i++) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * partials[i][0] * (1 + rand(-0.0018, 0.0018));
      const g = ctx.createGain();
      g.gain.value = partials[i][1] * (1 + rand(-0.1, 0.1));
      o.connect(g); g.connect(env);
      o.start(when); o.stop(when + dur + 0.15);
    }
  };

  Piano.prototype.scheduleBar = function (t, step) {
    const chord = this.prog[step % this.prog.length];

    // nogle gange kun én enkelt, eftertænksom tone
    if (Math.random() < 0.3) {
      this.note(chord[0] + choice([0, 12]), t + rand(0, 0.4), rand(2.6, 4.8), rand(0.11, 0.17));
      return;
    }

    // dyb grundtone
    this.note(chord[0] - 12, t + rand(0, 0.06), rand(2.8, 5.0), rand(0.15, 0.22));

    // én eller to akkordtoner, spredt ud
    const n = randInt(1, 2);
    for (let i = 0; i < n; i++) {
      this.note(chord[1 + randInt(0, chord.length - 2)], t + rand(0.4, 3.0), rand(2.0, 4.2), rand(0.09, 0.16));
    }

    // af og til en enlig melodi-tone højt oppe
    if (Math.random() < 0.5) {
      this.note(chord[2] + 12 + choice([0, 2, 4, 7, 9, 12]), t + rand(1.4, 4.8), rand(1.6, 3.2), rand(0.06, 0.11));
    }
  };

  Piano.prototype.start = function () {
    if (this.timer) return;
    const ctx = this.ctx;
    this.nextTime = ctx.currentTime + 0.5;
    this.timer = setInterval(() => {
      while (this.nextTime < ctx.currentTime + 2.0) {
        this.scheduleBar(this.nextTime, this.step);
        this.nextTime += rand(6.5, 12.5);
        this.step++;
      }
    }, 300);
  };

  AudioEngine.prototype.startMusic = function () {
    if (this.musicOn) return;
    if (!this.piano) this.piano = new Piano(this.ctx, this.musicBus);
    this.musicOn = true;
    this.musicBus.gain.cancelScheduledValues(this.ctx.currentTime);
    this.musicBus.gain.setValueAtTime(this.musicBus.gain.value, this.ctx.currentTime);
    this.musicBus.gain.linearRampToValueAtTime(0.5, this.ctx.currentTime + 4.5);
    this.piano.start();
  };

  AudioEngine.prototype.stopMusic = function () {
    if (!this.musicOn) return;
    this.musicOn = false;
    const t = this.ctx.currentTime;
    this.musicBus.gain.cancelScheduledValues(t);
    this.musicBus.gain.setValueAtTime(this.musicBus.gain.value, t);
    this.musicBus.gain.linearRampToValueAtTime(0, t + 1.2);
  };

  /* ============================================================
     4. Skrivemaskine-motoren
     ============================================================ */
  const state = { started: false, typing: false, skip: false };

  function makeOrder(n) {
    const jitter = Math.min(9, Math.max(2.2, n * 0.06));
    const arr = [];
    for (let i = 0; i < n; i++) arr.push({ i: i, k: i + rand(-jitter, jitter) });
    arr.sort((a, b) => a.k - b.k);
    return arr.map((o) => o.i);
  }

  // bygger linjen op som enkelte anslag og mellemrum
  function buildLine(text, lineEl) {
    lineEl.textContent = '';
    const chars = [];
    const words = text.split(' ');
    for (let wi = 0; wi < words.length; wi++) {
      if (wi > 0) {
        const sp = document.createElement('span');
        sp.className = 'sp';
        sp.textContent = ' ';
        if (Math.random() < 0.16) sp.style.paddingRight = rand(1.6, 3.4).toFixed(1) + 'px';
        lineEl.appendChild(sp);
      }
      const wordEl = document.createElement('span');
      wordEl.className = 'word';
      const charsOfWord = Array.from(words[wi]);
      for (let ci = 0; ci < charsOfWord.length; ci++) {
        const ch = document.createElement('span');
        ch.className = 'ch';
        ch.textContent = charsOfWord[ci];
        applyInk(ch);
        wordEl.appendChild(ch);
        chars.push(ch);
      }
      lineEl.appendChild(wordEl);
    }
    return chars;
  }

  function positionCaret(caret, ch) {
    caret.style.left = (ch.offsetLeft + ch.offsetWidth) + 'px';
    caret.style.top = ch.offsetTop + 'px';
    caret.classList.add('on');
  }

  function maybeSplat(ch) {
    if (Math.random() > 0.13) return;
    const r = ch.getBoundingClientRect();
    const p = pointOnSheet(r);
    makeSplat(p.x + rand(-6, 6), p.y + rand(0, r.height), {
      size: rand(1.6, 6),
      alpha: rand(0.28, 0.72)
    });
  }

  async function typeLine(lineEl, text, token) {
    const chars = buildLine(text, lineEl);
    const caret = document.createElement('span');
    caret.className = 'caret';
    lineEl.appendChild(caret);

    const order = makeOrder(chars.length);
    const len = Math.max(1, chars.length);
    const base = reduceMotion ? 6 : clamp(66 - len * 0.06, 34, 66);

    state.typing = true;
    for (let k = 0; k < order.length; k++) {
      if (token != null && token !== runToken) return;   // en nyere runde har overtaget
      const ch = chars[order[k]];
      ch.classList.add('on');
      positionCaret(caret, ch);

      const c = ch.textContent;
      if (audio) audio.key('key');
      maybeSplat(ch);

      if (!state.skip) {
        let d = base * rand(0.7, 1.35);
        if (/[.,:;!?]/.test(c)) d += rand(150, 300);
        if (Math.random() < 0.03) d += rand(200, 520);   // et lille tøvende ophold
        await sleep(d);
      }
    }

    if (token == null || token === runToken) state.typing = false;
    caret.classList.remove('on');
    await sleep(reduceMotion ? 40 : 130);
    caret.remove();
    if (audio) audio.bell();
  }

  /* ============================================================
     5. Skrivefeltet — også på skrivemaskine
     ============================================================ */
  /* Tastaturet skriver selv — også når det er et mobiltastatur med
autokorrektur, forslag og danske tegn. Vi griber ikke ind undervejs,
men kler den nye tekst på bagefter og sætter markøren tilbage på plads. */

  // markøren måles som et tegn-antal fra feltets start
  function caretOffset() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const r = sel.getRangeAt(0);
    if (!editor.contains(r.startContainer)) return null;
    const upTo = document.createRange();
    upTo.selectNodeContents(editor);
    upTo.setEnd(r.startContainer, r.startOffset);
    return upTo.toString().length;
  }

  function setCaretOffset(offset) {
    const sel = window.getSelection();
    if (!sel) return;
    const r = document.createRange();
    let placed = false;
    if (offset != null) {
      let left = offset;
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null);
      let node = null;
      while ((node = walker.nextNode())) {
        const len = node.nodeValue.length;
        if (!len) continue;
        if (left < len) { r.setStart(node, left); r.collapse(true); placed = true; break; }
        if (left === len) {
          // lige efter tegnet — uden om anslaget, så næste tastetryk bliver sit eget
          r.setStartAfter(node);
          r.collapse(true);
          placed = true;
          break;
        }
        left -= len;
      }
    }
    if (!placed) { r.selectNodeContents(editor); r.collapse(false); }
    sel.removeAllRanges();
    sel.addRange(r);
  }

  // et stykke rå tekst bliver til færdige anslag — ét tegn, ét anslag
  function buildInkFragment(value, fresh, limit) {
    const frag = document.createDocumentFragment();
    for (const c of value) {
      if (c === '\n' || c === '\r') {
        frag.appendChild(document.createElement('br'));
        continue;
      }
      const s = document.createElement('span');
      if (c === ' ') {
        s.className = 'sp';
        s.textContent = ' ';
        if (Math.random() < 0.2) s.style.paddingRight = rand(1.6, 3.6).toFixed(1) + 'px';
      } else {
        s.className = 'ch on';
        s.textContent = c;
        applyInk(s, 1.12);
        if (fresh.length < limit) fresh.push(s);
      }
      frag.appendChild(s);
    }
    return frag;
  }

  // kler al rå tekst i feltet på — hvert tegn får sin egen hårdhed
  function styleNewText() {
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) nodes.push(node);

    const fresh = [];
    const limit = 8000;                    // et meget stort indsæt må ikke låse siden
    for (let t = 0; t < nodes.length; t++) {
      const textNode = nodes[t];
      const value = textNode.nodeValue;
      if (!value || !value.length) continue;

      const parent = textNode.parentNode;
      const isChar = parent && parent.nodeType === 1 && parent.classList.contains('ch');
      const isSpace = parent && parent.nodeType === 1 && parent.classList.contains('sp');

      if (isChar && value.length === 1) continue;   // allerede færdigt
      if (isSpace && value === ' ') continue;

      if (isChar || isSpace) {
        // tastaturet lagde flere tegn ind i samme anslag — del det op
        const built = buildInkFragment(value, fresh, limit);
        if (parent.childNodes.length === 1 && parent.parentNode) {
          parent.parentNode.replaceChild(built, parent);
        } else {
          parent.replaceChild(built, textNode);   // nødudgang: intet indhold må gå tabt
        }
        continue;
      }

      textNode.parentNode.replaceChild(buildInkFragment(value, fresh, limit), textNode);
    }
    return fresh;
  }

  // tomme anslag efter sletning skal ikke blive liggende
  function pruneEmpty() {
    const spans = editor.querySelectorAll('.ch, .sp');
    for (let i = 0; i < spans.length; i++) {
      if (!spans[i].textContent.length) spans[i].remove();
    }
  }

  // lyd og blatter til det, der lige blev skrevet
  function waveOfAnslots(fresh) {
    if (!fresh.length) return;
    if (audio) audio.key('key');
    const burst = fresh.length <= 24;      // et helt ord fra autokorrektur er ét anslag
    const count = burst ? fresh.length : 12;
    for (let i = 0; i < count; i++) {
      const el = burst ? fresh[i] : fresh[Math.floor(i * fresh.length / count)];
      editorSplat(el, el.textContent);
    }
  }

  function editorSplat(node, ch) {
    const prob = ch === ' ' ? 0.1 : 0.36;     // ekstra meget blæk i svaret
    if (Math.random() > prob) return;
    const r = node.getBoundingClientRect();
    const p = pointOnSheet(r);
    const x = p.x + r.width / 2 + rand(-7, 7);
    const y = p.y + r.height * rand(0.15, 1.05);
    makeSplat(x, y, { size: rand(2.4, 9), alpha: rand(0.45, 0.9) });
    if (Math.random() < 0.3) {
      makeSplat(x + rand(-10, 10), y + rand(-7, 7), {
        size: rand(1, 3.6),
        alpha: rand(0.25, 0.6),
        dry: Math.random() < 0.5
      });
    }
  }

  // imens tastaturet bygger et ord (autokorrektur, forslag, accenter) rører vi intet
  let composing = false;

  editor.addEventListener('compositionstart', function () { composing = true; });
  editor.addEventListener('compositionend', function () {
    composing = false;
    const at = caretOffset();
    pruneEmpty();
    styleNewText();
    setCaretOffset(at);
  });

  editor.addEventListener('beforeinput', function (e) {
    if (composing) return;

    // indsæt og drop: tag ren tekst, så der ikke kommer fremmed markup med
    if (e.inputType === 'insertFromPaste' || e.inputType === 'insertFromDrop') {
      e.preventDefault();
      let text = '';
      try { if (e.dataTransfer) text = e.dataTransfer.getData('text/plain'); } catch (err) {}
      if (!text && e.data) text = e.data;
      if (!text) return;

      const normal = text.replace(/\r\n?/g, '\n');
      const lines = normal.split('\n');
      const added = normal.length - (lines.length - 1);
      const at = caretOffset();

      const frag = document.createDocumentFragment();
      for (let i = 0; i < lines.length; i++) {
        if (i) frag.appendChild(document.createElement('br'));
        frag.appendChild(document.createTextNode(lines[i]));
      }

      // indsæt altid ved en knudeposition — ikke midt inde i en tekstknude,
      // for der taber browseren resten af det indsatte
      const sel = window.getSelection();
      let anchor = null;
      let offset = 0;
      if (sel && sel.rangeCount && editor.contains(sel.getRangeAt(0).startContainer)) {
        const r = sel.getRangeAt(0);
        r.deleteContents();
        anchor = r.startContainer;
        offset = r.startOffset;
      }
      if (anchor && anchor.nodeType === 3) {
        const tail = anchor.splitText(Math.min(offset, anchor.nodeValue.length));
        offset = Array.prototype.indexOf.call(tail.parentNode.childNodes, tail);
        anchor = tail.parentNode;
      }
      // kom aldrig ind i et af vores egne anslag — læg det nye ved siden af i stedet
      while (anchor && anchor.nodeType === 1 && anchor.parentNode &&
             (anchor.classList.contains('ch') || anchor.classList.contains('sp'))) {
        offset = Array.prototype.indexOf.call(anchor.parentNode.childNodes, anchor) + 1;
        anchor = anchor.parentNode;
      }
      if (anchor) {
        const target = document.createRange();
        target.setStart(anchor, offset);
        target.collapse(true);
        target.insertNode(frag);
      } else {
        editor.appendChild(frag);
      }

      const fresh = styleNewText();
      setCaretOffset(at == null ? null : at + added);
      waveOfAnslots(fresh);
      return;
    }

    if (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak') {
      if (audio) audio.carriage();
    }
  });

  editor.addEventListener('input', function (e) {
    if (composing || e.isComposing) return;                  // ordet er ikke færdigt endnu
    if (e.inputType === 'insertFromPaste' || e.inputType === 'insertFromDrop') return;
    if (e.inputType === 'insertCompositionText') return;     // klaret ved compositionend

    const at = caretOffset();
    // tomme anslag kan kun opstå ved sletning — spar en fuld gennemgang ved hvert tastetryk
    if (e.inputType && e.inputType.indexOf('delete') === 0) pruneEmpty();
    const fresh = styleNewText();
    setCaretOffset(at);

    if (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak') return;
    if (e.inputType && e.inputType.indexOf('delete') === 0) {
      if (audio) audio.key('key');
      return;
    }
    waveOfAnslots(fresh);
  });

  toolbar.addEventListener('pointerdown', function (e) {
    e.preventDefault();                    // bevar markeringen — også på touch
  });
  toolbar.addEventListener('click', function (e) {
    const btn = e.target.closest('button');
    if (!btn) return;
    editor.focus();
    try { document.execCommand('styleWithCSS', false, false); } catch (err) {}
    try { document.execCommand(btn.dataset.cmd, false, null); } catch (err) {}
    if (audio) audio.key('space');
  });

  /* ============================================================
     6. Sekvensen: kompliment → dagens spørgsmål → skrivefelt
     ============================================================ */

  /* ---------- indholdet: det der skrives på brevet ----------
     Alt indhold kan rettes i panelet (knappen »indhold« nederst).
     Ændringerne ligger i browserens lager og kan hentes ud som data.js. */
  const STORE_KEY = 'dagensbrev.indhold';

  const textOf = (it) => (typeof it === 'string' ? it : (it && it.text) || '');
  const catOf = (it) => (typeof it === 'string' ? '' : (it && it.cat) || '');
  const byOf = (it) => (typeof it === 'string' ? '' : (it && it.by) || '');

  // alt indhold bliver til { text, cat, by } — gamle strenge i data.js virker stadig
  function normalizeList(list) {
    const out = [];
    (list || []).forEach(function (it) {
      const text = textOf(it).replace(/\s+/g, ' ').trim();
      if (!text) return;
      out.push({ text: text, cat: catOf(it), by: byOf(it) });
    });
    return out;
  }

  const DEFAULTS = {
    compliments: normalizeList(DATA.compliments),
    questions: normalizeList(DATA.questions)
  };

  // nye objekter — ellers ville en rettelse i panelet smitte af på standarden,
  // så »nulstil« ikke kunne føre teksten tilbage
  const cloneList = (arr) => arr.map((it) => ({ text: it.text, cat: it.cat, by: it.by }));

  const content = {
    compliments: cloneList(DEFAULTS.compliments),
    questions: cloneList(DEFAULTS.questions)
  };

  (function loadContent() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (!saved) return;
      const kompl = normalizeList(saved.compliments);
      const spoer = normalizeList(saved.questions);
      if (kompl.length) content.compliments = kompl;
      if (spoer.length) content.questions = spoer;
    } catch (e) {}
  })();

  function saveContent() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(content));
      return true;
    } catch (e) {
      return false;
    }
  }

  // en linje på brevet: ordsprog og citater får deres ophav med
  function lineOf(item) {
    return item.text + (item.by ? ' — ' + item.by : '');
  }

  function pickCompliment() {
    return choice(content.compliments.length ? content.compliments : DEFAULTS.compliments);
  }

  function questionsList() {
    return content.questions.length ? content.questions : DEFAULTS.questions;
  }

  // hver ny runde får et nummer, så en gammel runde kan afbrydes midtvejs
  let runToken = 0;

  function dayQuestion() {
    const d = new Date();
    const key = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    let x = (key ^ 0x9e3779b9) >>> 0;
    x = (Math.imul(x ^ (x >>> 16), 2246822507) ^ Math.imul(x ^ (x >>> 13), 3266489909)) >>> 0;
    x = (x ^ (x >>> 16)) >>> 0;
    const list = questionsList();
    return list[x % list.length];
  }

  function formatDate(d) {
    try {
      return new Intl.DateTimeFormat('da-DK', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
      }).format(d);
    } catch (e) {
      return d.toLocaleDateString();
    }
  }

  function revealEditor() {
    writing.hidden = false;
    if (audio) audio.paperFeed();

    const show = function () { writing.classList.add('is-shown'); };
    // to rammer er nok i en synlig fane, men en baggrundsfane får ingen rammer
    requestAnimationFrame(function () { requestAnimationFrame(show); });
    setTimeout(show, 300);

    // på en telefon må tastaturet ikke dukke op af sig selv
    if (window.matchMedia('(pointer: fine)').matches) {
      setTimeout(function () {
        editor.focus();
        setCaretOffset(null);              // klar til at skrive i bunden
      }, 1700);
    }
  }

  async function runSequence() {
    const token = ++runToken;             // en ny runde afbryder den forrige
    const compliment = pickCompliment();
    const question = dayQuestion();

    await typeLine(lineDate, formatDate(new Date()), token);
    if (token !== runToken) return;
    if (!state.skip) await sleep(420);
    tape.classList.add('is-on');          // klask tapen på, lige før der skrives
    if (!state.skip) await sleep(380);    // lad den falde til ro, før der skrives på den
    await typeLine(lineCompliment, lineOf(compliment), token);
    if (token !== runToken) return;
    if (!state.skip) await sleep(700);
    await typeLine(lineQuestion, question.text, token);
    if (token !== runToken) return;
    if (!state.skip) await sleep(520);
    revealEditor();
  }

  /* ============================================================
     7. Start, lyd og kontroller
     ============================================================ */
  const prefs = { music: true, sound: true };
  try {
    const saved = JSON.parse(localStorage.getItem('dagensbrev') || '{}');
    if (typeof saved.music === 'boolean') prefs.music = saved.music;
    if (typeof saved.sound === 'boolean') prefs.sound = saved.sound;
  } catch (e) {}
  const savePrefs = function () {
    try { localStorage.setItem('dagensbrev', JSON.stringify(prefs)); } catch (e) {}
  };

  function ensureAudio() {
    if (!audio) {
      try { audio = new AudioEngine(); } catch (e) { audio = null; return; }
    }
    audio.resume();
    audio.sfx.gain.value = prefs.sound ? 1 : 0;
    if (prefs.music) audio.startMusic();
  }

  function begin() {
    if (state.started) return;
    state.started = true;
    hint.classList.add('is-gone');
    ensureAudio();
    runSequence();
  }

  document.addEventListener('pointerdown', function (e) {
    if (e.target.closest('#admin')) return;      // panelet rører ikke brevet
    if (e.target.closest('.controls') || e.target.closest('.toolbar')) {
      ensureAudio();
      return;
    }
    if (!state.started) { begin(); } else if (state.typing) { state.skip = true; }
  });

  document.addEventListener('keydown', function (e) {
    if (e.target.closest('#admin')) return;      // skriv frit i panelet
    if (!state.started && !e.target.closest('#editor')) {
      begin();
    } else if (state.typing && (e.key === ' ' || e.key === 'Enter')) {
      state.skip = true;
    }
  }, true);

  hint.addEventListener('click', begin);

  function syncButtons() {
    btnMusic.setAttribute('aria-pressed', String(prefs.music));
    btnSound.setAttribute('aria-pressed', String(prefs.sound));
  }
  btnMusic.addEventListener('click', function () {
    prefs.music = !prefs.music;
    savePrefs();
    syncButtons();
    if (!audio) ensureAudio();
    if (audio) { prefs.music ? audio.startMusic() : audio.stopMusic(); }
  });
  btnSound.addEventListener('click', function () {
    prefs.sound = !prefs.sound;
    savePrefs();
    syncButtons();
    if (!audio) ensureAudio();
    if (audio) audio.sfx.gain.value = prefs.sound ? 1 : 0;
  });
  syncButtons();

  /* ============================================================
     8. Gem brevet — som PDF, som billede eller send det videre
     ============================================================ */

  let toastTimer = null;
  function say(msg) {
    toast.textContent = msg;
    toast.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.classList.remove('is-on'); }, 3800);
  }

  function num(v, fallback) {
    const n = parseFloat(v);
    return isFinite(n) ? n : fallback;
  }

  // afstand fra et element op til arket (uden at regne rotation med)
  function offsetWithin(el, root) {
    let x = 0, y = 0, n = el;
    while (n && n !== root) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
    return { x: x, y: y };
  }

  function paintPaper(ctx, W, H) {
    ctx.fillStyle = '#f5edd9';
    ctx.fillRect(0, 0, W, H);

    let g = ctx.createRadialGradient(W * 0.14, 0, 0, W * 0.14, 0, Math.max(W, H) * 0.95);
    g.addColorStop(0, 'rgba(255,253,245,.95)');
    g.addColorStop(0.58, 'rgba(255,253,245,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    g = ctx.createRadialGradient(W * 1.02, H * 1.06, 0, W * 1.02, H * 1.06, W * 0.9);
    g.addColorStop(0, 'rgba(126,100,60,.13)');
    g.addColorStop(0.6, 'rgba(126,100,60,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // en svag kornet tekstur, så papiret ikke bliver helt fladt
    const tile = document.createElement('canvas');
    tile.width = tile.height = 128;
    const tc = tile.getContext('2d');
    const img = tc.createImageData(128, 128);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 120 + Math.random() * 135;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    tc.putImageData(img, 0, 0);
    ctx.save();
    ctx.globalAlpha = 0.035;
    try {
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = ctx.createPattern(tile, 'repeat');
      ctx.fillRect(0, 0, W, H);
    } catch (e) {}
    ctx.restore();
  }

  function paintVignette(ctx, W, H) {
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.82);
    g.addColorStop(0, 'rgba(120,92,52,0)');
    g.addColorStop(1, 'rgba(120,92,52,.16)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(88,68,42,.16)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  }

  // tapens hældning — skal svare til transform: rotate(...) på .tape i style.css
  const TAPE_TILT = -1.4 * Math.PI / 180;

  // tapens midtpunkt i arkets koordinater; alt drejes om det, så både
  // selve tapen og teksten på den hælder ens
  function tapePivot(tapeEl) {
    const tp = offsetWithin(tapeEl, sheet);
    return [tp.x + tapeEl.offsetWidth / 2, tp.y + tapeEl.offsetHeight / 2];
  }

  // malertapen, som komplimentet står på
  function paintTape(ctx) {
    const tapes = sheet.querySelectorAll('.tape');
    for (let i = 0; i < tapes.length; i++) {
      const t = tapes[i];
      const w = t.offsetWidth, h = t.offsetHeight;
      if (!w || !h) continue;
      if (num(window.getComputedStyle(t).opacity, 1) <= 0.01) continue;
      const p = offsetWithin(t, sheet);
      const piv = tapePivot(t);

      // kanterne rives op, som på et stykke tape der er revet af rullen
      const jag = Math.max(2, h * 0.055);
      const steps = 7;
      const pts = [];
      for (let s = 0; s <= steps; s++) pts.push([rand(-jag, jag * 0.35), (h * s) / steps]);
      for (let s = steps; s >= 0; s--) pts.push([w + rand(-jag * 0.35, jag), (h * s) / steps]);

      ctx.save();
      // tapen sidder skævt på, ligesom på skærmen
      ctx.translate(piv[0], piv[1]);
      ctx.rotate(TAPE_TILT);
      ctx.translate(-piv[0], -piv[1]);
      ctx.beginPath();
      ctx.moveTo(p.x + pts[0][0], p.y + pts[0][1]);
      for (let k = 1; k < pts.length; k++) ctx.lineTo(p.x + pts[k][0], p.y + pts[k][1]);
      ctx.closePath();

      const g = ctx.createLinearGradient(p.x, p.y, p.x, p.y + h);
      g.addColorStop(0, 'rgba(236,224,174,.93)');
      g.addColorStop(0.46, 'rgba(228,214,158,.91)');
      g.addColorStop(1, 'rgba(219,201,142,.91)');
      ctx.fillStyle = g;
      ctx.fill();

      // de fine riller fra rullen
      ctx.strokeStyle = 'rgba(120,100,58,.07)';
      ctx.lineWidth = 1;
      for (let y = 3; y < h; y += 4) {
        ctx.beginPath();
        ctx.moveTo(p.x, p.y + y);
        ctx.lineTo(p.x + w, p.y + y);
        ctx.stroke();
      }

      ctx.strokeStyle = 'rgba(70,56,30,.17)';
      ctx.stroke();
      ctx.restore();
    }
  }

  function paintSplats(ctx) {
    const ink = inkLayer.children;
    for (let i = 0; i < ink.length; i++) {
      const el = ink[i];
      const s = num(el.style.getPropertyValue('--s'), 4);
      const a = num(el.style.getPropertyValue('--a'), 0.5);
      const rot = num(el.style.getPropertyValue('--rot'), 0) * Math.PI / 180;
      const alpha = el.classList.contains('splat--dry') ? a * 0.55 : a;
      const r = Math.max(0.4, s / 2);
      const br = (el.style.getPropertyValue('--br') || '').match(/[\d.]+/g) || [];
      const fx = br.length >= 4 ? num(br[0], 50) / 50 : 1;
      const fy = br.length >= 8 ? num(br[4], 50) / 50 : 1;

      ctx.save();
      ctx.translate(num(el.style.left, 0), num(el.style.top, 0));
      ctx.rotate(rot);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, 'rgba(22,18,14,' + alpha + ')');
      g.addColorStop(0.6, 'rgba(22,18,14,' + (alpha * 0.97) + ')');
      g.addColorStop(1, 'rgba(22,18,14,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * fx, r * fy, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // hvert skrevet tegn genskabes med sin egen hårdhed, hældning og farve
  function paintChars(ctx, root) {
    const chars = root.querySelectorAll('.ch');
    for (let i = 0; i < chars.length; i++) {
      const el = chars[i];
      const cs = window.getComputedStyle(el);
      if (cs.visibility === 'hidden') continue;
      const alpha = num(cs.opacity, 1);
      if (alpha <= 0.01) continue;
      const text = el.textContent;
      if (!text || !text.trim()) continue;

      const w = el.offsetWidth, h = el.offsetHeight;
      const p = offsetWithin(el, sheet);
      const fs = num(cs.fontSize, 18);

      // står tegnet på tapen, hælder det sammen med den
      const tapeEl = el.closest ? el.closest('.tape') : null;

      ctx.save();
      if (tapeEl) {
        const piv = tapePivot(tapeEl);
        ctx.translate(piv[0], piv[1]);
        ctx.rotate(TAPE_TILT);
        ctx.translate(-piv[0], -piv[1]);
      }
      ctx.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + fs + 'px ' + (cs.fontFamily || 'monospace');
      const m = ctx.measureText('Hg');
      const asc = m.fontBoundingBoxAscent || fs * 0.78;
      const desc = m.fontBoundingBoxDescent || fs * 0.22;
      const baseFromTop = (h - (asc + desc)) / 2 + asc;

      ctx.translate(p.x + w / 2 + num(el.style.getPropertyValue('--tx'), 0),
                    p.y + h / 2 + num(el.style.getPropertyValue('--ty'), 0));
      ctx.rotate(num(el.style.getPropertyValue('--rz'), 0) * Math.PI / 180);
      ctx.scale(num(el.style.getPropertyValue('--sc'), 1), num(el.style.getPropertyValue('--sc'), 1));
      ctx.globalAlpha = alpha;
      ctx.fillStyle = cs.color;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      if (cs.filter && cs.filter !== 'none') ctx.filter = cs.filter;
      if (cs.letterSpacing && cs.letterSpacing !== 'normal') {
        try { ctx.letterSpacing = cs.letterSpacing; } catch (e) {}
      }

      let out = text;
      if (cs.textTransform === 'uppercase') out = out.toUpperCase();

      const dx = -w / 2;
      const dy = baseFromTop - h / 2;
      if (el.classList.contains('dbl')) {          // dobbeltanslaget
        ctx.fillText(out, dx + 0.85, dy + 0.4);
        ctx.fillText(out, dx - 0.45, dy + 0.1);
      }
      ctx.fillText(out, dx, dy);

      if (cs.textDecorationLine && cs.textDecorationLine.indexOf('underline') >= 0) {
        ctx.beginPath();
        ctx.lineWidth = Math.max(0.8, fs / 16);
        ctx.strokeStyle = cs.color;
        ctx.moveTo(dx, dy + fs * 0.16);
        ctx.lineTo(dx + w, dy + fs * 0.16);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // punkttegn tegnes ikke som .ch, så de lægges ind særskilt
  function paintBullets(ctx) {
    const items = editor.querySelectorAll('li');
    for (let i = 0; i < items.length; i++) {
      const li = items[i];
      const first = li.querySelector('.ch');
      const p = offsetWithin(li, sheet);
      const y = first ? p.y + first.offsetHeight / 2 : p.y + 12;
      ctx.save();
      ctx.fillStyle = 'rgba(27,23,18,.85)';
      ctx.font = '700 ' + num(getComputedStyle(li).fontSize, 18) + 'px ' + (getComputedStyle(li).fontFamily || 'monospace');
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('\u2022', p.x - 14, y);
      ctx.restore();
    }
  }

  async function renderLetterCanvas(scale) {
    if (document.fonts && document.fonts.ready) {
      try { await document.fonts.ready; } catch (e) {}
    }

    // skjul værktøj og knapper, så kun brevet kommer med
    const hide = sheet.querySelectorAll('.toolbar, .actions, .signoff, .caret');
    const saved = [];
    for (let i = 0; i < hide.length; i++) {
      saved.push([hide[i], hide[i].style.display]);
      hide[i].style.display = 'none';
    }
    void sheet.offsetHeight;

    try {
      const r = sheet.getBoundingClientRect();
      const W = Math.max(1, Math.round(r.width));
      const H = Math.max(1, Math.round(r.height));
      const s = scale || 2;
      const cv = document.createElement('canvas');
      cv.width = Math.round(W * s);
      cv.height = Math.round(H * s);
      const ctx = cv.getContext('2d');
      ctx.scale(s, s);
      paintPaper(ctx, W, H);
      paintTape(ctx);
      paintSplats(ctx);
      paintChars(ctx, sheet);
      paintBullets(ctx);
      paintVignette(ctx, W, H);
      return cv;
    } finally {
      for (let i = 0; i < saved.length; i++) saved[i][0].style.display = saved[i][1];
    }
  }

  function downloadCanvas(cv, name) {
    cv.toBlob(function (blob) {
      if (!blob) { say('kunne ikke lave billedet'); return; }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
    }, 'image/png');
  }

  function letterText() {
    const parts = [lineDate.innerText, '', lineCompliment.innerText, '', lineQuestion.innerText];
    const answer = editor.innerText.replace(/\u00a0/g, ' ').trim();
    if (answer) parts.push('', 'Mit svar:', answer);
    return parts.join('\n');
  }

  btnPrint.addEventListener('click', function () {
    say('v\u00e6lg \u201egem som PDF\u201c i dialogboksen');
    setTimeout(function () { window.print(); }, 400);
  });

  btnImage.addEventListener('click', async function () {
    btnImage.disabled = true;
    say('brygger bl\u00e6kket \u2026');
    try {
      const cv = await renderLetterCanvas(2);
      const stamp = new Date().toISOString().slice(0, 10);
      downloadCanvas(cv, 'dagens-brev-' + stamp + '.png');
      say('brevet ligger nu i dine downloads');
    } catch (e) {
      say('kunne ikke lave billedet');
    } finally {
      btnImage.disabled = false;
    }
  });

  btnShare.addEventListener('click', async function () {
    const text = letterText();
    const title = 'Dagens brev';

    if (navigator.share) {
      try {
        if (navigator.canShare) {
          const cv = await renderLetterCanvas(2);
          const blob = await new Promise(function (res) { cv.toBlob(res, 'image/png'); });
          if (blob && typeof File === 'function') {
            const file = new File([blob], 'dagens-brev.png', { type: 'image/png' });
            if (navigator.canShare({ files: [file] })) {
              await navigator.share({ files: [file], title: title, text: text });
              return;
            }
          }
        }
        await navigator.share({ title: title, text: text });
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return;
      }
    }

    say('\u00e5bner din mail med brevet');
    window.location.href = 'mailto:?subject=' + encodeURIComponent('Dagens brev \u2014 mit svar') +
                           '&body=' + encodeURIComponent(text);
  });

  /* ============================================================
     9. Panelet: pas indholdet — redigér, bladr og hent data.js
     ============================================================ */

  const admin = document.getElementById('admin');
  const adminTabs = document.getElementById('adminTabs');
  const adminList = document.getElementById('adminList');
  const adminListHint = document.getElementById('adminListHint');
  const adminSearch = document.getElementById('adminSearch');
  const adminCat = document.getElementById('adminCat');
  const adminDupes = document.getElementById('adminDupes');
  const adminText = document.getElementById('adminText');
  const adminItemCat = document.getElementById('adminItemCat');
  const adminBy = document.getElementById('adminBy');
  const adminCats = document.getElementById('adminCats');
  const adminMeta = document.getElementById('adminMeta');
  const adminStatus = document.getElementById('adminStatus');
  const adminCountC = document.getElementById('adminCountC');
  const adminCountQ = document.getElementById('adminCountQ');
  const btnAdmin = document.getElementById('btnAdmin');
  const adminDupeSens = document.getElementById('adminDupeSens');
  const adminDupeAll = document.getElementById('adminDupeAll');
  const adminDupesBoth = document.getElementById('adminDupesBoth');

  let adminWhich = 'compliments';
  let adminIndex = 0;
  let adminPos = 0;               // markørens plads i det der vises (indeks — eller plads i begge lister)
  let adminShown = [];            // de pladser der er synlige i den filtrerede liste
  let adminScopeAt = null;        // sat når visningen spænder over begge lister
  let saveTimer = null;
  let findTimer = null;

  const nonEmpty = (arr) => arr.filter((it) => it.text.trim());
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function listNow() { return adminWhich === 'compliments' ? content.compliments : content.questions; }
  function status(msg) { adminStatus.textContent = msg; }

  // når man skriver i dublet-visningen, skal grupperne følge med — men først
  // når man holder en pause, så tastetrykkene ikke hakker
  let relistTimer = null;
  function relistSoon() {
    if (!adminDupes.checked) return;
    clearTimeout(relistTimer);
    relistTimer = setTimeout(function () { renderList(false); }, 700);
  }
  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      if (saveContent()) status('gemt i denne browser');
      else status('kunne ikke gemme her — hent data.js i stedet');
    }, 400);
  }

  /* ---------- dubletter: linjer der næsten siger det samme ----------
     Vi måler hvor mange af de samme to-bogstavs-par der er i de to linjer
     (Dice). Det fanger bøjninger, kommaer, store bogstaver og tastefejl
     som »i/I«. Ord der vender betydningen — »ikke«, »bedste/værste«,
     »mor/far« — holder vi udenfor, så modsatte spørgsmål ikke blandes.
     Forslaget til hvem der bliver er den pænest skrevne linje. */
  const DUPE_LEVELS = { sikker: 0.9, normal: 0.86, løs: 0.8 };
  const DUPE_GUARD = new Set(['ikke', 'værste', 'bedste', 'dårligste', 'svaghed',
    'styrke', 'afvist', 'fået', 'givet', 'mor', 'far', 'leve', 'dø', 'mørke', 'ondt', 'godt']);

  const dupeNorm = (s) => s.toLowerCase()
    .replace(/[«»“”„‘’'\u2026]/g, ' ')
    .replace(/[^a-zæøå0-9 ]/g, ' ')
    .replace(/\s+/g, ' ').trim();

  // hver linje bliver til mængden af sine to-bogstavs-par (uden gentagelser,
  // så signaturen nedenfor altid er et loft over ligheden)
  function dupeBigrams(text) {
    const t = dupeNorm(text).replace(/ /g, '');
    const out = new Set();
    for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
    return out;
  }

  /* Et hurtigt forfilter: hver linje får en signatur på 512 bit, hvor hvert
     to-bogstavs-par tænder sin egen plet. Antallet af fælles pletter er altid
     mindst lige så stort som antallet af fælles par, så vi kan afvise de par
     der umuligt kan ligne hinanden uden at regne efter. */
  const SIG_WORDS = 16;

  function popcount(v) {
    v = v - ((v >> 1) & 0x55555555);
    v = (v & 0x33333333) + ((v >> 2) & 0x33333333);
    return (((v + (v >> 4)) & 0x0f0f0f0f) * 0x01010101) >> 24;
  }

  function dupeSig(grams) {
    const sig = new Int32Array(SIG_WORDS);
    grams.forEach(function (g) {
      const h = (g.charCodeAt(0) * 131 + g.charCodeAt(1)) & 0x1ff;
      sig[h & (SIG_WORDS - 1)] |= 1 << ((h >> 4) & 31);
    });
    return sig;
  }

  function sigRelation(a, b) {
    let shared = 0;
    for (let w = 0; w < SIG_WORDS; w++) shared += popcount(a.sig[w] & b.sig[w]);
    return 2 * shared / (a.grams.size + b.grams.size);   // altid et loft over ligheden
  }

  // hvor mange af den ene linjes to-bogstavs-par findes i den anden (0 … 1)
  function dupeSim(a, b) {
    if (!a.grams.size || !b.grams.size) return 0;
    let hit = 0;
    a.grams.forEach(function (g) { if (b.grams.has(g)) hit++; });
    return 2 * hit / (a.grams.size + b.grams.size);
  }

  // vender de to linjer betydningen af hinanden? (så er de ikke dubletter)
  function dupeOpposite(a, b) {
    const A = dupeNorm(a).split(' '), B = dupeNorm(b).split(' ');
    for (let i = 0; i < A.length; i++) if (B.indexOf(A[i]) < 0 && DUPE_GUARD.has(A[i])) return true;
    for (let i = 0; i < B.length; i++) if (A.indexOf(B[i]) < 0 && DUPE_GUARD.has(B[i])) return true;
    return false;
  }

  // hvor pænt er linjen skrevet? bruges til at pege på den der bliver
  function tidyScore(it) {
    const t = it.text;
    let s = 0;
    if (/^[A-ZÆØÅ]/.test(t)) s += 4;                    // stort begyndelsesbogstav
    if (/[?.!]$/.test(t)) s += 4;                       // afsluttende tegn
    if (it.cat) s += 2;                                 // har kategori med
    if (it.by) s += 1;                                  // har ophav med
    if (/-$|[\u2026]$/.test(t)) s -= 1;                 // hænger i luften
    if (/\s\s|\s[,.?!;:]/.test(t)) s -= 3;              // sjusk med mellemrum
    if (/\bI\b/.test(t)) s -= 2;                        // gammel tastefejl: stort I midt i sætningen
    if (/[“”«»]/.test(t)) s += 1;                       // rigtige citationstegn
    return s;
  }

  function dupeGroupsOf(list, thr) {
    const items = list.map(function (it, i) {
      const grams = dupeBigrams(it.text);
      return { i: i, text: it.text, len: dupeNorm(it.text).length, grams: grams, sig: dupeSig(grams) };
    });
    const taken = new Set();
    const groups = [];
    for (let i = 0; i < items.length; i++) {
      if (taken.has(i)) continue;
      const a = items[i];
      const members = [a.i];
      const rel = [];
      for (let j = i + 1; j < items.length; j++) {
        if (taken.has(j)) continue;
        const b = items[j];
        const long = Math.max(a.len, b.len);
        if (!long) continue;
        if (Math.abs(a.len - b.len) / long > 0.4) continue;   // for forskellig længde til at ligne
        if (sigRelation(a, b) < thr) continue;                // kan umuligt ligne hinanden
        const sim = dupeSim(a, b);
        if (sim < thr) continue;
        if (dupeOpposite(a.text, b.text)) continue;
        members.push(b.i);
        rel.push(sim);
        taken.add(j);
      }
      if (members.length > 1) {
        taken.add(i);
        let best = members[0], bestScore = tidyScore(list[members[0]]);
        members.forEach(function (k) {
          const sc = tidyScore(list[k]);
          if (sc > bestScore) { best = k; bestScore = sc; }
        });
        groups.push({ items: members, keep: best, sim: Math.min.apply(null, rel) });
      }
    }
    return groups;
  }

  // grupperne regnes kun når listen er ændret eller følsomheden skiftet
  let dupeVersion = 0;
  let dupeCache = null;
  function contentTouched() { dupeVersion++; }

  function listOf(key) { return key === 'compliments' ? content.compliments : content.questions; }

  /* Hvilke linjer kigger vi på? Enten den ene liste — eller begge lagt sammen,
     så et kompliment og et spørgsmål, der er ved at blive ens, også bliver
     fanget. refs er selve linjerne; at siger hvilken liste og hvilket nummer
     hver linje kommer fra. */
  function dupeScope() {
    if (!adminDupesBoth.checked) {
      adminScopeAt = null;
      return { both: false, refs: listNow(), at: null, key: adminWhich };
    }
    const at = [];
    content.compliments.forEach(function (it, i) { at.push({ ref: it, list: 'compliments', i: i }); });
    content.questions.forEach(function (it, i) { at.push({ ref: it, list: 'questions', i: i }); });
    adminScopeAt = at;
    return { both: true, refs: at.map(function (e) { return e.ref; }), at: at, key: 'begge' };
  }

  // hvilken liste — og hvilket nummer i den — ligger på denne plads i visningen?
  function targetAt(pos) {
    if (adminScopeAt) {
      const e = adminScopeAt[pos];
      return e ? { list: e.list, i: e.i, it: e.ref } : null;
    }
    const list = listNow();
    return list[pos] ? { list: adminWhich, i: pos, it: list[pos] } : null;
  }

  // hvor i visningen står den post, vi er ved at redigere?
  function posOfCurrent() {
    if (!adminScopeAt) return adminIndex;
    for (let p = 0; p < adminScopeAt.length; p++) {
      const e = adminScopeAt[p];
      if (e.list === adminWhich && e.i === adminIndex) return p;
    }
    return -1;
  }

  function dupeGroups(scope) {
    const level = adminDupeSens.value || 'normal';
    const thr = DUPE_LEVELS[level] || DUPE_LEVELS.normal;
    const n = scope.both ? content.compliments.length + '|' + content.questions.length : '';
    const key = scope.key + '|' + level + '|' + dupeVersion + '|' + n;
    if (dupeCache && dupeCache.key === key) return dupeCache.groups;
    const groups = dupeGroupsOf(scope.refs, thr);
    dupeCache = { key: key, groups: groups };
    return groups;
  }

  function renderCounts() {
    adminCountC.textContent = content.compliments.length;
    adminCountQ.textContent = content.questions.length;
  }

  // når begge lister vises, kommer kategorierne også fra begge
  function catsSource() {
    if (adminDupes.checked && adminDupesBoth.checked) return content.compliments.concat(content.questions);
    return listNow();
  }

  // kategori-dropdown og forslagslisten under redigeringen
  function renderCats() {
    const list = catsSource();
    const counts = new Map();
    list.forEach(function (it) { const c = it.cat || ''; counts.set(c, (counts.get(c) || 0) + 1); });
    const names = Array.from(counts.keys()).sort(function (a, b) { return a.localeCompare(b, 'da'); });
    const keep = adminCat.value;
    adminCat.innerHTML = '<option value="">alle kategorier</option>' + names.map(function (name) {
      const value = name || '__tom';
      return '<option value="' + esc(value) + '">' + esc(name || 'uden kategori') + ' (' + counts.get(name) + ')</option>';
    }).join('');
    adminCat.value = names.some(function (n) { return (n || '__tom') === keep; }) ? keep : '';
    adminCats.innerHTML = names.filter(Boolean).map(function (n) { return '<option value="' + esc(n) + '"></option>'; }).join('');
  }

  function updateRow(i) {
    const list = listNow();
    const row = adminList.querySelector('.admin__item[data-i="' + i + '"]');
    if (!row || !list[i]) return;
    const span = row.querySelector('.admin__txt');
    if (span) span.textContent = list[i].text;
  }

  // filtrerer en post væk fra listen? (søgning og kategori)
  function hiddenByFilter(it, q, filter) {
    if (filter === '__tom') { if (it.cat) return true; }
    else if (filter && it.cat !== filter) return true;
    if (q && it.text.toLowerCase().indexOf(q) < 0) return true;
    return false;
  }

  function dupRow(it, pos, sug, scope) {
    const tag = scope.both && scope.at
      ? (scope.at[pos].list === 'compliments' ? 'kompliment' : 'spørgsmål') : '';
    return '<li class="admin__item' + (pos === adminPos ? ' is-sel' : '') + (sug ? ' is-sug' : '') +
           '" data-i="' + pos + '">' +
           (scope.both ? '' : '<span class="admin__num">' + (pos + 1) + '</span>') +
           '<span class="admin__txt">' + esc(it.text) + '</span>' +
           (it.cat ? '<b class="admin__chip">' + esc(it.cat) + '</b>' : '') +
           (scope.both ? '<b class="admin__chip admin__chip--from">' + tag + '</b>' : '') +
           (sug ? '<b class="admin__chip admin__chip--sug">forslag</b>' : '') +
           '<button type="button" class="admin__mini" data-keep="' + pos + '">behold</button>' +
           '</li>';
  }

  // listen vist som grupper af næsten ens poster, med et forslag i hver
  function renderDupes(scope, q, filter, scrollToSel) {
    const refs = scope.refs;
    const groups = dupeGroups(scope);
    const ready = groups.filter(function (g) {
      return g.items.filter(function (i) { return !hiddenByFilter(refs[i], q, filter); }).length > 1;
    });
    if (adminScopeAt) {
      const p = posOfCurrent();
      if (p >= 0) adminPos = p;
    }
    let html = '', shown = 0, spare = 0;
    adminShown = [];
    ready.forEach(function (g, n) {
      const items = g.items.filter(function (i) { return !hiddenByFilter(refs[i], q, filter); });
      const keep = items.indexOf(g.keep) >= 0 ? g.keep : items[0];
      const del = items.length - 1;
      spare += del;
      items.forEach(function (i) { adminShown.push(i); });
      shown += items.length;
      const where = scope.both
        ? (scope.at[keep].list === 'compliments' ? 'kompliment' : 'spørgsmål') : '';
      html += '<li class="admin__grp">' +
              '<div class="admin__grpTop">' +
                '<span class="admin__grpNum">gruppe ' + (n + 1) + '</span>' +
                '<span class="admin__grpN">' + items.length + ' poster der ligner hinanden' +
                  (where ? ' · forslaget er et ' + where : '') + '</span>' +
              '</div>' +
              '<button type="button" class="admin__mini admin__mini--wide" data-keep="' + keep + '">' +
                'behold forslaget · slet ' + (del === 1 ? 'den anden' : 'de ' + del + ' andre') +
              '</button>' +
              '<ul class="admin__grpList">' +
                items.map(function (i) { return dupRow(refs[i], i, i === keep, scope); }).join('') +
              '</ul>' +
              '</li>';
    });
    adminList.innerHTML = html || '<li class="admin__empty">ingen dubletter fundet — prøv en løsere søgning …</li>';
    const hvor = scope.both ? 'begge lister' : (adminWhich === 'compliments' ? 'komplimenter' : 'spørgsmål');
    adminListHint.textContent = (ready.length
      ? ready.length + ' grupper · ' + shown + ' poster af ' + refs.length + ' — forslagene sparer ' + spare + ' poster'
      : 'ingen dubletter fundet · ' + refs.length + ' poster') + ' · ' + hvor;
    adminDupeAll.hidden = !ready.length;
    adminDupeAll.textContent = 'behold forslaget i alle grupper · slet ' + spare;
    if (scrollToSel) {
      const sel = adminList.querySelector('.is-sel');
      if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: 'nearest' });
    }
  }

  function renderList(scrollToSel) {
    const q = adminSearch.value.trim().toLowerCase();
    const filter = adminCat.value;
    adminShown = [];
    adminDupeAll.hidden = true;
    if (adminDupes.checked) { renderDupes(dupeScope(), q, filter, scrollToSel); return; }
    adminScopeAt = null;
    adminPos = adminIndex;
    const list = listNow();
    let html = '';
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      if (hiddenByFilter(it, q, filter)) continue;
      adminShown.push(i);
      html += '<li class="admin__item' + (i === adminIndex ? ' is-sel' : '') + '" data-i="' + i + '">' +
              '<span class="admin__num">' + (i + 1) + '</span>' +
              '<span class="admin__txt">' + esc(it.text) + '</span>' +
              (it.cat ? '<b class="admin__chip">' + esc(it.cat) + '</b>' : '') +
              '</li>';
    }
    adminList.innerHTML = html || '<li class="admin__empty">intet at vise her</li>';
    adminListHint.textContent = adminShown.length + ' af ' + list.length + ' poster';
    if (scrollToSel) {
      const sel = adminList.querySelector('.is-sel');
      if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: 'nearest' });
    }
  }

  function renderEditor() {
    const list = listNow();
    const it = list[adminIndex];
    if (!it) {
      adminText.value = '';
      adminItemCat.value = '';
      adminBy.value = '';
      adminMeta.textContent = 'listen er tom';
      return;
    }
    adminText.value = it.text;
    adminItemCat.value = it.cat || '';
    adminBy.value = it.by || '';
    adminMeta.textContent = 'nr. ' + (adminIndex + 1) + ' af ' + list.length +
      ' · ' + it.text.length + ' tegn · ' + (it.cat || 'uden kategori') +
      (it.by ? ' · ' + it.by : '');
  }

  function markSelection(scroll) {
    const rows = adminList.children;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row.dataset || row.dataset.i == null) continue;
      const isSel = Number(row.dataset.i) === adminPos;
      row.classList.toggle('is-sel', isSel);
      if (isSel && scroll && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
    }
  }

  // skift fane uden at røre selve visningen (bruges når man klikker på en post fra den anden liste)
  function setTab(key) {
    if (adminWhich === key) return;
    adminWhich = key;
    Array.prototype.forEach.call(adminTabs.children, function (t) {
      t.classList.toggle('is-on', t.dataset.list === key);
    });
    renderCats();
  }

  // gå til en plads i visningen — også når den ligger i den anden liste
  function goTo(pos, scroll) {
    const t = targetAt(pos);
    if (!t) return;
    adminPos = pos;
    setTab(t.list);
    adminIndex = clamp(t.i, 0, listOf(t.list).length - 1);
    renderEditor();
    markSelection(scroll);
  }

  function choose(i, scroll) {
    const list = listNow();
    if (!list.length) return;
    adminIndex = clamp(i, 0, list.length - 1);
    adminPos = adminScopeAt ? posOfCurrent() : adminIndex;
    // står posten uden for et aktivt filter, så vis hele listen igen
    if (adminShown.indexOf(adminPos) < 0) {
      adminSearch.value = '';
      adminCat.value = '';
      adminDupes.checked = false;
      adminDupesBoth.checked = false;
      adminScopeAt = null;
      adminPos = adminIndex;
      renderList(false);
    }
    renderEditor();
    markSelection(scroll);
  }

  function step(dir) {
    flushEdit();
    const list = listNow();
    if (!list.length) return;
    const at = adminShown.indexOf(adminPos);
    let next;
    if (at >= 0 && adminShown[at + dir] != null) next = adminShown[at + dir];
    else next = adminPos + dir;
    const max = adminScopeAt ? adminScopeAt.length - 1 : list.length - 1;
    if (next < 0 || next > max) return;
    if (adminScopeAt) goTo(next, true);
    else choose(next, true);
  }

  // skriver feltet tilbage i listen og rydder op i mellemrum
  function flushEdit() {
    const it = listNow()[adminIndex];
    if (!it) return;
    const text = adminText.value.replace(/\s+/g, ' ').trim();
    const cat = adminItemCat.value.trim();
    const by = adminBy.value.trim();
    if (text === it.text && cat === it.cat && by === it.by) return;
    it.text = text;
    it.cat = cat;
    it.by = by;
    contentTouched();
    saveSoon();
    status('gemt i denne browser');
    updateRow(adminIndex);
    renderCats();
    renderEditor();
    renderList(false);            // teksten kan være kommet ud af en dublet-gruppe
  }

  // mens man skriver: opdatér straks, skriv til lageret lidt efter
  function liveEdit() {
    const it = listNow()[adminIndex];
    if (!it) return;
    it.text = adminText.value;
    contentTouched();
    relistSoon();
    saveSoon();
    status('gemmes …');
    updateRow(adminIndex);
    adminMeta.textContent = 'nr. ' + (adminIndex + 1) + ' af ' + listNow().length +
      ' · ' + it.text.length + ' tegn · ' + (it.cat || 'uden kategori');
  }

  function onMetaChange() {
    const it = listNow()[adminIndex];
    if (!it) return;
    it.cat = adminItemCat.value.trim();
    it.by = adminBy.value.trim();
    contentTouched();
    saveSoon();
    status('gemt i denne browser');
    renderCats();
    renderList(false);
    renderEditor();
  }

  function addAfter() {
    flushEdit();
    const list = listNow();
    const at = Math.min(adminIndex + 1, list.length);
    list.splice(at, 0, { text: '', cat: '', by: '' });
    adminIndex = at;
    contentTouched();
    renderCounts();
    renderEditor();
    renderList(false);
    adminText.focus();
    status('ny post — skriv teksten, den gemmes af sig selv');
  }

  function delItem() {
    const list = listNow();
    const it = list[adminIndex];
    if (!it) return;
    const shown = it.text.length > 90 ? it.text.slice(0, 90) + ' …' : it.text;
    if (!window.confirm('Slette denne post?\n\n' + (shown || '(tom)') + '\n\nDen kan ikke hentes tilbage, med mindre du nulstiller.')) return;
    list.splice(adminIndex, 1);
    if (adminIndex >= list.length) adminIndex = Math.max(0, list.length - 1);
    contentTouched();
    saveContent();
    renderCounts();
    renderCats();
    renderEditor();
    renderList(true);
    status('slettet');
  }

  /* ---------- dubletter: behold én, smid de andre væk ---------- */
  // sletter posterne og holder redigeringen på plads
  function dropTargets(targets) {
    const byList = { compliments: [], questions: [] };
    targets.forEach(function (t) { if (byList[t.list]) byList[t.list].push(t.i); });
    const cur = byList[adminWhich].slice().sort(function (a, b) { return a - b; });
    const shift = cur.filter(function (i) { return i < adminIndex; }).length;
    ['compliments', 'questions'].forEach(function (k) {
      const arr = listOf(k);
      byList[k].slice().sort(function (a, b) { return b - a; }).forEach(function (i) { arr.splice(i, 1); });
    });
    adminIndex = clamp(adminIndex - shift, 0, Math.max(0, listOf(adminWhich).length - 1));
    contentTouched();
    saveContent();
    renderCounts();
    renderCats();
    renderEditor();
    renderList(false);
  }

  // gruppen = de pladser der ligner hinanden; keep = den der bliver
  function keepOne(group, keep) {
    const t = targetAt(keep);
    if (!t) return;
    const del = group.filter(function (p) { return p !== keep; }).map(targetAt).filter(Boolean);
    if (!del.length) return;
    const one = del.length === 1 ? 'den anden' : 'de ' + del.length + ' andre';
    const vis = del.map(function (d) { return '· ' + d.it.text; }).join('\n');
    if (!window.confirm('Beholde:\n\n· ' + t.it.text + '\n\nog slette ' + one + '?\n\n' + vis +
        '\n\nDet kan ikke fortrydes, med mindre du nulstiller.')) return;
    dropTargets(del);
    status('beholdt · ' + del.length + ' ' + (del.length === 1 ? 'post slettet' : 'poster slettet'));
  }

  function keepAllSuggestions() {
    const scope = dupeScope();
    const groups = dupeGroups(scope);
    const q = adminSearch.value.trim().toLowerCase();
    const filter = adminCat.value;
    let dels = [];
    groups.forEach(function (g) {
      const items = g.items.filter(function (i) { return !hiddenByFilter(scope.refs[i], q, filter); });
      if (items.length < 2) return;
      const keep = items.indexOf(g.keep) >= 0 ? g.keep : items[0];
      items.filter(function (i) { return i !== keep; }).forEach(function (i) {
        const t = targetAt(i);
        if (t) dels.push(t);
      });
    });
    if (!dels.length) { status('der er ingen dubletter at rydde op i'); return; }
    if (!window.confirm('Beholde forslaget i ' + groups.length + ' grupper og slette ' + dels.length +
        ' poster?\n\nDet kan ikke fortrydes, med mindre du nulstiller.')) return;
    dropTargets(dels);
    status('ryddet op · ' + dels.length + ' poster slettet');
  }

  function resetAll() {
    if (!window.confirm('Nulstille alt indhold til standarden fra data.js?\n\nDine egne rettelser forsvinder.')) return;
    content.compliments = cloneList(DEFAULTS.compliments);
    content.questions = cloneList(DEFAULTS.questions);
    try { localStorage.removeItem(STORE_KEY); } catch (e) {}
    contentTouched();
    adminIndex = 0;
    adminPos = 0;
    adminScopeAt = null;
    adminSearch.value = '';
    adminCat.value = '';
    adminDupes.checked = false;
    adminDupesBoth.checked = false;
    renderCounts();
    renderCats();
    renderEditor();
    renderList(true);
    status('nulstillet til standarden');
  }

  // filen kan lægges ind i mappen i stedet for den gamle data.js
  function dataFileText() {
    const fmt = function (it) {
      const t = JSON.stringify(it.text);
      if (!it.cat && !it.by) return '  ' + t;
      return '  { text: ' + t + (it.cat ? ', cat: ' + JSON.stringify(it.cat) : '') +
             (it.by ? ', by: ' + JSON.stringify(it.by) : '') + ' }';
    };
    const block = function (name, arr) {
      return '  ' + name + ': [\n' + nonEmpty(arr).map(fmt).join(',\n') + '\n  ]';
    };
    return '/* Redigeret ' + new Date().toLocaleDateString('da-DK') + ' — læg filen i mappen i stedet for den gamle. */\n' +
           'window.DATA = {\n' + block('compliments', content.compliments) + ',\n' +
           block('questions', content.questions) + '\n};\n';
  }

  function downloadData() {
    flushEdit();
    saveContent();
    const blob = new Blob([dataFileText()], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'data.js';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
    status('data.js hentet — den lægges i mappen i stedet for den gamle');
  }

  // skriv brevet igen med det nye indhold
  function applyOnLetter() {
    flushEdit();
    saveContent();
    closeAdmin();
    hint.classList.add('is-gone');
    state.started = true;
    state.skip = false;
    state.typing = false;
    runToken++;                       // stop en runde der måtte køre
    lineDate.textContent = '';
    lineCompliment.textContent = '';
    lineQuestion.textContent = '';
    writing.classList.remove('is-shown');
    writing.hidden = true;
    tape.classList.remove('is-on');
    window.scrollTo(0, 0);
    runSequence();
  }

  function openAdmin() {
    if (!admin.hidden) return;
    admin.hidden = false;
    void admin.offsetHeight;      // genberegn, så toningen kommer med — og panelet altid står frem
    admin.classList.add('is-on');
    renderCounts();
    renderCats();
    renderEditor();
    renderList(true);
    status('rettelser gemmes af sig selv i denne browser');
  }

  function closeAdmin() {
    if (admin.hidden) return;
    flushEdit();
    admin.classList.remove('is-on');
    setTimeout(function () { admin.hidden = true; }, 200);
  }

  btnAdmin.addEventListener('click', openAdmin);
  document.getElementById('adminClose').addEventListener('click', closeAdmin);
  document.getElementById('adminClose2').addEventListener('click', closeAdmin);
  document.getElementById('adminPrev').addEventListener('click', function () { step(-1); });
  document.getElementById('adminNext').addEventListener('click', function () { step(1); });
  document.getElementById('adminNew').addEventListener('click', addAfter);
  document.getElementById('adminDel').addEventListener('click', delItem);
  document.getElementById('adminReset').addEventListener('click', resetAll);
  document.getElementById('adminDownload').addEventListener('click', downloadData);
  document.getElementById('adminApply').addEventListener('click', applyOnLetter);

  admin.addEventListener('click', function (e) { if (e.target === admin) closeAdmin(); });

  adminTabs.addEventListener('click', function (e) {
    const b = e.target.closest('.admin__tab');
    if (!b) return;
    flushEdit();
    adminWhich = b.dataset.list;
    adminIndex = 0;
    adminPos = 0;
    adminSearch.value = '';
    adminCat.value = '';
    Array.prototype.forEach.call(adminTabs.children, function (t) { t.classList.toggle('is-on', t === b); });
    renderCats();
    renderEditor();
    renderList(true);
  });

  adminList.addEventListener('click', function (e) {
    const keepBtn = e.target.closest('[data-keep]');
    if (keepBtn) {
      e.preventDefault();
      flushEdit();
      const keep = Number(keepBtn.dataset.keep);
      const scope = dupeScope();
      const groups = dupeGroups(scope);
      let group = null;
      groups.forEach(function (g) { if (!group && g.items.indexOf(keep) >= 0) group = g.items; });
      if (group) keepOne(group, keep);
      else { renderList(false); status('gruppen er ændret — se listen igen'); }
      return;
    }
    const row = e.target.closest('.admin__item');
    if (!row) return;
    flushEdit();
    const pos = Number(row.dataset.i);
    if (adminScopeAt) goTo(pos, false);
    else choose(pos, false);
  });

  adminSearch.addEventListener('input', function () {
    clearTimeout(findTimer);
    findTimer = setTimeout(function () { renderList(false); }, 140);
  });
  adminCat.addEventListener('change', function () { renderList(false); });
  adminDupes.addEventListener('change', function () { renderList(false); });
  adminDupesBoth.addEventListener('change', function () { renderCats(); renderList(false); });
  adminDupeSens.addEventListener('change', function () { renderList(false); });
  adminDupeAll.addEventListener('click', keepAllSuggestions);
  adminText.addEventListener('input', liveEdit);
  adminText.addEventListener('blur', flushEdit);
  adminItemCat.addEventListener('change', onMetaChange);
  adminBy.addEventListener('change', onMetaChange);

  // pil op/ned bladrer, når man ikke står i et felt
  admin.addEventListener('keydown', function (e) {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    if (e.key === 'ArrowDown') { step(1); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { step(-1); e.preventDefault(); }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !admin.hidden) { closeAdmin(); }
  });

  // hvis brugeren vender tilbage til fanen, og lyden er i gang
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && audio) audio.resume();
  });
})();
