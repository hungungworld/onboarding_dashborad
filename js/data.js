/* 온보딩 대시보드 — 데이터 구조, 규칙, 더미 데이터, 샘플 파일
   기획: PLANNING.md */

const OWNERS = ['입사자', '매니저', 'IT', '총무', 'HR'];
const KINDS = ['서류', '체크', '버디', 'LMS'];
const HIRE_TYPES = ['신입 공채', '수시', '경력'];

const ORGS = [
  { code: 'FRD', name: '식품연구소' }, { code: 'BSL', name: '바이오영업팀' }, { code: 'FIN', name: '재무팀' },
  { code: 'HRM', name: '인사팀' }, { code: 'MKT', name: '마케팅팀' }, { code: 'PEN', name: '생산기술팀' }, { code: 'DXO', name: 'DX추진팀' },
];
const MANAGERS = {
  FRD: ['윤재석', 'yoon.js@demo-corp.kr'], BSL: ['장미란', 'jang.mr@demo-corp.kr'], FIN: ['오세훈', 'oh.sh@demo-corp.kr'],
  HRM: ['정민아', 'jung.ma@demo-corp.kr'], MKT: ['한소희', 'han.sh@demo-corp.kr'], PEN: ['백승호', 'baek.sh@demo-corp.kr'], DXO: ['서지훈', 'seo.jh@demo-corp.kr'],
};
const COURSES = { SEC101: '정보보안 기본', HR101: '직장 내 괴롭힘 예방', HR102: '성희롱 예방' };

// 기한: offset = 입사일 기준 일수, lead = 마감 며칠 전부터 챙길지. rule이 있으면 규정으로 계산
const DEFAULT_TEMPLATE = [
  ['DOC-CT', '근로계약서 서명', '입사자', '서류', -7, 7, '', '전체', ''],
  ['DOC-ID', '신분증 사본', '입사자', '서류', -7, 7, '', '전체', ''],
  ['DOC-BK', '급여 통장 사본', '입사자', '서류', -7, 7, '', '전체', ''],
  ['DOC-ED', '최종 학력 증명서', '입사자', '서류', -7, 7, '', '전체', ''],
  ['DOC-CR', '경력 증명서', '입사자', '서류', -7, 7, '', '경력', ''],
  ['DOC-HC', '채용 건강검진 결과', '입사자', '서류', -3, 10, '', '전체', ''],
  ['HR-WM', '입사 안내 메일 (첫날 시간·장소·준비물)', 'HR', '체크', -7, 3, '', '전체', ''],
  ['MGR-BD', '버디 지정', '매니저', '버디', -7, 5, '', '전체', ''],
  ['MGR-SY', '직무 시스템 권한 신청', '매니저', '체크', -3, 5, '', '전체', ''],
  ['IT-AC', '메일·메신저 계정 생성', 'IT', '체크', -3, 7, '', '전체', ''],
  ['IT-PC', '노트북 지급 준비', 'IT', '체크', -2, 7, '', '전체', ''],
  ['GA-DS', '자리 배정', '총무', '체크', -3, 7, '', '전체', ''],
  ['GA-ID', '출입증 발급', '총무', '체크', -1, 5, '', '전체', ''],
  ['HR-OR', '오리엔테이션 참석', 'HR', '체크', 0, 0, '', '전체', ''],
  ['GA-NC', '명함 제작', '총무', '체크', 3, 5, '', '전체', ''],
  ['MGR-PL', '30·60·90일 목표 공유', '매니저', '체크', 7, 4, '', '전체', ''],
  ['HR-IS', '4대보험 자격취득 신고', 'HR', '체크', 0, 10, '', '전체', 'nextMonth15'],
  ['LMS-SEC', '의무교육: 정보보안 기본', '입사자', 'LMS', 14, 10, 'SEC101', '전체', ''],
  ['LMS-HAR', '법정교육: 직장 내 괴롭힘 예방', '입사자', 'LMS', 30, 14, 'HR101', '전체', ''],
  ['LMS-SEX', '법정교육: 성희롱 예방', '입사자', 'LMS', 30, 14, 'HR102', '전체', ''],
  ['MGR-PR', '수습 평가 제출', '매니저', '체크', 0, 14, '', '전체', 'probation'],
].map(r => ({ code: r[0], title: r[1], owner: r[2], kind: r[3], offset: r[4], lead: r[5], link: r[6], target: r[7], rule: r[8], active: true }));

const DEFAULT_SURVEYS = [
  { id: 'S7', name: '첫 주 설문', audience: '입사자', day: 7, active: true, qs: [
    { q: 'q1', text: '첫 주가 잘 준비되어 있었다', type: '점수5' },
    { q: 'q2', text: '필요한 장비와 계정을 제때 받았다', type: '점수5' },
    { q: 'q3', text: '모르는 것을 편하게 물어볼 사람이 있다', type: '점수5' },
    { q: 'q4', text: '가장 불편했던 점이나 바라는 점', type: '텍스트' }] },
  { id: 'S30', name: '30일 설문', audience: '입사자', day: 30, active: true, qs: [
    { q: 'q1', text: '내 역할과 기대하는 성과를 이해하고 있다', type: '점수5' },
    { q: 'q2', text: '매니저와 충분히 이야기하고 있다', type: '점수5' },
    { q: 'q3', text: '팀에 잘 적응하고 있다', type: '점수5' },
    { q: 'q4', text: 'HR이 도와줬으면 하는 일', type: '텍스트' }] },
  { id: 'M30', name: '매니저 30일 체크인', audience: '매니저', day: 30, active: true, qs: [
    { q: 'q1', text: '입사자가 팀과 업무에 잘 적응하고 있다', type: '점수5' },
    { q: 'q2', text: '걱정되는 점', type: '텍스트' },
    { q: 'q3', text: 'HR의 도움이 필요하다', type: '예아니오' }] },
  { id: 'S90', name: '90일 설문', audience: '입사자', day: 90, active: true, qs: [
    { q: 'q1', text: '입사 전 기대와 실제 일이 비슷하다', type: '점수5' },
    { q: 'q2', text: '이 회사를 지인에게 추천하겠다', type: '추천10' },
    { q: 'q3', text: '첫 90일을 돌아보며 하고 싶은 말', type: '텍스트' }] },
];
const SURVEY_WINDOW = 14; // 발송 후 14일이 지나면 미응답으로 본다

/* ───────── 날짜 ───────── */
/* 한국 공휴일 (대체공휴일·선거일·근로자의 날 포함). 입사일과 기한이 쉬는 날에 걸리지 않도록 쓴다. */
const KR_HOLIDAYS = {
  '2025-01-01': '신정', '2025-01-27': '임시공휴일', '2025-01-28': '설날 연휴', '2025-01-29': '설날', '2025-01-30': '설날 연휴',
  '2025-03-01': '삼일절', '2025-03-03': '대체공휴일', '2025-05-01': '근로자의 날', '2025-05-05': '어린이날·부처님오신날', '2025-05-06': '대체공휴일',
  '2025-06-03': '대통령 선거일', '2025-06-06': '현충일', '2025-08-15': '광복절', '2025-10-03': '개천절',
  '2025-10-05': '추석 연휴', '2025-10-06': '추석', '2025-10-07': '추석 연휴', '2025-10-08': '대체공휴일', '2025-10-09': '한글날', '2025-12-25': '성탄절',
  '2026-01-01': '신정', '2026-02-16': '설날 연휴', '2026-02-17': '설날', '2026-02-18': '설날 연휴',
  '2026-03-01': '삼일절', '2026-03-02': '대체공휴일', '2026-05-01': '노동절', '2026-05-05': '어린이날', '2026-05-24': '부처님오신날', '2026-05-25': '대체공휴일',
  '2026-06-03': '지방선거일', '2026-06-06': '현충일', '2026-07-17': '제헌절', '2026-08-15': '광복절', '2026-08-17': '대체공휴일',
  '2026-09-24': '추석 연휴', '2026-09-25': '추석', '2026-09-26': '추석 연휴', '2026-10-03': '개천절', '2026-10-05': '대체공휴일', '2026-10-09': '한글날', '2026-12-25': '성탄절',
  '2027-01-01': '신정', '2027-02-06': '설날 연휴', '2027-02-07': '설날', '2027-02-08': '설날 연휴', '2027-02-09': '대체공휴일',
  '2027-03-01': '삼일절', '2027-05-01': '노동절', '2027-05-05': '어린이날', '2027-05-13': '부처님오신날', '2027-06-06': '현충일', '2027-07-17': '제헌절',
  '2027-08-15': '광복절', '2027-08-16': '대체공휴일', '2027-09-14': '추석 연휴', '2027-09-15': '추석', '2027-09-16': '추석 연휴',
  '2027-10-03': '개천절', '2027-10-04': '대체공휴일', '2027-10-09': '한글날', '2027-10-11': '대체공휴일', '2027-12-25': '성탄절', '2027-12-27': '대체공휴일',
};
const D = {
  today() { const d = new Date(); return D.fmt(d.getFullYear(), d.getMonth() + 1, d.getDate()); },
  fmt(y, m, d) { return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'); },
  n(s) { const p = String(s).split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]) / 864e5; },
  add(s, k) { return new Date((D.n(s) + Number(k)) * 864e5).toISOString().slice(0, 10); },
  addMonths(s, k) { const p = s.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1 + k, p[2])).toISOString().slice(0, 10); },
  diff(a, b) { return D.n(a) - D.n(b); },
  md(s) { if (!s) return ''; const p = s.split('-'); return Number(p[1]) + '/' + Number(p[2]); },
  dow(s) { return '일월화수목금토'[new Date(D.n(s) * 864e5).getUTCDay()]; },
  dday(start, today) { const k = D.diff(today, start); return k < 0 ? 'D' + k : k === 0 ? '입사일' : 'D+' + k; },
  /** 엑셀에서 온 날짜 값(문자, 일련번호, Date)을 yyyy-mm-dd로 */
  parse(v) {
    if (v === null || v === undefined || v === '') return '';
    if (v instanceof Date && !isNaN(v)) return D.fmt(v.getFullYear(), v.getMonth() + 1, v.getDate());
    if (typeof v === 'number' && v > 20000 && v < 80000) return D.add('1899-12-30', Math.floor(v));
    const m = String(v).trim().match(/^(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/);
    return m ? D.fmt(+m[1], +m[2], +m[3]) : '';
  },
  holiday(s) { return KR_HOLIDAYS[s] || ''; },
  isWorkday(s) { const w = new Date(D.n(s) * 864e5).getUTCDay(); return w !== 0 && w !== 6 && !KR_HOLIDAYS[s]; },
  nextWork(s) { while (!D.isWorkday(s)) s = D.add(s, 1); return s; },
  prevWork(s) { while (!D.isWorkday(s)) s = D.add(s, -1); return s; },
};

/* ───────── 규칙 ───────── */
function probationEnd(h, months) { return D.add(D.addMonths(h.start, months || 3), -1); }
/* 기한이 주말·공휴일에 걸리면:
   - 법정 신고 기한은 다음 근무일 (기간의 말일이 공휴일이면 그 다음 날 만료)
   - 입사 전 준비와 수습 평가는 앞당겨 직전 근무일
   - 입사 후 일은 다음 근무일 */
function dueOf(t, h, settings) {
  if (t.rule === 'nextMonth15') { const p = h.start.split('-').map(Number); return D.nextWork(p[1] === 12 ? D.fmt(p[0] + 1, 1, 15) : D.fmt(p[0], p[1] + 1, 15)); }
  if (t.rule === 'probation') return D.prevWork(D.add(probationEnd(h, settings.probationMonths), -5));
  const d = D.add(h.start, t.offset);
  return t.offset < 0 ? D.prevWork(d) : D.nextWork(d);
}
function taskStatus(t, today) {
  if (t.closed) return '종료';
  if (t.done) return '완료';
  if (t.memo) return '문제';
  const due = D.n(t.due), now = D.n(today);
  if (now > due) return '지연';
  if (now >= due - (Number(t.lead) || 0)) return '진행';
  return '대기';
}
const STAGES = ['입사 전', '첫 주', '1개월 차', '2개월 차', '3개월 차'];
function hireStage(h, today) {
  if (h.status === '입사 취소') return '입사 취소';
  if (h.leave) return '퇴사';
  const k = D.diff(today, h.start);
  if (k < 0) return '입사 전';
  if (k < 7) return '첫 주';
  if (k < 30) return '1개월 차';
  if (k < 60) return '2개월 차';
  if (k <= 90) return '3개월 차';
  return '온보딩 종료';
}
function applies(target, type) {
  if (!target || target === '전체') return true;
  return target.split(',').map(s => s.trim()).includes(type);
}
function makeTasks(h, template, settings, today) {
  return template.filter(t => t.active && applies(t.target, h.type) && !(t.kind === '버디' && h.buddy)).map(t => {
    const due = dueOf(t, h, settings);
    const stale = D.n(due) < D.n(today) - 7;
    return { id: h.key + '-' + t.code, key: h.key, code: t.code, title: t.title, owner: t.owner, kind: t.kind, link: t.link, rule: t.rule,
      offset: t.offset, due, lead: t.lead, done: '', by: '', memo: '', closed: stale ? '등록 전에 마감 지남' : '' };
  });
}
function newKey(hires, start) {
  const p = start.slice(2, 4) + start.slice(5, 7);
  const used = hires.map(h => h.key).filter(k => k.startsWith('N-' + p + '-')).map(k => +k.slice(-3));
  return 'N-' + p + '-' + String((used.length ? Math.max(...used) : 0) + 1).padStart(3, '0');
}

/* ───────── 더미 데이터 (오늘 날짜 기준, 매번 같은 결과) ───────── */
function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const NAMES = ['박서윤', '최도윤', '김하준', '이수아', '정우진', '한지호', '강민서', '윤지안', '조예준', '임하은', '오시우', '신채원',
  '권도현', '황서진', '송지후', '안유나', '류준서', '홍다인', '전민재', '고은채', '문태윤', '양서아', '배지환', '노하린', '서지율',
  '남궁윤', '차은호', '유가온', '구민준', '진소율', '하예린', '탁건우', '마서영', '편도하', '석지아'];

function buildDemo(today) {
  const r = rng(20261104);
  const settings = { probationMonths: 3 };
  const template = DEFAULT_TEMPLATE.map(t => Object.assign({}, t));
  const hires = [];
  let ni = 0;
  const JOBS = { FRD: '제품 개발', BSL: 'B2B 영업', FIN: '회계', HRM: 'HR 운영', MKT: '브랜드 마케팅', PEN: '공정 기술', DXO: '데이터 분석' };
  const add = (type, cohort, offset, org, rank) => {
    const start = D.nextWork(D.add(today, offset)); // 입사일은 근무일로
    const m = MANAGERS[org], n = ni++;
    const h = { key: newKey(hires, start), empNo: offset <= -10 ? 'E' + start.slice(2, 4) + String(1000 + n).slice(1) : '', name: NAMES[n], email: 'user' + (n + 1) + '@mail-demo.kr',
      start, type, cohort, org, job: JOBS[org], rank, site: org === 'FRD' ? '연구소' : org === 'PEN' ? '공장' : '본사', mgr: m[1], mgrName: m[0],
      buddy: offset < -6 ? ['김선우', '이도경', '박하람', '최유진', '정태민'][n % 5] : '', status: '', leave: '', note: '', source: '채용 시스템' };
    hires.push(h);
    return h;
  };
  const orgs = ORGS.map(o => o.code);
  for (let i = 0; i < 10; i++) add('신입 공채', '26하반기 1기', -44, orgs[i % 7], '사원');
  for (let i = 0; i < 8; i++) add('신입 공채', '26하반기 2기', 9, orgs[(i + 3) % 7], '사원');
  [[-79, 'BSL'], [-32, 'FIN'], [-9, 'MKT'], [-3, 'HRM'], [2, 'HRM'], [5, 'DXO'], [13, 'FRD']].forEach(([o, g]) => add('수시', '', o, g, '사원'));
  [[-53, 'FIN', '과장'], [-16, 'DXO', '대리'], [4, 'PEN', '과장'], [20, 'BSL', '차장']].forEach(([o, g, rk]) => add('경력', '', o, g, rk));
  [[-97, 'FRD', '수시'], [-104, 'BSL', '경력'], [-112, 'MKT', '신입 공채'], [-118, 'FIN', '신입 공채'], [-133, 'PEN', '수시']]
    .forEach(([o, g, ty]) => add(ty, ty === '신입 공채' ? '26상반기' : '', o, g, ty === '경력' ? '대리' : '사원'));
  const quit = add('수시', '', -61, 'PEN', '사원'); quit.leave = D.add(today, -19); quit.note = '개인 사정으로 자진 퇴사';

  const hard = new Set([hires[2].key, hires[21].key]); // 적응이 어려운 두 사람
  const tasks = [];
  hires.forEach(h => {
    makeTasks(h, template, settings, D.add(today, -999)).forEach(t => {
      const due = D.n(t.due), now = D.n(today);
      if (h.leave && due > D.n(h.leave)) { t.closed = '퇴사'; tasks.push(t); return; }
      let p = due < now ? 0.95 : due - now <= 3 ? 0.5 : due - now <= 7 ? 0.25 : 0.03;
      if (due < now - 10) p = 0.995;
      if (t.kind === 'LMS' && due < now) p = due < now - 20 ? 0.99 : 0.8;
      if (t.kind === 'LMS' && !h.empNo) p = 0;
      if (r() < p) {
        const d = Math.min(now, due - Math.floor(r() * 4) + (r() < 0.12 ? 2 : 0));
        t.done = D.add(today, d - now);
        t.by = t.kind === 'LMS' ? 'LMS 가져오기' : 'HR 체크';
      }
      tasks.push(t);
    });
  });
  const memo = (h, code, text) => { const t = tasks.find(x => x.key === h.key && x.code === code); if (t) { t.done = ''; t.memo = text; } };
  memo(hires[11], 'IT-PC', D.md(D.add(today, -1)) + ' IT 이정훈: 노트북 재고 부족, 다음 주 수요일 입고 예정');
  memo(hires[24], 'GA-ID', D.md(today) + ' 총무: 연구소 출입증은 보안교육 이수 후 발급');
  memo(hires[4], 'MGR-SY', D.md(D.add(today, -2)) + ' 매니저: ERP 재무 모듈 승인권자 휴가 중');

  const surveys = DEFAULT_SURVEYS.map(s => JSON.parse(JSON.stringify(s)));
  const sends = [], resp = [];
  const pool = { S7: ['노트북 받기 전 이틀 동안 할 일이 없었어요', '버디 덕분에 첫 주가 편했습니다', '사내 시스템 권한 받는 데 시간이 걸렸어요', '첫날 일정표가 미리 있었으면 좋겠어요'],
    S30: ['직무 교육 일정이 조금 더 빨리 안내되면 좋겠어요', '팀 업무 매뉴얼이 있으면 좋겠습니다', '동기들과 만날 자리가 있으면 좋겠어요'],
    M30: ['업무량 조절이 필요해 보임', '질문을 잘 안 해서 걱정', '빠르게 적응 중'], S90: ['처음엔 막막했는데 지금은 자리 잡았습니다', '동기 모임이 큰 도움이 됐어요', '선배들이 잘 알려줬습니다'] };
  hires.forEach(h => {
    surveys.forEach(s => {
      const sendDay = D.add(h.start, s.day);
      const k = D.diff(today, sendDay);
      if (k < 0 || (h.leave && D.n(h.leave) < D.n(sendDay))) return;
      if (k <= 2) return; // 최근 도래한 사람은 아직 발송 전 → '발송 대기'에 뜬다
      if (s.id === 'S30' && [7, 8, 9].includes(hires.indexOf(h))) return; // 1기 중 세 명은 30일 설문을 아직 못 보냄 → '보낼 대상'에 뜬다
      const send = { id: 'SND-' + (sends.length + 1), survey: s.id, key: h.key, sentAt: sendDay, token: (Math.floor(r() * 1e10)).toString(36) + sends.length, respondedAt: '', via: '' };
      sends.push(send);
      const isHard = hard.has(h.key);
      const p = k > 4 ? (isHard && s.audience === '매니저' ? 0.5 : 0.85) : 0.3;
      if (r() >= p) return;
      send.respondedAt = D.add(sendDay, Math.min(k, Math.floor(r() * 4)));
      send.via = '설문 링크';
      s.qs.forEach(q => {
        let score = '', answer = '';
        if (q.type === '점수5') score = isHard ? [1, 2, 2, 3][Math.floor(r() * 4)] : [5, 5, 4, 4, 4, 3][Math.floor(r() * 6)];
        else if (q.type === '추천10') score = isHard ? 4 + Math.floor(r() * 3) : [10, 9, 9, 8, 8, 7, 6][Math.floor(r() * 7)];
        else if (q.type === '예아니오') answer = isHard ? '예' : '아니오';
        else if (isHard && s.id === 'S7') answer = '장비와 계정이 늦게 와서 첫 주를 거의 기다리면서 보냈습니다';
        else if (r() < 0.6) answer = pool[s.id][Math.floor(r() * pool[s.id].length)];
        if (score !== '' || answer) resp.push({ send: send.id, survey: s.id, key: h.key, q: q.q, score, answer, at: send.respondedAt });
      });
    });
  });

  const lastImport = { ats: D.add(today, -3), hris: D.add(today, -6), lms: D.add(today, -9), survey: '' };
  const imports = [
    { at: lastImport.lms, source: 'lms', file: 'LMS_이수현황.xlsx', summary: '수료 반영 14건' },
    { at: lastImport.hris, source: 'hris', file: '인사기본정보.xlsx', summary: '사번 연결 3명' },
    { at: lastImport.ats, source: 'ats', file: '합격자명단.xlsx', summary: '새 입사자 2명, 입사일 변경 1명' },
  ];
  return { v: 3, hires, tasks, template, surveys, sends, resp, settings, lastImport, imports };
}

/* ───────── 샘플 파일 (화면 속 데이터와 맞물리게 그때그때 만든다) ───────── */
const orgNameOf = c => (ORGS.find(o => o.code === c) || {}).name || c;
function sampleATS(S, today) {
  const head = ['지원자명', '이메일', '전형', '기수', '배치부서', '모집직무', '직급', '근무지', '현업 담당자 이메일', '입사 예정일', '합격자 상태'];
  const upcoming = S.hires.filter(h => !h.leave && h.status !== '입사 취소' && D.diff(h.start, today) > 0).sort((a, b) => D.n(a.start) - D.n(b.start));
  const rows = upcoming.map(h => [h.name, h.email, h.type, h.cohort, orgNameOf(h.org), h.job, h.rank, h.site, h.mgr, h.start, '입사 확정']);
  if (rows[1]) rows[1][9] = D.add(rows[1][9], 7);   // 입사일이 1주 밀린 사람
  if (rows[3]) rows[3][10] = '입사 포기';             // 입사를 포기한 사람
  const fresh = [
    ['방현우', 'bang.hw@mail-demo.kr', '수시', '', '마케팅팀', '퍼포먼스 마케팅', '사원', '본사', MANAGERS.MKT[1], D.add(today, 18), '입사 확정'],
    ['추서연', 'choo.sy@mail-demo.kr', '경력', '', '식품연구소', '제품 개발', '대리', '연구소', MANAGERS.FRD[1], D.add(today, 23), '입사 확정'],
    ['길태오', 'gil.to@mail-demo.kr', '신입 공채', '26하반기 3기', 'DX추진팀', '데이터 분석', '사원', '본사', MANAGERS.DXO[1], D.add(today, 30), '입사 확정']];
  return [head, ...rows, ...fresh];
}
function sampleHRIS(S, today) {
  const head = ['사번', '성명', '입사일', '소속', '직급', '재직구분', '퇴직일'];
  const started = S.hires.filter(h => h.status !== '입사 취소' && D.diff(h.start, today) <= 0);
  let k = 0;
  const rows = started.map(h => [h.empNo || 'E' + h.start.slice(2, 4) + String(800 + (k++)), h.name, h.start, orgNameOf(h.org), h.rank, h.leave ? '퇴직' : '재직', h.leave || '']);
  const target = rows.find(rw => rw[5] === '재직' && D.diff(today, rw[2]) > 30 && D.diff(today, rw[2]) < 60);
  if (target) { target[5] = '퇴직'; target[6] = D.add(today, -2); }
  return [head, ...rows];
}
function sampleLMS(S) {
  const head = ['사번', '이름', '과정코드', '과정명', '수강시작일', '수료일', '수료여부'];
  const rows = [];
  S.tasks.filter(t => t.kind === 'LMS' && !t.done && !t.closed).forEach((t, i) => {
    const h = S.hires.find(x => x.key === t.key);
    if (!h || !h.empNo) return;
    const ok = i % 4 !== 3;
    rows.push([h.empNo, h.name, t.link, COURSES[t.link] || t.link, D.add(t.due, -12), ok ? D.add(t.due, -4) : '', ok ? '수료' : '미수료']);
  });
  rows.push(['E99999', '(퇴사자)', 'SEC101', COURSES.SEC101, '2026-01-02', '2026-01-03', '수료']);
  return [head, ...rows];
}
function sampleSurvey(S, surveyId) {
  const s = S.surveys.find(x => x.id === surveyId);
  const mgr = s.audience === '매니저';
  const head = ['타임스탬프', '이메일 주소', ...(mgr ? ['입사자 이름'] : []), ...s.qs.map(q => q.text)];
  const pending = S.sends.filter(x => x.survey === surveyId && !x.respondedAt);
  const rows = pending.slice(0, Math.max(1, Math.ceil(pending.length * 0.6))).map((x, i) => {
    const h = S.hires.find(y => y.key === x.key);
    return [D.add(x.sentAt, 2) + ' 10:' + String(10 + i).padStart(2, '0') + ':00', mgr ? h.mgr : h.email, ...(mgr ? [h.name] : []),
      ...s.qs.map(q => q.type === '점수5' ? 3 + (i % 3) : q.type === '추천10' ? 7 + (i % 4) : q.type === '예아니오' ? '아니오' : (i % 2 ? '' : '안내가 친절했습니다'))];
  });
  return [head, ...rows];
}
