const supported = new Set(['txt','md','csv','tsv','json','xml','html','htm','yaml','yml','log','py','js','ts','css','sql','pdf','docx','xlsx','xlsm','xls','xlsb','png','jpg','jpeg','webp','avif','bmp','gif','tif','tiff']);
const labels = {completed:'ตรงกันทั้งหมด',different:'พบความแตกต่าง',matched_ocr:'ตรงกันตาม OCR',inconclusive:'ยังสรุปไม่ได้',error:'เกิดข้อผิดพลาด'};
const $ = id => document.getElementById(id);
let mode = 'manual';
let pairs = [];
let nextId = 1;
let folderPairs = [];
let folderRightChoices = [];
let folderCounts = {left:0,right:0,unsupported:0};
const folderSelections = {left:[],right:[]};
const folderSources = {left:'',right:''};
let unmatched = {left:0,right:0,unsupported:0};

function fileSupported(file) {
  return supported.has((file.name.split('.').pop() || '').toLowerCase());
}

function createPair() {
  pairs.push({id:nextId++,left:null,right:null});
  renderPairs();
}

function enableDropZone(zone,onFiles) {
  zone.addEventListener('dragover',event => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    zone.classList.add('drag-active');
  });
  zone.addEventListener('dragleave',event => {
    if (!zone.contains(event.relatedTarget)) zone.classList.remove('drag-active');
  });
  zone.addEventListener('drop',event => {
    event.preventDefault();
    zone.classList.remove('drag-active');
    const files = Array.from(event.dataTransfer.files || []);
    if (files.length) onFiles(files);
  });
}

function filePicker(pair, side) {
  const box = document.createElement('div');
  box.className = 'file-box';
  const label = document.createElement('span');
  label.className = 'file-label';
  label.textContent = side === 'left' ? 'ไฟล์ต้นฉบับ' : 'ไฟล์ที่ต้องการเทียบ';
  const name = document.createElement('span');
  name.className = 'file-name';
  name.textContent = pair[side]?.name || 'ยังไม่ได้เลือกไฟล์';
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = [...supported].map(extension => `.${extension}`).join(',');
  input.setAttribute('aria-label', label.textContent);
  input.addEventListener('change', () => {
    pair[side] = input.files[0] || null;
    name.textContent = pair[side]?.name || 'ยังไม่ได้เลือกไฟล์';
  });
  const hint = document.createElement('span');
  hint.className = 'drop-hint';
  hint.textContent = 'หรือลากไฟล์จาก Finder มาวางที่นี่';
  box.append(label,name,input,hint);
  enableDropZone(box,files => {
    if (files.length !== 1) {
      alert('ช่องนี้รับไฟล์เดียว กรุณาวางหนึ่งไฟล์ต่อหนึ่งฝั่ง');
      return;
    }
    pair[side] = files[0];
    name.textContent = files[0].name;
    input.value = '';
  });
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
  $('local-panel').classList.toggle('hidden',value !== 'local');
  for (const tab of ['manual','folder','local']) {
    $(`${tab}-tab`).classList.toggle('active',tab === value);
    $(`${tab}-tab`).setAttribute('aria-selected',String(tab === value));
  }
}

function relativeName(file) {
  const parts = (file.webkitRelativePath || file.name).split('/');
  return parts.length > 1 ? parts.slice(1).join('/') : file.name;
}

const folderCollator = new Intl.Collator(undefined,{numeric:true,sensitivity:'base'});
function byRelativeName(a,b) {
  return folderCollator.compare(relativeName(a),relativeName(b));
}

function renderFolderPreview() {
  const preview = $('folder-pair-preview');
  preview.replaceChildren();
  const usedRights = new Set(folderPairs.map(pair => pair.right));
  const exact = folderPairs.filter(pair => pair.match === 'name').length;
  const order = folderPairs.filter(pair => pair.match === 'order').length;
  const manual = folderPairs.filter(pair => pair.match === 'manual').length;
  unmatched = {left:folderCounts.left-folderPairs.length,right:folderCounts.right-usedRights.size,unsupported:folderCounts.unsupported};
  $('folder-summary').textContent = `จับคู่ได้ ${folderPairs.length} คู่ · ชื่อตรง ${exact} · ตามลำดับ ${order} · ปรับเอง ${manual} · ยังไม่จับคู่ ${unmatched.left} / ${unmatched.right} · ชนิดไฟล์ที่ไม่รองรับ ${unmatched.unsupported}`;
  if (!folderPairs.length) return;
  const heading = element('h3','folder-preview-heading','ตรวจคู่ไฟล์ก่อนเปรียบเทียบ');
  preview.append(heading);
  folderPairs.forEach((pair,index) => {
    const row = element('div','folder-preview-row');
    const left = element('div','folder-preview-name',`${index+1}. ${relativeName(pair.left)}`);
    const arrow = element('span','folder-preview-arrow','↔');
    const select = element('select','folder-preview-select');
    select.setAttribute('aria-label',`ไฟล์ฝั่งเทียบของคู่ ${index+1}`);
    folderRightChoices.forEach((file,fileIndex) => {
      const option = element('option','',relativeName(file));
      option.value = String(fileIndex);
      select.append(option);
    });
    select.value = String(folderRightChoices.indexOf(pair.right));
    select.addEventListener('change', () => {
      const selected = folderRightChoices[Number(select.value)];
      const other = folderPairs.find(candidate => candidate !== pair && candidate.right === selected);
      if (other) {other.right = pair.right; other.match = 'manual';}
      pair.right = selected;
      pair.match = 'manual';
      renderFolderPreview();
    });
    const method = element('small','folder-preview-method',pair.match === 'name' ? 'ชื่อตรง' : pair.match === 'order' ? 'ตามลำดับ' : 'ปรับเอง');
    row.append(left,arrow,select,method);
    preview.append(row);
  });
}

function updateFolderPairs() {
  const leftFiles = folderSelections.left;
  const rightFiles = folderSelections.right;
  for (const [side,files] of [['left',leftFiles],['right',rightFiles]]) {
    const source = folderSources[side];
    const folderName = files[0]?.webkitRelativePath?.split('/')[0];
    $(`${side}-folder-name`).textContent = files.length
      ? `${source === 'folder' ? folderName || 'โฟลเดอร์' : 'ไฟล์ที่เลือก'} · ${files.length} ไฟล์`
      : 'ยังไม่ได้เลือก';
  }
  folderPairs = [];
  unmatched = {left:0,right:0,unsupported:0};
  $('folder-pair-preview').replaceChildren();
  if (!leftFiles.length || !rightFiles.length) {
    $('folder-summary').textContent = 'เลือกข้อมูลทั้งสองฝั่งเพื่อดูรายการที่จับคู่ได้ · ปุ่ม “เลือกโฟลเดอร์” ต้องเลือกโฟลเดอร์ ไม่สามารถเลือกไฟล์เดี่ยวได้';
    return;
  }
  const validLeft = leftFiles.filter(fileSupported).sort(byRelativeName);
  folderRightChoices = rightFiles.filter(fileSupported).sort(byRelativeName);
  folderCounts = {left:validLeft.length,right:folderRightChoices.length,
    unsupported:leftFiles.length+rightFiles.length-validLeft.length-folderRightChoices.length};
  const method = $('folder-match-mode').value;
  const remainingRight = [...folderRightChoices];
  const remainingLeft = [];
  for (const left of validLeft) {
    const index = method === 'order' ? -1 : remainingRight.findIndex(right => relativeName(right) === relativeName(left));
    if (index < 0) remainingLeft.push(left);
    else folderPairs.push({left,right:remainingRight.splice(index,1)[0],name:relativeName(left),match:'name'});
  }
  if (method !== 'name') {
    for (let index=0; index<Math.min(remainingLeft.length,remainingRight.length); index++) {
      const left = remainingLeft[index];
      folderPairs.push({left,right:remainingRight[index],name:relativeName(left),match:'order'});
    }
  }
  folderPairs.sort((a,b)=>byRelativeName(a.left,b.left));
  renderFolderPreview();
}

function selectFolderFiles(side,source,input) {
  const files = Array.from(input.files || []);
  if (!files.length) return;
  folderSelections[side] = files;
  folderSources[side] = source;
  const other = source === 'folder' ? 'files' : 'folder';
  $(`${side}-${other}`).value = '';
  updateFolderPairs();
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

async function downloadReport(item,button) {
  button.disabled = true;
  button.textContent = 'กำลังสร้างรายงาน...';
  try {
    let response;
    if (item.local) {
      response = await fetch('/api/local/report',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({left_path:item.left_path,right_path:item.right_path})
      });
    } else {
      const form = new FormData();
      form.append('left',item.left);
      form.append('right',item.right);
      response = await fetch('/api/compare/report',{method:'POST',body:form});
    }
    if (!response.ok) {
      const body = await response.json();
      throw new Error(body.detail || `HTTP ${response.status}`);
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = `comparison-${(item.name || item.left.name).replace(/[^\w.-]+/g,'_')}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
  } catch (error) {
    alert(error.message || 'ดาวน์โหลดรายงานไม่สำเร็จ');
  } finally {
    button.disabled = false;
    button.textContent = 'ดาวน์โหลดรายงานความต่างทั้งหมด (.csv)';
  }
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
    if (result.status === 'matched_ocr') detailParagraph(detail,'ข้อความที่ OCR อ่านจากรูปหรือ PDF สแกนตรงกันตามที่อ่านได้ แต่ OCR อาจอ่านผิดหรือข้ามข้อความ');
    if (result.status === 'inconclusive') detailParagraph(detail,'ไม่พบข้อความที่อ่านได้เพียงพอสำหรับยืนยันความตรงกัน อาจเป็นเอกสารสแกนหรือรูปที่ OCR อ่านไม่ได้');
    if (result.ocr_used && result.status === 'different') detailParagraph(detail,'มีการอ่านรูปหรือ PDF สแกนด้วย OCR โปรดตรวจข้อมูลที่ต่างกับไฟล์ต้นฉบับอีกครั้ง');
    if (result.visual) {
      const v = result.visual;
      detailParagraph(detail,`ภาพ: ${v.left_size.join(' × ')} ↔ ${v.right_size.join(' × ')} พิกเซล · ${v.same ? 'พิกเซลตรงกันทั้งหมด' : v.changed_pixels === null ? 'ขนาดภาพต่างกัน' : `${v.changed_pixels.toLocaleString()} พิกเซลต่างกัน`}`);
      if (v.bounds) detailParagraph(detail,`กรอบบริเวณพิกเซลที่ต่าง: ซ้าย ${v.bounds[0]}, บน ${v.bounds[1]}, ขวา ${v.bounds[2]}, ล่าง ${v.bounds[3]}`);
    }
    if (result.pdf_visual) {
      const pdf = result.pdf_visual;
      detailParagraph(detail,`PDF: ${pdf.left_pages} ↔ ${pdf.right_pages} หน้า · ตรวจภาพหน้าสแกน ${pdf.checked_pages.length} หน้า`);
      pdf.changes.forEach(change => detailParagraph(detail,`หน้าที่ ${change.page}: ${change.changed_pixels === null ? 'ขนาดหน้าต่างกัน' : `${change.changed_pixels.toLocaleString()} พิกเซลต่างกัน`}${change.bounds ? ` · กรอบต่าง x=${change.bounds[0]}–${change.bounds[2]}, y=${change.bounds[1]}–${change.bounds[3]}` : ''}`));
    }
    if (result.spreadsheet) {
      const sheet = result.spreadsheet;
      detailParagraph(detail,`ตรวจเซลล์ที่มีข้อมูล: ${sheet.left_cells.toLocaleString()} ↔ ${sheet.right_cells.toLocaleString()} · พบเซลล์ต่างกัน ${sheet.total_changes.toLocaleString()} ตำแหน่ง`,'spreadsheet-summary');
      sheet.sheet_changes.forEach(change => detailParagraph(detail,`ชีต “${change.sheet}” มีเฉพาะ${change.side === 'left' ? 'ฝั่งต้นฉบับ' : 'ฝั่งเทียบ'}`,'sheet-diff'));
      if (sheet.changes.length) {
        const list = element('div','cell-list');
        let shown = 0;
        const showMore = () => {
          sheet.changes.slice(shown,shown+50).forEach(change => {
            const cell = element('div','cell-change');
            cell.append(element('div','cell-location',`${change.sheet} · ${change.cell} · ${change.type === 'added' ? 'เพิ่ม' : change.type === 'removed' ? 'ลบ' : 'แก้ไข'}`));
            const columns = element('div','cell-values');
            for (const [label,value] of [['ต้นฉบับ',change.left],['ฝั่งเทียบ',change.right]]) {
              const side = element('div','');
              side.append(element('label','',label),element('pre','',value || '∅ ไม่มีข้อมูล'));
              columns.append(side);
            }
            cell.append(columns);
            list.append(cell);
          });
          shown = Math.min(shown+50,sheet.changes.length);
          more.classList.toggle('hidden',shown >= sheet.changes.length);
        };
        const more = element('button','report-button','แสดงอีก 50 ตำแหน่ง');
        more.type = 'button';
        more.addEventListener('click',showMore);
        detail.append(list,more);
        showMore();
        if (sheet.preview_limited) detailParagraph(detail,'หน้าเว็บแสดง 500 ตำแหน่งแรก ดาวน์โหลด CSV เพื่อดูความต่างทุกเซลล์');
      }
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
    if (result.status === 'different') {
      const actions = element('div','report-actions');
      const report = element('button','report-button','ดาวน์โหลดรายงานความต่างทั้งหมด (.csv)');
      report.type = 'button';
      report.addEventListener('click',()=>downloadReport(item,report));
      actions.append(report);
      detail.append(actions);
    }
  }
  card.append(detail);
  return card;
}

async function compareOne(item) {
  if (item.local) {
    try {
      const response = await fetch('/api/local/compare',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({left_path:item.left_path,right_path:item.right_path})
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail || `HTTP ${response.status}`);
      return {...item,result:body};
    } catch (error) {
      return {...item,result:{status:'error',message:error.message || 'อ่านไฟล์ในโฟลเดอร์ไม่ได้'}};
    }
  }
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
  if (mode === 'manual') {
    const incomplete = pairs.findIndex(pair => Boolean(pair.left) !== Boolean(pair.right));
    if (incomplete !== -1) {
      alert(`คู่ที่ ${incomplete + 1} ยังเลือกไฟล์ไม่ครบทั้งสองฝั่ง`);
      return;
    }
  }
  let items;
  if (mode === 'local') {
    const left_path = $('local-left').value.trim();
    const right_path = $('local-right').value.trim();
    if (!left_path || !right_path) {
      alert('กรุณาใส่ path ของโฟลเดอร์ทั้งสองฝั่ง');
      return;
    }
    try {
      const response = await fetch('/api/local/list',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({left_path,right_path,match_mode:$('local-match-mode').value})
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail || `HTTP ${response.status}`);
      items = body.pairs.map(pair => ({...pair,local:true,left:{name:pair.left_name},right:{name:pair.right_name}}));
      $('local-summary').textContent = `จับคู่ได้ ${items.length} คู่ · ชื่อตรง ${body.exact_pairs} · ตามลำดับ ${body.ordered_pairs} · ยังไม่จับคู่ ${body.left_only} / ${body.right_only} · อ่านไฟล์จากเครื่องโดยตรง`;
    } catch (error) {
      $('local-summary').textContent = error.message || 'อ่านโฟลเดอร์ไม่ได้';
      return;
    }
  } else {
    items = mode === 'manual' ? pairs.filter(pair => pair.left && pair.right) : folderPairs;
  }
  if (!items.length) {
    alert(mode === 'manual' ? 'กรุณาเลือกไฟล์ทั้งสองฝั่งอย่างน้อยหนึ่งคู่' : 'ไม่พบคู่ไฟล์ที่เปรียบเทียบได้ ตรวจชนิดไฟล์และวิธีจับคู่');
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
$('local-tab').addEventListener('click',()=>setMode('local'));
$('add-pair').addEventListener('click',createPair);
$('folder-match-mode').addEventListener('change',updateFolderPairs);
for (const side of ['left','right']) {
  $(`${side}-folder`).addEventListener('change',event => selectFolderFiles(side,'folder',event.target));
  $(`${side}-files`).accept = [...supported].map(extension => `.${extension}`).join(',');
  $(`${side}-files`).addEventListener('change',event => selectFolderFiles(side,'files',event.target));
  const card = $(`${side}-files`).closest('.folder-card');
  enableDropZone(card,files => {
    folderSelections[side] = files;
    folderSources[side] = 'files';
    $(`${side}-folder`).value = '';
    $(`${side}-files`).value = '';
    updateFolderPairs();
  });
}
$('compare-button').addEventListener('click',compareAll);
fetch('/api/capabilities').then(response=>response.json()).then(data=>{
  if (data.local_folder_access) $('local-tab').classList.remove('hidden');
}).catch(()=>{});
createPair();
