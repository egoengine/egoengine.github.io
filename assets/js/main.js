  /* ============= HERO (light-load + per-tile sync) ============= */
  const HERO_CROPPED = 'videos/blending/human/A.mp4';
  const HERO_INPAINTED = 'videos/blending/human/B.mp4';

  // HERO 专用懒加载观察器（只负责把 data-src → src）
  const heroLazyObserver = ('IntersectionObserver' in window) ? new IntersectionObserver((entries)=>{
    entries.forEach(entry=>{
      const v = entry.target;
      if (entry.isIntersecting && v.dataset.src && !v.src){
        v.src = v.dataset.src;
        v.load();
        if (v.autoplay) v.play().catch(()=>{});
        heroLazyObserver.unobserve(v);
      }
    });
  }, { rootMargin: '200px 0px' }) : null;

  // 小工具：创建轻载入视频（HERO 版）
  function makeHeroLazyVideo(src, cls, opts = {}){
    const { loop = true } = opts;
    const v = document.createElement('video');
    v.className = cls || '';
    v.autoplay = true; v.loop = loop; v.muted = true; v.playsInline = true;
    v.setAttribute('muted',''); v.setAttribute('playsinline','');
  v.preload = 'none';         // 严格懒加载：不预取视频数据
    v.controls = false;
    v.dataset.src = src;        // 等 observer 挂上
    if (heroLazyObserver) heroLazyObserver.observe(v); else { v.src = src; }
    if (loop){
      v.addEventListener('ended', () => { v.currentTime = 0; v.play().catch(()=>{}); });
    }
    return v;
  }

  // === REPLACE your entire SyncGroup with this one-shot version ===
class SyncGroup {
  constructor(clock){
    this.clock = clock;
    this.members = new Set();

    // 仅传播 播放/暂停/倍速，不再做任何时间对齐
    clock.addEventListener('play',  () => this._propagatePlay(true));
    clock.addEventListener('pause', () => this._propagatePlay(false));
    clock.addEventListener('ratechange', () => this._propagateRate());
  }

  add(v){
    if (!v || v === this.clock || this.members.has(v)) return;
    this.members.add(v);

    // 成员自身循环，不做时间对齐
    v.addEventListener('ended', ()=>{
      v.currentTime = 0;
      v.play().catch(()=>{});
    });
  }

  // 兼容现有调用：禁用强同步（不做任何 currentTime 调整）
  resyncMember(_v){}

  _propagatePlay(playing){
    this.members.forEach(v => playing ? v.play().catch(()=>{}) : v.pause());
  }

  _propagateRate(){
    this.members.forEach(v => v.playbackRate = this.clock.playbackRate);
  }
}

// === Tight sync group (per-frame alignment for 3-video TACO sets) ===
class TightSyncGroup {
  constructor(clock){
    this.clock = clock;
    this.members = new Set();
    this._syncing = false;
    clock.addEventListener('play', ()=> this._propagatePlay(true));
    clock.addEventListener('pause', ()=> this._propagatePlay(false));
    clock.addEventListener('ratechange', ()=> this._propagateRate());
    clock.addEventListener('ended', ()=> this.resetAll());
  }

  add(v){
    if (!v || v === this.clock || this.members.has(v)) return;
    this.members.add(v);
    v.addEventListener('loadeddata', ()=> this.resetAll(), { once:true });
  }

  _propagateRate(){
    this.members.forEach(v => v.playbackRate = this.clock.playbackRate);
  }

  _propagatePlay(playing){
    this.members.forEach(v => playing ? v.play().catch(()=>{}) : v.pause());
  }

  resetAll(){
    if (this._syncing) return;
    this._syncing = true;
    const toStart = (v)=>{
      try{ v.currentTime = 0; }catch(_){ }
      v.playbackRate = this.clock.playbackRate;
      if (!this.clock.paused){ v.play().catch(()=>{}); }
      else { v.pause(); }
    };
    toStart(this.clock);
    this.members.forEach(toStart);
    this._syncing = false;
  }

  // Backward-compatible API: old callsites may still use syncAll(...)
  syncAll(forcePlay = false){
    this.resetAll();
    if (forcePlay){
      this.clock.play().catch(()=>{});
      this.members.forEach(v => v.play().catch(()=>{}));
    }
  }
}


  const stage = document.getElementById('stage');
  const heroCanvas  = document.getElementById('heroCanvas');

  (function buildHero(){
    const pair = document.createElement('div'); pair.className = 'hero-pair';
    const base = makeHeroLazyVideo(HERO_INPAINTED, 'base', { loop:false });
    const over = makeHeroLazyVideo(HERO_CROPPED,   'overlay', { loop:false });
    pair.append(base, over);
    heroCanvas.appendChild(pair);

    let restarting = false;
    let lastRestartAt = -1;
    const restartPair = ()=>{
      const now = performance.now();
      if (lastRestartAt > 0 && (now - lastRestartAt) < 200) return;
      lastRestartAt = now;
      if (restarting) return;
      restarting = true;
      [base, over].forEach(v=>{
        try { v.currentTime = 0; } catch(_){}
      });
      base.play().catch(()=>{});
      over.play().catch(()=>{});
      restarting = false;
    };
    // No frame-by-frame sync. Only re-align both streams at loop boundaries.
    base.addEventListener('ended', restartPair);
    over.addEventListener('ended', restartPair);

    const startTogether = ()=>{
      if (base.readyState >= 2 && over.readyState >= 2) restartPair();
    };
    base.addEventListener('loadeddata', startTogether, { once:true });
    over.addEventListener('loadeddata', startTogether, { once:true });

    requestAnimationFrame(()=>{ updateDivider(); updateClips(); updatePlayback(); });
  })();

  // HERO 的分割线 & 解码负载控制（保持你的逻辑）
  let cutX = Math.round(window.innerWidth * 0.5);
  function updateDivider(){ stage.style.setProperty('--divider-x', cutX + 'px'); }
  function updateClips(){
    document.querySelectorAll('.hero-pair').forEach(pair=>{
      const r = pair.getBoundingClientRect();
      const local = Math.max(0, Math.min(r.width, cutX - r.left));
      pair.style.setProperty('--cut', local + 'px');
    });
  }
  function setPlaying(v, shouldPlay){ if (!v) return; shouldPlay ? v.play().catch(()=>{}) : v.pause(); }
  function updatePlayback(){
    document.querySelectorAll('.hero-pair').forEach(pair=>{
      const base = pair.querySelector('video.base');
      const over = pair.querySelector('video.overlay');
      const r = pair.getBoundingClientRect();
      const cutLocal = Math.max(0, Math.min(r.width, cutX - r.left));
      setPlaying(over, cutLocal > 0);
      setPlaying(base, cutLocal < r.width);
    });
  }
  function setCutFrom(x){
    const bounds = stage.getBoundingClientRect();
    const clamped = Math.max(bounds.left, Math.min(bounds.right, x));
    cutX = clamped; updateDivider(); updateClips(); updatePlayback();
  }
  stage.addEventListener('mousemove', e => setCutFrom(e.clientX));
  stage.addEventListener('touchstart', e => e.touches[0] && setCutFrom(e.touches[0].clientX), {passive:true});
  stage.addEventListener('touchmove',  e => e.touches[0] && setCutFrom(e.touches[0].clientX), {passive:true});
  window.addEventListener('resize', () => { updateDivider(); updateClips(); updatePlayback(); });
  document.addEventListener('visibilitychange', ()=>{ if (!document.hidden) document.querySelectorAll('video').forEach(v=> v.play().catch(()=>{})); });

  /* ============= NEW: Real-World Tasks ============= */
  const ROOT_ROBOT = 'videos/blending'; // base
  const TASKS = [
    { key:'mustard', label:'Mustard', ids:[1,2,3,4] },
    { key:'drawer',  label:'Drawer',  ids:[1,2,3,4] },
  ];

  const TACO_SAMPLES = [
    { task: '(brush, brush, bowl)', base: 'videos/taco/(brush, brush, bowl)/20230927_027' },
    { task: '(brush, brush, box)', base: 'videos/taco/(brush, brush, box)/20231005_200' },
    { task: '(brush, brush, plate)', base: 'videos/taco/(brush, brush, plate)/20230927_025' },
    { task: '(brush, brush, teapot)', base: 'videos/taco/(brush, brush, teapot)/20231006_175' },
    { task: '(brush, eraser, plate)', base: 'videos/taco/(brush, eraser, plate)/20231027_045' },
    { task: '(brush, roller, box)', base: 'videos/taco/(brush, roller, box)/20231013_304' },
    { task: '(cut, knife, bowl)', base: 'videos/taco/(cut, knife, bowl)/20231020_254' },
    { task: '(cut, knife, plate)', base: 'videos/taco/(cut, knife, plate)/20230926_040' },
    { task: '(empty, cup, plate)', base: 'videos/taco/(empty, cup, plate)/20230928_031' },
    { task: '(empty, plate, cup)', base: 'videos/taco/(empty, plate, cup)/20230928_033' },
    { task: '(empty, plate, teapot)', base: 'videos/taco/(empty, plate, teapot)/20230927_046' },
    { task: '(pour in some, plate, cup)', base: 'videos/taco/(pour in some, plate, cup)/20230928_032' },
    { task: '(put in, bowl, plate)', base: 'videos/taco/(put in, bowl, plate)/20231024_253' },
    { task: '(scrape off, knife, plate)', base: 'videos/taco/(scrape off, knife, plate)/20230926_034' },
  ];

  const ARIA_SAMPLES = [
    { task: 'Drawer', base: 'videos/aria/drawer' },
    { task: 'Flower', base: 'videos/aria/flower' },
    { task: 'Hammer', base: 'videos/aria/hammer' },
    { task: 'Mustard', base: 'videos/aria/mustard' },
  ];

  // —— 懒加载观察器（任务区）——
  const lazyObserver = ('IntersectionObserver' in window) ? new IntersectionObserver((entries)=>{
    entries.forEach(entry=>{
      const v = entry.target;
      if (entry.isIntersecting && v.dataset.src && !v.src){
        v.src = v.dataset.src;
        v.load();
        if (v.autoplay) v.play().catch(()=>{});
        lazyObserver.unobserve(v);
      }
    });
  }, { rootMargin: '200px 0px' }) : null;

  // —— 视口播放/暂停（任务区）——
  const playObserver = ('IntersectionObserver' in window) ? new IntersectionObserver((entries)=>{
    entries.forEach(entry=>{
      const v = entry.target;
      if (!v) return;
      if (entry.isIntersecting){
        const group = v.closest('.card')?.syncGroup;
        if (group) group.resyncMember(v); // 进入视口时对齐时间戳
        if (v.autoplay) v.play().catch(()=>{});
      } else {
        v.pause();
      }
    });
  }, { threshold: 0.2 }) : null;

  // 任务区视频：统一懒加载 & 出视口暂停
  function makeLazyVideo(src, cls, role, demoId){
    const v = document.createElement('video');
    v.className = cls || '';
    v.dataset.role = role || '';
    v.dataset.demoId = demoId || '';
    v.muted = true; v.autoplay = true; v.loop = true; v.playsInline = true;
    v.setAttribute('muted',''); v.setAttribute('playsinline','');
    v.preload = 'none';
    v.controls = false;
    v.dataset.src = src;
    if (lazyObserver) lazyObserver.observe(v); else { v.src = src; }
    if (playObserver) playObserver.observe(v);
    v.addEventListener('ended', ()=>{ v.currentTime = 0; v.play().catch(()=>{}); });
    return v;
  }

  function makeTacoVideo(src){
    const v = document.createElement('video');
    let retried = false;
    v.muted = true; v.autoplay = true; v.loop = true; v.playsInline = true;
    v.setAttribute('muted',''); v.setAttribute('playsinline','');
    v.preload = 'none';
    v.controls = false;
    v.dataset.src = src;
    if (lazyObserver) lazyObserver.observe(v); else { v.src = src; }
    v.addEventListener('ended', ()=>{ v.currentTime = 0; v.play().catch(()=>{}); });
    // Some browsers occasionally stall a lazy video decode; retry once.
    v.addEventListener('stalled', ()=>{
      if (retried || !v.dataset.src) return;
      retried = true;
      const keep = v.dataset.src;
      v.pause();
      v.removeAttribute('src');
      v.load();
      v.src = keep;
      v.load();
      if (v.autoplay) v.play().catch(()=>{});
    });
    return v;
  }

  // 任务区也用同一个同步器类（上面已定义）
  function buildCard(taskKey, id){
    const base = `${ROOT_ROBOT}/${taskKey}/${id}`;
    const card = document.createElement('div'); card.className = 'card';

    const meta = document.createElement('div'); meta.className = 'meta';
    meta.innerHTML = `<span>#${id}</span><span>${taskKey}</span>`;
    card.appendChild(meta);

    // main two videos
    const dual = document.createElement('div'); dual.className = 'dual';
    const leftPane  = document.createElement('div'); leftPane.className = 'pane';
    const rightPane = document.createElement('div'); rightPane.className = 'pane';

    const vCropped   = makeLazyVideo(`${base}/cropped_video.mp4`, 'v v-cropped', 'cropped', id);
    const vInpainted = makeLazyVideo(`${base}/inpainted_video.mp4`, 'v v-inpainted', 'inpainted', id);

    leftPane.append(vCropped);  leftPane.appendChild(labelEl('Cropped'));
    rightPane.append(vInpainted); rightPane.appendChild(labelEl('Inpainted'));
    dual.append(leftPane, rightPane);
    card.appendChild(dual);

    // sync group using cropped as clock
    const group = new SyncGroup(vCropped);
    group.add(vInpainted);
    card.syncGroup = group;

    // collapsible extras (mask + removed)
    const det = document.createElement('details'); det.className = 'extras';
    const sum = document.createElement('summary'); sum.textContent = 'Mask & Background';
    det.appendChild(sum);

    const quad = document.createElement('div'); quad.className = 'quad small';
    const p1 = document.createElement('div'); p1.className = 'pane';
    const p2 = document.createElement('div'); p2.className = 'pane';

    // placeholders until opened (keeps DOM light)
    p1.appendChild(ghostEl('mask_5.mp4'));
    p2.appendChild(ghostEl('removed_w_mask_5.mp4'));
    quad.append(p1, p2);
    det.appendChild(quad);
    card.appendChild(det);

    // when toggled
    det.addEventListener('toggle', ()=>{
      // 关闭：释放资源（卸载 src、释放解码器，同时把地址放回 data-src 以便下次懒加载）
      if (!det.open) {
        [p1, p2].forEach(p=>{
          const v = p.querySelector('video');
          if (!v) return;
          v.pause();
          const src = v.src || v.dataset.src || '';
          v.removeAttribute('src');
          v.load();                 // 释放 decoder
          v.dataset.src = src;      // 保留路径，供下次重新懒加载
          // 重新注册懒加载和出视口暂停观察
          if (lazyObserver) lazyObserver.observe(v);
          if (playObserver) playObserver.observe(v);
        });
        return;
      }

      // 打开：首次创建并加入同步
      if (!p1.dataset.loaded) {
        p1.dataset.loaded = '1'; p2.dataset.loaded = '1';
        p1.innerHTML = ''; p2.innerHTML = '';
        const vMask    = makeLazyVideo(`${base}/mask_5.mp4`, 'v v-mask', 'mask', id);
        const vRemoved = makeLazyVideo(`${base}/removed_w_mask_5.mp4`, 'v v-removed', 'removed', id);
        p1.append(vMask);  p1.appendChild(labelEl('Mask'));
        p2.append(vRemoved); p2.appendChild(labelEl('Removed hands'));

        group.add(vMask); group.add(vRemoved);
        const trySync = ()=>{ group.resyncMember(vMask); group.resyncMember(vRemoved); };
        vMask.addEventListener('loadeddata', trySync, { once:true });
        vRemoved.addEventListener('loadeddata', trySync, { once:true });
        trySync();
      }
    });

    return card;
  }

  function labelEl(text){
    const l = document.createElement('div'); l.className = 'labels'; l.textContent = text; return l;
  }
  function ghostEl(text){
    const g = document.createElement('div'); g.className = 'ghost'; g.textContent = text; return g;
  }

  function buildTasks(){
    const mustardWrap = document.getElementById('mustard-demos');
    const drawerWrap  = document.getElementById('drawer-demos');
    TASKS[0].ids.forEach(id => mustardWrap.appendChild(buildCard('mustard', id)));
    TASKS[1].ids.forEach(id => drawerWrap.appendChild(buildCard('drawer',  id)));
  }

  function buildThreeVideoVisualization({ trackId, cueRightId, cueLeftId, samples }){
    const track = document.getElementById(trackId);
    const cueRight = document.getElementById(cueRightId);
    const cueLeft = document.getElementById(cueLeftId);
    if (!track) return;

    const updateCue = ()=>{
      const canScroll = track.scrollWidth > track.clientWidth + 2;
      const atStart = track.scrollLeft <= 2;
      const atEnd = track.scrollLeft + track.clientWidth >= track.scrollWidth - 4;
      if (cueLeft) cueLeft.classList.toggle('hidden', !canScroll || atStart);
      if (cueRight) cueRight.classList.toggle('hidden', !canScroll || atEnd);
    };

    samples.forEach(sample => {
      const slide = document.createElement('div'); slide.className = 'taco-slide';
      const titleRow = document.createElement('div'); titleRow.className = 'taco-task-row';
      const leftSpacer = document.createElement('div');
      const midTitle = document.createElement('div');
      const rightSpacer = document.createElement('div');
      midTitle.className = 'taco-task-title';
      midTitle.textContent = sample.task;
      titleRow.append(leftSpacer, midTitle, rightSpacer);
      const row = document.createElement('div'); row.className = 'taco-row';

      const pane1 = document.createElement('div'); pane1.className = 'taco-pane';
      const pane2 = document.createElement('div'); pane2.className = 'taco-pane';
      const pane3 = document.createElement('div'); pane3.className = 'taco-pane';

      const vColor = makeTacoVideo(`${sample.base}/color.mp4`);
      const vOrig  = makeTacoVideo(`${sample.base}/original_video.mp4`);
      const vInpt  = makeTacoVideo(`${sample.base}/inpainted_video.mp4`);

  pane1.append(vColor); pane1.appendChild(labelEl('Original'));
  pane2.append(vOrig);  pane2.appendChild(labelEl('Simulation'));
  pane3.append(vInpt);  pane3.appendChild(labelEl('Inpainted'));

      row.append(pane1, pane2, pane3);
  slide.append(titleRow, row);
      track.appendChild(slide);

      const group = new TightSyncGroup(vColor);
      group.add(vOrig); group.add(vInpt);
      slide.tacoGroup = group;
    });

    // Wheel -> snap to next/prev slide
    let lastWheel = 0;
    track.addEventListener('wheel', (e)=>{
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)){
        const now = performance.now();
        if (now - lastWheel < 400) { e.preventDefault(); return; }
        lastWheel = now;
        const dir = e.deltaY > 0 ? 1 : -1;
        const step = track.clientWidth;
        track.scrollBy({ left: dir * step, behavior: 'smooth' });
        e.preventDefault();
      }
    }, { passive:false });

    track.addEventListener('scroll', updateCue, { passive:true });
    window.addEventListener('resize', updateCue);
    requestAnimationFrame(updateCue);

    // Play/pause whole slide when in view
    if ('IntersectionObserver' in window){
      const tacoSlideObserver = new IntersectionObserver((entries)=>{
        entries.forEach(entry=>{
          const slide = entry.target;
          const group = slide?.tacoGroup;
          if (!group) return;
          const vids = Array.from(slide.querySelectorAll('video'));
          if (entry.isIntersecting){
            group.resetAll();
            vids.forEach(v => v.play().catch(()=>{}));
          } else {
            vids.forEach(v => v.pause());
          }
        });
      }, { threshold: 0.6 });
      track.querySelectorAll('.taco-slide').forEach(slide => tacoSlideObserver.observe(slide));
    }
  }

  function buildTaco(){
    buildThreeVideoVisualization({
      trackId: 'taco-track',
      cueRightId: 'taco-scroll-cue',
      cueLeftId: 'taco-scroll-cue-left',
      samples: TACO_SAMPLES,
    });
  }

  function buildAria(){
    buildThreeVideoVisualization({
      trackId: 'aria-track',
      cueRightId: 'aria-scroll-cue',
      cueLeftId: 'aria-scroll-cue-left',
      samples: ARIA_SAMPLES,
    });
  }

    /* ==== Real Robot Demos (per task, 4-in-a-row) ==== */
  /* Map both tasks here. Update file names/paths as you add reals. */
  const REAL_DEMOS = {
    mustard: { root: 'videos/blending/mustard/real', files: ['mustard1.mp4','mustard2.mp4','mustard3.mp4','mustard4.mp4'] },
    drawer:  { root: 'videos/blending/drawer/real',  files: ['drawer1.mp4','drawer2.mp4','drawer3.mp4','drawer4.mp4'] }, // rename to your actual files
  };

  const VISUAL_COMPARISONS = [
    { label: 'Human', src: 'videos/visual_comparison/human.mp4' },
    { label: 'EgoMimic', src: 'videos/visual_comparison/emimic.mp4' },
    { label: 'VACE (WAN2.1)', src: 'videos/visual_comparison/vace.mp4' },
    { label: 'Masquerade', src: 'videos/visual_comparison/masquerade.mp4' },
    { label: 'EgoEngine', src: 'videos/visual_comparison/egoengine.mp4' },
  ];

  /* Release logic (uses your existing lazyObserver & playObserver) */
  const releaseTimeoutMs = 8000;
  const offscreenTimers = new WeakMap();
  function unloadVideo(v){
    try{
      v.pause();
      const src = v.src || v.dataset.src || '';
      v.removeAttribute('src');
      v.load();               // release decoder
      v.dataset.src = src;    // keep path for re-lazyload
      if (lazyObserver) lazyObserver.observe(v);
      if (playObserver) playObserver.observe(v);
    }catch(_){}
  }
  const releaseObserver = ('IntersectionObserver' in window) ? new IntersectionObserver((entries)=>{
    entries.forEach(entry=>{
      const v = entry.target; if (!v) return;
      if (entry.isIntersecting){
        const t = offscreenTimers.get(v); if (t) { clearTimeout(t); offscreenTimers.delete(v); }
      }else{
        const prev = offscreenTimers.get(v); if (prev) clearTimeout(prev);
        const tid = setTimeout(()=>{ unloadVideo(v); offscreenTimers.delete(v); }, releaseTimeoutMs);
        offscreenTimers.set(v, tid);
      }
    });
  }, { threshold: 0.0 }) : null;

  function buildRealRow(taskKey, cfg){
    const taskEl = document.getElementById(`task-${taskKey}`);
    if (!taskEl) return;

    // Black block wrapper
    const block = document.createElement('div');
    block.className = 'real-block';

    // Title INSIDE the block
    const sub = document.createElement('div');
    sub.className = 'subhead';
    sub.textContent = 'Real Robot Demos';
    block.appendChild(sub);

    // Row of 4 inside the block
    const row = document.createElement('div');
    row.className = 'real-row';
    row.id = `${taskKey}-real-row`;

    (cfg.files || []).forEach((f, i) => {
      const pane = document.createElement('div'); pane.className = 'pane mini';
      const v = makeLazyVideo(`${cfg.root}/${f}`, 'v v-real', `${taskKey}-real`, i+1);
      pane.appendChild(v);
      pane.appendChild(labelEl(`#${i+1}`));
      row.appendChild(pane);
      if (releaseObserver) releaseObserver.observe(v);
    });

    block.appendChild(row);

    // Insert at TOP of the task (right after <h3>, before .demos)
    const h3 = taskEl.querySelector('h3');
    if (h3){
      h3.insertAdjacentElement('afterend', block);
    } else {
      taskEl.prepend(block);
    }
  }


  /* Build rows for all configured tasks */
  function buildRealRows(){
    Object.entries(REAL_DEMOS).forEach(([key, cfg])=>{
      if (cfg.files && cfg.files.length) buildRealRow(key, cfg);
    });
  }

  function buildVisualComparison(){
    const row = document.getElementById('visual-comparison-row');
    if (!row) return;

    VISUAL_COMPARISONS.forEach((item, i) => {
      const pane = document.createElement('div');
      pane.className = 'pane';
      const v = makeLazyVideo(item.src, 'v v-visual-comparison', 'visual-comparison', i + 1);
      pane.appendChild(v);
      pane.appendChild(labelEl(item.label));
      row.appendChild(pane);
      if (releaseObserver) releaseObserver.observe(v);
    });
  }


  buildTasks();
  buildRealRows();
  buildVisualComparison();
  buildTaco();
  buildAria();
