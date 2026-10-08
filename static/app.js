const supported = new Set(['txt','md','csv','tsv','json','xml','html','htm','yaml','yml','log','py','js','ts','css','sql','pdf','docx','xlsx','png','jpg','jpeg','webp','bmp','gif','tif','tiff']);
const labels = {completed:'ตรงกันทั้งหมด',different:'พบความแตกต่าง',matched_ocr:'ตรงกันตาม OCR',inconclusive:'ยังสรุปไม่ได้',error:'เกิดข้อผิดพลาด'};
const $ = id => document.getElementById(id);
let mode = 'manual';
let pairs = [];
let nextId = 1;
let folderPairs = [];
let unmatched = {left:0,right:0,unsupported:0};

function fileSupported(file) {
  return supported.has((file.name.split('.').pop() || '').toLowerCase());
}

function createPair() {
  pairs.push({id:nextId++,left:null,right:null});
  renderPairs();
}

function filePicker(pair, side) {
  const box = document.createElement('label');
  box.className = 'file-box';
  const label = document.createElement('span');
  label.className = 'file-label';
  label.textContent = side === 'left' ? 'ไฟล์ต้นฉบับ' : 'ไฟล์ที่ต้องการเทียบ';
  const name = document.createElement('span');
  name.className = 'file-name';
  name.textContent = pair[side]?.name || 'คลิกเพื่อเลือกไฟล์';
  const input = document.createElement('input');
  input.type = 'file';
  input.setAttribute('aria-label', label.textContent);
  input.addEventListener('change', () => {
    pair[side] = input.files[0] || null;
    name.textContent = pair[side]?.name || 'คลิกเพื่อเลือกไฟล์';
  });
  box.append(label,name,input);
  return box;
}

function renderPairs() {
  const list = $('pair-list');
  list.replaceChildren();
  pairs.forEach((pair,index) => {
    const row = document.createElement('div');
    row.className = 'pair-row';
    const number = document.createElement('span');
    number.className = 'pair-number';
    number.textContent = String(index+1).padStart(2,'0');
    const arrow = document.createElement('span');
    arrow.className = 'pair-arrow';
    arrow.textContent = '↔';
    const remove = document.createElement('button');
    remove.className = 'remove-pair';
    remove.type = 'button';
    remove.title = 'ลบคู่นี้';
    remove.setAttribute('aria-label',`ลบคู่ที่ ${index+1}`);
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      pairs = pairs.filter(item => item.id !== pair.id);
      if (!pairs.length) createPair(); else renderPairs();
    });
    row.append(number,filePicker(pair,'left'),arrow,filePicker(pair,'right'),remove);
    list.append(row);
  });
}

function setMode(value) {
  mode = value;
  $('manual-panel').classList.toggle('hidden',value !== 'manual');
  $('folder-panel').classList.toggle('hidden',value !== 'folder');
  for (const tab of ['manual','folder']) {
    $(`${tab}-tab`).classList.toggle('active',tab === value);
    $(`${tab}-tab`).setAttribute('aria-selected',String(tab === value));
  }
}

function relativeName(file) {
  const parts = (file.webkitRelativePath || file.name).split('/');
  return parts.length > 1 ? parts.slice(1).join('/') : file.name;
}

function updateFolderPairs() {
  const leftFiles = Array.from($('left-folder').files || []);
  const rightFiles = Array.from($('right-folder').files || []);
  $('left-folder-name').textContent = leftFiles.length ? `${leftFiles[0].webkitRelativePath.split('/')[0]} · ${leftFiles.length} ไฟล์` : 'คลิกเพื่อเลือกโฟลเดอร์';
  $('right-folder-name').textContent = rightFiles.length ? `${rightFiles[0].webkitRelativePath.split('/')[0]} · ${rightFiles.length} ไฟล์` : 'คลิกเพื่อเลือกโฟลเดอร์';
  folderPairs = [];
  unmatched = {left:0,right:0,unsupported:0};
  if (!leftFiles.length || !rightFiles.length) {
    $('folder-summary').textContent = 'เลือกทั้งสองโฟลเดอร์เพื่อดูรายการที่จับคู่ได้';
    return;
  }
  const leftMap = new Map(leftFiles.map(file => [relativeName(file),file]));
  const rightMap = new Map(rightFiles.map(file => [relativeName(file),file]));
  for (const [path,left] of leftMap) {
    const right = rightMap.get(path);
    if (!right) { unmatched.left++; continue; }
    if (!fileSupported(left) || !fileSupported(right)) { unmatched.unsupported++; continue; }
    folderPairs.push({left,right,name:path});
  }
  unmatched.right = Array.from(rightMap.keys()).filter(path => !leftMap.has(path)).length;
  $('folder-summary').textContent = `จับคู่ได้ ${folderPairs.length} คู่ · มีเฉพาะฝั่งต้นฉบับ ${unmatched.left} · มีเฉพาะฝั่งเทียบ ${unmatched.right} · ชนิดไฟล์ที่ไม่รองรับ ${unmatched.unsupported}`;
}

function element(tag,className,text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function makeSummary(results) {
  const counts = {completed:0,different:0,matched_ocr:0,inconclusive:0,error:0};
  results.forEach(entry => counts[entry.result.status]++);
  const container = $('summary-cards');
  container.replaceChildren();
  for (const [value,label,style] of [
    [results.length,'ทั้งหมด',''],[counts.completed,'ตรงกันทั้งหมด','good'],
    [counts.different,'พบความแตกต่าง','bad'],[counts.matched_ocr+counts.inconclusive+counts.error,'ต้องตรวจเพิ่ม','warn']
  ]) {
    const card = element('div',`summary-card ${style}`);
    card.append(element('strong','',String(value)),element('span','',label));
    container.append(card);
  }
  $('result-count').textContent = `${results.length} PAIRS ANALYZED`;
}

function detailParagraph(container,text,className='') {
  container.append(element('p',className,text));
}

function renderResult(item,index) {
  const result = item.result;
  const card = element('article','result-card');
  const top = element('div','result-top');
  const heading = element('div','');
  heading.append(element('div','result-name',`คู่ ${String(index+1).padStart(2,'0')} · ${item.name || item.left.name}`),
                 element('div','result-path',`${item.left.name}  ↔  ${item.right.name}`));
  top.append(heading,element('span',`badge ${result.status}`,labels[result.status]));
  card.append(top);
  const detail = element('div','result-detail');
  if (result.status === 'error') {
    detailParagraph(detail,result.message,'error-message');
  } else {
    if (result.status === 'completed') detailParagraph(detail,'ข้อมูลที่ตรวจเปรียบเทียบตรงกันทั้งหมด');
    if (result.status === 'matched_ocr') detailParagraph(detail,'ข้อความที่ OCR อ่านจากรูปตรงกับเอกสารทุกตัวอักษรที่อ่านได้ แต่ OCR อาจอ่านผิดหรือข้ามข้อความ');
    if (result.status === 'inconclusive') detailParagraph(detail,'ไม่พบข้อความที่อ่านได้เพียงพอสำหรับยืนยันความตรงกัน อาจเป็นเอกสารสแกนหรือรูปที่ OCR อ่านไม่ได้');
    if (result.visual) {
      const v = result.visual;
      detailParagraph(detail,`ภาพ: ${v.left_size.join(' × ')} ↔ ${v.right_size.join(' × ')} พิกเซล · ${v.same ? 'พิกเซลตรงกันทั้งหมด' : v.changed_pixels === null ? 'ขนาดภาพต่างกัน' : `${v.changed_pixels.toLocaleString()} พิกเซลต่างกัน`}`);
    }
    if (result.text) {
      const t = result.text;
      detailParagraph(detail,`ข้อความที่อ่านได้: ${t.left_characters.toLocaleString()} ↔ ${t.right_characters.toLocaleString()} ตัวอักษร · ${t.same ? 'ตรงกัน' : 'ต่างกัน'}`);
      if (!t.same) {
        detail.append(element('div','changes-title','ตำแหน่งที่พบความต่าง'));
        t.changes.forEach(change => {
          const row = element('div','change');
          row.append(element('div','change-position',`ต้นฉบับ บรรทัด ${change.left_at.line} คอลัมน์ ${change.left_at.column} · ฝั่งเทียบ บรรทัด ${change.right_at.line} คอลัมน์ ${change.right_at.column}`));
          const columns = element('div','change-columns');
          for (const [label,value,truncated] of [['ต้นฉบับ',change.left,change.left_truncated],['ฝั่งเทียบ',change.right,change.right_truncated]]) {
            const side = element('div','change-side');
            side.append(element('label','',label),element('pre','',value ? `${value}${truncated ? '…' : ''}` : '∅ ไม่มีข้อความ'));
            columns.append(side);
          }
          row.append(columns);
          detail.append(row);
        });
        if (t.preview_limited) detailParagraph(detail,'แสดงตัวอย่างความต่างบางส่วน แต่ตรวจความตรงกันจากข้อความทั้งหมดแล้ว');
      }
    } else if (result.visual && !result.visual.same) {
      detailParagraph(detail,'ตรวจความต่างของภาพจากพิกเซลแล้ว ข้อความในภาพอาจอ่านไม่ครบด้วย OCR');
    }
    if ((result.left_kind === 'image' || result.right_kind === 'image') && !result.ocr_available) {
      detailParagraph(detail,'OCR ไม่พร้อมใช้งาน จึงไม่มีผลเทียบข้อความในรูป');
    }
  }
  card.append(detail);
  return card;
}

async function compareOne(item) {
  if (!fileSupported(item.left) || !fileSupported(item.right)) return {...item,result:{status:'error',message:'ชนิดไฟล์ไม่รองรับ'}};
  if (item.left.size > 20*1024*1024 || item.right.size > 20*1024*1024) return {...item,result:{status:'error',message:'ไฟล์ใหญ่เกิน 20 MB'}};
  const form = new FormData();
  form.append('left',item.left);
  form.append('right',item.right);
  try {
    const response = await fetch('/api/compare',{method:'POST',body:form});
    const body = await response.json();
    if (!response.ok) throw new Error(body.detail || `HTTP ${response.status}`);
    return {...item,result:body};
  } catch (error) {
    return {...item,result:{status:'error',message:error.message || 'เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ'}};
  }
}

async function compareAll() {
  const items = mode === 'manual' ? pairs.filter(pair => pair.left && pair.right) : folderPairs;
  if (!items.length) {
    alert(mode === 'manual' ? 'กรุณาเลือกไฟล์ทั้งสองฝั่งอย่างน้อยหนึ่งคู่' : 'ไม่พบไฟล์ชื่อเดียวกันในสองโฟลเดอร์');
    return;
  }
  const button = $('compare-button');
  button.disabled = true;
  button.firstChild.textContent = 'กำลังเปรียบเทียบ... ';
  $('results-section').classList.remove('hidden');
  $('results-list').replaceChildren();
  const results = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await compareOne(items[index]);
      makeSummary(results.filter(Boolean));
      $('results-list').replaceChildren(...results.map((entry,i) => entry ? renderResult(entry,i) : null).filter(Boolean));
    }
  };
  await Promise.all(Array.from({length:Math.min(3,items.length)},worker));
  button.disabled = false;
  button.firstChild.textContent = 'เริ่มเปรียบเทียบ ';
  $('results-section').scrollIntoView({behavior:'smooth',block:'start'});
}

$('manual-tab').addEventListener('click',()=>setMode('manual'));
$('folder-tab').addEventListener('click',()=>setMode('folder'));
$('add-pair').addEventListener('click',createPair);
$('left-folder').addEventListener('change',updateFolderPairs);
$('right-folder').addEventListener('change',updateFolderPairs);
$('compare-button').addEventListener('click',compareAll);
createPair();
