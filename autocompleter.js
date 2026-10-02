// ==UserScript==
// @name         Lume - Sparx
// @namespace    local.sparx.tables.flow
// @version      1.4.1
// @description  Fast times-table keypad automation with a compact control panel.
// @match        https://maths.sparx-learning.com/*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  'use strict';
  if (document.getElementById('tables-flow')) return;

  // Solve a single multiplication/division equation, including missing operands.
  // No eval, answer-key extraction, or guessed answers.
  function solve(text) {
    const normalized = String(text).replace(/\[colour:[^\]]*\]/gi, '')
      .replace(/\{\?\}|□|▢|__/g, '?').replace(/[×xX*]/g, '×')
      .replace(/[÷/:]/g, '÷').replace(/\s+/g, '');
    const match = normalized.match(/^(\d+|\?)([×÷])(\d+|\?)=(\d+|\?)$/);
    if (!match || match.filter(x => x === '?').length !== 1) return null;
    const [, left, op, right, result] = match;
    const a = Number(left), b = Number(right), c = Number(result);
    let value;
    if (result === '?') value = op === '×' ? a * b : a / b;
    else if (left === '?') value = op === '×' ? c / b : c * b;
    else value = op === '×' ? c / a : a / c;
    // Ambiguous equations such as 0 × ? = 0 and division by zero are skipped.
    if (op === '÷' && right !== '?' && b === 0) return null;
    if (op === '÷' && right === '?' && value === 0) return null;
    return Number.isSafeInteger(value) && value >= 0 && value <= 100000 ? String(value) : null;
  }

  const storageKey = 'sparx-tables-flow-v1';
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch { /* storage optional */ }
  if (!saved || typeof saved !== 'object') saved = {};
  const state = {
    running: false, delay: [10, 120, 400].includes(saved.delay) ? saved.delay : 10,
    limit: [0, 10, 30, 100].includes(saved.limit) ? saved.limit : 0,
    count: 0, started: 0, elapsed: 0, framework: null, quiz: null,
    autoContinue: saved.autoContinue !== false,
    navigationPressed: new WeakSet(), navigationAt: -Infinity,
    navigationInfo: 'Waiting for game connection',
    question: null, seenAt: 0, submitted: null, pending: null,
    status: 'Open a times tables game', detail: 'Choose a game, then press Start.',
    importing: false, attempted: new Set(), error: '', collapsed: false,
    accent: /^#[0-9a-f]{6}$/i.test(saved.accent) ? saved.accent : '#4ade80',
    scale: Math.max(75, Math.min(130, Number(saved.scale) || 100)),
    opacity: Math.max(70, Math.min(100, Number(saved.opacity) || 96)),
    dock: ['bottom-right', 'top-right', 'bottom-left', 'top-left'].includes(saved.dock) ? saved.dock : 'bottom-right',
  };
  const host = document.createElement('div');
  host.id = 'tables-flow';
  host.style.cssText = 'position:fixed;right:22px;bottom:22px;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      :host{all:initial;color:#e6e6e6;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;font-size:12px;color-scheme:dark}
      *{box-sizing:border-box}button,input,select{font:inherit}button{cursor:pointer}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
      .panel{--accent:#4ade80;width:350px;max-width:calc(100vw - 40px);background:#0f0f0f;border:1px solid #262626;border-radius:12px;box-shadow:0 12px 40px #000b;overflow:hidden}
      header{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:#161616;border-bottom:1px solid #262626;font-weight:600;font-size:12px;letter-spacing:.3px;cursor:move;touch-action:none;user-select:none}
      .icon{background:none;border:none;color:#888;font-size:16px;line-height:1;padding:0 4px}main{padding:12px 14px 14px;max-height:calc(100vh - 90px);overflow:auto}
      .status{font-size:11.5px;color:#999;margin-bottom:10px;min-height:15px}.running .status{color:var(--accent)}
      .stat{display:flex;justify-content:space-between;font-size:11px;color:#777;margin-bottom:6px;gap:8px}.stat span:last-child{color:#ddd;font-weight:600;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:230px;font-family:ui-monospace,Menlo,monospace}
      .progress{display:flex;align-items:center;gap:8px;margin:10px 0 12px}.bar{flex:1;height:4px;background:#232323;border-radius:99px;overflow:hidden}.fill{height:100%;width:0%;background:var(--accent);border-radius:99px;transition:width .2s}.progress span{font-size:11px;color:#666;min-width:20px;text-align:right}
      .label{display:flex;justify-content:space-between;font-size:10.5px;color:#999;margin:10px 0 6px}.speeds{display:flex;gap:6px;margin-bottom:10px}.speeds button{flex:1;padding:6px;background:#191919;border:1px solid #333;border-radius:6px;color:#888;font-size:10.5px}.speeds button[aria-pressed=true]{color:var(--accent);border-color:var(--accent);background:#161c17}
      select{background:#111;color:#ddd;border:1px solid #333;border-radius:5px;padding:5px 7px;font-size:10.5px}#limit{width:100%;margin-bottom:10px}
      .option{display:flex;align-items:center;gap:5px;margin:0 0 10px;color:#999;font-size:10.5px;cursor:pointer}.option input{margin:0;accent-color:var(--accent)}
      details{margin:0 0 10px;color:#aaa;font-size:10.5px}summary{cursor:pointer}.custom{display:flex;flex-wrap:wrap;gap:7px;margin-top:8px}.custom label{display:flex;align-items:center;gap:4px}.custom input[type=range]{width:65px;accent-color:var(--accent)}.custom input[type=color]{width:25px;height:20px;padding:1px;border:1px solid #333;background:#111}.custom select{max-width:110px}
      .actions{display:flex;gap:8px;margin-bottom:10px}.primary{flex:1;padding:9px 0;background:#fff;color:#0a0a0a;border:none;border-radius:7px;font-size:12px;font-weight:600;transition:opacity .15s}.primary:hover{opacity:.85}.running .primary{background:var(--accent);color:#062a14}.ghost{background:transparent;color:#888;border:1px solid #333;border-radius:7px;flex:0 0 40px;font-size:14px}.ghost:hover{color:#ccc;border-color:#555}
      .detail{max-height:100px;overflow-y:auto;font-size:10.5px;color:#666;line-height:1.55;font-family:ui-monospace,Menlo,monospace;white-space:pre-wrap;word-break:break-word;user-select:text}.error{color:#ff5c5c}.running .detail{color:var(--accent)}footer{font-size:9px;color:#555;margin-top:9px;display:flex;justify-content:space-between}.collapsed main{display:none}.collapsed header{border-bottom:0}
    </style>
    <section class="panel" aria-label="Lume times tables automation">
      <header id="drag"><span>Lume Autocompleter</span><button class="icon" id="collapse" aria-label="Collapse panel">–</button></header>
      <main>
        <div class="status" id="status" role="status">Idle</div>
        <div class="stat"><span>Mode</span><span id="mode">Times tables</span></div>
        <div class="stat"><span>Prompt</span><span id="question">—</span></div>
        <div class="stat"><span>Target</span><span id="target">—</span></div>
        <div class="stat"><span>Answered</span><span id="count">0</span></div>
        <div class="stat"><span>Active time</span><span id="time">0:00</span></div>
        <div class="progress"><div class="bar"><div class="fill" id="fill"></div></div><span id="progress">0</span></div>
        <div class="label">Response speed <span id="delay">10 ms</span></div>
        <div class="speeds" role="group" aria-label="Response speed"><button data-delay="10">Turbo</button><button data-delay="120">Fast</button><button data-delay="400">Steady</button></div>
        <label class="label" for="limit">Pause after</label><select id="limit"><option value="0">Until I pause</option><option value="10">10 answers</option><option value="30">30 answers</option><option value="100">100 answers</option></select>
        <label class="option"><input id="auto-continue" type="checkbox" checked> Auto start / continue / play again</label>
        <details><summary>Customize UI</summary><div class="custom">
          <label>Accent <input id="accent" type="color" value="#4ade80"></label>
          <label>Size <input id="scale" type="range" min="75" max="130" value="100"></label>
          <label>Opacity <input id="opacity" type="range" min="70" max="100" value="96"></label>
          <label>Corner <select id="dock"><option value="bottom-right">Bottom right</option><option value="top-right">Top right</option><option value="bottom-left">Bottom left</option><option value="top-left">Top left</option></select></label>
        </div></details>
        <div class="actions"><button class="primary" id="toggle">Start</button><button class="ghost" id="reset" aria-label="Reset session" title="Reset session">↺</button></div>
        <div class="detail" id="detail"></div>
        <footer><span>Alt + Shift + T · start / pause</span><span>v1.4.1</span></footer>
      </main>
    </section>`;
  document.documentElement.append(host);
  const $ = id => root.getElementById(id);
  function save() {
    try { localStorage.setItem(storageKey, JSON.stringify({ delay: state.delay, limit: state.limit,
      accent: state.accent, scale: state.scale, opacity: state.opacity, dock: state.dock, autoContinue: state.autoContinue })); } catch { /* optional */ }
  }
  function appearance(redock = false) {
    root.querySelector('.panel').style.setProperty('--accent', state.accent);
    root.querySelector('.panel').style.zoom = String(state.scale / 100);
    host.style.opacity = String(state.opacity / 100);
    if (redock) {
      host.style.left = state.dock.endsWith('left') ? '20px' : 'auto';
      host.style.right = state.dock.endsWith('right') ? '20px' : 'auto';
      host.style.top = state.dock.startsWith('top') ? '20px' : 'auto';
      host.style.bottom = state.dock.startsWith('bottom') ? '20px' : 'auto';
    }
  }
  for (const name of ['accent', 'scale', 'opacity', 'dock']) {
    $(name).value = String(state[name]);
    $(name).oninput = () => {
      state[name] = name === 'scale' || name === 'opacity' ? Number($(name).value) : $(name).value;
      appearance(name === 'dock'); save();
    };
  }
  appearance(true);
  $('drag').onpointerdown = event => {
    if (event.button !== 0 || event.target.closest('button')) return;
    const rect = host.getBoundingClientRect();
    const offsetX = event.clientX - rect.left, offsetY = event.clientY - rect.top;
    const move = event => {
      const bounds = host.getBoundingClientRect();
      host.style.left = `${Math.max(0, Math.min(window.innerWidth - bounds.width, event.clientX - offsetX))}px`;
      host.style.top = `${Math.max(0, Math.min(window.innerHeight - bounds.height, event.clientY - offsetY))}px`;
      host.style.right = 'auto'; host.style.bottom = 'auto';
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    event.preventDefault();
  };
  function render() {
    root.querySelector('.panel').classList.toggle('running', state.running);
    $('status').textContent = state.status;
    $('detail').textContent = state.error || state.detail;
    $('detail').classList.toggle('error', Boolean(state.error));
    $('question').textContent = state.question ? String(state.question.questionText).replace(/\[colour:[^\]]*\]/gi, '') : '—';
    $('count').textContent = state.count;
    const seconds = Math.floor((state.elapsed + (state.running ? performance.now() - state.started : 0)) / 1000);
    $('time').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    $('toggle').textContent = state.running ? 'Pause' : 'Start';
    $('target').textContent = state.question ? solve(state.question.questionText) ?? '—' : '—';
    $('mode').textContent = state.framework?.gameViewId || 'Times tables';
    $('progress').textContent = state.limit ? `${state.count}/${state.limit}` : String(state.count);
    $('fill').style.width = state.limit ? `${Math.min(100, state.count / state.limit * 100)}%` : '0%';
    $('delay').textContent = `${state.delay} ms`;
    root.querySelectorAll('[data-delay]').forEach(el => el.setAttribute('aria-pressed', String(Number(el.dataset.delay) === state.delay)));
    $('limit').value = String(state.limit);
  }
  function pause(message = 'Paused') {
    if (state.running) state.elapsed += performance.now() - state.started;
    state.running = false; state.status = message; render();
  }
  function toggle() {
    if (state.running) return pause();
    state.running = true; state.started = performance.now(); state.error = '';
    state.status = 'Waiting for a question'; render();
  }
  $('toggle').onclick = toggle;
  $('reset').onclick = () => { pause('Session reset'); state.count = 0; state.elapsed = 0; render(); };
  $('auto-continue').checked = state.autoContinue;
  $('auto-continue').onchange = () => { state.autoContinue = $('auto-continue').checked; save(); };
  $('collapse').onclick = () => {
    state.collapsed = !state.collapsed;
    root.querySelector('.panel').classList.toggle('collapsed', state.collapsed);
    $('collapse').textContent = state.collapsed ? '+' : '−';
    $('collapse').setAttribute('aria-label', state.collapsed ? 'Expand panel' : 'Collapse panel');
  };
  root.querySelectorAll('[data-delay]').forEach(el => { el.onclick = () => { state.delay = Number(el.dataset.delay); save(); render(); }; });
  $('limit').onchange = () => { state.limit = Number($('limit').value); save(); render(); };
  // Capture on window before the game's document keyboard listener.
  window.addEventListener('keydown', event => {
    if (event.altKey && event.shiftKey && event.code === 'KeyT' && !event.repeat) {
      event.preventDefault(); event.stopImmediatePropagation(); toggle();
    } else if (event.composedPath().includes(host)) event.stopPropagation();
  }, true);

  // Import the exact module already loaded by Sparx, retaining its singleton.
  // Asset hashes and export names may change, so detect the framework by shape.
  async function connect() {
    if (state.framework || state.importing) return;
    const urls = new Set(performance.getEntriesByType('resource').map(entry => entry.name));
    document.querySelectorAll('script[src],link[rel="modulepreload"][href]').forEach(el => urls.add(el.src || el.href));
    const candidates = [...urls].filter(url => {
      try { return /^game-framework-[^/]+\.js$/.test(new URL(url).pathname.split('/').pop()); } catch { return false; }
    });
    state.importing = true;
    try {
      for (const url of candidates) {
        if (state.attempted.has(url)) continue;
        state.attempted.add(url);
        try {
          const exports = await import(url);
          const framework = Object.values(exports).find(value => value && typeof value === 'object' &&
            typeof value.addKeypressListener === 'function' && typeof value.initialise === 'function' && typeof value.onKeyDown === 'function');
          if (framework) { state.framework = framework; state.error = ''; break; }
        } catch (error) {
          state.error = 'Connection blocked. Enable Tampermonkey page execution, then reload.';
          console.warn('[Lume] Module connection failed:', error);
        }
      }
      if (candidates.length && !state.framework && !state.error) state.error = 'This game build has a different interface. The userscript needs an update.';
    } finally { state.importing = false; }
  }
  function equationKey(text) {
    return String(text ?? '').replace(/\[colour:[^\]]*\]/gi, '').replace(/[×xX*]/g, '×')
      .replace(/[÷/:]/g, '÷').replace(/\{\?\}|□|▢|__/g, '?').replace(/\s+/g, '');
  }
  const delegate = {
    onQuestionBegan() { state.question = null; },
    onQuestionProcessed(result) {
      const pending = state.pending;
      if (!pending || pending.quiz !== state.quiz || String(result.inputString).trim() !== pending.answer) return;
      const sameQuestion = pending.question.questionId && result.questionId
        ? pending.question.questionId === result.questionId
        : equationKey(result.questionText) === equationKey(pending.question.questionText);
      if (!sameQuestion) return;
      state.pending = null;
      if (result.correct && !result.timedOut) {
        state.count++;
        if (state.limit && state.count >= state.limit) pause('Answer limit reached');
      } else { state.error = 'The game rejected an answer; automation paused.'; pause('Check the game'); }
      render();
    },
    onConnectionFailed() { state.error = 'The game reported a connection error.'; pause('Connection interrupted'); },
  };
  function attachQuiz() {
    const quiz = state.framework?.Quiz;
    if (quiz === state.quiz) {
      if (quiz && Array.isArray(quiz.delegates) && !quiz.delegates.includes(delegate)) quiz.addDelegate(delegate);
      return;
    }
    state.quiz?.removeDelegate?.(delegate);
    state.quiz = quiz || null;
    state.question = null; state.submitted = null; state.pending = null;
    state.quiz?.addDelegate?.(delegate);
  }
  function findHolder(quiz) {
    // The exported keypad delegate owns the active holder, even in canvas views.
    for (const item of quiz.delegates || []) {
      const holder = item.keypadHolder;
      if (holder && holder.CYPRESS_isActive === true && !holder.dismissed && !holder.keypad?.dismissed &&
          typeof holder.keypad?.processButtonPress === 'function' && typeof holder.onSubmitAnswer === 'function') return holder;
    }
    return null;
  }
  function pressNavigation(framework) {
    if (!state.autoContinue || state.pending || framework.gameViewId !== '100club' || framework.Scene?.alertLayer?.activeAlert ||
        (state.quiz?.currentQuestion && state.quiz?.timer?.active) ||
        performance.now() - state.navigationAt < 500) return false;
    const scene = framework.Scene?.activeScene;
    if (!scene) return false;
    // Confirmed by live button dumps: titleLayer owns Start quiz, statusLayer
    // owns the round Continue button. Inspect these before the scene tree.
    const layers = [scene.titleLayer, scene.statusLayer, scene.resultsLayer, scene]
      .filter(layer => layer && !layer.toRemove && !layer.destroyed && layer.visible !== false && layer.alpha !== 0);
    const queue = [scene], seen = new Set();
    // Search only the current scene. Old scenes and overlay alerts are excluded.
    while (queue.length && seen.size < 300) {
      const node = queue.shift();
      if (!node || seen.has(node) || node.toRemove || node.destroyed || node.visible === false || node.alpha === 0) continue;
      seen.add(node);
      if (typeof node.getBanner === 'function' && !layers.includes(node)) layers.push(node);
      if (Array.isArray(node.children)) queue.push(...node.children);
    }
    for (const key of ['continueButton', 'nextScreenButton', 'playAgainButton', 'playButton']) {
      for (const layer of layers) {
        const button = typeof layer.getBanner === 'function' ? layer.getBanner(key) : layer.activeBanners?.[key];
        if (!button || state.navigationPressed.has(button) || button.dismissed || button.toRemove || button.destroyed ||
            button.CYPRESS_appeared !== true || button.eventMode !== 'dynamic' ||
            typeof button.eventCallbacks?.clicked !== 'function' ||
            typeof button.isMoving !== 'function' || button.isMoving()) continue;
        let visible = true;
        for (let node = button; node; node = node.parent) {
          if (node.visible === false || node.alpha === 0 || node.toRemove || node.destroyed) { visible = false; break; }
        }
        if (!visible || button.worldVisible === false || button.worldAlpha === 0) continue;
        state.navigationPressed.add(button);
        state.navigationAt = performance.now();
        state.status = key === 'playButton' ? 'Starting quiz' : key === 'playAgainButton' ? 'Playing again' : 'Continuing round';
        state.detail = `Pressed ${button.text || button.textNode?.text || key}. Waiting for the next question.`;
        // Invoke the captured clicked action directly. fireEvent has a per-frame
        // duplicate flag; the live handler itself performs the movement check.
        button.eventCallbacks.clicked();
        const accepted = button.eventMode !== 'dynamic' || button.dismissed || button.toRemove ||
          framework.Scene?.activeScene !== scene;
        state.navigationInfo = `${key}: ${accepted ? 'accepted' : 'no state change'}`;
        console.info('[Lume navigation]', state.navigationInfo);
        if (!accepted) {
          state.error = `${key} did not deactivate after its click action. Copy Lume.status() from DevTools.`;
          pause('Button action unconfirmed');
        }
        render();
        return true;
      }
    }
    return false;
  }
  window.Lume = {
    status() {
      const framework = state.framework, scene = framework?.Scene?.activeScene;
      const inspect = (layer, key) => {
        const button = layer?.getBanner?.(key) || layer?.activeBanners?.[key];
        return button ? { found: true, visible: button.visible, worldVisible: button.worldVisible,
          appeared: button.CYPRESS_appeared, eventMode: button.eventMode, dismissed: button.dismissed,
          moving: button.isMoving?.(), clickedHandler: typeof button.eventCallbacks?.clicked } : { found: false };
      };
      return { version: '1.4.1', running: state.running, autoContinue: state.autoContinue,
        connected: Boolean(framework), game: framework?.gameViewId, phase: framework?.lastGamePhase,
        pendingAnswer: Boolean(state.pending), timerActive: state.quiz?.timer?.active,
        answered: state.count,
        lastNavigation: state.navigationInfo, error: state.error,
        startQuiz: inspect(scene?.titleLayer, 'playButton'),
        continue: inspect(scene?.statusLayer, 'continueButton') };
    },
  };
  function tick() {
    attachQuiz();
    if (!state.running) return;
    if (state.limit && state.count >= state.limit) return pause('Answer limit reached');
    if (state.pending && performance.now() - state.pending.time > 5000) {
      state.error = 'No answer confirmation arrived. Check the game before restarting.';
      return pause('Confirmation timed out');
    }
    const framework = state.framework, quiz = state.quiz, question = quiz?.currentQuestion;
    if (!framework?.asyncSessionId || framework.viewLocked || framework.showingEndGameAlert || quiz?.quittingToMenu) {
      state.status = 'Waiting for the game';
      state.detail = 'Start or continue the game in Sparx.'; return;
    }
    if (pressNavigation(framework)) return;
    if (!question) {
      state.question = null;
      state.status = 'Waiting for the next round';
      state.detail = state.autoContinue ? 'Watching for Start, Continue, or Play Again.' : 'Start or continue the game in Sparx.';
      return;
    }
    if (question !== state.question) { state.question = question; state.seenAt = performance.now(); }
    if (question === state.submitted || state.pending) return;
    const answer = solve(question.questionText);
    if (question.deliveryMechanism?.type !== 'basicKeypad' || answer === null || quiz.flagForCorrectionPhase) {
      state.status = 'Manual step needed'; state.detail = 'Complete this activity; automation resumes on a times-table question.'; return;
    }
    const holder = findHolder(quiz);
    if (!quiz.timer?.active || !holder || holder.questionState?.question !== question.questionText) {
      state.status = 'Waiting for the keypad'; return;
    }
    state.status = 'Automation running'; state.detail = `${question.questionText}  →  ${answer}`;
    if (performance.now() - state.seenAt < state.delay) return;
    // Clear existing partial input through normal keypad actions before typing.
    const previous = String(holder.string || '');
    if (previous.length > 100) throw new Error('Unexpected keypad input length');
    for (let i = 0; i < previous.length; i++) holder.keypad.processButtonPress('<');
    for (const char of answer) holder.keypad.processButtonPress(char);
    if (holder.string !== answer) throw new Error('Keypad did not accept the calculated answer');
    state.submitted = question;
    state.pending = { quiz, question, answer, time: performance.now() };
    holder.keypad.processButtonPress('OK');
  }
  let nextConnect = 0, nextRender = 0, disposed = false;
  async function loop() {
    if (disposed) return;
    try {
      if (!state.framework && performance.now() >= nextConnect) {
        nextConnect = performance.now() + 1500; await connect();
      }
      tick();
    } catch (error) {
      state.error = error.message || 'Unexpected game interface error'; pause('Automation stopped');
      console.warn('[Lume]', error);
    }
    if (performance.now() >= nextRender) { render(); nextRender = performance.now() + 200; }
    setTimeout(loop, state.running ? Math.min(25, state.delay) : 400);
  }
  window.addEventListener('pagehide', () => { disposed = true; state.quiz?.removeDelegate?.(delegate); }, { once: true });
  window.addEventListener('pageshow', event => { if (event.persisted) { disposed = false; pause(); loop(); } });
  render(); loop();
})();
