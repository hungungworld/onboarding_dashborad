/* 온보딩 대시보드 — 화면과 동작 */
const STORE_KEY = 'onboarding-dashboard-v3';
const TODAY = D.today();
let S = load();

function load() {
  try { const s = JSON.parse(localStorage.getItem(STORE_KEY)); if (s && s.v === 3) return s; } catch (e) { /* 저장소 없음 */ }
  const s = buildDemo(TODAY); persist(s); return s;
}
function persist(s) { try { localStorage.setItem(STORE_KEY, JSON.stringify(s || S)); } catch (e) { /* 저장할 수 없는 환경 */ } }
function save() { persist(); render(); }

/* ───────── 공통 ───────── */
const $ = (q, r) => (r || document).querySelector(q);
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
const orgName = c => orgNameOf(c);
const hireOf = k => S.hires.find(h => h.key === k);
const link = h => `<a href="#hire/${encodeURIComponent(h.key)}">${esc(h.name)}</a>`;
const shortTitle = t => t.replace(/ \(.*\)/, '').replace(/^(의무|법정)교육: /, '');
const STC = { 완료: 'ok', 지연: 'bad', 문제: 'issue', 진행: 'now', 대기: 'wait', 종료: 'off' };
const chip = s => `<span class="st st-${STC[s] || 'wait'}">${s}</span>`;
const isActive = h => h.status !== '입사 취소' && !h.leave;
const respondUrl = token => location.origin + location.pathname + '#respond/' + token;

function dueText(t) {
  if (t.done) return D.md(t.done) + ' 완료';
  const k = D.diff(t.due, TODAY);
  if (k < 0) return `<b class="late">${-k}일 지남</b>`;
  if (k === 0) return '<b class="soon">오늘 마감</b>';
  if (k === 1) return '<b class="soon">내일 마감</b>';
  return `${D.md(t.due)}까지 (${k}일)`;
}
function sendState(x) {
  if (x.respondedAt) return '응답';
  return D.diff(TODAY, x.sentAt) > SURVEY_WINDOW ? '미응답' : '대기';
}

function copy(text, done) {
  const ok = () => toast(done || '복사했습니다. 메일이나 메신저에 붙여넣으세요.');
  const fallback = () => modal('복사할 내용', `<textarea rows="10" readonly>${esc(text)}</textarea><p class="m-note">위 내용을 선택해서 복사하세요.</p>`, () => {}, '닫기');
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(ok, fallback); else fallback();
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2800); }
function modal(title, body, onOk, okLabel, wide) {
  const m = $('#modal');
  m.classList.toggle('wide', !!wide);
  m.innerHTML = `<form method="dialog" class="m-box"><h2>${title}</h2><div class="m-body">${body}</div>
    <div class="m-act"><button type="button" class="btn ghost" data-close>닫기</button>${okLabel === null ? '' : `<button class="btn primary">${okLabel || '저장'}</button>`}</div></form>`;
  const f = m.querySelector('form');
  f.addEventListener('submit', e => { e.preventDefault(); const err = onOk && onOk(new FormData(f), f); if (err) { let p = f.querySelector('.m-err'); if (!p) { p = document.createElement('p'); p.className = 'm-err'; f.querySelector('.m-act').before(p); } p.textContent = err; return; } m.close(); });
  f.querySelector('[data-close]').addEventListener('click', () => m.close());
  m.showModal();
}

/* ───────── 파생 정보 ───────── */
function derive() {
  const st = new Map();
  S.tasks.forEach(t => st.set(t.id, taskStatus(t, TODAY)));
  const by = {};
  S.tasks.forEach(t => (by[t.key] = by[t.key] || []).push(t));
  const since = D.add(TODAY, -45);
  const info = new Map();
  S.hires.forEach(h => {
    const list = by[h.key] || [];
    const live = list.filter(t => !t.closed);
    const done = live.filter(t => t.done).length;
    const late = live.filter(t => st.get(t.id) === '지연');
    const issues = live.filter(t => st.get(t.id) === '문제');
    const rs = S.resp.filter(r => r.key === h.key && r.at >= since);
    const scores = rs.filter(r => typeof r.score === 'number' && S.surveys.find(s => s.id === r.survey && s.qs.find(q => q.q === r.q && q.type === '점수5')));
    const avg = scores.length ? scores.reduce((a, r) => a + r.score, 0) / scores.length : null;
    const help = rs.some(r => r.answer === '예' && S.surveys.find(s => s.id === r.survey && s.qs.find(q => q.q === r.q && q.type === '예아니오')));
    const stage = hireStage(h, TODAY);
    const signals = [];
    if (STAGES.includes(stage)) {
      if (issues.length) signals.push(['issue', '문제 보고 ' + issues.length + '건']);
      if (late.length) signals.push([late.length >= 2 || stage === '입사 전' ? 'bad' : 'warn', late.slice(0, 2).map(t => shortTitle(t.title)).join(', ') + (late.length > 2 ? ' 외 ' + (late.length - 2) + '건' : '') + ' 지연']);
      if (avg !== null && avg <= 2.5) signals.push(['bad', '설문 점수 ' + avg.toFixed(1)]);
      if (help) signals.push(['bad', '매니저가 HR 도움 요청']);
    }
    info.set(h.key, { list, live, done, total: live.length, late, issues, avg, stage, signals });
  });
  return { st, info };
}

/* 발송 대상: 설문 시점이 됐고(오늘 ≥ 입사일 + n일) 아직 안 보낸 재직자 */
function sendTargets(s) {
  return S.hires.filter(h => isActive(h) && h.status !== '입사 취소').filter(h => {
    const k = D.diff(TODAY, D.add(h.start, s.day));
    return k >= 0 && k <= SURVEY_WINDOW && !S.sends.some(x => x.survey === s.id && x.key === h.key);
  });
}

/* ───────── 라우팅 ───────── */
const VIEWS = { today: viewToday, prep: viewPrep, hires: viewHires, hire: viewHire, surveys: viewSurveys, survey: viewSurvey, import: viewImport, connect: viewConnect, settings: viewSettings, respond: viewRespond };
function route() { const p = (location.hash.slice(1) || 'today').split('/'); return { v: VIEWS[p[0]] ? p[0] : 'today', a: decodeURIComponent(p[1] || ''), b: decodeURIComponent(p[2] || '') }; }
const UI = { prepScope: 'upcoming', tq: '', towner: '', hq: '', htype: '', hstage: '', horg: '', hrisk: false };

/* 사이드바 접기·펴기 (상태는 이 브라우저에 기억) */
function setNavCollapsed(on) {
  document.body.classList.toggle('nav-collapsed', on);
  const t = $('#nav-toggle');
  t.setAttribute('aria-expanded', String(!on));
  t.setAttribute('aria-label', on ? '메뉴 펴기' : '메뉴 접기');
  t.title = on ? '메뉴 펴기' : '메뉴 접기';
  try { localStorage.setItem('onboarding-nav-collapsed', on ? '1' : ''); } catch (e) { /* 저장 불가 */ }
}
try { if (localStorage.getItem('onboarding-nav-collapsed')) document.body.classList.add('nav-collapsed'); } catch (e) { /* 저장 불가 */ }

function render() {
  const { v, a, b } = route();
  document.body.classList.toggle('respond-mode', v === 'respond');
  const dv = derive();
  document.querySelectorAll('.nav a').forEach(x => x.classList.toggle('on', x.dataset.v === ({ hire: 'hires', survey: 'surveys' }[v] || v)));
  const late = S.tasks.filter(t => dv.st.get(t.id) === '지연' || dv.st.get(t.id) === '문제').length;
  $('#badge-today').textContent = late || '';
  const waiting = S.surveys.filter(s => s.active).reduce((n, s) => n + sendTargets(s).length, 0);
  $('#badge-surveys').textContent = waiting || '';
  $('#today').textContent = D.md(TODAY) + ' (' + D.dow(TODAY) + ')';
  $('#view').innerHTML = VIEWS[v](dv, a, b);
  if (v === 'import') bindImport();
}
window.addEventListener('hashchange', () => { window.scrollTo(0, 0); render(); });

/* ═════════ 오늘 할 일 ═════════ */
const SOURCES_META = {
  ats: { name: '채용 합격자 명단', from: '채용 시스템', cadence: 7 },
  hris: { name: '인사 기본 정보', from: '인사 시스템', cadence: 7 },
  lms: { name: '교육 수료 현황', from: 'LMS', cadence: 7 },
};
function freshness() {
  return Object.keys(SOURCES_META).map(k => {
    const m = SOURCES_META[k], at = S.lastImport[k], age = at ? D.diff(TODAY, at) : null;
    const old = age === null || age > m.cadence;
    return `<a class="fresh ${old ? 'old' : ''}" href="#import/${k}"><span class="f-name">${m.name}</span><span class="f-age">${at ? (age === 0 ? '오늘' : age + '일 전') + ' 가져옴' : '가져온 적 없음'}</span>${old ? '<span class="f-warn">새로 가져오기</span>' : ''}</a>`;
  }).join('');
}

function recipientOf(t, h) {
  if (t.kind === 'LMS') return { id: 'LMS', label: '교육 미수료 입사자', sub: 'LMS 수료 기록 기준 · 한 번에 안내', to: '' };
  if (t.owner === '매니저') return { id: 'm:' + h.mgr, label: h.mgrName + ' 매니저', sub: orgName(h.org), to: h.mgr };
  if (t.owner === '입사자') return { id: 'n:' + h.key, label: h.name + ' (입사자)', sub: orgName(h.org) + ' · ' + D.md(h.start) + ' 입사', to: h.email };
  if (t.owner === 'HR') return { id: 'HR', label: '내가 할 일', sub: 'HR 담당', to: '' };
  return { id: t.owner, label: t.owner + ' 담당', sub: t.owner === 'IT' ? '계정·장비' : '자리·출입증·명함', to: '' };
}

const TODAY_TABS = [['me', '내가 할 일'], ['req', '요청 보내기'], ['soon', '곧 입사'], ['watch', '살펴볼 입사자']];

function viewToday(dv, tab) {
  const { st, info } = dv;
  if (!TODAY_TABS.some(x => x[0] === tab)) tab = 'me';

  // 챙길 일: 지연, 문제, 2일 안에 마감 → 받는 곳별로 묶음
  const due = S.tasks.filter(t => { const s = st.get(t.id); return s === '지연' || s === '문제' || (s === '진행' && D.diff(t.due, TODAY) <= 2); });
  const groups = {};
  due.forEach(t => { const h = hireOf(t.key); if (!h || !isActive(h)) return; const r = recipientOf(t, h); (groups[r.id] = groups[r.id] || { r, items: [] }).items.push(t); });
  const lateOf = g => g.items.filter(t => st.get(t.id) === '지연').length;
  const byUrgency = (a, b) => lateOf(b) - lateOf(a) || b.items.length - a.items.length;
  const mine = groups.HR ? groups.HR.items : [];
  const others = Object.values(groups).filter(g => g.r.id !== 'HR');
  const teams = others.filter(g => !g.r.id.startsWith('n:') && !g.r.id.startsWith('m:')).sort(byUrgency);
  const people = others.filter(g => g.r.id.startsWith('n:')).sort(byUrgency);
  const mgrs = others.filter(g => g.r.id.startsWith('m:')).sort(byUrgency);

  // 내가 할 일: HR 담당 일 + 법정·규정 기한(2주 안) + 설문 발송 대기
  const legal = S.tasks.filter(t => t.rule && !t.done && !t.closed && D.diff(t.due, TODAY) <= 14 && isActive(hireOf(t.key) || {}) && !mine.includes(t)).sort((a, b) => D.n(a.due) - D.n(b.due));
  const waiting = S.surveys.filter(s => s.active).map(s => [s, sendTargets(s)]).filter(x => x[1].length);
  const meN = mine.length + legal.length + waiting.length;
  const meLate = mine.filter(t => st.get(t.id) === '지연').length + legal.filter(t => D.diff(t.due, TODAY) < 0).length;

  // 곧 입사: 2주 안, 준비 덜 된 사람 먼저
  const arriving = S.hires.filter(h => isActive(h) && D.diff(h.start, TODAY) >= 0 && D.diff(h.start, TODAY) <= 14).map(h => {
    const pre = info.get(h.key).live.filter(t => t.offset < 0 && !t.rule);
    const done = pre.filter(t => t.done).length, k = D.diff(h.start, TODAY);
    return { h, pre, done, k, risk: k <= 7 && done < pre.length };
  }).sort((a, b) => b.risk - a.risk || a.k - b.k);
  const riskN = arriving.filter(x => x.risk).length;

  // 살펴볼 입사자: 위험 신호 + 설문 응답 3일 이상 대기
  // 가벼운 지연(warn)만 있는 사람은 '요청 보내기'에서 다루므로 제외
  const watch = S.hires.filter(h => info.get(h.key).signals.some(s => s[0] !== 'warn')).sort((a, b) => info.get(b.key).signals.filter(s => s[0] === 'bad').length - info.get(a.key).signals.filter(s => s[0] === 'bad').length);
  const pendingResp = S.sends.filter(x => sendState(x) === '대기' && D.diff(TODAY, x.sentAt) >= 3);

  const counts = {
    me: [meN, meLate ? 'bad' : ''],
    req: [others.length + '곳', others.some(g => lateOf(g)) ? 'bad' : ''],
    soon: [arriving.length + '명', riskN ? 'bad' : ''],
    watch: [watch.length + pendingResp.length + '명', ''],
  };

  // 데이터 기준일: 오래된 것만 한 줄로
  const stale = Object.keys(SOURCES_META).filter(k => { const at = S.lastImport[k]; return !at || D.diff(TODAY, at) > SOURCES_META[k].cadence; });
  const fresh = stale.length
    ? stale.map(k => { const at = S.lastImport[k]; return `<a class="stale" href="#import/${k}">${SOURCES_META[k].name} ${at ? D.diff(TODAY, at) + '일 전' : '가져온 적 없음'} · <u>새로 가져오기</u></a>`; }).join('')
    : `<a href="#import">데이터 모두 최신</a>`;

  const body = {
    me: () => {
      const rows = [
        ...mine.sort((a, b) => D.n(a.due) - D.n(b.due)).map(t => { const h = hireOf(t.key); return `<li>${chip(st.get(t.id))}<div class="t-main"><span><b>${esc(h.name)}</b> · ${esc(t.title)}</span><span class="t-meta">${orgName(h.org)} · ${D.md(h.start)} 입사 · ${dueText(t)}</span>${t.memo ? `<span class="t-memo">${esc(t.memo)}</span>` : ''}</div><div class="t-act"><button class="btn sm" data-act="done" data-id="${esc(t.id)}">완료</button><button class="btn sm ghost" data-act="memo" data-id="${esc(t.id)}">메모</button></div></li>`; }),
        ...legal.map(t => { const h = hireOf(t.key); return `<li><span class="st st-${D.diff(t.due, TODAY) < 0 ? 'bad' : 'law'}">법정</span><div class="t-main"><span><b>${esc(h.name)}</b> · ${esc(shortTitle(t.title))}</span><span class="t-meta">${orgName(h.org)} · ${D.md(h.start)} 입사 · ${dueText(t)}</span></div><div class="t-act"><button class="btn sm" data-act="done" data-id="${esc(t.id)}">완료</button><button class="btn sm ghost" data-act="memo" data-id="${esc(t.id)}">메모</button></div></li>`; }),
        ...waiting.map(([s, t]) => `<li><span class="st st-now">설문</span><div class="t-main"><span>${esc(s.name)} · <b>${t.length}명</b> 발송 대기</span><span class="t-meta">${t.slice(0, 3).map(h => esc(h.name)).join(', ')}${t.length > 3 ? ' 외 ' + (t.length - 3) + '명' : ''}</span></div><div class="t-act"><a class="btn sm" href="#survey/${s.id}">보내기</a></div></li>`),
      ];
      return `<p class="tab-hint">HR이 직접 처리할 일만 모았습니다. 법정·규정 기한은 2주 안에 오는 것까지 보입니다.</p>` +
        (rows.length ? `<ul class="citems rows">${rows.join('')}</ul>` : '<p class="empty">오늘 직접 처리할 일이 없습니다.</p>');
    },
    req: () => {
      const one = g => { const n = lateOf(g); return `<details class="rq"><summary><div class="rq-main"><b>${esc(g.r.label)}</b><span class="w-meta">${esc(g.r.sub)} · ${g.items.length}건</span></div>${n ? `<span class="sg sg-bad">지연 ${n}</span>` : `<span class="sg sg-warn">2일 안</span>`}${lastAsk(g.r.id) ? `<span class="asked">${D.md(lastAsk(g.r.id).at)} 보냄</span>` : ''}<button class="btn sm" data-act="ask" data-r="${esc(g.r.id)}">보내기</button></summary>${contactGroup(g, st, true)}</details>`; };
      const bundle = (label, sub, list) => { if (!list.length) return ''; const n = list.reduce((a, g) => a + lateOf(g), 0), k = list.reduce((a, g) => a + g.items.length, 0);
        return `<details class="rq"><summary><div class="rq-main"><b>${label} ${list.length}명</b><span class="w-meta">${sub} · ${k}건</span></div>${n ? `<span class="sg sg-bad">지연 ${n}</span>` : ''}<span class="rq-open">펼치기</span></summary><div class="rq-sub">${list.map(one).join('')}</div></details>`; };
      return `<p class="tab-hint">기한이 지났거나 2일 안에 마감인 일을 받는 곳별로 한 줄씩 묶었습니다. 줄을 누르면 항목이 펼쳐집니다.</p>` +
        (others.length ? teams.map(one).join('') + bundle('입사자', '제출 서류·교육', people) + bundle('매니저', '버디·면담·평가', mgrs) : '<p class="empty">요청할 곳이 없습니다. 모든 준비가 기한 안에 진행되고 있습니다.</p>');
    },
    soon: () => `<p class="tab-hint">2주 안에 입사하는 사람입니다. 7일 안 입사인데 준비가 덜 된 사람이 맨 위에 옵니다.</p>` +
      (arriving.length ? `<ul class="arrive rows">${arriving.map(({ h, pre, done, k, risk }) => `<li><span class="st st-${risk ? 'bad' : 'wait'}">${k === 0 ? '오늘' : 'D-' + k}</span><div class="t-main"><div class="a-top">${link(h)}<span class="w-meta">${orgName(h.org)} · ${D.md(h.start)}(${D.dow(h.start)}) 입사</span></div>
        <div class="prog"><div class="bar ${risk ? 'bad' : ''}"><i style="width:${pct(done, pre.length) || 0}%"></i></div><span>준비 ${done}/${pre.length}</span></div></div></li>`).join('')}</ul><a class="more" href="#prep">입사 준비 현황판에서 전체 보기</a>` : '<p class="empty">2주 안에 입사하는 사람이 없습니다.</p>'),
    watch: () => `<p class="tab-hint">기한 지연, 문제 보고, 낮은 설문 점수, 매니저의 도움 요청 같은 신호가 있는 사람입니다.</p>` +
      (watch.length ? `<ul class="watch rows">${watch.map(h => `<li><div class="a-top">${link(h)}<span class="w-meta">${orgName(h.org)} · ${info.get(h.key).stage}</span></div><div>${info.get(h.key).signals.map(s => `<span class="sg sg-${s[0]}">${esc(s[1])}</span>`).join('')}</div></li>`).join('')}</ul>` : '<p class="empty">위험 신호가 있는 입사자가 없습니다.</p>') +
      (pendingResp.length ? `<h3 class="tab-sub">설문 응답 3일 이상 대기 <span class="count">${pendingResp.length}명</span></h3><ul class="plain">${pendingResp.map(x => { const h = hireOf(x.key), s = S.surveys.find(v => v.id === x.survey); return h ? `<li><span>${link(h)} · ${esc(s ? s.name : '')}</span><span>${D.diff(TODAY, x.sentAt)}일째</span></li>` : ''; }).join('')}</ul>` : ''),
  };

  return `
  <header class="page-head">
    <div><h1>오늘 할 일</h1><p class="sub">${D.md(TODAY)} ${D.dow(TODAY)}요일</p></div>
    <div class="head-fresh">${fresh}</div>
  </header>
  <nav class="day-tabs" role="tablist" aria-label="오늘 할 일 구분">
    ${TODAY_TABS.map(([k, label]) => `<a role="tab" href="#today/${k}" aria-selected="${k === tab}" class="${k === tab ? 'on' : ''}">${label}<span class="tab-n ${counts[k][1]}">${counts[k][0]}</span></a>`).join('')}
  </nav>
  <section class="panel tab-panel" role="tabpanel">${body[tab]()}</section>`;
}

function contactGroup(g, st, bare) {
  const lateN = g.items.filter(t => st.get(t.id) === '지연').length;
  g.items.sort((a, b) => D.n(a.due) - D.n(b.due));
  const list = `<ul class="citems">${g.items.map(t => { const h = hireOf(t.key), s = st.get(t.id); return `<li>${chip(s)}<div class="t-main"><span><b>${esc(h.name)}</b> · ${esc(t.title)}</span><span class="t-meta">${g.r.id.startsWith('n:') ? '' : orgName(h.org) + ' · ' + D.md(h.start) + ' 입사 · '}${dueText(t)}</span>${t.memo ? `<span class="t-memo">${esc(t.memo)}</span>` : ''}</div>
      <div class="t-act">${t.kind === 'LMS' ? '' : `<button class="btn sm" data-act="done" data-id="${esc(t.id)}">완료</button>`}<button class="btn sm ghost" data-act="memo" data-id="${esc(t.id)}">메모</button></div></li>`; }).join('')}</ul>`;
  if (bare) return list;
  return `<div class="cgroup">
    <div class="cg-head"><div><b>${esc(g.r.label)}</b><span class="w-meta">${esc(g.r.sub)}${g.r.to ? ' · ' + esc(g.r.to) : ''}</span></div>
      <div class="cg-act">${lateN ? `<span class="sg sg-bad">지연 ${lateN}</span>` : ''}${g.r.id === 'HR' ? '' : `<button class="btn sm" data-act="copy-request" data-r="${esc(g.r.id)}">요청 문구 복사</button>`}</div></div>
    ${list}
  </div>`;
}

function requestText(rid) {
  const dv = derive();
  const items = S.tasks.filter(t => { const s = dv.st.get(t.id), h = hireOf(t.key); return h && isActive(h) && (s === '지연' || s === '문제' || (s === '진행' && D.diff(t.due, TODAY) <= 2)) && recipientOf(t, h).id === rid; });
  const h0 = hireOf(items[0].key), r = recipientOf(items[0], h0);
  if (rid === 'LMS') {
    const people = [...new Set(items.map(t => t.key))].map(hireOf);
    return `[교육 안내] 입사자 의무·법정 교육 수료 부탁드립니다

안녕하세요, 온보딩 담당 HR입니다. 아래 교육이 아직 수료되지 않은 것으로 확인됩니다.
LMS에서 수강 후 수료까지 완료해 주세요. (이미 들으셨다면 무시하셔도 됩니다)

` +
      people.map(h => `- ${h.name} (${orgName(h.org)}): ` + items.filter(t => t.key === h.key).map(t => `${shortTitle(t.title)} ${D.diff(t.due, TODAY) < 0 ? '(기한 지남)' : '(' + D.md(t.due) + '까지)'}`).join(', ')).join('\n') +
      `

받는 사람(숨은 참조): ` + people.map(h => h.email).join('; ');
  }
  if (rid.startsWith('n:')) {
    return `${h0.name} 님, 안녕하세요. 온보딩 담당 HR입니다.\n${D.md(h0.start)} 입사를 앞두고 아래 항목을 부탁드립니다.\n\n` +
      items.map(t => `- ${t.title} (${D.diff(t.due, TODAY) < 0 ? '기한 지남' : D.md(t.due) + '까지'})`).join('\n') +
      `\n\n서류는 이 메일에 회신으로 보내 주시면 됩니다. 궁금한 점은 편하게 물어봐 주세요.`;
  }
  return `${r.label.replace(' 담당', ' 담당자')}님, 안녕하세요. 온보딩 담당 HR입니다.\n신규 입사자 준비 건 확인 부탁드립니다.\n\n` +
    items.map(t => { const h = hireOf(t.key); const k = D.diff(t.due, TODAY); return `- ${h.name} (${orgName(h.org)} ${h.rank}, ${D.md(h.start)} 입사, ${h.site}): ${t.title} — ${k < 0 ? -k + '일 지남' : k === 0 ? '오늘까지' : D.md(t.due) + '까지'}${t.memo ? ' / 메모: ' + t.memo : ''}`; }).join('\n') +
    `\n\n완료되면 회신 주세요. 감사합니다.`;
}

/* ═════════ 입사 준비 현황판 ═════════ */
function prepColumns() {
  return S.template.filter(t => t.active && ['서류', '체크', '버디'].includes(t.kind) && t.offset <= 3 && !t.rule);
}
/* 현황판 묶음: HR 담당자가 보는 화면이라 입사자 다음에 HR(나)을 둔다 */
const PREP_GROUPS = [['입사자', '입사 서류', '입사자'], ['HR', '안내·첫날', 'HR (나)'], ['매니저', '팀 합류 준비', '매니저'], ['IT', '계정·장비', 'IT'], ['총무', '자리·출입·명함', '총무']];
const PREP_OPEN_KEY = 'onboarding-prep-open';
UI.prepOpen = (() => { try { return JSON.parse(localStorage.getItem(PREP_OPEN_KEY)) || []; } catch (e) { return []; } })();
UI.prepHide = false;
function togglePrepGroup(o) {
  const i = UI.prepOpen.indexOf(o);
  if (i < 0) UI.prepOpen.push(o); else UI.prepOpen.splice(i, 1);
  try { localStorage.setItem(PREP_OPEN_KEY, JSON.stringify(UI.prepOpen)); } catch (e) { /* 저장 불가 */ }
  render();
}
/* 현황판 칸 선택창: 완료 · 완료 취소 · 메모 남기기/고치기 · 해결됨 */
function memoValue(t, m) { return m && m !== t.memo && !/^\d+\/\d+ /.test(m) ? D.md(TODAY) + ' ' + m : m; }
function closeCellMenu() { const p = $('#cellpop'); if (p) p.hidden = true; document.querySelectorAll('.matrix td.c button.sel').forEach(b => b.classList.remove('sel')); }
function openCellMenu(btn, mode) {
  const t = S.tasks.find(x => x.id === btn.dataset.id); if (!t) return;
  const h = hireOf(t.key), s = taskStatus(t, TODAY);
  let p = $('#cellpop');
  if (!p) { p = document.createElement('div'); p.id = 'cellpop'; p.className = 'cellpop'; p.setAttribute('role', 'dialog'); document.body.appendChild(p); }
  document.querySelectorAll('.matrix td.c button.sel').forEach(b => b.classList.remove('sel')); btn.classList.add('sel');
  const body = mode === 'memo'
    ? `<textarea id="cp-memo" rows="3" placeholder="무엇이 문제인지 적어 두세요. 예: 서류 재발급 중, 11/8 제출 예정">${esc(t.memo)}</textarea>
       <div class="cp-row"><button type="button" class="btn" data-pa="back">취소</button><button type="button" class="btn primary" data-pa="save">메모 저장</button></div>`
    : `${t.memo ? `<div class="cp-memo">${esc(t.memo)}</div>` : ''}<div class="cp-acts">
       ${t.done ? `<button type="button" class="btn" data-pa="undo">완료 취소<small>다시 할 일로</small></button>` : `<button type="button" class="btn primary" data-pa="done">✓ 완료로 표시</button>`}
       ${t.memo ? `<button type="button" class="btn" data-pa="memo">메모 고치기</button><button type="button" class="btn" data-pa="clear">해결됨<small>메모 지우기</small></button>` : `<button type="button" class="btn" data-pa="memo">? 메모 남기기<small>문제로 표시됨</small></button>`}
       <a class="btn" href="#hire/${encodeURIComponent(h.key)}" data-pa="person">${esc(h.name)} 님 전체 할 일 보기 →</a></div>`;
  p.innerHTML = `<div class="cp-head"><div><b>${esc(h.name)} · ${esc(shortTitle(t.title))}</b><span>${D.md(t.due)}까지 ${chip(s)}</span></div><button type="button" class="cp-x" data-pa="close" aria-label="닫기">×</button></div>${body}`;
  p.dataset.id = t.id; p.hidden = false;
  const r = btn.getBoundingClientRect();
  const left = Math.max(12, Math.min(r.left + window.scrollX, window.scrollX + document.documentElement.clientWidth - p.offsetWidth - 12));
  let top = r.bottom + window.scrollY + 6;
  if (r.bottom + p.offsetHeight + 12 > window.innerHeight) top = Math.max(window.scrollY + 12, r.top + window.scrollY - p.offsetHeight - 6);
  p.style.left = left + 'px'; p.style.top = top + 'px';
  if (mode === 'memo') $('#cp-memo').focus(); else p.querySelector('button[data-pa]:not(.cp-x)').focus();
}
document.addEventListener('click', e => {
  const p = $('#cellpop'); if (!p || p.hidden) return;
  const a = e.target.closest('#cellpop [data-pa]');
  if (!a) { if (!p.contains(e.target) && !e.target.closest('[data-act="cell-menu"]')) closeCellMenu(); return; }
  const t = S.tasks.find(x => x.id === p.dataset.id), act = a.dataset.pa;
  const btn = document.querySelector(`.matrix [data-act="cell-menu"][data-id="${CSS.escape(p.dataset.id)}"]`);
  if (act === 'person') { closeCellMenu(); return; }
  e.preventDefault();
  if (act === 'close') return closeCellMenu();
  if (act === 'memo') return openCellMenu(btn, 'memo');
  if (act === 'back') return openCellMenu(btn);
  if (act === 'done') { t.done = TODAY; t.by = 'HR 체크'; t.memo = ''; toast('완료로 표시했습니다.'); }
  if (act === 'undo') { t.done = ''; t.by = ''; toast('완료를 취소했습니다.'); }
  if (act === 'save') { const m = $('#cp-memo').value.trim(); t.memo = memoValue(t, m); toast(m ? '메모를 남겼습니다. 보라 ?로 표시됩니다.' : '메모를 비워서 해결로 처리했습니다.'); }
  if (act === 'clear') { t.memo = ''; toast('해결로 처리했습니다.'); }
  closeCellMenu(); save();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeCellMenu(); });
window.addEventListener('hashchange', closeCellMenu);

function viewPrep(dv) {
  const { st, info } = dv;
  const cohorts = [...new Set(S.hires.filter(h => h.cohort).map(h => h.cohort))];
  let hs;
  if (UI.prepScope === 'upcoming') hs = S.hires.filter(h => isActive(h) && D.diff(TODAY, h.start) < 7 && D.diff(h.start, TODAY) <= 30);
  else hs = S.hires.filter(h => h.cohort === UI.prepScope && h.status !== '입사 취소');
  hs.sort((a, b) => D.n(a.start) - D.n(b.start) || a.name.localeCompare(b.name));
  const cols = prepColumns();
  const taskOf = (h, c) => S.tasks.find(t => t.key === h.key && t.code === c.code);
  const pendingOf = c => hs.map(h => taskOf(h, c)).filter(t => t && !t.done && !t.closed);
  const groups = PREP_GROUPS.map(([o, name, who]) => {
    const all = cols.filter(c => c.owner === o);
    const shown = UI.prepHide ? all.filter(c => pendingOf(c).length) : all;
    return { o, name, who, all, shown, open: UI.prepOpen.includes(o) && shown.length > 0 };
  }).filter(g => g.all.length);
  const leftPeople = g => hs.filter(h => g.all.some(c => { const t = taskOf(h, c); return t && !t.done && !t.closed; })).length;
  const head = g => { const n = leftPeople(g);
    return `<button type="button" class="gh-btn" data-act="prep-group" data-o="${g.o}" aria-expanded="${g.open}" title="누르면 ${g.open ? '접힙니다' : '항목별로 펼쳐집니다'}">
      <span class="chev" aria-hidden="true">▶</span><span class="gh-name">${g.name}</span><span class="gh-who">${g.who}</span>${g.open ? '' : `<span class="gh-cnt ${n ? '' : 'ok'}">${n ? n + '명 남음' : '완료'}</span>`}</button>`; };
  const cellOf = (h, c) => {
    const t = taskOf(h, c);
    if (!t || t.closed) return '<td class="c c-na" title="해당 없음">–</td>';
    const s = st.get(t.id);
    const sym = { 완료: '✓', 지연: '!', 문제: '?', 진행: '·', 대기: '' }[s];
    return `<td class="c c-${STC[s]}"><button data-act="cell-menu" data-id="${esc(t.id)}" aria-haspopup="dialog" title="${esc(c.title)} · ${s}${t.memo ? ' · ' + esc(t.memo) : ''} · ${D.md(t.due)}까지">${sym}</button></td>`;
  };
  const sumOf = (h, g) => {
    const ts = g.all.map(c => taskOf(h, c)).filter(t => t && !t.closed);
    if (!ts.length) return '<td class="g-sum c-na">–</td>';
    const done = ts.filter(t => t.done).length, late = ts.filter(t => st.get(t.id) === '지연').length, iss = ts.filter(t => st.get(t.id) === '문제').length;
    return `<td class="g-sum"><button type="button" data-act="prep-group" data-o="${g.o}" title="${g.name} 펼치기"><span class="frac ${done === ts.length ? 'full' : ''}">${done}/${ts.length}</span>${late ? `<i class="c c-bad">!${late > 1 ? ' ' + late : ''}</i>` : ''}${iss ? `<i class="c c-issue">?${iss > 1 ? ' ' + iss : ''}</i>` : ''}</button></td>`;
  };

  return `
  <header class="page-head">
    <div><h1>입사 준비 현황판</h1><p class="sub">담당 이름을 누르면 항목별로 펼쳐집니다. 칸을 누르면 완료·메모를 고를 수 있고, 항목 아래 빨간 숫자를 누르면 아직 안 된 사람 명단을 복사합니다.</p></div>
    <div class="head-act">
      <select data-f="prepScope" aria-label="범위">
        <option value="upcoming" ${UI.prepScope === 'upcoming' ? 'selected' : ''}>입사 30일 전 ~ 입사 첫 주</option>
        ${cohorts.map(c => `<option value="${esc(c)}" ${UI.prepScope === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
      </select>
    </div>
  </header>
  <div class="prep-top">
    <div class="legend"><span><i class="c c-ok">✓</i>완료</span><span><i class="c c-now">·</i>진행 (기한 다가옴)</span><span><i class="c c-wait"></i>대기</span><span><i class="c c-bad">!</i>기한 지남</span><span><i class="c c-issue">?</i>문제 메모</span><span><i class="c c-na">–</i>해당 없음</span></div>
    <label class="check"><input type="checkbox" data-f="prepHide" ${UI.prepHide ? 'checked' : ''}> 모두 끝난 항목 숨기기</label>
  </div>
  <section class="panel flush"><div class="scroll matrix-wrap"><table class="matrix grouped">
    <thead>
      <tr><th rowspan="2" class="m-name">입사자</th><th rowspan="2">입사일</th>${groups.map(g => g.open ? `<th colspan="${g.shown.length}" class="m-owner gh open">${head(g)}</th>` : `<th rowspan="2" class="m-owner gh">${head(g)}</th>`).join('')}<th rowspan="2">진행</th><th rowspan="2"></th></tr>
      <tr>${groups.filter(g => g.open).map(g => g.shown.map((c, j) => { const n = pendingOf(c).length; return `<th class="m-col ${j ? '' : 'gs'}"><span>${esc(shortTitle(c.title))}</span>${n ? `<button class="m-copy" data-act="copy-col" data-code="${c.code}" title="미완료 명단 복사">${n}명</button>` : '<span class="m-alldone">완료</span>'}</th>`; }).join('')).join('')}</tr>
    </thead>
    <tbody>${hs.map(h => {
      const cells = groups.map(g => g.open ? g.shown.map((c, j) => cellOf(h, c).replace('<td class="c', `<td class="${j ? '' : 'gs '}c`)).join('') : sumOf(h, g)).join('');
      const pre = info.get(h.key).live.filter(t => cols.some(c => c.code === t.code));
      const done = pre.filter(t => t.done).length;
      const docsMissing = S.tasks.some(t => t.key === h.key && t.kind === '서류' && !t.done && !t.closed);
      return `<tr><th class="m-name">${link(h)}<span class="small">${orgName(h.org)} · ${h.type}</span></th><td class="nowrap">${D.md(h.start)}<span class="small">${D.dday(h.start, TODAY)}</span></td>${cells}
        <td class="nowrap"><b>${done}</b>/${pre.length}</td><td>${docsMissing ? `<button class="btn sm ghost" data-act="copy-docs" data-key="${esc(h.key)}">서류 안내</button>` : ''}</td></tr>`;
    }).join('') || `<tr><td colspan="40" class="empty">이 범위에 입사자가 없습니다.</td></tr>`}</tbody>
  </table></div></section>`;
}

/* ═════════ 입사자 ═════════ */
function viewHires(dv) {
  const { info } = dv;
  const q = UI.hq.trim();
  const list = S.hires.filter(h => (!q || (h.name + h.key + h.empNo + h.email + orgName(h.org) + h.mgrName).includes(q)) &&
    (!UI.htype || h.type === UI.htype) && (!UI.horg || h.org === UI.horg) && (!UI.hstage || info.get(h.key).stage === UI.hstage) && (!UI.hrisk || info.get(h.key).signals.length))
    .sort((a, b) => D.n(b.start) - D.n(a.start));
  const opt = (arr, cur) => arr.map(([v, l]) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`).join('');
  return `
  <header class="page-head">
    <div><h1>입사자</h1><p class="sub">${S.hires.length}명 · 채용 시스템 명단을 가져오면 자동으로 추가·변경됩니다</p></div>
    <div class="head-act"><a class="btn" href="#import/ats">합격자 명단 가져오기</a><button class="btn ghost" data-act="new-hire">한 명 직접 등록</button></div>
  </header>
  <div class="filters">
    <input type="search" placeholder="이름, 사번, 이메일, 부서, 매니저" value="${esc(UI.hq)}" data-f="hq" aria-label="검색">
    <select data-f="htype" aria-label="채용 구분">${opt([['', '채용 구분 전체'], ...HIRE_TYPES.map(x => [x, x])], UI.htype)}</select>
    <select data-f="hstage" aria-label="단계">${opt([['', '단계 전체'], ...[...STAGES, '온보딩 종료', '퇴사', '입사 취소'].map(x => [x, x])], UI.hstage)}</select>
    <select data-f="horg" aria-label="부서">${opt([['', '부서 전체'], ...ORGS.map(o => [o.code, o.name])], UI.horg)}</select>
    <label class="check"><input type="checkbox" data-f="hrisk" ${UI.hrisk ? 'checked' : ''}> 위험 신호만</label>
  </div>
  <section class="panel flush"><div class="scroll"><table class="tbl hires">
    <thead><tr><th>이름</th><th>부서 · 직급</th><th>구분</th><th>입사일</th><th>단계</th><th>준비·교육</th><th>매니저</th><th>수습 종료</th><th>위험 신호</th></tr></thead>
    <tbody>${list.map(h => { const i = info.get(h.key), p = pct(i.done, i.total) || 0; return `<tr class="click" data-href="#hire/${encodeURIComponent(h.key)}">
      <td>${link(h)}<span class="small">${esc(h.empNo || '사번 발급 전')}</span></td><td>${orgName(h.org)}<span class="small">${esc(h.rank)} · ${esc(h.job)}</span></td>
      <td>${h.type}${h.cohort ? `<span class="small">${esc(h.cohort)}</span>` : ''}</td><td class="nowrap">${D.md(h.start)}<span class="small">${D.dday(h.start, TODAY)}</span></td>
      <td><span class="stage stage-${i.stage === '입사 취소' || i.stage === '퇴사' ? 'off' : 'on'}">${i.stage}</span></td>
      <td><div class="prog"><div class="bar"><i style="width:${p}%"></i></div><span>${i.done}/${i.total}</span></div></td>
      <td>${esc(h.mgrName)}</td><td class="nowrap">${isActive(h) ? D.md(probationEnd(h, S.settings.probationMonths)) : '-'}</td>
      <td>${i.signals.map(s => `<span class="sg sg-${s[0]}">${esc(s[1])}</span>`).join('') || '<span class="muted">-</span>'}</td></tr>`; }).join('') || '<tr><td colspan="9" class="empty">조건에 맞는 입사자가 없습니다.</td></tr>'}</tbody>
  </table></div></section>`;
}

function viewHire(dv, key) {
  const h = hireOf(key);
  if (!h) return '<p class="empty">입사자를 찾을 수 없습니다. <a href="#hires">입사자 목록</a></p>';
  const { st, info } = dv, i = info.get(h.key);
  const groups = [['입사 전 준비', t => t.offset < 0 && !t.rule], ['입사 첫 주', t => t.offset >= 0 && t.offset <= 7 && !t.rule && t.kind !== 'LMS'], ['교육', t => t.kind === 'LMS'], ['기한이 정해진 일', t => !!t.rule]];
  const sends = S.sends.filter(x => x.key === h.key);
  return `
  <nav class="crumb"><a href="#hires">입사자</a> / ${esc(h.name)}</nav>
  <header class="page-head">
    <div><h1>${esc(h.name)} <span class="h1-sub">${orgName(h.org)} · ${esc(h.rank)} · ${h.type}${h.cohort ? ' ' + esc(h.cohort) : ''}</span></h1>
      <p class="sub">${D.md(h.start)}(${D.dow(h.start)}) 입사 · ${D.dday(h.start, TODAY)} · ${i.stage}${isActive(h) ? ' · 수습 종료 ' + D.md(probationEnd(h, S.settings.probationMonths)) : ''}</p></div>
    <div class="head-act"><button class="btn" data-act="edit-hire" data-key="${esc(h.key)}">정보 수정</button>${isActive(h) ? `<button class="btn ghost danger" data-act="leave" data-key="${esc(h.key)}">퇴사·입사 취소</button>` : ''}</div>
  </header>
  ${i.signals.length ? `<div class="alert">${i.signals.map(s => `<span class="sg sg-${s[0]}">${esc(s[1])}</span>`).join('')}</div>` : ''}
  ${h.status === '입사 취소' || h.leave ? `<div class="alert off">${h.status === '입사 취소' ? '입사 취소' : D.md(h.leave) + ' 퇴사'}${h.note ? ' · ' + esc(h.note) : ''}. 남은 할 일은 모두 종료되었습니다.</div>` : ''}
  <div class="detail-grid">
    <section class="panel">${groups.map(([label, fn]) => {
      const ts = i.list.filter(fn).sort((a, b) => D.n(a.due) - D.n(b.due)); if (!ts.length) return '';
      return `<h3 class="phase-h">${label}</h3><ul class="todo">${ts.map(t => { const s = st.get(t.id); return `<li class="t-${STC[s]}">${chip(s)}<div class="t-main"><span class="t-title">${esc(t.title)}</span>
        <span class="t-meta">${t.owner === '매니저' ? esc(h.mgrName) + ' 매니저' : t.owner}${s === '종료' ? ' · ' + esc(t.closed) : ' · ' + dueText(t)}${t.done && t.by ? ' · ' + esc(t.by) : ''}</span>${t.memo ? `<span class="t-memo">${esc(t.memo)}</span>` : ''}</div>
        <div class="t-act">${s === '종료' || t.kind === 'LMS' ? '' : t.done ? `<button class="btn sm ghost" data-act="undo" data-id="${esc(t.id)}">완료 취소</button>` : `<button class="btn sm" data-act="done" data-id="${esc(t.id)}">완료</button><button class="btn sm ghost" data-act="memo" data-id="${esc(t.id)}">메모</button>`}</div></li>`; }).join('')}</ul>`;
    }).join('')}</section>
    <div class="side">
      <section class="panel"><div class="panel-head"><h2>기본 정보</h2><span class="hint">출처: ${esc(h.source)}</span></div>
        <dl class="kv"><dt>사번</dt><dd>${esc(h.empNo) || '<span class="muted">발급 전 (인사 기본 정보를 가져오면 연결)</span>'}</dd><dt>이메일</dt><dd>${esc(h.email)}</dd>
          <dt>직무</dt><dd>${esc(h.job)}</dd><dt>근무지</dt><dd>${esc(h.site)}</dd><dt>매니저</dt><dd>${esc(h.mgrName)}<span class="small">${esc(h.mgr)}</span></dd>
          <dt>버디</dt><dd>${h.buddy ? esc(h.buddy) : '<span class="muted">지정 전</span>'}</dd></dl></section>
      <section class="panel"><div class="panel-head"><h2>설문</h2><span class="hint">응답은 HR만 봅니다</span></div>
        ${sends.length ? sends.map(x => { const s = S.surveys.find(y => y.id === x.survey); const rs = S.resp.filter(r => r.send === x.id); const state = sendState(x);
          return `<div class="sendbox"><div class="sb-head"><b>${esc(s ? s.name : x.survey)}</b><span class="w-meta">${D.md(x.sentAt)} 발송 · ${state === '응답' ? D.md(x.respondedAt) + ' 응답' + (x.via ? ' (' + esc(x.via) + ')' : '') : state}</span></div>
          ${rs.length ? `<ul class="answers">${rs.map(r => { const qq = s && s.qs.find(q => q.q === r.q); const low = (qq && qq.type === '점수5' && r.score <= 2) || r.answer === '예' && qq && qq.type === '예아니오'; return `<li><span>${esc(qq ? qq.text : r.q)}</span><b class="${low ? 'late' : ''}">${r.score !== '' ? r.score + (qq && qq.type === '추천10' ? '/10' : '/5') : esc(r.answer)}</b></li>`; }).join('')}</ul>` : ''}</div>`; }).join('')
        : '<p class="empty">아직 보낸 설문이 없습니다. 첫 설문은 입사 7일 차에 보냅니다.</p>'}</section>
    </div>
  </div>`;
}

/* ═════════ 설문 ═════════ */
function surveyStats(s) {
  const sends = S.sends.filter(x => x.survey === s.id);
  const answered = sends.filter(x => x.respondedAt).length;
  const closed = sends.filter(x => sendState(x) !== '대기').length;
  const sc = S.resp.filter(r => r.survey === s.id && s.qs.find(q => q.q === r.q && q.type === '점수5'));
  return { sends, answered, closed,
    avg: sc.length ? (sc.reduce((a, r) => a + r.score, 0) / sc.length) : null, waiting: sends.filter(x => sendState(x) === '대기') };
}
function viewSurveys() {
  return `
  <header class="page-head"><div><h1>설문</h1><p class="sub">입사 n일 차가 되면 보낼 대상이 자동으로 잡힙니다. 응답은 개인별 링크로 바로 모이고, 구글 폼으로 받은 응답 파일도 가져올 수 있습니다.</p></div>
    <div class="head-act"><a class="btn" href="#import/survey">구글 폼 응답 가져오기</a><button class="btn primary" data-act="new-survey">새 설문 만들기</button></div></header>
  <section class="panel flush"><div class="scroll"><table class="tbl">
    <thead><tr><th>설문</th><th>받는 사람</th><th>보내는 때</th><th class="num">발송 대기</th><th class="num">보낸 수</th><th class="num">응답률</th><th class="num">평균 (5점)</th><th></th></tr></thead>
    <tbody>${S.surveys.map(s => { const x = surveyStats(s), w = sendTargets(s).length; return `<tr class="click ${s.active ? '' : 'off'}" data-href="#survey/${s.id}">
      <td><a href="#survey/${s.id}"><b>${esc(s.name)}</b></a><span class="small">문항 ${s.qs.length}개${s.active ? '' : ' · 사용 안 함'}</span></td><td>${s.audience}</td><td>입사 ${s.day}일 차</td>
      <td class="num ${w ? 'warn-t' : ''}">${w || '-'}</td><td class="num">${x.sends.length}</td><td class="num">${x.sends.length ? pct(x.answered, x.sends.length) + '%' : '-'}</td>
      <td class="num">${x.avg === null ? '-' : x.avg.toFixed(1)}</td><td>${w && s.active ? `<a class="btn sm primary" href="#survey/${s.id}">발송하기</a>` : ''}</td></tr>`; }).join('')}</tbody>
  </table></div></section>
  <p class="hint">응답률 = 응답 수 ÷ 보낸 수. 보낸 지 ${SURVEY_WINDOW}일이 지나도 답이 없으면 미응답으로 봅니다.</p>`;
}

function viewSurvey(dv, id, tab) {
  const s = S.surveys.find(x => x.id === id);
  if (!s) return '<p class="empty">설문을 찾을 수 없습니다. <a href="#surveys">설문 목록</a></p>';
  tab = tab || (sendTargets(s).length ? 'send' : 'result');
  const tabs = [['send', '보내기'], ['result', '결과'], ['edit', '문항 만들기']];
  return `
  <nav class="crumb"><a href="#surveys">설문</a> / ${esc(s.name)}</nav>
  <header class="page-head"><div><h1>${esc(s.name)}</h1><p class="sub">${s.audience}에게 · 입사 ${s.day}일 차 · 문항 ${s.qs.length}개</p></div>
    <div class="head-act"><a class="btn ghost" href="#respond/preview-${s.id}" target="_blank" rel="noopener">응답 화면 미리 보기</a></div></header>
  <div class="tabs" role="tablist">${tabs.map(([k, l]) => `<a role="tab" aria-selected="${k === tab}" href="#survey/${s.id}/${k}">${l}</a>`).join('')}</div>
  ${tab === 'send' ? surveySend(s) : tab === 'edit' ? surveyEdit(s) : surveyResult(s)}`;
}

function surveySend(s) {
  const targets = sendTargets(s);
  const waiting = S.sends.filter(x => x.survey === s.id && sendState(x) === '대기');
  return `
  <section class="panel">
    <div class="panel-head"><h2>보낼 대상</h2><span class="hint">입사 ${s.day}일 차가 지났고 아직 안 보낸 사람</span></div>
    ${targets.length ? `<form id="send-form"><table class="tbl compact"><thead><tr><th class="cb"><input type="checkbox" checked data-act="check-all" aria-label="모두 선택"></th><th>입사자</th><th>받는 사람</th><th>입사일</th><th>${s.day}일 차</th></tr></thead><tbody>
      ${targets.map(h => `<tr><td class="cb"><input type="checkbox" name="k" value="${esc(h.key)}" checked aria-label="${esc(h.name)}"></td><td>${link(h)}<span class="small">${orgName(h.org)}</span></td><td>${s.audience === '매니저' ? esc(h.mgrName) + ' 매니저<span class="small">' + esc(h.mgr) + '</span>' : esc(h.email)}</td><td>${D.md(h.start)}</td><td>${D.md(D.add(h.start, s.day))}</td></tr>`).join('')}
    </tbody></table><div class="row-act"><button class="btn primary" data-act="send">선택한 사람에게 보내기</button></div></form>
    <p class="hint">보내기를 누르면 사람마다 응답 링크가 만들어지고, 메일에 붙여넣을 안내 문구와 링크 목록이 나옵니다. 응답하면 이 화면에 바로 반영됩니다.</p>`
    : '<p class="empty">지금 보낼 사람이 없습니다. 입사 ' + s.day + '일 차가 되면 여기에 나타납니다.</p>'}
  </section>
  <section class="panel">
    <div class="panel-head"><h2>응답 기다리는 중</h2><span class="count">${waiting.length}명</span>${waiting.length ? '<button class="btn sm" data-act="remind" data-s="' + s.id + '">독촉 문구 복사</button>' : ''}</div>
    ${waiting.length ? `<table class="tbl compact"><thead><tr><th>입사자</th><th>보낸 날</th><th>지난 날</th><th>링크</th></tr></thead><tbody>${waiting.map(x => { const h = hireOf(x.key); const k = D.diff(TODAY, x.sentAt); return `<tr><td>${link(h)}</td><td>${D.md(x.sentAt)}</td><td class="${k >= 3 ? 'late' : ''}">${k}일</td><td><a href="#respond/${x.token}" target="_blank" rel="noopener">응답 링크 열기</a></td></tr>`; }).join('')}</tbody></table>` : '<p class="empty">응답을 기다리는 사람이 없습니다.</p>'}
  </section>`;
}

function surveyResult(s) {
  const x = surveyStats(s);
  const rs = S.resp.filter(r => r.survey === s.id);
  const missed = x.sends.filter(y => sendState(y) === '미응답').length;
  const low = [...new Set(rs.filter(r => { const q = s.qs.find(qq => qq.q === r.q); return q && ((q.type === '점수5' && r.score <= 2) || (q.type === '예아니오' && r.answer === '예')); }).map(r => r.key))];
  return `
  <div class="kpis kpis-4">
    <div class="kpi"><span class="k-label">보낸 수</span><span class="k-val">${x.sends.length}</span></div>
    <div class="kpi"><span class="k-label">응답</span><span class="k-val">${x.answered}</span><span class="k-note">미응답 ${missed} · 대기 ${x.waiting.length}</span></div>
    <div class="kpi"><span class="k-label">응답률</span><span class="k-val">${x.sends.length ? pct(x.answered, x.sends.length) + '%' : '-'}</span></div>
    <div class="kpi ${low.length ? 'bad' : ''}"><span class="k-label">관심 필요</span><span class="k-val">${low.length}명</span><span class="k-note">2점 이하 또는 도움 요청</span></div>
  </div>
  <section class="panel">
    <div class="panel-head"><h2>문항별 결과</h2></div>
    ${s.qs.map(q => {
      const a = rs.filter(r => r.q === q.q);
      if (q.type === '점수5' || q.type === '추천10') {
        const max = q.type === '점수5' ? 5 : 10, min = q.type === '점수5' ? 1 : 0;
        const avg = a.length ? a.reduce((m, r) => m + r.score, 0) / a.length : null;
        const dist = []; for (let v = min; v <= max; v++) dist.push([v, a.filter(r => r.score === v).length]);
        const top = Math.max(1, ...dist.map(d => d[1]));
        const nps = q.type === '추천10' && a.length ? Math.round(((a.filter(r => r.score >= 9).length - a.filter(r => r.score <= 6).length) / a.length) * 100) : null;
        return `<div class="qres"><div class="qr-head"><b>${esc(q.text)}</b><span>${avg === null ? '응답 없음' : '평균 ' + avg.toFixed(1) + ' / ' + max + (nps !== null ? ' · eNPS ' + (nps > 0 ? '+' : '') + nps : '') + ' · ' + a.length + '명'}</span></div>
          <div class="dist">${dist.map(([v, n]) => `<div class="d-col" title="${v}점 ${n}명"><i style="height:${(n / top) * 100}%"></i><span>${v}</span></div>`).join('')}</div></div>`;
      }
      if (q.type === '예아니오') { const y = a.filter(r => r.answer === '예'); return `<div class="qres"><div class="qr-head"><b>${esc(q.text)}</b><span>예 ${y.length}명 · 아니오 ${a.length - y.length}명</span></div>${y.length ? `<p class="p">예라고 답한 입사자: ${y.map(r => link(hireOf(r.key))).join(', ')}</p>` : ''}</div>`; }
      return `<div class="qres"><div class="qr-head"><b>${esc(q.text)}</b><span>${a.length}건</span></div><ul class="voices">${a.slice(-12).reverse().map(r => `<li><p>${esc(r.answer)}</p><span class="small">${link(hireOf(r.key))} · ${D.md(r.at)}</span></li>`).join('')}</ul></div>`;
    }).join('')}
  </section>`;
}

function surveyEdit(s) {
  const T = ['점수5', '추천10', '예아니오', '텍스트'];
  const TL = { 점수5: '1~5점', 추천10: '0~10점 (추천 의향)', 예아니오: '예 / 아니오', 텍스트: '서술형' };
  const used = S.sends.some(x => x.survey === s.id);
  return `<form id="survey-edit" class="panel">
    <div class="fgrid three">
      <label class="fld"><span>설문 이름</span><input name="name" value="${esc(s.name)}" required></label>
      <label class="fld"><span>받는 사람</span><select name="audience">${['입사자', '매니저'].map(a => `<option ${a === s.audience ? 'selected' : ''}>${a}</option>`).join('')}</select></label>
      <label class="fld"><span>보내는 때 (입사 n일 차)</span><input name="day" type="number" min="0" max="365" value="${s.day}" required></label>
    </div>
    <label class="check" style="margin:12px 0 4px"><input type="checkbox" name="active" ${s.active ? 'checked' : ''}> 사용 (끄면 발송 대상이 잡히지 않습니다)</label>
    <h3 class="phase-h">문항</h3>
    <ol class="qedit">${s.qs.map((q, i) => `<li><input name="qt" value="${esc(q.text)}" aria-label="${i + 1}번 문항" required><select name="qy" aria-label="${i + 1}번 응답 방식">${T.map(t => `<option value="${t}" ${t === q.type ? 'selected' : ''}>${TL[t]}</option>`).join('')}</select><input type="hidden" name="qq" value="${esc(q.q)}">
      <button type="button" class="btn sm ghost" data-act="q-up" data-i="${i}" ${i ? '' : 'disabled'} aria-label="위로">↑</button><button type="button" class="btn sm ghost" data-act="q-del" data-i="${i}" aria-label="삭제">삭제</button></li>`).join('')}</ol>
    <div class="row-act"><button type="button" class="btn" data-act="q-add">문항 추가</button><span class="grow"></span><button class="btn primary" data-act="survey-save">저장</button></div>
    ${used ? '<p class="hint">이미 보낸 설문입니다. 문항을 바꾸면 앞으로 보내는 사람부터 바뀐 문항을 받습니다. 기존 응답은 그대로 남습니다.</p>' : ''}
  </form>`;
}
function readSurveyForm(s) {
  const f = $('#survey-edit');
  const qt = [...f.querySelectorAll('[name=qt]')].map(x => x.value.trim()), qy = [...f.querySelectorAll('[name=qy]')].map(x => x.value), qq = [...f.querySelectorAll('[name=qq]')].map(x => x.value);
  s.name = f.name.value.trim() || s.name; s.audience = f.audience.value; s.day = Number(f.day.value) || 0; s.active = f.active.checked;
  s.qs = qt.map((t, i) => ({ q: qq[i] || 'q' + Date.now().toString(36) + i, text: t, type: qy[i] })).filter(q => q.text);
}

/* 응답 화면 (개인 링크) */
function viewRespond(dv, token) {
  const preview = token.startsWith('preview-');
  const x = preview ? null : S.sends.find(y => y.token === token);
  const s = preview ? S.surveys.find(y => y.id === token.slice(8)) : x && S.surveys.find(y => y.id === x.survey);
  if (!s) return `<div class="respond"><h1>설문을 찾을 수 없습니다</h1><p>링크가 잘렸거나 만료되었습니다. 받은 메일의 링크를 다시 눌러 주세요.</p></div>`;
  const h = x && hireOf(x.key);
  if (x && x.respondedAt) return `<div class="respond"><h1>${esc(s.name)}</h1><p class="ok">${D.md(x.respondedAt)}에 응답해 주셨습니다. 감사합니다.</p></div>`;
  if (x && sendState(x) === '미응답') return `<div class="respond"><h1>${esc(s.name)}</h1><p>응답 기간이 지났습니다. 하고 싶은 말이 있으면 온보딩 담당 HR에게 직접 알려 주세요.</p></div>`;
  const who = !h ? '미리 보기 · 응답이 저장되지 않습니다' : s.audience === '매니저' ? `${esc(h.mgrName)} 매니저님 · ${esc(h.name)} 님(${D.md(h.start)} 입사)에 대한 체크인` : `${esc(h.name)} 님 · 입사 ${s.day}일 차`;
  return `<div class="respond"><p class="r-who">${who}</p><h1>${esc(s.name)}</h1><p class="r-note">응답은 온보딩 담당 HR만 봅니다. 매니저에게 개별 응답을 공개하지 않습니다. 2분이면 됩니다.</p>
    <form id="respond-form" data-token="${esc(token)}">${s.qs.map((q, i) => {
      const name = 'a_' + q.q;
      let input;
      if (q.type === '점수5') input = `<div class="scale">${[1, 2, 3, 4, 5].map(v => `<label><input type="radio" name="${name}" value="${v}" required><span>${v}</span><small>${v === 1 ? '전혀 아니다' : v === 5 ? '매우 그렇다' : ''}</small></label>`).join('')}</div>`;
      else if (q.type === '추천10') input = `<div class="scale ten">${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(v => `<label><input type="radio" name="${name}" value="${v}" required><span>${v}</span></label>`).join('')}</div>`;
      else if (q.type === '예아니오') input = `<div class="scale">${['예', '아니오'].map(v => `<label><input type="radio" name="${name}" value="${v}" required><span>${v}</span></label>`).join('')}</div>`;
      else input = `<textarea name="${name}" rows="3" placeholder="선택 사항"></textarea>`;
      return `<fieldset><legend>${i + 1}. ${esc(q.text)}</legend>${input}</fieldset>`;
    }).join('')}<button class="btn primary big">${preview ? '미리 보기라서 제출되지 않습니다' : '제출하기'}</button></form></div>`;
}

/* ═════════ 데이터 가져오기 ═════════ */
const SOURCES = {
  ats: { name: '채용 합격자 명단', from: '채용 시스템(ATS) → 합격자 목록 → 엑셀 내려받기', who: '채용 담당자에게 받거나 직접 내려받기', when: '주 1회, 입사일 변동이 있을 때', match: '이메일',
    does: '새 입사자 추가, 입사일 변경 반영(남은 마감일 다시 계산), 입사 포기 처리',
    fields: [['name', '이름', 1, ['이름', '성명', '지원자명', '지원자']], ['email', '이메일', 1, ['이메일', 'email', 'e-mail', '메일']], ['start', '입사일', 1, ['입사일', '입사 예정일', '입사예정일', '입사 일자']],
      ['type', '채용 구분', 0, ['전형', '채용구분', '채용 구분', '구분']], ['cohort', '기수', 0, ['기수', '차수']], ['org', '부서', 1, ['배치부서', '부서', '소속', '배치 부서']],
      ['job', '직무', 0, ['직무', '모집직무', '포지션']], ['rank', '직급', 0, ['직급', '직위']], ['site', '근무지', 0, ['근무지', '근무 장소']],
      ['mgr', '매니저 이메일', 0, ['현업 담당자 이메일', '매니저 이메일', '팀장 이메일', '담당자 이메일']], ['state', '상태', 0, ['합격자 상태', '상태', '진행 상태', '입사 여부']]] },
  hris: { name: '인사 기본 정보', from: '인사 시스템(HRIS) → 인사 기본 정보 조회 → 엑셀 내려받기', who: '인사 담당 (본인)', when: '주 1회', match: '이름 + 입사일',
    does: '사번 연결, 직급 갱신, 퇴직자 처리(남은 할 일 종료)',
    fields: [['empNo', '사번', 1, ['사번', '사원번호', '직원번호']], ['name', '이름', 1, ['성명', '이름']], ['start', '입사일', 1, ['입사일', '그룹입사일', '입사 일자']],
      ['org', '소속', 0, ['소속', '부서']], ['rank', '직급', 0, ['직급', '직위']], ['state', '재직 구분', 0, ['재직구분', '재직 구분', '재직상태', '상태']], ['leave', '퇴직일', 0, ['퇴직일', '퇴사일']]] },
  lms: { name: '교육 수료 현황', from: 'LMS → 과정별 수료 현황 → 엑셀 내려받기', who: '교육 담당자에게 받거나 직접 내려받기', when: '주 1회', match: '사번 + 과정 코드',
    does: '의무·법정 교육 항목을 수료일로 완료 처리',
    fields: [['empNo', '사번', 1, ['사번', '사원번호']], ['course', '과정 코드', 1, ['과정코드', '과정 코드', 'course']], ['doneAt', '수료일', 0, ['수료일', '이수일', '완료일']], ['result', '수료 여부', 1, ['수료여부', '이수여부', '수료 여부', '결과']]] },
  survey: { name: '설문 응답 (구글 폼·MS Forms)', from: '구글 폼 → 응답 → 스프레드시트에서 보기 → 다운로드(.xlsx/.csv)', who: '본인', when: '구글 폼으로 설문을 돌렸을 때', match: '이메일 (매니저 설문은 이메일 + 입사자 이름)',
    does: '응답을 입사자에게 연결하고 결과에 반영',
    fields: [['email', '이메일', 1, ['이메일 주소', '이메일', 'email']], ['at', '제출 시각', 0, ['타임스탬프', 'timestamp', '제출 시간', '완료 시간']], ['hire', '입사자 이름 (매니저 설문)', 0, ['입사자 이름', '입사자', '대상자']]] },
};
let IMP = null; // { src, file, head, rows, map, surveyId, plan }

function viewImport(dv, src) {
  if (!SOURCES[src]) src = '';
  const cards = Object.keys(SOURCES).map(k => { const m = SOURCES[k], at = S.lastImport[k];
    return `<a class="src ${k === src ? 'on' : ''}" href="#import/${k}"><b>${m.name}</b><span class="w-meta">${esc(m.from.split(' → ')[0])} · ${at ? D.md(at) + ' 가져옴' : '가져온 적 없음'}${CONN.sources[k] ? ' · 연결됨' : ''}</span></a>`; }).join('');
  return `
  <header class="page-head"><div><h1>데이터 가져오기</h1><p class="sub">이미 쓰고 있는 시스템에서 엑셀을 내려받아 올리거나, Google 시트·API로 연결해 바로 받아옵니다. 열 이름이 달라도 맞춰서 읽습니다.</p></div></header>
  <div class="import-grid">
    <nav class="srcs" aria-label="가져올 데이터">${cards}</nav>
    <section class="panel">${src ? importPanel(src) : `<p class="empty">왼쪽에서 가져올 데이터를 고르세요.</p>`}</section>
  </div>
  <section class="panel"><div class="panel-head"><h2>가져온 기록</h2></div>
    <table class="tbl compact"><thead><tr><th>날짜</th><th>데이터</th><th>파일</th><th>결과</th></tr></thead><tbody>${S.imports.slice().reverse().slice(0, 12).map(x => `<tr><td>${D.md(x.at)}</td><td>${SOURCES[x.source] ? SOURCES[x.source].name : x.source}</td><td>${esc(x.file)}</td><td>${esc(x.summary)}</td></tr>`).join('')}</tbody></table></section>`;
}

function importPanel(src) {
  const m = SOURCES[src];
  if (!IMP || IMP.src !== src) IMP = { src, surveyId: src === 'survey' ? (S.surveys.find(s => S.sends.some(x => x.survey === s.id && !x.respondedAt)) || S.surveys[0]).id : '' };
  const step = !IMP.rows ? 1 : !IMP.plan ? 2 : 3;
  return `
  <div class="panel-head"><h2>${m.name}</h2></div>
  <dl class="kv wide"><dt>어디서</dt><dd>${esc(m.from)}</dd><dt>누가</dt><dd>${esc(m.who)}</dd><dt>언제</dt><dd>${esc(m.when)}</dd><dt>같은 사람 판단</dt><dd>${esc(m.match)}</dd><dt>반영되는 것</dt><dd>${esc(m.does)}</dd></dl>
  <ol class="steps"><li class="${step >= 1 ? 'on' : ''}">파일 올리기</li><li class="${step >= 2 ? 'on' : ''}">열 맞추기</li><li class="${step >= 3 ? 'on' : ''}">바뀌는 내용 확인</li></ol>
  ${src === 'survey' ? `<label class="fld inline"><span>어느 설문의 응답인가요?</span><select data-act="imp-survey">${S.surveys.map(s => `<option value="${s.id}" ${s.id === IMP.surveyId ? 'selected' : ''}>${esc(s.name)} (${s.audience})</option>`).join('')}</select></label>` : ''}
  ${step === 1 ? `
    ${apiPanel(src)}
    <p class="drop-req">꼭 있어야 하는 열 ${SOURCES[src].fields.filter(f => f[2]).map(f => `<i>${esc(f[1])}</i>`).join('')}<span>열 이름이 달라도 다음 단계에서 맞출 수 있습니다.</span></p>
    <label class="drop" id="drop" for="imp-file">
      <input type="file" id="imp-file" class="sr" accept=".xlsx,.xls,.csv,.tsv,.txt">
      <svg class="drop-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 18v-6M9 14.5 12 11.5l3 3"/></svg>
      <span class="drop-title">엑셀 파일을 여기에 끌어다 놓으세요</span>
      <span class="drop-sub">또는 <u>눌러서 파일 고르기</u> <span class="nw">(.xlsx, .csv)</span></span>
    </label>
    <div class="drop-alt">
      <button class="alt" data-act="sample" data-src="${src}"><b>샘플 엑셀 받기</b><span>화면 속 데이터와 맞물린 파일이라 그대로 올리면 실제로 반영됩니다.</span></button>
      <button class="alt" data-act="paste-toggle" aria-expanded="false" aria-controls="paste-box"><b>엑셀에서 복사해 붙여넣기</b><span>파일 없이 엑셀 표를 복사해서 바로 넣습니다.</span></button>
      <button class="alt" data-act="api-toggle" aria-expanded="false" aria-controls="api-box"><b>Google 시트·API로 연결</b><span>한 번 연결해 두면 다음부터 버튼 한 번으로 받아옵니다.</span></button>
    </div>
    ${apiBox(src)}
    <div id="paste-box" class="paste-box" hidden><textarea id="imp-paste" rows="6" placeholder="엑셀에서 머리글 줄까지 선택해 복사(Ctrl+C)한 뒤 여기에 붙여넣으세요(Ctrl+V)"></textarea><div class="row-act"><button class="btn primary" data-act="imp-paste">붙여넣은 내용 읽기</button></div></div>`
  : step === 2 ? mappingStep(src) : planStep(src)}`;
}

function mappingStep(src) {
  const m = SOURCES[src];
  const fields = m.fields.concat(src === 'survey' ? S.surveys.find(s => s.id === IMP.surveyId).qs.map(q => ['q:' + q.q, '문항: ' + q.text, 0, [q.text]]) : []);
  if (!IMP.map) IMP.map = guessMap(fields, IMP.head);
  return `<p class="p"><b>${esc(IMP.file)}</b> · ${IMP.rows.length}줄. 각 항목이 파일의 어느 열인지 확인하세요. 자동으로 맞춘 결과입니다.</p>
    <table class="tbl compact map"><thead><tr><th>대시보드 항목</th><th>파일의 열</th><th>첫 줄 값</th></tr></thead><tbody>
    ${fields.map(([k, l, req]) => { const i = IMP.map[k]; return `<tr><th scope="row">${esc(l)}${req ? ' <span class="late">*</span>' : ''}</th><td><select data-map="${esc(k)}"><option value="">— 없음 —</option>${IMP.head.map((h, j) => `<option value="${j}" ${i === j ? 'selected' : ''}>${esc(h)}</option>`).join('')}</select></td><td class="muted">${i === undefined || i === '' ? '' : esc(fmtCell(IMP.rows[0] && IMP.rows[0][i]))}</td></tr>`; }).join('')}
    </tbody></table>
    <div class="row-act"><button class="btn ghost" data-act="imp-reset">다른 파일</button><span class="grow"></span><button class="btn primary" data-act="imp-plan">바뀌는 내용 보기</button></div>`;
}
const fmtCell = v => (v instanceof Date ? D.parse(v) : v);
function guessMap(fields, head) {
  const norm = s => String(s).replace(/\s/g, '').toLowerCase();
  const map = {};
  fields.forEach(([k, , , syn]) => {
    const hs = head.map(norm);
    let i = -1;
    syn.some(sy => { i = hs.indexOf(norm(sy)); return i >= 0; });
    if (i < 0) syn.some(sy => { i = hs.findIndex(h => h && (h.includes(norm(sy)) || norm(sy).includes(h))); return i >= 0; });
    if (i >= 0) map[k] = i;
  });
  return map;
}

function planStep(src) {
  const p = IMP.plan;
  const sec = (title, list, fn, cls) => list.length ? `<details ${list.length <= 8 ? 'open' : ''} class="pl ${cls || ''}"><summary><b>${title}</b> ${list.length}건</summary><ul>${list.map(fn).join('')}</ul></details>` : '';
  return `<p class="p">아직 반영되지 않았습니다. 아래 내용을 확인하고 <b>반영하기</b>를 누르세요.</p>
    ${sec('새 입사자', p.add || [], x => `<li>${esc(x.name)} · ${esc(orgName(x.org))} · ${D.md(x.start)} 입사 <span class="muted">할 일 자동 생성</span></li>`, 'add')}
    ${sec('입사일 변경', p.moved || [], x => `<li>${esc(x.h.name)} · ${D.md(x.h.start)} → <b>${D.md(x.start)}</b> <span class="muted">남은 할 일 마감일 다시 계산</span></li>`, 'chg')}
    ${sec('입사 포기', p.cancel || [], x => `<li>${esc(x.h.name)} · ${D.md(x.h.start)} 입사 예정이었음 <span class="muted">남은 할 일 종료 · IT·총무에 취소 알림 필요</span></li>`, 'bad')}
    ${sec('사번 연결', p.emp || [], x => `<li>${esc(x.h.name)} → ${esc(x.empNo)}</li>`, 'add')}
    ${sec('퇴직 처리', p.leave || [], x => `<li>${esc(x.h.name)} · ${D.md(x.leave)} 퇴직 <span class="muted">남은 할 일 종료</span></li>`, 'bad')}
    ${sec('정보 갱신', p.update || [], x => `<li>${esc(x.h.name)} · ${esc(x.what)}</li>`)}
    ${sec('교육 수료 반영', p.done || [], x => `<li>${esc(x.h.name)} · ${esc(COURSES[x.t.link] || x.t.link)} · ${D.md(x.at)} 수료</li>`, 'add')}
    ${sec('설문 응답 반영', p.answers || [], x => `<li>${esc(x.h.name)} · ${D.md(x.at)} 응답</li>`, 'add')}
    ${sec('건너뜀', p.skip || [], x => `<li>${esc(x.row)} <span class="muted">${esc(x.why)}</span></li>`, 'skip')}
    ${p.same ? `<p class="hint">바뀐 것이 없는 줄 ${p.same}건</p>` : ''}
    <div class="row-act"><button class="btn ghost" data-act="imp-back">열 다시 맞추기</button><span class="grow"></span><button class="btn primary" data-act="imp-apply" ${p.count ? '' : 'disabled'}>반영하기 (${p.count}건)</button></div>`;
}

function bindImport() {
  const f = $('#imp-file'), drop = $('#drop');
  if (f) f.addEventListener('change', () => f.files[0] && readFile(f.files[0]));
  if (drop) {
    ['dragover', 'dragenter'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('hover'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, () => drop.classList.remove('hover')));
    drop.addEventListener('drop', e => { e.preventDefault(); const file = e.dataTransfer.files[0]; if (file) readFile(file); });
  }
}
function readFile(file) {
  const reader = new FileReader();
  const isCsv = /\.(csv|tsv|txt)$/i.test(file.name);
  reader.onload = () => {
    try {
      let grid;
      if (!isCsv && window.XLSX) {
        const wb = XLSX.read(reader.result, { type: 'array', cellDates: true });
        grid = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
      } else grid = parseText(typeof reader.result === 'string' ? reader.result : new TextDecoder('utf-8').decode(reader.result));
      loadGrid(grid, file.name);
    } catch (e) { toast('파일을 읽지 못했습니다. 엑셀(.xlsx) 또는 CSV인지 확인하세요.'); }
  };
  if (!isCsv && window.XLSX) reader.readAsArrayBuffer(file); else reader.readAsText(file, 'utf-8');
}
function parseText(text) {
  text = text.replace(/^﻿/, '');
  const sep = text.split('\n')[0].includes('\t') ? '\t' : ',';
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true; else if (c === sep) { row.push(cell); cell = ''; } else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
function loadGrid(grid, name) {
  grid = grid.filter(r => r.some(c => String(c).trim() !== ''));
  if (grid.length < 2) { toast('머리글 줄과 데이터가 있어야 합니다.'); return; }
  Object.assign(IMP, { file: name, head: grid[0].map(String), rows: grid.slice(1), map: null, plan: null });
  render();
}

const val = (row, k) => { const i = IMP.map[k]; return i === undefined || i === '' ? '' : row[i]; };
const str = v => String(fmtCell(v) == null ? '' : fmtCell(v)).trim();
function orgCode(v) { v = str(v); const o = ORGS.find(x => x.name === v || x.code === v || x.name.replace(/팀$/, '') === v.replace(/팀$/, '')); return o ? o.code : v; }
function typeOf(v) { v = str(v); return /경력/.test(v) ? '경력' : /공채|신입/.test(v) ? '신입 공채' : v ? '수시' : '수시'; }

function makePlan() {
  const src = IMP.src, fields = SOURCES[src].fields;
  const miss = fields.filter(f => f[2] && (IMP.map[f[0]] === undefined || IMP.map[f[0]] === '')).map(f => f[1]);
  if (miss.length) { toast('필수 항목의 열을 골라 주세요: ' + miss.join(', ')); return; }
  const p = { add: [], moved: [], cancel: [], emp: [], leave: [], update: [], done: [], answers: [], skip: [], same: 0 };
  const rowLabel = r => r.filter(c => str(c)).slice(0, 3).map(str).join(' / ');
  IMP.rows.forEach(row => {
    if (src === 'ats') {
      const name = str(val(row, 'name')), email = str(val(row, 'email')).toLowerCase(), start = D.parse(val(row, 'start'));
      if (!name || !email || !start) return p.skip.push({ row: rowLabel(row), why: !start ? '입사일을 읽을 수 없음' : '이름·이메일 없음' });
      const h = S.hires.find(x => x.email.toLowerCase() === email);
      const state = str(val(row, 'state'));
      if (/포기|취소|철회|불합격/.test(state)) { if (h && h.status !== '입사 취소') p.cancel.push({ h }); else p.same++; return; }
      const rec = { name, email, start, type: typeOf(val(row, 'type')), cohort: str(val(row, 'cohort')), org: orgCode(val(row, 'org')), job: str(val(row, 'job')), rank: str(val(row, 'rank')) || '사원', site: str(val(row, 'site')) || '본사', mgr: str(val(row, 'mgr')).toLowerCase() };
      if (!h) return p.add.push(rec);
      if (h.start !== start) p.moved.push({ h, start });
      const diff = ['org', 'rank', 'site', 'job'].filter(k => rec[k] && rec[k] !== h[k]);
      if (rec.mgr && rec.mgr !== h.mgr) diff.push('mgr');
      if (diff.length) p.update.push({ h, rec, keys: diff, what: diff.map(k => ({ org: '부서', rank: '직급', site: '근무지', job: '직무', mgr: '매니저' }[k])).join(', ') + ' 변경' });
      else if (h.start === start) p.same++;
    } else if (src === 'hris') {
      const empNo = str(val(row, 'empNo')), name = str(val(row, 'name')), start = D.parse(val(row, 'start'));
      if (!empNo || !name) return p.skip.push({ row: rowLabel(row), why: '사번·이름 없음' });
      const h = S.hires.find(x => x.empNo === empNo) || S.hires.find(x => x.name === name && x.start === start && x.status !== '입사 취소');
      if (!h) return p.skip.push({ row: rowLabel(row), why: '온보딩 대상이 아님 (명단에 없음)' });
      let changed = false;
      if (!h.empNo) { p.emp.push({ h, empNo }); changed = true; }
      const leave = D.parse(val(row, 'leave')), state = str(val(row, 'state'));
      if (!h.leave && (leave || /퇴/.test(state))) { p.leave.push({ h, leave: leave || TODAY }); changed = true; }
      const rank = str(val(row, 'rank'));
      if (rank && rank !== h.rank) { p.update.push({ h, rec: { rank }, keys: ['rank'], what: '직급 ' + h.rank + ' → ' + rank }); changed = true; }
      if (!changed) p.same++;
    } else if (src === 'lms') {
      const empNo = str(val(row, 'empNo')), course = str(val(row, 'course')), result = str(val(row, 'result'));
      const h = S.hires.find(x => x.empNo === empNo);
      if (!h) return p.skip.push({ row: rowLabel(row), why: '사번이 온보딩 명단에 없음' });
      if (/미|불|fail|^n$/i.test(result) || !/수료|이수|완료|^y$|pass/i.test(result)) return p.skip.push({ row: h.name + ' / ' + course, why: '아직 수료 전 (' + result + ')' });
      const t = S.tasks.find(x => x.key === h.key && x.kind === 'LMS' && x.link === course);
      if (!t) return p.skip.push({ row: h.name + ' / ' + course, why: '온보딩 교육 과정이 아님' });
      if (t.done || t.closed) { p.same++; return; }
      p.done.push({ h, t, at: D.parse(val(row, 'doneAt')) || TODAY });
    } else if (src === 'survey') {
      const s = S.surveys.find(x => x.id === IMP.surveyId);
      const email = str(val(row, 'email')).toLowerCase();
      let cands = s.audience === '매니저' ? S.hires.filter(x => x.mgr.toLowerCase() === email) : S.hires.filter(x => x.email.toLowerCase() === email);
      if (s.audience === '매니저') { const hn = str(val(row, 'hire')); if (hn) cands = cands.filter(x => x.name === hn); else cands = cands.filter(x => S.sends.some(y => y.survey === s.id && y.key === x.key && !y.respondedAt)); }
      if (cands.length !== 1) return p.skip.push({ row: email || rowLabel(row), why: cands.length ? '입사자를 하나로 특정할 수 없음 (입사자 이름 열 필요)' : '이메일이 명단에 없음' });
      const h = cands[0];
      const x = S.sends.find(y => y.survey === s.id && y.key === h.key);
      if (x && x.respondedAt) { p.same++; return; }
      const at = D.parse(val(row, 'at')) || TODAY;
      const ans = s.qs.map(q => { const v = val(row, 'q:' + q.q); const t = str(v); if (q.type === '점수5' || q.type === '추천10') { const n = parseInt(t, 10); return isNaN(n) ? null : { q: q.q, score: n, answer: '' }; } return t ? { q: q.q, score: '', answer: t } : null; }).filter(Boolean);
      if (!ans.length) return p.skip.push({ row: h.name, why: '문항 열을 찾지 못함' });
      p.answers.push({ h, x, at, ans, s });
    }
  });
  p.count = p.add.length + p.moved.length + p.cancel.length + p.emp.length + p.leave.length + p.update.length + p.done.length + p.answers.length;
  IMP.plan = p;
  render();
}

function applyPlan() {
  const p = IMP.plan, src = IMP.src;
  p.add.forEach(rec => {
    const m = Object.values(MANAGERS).find(x => x[1] === rec.mgr);
    const h = Object.assign({ key: newKey(S.hires, rec.start), empNo: '', buddy: '', status: '', leave: '', note: '', source: '채용 시스템', mgrName: m ? m[0] : (rec.mgr ? rec.mgr.split('@')[0] : '미정') }, rec);
    if (!h.mgr) { const mm = MANAGERS[h.org]; if (mm) { h.mgr = mm[1]; h.mgrName = mm[0]; } }
    S.hires.push(h); S.tasks.push(...makeTasks(h, S.template, S.settings, TODAY));
  });
  p.moved.forEach(({ h, start }) => {
    h.note = (h.note ? h.note + ' / ' : '') + D.md(TODAY) + ' 입사일 변경 ' + D.md(h.start) + '→' + D.md(start);
    h.start = start;
    S.tasks.filter(t => t.key === h.key && !t.done && !t.closed).forEach(t => { t.due = dueOf(S.template.find(x => x.code === t.code) || t, h, S.settings); });
  });
  p.cancel.forEach(({ h }) => { h.status = '입사 취소'; h.note = D.md(TODAY) + ' 채용 시스템에서 입사 포기'; S.tasks.filter(t => t.key === h.key && !t.done).forEach(t => { t.closed = '입사 취소'; }); });
  p.emp.forEach(({ h, empNo }) => { h.empNo = empNo; });
  p.leave.forEach(({ h, leave }) => { h.leave = leave; h.note = '인사 시스템 퇴직 처리'; S.tasks.filter(t => t.key === h.key && !t.done).forEach(t => { t.closed = '퇴사'; }); });
  p.update.forEach(({ h, rec, keys }) => keys.forEach(k => { h[k] = rec[k]; if (k === 'mgr') { const m = Object.values(MANAGERS).find(x => x[1] === rec.mgr); h.mgrName = m ? m[0] : rec.mgr.split('@')[0]; } }));
  p.done.forEach(({ t, at }) => { t.done = at; t.by = 'LMS 가져오기'; });
  p.answers.forEach(({ h, x, at, ans, s }) => {
    if (!x) { x = { id: 'SND-' + (S.sends.length + 1) + '-' + Date.now().toString(36), survey: s.id, key: h.key, sentAt: at, token: Math.random().toString(36).slice(2), respondedAt: '', via: '' }; S.sends.push(x); }
    x.respondedAt = at; x.via = '구글 폼 가져오기';
    ans.forEach(a => S.resp.push(Object.assign({ send: x.id, survey: s.id, key: h.key, at }, a)));
  });
  const parts = [[p.add, '새 입사자'], [p.moved, '입사일 변경'], [p.cancel, '입사 포기'], [p.emp, '사번 연결'], [p.leave, '퇴직'], [p.update, '정보 갱신'], [p.done, '수료 반영'], [p.answers, '응답 반영']].filter(x => x[0].length).map(x => x[1] + ' ' + x[0].length);
  S.lastImport[src] = TODAY;
  S.imports.push({ at: TODAY, source: src, file: IMP.file, summary: parts.join(', ') || '변경 없음' });
  const msg = parts.join(', ') + ' 반영했습니다.';
  const cancelled = p.cancel.map(x => x.h);
  IMP = null; save(); toast(msg);
  if (cancelled.length) modal('입사 포기 알림', `<p>아래 입사자의 준비를 취소해야 합니다. IT·총무·매니저에게 보낼 문구입니다.</p><textarea rows="7" readonly>${esc('신규 입사자 준비 취소 안내드립니다.\n\n' + cancelled.map(h => `- ${h.name} (${orgName(h.org)}, ${D.md(h.start)} 입사 예정): 입사 포기로 계정·노트북·자리·출입증 준비를 취소해 주세요.`).join('\n'))}</textarea>`, null, null);
}

function downloadSample(src) {
  const today = TODAY;
  const grid = src === 'ats' ? sampleATS(S, today) : src === 'hris' ? sampleHRIS(S, today) : src === 'lms' ? sampleLMS(S) : sampleSurvey(S, IMP.surveyId);
  const name = { ats: '채용시스템_합격자명단', hris: '인사시스템_인사기본정보', lms: 'LMS_수료현황', survey: '구글폼_응답_' + (S.surveys.find(s => s.id === (IMP && IMP.surveyId)) || {}).name }[src] + '_' + today;
  if (window.XLSX) {
    const ws = XLSX.utils.aoa_to_sheet(grid); ws['!cols'] = grid[0].map(() => ({ wch: 16 }));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Sheet1'); XLSX.writeFile(wb, name + '.xlsx');
  } else {
    const csv = '﻿' + grid.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = name + '.csv'; a.click();
  }
}

/* ═════════ 체크리스트 설정 ═════════ */
function viewSettings() {
  const q = UI.tq.trim().toLowerCase();
  const rows = S.template.map((t, i) => [t, i]).filter(([t]) => (!UI.towner || t.owner === UI.towner) &&
    (!q || [t.title, t.code, t.owner, t.kind, t.target, t.link].some(v => String(v || '').toLowerCase().includes(q))));
  const owners = [...new Set(S.template.map(t => t.owner))];
  return `
  <header class="page-head"><div><h1>체크리스트 설정</h1><p class="sub">입사자가 추가되면 이 목록대로 할 일과 기한이 만들어집니다. 바꾼 내용은 앞으로 추가되는 입사자부터 적용됩니다.</p></div>
    <div class="head-act"><button class="btn primary" data-act="tpl-edit" data-i="-1">항목 추가</button></div></header>
  <div class="filters">
    <input type="search" placeholder="항목 이름, 코드, 방식, 대상" value="${esc(UI.tq)}" data-f="tq" aria-label="체크리스트 검색">
    <select data-f="towner" aria-label="담당"><option value="">담당 전체</option>${owners.map(o => `<option ${o === UI.towner ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>
    <span class="hint">${rows.length === S.template.length ? '전체 ' + rows.length + '개' : S.template.length + '개 중 ' + rows.length + '개'}</span>
  </div>
  <section class="panel flush"><div class="scroll"><table class="tbl">
    <thead><tr><th>항목</th><th>담당</th><th>방식</th><th>기한</th><th class="num">챙기기 시작</th><th>대상</th><th></th></tr></thead>
    <tbody>${rows.length ? '' : '<tr><td colspan="7" class="empty">찾는 항목이 없습니다.</td></tr>'}${rows.map(([t, i]) => `<tr class="${t.active ? '' : 'off'}"><td><b>${esc(t.title)}</b><span class="small">${esc(t.code)}</span></td><td>${t.owner}</td><td>${t.kind}${t.link ? `<span class="small">${esc(t.link)}</span>` : ''}</td>
      <td>${t.rule === 'nextMonth15' ? '입사한 달의 다음 달 15일 (법정)' : t.rule === 'probation' ? '수습 종료 5일 전' : t.offset < 0 ? '입사 ' + -t.offset + '일 전' : t.offset === 0 ? '입사일' : '입사 ' + t.offset + '일 후'}</td>
      <td class="num">${t.lead}일 전</td><td>${esc(t.target)}</td><td class="nowrap"><button class="btn sm ghost" data-act="tpl-edit" data-i="${i}">수정</button><button class="btn sm ghost" data-act="tpl-toggle" data-i="${i}">${t.active ? '사용 중지' : '다시 사용'}</button></td></tr>`).join('')}</tbody>
  </table></div></section>
  <div class="home-grid two">
    <section class="panel"><div class="panel-head"><h2>규정</h2></div>
      <label class="fld inline"><span>수습 기간</span><select data-act="probation">${[0, 1, 2, 3, 6].map(m => `<option value="${m}" ${m === S.settings.probationMonths ? 'selected' : ''}>${m ? m + '개월' : '없음'}</option>`).join('')}</select></label>
      <p class="hint">수습 평가 기한은 수습 종료 5일 전으로 잡힙니다.</p></section>
    <section class="panel"><div class="panel-head"><h2>내보내기·초기화</h2></div>
      <div class="row-act"><button class="btn" data-act="export" data-v="hires">입사자 엑셀</button><button class="btn" data-act="export" data-v="tasks">할 일 엑셀</button><button class="btn" data-act="export" data-v="resp">설문 응답 엑셀</button></div>
      <p class="hint">이 데모의 데이터는 이 브라우저에만 저장됩니다.</p>
      <div class="row-act"><button class="btn ghost danger" data-act="reset">예시 데이터로 되돌리기</button></div></section>
  </div>`;
}

/* ═════════ 동작 ═════════ */
const field = (name, label, val, type, extra) => `<label class="fld"><span>${label}</span>${type === 'select' ? `<select name="${name}">${extra.map(o => `<option value="${esc(o[0])}" ${o[0] === val ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select>` : `<input name="${name}" type="${type || 'text'}" value="${esc(val == null ? '' : val)}" ${extra || ''}>`}</label>`;

function hireForm(h) {
  h = h || { type: '수시', org: 'HRM', site: '본사', rank: '사원', start: D.add(TODAY, 14) };
  return `<div class="fgrid">${field('name', '이름 *', h.name, 'text', 'required')}${field('email', '이메일 *', h.email, 'email', 'required')}${field('start', '입사일 *', h.start, 'date', 'required')}
    ${field('type', '채용 구분', h.type, 'select', HIRE_TYPES.map(x => [x, x]))}${field('org', '부서', h.org, 'select', ORGS.map(o => [o.code, o.name]))}${field('rank', '직급', h.rank)}
    ${field('job', '직무', h.job)}${field('site', '근무지', h.site, 'select', [['본사', '본사'], ['연구소', '연구소'], ['공장', '공장']])}${field('empNo', '사번', h.empNo)}${field('buddy', '버디', h.buddy)}</div>`;
}
function actNewHire() {
  modal('한 명 직접 등록', `<p class="m-note" style="margin:0 0 12px">보통은 <a href="#import/ats">합격자 명단 가져오기</a>로 추가합니다. 명단에 없는 예외(전입, 재입사 등)만 여기서 등록하세요.</p>` + hireForm(), fd => {
    const v = Object.fromEntries(fd.entries());
    if (!v.name || !v.email || !v.start) return '이름, 이메일, 입사일을 채워 주세요.';
    if (S.hires.some(h => h.email.toLowerCase() === v.email.toLowerCase())) return '같은 이메일의 입사자가 이미 있습니다.';
    const m = MANAGERS[v.org];
    const h = Object.assign({ key: newKey(S.hires, v.start), status: '', leave: '', note: '', source: '직접 등록', mgr: m[1], mgrName: m[0], cohort: '' }, v);
    S.hires.push(h); S.tasks.push(...makeTasks(h, S.template, S.settings, TODAY));
    save(); location.hash = '#hire/' + encodeURIComponent(h.key); toast(h.name + ' 님을 등록하고 할 일을 만들었습니다.');
  }, '등록');
}
function actEditHire(key) {
  const h = hireOf(key);
  modal('정보 수정', hireForm(h) + '<p class="m-note">입사일을 바꾸면 끝나지 않은 할 일의 기한이 다시 계산됩니다.</p>', fd => {
    const v = Object.fromEntries(fd.entries());
    const moved = v.start && v.start !== h.start;
    Object.assign(h, v);
    if (v.org && MANAGERS[v.org] && !Object.values(MANAGERS).some(m => m[1] === h.mgr && MANAGERS[v.org][1] === h.mgr)) { h.mgr = MANAGERS[v.org][1]; h.mgrName = MANAGERS[v.org][0]; }
    S.tasks.filter(t => t.key === key && !t.done && !t.closed).forEach(t => { if (moved) t.due = dueOf(S.template.find(x => x.code === t.code) || t, h, S.settings); if (t.kind === '버디' && h.buddy) { t.done = TODAY; t.by = 'HR 체크'; } });
    save(); toast('저장했습니다.');
  });
}
function actLeave(key) {
  const h = hireOf(key);
  modal(esc(h.name) + ' 님 퇴사·입사 취소', field('kind', '구분', D.diff(TODAY, h.start) < 0 ? '입사 취소' : '퇴사', 'select', [['퇴사', '퇴사'], ['입사 취소', '입사 취소 (입사 전 포기)']]) + field('at', '날짜', TODAY, 'date') + field('note', '사유 (선택)', '') + '<p class="m-note">남은 할 일이 모두 종료됩니다.</p>', fd => {
    if (fd.get('kind') === '입사 취소') h.status = '입사 취소'; else h.leave = fd.get('at');
    h.note = fd.get('note');
    S.tasks.filter(t => t.key === key && !t.done).forEach(t => { t.closed = fd.get('kind'); });
    save(); toast('처리했습니다.');
  }, '처리');
}
function actMemo(id) {
  const t = S.tasks.find(x => x.id === id), h = hireOf(t.key);
  modal('메모 · ' + esc(t.title), `<p class="m-note" style="margin:0 0 10px">${esc(h.name)} · ${D.md(t.due)}까지. 메모가 있으면 '문제'로 표시되고, 비우면 해결로 처리됩니다.</p><label class="fld"><span>메모</span><textarea name="memo" rows="3">${esc(t.memo)}</textarea></label>`, fd => {
    const m = String(fd.get('memo') || '').trim();
    t.memo = memoValue(t, m);
    save(); toast(m ? '메모를 남겼습니다.' : '해결로 처리했습니다.');
  });
}
function actTpl(i) {
  const t = i >= 0 ? S.template[i] : { code: '', title: '', owner: 'HR', kind: '체크', offset: 0, lead: 3, link: '', target: '전체', rule: '', active: true };
  modal(i >= 0 ? '항목 수정' : '항목 추가', `<div class="fgrid">${field('title', '항목 *', t.title, 'text', 'required')}${field('code', '코드 *', t.code, 'text', 'required' + (i >= 0 ? ' readonly' : ''))}
    ${field('owner', '담당', t.owner, 'select', OWNERS.map(x => [x, x]))}${field('kind', '방식', t.kind, 'select', KINDS.map(x => [x, x]))}
    ${t.rule ? '' : field('offset', '기한 (입사일 기준, 입사 전은 음수)', t.offset, 'number')}${field('lead', '챙기기 시작 (기한 며칠 전)', t.lead, 'number', 'min="0"')}
    ${field('link', 'LMS 과정 코드', t.link)}${field('target', '대상 (전체 또는 신입 공채, 수시, 경력)', t.target)}</div>`, fd => {
    const v = Object.fromEntries(fd.entries());
    if (!v.title || !v.code) return '항목과 코드를 채워 주세요.';
    if (i < 0 && S.template.some(x => x.code === v.code)) return '이미 있는 코드입니다.';
    Object.assign(t, { title: v.title.trim(), code: v.code.trim(), owner: v.owner, kind: v.kind, offset: v.offset === undefined ? t.offset : Number(v.offset), lead: Number(v.lead) || 0, link: v.link.trim(), target: v.target.trim() || '전체' });
    if (i < 0) S.template.push(t);
    save(); toast('저장했습니다. 앞으로 추가되는 입사자부터 적용됩니다.');
  });
}
function actSend(sid) {
  const s = S.surveys.find(x => x.id === sid);
  const keys = [...document.querySelectorAll('#send-form [name=k]:checked')].map(x => x.value);
  if (!keys.length) { toast('보낼 사람을 고르세요.'); return; }
  const made = keys.map(k => { const x = { id: 'SND-' + (S.sends.length + 1) + '-' + Date.now().toString(36), survey: sid, key: k, sentAt: TODAY, token: Math.random().toString(36).slice(2, 12), respondedAt: '', via: '' }; S.sends.push(x); return x; });
  persist();
  const rows = made.map(x => { const h = hireOf(x.key); return { h, to: s.audience === '매니저' ? h.mgr : h.email, url: respondUrl(x.token) }; });
  const mail = s.audience === '매니저'
    ? `[온보딩] ${s.name} 부탁드립니다\n\n매니저님, 안녕하세요. 온보딩 담당 HR입니다.\n팀에 새로 오신 분이 입사 ${s.day}일을 맞았습니다. 1분이면 끝나는 체크인에 답해 주세요.\n응답은 HR만 보며, 필요한 경우 HR이 먼저 연락드립니다.\n\n{링크}`
    : `[온보딩] 입사 ${s.day}일, 잘 지내고 계신가요?\n\n{이름} 님, 안녕하세요. 온보딩 담당 HR입니다.\n입사 ${s.day}일을 맞아 짧은 설문(2분)을 부탁드립니다.\n응답은 HR만 보며 매니저에게 개별 공개하지 않습니다.\n\n{링크}`;
  modal(`${made.length}명에게 보낼 준비가 됐습니다`, `<p class="m-note" style="margin:0 0 8px">회사 메일의 받는 사람에 아래 주소를, 본문에 안내 문구를 넣고 <b>{링크}</b> 자리에 각자의 링크를 붙여 보내세요. 응답하면 결과에 바로 반영됩니다.</p>
    <label class="fld"><span>안내 문구</span><textarea rows="7" readonly id="mail-text">${esc(mail)}</textarea></label>
    <table class="tbl compact"><thead><tr><th>입사자</th><th>받는 사람</th><th>개인 링크</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.h.name)}</td><td>${esc(r.to)}</td><td><a href="${esc(r.url)}" target="_blank" rel="noopener">링크 열기</a></td></tr>`).join('')}</tbody></table>
    ${CONN.google.clientId ? `<div class="row-act"><button type="button" class="btn primary" id="gmail-all">Gmail로 ${made.length}명에게 바로 보내기</button></div>` : `<p class="m-note"><a href="#connect">연결 설정</a>에서 Gmail을 연결하면 사람마다 다른 링크를 넣어 여기서 바로 보낼 수 있습니다.</p>`}
    <div class="row-act"><button type="button" class="btn" id="copy-mail">안내 문구 복사</button><button type="button" class="btn" id="copy-links">받는 사람·링크 목록 복사 (엑셀 붙여넣기용)</button></div>`, null, null, true);
  $('#copy-mail').onclick = () => copy(mail);
  if ($('#gmail-all')) $('#gmail-all').onclick = e => { const btn = e.currentTarget; btn.disabled = true; btn.textContent = '보내는 중…';
    surveyGmail(rows, mail, made, n => { $('#modal').close(); toast(`Gmail로 ${n}명에게 보냈습니다.`); }).catch(err => { btn.disabled = false; btn.textContent = '다시 보내기'; toast(err.message); }); };
  $('#copy-links').onclick = () => copy('이름\t받는 사람\t링크\n' + rows.map(r => `${r.h.name}\t${r.to}\t${r.url}`).join('\n'), '목록을 복사했습니다. 엑셀이나 메일 병합에 붙여넣으세요.');
  $('#modal').addEventListener('close', render, { once: true });
}
function actExport(kind) {
  const st = derive().st;
  const sets = {
    hires: ['입사자', ['관리번호', '사번', '이름', '이메일', '입사일', '채용구분', '기수', '부서', '직급', '직무', '근무지', '매니저', '버디', '상태', '수습 종료'], S.hires.map(h => [h.key, h.empNo, h.name, h.email, h.start, h.type, h.cohort, orgName(h.org), h.rank, h.job, h.site, h.mgrName, h.buddy, hireStage(h, TODAY), probationEnd(h, S.settings.probationMonths)])],
    tasks: ['할일', ['관리번호', '이름', '항목', '담당', '기한', '완료일', '처리', '상태', '메모'], S.tasks.map(t => [t.key, (hireOf(t.key) || {}).name, t.title, t.owner, t.due, t.done, t.by, st.get(t.id), t.memo])],
    resp: ['설문응답', ['응답일', '이름', '설문', '문항', '점수', '답'], S.resp.map(r => { const s = S.surveys.find(x => x.id === r.survey) || { qs: [] }; const q = s.qs.find(x => x.q === r.q); return [r.at, (hireOf(r.key) || {}).name, s.name, q ? q.text : r.q, r.score, r.answer]; })],
  };
  const [name, head, rows] = sets[kind];
  if (window.XLSX) { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head, ...rows]), name); XLSX.writeFile(wb, name + '_' + TODAY + '.xlsx'); }
}

document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b) { const tr = e.target.closest('tr[data-href]'); if (tr && !e.target.closest('a,button,input,select')) location.hash = tr.dataset.href; return; }
  const a = b.dataset.act, id = b.dataset.id;
  if (['check-all', 'imp-survey', 'probation'].includes(a)) return;
  e.preventDefault();
  const R = route();
  const sv = R.v === 'survey' && S.surveys.find(x => x.id === R.a);
  ({
    'copy-request': () => copy(requestText(b.dataset.r)),
    'copy-col': () => { const c = S.template.find(x => x.code === b.dataset.code); const st = derive().st; const hs = S.tasks.filter(t => t.code === c.code && !t.done && !t.closed).map(t => hireOf(t.key)).filter(h => h && isActive(h) && D.diff(TODAY, h.start) < 7);
      copy(`[${shortTitle(c.title)}] 요청 명단 (${hs.length}명)\n이름\t부서\t직급\t입사일\t근무지\n` + hs.map(h => `${h.name}\t${orgName(h.org)}\t${h.rank}\t${h.start}\t${h.site}`).join('\n'), `${shortTitle(c.title)} 미완료 ${hs.length}명 명단을 복사했습니다.`); },
    'copy-docs': () => { const h = hireOf(b.dataset.key); const docs = S.tasks.filter(t => t.key === h.key && t.kind === '서류' && !t.done && !t.closed);
      copy(`${h.name} 님, 안녕하세요. 온보딩 담당 HR입니다.\n${D.md(h.start)} 입사를 앞두고 아래 서류를 아직 받지 못했습니다.\n\n${docs.map(t => '- ' + t.title).join('\n')}\n\n${D.md(docs[0].due)}까지 이 메일에 회신으로 보내 주세요. 감사합니다.`, '서류 안내 문구를 복사했습니다.'); },
    toggle: () => { const t = S.tasks.find(x => x.id === id); if (t.done) { t.done = ''; t.by = ''; } else { t.done = TODAY; t.by = 'HR 체크'; } save(); },
    done: () => { const t = S.tasks.find(x => x.id === id); t.done = TODAY; t.by = 'HR 체크'; t.memo = ''; save(); toast('완료로 표시했습니다.'); },
    undo: () => { const t = S.tasks.find(x => x.id === id); t.done = ''; t.by = ''; save(); toast('완료를 취소했습니다.'); },
    memo: () => actMemo(id), 'new-hire': actNewHire, 'edit-hire': () => actEditHire(b.dataset.key), leave: () => actLeave(b.dataset.key),
    send: () => actSend(R.a),
    remind: () => { const s = S.surveys.find(x => x.id === b.dataset.s); const w = S.sends.filter(x => x.survey === s.id && sendState(x) === '대기');
      copy(`[다시 알림] ${s.name} (2분)\n\n안녕하세요, 온보딩 담당 HR입니다. 지난번 보내드린 설문을 아직 받지 못해 다시 알려 드립니다.\n\n` + w.map(x => { const h = hireOf(x.key); return `${s.audience === '매니저' ? h.mgrName + ' 매니저님 (' + h.name + ' 님 체크인)' : h.name + ' 님'}: ${respondUrl(x.token)}`; }).join('\n'), `${w.length}명 독촉 문구를 복사했습니다.`); },
    'new-survey': () => { const id2 = 'C' + Date.now().toString(36); S.surveys.push({ id: id2, name: '새 설문', audience: '입사자', day: 60, active: false, qs: [{ q: 'q1', text: '', type: '점수5' }] }); persist(); location.hash = '#survey/' + id2 + '/edit'; },
    'q-add': () => { readSurveyForm(sv); sv.qs.push({ q: 'q' + Date.now().toString(36), text: '', type: '점수5' }); render(); },
    'q-del': () => { readSurveyForm(sv); sv.qs.splice(Number(b.dataset.i), 1); render(); },
    'q-up': () => { readSurveyForm(sv); const i = Number(b.dataset.i); [sv.qs[i - 1], sv.qs[i]] = [sv.qs[i], sv.qs[i - 1]]; render(); },
    'survey-save': () => { readSurveyForm(sv); if (!sv.qs.length) { toast('문항을 하나 이상 넣어 주세요.'); return; } save(); toast('설문을 저장했습니다.'); },
    sample: () => downloadSample(b.dataset.src),
    'paste-toggle': () => { const box = $('#paste-box'), open = box.hidden; box.hidden = !open; b.setAttribute('aria-expanded', open); b.classList.toggle('on', open); if (open) $('#imp-paste').focus(); },
    'prep-group': () => togglePrepGroup(b.dataset.o),
    'cell-menu': () => { const p = $('#cellpop'); if (p && !p.hidden && p.dataset.id === b.dataset.id) closeCellMenu(); else openCellMenu(b); },
    'nav-toggle': () => setNavCollapsed(!document.body.classList.contains('nav-collapsed')),
    'imp-paste': () => { const t = $('#imp-paste').value; if (!t.trim()) { toast('붙여넣은 내용이 없습니다.'); return; } loadGrid(parseText(t), '붙여넣기'); },
    'imp-reset': () => { IMP = null; render(); }, 'imp-plan': makePlan, 'imp-back': () => { IMP.plan = null; render(); }, 'imp-apply': applyPlan,
    'tpl-edit': () => actTpl(Number(b.dataset.i)), 'tpl-toggle': () => { const t = S.template[Number(b.dataset.i)]; t.active = !t.active; save(); },
    export: () => actExport(b.dataset.v),
    reset: () => modal('예시 데이터로 되돌리기', '<p>가져오거나 수정한 내용이 모두 사라지고 처음 예시 데이터로 돌아갑니다.</p>', () => { S = buildDemo(TODAY); IMP = null; save(); toast('예시 데이터로 되돌렸습니다.'); }, '되돌리기'),
  }[a] || (CONNECT_ACTS[a] ? () => CONNECT_ACTS[a](b) : () => {}))();
});

document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.act === 'check-all') document.querySelectorAll('#send-form [name=k]').forEach(x => { x.checked = t.checked; });
  if (t.dataset.act === 'imp-survey') { IMP = { src: 'survey', surveyId: t.value }; render(); }
  if (t.dataset.act === 'probation') { S.settings.probationMonths = Number(t.value); S.tasks.filter(x => x.rule === 'probation' && !x.done && !x.closed).forEach(x => { x.due = dueOf(x, hireOf(x.key), S.settings); }); save(); toast('수습 기간을 바꿨습니다.'); }
  if (t.dataset.map !== undefined) { IMP.map[t.dataset.map] = t.value === '' ? '' : Number(t.value); render(); }
  if (t.dataset.f && t.tagName === 'SELECT') { UI[t.dataset.f] = t.value; render(); }
  if (t.dataset.f && t.type === 'checkbox') { UI[t.dataset.f] = t.checked; render(); }
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.f && t.type === 'search') { UI[t.dataset.f] = t.value; const pos = t.selectionStart; render(); const n = $('[data-f="' + t.dataset.f + '"]'); n.focus(); n.setSelectionRange(pos, pos); }
});
document.addEventListener('submit', e => {
  if (e.target.id === 'respond-form') {
    e.preventDefault();
    const token = e.target.dataset.token;
    if (token.startsWith('preview-')) { toast('미리 보기에서는 제출되지 않습니다.'); return; }
    const x = S.sends.find(y => y.token === token), s = S.surveys.find(y => y.id === x.survey);
    const fd = new FormData(e.target);
    s.qs.forEach(q => { const v = String(fd.get('a_' + q.q) || '').trim(); if (!v) return; const num = q.type === '점수5' || q.type === '추천10'; S.resp.push({ send: x.id, survey: s.id, key: x.key, q: q.q, score: num ? Number(v) : '', answer: num ? '' : v, at: TODAY }); });
    x.respondedAt = TODAY; x.via = '설문 링크';
    save();
  }
  if (e.target.id === 'survey-edit' || e.target.id === 'send-form') e.preventDefault();
});

render();
