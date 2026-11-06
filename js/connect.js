/* 외부 연결 — Gmail 발송, Slack 채널 알림, Google 시트·API에서 가져오기
   연결 정보는 이 브라우저(localStorage)에만 저장한다. 서버가 없으므로 어디에도 보내지 않는다.
   예시 데이터 초기화와 따로 저장해서, 데이터를 되돌려도 연결은 남는다. */
const CONN_KEY = 'onboarding-connections';
const CONN = (() => { try { return JSON.parse(localStorage.getItem(CONN_KEY)) || {}; } catch (e) { return {}; } })();
CONN.google = CONN.google || { clientId: '' };
CONN.slack = CONN.slack || {};       // { it, ga } : Incoming Webhook 주소
CONN.mail = CONN.mail || {};         // { it, ga } : 담당 부서 메일 주소
// 담당 부서 메일이 비어 있으면 예시 주소를 넣어 둔다 (설정 → 연결에서 실제 주소로 바꾸면 된다)
const DEMO_MAIL = { it: 'it-help@demo-corp.kr', ga: 'ga-team@demo-corp.kr' };
Object.keys(DEMO_MAIL).forEach(k => { if (!CONN.mail[k]) CONN.mail[k] = DEMO_MAIL[k]; });
CONN.sources = CONN.sources || {};   // { ats: { kind: 'sheet'|'api', url, header, path, at } }
function saveConn() { try { localStorage.setItem(CONN_KEY, JSON.stringify(CONN)); } catch (e) { /* 저장 불가 */ } }

/* ───────── Google 로그인 (Google Identity Services, 무료) ───────── */
const G_SCOPES = 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/forms.body https://www.googleapis.com/auth/forms.responses.readonly https://www.googleapis.com/auth/drive.file';
let G_TOKEN = null;
function loadGis() {
  if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
  return new Promise((ok, no) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = ok; s.onerror = () => no(new Error('Google 로그인 스크립트를 불러오지 못했습니다. 인터넷 연결을 확인하세요.'));
    document.head.appendChild(s);
  });
}
if (CONN.google.clientId) loadGis().catch(() => {}); // 버튼을 누를 때 팝업이 막히지 않도록 미리 불러 둔다

function googleToken(force) {
  if (!force && G_TOKEN && G_TOKEN.exp > Date.now() + 60000) return Promise.resolve(G_TOKEN.token);
  if (!CONN.google.clientId) return Promise.reject(new Error('Google이 연결되어 있지 않습니다. 연결 설정에서 Client ID를 넣어 주세요.'));
  return loadGis().then(() => new Promise((ok, no) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: CONN.google.clientId, scope: G_SCOPES,
      callback: r => {
        if (r.error) return no(new Error('Google 연결이 거절되었습니다 (' + r.error + ').'));
        G_TOKEN = { token: r.access_token, exp: Date.now() + Number(r.expires_in || 3600) * 1000 };
        CONN.google.ok = TODAY; saveConn(); ok(r.access_token);
      },
      error_callback: e => no(new Error(e && e.type === 'popup_closed' ? 'Google 로그인 창이 닫혔습니다.' : 'Google 로그인 창을 열지 못했습니다. 팝업 차단을 풀어 주세요.')),
    });
    client.requestAccessToken();
  }));
}

/* ───────── 보내기 ───────── */
const b64 = s => btoa(unescape(encodeURIComponent(s)));
const mimeWord = s => '=?UTF-8?B?' + b64(s) + '?=';
function gmailSend({ to, bcc, subject, body }) {
  const head = [];
  if (to) head.push('To: ' + to);
  if (bcc) head.push('Bcc: ' + bcc);
  head.push('Subject: ' + mimeWord(subject), 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64');
  // 머리글은 ASCII(제목은 MIME 인코딩), 본문은 base64 → 메시지 전체를 다시 base64url로
  const raw = btoa(head.join('\r\n') + '\r\n\r\n' + b64(body).replace(/.{76}/g, '$&\r\n'));
  const url = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
  return googleToken().then(token => fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: raw.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') }) }))
    .then(r => r.ok ? r.json() : r.json().catch(() => ({})).then(j => { throw new Error('Gmail이 보내지 않았습니다: ' + ((j.error && j.error.message) || r.status)); }));
}
function slackSend(url, text) {
  // Slack 웹훅은 브라우저 응답을 막아 두어 결과를 읽을 수 없다(no-cors). 전송 요청까지만 확인한다.
  return fetch(url, { method: 'POST', mode: 'no-cors', body: JSON.stringify({ text }) });
}
const mailtoUrl = ({ to, bcc, subject, body }) => 'mailto:' + encodeURIComponent(to || '').replace(/%40/g, '@').replace(/%2C/g, ',') + '?' +
  [bcc ? 'bcc=' + encodeURIComponent(bcc) : '', 'subject=' + encodeURIComponent(subject), 'body=' + encodeURIComponent(body)].filter(Boolean).join('&');

/* 보내기 창: 받는 곳과 채널을 고르고, 내용을 고친 뒤 보낸다
   opt = { title, to, bcc, subject, body, slack: 'it'|'ga', onSent(via) } */
function openCompose(opt) {
  const ch = [];
  if (CONN.google.clientId) ch.push(['gmail', 'Gmail로 보내기']);
  if (opt.slack && CONN.slack[opt.slack]) ch.push(['slack', 'Slack 채널에 올리기']);
  ch.push(['mailto', '메일 앱에서 열기'], ['copy', '복사만 하기']);
  const def = ch[0][0];
  const demo = /@(mail-)?demo(-corp)?\.kr/.test((opt.to || '') + (opt.bcc || ''));
  modal(esc(opt.title), `
    <div class="ch-pick" role="radiogroup" aria-label="보내는 방법">${ch.map(([k, l]) => `<label class="ch ${k === def ? 'on' : ''}"><input type="radio" name="ch" value="${k}" ${k === def ? 'checked' : ''}>${l}</label>`).join('')}</div>
    ${CONN.google.clientId ? '' : `<p class="m-note">Gmail이나 Slack으로 바로 보내려면 <a href="#connect">연결 설정</a>에서 연결하세요. 지금은 메일 앱에서 열거나 복사할 수 있습니다.</p>`}
    <div class="ch-mail">
      <label class="fld"><span>받는 사람</span><input name="to" value="${esc(opt.to || '')}" placeholder="${opt.bcc ? '비워 두면 숨은 참조로만 보냅니다 (받는 사람끼리 주소가 안 보임)' : '이름@회사.com, 여러 명은 쉼표로'}"></label>
      ${opt.bcc !== undefined ? `<label class="fld"><span>숨은 참조</span><input name="bcc" value="${esc(opt.bcc || '')}"></label>` : ''}
      <label class="fld"><span>제목</span><input name="subject" value="${esc(opt.subject)}"></label>
    </div>
    <label class="fld"><span>내용</span><textarea name="body" rows="10">${esc(opt.body)}</textarea></label>
    ${demo ? '<p class="m-note">예시 데이터의 주소(@mail-demo.kr, @demo-corp.kr)는 가짜라 실제로 보내면 반송됩니다. 시험할 때는 받는 사람을 본인 주소로 바꾸세요.</p>' : ''}`,
  (fd, f) => {
    const via = fd.get('ch'), m = { to: String(fd.get('to') || '').trim(), bcc: String(fd.get('bcc') || '').trim(), subject: String(fd.get('subject') || ''), body: String(fd.get('body') || '') };
    if (via === 'copy') { copy(m.subject + '\n\n' + m.body); return; }
    if (via === 'mailto') { location.href = mailtoUrl(m); opt.onSent && opt.onSent('메일 앱'); return; }
    if (via === 'gmail' && !m.to && !m.bcc) return '받는 사람을 넣어 주세요.';
    const btn = f.querySelector('.btn.primary'); btn.disabled = true; btn.textContent = '보내는 중…';
    const job = via === 'gmail' ? gmailSend(m) : slackSend(CONN.slack[opt.slack], `*${m.subject}*\n${m.body}`);
    job.then(() => { $('#modal').close(); toast(via === 'gmail' ? 'Gmail로 보냈습니다.' : 'Slack 채널로 보냈습니다.'); opt.onSent && opt.onSent(via === 'gmail' ? 'Gmail' : 'Slack'); })
      .catch(e => { btn.disabled = false; btn.textContent = '보내기'; let p = f.querySelector('.m-err'); if (!p) { p = document.createElement('p'); p.className = 'm-err'; f.querySelector('.m-act').before(p); } p.textContent = e.message; });
    return false;
  }, '보내기', true);
  const f = $('#modal form');
  const sync = () => { const v = f.querySelector('[name=ch]:checked').value; f.querySelectorAll('.ch').forEach(l => l.classList.toggle('on', l.querySelector('input').checked)); f.querySelector('.ch-mail').hidden = v === 'slack'; f.querySelector('.btn.primary').textContent = v === 'copy' ? '복사하기' : v === 'mailto' ? '메일 앱 열기' : '보내기'; };
  f.addEventListener('change', e => { if (e.target.name === 'ch') sync(); });
  sync();
}

/* 요청 보내기: 받는 곳(rid)에 맞춰 받는 사람·제목·내용을 채운다 */
function askCompose(rid) {
  const dv = derive();
  const items = S.tasks.filter(t => { const s = dv.st.get(t.id), h = hireOf(t.key); return h && isActive(h) && (s === '지연' || s === '문제' || (s === '진행' && D.diff(t.due, TODAY) <= 2)) && recipientOf(t, h).id === rid; });
  if (!items.length) return;
  const h0 = hireOf(items[0].key), r = recipientOf(items[0], h0);
  let body = requestText(rid), subject, to = '', bcc, slack;
  if (rid === 'LMS') {
    const lines = body.split('\n'); subject = lines[0];
    body = lines.slice(2).filter(l => !l.startsWith('받는 사람(숨은 참조)')).join('\n').trim();
    bcc = [...new Set(items.map(t => hireOf(t.key).email))].join(', ');
  } else if (rid.startsWith('n:')) { subject = `[입사 준비] ${h0.name} 님, 확인 부탁드립니다`; to = h0.email; }
  else if (rid.startsWith('m:')) { subject = `[온보딩] 새 팀원 준비 확인 부탁드립니다`; to = h0.mgr; }
  else { slack = r.id === 'IT' ? 'it' : 'ga'; to = CONN.mail[slack] || DEMO_MAIL[slack]; subject = `[입사 준비] 신규 입사자 ${items.length}건 확인 부탁드립니다`; }
  openCompose({ title: r.label + '에게 요청', to, bcc, subject, body, slack, onSent: via => { (S.asks = S.asks || []).push({ rid, at: TODAY, via }); save(); } });
}
const lastAsk = rid => (S.asks || []).filter(a => a.rid === rid).slice(-1)[0];

/* 설문: 사람마다 링크가 다른 메일을 Gmail로 한 번에 보낸다 */
function surveyGmail(rows, mail, sends, done) {
  // 한 통 보낼 때마다 그 사람만 발송 기록에 넣는다. 중간에 실패하면 다시 눌렀을 때 남은 사람에게만 보낸다.
  const [subject, , ...rest] = mail.split('\n'); const tpl = rest.join('\n');
  let n = 0;
  const one = i => {
    if (i >= rows.length) return Promise.resolve();
    if (sends[i].via === 'Gmail') return one(i + 1);
    return gmailSend({ to: rows[i].to, subject, body: tpl.split('{이름}').join(rows[i].h.name).split('{링크}').join(rows[i].url) })
      .then(() => { sends[i].via = 'Gmail'; S.sends.push(sends[i]); persist(); n++; return one(i + 1); });
  };
  return one(0).then(() => done(n), e => { const sent = sends.filter(x => x.via === 'Gmail').length; throw new Error(`${sent}명까지 보냈습니다. ` + e.message); });
}

/* ───────── 가져오기: Google 시트·API ───────── */
function sheetIds(url) {
  const m = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/.exec(url); const g = /[#&?]gid=(\d+)/.exec(url);
  return m ? { id: m[1], gid: g ? g[1] : '0' } : null;
}
function fetchSheet(url) {
  const ids = sheetIds(url);
  if (!ids) return Promise.reject(new Error('Google 시트 주소가 아닙니다. 시트를 열었을 때 주소창의 주소를 그대로 붙여넣으세요.'));
  // 1) "링크가 있는 모든 사용자" 공유 시트는 로그인 없이 CSV로 읽는다
  const pub = `https://docs.google.com/spreadsheets/d/${ids.id}/gviz/tq?tqx=out:csv&gid=${ids.gid}`;
  return fetch(pub).then(r => { if (!r.ok) throw new Error('private'); return r.text(); }).then(t => { if (/^\s*<!DOCTYPE|<html/i.test(t)) throw new Error('private'); return parseText(t); })
    .catch(() => {
      // 2) 공유되지 않은 시트는 Google 연결(Sheets API)로 읽는다
      if (!CONN.google.clientId) throw new Error('시트를 읽을 수 없습니다. 시트를 "링크가 있는 모든 사용자"로 공유하거나, 연결 설정에서 Google을 연결하세요.');
      return googleToken().then(tk => {
        const api = `https://sheets.googleapis.com/v4/spreadsheets/${ids.id}`, H = { headers: { Authorization: 'Bearer ' + tk } };
        return fetch(api + '?fields=sheets.properties', H).then(r => r.json()).then(j => {
          if (j.error) throw new Error('Google 시트를 읽지 못했습니다: ' + j.error.message);
          const sh = (j.sheets || []).find(s => String(s.properties.sheetId) === ids.gid) || j.sheets[0];
          return fetch(api + '/values/' + encodeURIComponent(sh.properties.title) + '?valueRenderOption=FORMATTED_VALUE', H).then(r => r.json());
        }).then(j => { if (j.error) throw new Error('Google 시트를 읽지 못했습니다: ' + j.error.message); return j.values || []; });
      });
    });
}
function fetchApi(cfg) {
  const headers = {};
  String(cfg.header || '').split('\n').forEach(l => { const i = l.indexOf(':'); if (i > 0) headers[l.slice(0, i).trim()] = l.slice(i + 1).trim(); });
  return fetch(cfg.url, { headers })
    .catch(() => { throw new Error('API에 접속하지 못했습니다. 주소가 맞는지, 이 시스템이 브라우저 호출(CORS)을 허용하는지 확인하세요. 막혀 있다면 시스템 관리자에게 이 대시보드 주소(' + location.origin + ') 허용을 요청하거나, Google 시트로 내보내 연결하세요.'); })
    .then(r => { if (!r.ok) throw new Error('API가 오류를 돌려줬습니다 (' + r.status + '). 주소와 인증 헤더를 확인하세요.'); return r.json(); })
    .then(j => {
      let list = j;
      String(cfg.path || '').split('.').filter(Boolean).forEach(k => { list = list == null ? list : list[k]; });
      if (!Array.isArray(list)) throw new Error('응답에서 목록을 찾지 못했습니다. "목록 위치"에 목록이 들어 있는 항목 이름(예: data 또는 data.items)을 넣어 주세요.');
      if (!list.length) return [];
      if (Array.isArray(list[0])) return list;
      // 시스템 API는 값이 안쪽에 들어 있는 경우가 많다 (예: fields.status.name) → 점으로 이어 붙인 열 이름으로 펼친다
      const flat = (o, pre, out) => { Object.keys(o || {}).forEach(k => { const v = o[k], key = pre ? pre + '.' + k : k;
        if (v && typeof v === 'object' && !Array.isArray(v) && key.split('.').length < 4) flat(v, key, out);
        else out[key] = Array.isArray(v) ? v.map(x => (x && typeof x === 'object') ? (x.name || x.value || x.displayName || JSON.stringify(x)) : x).join(', ') : v; }); return out; };
      const rows = list.map(o => flat(o, '', {}));
      const keys = [...new Set(rows.flatMap(o => Object.keys(o)))];
      return [keys, ...rows.map(o => keys.map(k => o[k] == null ? '' : o[k]))];
    });
}
function pullSource(src, cfg, keep) {
  const job = cfg.kind === 'api' ? fetchApi(cfg) : fetchSheet(cfg.url);
  toast('불러오는 중입니다…');
  return job.then(grid => {
    // 시트 오른쪽의 빈 열은 잘라 낸다
    let w = Math.max(0, ...grid.map(r => r.length));
    while (w > 0 && grid.every(r => String(r[w - 1] == null ? '' : r[w - 1]).trim() === '')) w--;
    grid = grid.map(r => r.slice(0, w));
    if (keep) { CONN.sources[src] = Object.assign({}, cfg, { at: TODAY }); saveConn(); }
    loadGrid(grid, cfg.kind === 'api' ? 'API' : 'Google 시트');
  }).catch(e => modal('가져오지 못했습니다', `<p>${esc(e.message)}</p>`, null, null));
}

function apiPanel(src) {
  const c = CONN.sources[src];
  if (c) return `<div class="linked"><div><b>${c.kind === 'api' ? 'API' : 'Google 시트'} 연동됨</b><span class="w-meta">${esc(c.url.length > 60 ? c.url.slice(0, 57) + '…' : c.url)}${c.at ? ' · 마지막 ' + D.md(c.at) : ''}</span></div>
    <div class="row-act"><button class="btn primary" data-act="api-pull" data-src="${src}">지금 가져오기</button><button class="btn ghost" data-act="api-unlink" data-src="${src}">연동 해제</button></div></div>`;
  return '';
}
function apiBox(src) {
  return `<div id="api-box" class="paste-box api-box" hidden>
    <div class="seg-pick" role="radiogroup" aria-label="연동 방식"><label class="ch on"><input type="radio" name="api-kind" value="sheet" checked>Google 시트</label><label class="ch"><input type="radio" name="api-kind" value="api">시스템 API (JSON)</label></div>
    <label class="fld"><span class="api-url-label">시트 URL</span><input id="api-url" placeholder="https://docs.google.com/spreadsheets/d/…"></label>
    <p class="tags api-sheet"><i>공개 링크 시트: 바로 읽기</i><i>비공개 시트: <a href="#connect">Google 연동</a> 필요</i></p>
    <div class="api-only" hidden>
      <div class="fld-2">
        <label class="fld"><span>인증 헤더</span><textarea id="api-header" rows="2" placeholder="Authorization: Bearer 발급받은-키"></textarea></label>
        <label class="fld"><span>목록 경로</span><input id="api-path" placeholder="예: result, data.items"></label>
      </div>
      <p class="tags"><i>응답이 바로 목록이면 경로 비움</i><i>브라우저 호출(CORS) 차단 시: 시트로 내보내 연동</i></p>
    </div>
    <label class="check"><input type="checkbox" id="api-keep" checked> 연동 저장 <span class="hint nw">(다음부터 1클릭 갱신)</span></label>
    <div class="row-act"><button class="btn primary" data-act="api-load" data-src="${src}">가져오기</button></div>
  </div>`;
}

/* ───────── 연결 설정 화면 ───────── */
function viewConnect() {
  const ok = v => v ? '<span class="sg sg-ok">연결됨</span>' : '<span class="sg sg-off">연결 안 됨</span>';
  // 한 줄에 하나씩: 왼쪽은 무엇·왜, 오른쪽은 넣을 칸, 만드는 법은 상자 맨 아래에 가로로 펼침
  const row = (title, status, hint, howto, fields) => `<section class="panel conn-row">
      <div class="conn-info"><div class="conn-title"><h2>${title}</h2>${status}</div><p class="hint">${hint}</p></div>
      <div class="conn-fields">${fields}</div>${howto ? `<div class="conn-howto">${howto}</div>` : ''}</section>`;
  return `
  ${setupHead('connect')}
  <header class="page-head"><div><p class="sub">Gmail·Slack으로 바로 보내고, Google 시트·API에서 바로 가져오도록 연결합니다. 모두 무료로 쓸 수 있습니다.</p></div></header>
  <form id="conn-form" class="conn-list">
    ${row('Google', ok(CONN.google.clientId), 'Gmail로 보내기 · 설문 Google 폼 만들기 · 시트 읽기',
      `<details class="howto"><summary>Client ID 만드는 법</summary><ol>
        <li>Google Cloud 콘솔에서 프로젝트를 만들고 <b>Gmail API</b>, <b>Google Sheets API</b>, <b>Google Forms API</b>를 사용 설정합니다.</li>
        <li>OAuth 동의 화면을 "외부"로 만들고, 테스트 사용자에 본인 Gmail을 넣습니다.</li>
        <li>사용자 인증 정보 → OAuth 클라이언트 ID → 웹 애플리케이션을 고릅니다.</li>
        <li>승인된 JavaScript 원본에 <code>${esc(location.origin)}</code>를 넣고, 만들어진 Client ID를 붙여넣습니다.</li>
      </ol><p class="hint">비밀 키(Client Secret)는 필요 없습니다. 메일은 로그인한 본인 계정에서 나갑니다.</p></details>`,
      `<label class="fld"><span>OAuth Client ID</span><input name="g_client" value="${esc(CONN.google.clientId)}" placeholder="1234-abcd.apps.googleusercontent.com" autocomplete="off" spellcheck="false"></label>
      <div class="row-act"><button type="button" class="btn" data-act="g-test">Google 로그인 시험</button></div>`)}
    ${row('Slack', ok(CONN.slack.it || CONN.slack.ga), 'IT·총무 채널에 요청 올리기',
      `<details class="howto"><summary>웹훅 만드는 법</summary><ol>
        <li>api.slack.com/apps에서 앱을 만들고 <b>Incoming Webhooks</b>를 켭니다.</li>
        <li>"Add New Webhook to Workspace"로 채널을 고르면 주소가 나옵니다.</li>
        <li>채널마다 하나씩 만들어 붙여넣습니다.</li>
      </ol><p class="hint">웹훅 주소를 아는 사람은 누구나 그 채널에 글을 올릴 수 있습니다. 공용 PC에서는 넣지 마세요.</p></details>`,
      `<div class="fld-2"><label class="fld"><span>IT 요청 채널 웹훅</span><input name="s_it" value="${esc(CONN.slack.it || '')}" placeholder="https://hooks.slack.com/services/…" autocomplete="off" spellcheck="false"></label>
      <label class="fld"><span>총무 요청 채널 웹훅</span><input name="s_ga" value="${esc(CONN.slack.ga || '')}" placeholder="https://hooks.slack.com/services/…" autocomplete="off" spellcheck="false"></label></div>
      <div class="row-act"><button type="button" class="btn" data-act="s-test">시험 메시지 보내기</button></div>`)}
    ${row('메일로 받을 담당자', '', 'Slack 대신 메일로 IT·총무에 요청할 때 받는 주소. 지금은 예시 주소가 들어 있으니 실제 주소로 바꾸세요.', '',
      `<div class="fld-2"><label class="fld"><span>IT 담당 메일</span><input name="m_it" type="email" value="${esc(CONN.mail.it || '')}" placeholder="it-help@회사.com"></label>
      <label class="fld"><span>총무 담당 메일</span><input name="m_ga" type="email" value="${esc(CONN.mail.ga || '')}" placeholder="ga@회사.com"></label></div>`)}
    ${row('데이터 연결', '', '각 데이터를 어떻게 받아오는지 보여 줍니다. 연결은 데이터 가져오기 탭에서 합니다.', '',
      `<ul class="plain">${Object.keys(SOURCES).map(k => { const c = CONN.sources[k]; return `<li><a href="#import/${k}">${SOURCES[k].name}</a><span>${c ? (c.kind === 'api' ? 'API' : 'Google 시트') + (c.at ? ' · ' + D.md(c.at) + ' 가져옴' : '') : '<span class="muted">파일로 올림</span>'}</span></li>`; }).join('')}</ul>`)}
    <div class="conn-save"><button class="btn primary" data-act="conn-save">저장</button><span class="hint">연결 정보는 이 브라우저에만 저장되고 어떤 서버로도 보내지 않습니다.</span></div>
  </form>`;
}
function readConnForm() {
  const f = $('#conn-form'); if (!f) return;
  const v = n => f.elements[n].value.trim();
  const changed = CONN.google.clientId !== v('g_client');
  CONN.google.clientId = v('g_client'); if (changed) { G_TOKEN = null; delete CONN.google.ok; }
  CONN.slack.it = v('s_it'); CONN.slack.ga = v('s_ga');
  CONN.mail.it = v('m_it'); CONN.mail.ga = v('m_ga');
  saveConn();
  if (CONN.google.clientId) loadGis().catch(() => {});
}
const CONNECT_ACTS = {
  ask: b => askCompose(b.dataset.r),
  'conn-save': () => { readConnForm(); render(); toast('연결 설정을 저장했습니다.'); },
  'g-test': () => { readConnForm(); googleToken(true).then(() => { render(); toast('Google에 연결됐습니다.'); }, e => toast(e.message)); },
  's-test': () => { readConnForm(); const ks = ['it', 'ga'].filter(k => CONN.slack[k]); if (!ks.length) { toast('웹훅 주소를 먼저 넣어 주세요.'); return; }
    Promise.all(ks.map(k => slackSend(CONN.slack[k], '온보딩 대시보드 연결 시험입니다.'))).then(() => toast('보냈습니다. Slack 채널에 메시지가 왔는지 확인하세요.'), () => toast('보내지 못했습니다. 주소를 확인하세요.')); },
  'api-toggle': b => { const box = $('#api-box'), open = box.hidden; box.hidden = !open; b.setAttribute('aria-expanded', open); b.classList.toggle('on', open); if (open) $('#api-url').focus(); },
  'api-load': b => { const kind = $('[name=api-kind]:checked').value, url = $('#api-url').value.trim(); if (!url) { toast('주소를 넣어 주세요.'); return; }
    pullSource(b.dataset.src, { kind, url, header: kind === 'api' ? $('#api-header').value : '', path: kind === 'api' ? $('#api-path').value.trim() : '' }, $('#api-keep').checked); },
  'api-pull': b => pullSource(b.dataset.src, CONN.sources[b.dataset.src], true),
  'api-unlink': b => { delete CONN.sources[b.dataset.src]; saveConn(); render(); toast('연결을 끊었습니다. 파일로 올리는 방식은 그대로 쓸 수 있습니다.'); },
};
document.addEventListener('change', e => {
  if (e.target.name === 'api-kind') {
    const api = e.target.value === 'api';
    document.querySelectorAll('[name=api-kind]').forEach(x => x.closest('.ch').classList.toggle('on', x.checked));
    $('.api-only').hidden = !api; $('.api-sheet').hidden = api;
    $('#api-url').placeholder = api ? 'https://helpdesk.회사.com/api/requests?type=onboarding' : 'https://docs.google.com/spreadsheets/d/…';
    $('.api-url-label').textContent = api ? 'API URL' : '시트 URL';
  }
});

/* ───────── 설문 응답을 Google 폼으로 받기 ─────────
   s.form = { url: 사전 입력 링크, sheet: 응답 시트 주소 }
   사전 입력 링크의 entry 값 중 '@'가 있는 것은 받는 사람 이메일로, 나머지는 입사자 이름으로 바꿔 넣는다. */
function formLink(s, h, to) {
  try {
    const u = new URL(s.form.url);
    [...u.searchParams.keys()].filter(k => /^entry\./.test(k)).forEach(k => u.searchParams.set(k, u.searchParams.get(k).includes('@') ? to : h.name));
    if (!u.searchParams.has('usp')) u.searchParams.set('usp', 'pp_url');
    return u.toString();
  } catch (e) { return s.form.url; }
}
function formPanel(s) {
  const f = s.form || {}, mgr = s.audience === '매니저';
  if (f.api) return `<section class="panel form-bar"><div><b>응답 받는 곳: Google 폼 (문항 만들기에서 만든 폼)</b><span class="w-meta">메일 속 링크는 이메일${mgr ? '·입사자 이름' : ''}이 미리 채워진 이 폼으로 갑니다. 응답은 결과 탭에서 바로 가져옵니다.</span></div>
    <div class="row-act"><a class="btn ghost" href="${esc(f.responder)}" target="_blank" rel="noopener">폼 열기</a><a class="btn ghost" href="#survey/${s.id}/edit">문항 만들기에서 관리</a></div></section>`;
  if (f.url && !UI.formEdit) return `<section class="panel form-bar">
    <div><b>응답 받는 곳: Google 폼</b><span class="w-meta">메일 속 링크는 이메일${mgr ? '·입사자 이름' : ''}이 미리 채워진 Google 폼으로 갑니다. ${f.sheet ? '응답 시트 연결됨 · 결과 탭에서 가져옵니다.' : '<b class="warn-t">응답 시트가 아직 없습니다.</b>'}</span></div>
    <div class="row-act"><a class="btn ghost" href="${esc(f.url)}" target="_blank" rel="noopener">폼 열기</a><button class="btn ghost" data-act="form-edit">바꾸기</button></div></section>`;
  return `<section class="panel form-setup">
    <div class="panel-head"><h2>응답 받는 곳</h2>${f.url ? '' : '<span class="sg sg-warn">아직 Google 폼 없음</span>'}</div>
    <p class="hint">${f.url ? '' : '지금은 데모용 응답 페이지로 보냅니다. 이 페이지는 응답이 <b>입사자 브라우저에만</b> 저장되어 HR 화면으로 돌아오지 않습니다. '}Google 폼을 연결하면 응답이 HR에게 모입니다. <b>가장 쉬운 방법은 <a href="#survey/${s.id}/edit">문항 만들기</a> 탭에서 "이 문항으로 Google 폼 만들기"를 누르는 것</b>입니다(Google 연결 필요). 이미 만든 폼이 있으면 아래에 직접 연결해도 됩니다.</p>
    <div class="fld-2">
      <label class="fld"><span>Google 폼 사전 입력 링크</span><input id="form-url" value="${esc(f.url || '')}" placeholder="https://docs.google.com/forms/d/e/…/viewform?usp=pp_url&amp;entry.…=test@test.com"></label>
      <label class="fld"><span>응답 시트 주소</span><input id="form-sheet" value="${esc(f.sheet || '')}" placeholder="https://docs.google.com/spreadsheets/d/…"></label>
    </div>
    <div class="row-act"><button class="btn primary" data-act="form-save" data-s="${s.id}">저장</button>${f.url ? '<button class="btn ghost" data-act="form-cancel">취소</button>' : ''}<button class="btn ghost" data-act="copy-qs" data-s="${s.id}">Google 폼에 넣을 문항 복사</button></div>
    <details class="howto"><summary>Google 폼 연결하는 법</summary><ol>
      <li>Google 폼을 새로 만들고, 첫 문항으로 <b>이메일</b>(단답형)을 넣습니다.${mgr ? ' 두 번째로 <b>입사자 이름</b>(단답형)을 넣습니다.' : ''}</li>
      <li>나머지 문항은 "Google 폼에 넣을 문항 복사"로 복사한 문구를 <b>그대로</b> 씁니다. 문구가 같아야 결과를 가져올 때 자동으로 맞춰집니다.</li>
      <li>폼 오른쪽 위 ⋮ → <b>사전 입력된 링크 가져오기</b> → 이메일 칸에 <code>test@test.com</code>${mgr ? ', 입사자 이름 칸에 <code>홍길동</code>' : ''}을 넣고 <b>링크 가져오기 → 링크 복사</b>를 누른 뒤 위 첫 칸에 붙여넣습니다.</li>
      <li>폼의 <b>응답</b> 탭 → <b>Sheets에 연결</b>로 시트를 만들고, 그 시트 주소를 위 둘째 칸에 붙여넣습니다. 시트는 "링크가 있는 모든 사용자"로 공유하거나, 설정 → 연결에서 Google을 연결해 두면 읽을 수 있습니다.</li>
    </ol><p class="hint">보낼 때는 대시보드가 사람마다 이메일${mgr ? '·입사자 이름' : ''}을 바꿔 넣은 링크를 만들어, 한 사람에 한 통씩 보냅니다.</p></details>
  </section>`;
}
function pullSurveySheet(s) {
  IMP = { src: 'survey', surveyId: s.id };
  location.hash = '#import/survey';
  pullSource('survey', { kind: 'sheet', url: s.form.sheet }, false);
}
Object.assign(CONNECT_ACTS, {
  'form-edit': () => { UI.formEdit = true; render(); },
  'form-cancel': () => { UI.formEdit = false; render(); },
  'form-save': b => {
    const s = S.surveys.find(x => x.id === b.dataset.s), url = $('#form-url').value.trim(), sheet = $('#form-sheet').value.trim();
    if (!url) { delete s.form; UI.formEdit = false; save(); toast('Google 폼 연결을 지웠습니다. 데모용 응답 페이지로 보냅니다.'); return; }
    if (!/docs\.google\.com\/forms\//.test(url) || !/entry\.\d+=/.test(url)) { toast('사전 입력 링크가 아닙니다. "사전 입력된 링크 가져오기"로 만든 링크를 붙여넣어 주세요.'); return; }
    if (sheet && !sheetIds(sheet)) { toast('응답 시트 주소가 Google 시트 주소가 아닙니다.'); return; }
    s.form = { url, sheet }; UI.formEdit = false; save(); toast('Google 폼을 연결했습니다. 이제 메일 속 링크가 이 폼으로 갑니다.');
  },
  'copy-qs': b => {
    const s = S.surveys.find(x => x.id === b.dataset.s);
    const TL = { 점수5: '1~5점 척도', 추천10: '0~10점 척도', 예아니오: '예 / 아니오 객관식', 텍스트: '장문형' };
    copy(['이메일 (단답형)', ...(s.audience === '매니저' ? ['입사자 이름 (단답형)'] : []), ...s.qs.map(q => `${q.text} (${TL[q.type] || q.type})`)].join('\n'), '문항 목록을 복사했습니다. Google 폼에 그대로 넣으세요.');
  },
  'form-pull': b => { const s = S.surveys.find(x => x.id === b.dataset.s); if (!s.form || !s.form.sheet) { toast('응답 시트 주소를 먼저 넣어 주세요.'); return; } pullSurveySheet(s); },
});

/* ───────── Google Forms API: 문항 만들기 ↔ Google 폼 ─────────
   문항 만들기가 기준이고, Google 폼은 그대로 따라간다.
   s.form = { api: true, id, url(사전 입력 링크), responder, emailQ, hireQ, qmap: { 문항키: questionId }, syncedAt, dirty } */
const FORMS_API = 'https://forms.googleapis.com/v1/forms';
function gapi(url, opt) {
  return googleToken().then(tk => fetch(url, Object.assign({}, opt, { headers: { Authorization: 'Bearer ' + tk, 'Content-Type': 'application/json' } })))
    .then(r => r.json().catch(() => ({})).then(j => { if (!r.ok || j.error) throw new Error('Google 폼이 처리하지 못했습니다: ' + ((j.error && j.error.message) || r.status)); return j; }));
}
const FORM_SCALE = { 점수5: { low: 1, high: 5, lowLabel: '전혀 아니다', highLabel: '매우 그렇다' }, 추천10: { low: 0, high: 10, lowLabel: '전혀 추천하지 않음', highLabel: '꼭 추천함' } };
function formQuestion(q) {
  const question = FORM_SCALE[q.type] ? { scaleQuestion: FORM_SCALE[q.type] }
    : q.type === '예아니오' ? { choiceQuestion: { type: 'RADIO', options: [{ value: '예' }, { value: '아니오' }] } }
    : { textQuestion: { paragraph: true } };
  question.required = q.type !== '텍스트';
  return { title: q.text, questionItem: { question } };
}
function fixedItems(s) {
  const it = [{ title: '이메일', description: '자동으로 채워져 있습니다. 바꾸지 말아 주세요.', questionItem: { question: { required: true, textQuestion: {} } } }];
  if (s.audience === '매니저') it.push({ title: '입사자 이름', description: '어느 팀원에 대한 체크인인지 자동으로 채워져 있습니다.', questionItem: { question: { required: true, textQuestion: {} } } });
  return it;
}
async function syncForm(s) {
  const mgr = s.audience === '매니저', keep = mgr ? 2 : 1;
  const fresh = !(s.form && s.form.api && s.form.id);
  let id = fresh ? null : s.form.id;
  if (fresh) {
    id = (await gapi(FORMS_API, { method: 'POST', body: JSON.stringify({ info: { title: s.name, documentTitle: '온보딩 · ' + s.name } }) })).formId;
    // API로 만든 폼은 '게시 안 됨'으로 시작할 수 있어서 응답 받기를 켠다 (지원하지 않는 계정이면 건너뜀)
    await gapi(`${FORMS_API}/${id}:setPublishSettings`, { method: 'POST', body: JSON.stringify({ publishSettings: { publishState: { isPublished: true, isAcceptingResponses: true } }, updateMask: 'publishState' }) }).catch(() => {});
  }
  const cur = await gapi(`${FORMS_API}/${id}`);
  const items = cur.items || [];
  // 이메일·입사자 이름 문항은 남겨 둔다 (이미 보낸 링크의 미리 채움이 계속 맞도록). 나머지 문항만 새로 만든다.
  const keepOld = !fresh && items.length >= keep && items[0].title === '이메일';
  const req = [{ updateFormInfo: { info: { title: s.name, description: `입사 ${s.day}일 차 설문입니다. 응답은 HR만 봅니다.` }, updateMask: 'title,description' } }];
  for (let i = items.length - 1; i >= (keepOld ? keep : 0); i--) req.push({ deleteItem: { location: { index: i } } });
  const add = (keepOld ? [] : fixedItems(s)).concat(s.qs.map(formQuestion));
  add.forEach((item, i) => req.push({ createItem: { item, location: { index: (keepOld ? keep : 0) + i } } }));
  const res = await gapi(`${FORMS_API}/${id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ includeFormInResponse: true, requests: req }) });
  const form = res.form || await gapi(`${FORMS_API}/${id}`);
  const qs = (form.items || []).filter(it => it.questionItem).map(it => it.questionItem.question.questionId);
  const emailQ = qs[0], hireQ = mgr ? qs[1] : '';
  const qmap = {}; s.qs.forEach((q, i) => { qmap[q.q] = qs[keep + i]; });
  // 사전 입력 링크의 entry 번호는 questionId(16진수)를 10진수로 바꾼 값이다
  const entry = x => parseInt(x, 16);
  const responder = form.responderUri;
  const url = responder + (responder.includes('?') ? '&' : '?') + 'usp=pp_url&entry.' + entry(emailQ) + '=test@test.com' + (mgr ? '&entry.' + entry(hireQ) + '=' + encodeURIComponent('홍길동') : '');
  s.form = { api: true, id, url, responder, emailQ, hireQ, qmap, syncedAt: TODAY, dirty: false };
  save();
  return s.form;
}
async function pullFormResponses(s) {
  const mgr = s.audience === '매니저';
  let list = [], token = '';
  do {
    const j = await gapi(`${FORMS_API}/${s.form.id}/responses` + (token ? '?pageToken=' + encodeURIComponent(token) : ''));
    list = list.concat(j.responses || []); token = j.nextPageToken || '';
  } while (token);
  if (!list.length) { toast('아직 Google 폼에 들어온 응답이 없습니다.'); return; }
  const val = (r, id) => { const a = r.answers && r.answers[id]; return a && a.textAnswers ? a.textAnswers.answers.map(x => x.value).join(', ') : ''; };
  const head = ['이메일', ...(mgr ? ['입사자 이름'] : []), ...s.qs.map(q => q.text), '제출 시각'];
  const rows = list.map(r => [val(r, s.form.emailQ), ...(mgr ? [val(r, s.form.hireQ)] : []), ...s.qs.map(q => val(r, s.form.qmap[q.q])), (r.lastSubmittedTime || r.createTime || '').slice(0, 10)]);
  IMP = { src: 'survey', surveyId: s.id };
  location.hash = '#import/survey';
  loadGrid([head, ...rows], 'Google 폼 응답');
}
function busy(b, label, job) {
  const old = b.textContent; b.disabled = true; b.textContent = label;
  return job.then(() => { b.disabled = false; b.textContent = old; }, e => { b.disabled = false; b.textContent = old; modal('Google 폼 작업을 하지 못했습니다', `<p>${esc(e.message)}</p><p class="m-note">설정 → 연결의 "Client ID 만드는 법"에서 Google Forms API를 사용 설정했는지 확인하세요.</p>`, null, null); });
}

/* 문항 만들기 탭 맨 위: Google 폼 상태 */
function gformBox(s) {
  const f = s.form || {};
  const edit = f.id ? `https://docs.google.com/forms/d/${f.id}/edit` : '';
  if (!CONN.google.clientId) return `<section class="panel form-bar"><div><b>Google 폼과 연결</b><span class="w-meta">Google을 연결하면 이 문항 그대로 Google 폼을 만들고, 문항을 고칠 때마다 폼에도 반영합니다.</span></div><div class="row-act"><a class="btn" href="#connect">설정 → 연결에서 Google 연결</a></div></section>`;
  if (f.api) return `<section class="panel form-bar ${f.dirty ? 'is-dirty' : ''}"><div><b>Google 폼과 연결됨</b><span class="w-meta">${f.dirty ? '<b class="warn-t">고친 문항이 아직 Google 폼에 반영되지 않았습니다.</b>' : `문항을 저장하면 Google 폼에도 자동으로 반영됩니다. 마지막 반영 ${D.md(f.syncedAt)}.`}</span></div>
    <div class="row-act">${f.dirty ? `<button class="btn primary" data-act="gform-sync" data-s="${s.id}">지금 반영</button>` : ''}<a class="btn ghost" href="${esc(f.responder)}" target="_blank" rel="noopener">응답 화면 보기</a><a class="btn ghost" href="${edit}" target="_blank" rel="noopener">Google 폼에서 열기</a></div></section>`;
  return `<section class="panel form-bar"><div><b>Google 폼 만들기</b><span class="w-meta">${f.url ? '지금은 직접 연결한 폼을 씁니다. 이 경우 문항을 고쳐도 폼에 반영되지 않습니다. 여기서 새로 만들면 문항이 자동으로 맞춰집니다.' : '아래 문항 그대로 Google 폼을 만듭니다. 이메일' + (s.audience === '매니저' ? '·입사자 이름' : '') + ' 칸은 자동으로 들어가고, 보낼 때 사람마다 미리 채워집니다.'}</span></div>
    <div class="row-act"><button class="btn primary" data-act="gform-create" data-s="${s.id}">이 문항으로 Google 폼 만들기</button></div></section>`;
}
Object.assign(CONNECT_ACTS, {
  'gform-create': b => { const s = S.surveys.find(x => x.id === b.dataset.s); if ($('#survey-edit')) readSurveyForm(s);
    busy(b, '만드는 중…', syncForm(s).then(() => { render(); toast('Google 폼을 만들었습니다. 이제 이 설문은 이 폼으로 보내고 받습니다.'); })); },
  'gform-sync': b => { const s = S.surveys.find(x => x.id === b.dataset.s);
    busy(b, '반영하는 중…', syncForm(s).then(() => { render(); toast('Google 폼에 반영했습니다.'); })); },
});
// 기존 '응답 시트에서 가져오기' 버튼: API로 만든 폼이면 Forms API로 바로 읽는다
CONNECT_ACTS['form-pull'] = b => {
  const s = S.surveys.find(x => x.id === b.dataset.s);
  if (s.form && s.form.api) return busy(b, '가져오는 중…', pullFormResponses(s));
  if (!s.form || !s.form.sheet) { toast('응답 시트 주소를 먼저 넣어 주세요.'); return; }
  pullSurveySheet(s);
};
// 문항을 저장하면 연결된 Google 폼에도 반영
function afterSurveySave(s) {
  if (!(s.form && s.form.api)) return;
  s.form.dirty = true; persist();
  if (!CONN.google.clientId) return;
  syncForm(s).then(() => { render(); toast('저장하고 Google 폼에도 반영했습니다.'); }, e => { render(); toast('저장했지만 Google 폼에는 반영하지 못했습니다. ' + e.message); });
}

/* ───────── IT·총무 요청 현황: 시스템 API · 부서 공유 시트 ───────── */
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const DEPT_TAB = '준비 요청';
function gsheet(url, opt) {
  return googleToken().then(tk => fetch(url, Object.assign({}, opt, { headers: { Authorization: 'Bearer ' + tk, 'Content-Type': 'application/json' } })))
    .then(r => r.json().catch(() => ({})).then(j => { if (!r.ok || j.error) throw new Error('Google 시트가 처리하지 못했습니다: ' + ((j.error && j.error.message) || r.status)); return j; }));
}
/* 중소기업용: IT·총무와 같이 쓰는 공유 시트를 만든다 (상태 칸은 대기·진행 중·완료·보류 중에서 고름) */
async function createDeptSheet() {
  const grid = [DEPT_HEAD, ...deptRows(S, TODAY)];
  const ss = await gsheet(SHEETS_API, { method: 'POST', body: JSON.stringify({ properties: { title: '입사 준비 요청 (IT·총무 공유)', locale: 'ko_KR' }, sheets: [{ properties: { title: DEPT_TAB, gridProperties: { frozenRowCount: 1 } } }] }) });
  const sid = ss.sheets[0].properties.sheetId;
  await gsheet(`${SHEETS_API}/${ss.spreadsheetId}/values/${encodeURIComponent(DEPT_TAB + '!A1')}?valueInputOption=USER_ENTERED`, { method: 'PUT', body: JSON.stringify({ values: grid }) });
  await gsheet(`${SHEETS_API}/${ss.spreadsheetId}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [
    { repeatCell: { range: { sheetId: sid, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.95, green: 0.96, blue: 0.98 } } }, fields: 'userEnteredFormat(textFormat,backgroundColor)' } },
    { setDataValidation: { range: { sheetId: sid, startRowIndex: 1, endRowIndex: 2000, startColumnIndex: 8, endColumnIndex: 9 }, rule: { condition: { type: 'ONE_OF_LIST', values: DEPT_STATES.map(v => ({ userEnteredValue: v })) }, showCustomUi: true, strict: false } } },
    { setDataValidation: { range: { sheetId: sid, startRowIndex: 1, endRowIndex: 2000, startColumnIndex: 9, endColumnIndex: 10 }, rule: { condition: { type: 'DATE_IS_VALID' }, strict: false } } },
    { autoResizeDimensions: { dimensions: { sheetId: sid, dimension: 'COLUMNS', startIndex: 0, endIndex: DEPT_HEAD.length } } },
  ] }) });
  CONN.deptSheet = { id: ss.spreadsheetId, url: ss.spreadsheetUrl, made: TODAY, added: TODAY };
  CONN.sources.dept = { kind: 'sheet', url: ss.spreadsheetUrl, at: '' };
  saveConn();
  return grid.length - 1;
}
/* 새로 생긴 IT·총무 할 일만 시트 아래에 덧붙인다 (부서가 적은 내용은 건드리지 않음) */
async function appendDeptSheet() {
  const id = CONN.deptSheet.id;
  const cur = await gsheet(`${SHEETS_API}/${id}/values/${encodeURIComponent(DEPT_TAB + '!A:A')}`);
  const have = new Set((cur.values || []).map(r => r[0]));
  const rows = deptRows(S, TODAY).filter(r => !have.has(r[0]));
  if (rows.length) await gsheet(`${SHEETS_API}/${id}/values/${encodeURIComponent(DEPT_TAB + '!A1')}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, { method: 'POST', body: JSON.stringify({ values: rows }) });
  CONN.deptSheet.added = TODAY; saveConn();
  return rows.length;
}
function deptPanel() {
  const ds = CONN.deptSheet;
  const n = deptRows(S, TODAY).length;
  return `<div class="dept-ways">
    <section class="dept-way"><div class="dw-head"><b>IT 시스템 연동 (API)</b><span class="tag">대기업·중견</span></div>
      <ul class="dw-list"><li>ServiceNow · Jira · 사내 헬프데스크</li><li>처리 완료 시 자동 ✓</li></ul>
      <div class="row-act"><button class="btn" data-act="dept-demo-api">예시 데이터로 테스트</button></div></section>
    <section class="dept-way"><div class="dw-head"><b>부서 공유 시트</b><span class="tag">중소기업</span></div>
      <ul class="dw-list"><li>IT·총무가 상태만 "완료"로 변경</li><li>대상 할 일 <span class="nw">${n}건</span></li>${ds ? `<li>마지막 추가 <span class="nw">${D.md(ds.added)}</span> · 담당자에게 편집 권한 공유</li>` : ''}</ul>
      ${ds ? `<div class="row-act"><a class="btn ghost" href="${esc(ds.url)}" target="_blank" rel="noopener">시트 열기</a><button class="btn ghost" data-act="dept-append">새 할 일 추가</button></div>`
        : CONN.google.clientId ? `<div class="row-act"><button class="btn primary" data-act="dept-make">시트 생성</button><button class="btn ghost" data-act="sample" data-src="dept-form">양식 다운로드 (.xlsx)</button></div>`
        : `<div class="row-act"><button class="btn" data-act="sample" data-src="dept-form">양식 다운로드 (.xlsx)</button></div><p class="tags"><i>Drive 업로드 → 시트로 열기 → 공유 → 아래 시트 연동</i><i><a href="#connect">Google 연동</a> 시 1클릭 생성</i></p>`}
    </section></div>`;
}
Object.assign(CONNECT_ACTS, {
  'dept-make': b => busy(b, '만드는 중…', createDeptSheet().then(k => { render(); toast(`공유 시트를 만들었습니다 (${k}건). IT·총무 담당자에게 편집 권한으로 공유하세요.`); })),
  'dept-append': b => busy(b, '추가하는 중…', appendDeptSheet().then(k => { render(); toast(k ? `새 할 일 ${k}건을 시트에 추가했습니다.` : '시트에 추가할 새 할 일이 없습니다.'); })),
  /* 예시 IT 요청 시스템: 실제 API 대신 같은 모양의 응답을 브라우저 안에서 만들어 '시스템 API' 연결 그대로 읽는다 */
  'dept-demo-api': () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(sampleITApi(S, TODAY))], { type: 'application/json' }));
    IMP = { src: 'dept' };
    pullSource('dept', { kind: 'api', url, header: 'Authorization: Bearer demo-token', path: 'result' }, false).then(() => { if (IMP) IMP.file = '예시 IT 시스템 API'; render(); });
  },
});
