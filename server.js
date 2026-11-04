// Máy chủ nội bộ cho game "Đi chùa khi bị Sếp chửi". Chỉ cần Node.js, không cài thêm gì.
// Vị trí người chơi chỉ nằm trong bộ nhớ. Ghi xuống đĩa có bảng hạng (bang-hang.json) và
// lời nhắn hoa đăng công khai (hoa-dang.json). Lời cầu trên dải lụa không bao giờ gửi lên đây.
// Tin nhắn trò chuyện chỉ nằm trong bộ nhớ, tắt máy chủ là mất.
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');

const CONG = +process.env.PORT || 8080;
const TOI_DA = 30;            // Dư cho 10–20 người
const GIU_TEN_MS = 20000;     // Mất kết nối bao lâu thì nhả Pháp danh
const GIAN_CACH_THI_MS = 20000; // Một lượt thi thật mất hơn 20 giây
const TRANG = path.join(__dirname, 'index.html');
const FILE_BANG = path.join(process.env.DATA_DIR || __dirname, 'bang-hang.json');
const FILE_TT = path.join(process.env.DATA_DIR || __dirname, 'tri-tue.json');
const FILE_DEN = path.join(process.env.DATA_DIR || __dirname, 'hoa-dang.json');
const MA_VAO = (process.env.MA_VAO || '').trim(); // Đặt khi chạy trên internet để chỉ người có mã mới vào được

const nguoi = new Map();      // id -> { id, n, g, x, z, r, p, res, roi, thi }
let ngayNay = '', denHomNay = new Set(), doi = true;
let bang = {};                // tên chuẩn hoá -> { n, d }
try { bang = JSON.parse(fs.readFileSync(FILE_BANG, 'utf8')); } catch { bang = {}; }

const chuanTen = s => s.normalize('NFC').toLowerCase();
const homNay = () => new Date().toLocaleDateString('vi-VN');
function capNhatNgay() { const d = homNay(); if (d !== ngayNay) { ngayNay = d; denHomNay = new Set(); } }

function docBody(req) {
  return new Promise((ok, loi) => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > 2048) { loi(new Error('quá dài')); req.destroy(); } });
    req.on('end', () => { try { ok(JSON.parse(s || '{}')); } catch (e) { loi(e); } });
    req.on('error', loi);
  });
}
const json = (res, ma, o) => { res.writeHead(ma, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(o)); };
const so = (v, a, b, md) => (typeof v === 'number' && isFinite(v)) ? Math.min(b, Math.max(a, v)) : md;

function vao(res, b) {
  capNhatNgay();
  if (MA_VAO && String(b.ma || '').trim() !== MA_VAO) return json(res, 403, { loi: 'Mã vào chùa chưa đúng. Bạn hỏi lại người gửi link nhé.' });
  const ten = String(b.ten || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().replace(/\s+/g, ' ').slice(0, 24);
  if ([...ten].length < 2) return json(res, 400, { loi: 'Bạn đặt Pháp danh từ 2 ký tự trở lên nhé.' });
  const cu = typeof b.cu === 'string' ? b.cu : '';
  for (const q of nguoi.values()) {
    if (q.id !== cu && chuanTen(q.n) === chuanTen(ten)) return json(res, 409, { loi: `Pháp danh "${ten}" đang có người dùng. Bạn chọn tên khác hoặc chạm Thỉnh tên nhé.` });
  }
  const conLai = nguoi.has(cu) ? nguoi.size - 1 : nguoi.size;
  if (conLai >= TOI_DA) return json(res, 409, { loi: 'Sân chùa đang đầy. Bạn đợi một lát rồi vào lại nhé.' });
  if (nguoi.has(cu)) { nguoi.get(cu).res?.end(); nguoi.delete(cu); }
  const id = crypto.randomBytes(12).toString('hex');
  nguoi.set(id, { id, n: ten, g: b.g === 'nu' ? 'nu' : 'nam', x: 0, z: 29, r: Math.PI, p: 'dung', res: null, roi: Date.now(), thi: 0 });
  denHomNay.add(chuanTen(ten)); doi = true;
  // Máy chủ miễn phí có thể mất file khi khởi động lại: điểm cao nhất lưu trên máy người chơi sẽ tự ghi lại khi họ vào
  const hangCu = Math.round(so(b.hang, 0, 1000, 0)), kTen = chuanTen(ten);
  if (hangCu > (bang[kTen]?.d ?? 0)) { bang[kTen] = { n: ten, d: hangCu }; ghiBang(); }
  const ttCu = Math.round(so(b.tt, 0, 150, 0));
  if (ttCu > (bangTT[kTen]?.d ?? 0)) { bangTT[kTen] = { n: ten, d: ttCu }; ghiTT(); }
  // Tương tự, đèn hoa đăng công khai của người chơi được thả lại khi họ vào
  if (Array.isArray(b.den)) for (const d of b.den.slice(0, 5)) themDen(ten, d?.t, so(d?.ts, 0, 9e15, Date.now()));
  json(res, 200, { id });
}
function viTri(res, b) {
  const q = nguoi.get(b.id);
  if (!q) return json(res, 410, { loi: 'Phiên đã hết' });
  q.x = so(b.x, -30, 175, q.x); q.z = so(b.z, -50, 75, q.z); q.r = so(b.r, -100, 100, q.r);
  q.p = b.p === 'chap' || b.p === 'ngoi' ? b.p : 'dung'; doi = true;
  // Trang phục và danh hiệu chỉ để hiển thị cho người khác
  q.ao = /^[a-z]{1,12}$/.test(b.ao) ? b.ao : 'lam'; q.phu = /^[a-z,]{0,40}$/.test(b.phu) ? b.phu : '';
  q.dh = typeof b.dh === 'string' ? b.dh.replace(/[\u0000-\u001f\u007f<>]/g, '').slice(0, 28) : '';
  json(res, 200, {});
}
function suKien(req, res, id) {
  const q = nguoi.get(id);
  if (!q) { res.writeHead(410); return res.end(); }
  q.res?.end();
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  q.res = res; q.roi = 0; doi = true;
  res.write(`data: ${banTin()}\n\n`);
  res.write(`data: ${JSON.stringify({ chatCu: tinNhan })}\n\n`);
  res.write(`data: ${JSON.stringify({ hoaDangCu: hoaDang })}\n\n`);
  req.on('close', () => { if (q.res === res) { q.res = null; q.roi = Date.now(); doi = true; } });
}
const dangOnline = () => [...nguoi.values()].filter(q => q.res);
const banTin = () => { capNhatNgay(); return JSON.stringify({ homNay: denHomNay.size, ds: dangOnline().map(({ id, n, g, x, z, r, p, ao, phu, dh }) => ({ id, n, g, x, z, r, p, ao, phu, dh, h: bang[chuanTen(n)]?.d || 0 })) }); };

/* ----- Bảng hạng: giữ điểm cao nhất của mỗi Pháp danh ----- */
const bangXep = () => Object.values(bang).sort((a, b) => b.d - a.d);
const MOC = [850, 700, 500, 300];
let henGhi = null;
function ghiBang() { clearTimeout(henGhi); henGhi = setTimeout(() => fs.writeFile(FILE_BANG, JSON.stringify(bang), () => {}), 500); }
function nopDiem(res, b) {
  const q = nguoi.get(b.id);
  if (!q) return json(res, 410, { loi: 'Phiên đã hết' });
  const d = Math.round(so(b.d, 0, 1000, -1));
  if (d < 0) return json(res, 400, { loi: 'Điểm không hợp lệ' });
  const bayGio = Date.now();
  if (bayGio - q.thi < GIAN_CACH_THI_MS) return json(res, 429, { loi: 'Lượt thi quá nhanh' });
  q.thi = bayGio;
  const k = chuanTen(q.n), cu = bang[k]?.d ?? -1;
  if (d > cu) {
    bang[k] = { n: q.n, d }; ghiBang(); doi = true;
    if (MOC.some(m => d >= m && cu < m)) { const m = `data: ${JSON.stringify({ lenHang: { n: q.n, d } })}\n\n`; for (const p of dangOnline()) p.res.write(m); }
  }
  const ds = bangXep();
  json(res, 200, { viTri: ds.findIndex(x => chuanTen(x.n) === k) + 1, tong: ds.length, cao: Math.max(d, cu) });
}

/* ----- Bảng trí tuệ: điểm đố vui cao nhất của mỗi Pháp danh ----- */
let bangTT = {};
try { bangTT = JSON.parse(fs.readFileSync(FILE_TT, 'utf8')); } catch { bangTT = {}; }
let henGhiTT = null;
function ghiTT() { clearTimeout(henGhiTT); henGhiTT = setTimeout(() => fs.writeFile(FILE_TT, JSON.stringify(bangTT), () => {}), 500); }
function nopTT(res, b) {
  const q = nguoi.get(b.id);
  if (!q) return json(res, 410, { loi: 'Phiên đã hết' });
  const d = Math.round(so(b.d, 0, 150, -1));
  if (d < 0) return json(res, 400, { loi: 'Điểm không hợp lệ' });
  const bayGio = Date.now();
  if (bayGio - (q.ttLuc || 0) < 15000) return json(res, 429, { loi: 'Lượt chơi quá nhanh' });
  q.ttLuc = bayGio;
  const k = chuanTen(q.n);
  if (d > (bangTT[k]?.d ?? -1)) { bangTT[k] = { n: q.n, d }; ghiTT(); }
  json(res, 200, {});
}

/* ----- Trò chuyện: chỉ giữ 50 tin gần nhất trong bộ nhớ, tắt máy chủ là mất ----- */
const tinNhan = [];
function nopChat(res, b) {
  const q = nguoi.get(b.id);
  if (!q) return json(res, 410, { loi: 'Phiên đã hết' });
  const bayGio = Date.now();
  if (bayGio - (q.chat || 0) < 1000) return json(res, 429, { loi: 'Bạn gửi chậm lại một chút nhé.' });
  const t = String(b.t || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().replace(/\s+/g, ' ').slice(0, 200);
  if (!t) return json(res, 400, { loi: 'Tin nhắn đang trống.' });
  q.chat = bayGio;
  const m = { n: q.n, t, ts: bayGio };
  tinNhan.push(m); if (tinNhan.length > 50) tinNhan.shift();
  const goi = `data: ${JSON.stringify({ chatMoi: m })}\n\n`;
  for (const p of dangOnline()) p.res.write(goi);
  json(res, 200, {});
}

/* ----- Hoa đăng công khai: lời nhắn kèm Pháp danh, giữ 40 đèn gần nhất ----- */
let hoaDang = [];
try { hoaDang = JSON.parse(fs.readFileSync(FILE_DEN, 'utf8')); } catch { hoaDang = []; }
let henGhiDen = null;
function themDen(n, t, ts) {
  t = String(t || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().replace(/\s+/g, ' ').slice(0, 120);
  if (!t || hoaDang.some(m => m.n === n && m.t === t)) return null;
  const m = { n, t, ts };
  hoaDang.push(m); if (hoaDang.length > 40) hoaDang.shift();
  clearTimeout(henGhiDen); henGhiDen = setTimeout(() => fs.writeFile(FILE_DEN, JSON.stringify(hoaDang), () => {}), 500);
  return m;
}
function nopDen(res, b) {
  const q = nguoi.get(b.id);
  if (!q) return json(res, 410, { loi: 'Phiên đã hết' });
  const bayGio = Date.now();
  if (bayGio - (q.den || 0) < 3000) return json(res, 429, { loi: 'Bạn thả chậm lại một chút nhé.' });
  q.den = bayGio;
  const m = themDen(q.n, b.t, bayGio);
  if (m) { const goi = `data: ${JSON.stringify({ hoaDangMoi: m })}\n\n`; for (const p of dangOnline()) p.res.write(goi); }
  json(res, 200, {});
}

// Phát trạng thái 5 lần mỗi giây khi có thay đổi, giữ kết nối sống mỗi 15 giây
setInterval(() => { if (!doi) return; doi = false; const m = `data: ${banTin()}\n\n`; for (const q of dangOnline()) q.res.write(m); }, 200);
setInterval(() => { for (const q of dangOnline()) q.res.write(': giu\n\n'); }, 15000);
setInterval(() => { const t = Date.now(); for (const q of nguoi.values()) if (!q.res && t - q.roi > GIU_TEN_MS) nguoi.delete(q.id); }, 5000);

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'POST' && url.pathname === '/api/vao') return vao(res, await docBody(req));
    if (req.method === 'POST' && url.pathname === '/api/vi-tri') return viTri(res, await docBody(req));
    if (req.method === 'POST' && url.pathname === '/api/diem') return nopDiem(res, await docBody(req));
    if (req.method === 'POST' && url.pathname === '/api/chat') return nopChat(res, await docBody(req));
    if (req.method === 'POST' && url.pathname === '/api/tri-tue') return nopTT(res, await docBody(req));
    if (req.method === 'GET' && url.pathname === '/api/bang-tt') return json(res, 200, { ds: Object.values(bangTT).sort((a, c) => c.d - a.d).slice(0, 20) });
    if (req.method === 'POST' && url.pathname === '/api/hoa-dang') return nopDen(res, await docBody(req));
    if (req.method === 'GET' && url.pathname === '/healthz') return json(res, 200, { ok: true });
    if (req.method === 'GET' && url.pathname === '/api/cau-hinh') return json(res, 200, { canMa: !!MA_VAO });
    if (req.method === 'GET' && url.pathname === '/api/bang') return json(res, 200, { ds: bangXep().slice(0, 30) });
    if (req.method === 'GET' && url.pathname === '/api/su-kien') return suKien(req, res, url.searchParams.get('id') || '');
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return fs.readFile(TRANG, (e, d) => {
        if (e) { res.writeHead(500); return res.end('Thiếu file index.html bên cạnh server.js'); }
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' }); res.end(d);
      });
    }
    res.writeHead(404); res.end();
  } catch { if (!res.headersSent) json(res, 400, { loi: 'Yêu cầu không hợp lệ' }); }
}).listen(CONG, '0.0.0.0', () => {
  console.log('Chùa Đắc Hội Thiền Âm đã mở cổng. Gửi đồng nghiệp một trong các địa chỉ sau:');
  for (const ds of Object.values(os.networkInterfaces())) for (const a of ds) if (a.family === 'IPv4' && !a.internal) console.log(`  http://${a.address}:${CONG}`);
  console.log(`Trên chính máy này: http://localhost:${CONG}\nĐóng cửa sổ này là tắt máy chủ.`);
});
