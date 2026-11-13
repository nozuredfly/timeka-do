// 昼休憩（取れた分）の計算と、備考への保存。node test/lunch.test.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../index.html'), 'utf8');

function extractFunction(src, name) {
  const re = new RegExp('function\\s+' + name + '\\s*\\(');
  const m = re.exec(src);
  if (!m) throw new Error('関数が見つからない: ' + name);
  let i = src.indexOf('{', m.index);
  let depth = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      i++;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === q) { i++; break; }
        i++;
      }
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      i = src.indexOf('\n', i);
      if (i < 0) break;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    if (c === '/') {
      let k = i - 1;
      while (k >= 0 && /\s/.test(src[k])) k--;
      const prev = k >= 0 ? src[k] : '';
      if ('([ {;=,&!?:|+-*~^%<>'.includes(prev)) {
        i++;
        while (i < n) {
          if (src[i] === '\\') { i += 2; continue; }
          if (src[i] === '[') {
            i++;
            while (i < n && src[i] !== ']') {
              if (src[i] === '\\') i++;
              i++;
            }
            i++;
            continue;
          }
          if (src[i] === '/') { i++; break; }
          i++;
        }
        while (i < n && /[a-z]/i.test(src[i])) i++;
        continue;
      }
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(m.index, i + 1);
    }
    i++;
  }
  throw new Error('関数が閉じていない: ' + name);
}

const names = ['parseT', 'skipBreaks', 'clampLunch', 'stripLunchMark', 'parseLunchNote', 'withLunchMark', 'savedNote', 'lunchFromDraft', 'lunchFromSheet', 'calcDay', 'lunchSelect'];
const choice = html.match(/const LUNCH_CHOICES = \[[0-9, ]+\];/);
if (!choice) throw new Error('LUNCH_CHOICES が見つからない');
const src = "'use strict';\n" + choice[0] + '\n' + names.map(name => extractFunction(html, name)).join('\n\n');
const api = new Function('S', src + '\nreturn { ' + names.join(', ') + ' };')({ cfg: { rate: 1.25, round: '切り捨て' } });
const { calcDay, clampLunch, parseLunchNote, savedNote, lunchFromDraft, lunchFromSheet, lunchSelect } = api;

let failed = 0;
function check(label, got, reg, ot) {
  const ok = got && got.reg === reg && got.ot === ot;
  const line = (ok ? 'OK  ' : 'NG  ') + label + '  定時内' + (got ? got.reg : 'null') + ' 残業' + (got ? got.ot : 'null');
  console.log(ok ? line : line + '  （期待 定時内' + reg + ' 残業' + ot + '）');
  if (!ok) failed++;
}
function checkEq(label, got, exp) {
  const ok = got === exp;
  console.log((ok ? 'OK  ' : 'NG  ') + label + (ok ? '' : '  得=' + JSON.stringify(got) + ' 期待=' + JSON.stringify(exp)));
  if (!ok) failed++;
}

function day(cat, row) {
  return calcDay(row, cat);
}

console.log('--- 指定の分 ---');
check('P 9:00-16:00 昼60', day('パート', { code: 'P', in: '9:00', out: '16:00', lunch: 60 }), 360, 0);
check('P 9:00-16:00 昼30', day('パート', { code: 'P', in: '9:00', out: '16:00', lunch: 30 }), 390, 0);
check('P 9:00-16:00 昼0', day('パート', { code: 'P', in: '9:00', out: '16:00', lunch: 0 }), 420, 0);
check('一般 T 8:00-17:00 昼60', day('一般作業員', { code: 'T', in: '8:00', out: '17:00', lunch: 60 }), 480, 0);
check('一般 T 8:00-17:00 昼30', day('一般作業員', { code: 'T', in: '8:00', out: '17:00', lunch: 30 }), 510, 0);
check('研修生 T 8:00-17:00 昼60', day('研修生', { code: 'T', in: '8:00', out: '17:00', lunch: 60, special: false }), 420, 0);
check('研修生 T 8:00-17:00 昼30', day('研修生', { code: 'T', in: '8:00', out: '17:00', lunch: 30, special: false }), 450, 0);
check('研修生 午前午後なし 昼0', day('研修生', { code: 'T', in: '8:00', out: '17:00', lunch: 0, special: true }), 540, 0);
check('一般 T 8:00-11:00 昼30（昼は引かない）', day('一般作業員', { code: 'T', in: '8:00', out: '11:00', lunch: 30 }), 180, 0);

const leave = [0, 30, 60].map(lunch => day('一般作業員', { code: 'T', in: '8:00', out: '11:00', lunch }));
checkEq('11:00退勤は昼0/30/60が同じ定時内', leave.every(c => c.reg === 180 && c.ot === 0), true);

const noMark = parseLunchNote('田植え / 出勤手書き');
checkEq('印のない保存行の昼', noMark.lunch, 60);
checkEq('印のない保存行は備考をそのまま', noMark.marked, false);
checkEq('印のない保存行の備考', noMark.note, '田植え / 出勤手書き');
check('印なし（lunch欄もなし）は昼60と同じ', day('一般作業員', { code: 'T', in: '8:00', out: '17:00' }), 480, 0);
checkEq('古い下書き（lunchなし・印なし）', lunchFromDraft({ note: 'メモ' }), 60);
checkEq('シート（印なし）', lunchFromSheet({ note: 'メモ', lunch: 10 }).lunch, 60);

console.log('--- 取り切れなかった分は定時内。残業の起点は変えない ---');
check('一般 T 8:00-18:00 昼60', day('一般作業員', { code: 'T', in: '8:00', out: '18:00', lunch: 60 }), 480, 30);
check('一般 T 8:00-18:00 昼30', day('一般作業員', { code: 'T', in: '8:00', out: '18:00', lunch: 30 }), 510, 30);
check('一般 T 8:00-17:15 昼30（17:00-17:15は無給のまま）', day('一般作業員', { code: 'T', in: '8:00', out: '17:15', lunch: 30 }), 510, 0);
check('P 9:00-16:40 昼30（16:00以降の延長）', day('パート', { code: 'P', in: '9:00', out: '16:40', lunch: 30 }), 390, 30);
check('P 9:00-16:40 昼60', day('パート', { code: 'P', in: '9:00', out: '16:40', lunch: 60 }), 360, 30);

console.log('--- 重なりが60分未満なら、その重なりまでしか引かない ---');
check('一般 T 8:00-12:20 昼30', day('一般作業員', { code: 'T', in: '8:00', out: '12:20', lunch: 30 }), 240, 0);
check('一般 T 8:00-12:20 昼10', day('一般作業員', { code: 'T', in: '8:00', out: '12:20', lunch: 10 }), 250, 0);
check('一般 T 8:00-12:20 昼0', day('一般作業員', { code: 'T', in: '8:00', out: '12:20', lunch: 0 }), 260, 0);

console.log('--- 研修生の午前・午後チェックはそのまま。Sは昼を引かない ---');
check('研修生 午前だけなし 昼60', day('研修生', { code: 'T', in: '8:00', out: '17:00', lunch: 60, special: '午前' }), 450, 0);
check('研修生 午前だけなし 昼30', day('研修生', { code: 'T', in: '8:00', out: '17:00', lunch: 30, special: '午前' }), 480, 0);
check('研修生 午後だけなし 昼60', day('研修生', { code: 'T', in: '8:00', out: '17:00', lunch: 60, special: '午後' }), 450, 0);
check('研修生 11:00退勤 昼30（午前は引き、昼は引かない）', day('研修生', { code: 'T', in: '8:00', out: '11:00', lunch: 30, special: false }), 150, 0);
const s60 = day('一般作業員', { code: 'S', in: '6:00', out: '13:00', lunch: 60 });
const s0 = day('一般作業員', { code: 'S', in: '6:00', out: '13:00', lunch: 0 });
check('S 6:00-13:00 昼60', s60, 420, 0);
checkEq('Sは昼0でも同じ', s0 && s60 && s0.reg === s60.reg && s0.ot === s60.ot, true);
check('A 6:00-17:00 昼60', day('一般作業員', { code: 'A', in: '6:00', out: '17:00', lunch: 60 }), 585, 0);
check('A 6:00-17:00 昼30', day('一般作業員', { code: 'A', in: '6:00', out: '17:00', lunch: 30 }), 615, 0);
check('B 6:00-17:00 昼30', day('外注作業員', { code: 'B', in: '6:00', out: '17:00', lunch: 30 }), 615, 0);

console.log('--- 備考の印。列は15のまま ---');
checkEq('60分は印を付けない', savedNote({ note: '田植え', lunch: 60 }), '田植え');
checkEq('60分で印が無ければ備考はそのまま', savedNote({ note: 'A/B', lunch: 60 }), 'A/B');
checkEq('30分は備考の末尾', savedNote({ note: '田植え', lunch: 30 }), '田植え / [昼30]');
checkEq('0分', savedNote({ note: '', lunch: 0 }), '[昼0]');
checkEq('手書きのうしろに印', savedNote({ note: '雨', lunch: 10, inHand: true }), '雨 / 出勤手書き / [昼10]');
const back = parseLunchNote('田植え / [昼30]');
checkEq('読み戻した分', back.lunch, 30);
checkEq('表示する備考から印を外す', back.note, '田植え');
checkEq('60に戻すと印が消える', savedNote({ note: '田植え / [昼30]', lunch: 60 }), '田植え');
checkEq('下書きの lunch:0 を優先', lunchFromDraft({ lunch: 0, note: 'メモ' }), 0);
checkEq('下書きに欄が無く印だけ', lunchFromDraft({ note: '[昼15]' }), 15);
const sheet = lunchFromSheet({ note: '雨 / 出勤手書き / [昼10]', special: '午前' });
checkEq('シートから読んだ分', sheet.lunch, 10);
checkEq('シートの表示備考', sheet.note, '雨 / 出勤手書き');
checkEq('空は60', clampLunch(''), 60);
checkEq('範囲の上限', clampLunch(90), 60);
checkEq('範囲の下限', clampLunch(-3), 0);

const saveAt = html.indexOf('return { date: r.date');
const saveEnd = html.indexOf('};', saveAt);
const keys = [...html.slice(saveAt, saveEnd).matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*:/g)].map(m => m[1]);
const expectKeys = ['date', 'dow', 'code', 'in', 'out', 'start', 'special', 'regHM', 'otHM', 'regH', 'otH', 'base', 'otPay', 'total', 'note'];
checkEq('勤怠明細の列', keys.join(','), expectKeys.join(','));
checkEq('列に lunch は無い', keys.includes('lunch'), false);
const help = '昼休憩は取れた分だけ無給（0分・30分・60分、初期値60分）';
checkEq('説明文に0・30・60と初期値60分が3か所', html.split(help).length - 1, 3);
checkEq('選択肢の定数', choice[0], 'const LUNCH_CHOICES = [0, 30, 60];');
checkEq('午前休憩なしが残っている', html.includes('午前休憩なし'), true);
checkEq('午後休憩なしが残っている', html.includes('午後休憩なし'), true);

checkEq('通常の選択肢は0・30・60', lunchSelect(60), '<option value="0">0分</option><option value="30">30分</option><option value="60" selected>60分</option>');
checkEq('未設定も60が選択', lunchSelect(''), '<option value="0">0分</option><option value="30">30分</option><option value="60" selected>60分</option>');
checkEq('0分を選んだ行', lunchSelect(0), '<option value="0" selected>0分</option><option value="30">30分</option><option value="60">60分</option>');
checkEq('30分を選んだ行', lunchSelect(30), '<option value="0">0分</option><option value="30" selected>30分</option><option value="60">60分</option>');
for (const n of [10, 15, 20, 40, 45, 50]) {
  const vals = [0, n, 30, 60].sort((a, b) => a - b);
  const htmlOpt = vals.map(v => `<option value="${v}"${v === n ? ' selected' : ''}>${v}分</option>`).join('');
  checkEq('保存済みの' + n + '分はその行だけ残す', lunchSelect(n), htmlOpt);
}
check('P 9:00-16:00 昼10（保存した分のまま）', day('パート', { code: 'P', in: '9:00', out: '16:00', lunch: 10 }), 410, 0);
check('一般 T 8:00-17:00 昼15（保存した分のまま）', day('一般作業員', { code: 'T', in: '8:00', out: '17:00', lunch: 15 }), 525, 0);

if (failed) {
  console.log('失敗 ' + failed + ' 件');
  process.exit(1);
}
console.log('すべて一致');
