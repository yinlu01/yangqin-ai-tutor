/* 扬琴 AI 助教 · MVP 后端（零依赖 / 单端口 / 文件存储）
   启动：node server.js   （默认 http://localhost:8787） */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
const PUB = path.join(ROOT, 'public');
const STATE = path.join(DATA, 'state.json');
const AUDIO = path.join(DATA, 'audio');
try { fs.mkdirSync(AUDIO, { recursive: true }); } catch (e) { console.warn('audio 目录不可写：' + e.message); }

const SCORES = JSON.parse(fs.readFileSync(path.join(ROOT, 'scores.json'), 'utf8'));
const PORT = process.env.PORT || 8787;
const MAX_BODY = 80 * 1024 * 1024; // 录音可能几 MB

function blank(){ return { students: [], scores: JSON.parse(JSON.stringify(SCORES)), lessons: [], homework: [],
  settings: { teacherName: '老师', firstRun: true }, meta: { created: Date.now() }, rev: 0 }; }

let S = (() => {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); }
  catch (e) { const b = blank(); try { fs.writeFileSync(STATE, JSON.stringify(b)); } catch (_) {} return b; }
})();
let DISK = true;
function save(){
  S.rev = (S.rev || 0) + 1;
  try { fs.writeFileSync(STATE, JSON.stringify(S)); }
  catch (e) { if (DISK) { DISK = false; console.warn('磁盘不可写，数据仅保存在内存（重启会丢）：' + e.message); } }
}

const MIME = { '.html':'text/html; charset=utf-8', '.js':'application/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml',
  '.png':'image/png', '.ico':'image/x-icon', '.webm':'audio/webm', '.m4a':'audio/mp4', '.mp4':'audio/mp4' };

function json(res, obj, code){ const b = JSON.stringify(obj); res.writeHead(code || 200,
  { 'content-type':'application/json; charset=utf-8', 'content-length': Buffer.byteLength(b) }); res.end(b); }

function readBody(req){
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

const uid = p => p + '_' + Math.random().toString(36).slice(2, 8);

async function route(req, res){
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;

  /* ---------- API ---------- */
  if (p === '/api/state') return json(res, S);
  if (p === '/api/ping') return json(res, { ok: true, rev: S.rev || 0, ts: Date.now() });

  if (p === '/api/student' && req.method === 'POST'){
    const b = await readBody(req);
    if (b.phone){
      const dup = S.students.find(x => x.phone === String(b.phone).trim());
      if (dup) return json(res, { ok: false, msg: '这个手机号已经登记过了（' + dup.name + '）' });
    }
    const sid = (b.id && !S.students.some(x => x.id === b.id)) ? String(b.id) : ('stu_' + Math.random().toString(36).slice(2, 8));
    const st = { id: sid, name: (b.name || '').trim() || '未命名',
      level: b.level || '入门', phone: b.phone ? String(b.phone).trim() : '',
      color: ['#c2410c','#0d9488','#7c3aed','#2563eb','#db2777','#65a30d'][S.students.length % 6] };
    S.students.push(st); save(); return json(res, { ok: true, student: st });
  }
  if (p === '/api/student/update' && req.method === 'POST'){
    const b = await readBody(req); const st = S.students.find(x => x.id === b.id);
    if (st){
      if (b.name) st.name = b.name; if (b.level) st.level = b.level;
      if (b.phone !== undefined){
        const other = S.students.find(x => x.phone === String(b.phone).trim() && x.id !== st.id);
        if (other) return json(res, { ok: false, msg: '该手机号已被 ' + other.name + ' 使用' });
        st.phone = String(b.phone).trim();
      }
      save();
    }
    return json(res, { ok: !!st });
  }
  /* 孩子端：手机号登录 */
  if (p === '/api/login' && req.method === 'POST'){
    const b = await readBody(req);
    const ph = String(b.phone || '').trim();
    const st = S.students.find(x => x.phone && x.phone === ph);
    if (!st) return json(res, { ok: false, msg: '这个手机号还没有被老师登记，请老师先在学生档案里加入你' });
    return json(res, { ok: true, student: st });
  }
  if (p === '/api/student/delete' && req.method === 'POST'){
    const b = await readBody(req);
    S.students = S.students.filter(x => x.id !== b.id);
    S.homework = S.homework.filter(x => x.studentId !== b.id);
    S.lessons = S.lessons.filter(x => x.studentId !== b.id);
    save(); return json(res, { ok: true });
  }

  if (p === '/api/lesson' && req.method === 'POST'){
    const b = await readBody(req);
    const lsn = b.lesson || {}; lsn.id = lsn.id || uid('lsn'); lsn.createdAt = Date.now();
    S.lessons.push(lsn);
    (b.homework || []).forEach(h => { h.id = h.id || uid('hw'); h.lessonId = lsn.id;
      h.status = h.status || 'assigned'; h.createdAt = Date.now(); S.homework.push(h); });
    save(); return json(res, { ok: true, lesson: lsn, count: (b.homework || []).length });
  }

  if (p === '/api/media' && req.method === 'POST'){
    const b = await readBody(req);
    if (!b.data) return json(res, { ok: false, msg: '没有文件内容' }, 400);
    const id = uid(b.kind === 'video' ? 'vid' : 'au');
    const t = (b.type || '').toLowerCase();
    const ext = t.includes('mp4') ? '.mp4' : t.includes('quicktime') ? '.mov' : t.includes('webm') ? '.webm'
      : t.includes('mpeg') ? '.mp3' : t.includes('m4a') ? '.m4a' : (b.kind === 'video' ? '.mp4' : '.webm');
    const buf = Buffer.from(String(b.data).split(',')[1] || '', 'base64');
    fs.writeFileSync(path.join(AUDIO, id + ext), buf);
    console.log('media saved', id + ext, (buf.length / 1024).toFixed(0) + 'KB');
    return json(res, { ok: true, id: id });
  }

  if (p === '/api/submit' && req.method === 'POST'){
    const b = await readBody(req);
    const hw = S.homework.find(x => x.id === b.id);
    if (!hw) return json(res, { ok: false, msg: '作业不存在' }, 404);
    let aid = '';
    if (b.audio && b.audio.data){
      aid = uid('au');
      const buf = Buffer.from(String(b.audio.data).split(',')[1] || '', 'base64');
      const ext = (b.audio.type || '').includes('mp4') ? '.m4a' : (b.audio.type || '').includes('mpeg') ? '.mp3' : '.webm';
      fs.writeFileSync(path.join(AUDIO, aid + ext), buf);
    }
    hw.sub = Object.assign({}, b.sub || {}, { audioId: aid || (b.sub && b.sub.audioId) || '', at: Date.now() });
    if (hw.status !== 'reviewed') hw.status = 'submitted';
    save(); return json(res, { ok: true, audioId: aid });
  }

  if (p === '/api/review' && req.method === 'POST'){
    const b = await readBody(req);
    const hw = S.homework.find(x => x.id === b.id);
    if (!hw) return json(res, { ok: false }, 404);
    hw.review = Object.assign({}, b.review || {}, { at: Date.now() });
    hw.status = 'reviewed'; save(); return json(res, { ok: true });
  }

  if (p === '/api/score' && req.method === 'POST'){
    const b = await readBody(req); const sc = b.score;
    if (!sc || !sc.title) return json(res, { ok: false }, 400);
    sc.id = sc.id || uid('sc'); S.scores.push(sc); save(); return json(res, { ok: true, score: sc });
  }

  if (p === '/api/patch' && req.method === 'POST'){
    const b = await readBody(req);
    if (b.kind === 'homework'){
      const hw = S.homework.find(x => x.id === b.id);
      if (hw) Object.assign(hw, b.patch || {});
      save(); return json(res, { ok: !!hw });
    }
    if (b.kind === 'student'){
      const st = S.students.find(x => x.id === b.id);
      if (st) Object.assign(st, b.patch || {});
      save(); return json(res, { ok: !!st });
    }
    if (b.kind === 'state'){
      Object.assign(S, b.patch || {}); save(); return json(res, { ok: true });
    }
    return json(res, { ok: false, msg: 'unknown kind' }, 400);
  }

  if (p === '/api/reset' && req.method === 'POST'){
    const b = await readBody(req);
    if (b.mode === 'clear'){ S = blank(); S.students = []; }
    else { S = blank();
      S.students = [
        { id:'stu_1', name:'林小雨', level:'入门 3 个月', color:'#c2410c', phone:'13800000001' },
        { id:'stu_2', name:'陈乐乐', level:'入门 6 个月', color:'#0d9488', phone:'13800000002' },
        { id:'stu_3', name:'王思思', level:'1 级备考', color:'#7c3aed', phone:'13800000003' }
      ];
    }
    save(); return json(res, { ok: true });
  }

  if (p.startsWith('/audio/') || p.startsWith('/media/')){
    const id = p.split('/')[2];
    const dir = fs.readdirSync(AUDIO);
    const f = dir.find(x => x.startsWith(id + '.'));
    if (!f){ res.writeHead(404); return res.end('not found'); }
    const buf = fs.readFileSync(path.join(AUDIO, f));
    res.writeHead(200, { 'content-type': (MIME[path.extname(f)] || 'audio/webm'), 'content-length': buf.length });
    return res.end(buf);
  }

  /* ---------- 静态 ---------- */
  let f = p;
  if (p === '/' || p === '/t' || p === '/teacher' || p === '/teacher.html') f = '/teacher.html';
  else if (p === '/s' || p === '/student' || p === '/student.html') f = '/student.html';
  else if (p === '/index.html') f = '/index.html';
  const fp = path.join(PUB, decodeURIComponent(f));
  if (!fp.startsWith(PUB) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()){
    fp = path.join(PUB, 'index.html');
  }
  const ext = path.extname(fp);
  const buf = fs.readFileSync(fp);
  res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'content-length': buf.length,
    'cache-control': 'no-cache' });
  res.end(buf);
}

http.createServer((req, res) => {
  route(req, res).catch(e => { console.error('ERR', e.message); try { json(res, { ok:false, msg:e.message }, 500); } catch (_){} });
}).listen(PORT, () => console.log('扬琴 AI 助教 MVP → http://localhost:' + PORT));
