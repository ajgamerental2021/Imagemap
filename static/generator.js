const gen = id => document.getElementById(id);
const genState = {hits: [], blocks: [
  {type:'heading', text:'รายละเอียด'},
  {type:'field', label:'ชื่อลูกค้า', text:'{{ชื่อลูกค้า}}'},
  {type:'field', label:'เลขที่ใบสั่งซื้อ', text:'{{เลขที่ใบสั่งซื้อ}}'},
  {type:'field', label:'ยอดรวม', text:'{{ยอดรวม}}'}
]};

function genKeywords() {
  return [...new Map(gen('gen-keywords').value.split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(s => [s.toLocaleLowerCase(), s])).values()];
}

function genValues() {
  const result = {};
  const canonical = new Map(genKeywords().map(keyword => [keyword.toLocaleLowerCase(), keyword]));
  for (const keyword of canonical.values()) result[keyword] = [];
  for (const hit of genState.hits) {
    const keyword = canonical.get(hit.keyword.toLocaleLowerCase());
    if (keyword && hit.value) result[keyword].push(hit.value);
  }
  return result;
}

function genSubstitute(input) {
  const values = genValues();
  return String(input).replace(/\{\{\s*([^{}:]+?)\s*(?::(first|last|count))?\s*\}\}/g, (full, key, option) => {
    const entries = Object.entries(values).find(([name]) => name.trim().toLocaleLowerCase() === key.trim().toLocaleLowerCase())?.[1];
    if (!entries) return full;
    if (option === 'count') return String(entries.length);
    if (!entries.length) return full;
    return option === 'first' ? entries[0] : option === 'last' ? entries.at(-1) : entries.join('\n');
  });
}

function genMessage(id, message, error = false) {
  const target = gen(id);
  target.textContent = message;
  target.classList.toggle('error-message', error);
}

function genHitsRender() {
  const root = gen('gen-hits');
  root.replaceChildren();
  for (const keyword of genKeywords()) {
    const group = document.createElement('div');
    group.className = 'keyword-group';
    const heading = document.createElement('h4');
    const hits = genState.hits.filter(hit => hit.keyword.toLocaleLowerCase() === keyword.toLocaleLowerCase());
    heading.textContent = `${keyword} · ${hits.length} ค่า`;
    group.append(heading);
    if (!hits.length) {
      const empty = document.createElement('p');
      empty.textContent = 'ไม่พบข้อมูล';
      group.append(empty);
    }
    for (const hit of hits) {
      const row = document.createElement('div');
      row.className = 'keyword-hit';
      const input = document.createElement('textarea');
      input.value = hit.value;
      input.rows = 2;
      input.setAttribute('aria-label', `${keyword} จาก ${hit.source}`);
      input.addEventListener('input', () => {hit.value = input.value; genPreview();});
      const source = document.createElement('small');
      source.textContent = `${hit.source} · ${hit.location}`;
      row.append(input, source);
      group.append(row);
    }
    root.append(group);
  }
  genPreview();
}

async function genError(response) {
  const data = await response.json().catch(() => ({}));
  throw new Error(data.detail || `HTTP ${response.status}`);
}

async function genExtractOne(item, keywords) {
  let response;
  if (item.path) {
    response = await fetch('/api/local/keywords/extract', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({path:item.path, keywords})});
  } else {
    const form = new FormData();
    form.append('source', item.file);
    form.append('keywords_json', JSON.stringify(keywords));
    response = await fetch('/api/keywords/extract', {method:'POST', body:form});
  }
  if (!response.ok) await genError(response);
  return response.json();
}

async function genExtract() {
  try {
  const keywords = genKeywords();
  if (!keywords.length) return genMessage('gen-source-status', 'กรุณาใส่ keyword อย่างน้อยหนึ่งคำ', true);
  const items = Array.from(gen('gen-sources').files || []).map(file => ({file, name:file.name}));
  const path = gen('gen-source-path').value.trim();
  if (path) {
    const response = await fetch('/api/local/source-list', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({path})});
    if (!response.ok) return genMessage('gen-source-status', (await response.json().catch(() => ({}))).detail || 'อ่านโฟลเดอร์ไม่สำเร็จ', true);
    for (const source of (await response.json()).sources) items.push(source);
  }
  if (!items.length) return genMessage('gen-source-status', 'กรุณาเลือกไฟล์ข้อมูลหรือระบุ path โฟลเดอร์', true);
  gen('gen-extract').disabled = true;
  genState.hits = [];
  genHitsRender();
  let next = 0, done = 0;
  const results = Array(items.length);
  const errors = [];
  genMessage('gen-source-status', `กำลังอ่าน 0 / ${items.length} ไฟล์`);
  async function worker() {
    while (next < items.length) {
      const index = next++;
      try { results[index] = (await genExtractOne(items[index], keywords)).hits; }
      catch (error) { errors.push(`${items[index].name}: ${error.message}`); }
      done++;
      genMessage('gen-source-status', `กำลังอ่าน ${done} / ${items.length} ไฟล์`);
    }
  }
  try {
    await Promise.all(Array.from({length:Math.min(3, items.length)}, worker));
    genState.hits = results.flatMap(hits => hits || []);
    genHitsRender();
    genMessage('gen-source-status', `อ่านแล้ว ${done} ไฟล์ พบ ${genState.hits.length} ค่า${errors.length ? ` · ข้อผิดพลาด ${errors.length} ไฟล์: ${errors.slice(0, 3).join('; ')}` : ''}`, !!errors.length);
  } finally { gen('gen-extract').disabled = false; }
  } catch (error) {genMessage('gen-source-status', error.message, true); gen('gen-extract').disabled = false;}
}

function genBlockRender() {
  const root = gen('gen-blocks');
  root.replaceChildren();
  genState.blocks.forEach((block, index) => {
    const card = document.createElement('div');
    card.className = 'design-block';
    const bar = document.createElement('div');
    bar.className = 'design-block-bar';
    const name = document.createElement('strong');
    name.textContent = {heading:'หัวข้อ', paragraph:'ข้อความ', field:'ช่องข้อมูล', divider:'เส้นคั่น'}[block.type];
    bar.append(name);
    for (const [symbol, offset] of [['↑',-1],['↓',1]]) {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = symbol; button.setAttribute('aria-label', `เลื่อน${symbol} ${name.textContent}`);
      button.disabled = index + offset < 0 || index + offset >= genState.blocks.length;
      button.addEventListener('click', () => {const other = index + offset; [genState.blocks[index],genState.blocks[other]] = [genState.blocks[other],genState.blocks[index]]; genBlockRender();});
      bar.append(button);
    }
    const remove = document.createElement('button');
    remove.type = 'button'; remove.textContent = 'ลบ';
    remove.addEventListener('click', () => {genState.blocks.splice(index,1); genBlockRender();});
    bar.append(remove); card.append(bar);
    if (block.type === 'field') {
      const label = document.createElement('input'); label.value = block.label || ''; label.placeholder = 'ชื่อช่องข้อมูล';
      label.addEventListener('input', () => {block.label = label.value; genPreview();}); card.append(label);
    }
    if (block.type !== 'divider') {
      const input = document.createElement('textarea'); input.rows = block.type === 'paragraph' ? 3 : 2;
      input.value = block.text || ''; input.placeholder = 'ข้อความหรือ {{keyword}}';
      input.addEventListener('input', () => {block.text = input.value; genPreview();}); card.append(input);
    }
    root.append(card);
  });
  genPreview();
}

function genSpec() {
  return {title:gen('gen-title').value, accent:gen('gen-accent').value, font_size:Number(gen('gen-font-size').value), blocks:genState.blocks};
}

function genPreview() {
  const root = gen('gen-preview');
  root.replaceChildren();
  root.style.fontSize = `${Number(gen('gen-font-size').value) || 12}px`;
  const title = document.createElement('h3'); title.textContent = genSubstitute(gen('gen-title').value);
  title.style.color = gen('gen-accent').value; root.append(title);
  for (const block of genState.blocks) {
    if (block.type === 'divider') {root.append(document.createElement('hr')); continue;}
    const node = document.createElement(block.type === 'heading' ? 'h4' : 'p');
    node.textContent = (block.type === 'field' ? `${genSubstitute(block.label)}: ` : '') + genSubstitute(block.text);
    if (block.type === 'heading') node.style.color = gen('gen-accent').value;
    root.append(node);
  }
}

function genDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function genGenerate() {
  const values = genValues();
  const mode = document.querySelector('input[name="template-mode"]:checked').value;
  let response, extension;
  gen('gen-generate').disabled = true;
  genMessage('gen-generate-status', 'กำลังสร้างเอกสาร…');
  try {
    if (mode === 'file') {
      const file = gen('gen-template-file').files[0];
      if (!file) throw new Error('กรุณาเลือกไฟล์ template');
      extension = file.name.split('.').at(-1).toLowerCase();
      const form = new FormData(); form.append('template', file); form.append('values_json', JSON.stringify(values));
      response = await fetch('/api/generate/file', {method:'POST', body:form});
    } else {
      extension = gen('gen-format').value;
      response = await fetch('/api/generate/web', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({template:genSpec(), values, format:extension})});
    }
    if (!response.ok) await genError(response);
    genDownload(await response.blob(), `generated-document.${extension}`);
    genMessage('gen-generate-status', `สร้างไฟล์ ${extension.toUpperCase()} เรียบร้อย`);
  } catch (error) {genMessage('gen-generate-status', error.message, true);}
  finally {gen('gen-generate').disabled = false;}
}

gen('gen-extract').addEventListener('click', genExtract);
gen('gen-generate').addEventListener('click', genGenerate);
gen('gen-keywords').addEventListener('input', genHitsRender);
for (const id of ['gen-title','gen-accent','gen-font-size']) gen(id).addEventListener('input', genPreview);
for (const button of document.querySelectorAll('[data-add-block]')) button.addEventListener('click', () => {
  const type = button.dataset.addBlock;
  genState.blocks.push({type, label:type === 'field' ? 'ชื่อข้อมูล' : '', text:type === 'field' ? '{{keyword}}' : ''});
  genBlockRender();
});
for (const radio of document.querySelectorAll('input[name="template-mode"]')) radio.addEventListener('change', () => {
  gen('gen-web-template').classList.toggle('hidden', radio.checked && radio.value === 'file');
  gen('gen-file-template').classList.toggle('hidden', radio.checked && radio.value === 'web');
});
gen('gen-save-template').addEventListener('click', () => genDownload(new Blob([JSON.stringify(genSpec(), null, 2)], {type:'application/json'}), 'compare-studio-template.json'));
gen('gen-load-template').addEventListener('change', async event => {
  try {
    const spec = JSON.parse(await event.target.files[0].text());
    if (!Array.isArray(spec.blocks)) throw new Error('ไฟล์ template ไม่มี blocks');
    gen('gen-title').value = spec.title || 'เอกสารใหม่';
    gen('gen-accent').value = spec.accent || '#a9f5b4';
    gen('gen-font-size').value = spec.font_size || 12;
    genState.blocks = spec.blocks.filter(block => ['heading','paragraph','field','divider'].includes(block.type)).slice(0,500);
    genBlockRender();
  } catch (error) {genMessage('gen-generate-status', `เปิด template ไม่สำเร็จ: ${error.message}`, true);}
});
fetch('/api/capabilities').then(response => response.json()).then(data => {
  if (data.local_folder_access) gen('gen-local-source').classList.remove('hidden');
  if (data.native_folder_picker) document.querySelectorAll('.path-picker').forEach(button => button.classList.remove('hidden'));
}).catch(() => {});
for (const button of document.querySelectorAll('.path-picker')) button.addEventListener('click', async () => {
  button.disabled = true;
  try {
    const response = await fetch('/api/local/choose-directory', {method:'POST'});
    if (!response.ok) await genError(response);
    gen(button.dataset.pickPath).value = (await response.json()).path;
  } catch (error) {
    genMessage(button.dataset.pickPath === 'gen-source-path' ? 'gen-source-status' : 'local-summary', error.message, true);
  } finally {button.disabled = false;}
});
genBlockRender();
