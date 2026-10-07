// Tela principal do RecrutaZen — dados vindos da planilha do Google Forms via Apps Script
const E = {
  me: null, perguntas: [], campos: {}, status: [], cands: [], hist: [], planilhaUrl: '',
  view: 'candidatos', modo: 'quadro', busca: '',
  ordem: { campo: 'carimbo', desc: true },
  filtros: filtrosPadrao(),
  limite: {}, aberto: null, aba: 'dados', cv: {}, carregando: false, filtrosAbertos: true,
};
const POR_COLUNA = 40;

function filtrosPadrao() {
  return { ocultos: [], areas: [], local: '', idadeMin: '', idadeMax: '', escolaridade: '', civil: '', de: '', ate: '' };
}
function salvaPrefs() {
  try { localStorage.setItem('rz_prefs', JSON.stringify({ modo: E.modo, filtros: E.filtros, filtrosAbertos: E.filtrosAbertos })); } catch { /* sem armazenamento */ }
}
try {
  const p = JSON.parse(localStorage.getItem('rz_prefs') || 'null');
  if (p) { E.modo = p.modo === 'lista' ? 'lista' : 'quadro'; E.filtros = { ...filtrosPadrao(), ...p.filtros };
    if (!Array.isArray(E.filtros.areas)) E.filtros.areas = []; E.filtrosAbertos = p.filtrosAbertos !== false; }
} catch { /* ignora preferências inválidas */ }

const $ = (sel, raiz = document) => raiz.querySelector(sel);
const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];
function icones(raiz = document) { $$('[data-ico]', raiz).forEach((el) => { el.innerHTML = ICONES[el.dataset.ico] || ''; el.style.display = 'inline-flex'; }); }
// "Excluídos" é um status especial: some do quadro e tem uma tela própria
const ehExcluidos = (s) => semAcento(s.nome) === 'excluidos';
const statusExcluidos = () => E.status.find(ehExcluidos);
const statusAtivos = () => E.status.filter((s) => !ehExcluidos(s));
const excluido = (c) => statusExcluidos()?.id === c.status_id;
const statusDe = (id) => E.status.find((s) => s.id === id) || { nome: '—', cor: '#94a3b8', ordem: 99 };
const candDe = (id) => E.cands.find((c) => c.id === id);
const histDe = (id) => E.hist.filter((h) => h.candidato_id === id);
const dataLocal = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// ───────────────────────── Interpretação das respostas ─────────────────────────
function parseNasc(s) {
  const m = String(s).match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
  if (!m) return null;
  let a = Number(m[3]);
  if (a < 100) a += a > 30 ? 1900 : 2000;
  const d = new Date(a, Number(m[2]) - 1, Number(m[1]));
  return isNaN(d) || a < 1920 || d > new Date() ? null : d;
}
function idadeDe(d) {
  const h = new Date();
  let i = h.getFullYear() - d.getFullYear();
  if (h.getMonth() < d.getMonth() || (h.getMonth() === d.getMonth() && h.getDate() < d.getDate())) i--;
  return i;
}
function normEsc(t) {
  const s = semAcento(t);
  if (!s.trim()) return 'Não informado';
  const inc = /incomplet|cursando|trancad|em andamento/.test(s);
  if (/pos[- ]?grad|especializa|mestrado|mba/.test(s)) return 'Pós-graduação';
  if (/superior|graduac|faculdade|bacharel|licenciatura|tecnologo/.test(s)) return inc ? 'Superior incompleto' : 'Superior completo';
  if (/tecnic/.test(s)) return inc ? 'Técnico incompleto' : 'Técnico';
  if (/medio|2.? ?grau|segundo grau/.test(s)) return inc ? 'Médio incompleto' : 'Médio completo';
  if (/fundamental|1.? ?grau|primeiro grau|primario|ginasio/.test(s)) return inc ? 'Fundamental incompleto' : 'Fundamental completo';
  return 'Outro';
}
const ORDEM_ESC = ['Fundamental incompleto', 'Fundamental completo', 'Médio incompleto', 'Médio completo', 'Técnico incompleto', 'Técnico',
  'Superior incompleto', 'Superior completo', 'Pós-graduação', 'Outro', 'Não informado'];
const RE_CIVIL = /solteir|casad|vi[uú]v|divorc|separad|uni[aã]o|amasiad|noiv|convive/i;
function normCivil(t) {
  const s = semAcento(t);
  if (!s.trim()) return 'Não informado';
  if (/solteir/.test(s)) return 'Solteiro(a)';
  if (/casad/.test(s)) return 'Casado(a)';
  if (/uniao|amasiad|convive/.test(s)) return 'União estável';
  if (/viuv/.test(s)) return 'Viúvo(a)';
  if (/divorc|separad/.test(s)) return 'Divorciado(a)';
  return 'Outro';
}
function splitAreas(t) {
  return String(t).replace(/Costura, Bordado e Caseado/gi, 'Costura / Bordado e Caseado')
    .split(/\s*[,;]\s*/).map((x) => x.trim().replace(/[.\s]+$/, '')).filter(Boolean);
}
const capitaliza = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function deriva(c) {
  const R = (k) => (E.campos[k] != null ? String(c.respostas[E.campos[k]] || '').trim() : '');
  let areasTxt = R('areas'), civil = R('estadoCivil');
  // Na primeira versão do formulário, as áreas caíam na coluna "Estado civil"
  if (civil && !RE_CIVIL.test(civil) && !areasTxt) { areasTxt = civil; civil = ''; }
  const nasc = parseNasc(R('nascimento'));
  let idade = nasc ? idadeDe(nasc) : null;
  if (idade === null) { const m = R('idade').match(/\d{1,2}/); idade = m ? Number(m[0]) : null; }
  const tel = R('telefone');
  return {
    ...c, nome: R('nome') || '(sem nome)', telefone: tel, telDig: tel.replace(/\D/g, '').replace(/^0+/, ''),
    local: R('local'), civil: normCivil(civil), civilTxt: civil, nascTxt: R('nascimento'), idade,
    areas: splitAreas(areasTxt), escolaridade: normEsc(R('escolaridade')), escolaridadeTxt: R('escolaridade'),
    cvLink: R('curriculo'), busca: semAcento(c.respostas.join(' ')),
  };
}

// ───────────────────────── Inicialização ─────────────────────────
(async function iniciar() {
  if (!lerToken()) { location.href = 'login.html'; return; }
  try { await carregar(); } catch (err) {
    $('#carregando').innerHTML = `<div class="msg-erro" style="max-width:460px">${esc(err.message)}</div>
      <button class="btn btn-out" onclick="location.reload()">Tentar novamente</button>`;
    return;
  }
  $('#carregando').hidden = true;
  $('#app').hidden = false;
  $('#avatar').textContent = E.me.nome.trim()[0]?.toUpperCase() || '?';
  $('#user-nome').textContent = E.me.nome;
  $('#user-papel').textContent = E.me.admin ? 'Administrador' : 'Recrutador';
  $('#nav-usuarios').hidden = !E.me.admin;
  $('#abrir-planilha').href = E.planilhaUrl;
  const formUrl = window.RZ_CONFIG?.FORM_URL;
  if (formUrl) { $('#copiar-form').hidden = false; $('#copiar-form').addEventListener('click', () => copiar(formUrl)); }
  icones();

  $$('.nav-item').forEach((b) => b.addEventListener('click', () => { location.hash = b.dataset.view; }));
  $('#busca').addEventListener('input', (e) => {
    E.busca = e.target.value;
    E.limite = {};
    if (E.view === 'excluidos') return renderExcluidos();
    if (E.view !== 'candidatos') { location.hash = 'candidatos'; return; }
    renderResultado();
  });
  $('#atualizar').addEventListener('click', () => atualizar(true));
  $('#sair').addEventListener('click', () => { salvaToken(null); location.href = 'login.html'; });
  $('#trocar-senha').addEventListener('click', trocarSenha);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('.dialog-wrap')) fecharCandidato(); });
  // Busca novas respostas a cada 3 minutos enquanto a aba estiver visível
  setInterval(() => { if (document.visibilityState === 'visible' && !$('.dialog-wrap')) atualizar(false); }, 180000);

  window.addEventListener('hashchange', rotear);
  rotear();
})();

async function carregar() {
  const d = await api('dados');
  E.me = d.usuario; E.perguntas = d.perguntas; E.campos = d.campos; E.status = d.status;
  E.hist = d.historico; E.planilhaUrl = d.planilhaUrl;
  E.cands = d.candidatos.map(deriva);
}
async function atualizar(manual) {
  if (E.carregando) return;
  E.carregando = true;
  $('#atualizar').classList.add('girando');
  const antes = E.cands.length;
  try {
    await carregar();
    if (E.view === 'candidatos') renderResultado(); else if (E.view !== 'usuarios') render();
    if (E.aberto && candDe(E.aberto)) renderFicha();
    const novos = E.cands.length - antes;
    if (novos > 0) toast(`${novos} nova${novos > 1 ? 's' : ''} candidatura${novos > 1 ? 's' : ''}`);
    else if (manual) toast('Tudo atualizado');
  } catch (err) { if (manual) toast(err.message, true); }
  E.carregando = false;
  $('#atualizar').classList.remove('girando');
}

function rotear() {
  const v = location.hash.slice(1) || 'candidatos';
  E.view = ['candidatos', 'excluidos', 'status', 'usuarios'].includes(v) && (v !== 'usuarios' || E.me.admin) ? v : 'candidatos';
  $$('.nav-item').forEach((b) => b.classList.toggle('ativo', b.dataset.view === E.view));
  render();
}
function render() {
  ({ candidatos: renderCandidatos, excluidos: renderExcluidos, status: renderStatus, usuarios: renderUsuarios })[E.view]();
  icones($('#page'));
}
async function copiar(texto) {
  try { await navigator.clipboard.writeText(texto); toast('Link copiado!'); } catch { window.prompt('Copie o link:', texto); }
}

// ───────────────────────── Candidatos ─────────────────────────
function opcoesContadas(lista) {
  const cont = new Map();
  lista.forEach((v) => {
    const k = semAcento(v);
    const atual = cont.get(k) || { rotulo: capitaliza(v), n: 0 };
    atual.n++;
    cont.set(k, atual);
  });
  return [...cont.entries()].sort((a, b) => b[1].n - a[1].n);
}

function renderCandidatos() {
  const f = E.filtros;
  const areas = opcoesContadas(E.cands.flatMap((c) => c.areas)).filter(([, v]) => v.n >= 2);
  const escs = ORDEM_ESC.filter((e) => E.cands.some((c) => c.escolaridade === e));
  const civis = [...new Set(E.cands.map((c) => c.civil))].sort();
  $('#page').innerHTML = `
    <div class="page-head">
      <div><h1>Candidatos</h1><p>Respostas do formulário “Trabalhe conosco” — triagem, entrevistas e contratações</p></div>
      <div class="acts">
        <button class="btn btn-out" data-go="status"><span data-ico="tag"></span>Status</button>
      </div>
    </div>
    <div class="cand-layout ${E.filtrosAbertos ? '' : 'fechado'}">
      <aside class="panel filters" ${E.filtrosAbertos ? '' : 'hidden'}>
        <div style="display:flex;align-items:center;gap:4px"><h3 class="panel-title" style="margin:0">Filtros</h3>
          <button class="btn btn-ghost btn-sm" id="limpar" style="margin-left:auto">Limpar</button>
          <button class="icon-btn" id="recolher" title="Recolher filtros"><span data-ico="left"></span></button></div>
        <div class="grp"><span class="grp-label">Status</span><div id="f-status"></div></div>
        <div class="grp"><span class="grp-label">Área pretendida <small>(uma ou mais)</small></span>
          <div class="check-list ${E.verTodasAreas ? '' : 'curta'}">${areas.map(([k, v]) => `
            <label class="st-check"><input type="checkbox" data-area="${esc(k)}" ${f.areas.includes(k) ? 'checked' : ''}>
              <span class="area-txt">${esc(v.rotulo)}</span><span class="cnt">${v.n}</span></label>`).join('')}</div>
          ${areas.length > 6 ? `<button class="btn btn-ghost btn-sm" id="ver-areas" style="align-self:flex-start">${E.verTodasAreas ? 'Mostrar menos' : `Ver todas (${areas.length})`}</button>` : ''}
        </div>
        <label class="grp"><span class="grp-label">Bairro / cidade</span>
          <input class="input" data-f="local" placeholder="Ex.: CIC, Pinhais, Sítio Cercado"></label>
        <div class="grp"><span class="grp-label">Idade</span>
          <div class="row2"><input class="input" data-f="idadeMin" type="number" min="14" max="99" placeholder="De">
          <input class="input" data-f="idadeMax" type="number" min="14" max="99" placeholder="Até"></div></div>
        <label class="grp"><span class="grp-label">Escolaridade</span>
          <select class="select" data-f="escolaridade"><option value="">Todas</option>${escs.map((e) => `<option>${e}</option>`).join('')}</select></label>
        <label class="grp"><span class="grp-label">Estado civil</span>
          <select class="select" data-f="civil"><option value="">Todos</option>${civis.map((e) => `<option>${esc(e)}</option>`).join('')}</select></label>
        <div class="grp"><span class="grp-label">Data de inscrição</span>
          <div class="row2"><input class="input" data-f="de" type="date" title="De"><input class="input" data-f="ate" type="date" title="Até"></div></div>
      </aside>
      <div style="min-width:0">
        <div class="board-bar">
          <button class="btn btn-out btn-sm" id="abrir-filtros" ${E.filtrosAbertos ? 'hidden' : ''}><span data-ico="filter"></span>Filtros<span id="n-filtros"></span></button>
          <span class="result" id="resultado"></span>
          <div class="seg">
            <button data-modo="quadro"><span data-ico="board"></span>Quadro</button>
            <button data-modo="lista"><span data-ico="list"></span>Lista</button>
          </div>
        </div>
        <div id="area"></div>
      </div>
    </div>`;

  $$('[data-go]').forEach((b) => b.addEventListener('click', () => { location.hash = b.dataset.go; }));
  $$('[data-f]').forEach((el) => {
    el.value = f[el.dataset.f] ?? '';
    el.addEventListener('input', () => { f[el.dataset.f] = el.value; E.limite = {}; salvaPrefs(); renderResultado(); });
  });
  $$('[data-area]').forEach((cb) => cb.addEventListener('change', () => {
    const k = cb.dataset.area;
    f.areas = cb.checked ? [...f.areas, k] : f.areas.filter((x) => x !== k);
    E.limite = {}; salvaPrefs(); renderResultado();
  }));
  $('#ver-areas')?.addEventListener('click', () => { E.verTodasAreas = !E.verTodasAreas; render(); });
  $('#limpar').addEventListener('click', () => { E.filtros = filtrosPadrao(); salvaPrefs(); render(); });
  const alternaFiltros = () => { E.filtrosAbertos = !E.filtrosAbertos; salvaPrefs(); render(); };
  $('#recolher').addEventListener('click', alternaFiltros);
  $('#abrir-filtros').addEventListener('click', alternaFiltros);
  $$('[data-modo]').forEach((b) => b.addEventListener('click', () => { E.modo = b.dataset.modo; salvaPrefs(); renderResultado(); }));
  renderResultado();
}

function filtrados() {
  const f = E.filtros, q = semAcento(E.busca).trim(), qDig = E.busca.replace(/\D/g, '');
  const local = semAcento(f.local).trim();
  return E.cands.filter((c) => {
    if (excluido(c)) return false;
    if (q && !c.busca.includes(q) && !(qDig.length >= 4 && c.telDig.includes(qDig))) return false;
    if (f.areas.length && !c.areas.some((a) => f.areas.includes(semAcento(a)))) return false;
    if (local && !semAcento(c.local).includes(local)) return false;
    if (f.idadeMin && (c.idade === null || c.idade < Number(f.idadeMin))) return false;
    if (f.idadeMax && (c.idade === null || c.idade > Number(f.idadeMax))) return false;
    if (f.escolaridade && c.escolaridade !== f.escolaridade) return false;
    if (f.civil && c.civil !== f.civil) return false;
    if (f.de && (!c.carimbo || dataLocal(c.carimbo) < f.de)) return false;
    if (f.ate && (!c.carimbo || dataLocal(c.carimbo) > f.ate)) return false;
    return true;
  });
}

function renderResultado() {
  const area = $('#area');
  if (!area) return;
  const base = filtrados();
  const visiveis = statusAtivos().filter((s) => !E.filtros.ocultos.includes(s.id));
  const ativos = E.cands.filter((c) => !excluido(c)).length;
  const lista = base.filter((c) => !E.filtros.ocultos.includes(c.status_id));
  const notas = {};
  E.hist.forEach((h) => { if (h.tipo === 'nota') notas[h.candidato_id] = (notas[h.candidato_id] || 0) + 1; });

  $('#f-status').innerHTML = statusAtivos().map((s) => `
    <label class="st-check"><input type="checkbox" data-st="${esc(s.id)}" ${E.filtros.ocultos.includes(s.id) ? '' : 'checked'}>
      <span class="dot" style="background:${esc(s.cor)}"></span>${esc(s.nome)}
      <span class="cnt">${base.filter((c) => c.status_id === s.id).length}</span></label>`).join('');
  $$('[data-st]').forEach((cb) => cb.addEventListener('change', () => {
    const id = cb.dataset.st;
    E.filtros.ocultos = cb.checked ? E.filtros.ocultos.filter((x) => x !== id) : [...E.filtros.ocultos, id];
    salvaPrefs(); renderResultado();
  }));

  $('#resultado').textContent = `${lista.length} de ${ativos} candidato${ativos === 1 ? '' : 's'}`;
  const f = E.filtros;
  const nAtivos = ['local', 'idadeMin', 'idadeMax', 'escolaridade', 'civil', 'de', 'ate'].filter((k) => f[k]).length + (f.ocultos.length ? 1 : 0) + (f.areas.length ? 1 : 0);
  $('#n-filtros').textContent = nAtivos ? ` (${nAtivos})` : '';
  $$('[data-modo]').forEach((b) => b.classList.toggle('ativo', b.dataset.modo === E.modo));

  if (!E.cands.length) {
    area.innerHTML = '<div class="panel empty"><span data-ico="users"></span><div>Nenhuma resposta na planilha ainda.</div></div>';
  } else if (E.modo === 'quadro') {
    const ordenada = [...lista].sort((a, b) => String(b.carimbo).localeCompare(String(a.carimbo)));
    // Coluna expandida: mostra só ela, ocupando a largura toda, com os cards em grade
    const expandida = visiveis.find((s) => s.id === E.expandida);
    const passo = expandida ? POR_COLUNA * 3 : POR_COLUNA;
    area.innerHTML = `<div class="board ${expandida ? 'expandido' : ''}">${(expandida ? [expandida] : visiveis).map((s) => {
      const todos = ordenada.filter((c) => c.status_id === s.id);
      const lim = E.limite[s.id] || passo;
      return `<div class="col">
        <div class="col-head"><span class="dot" style="background:${esc(s.cor)}"></span>${esc(s.nome)}<span class="n">${todos.length}</span>
          ${expandida ? '<button class="btn btn-out btn-sm" data-expandir="">Voltar ao quadro</button>'
            : `<button class="icon-btn col-exp" data-expandir="${esc(s.id)}" title="Expandir esta coluna"><span data-ico="expand"></span></button>`}</div>
        <div class="col-body" data-col="${esc(s.id)}">${todos.slice(0, lim).map((c) => cardHtml(c, s, notas[c.id])).join('') || '<div class="col-empty">Nenhum candidato</div>'}
          ${todos.length > lim ? `<button class="btn btn-ghost btn-sm mais" data-mais="${esc(s.id)}">Mostrar mais ${Math.min(passo, todos.length - lim)} de ${todos.length - lim}</button>` : ''}</div>
      </div>`;
    }).join('')}</div>`;
    $$('[data-mais]', area).forEach((b) => b.addEventListener('click', () => {
      E.limite[b.dataset.mais] = (E.limite[b.dataset.mais] || passo) + passo; renderResultado();
    }));
    $$('[data-expandir]', area).forEach((b) => b.addEventListener('click', () => {
      E.expandida = b.dataset.expandir || null; E.limite = {}; renderResultado(); window.scrollTo({ top: 0 });
    }));
    ligarArrastar(area);
  } else {
    area.innerHTML = tabelaHtml(lista, notas);
    $$('th[data-ord]', area).forEach((th) => th.addEventListener('click', () => {
      const campo = th.dataset.ord;
      E.ordem = { campo, desc: E.ordem.campo === campo ? !E.ordem.desc : false };
      renderResultado();
    }));
  }
  $$('[data-abrir]', area).forEach((el) => el.addEventListener('click', () => abrirCandidato(el.dataset.abrir)));
  icones(area);
}

function cardHtml(c, s, nNotas) {
  return `<div class="card" draggable="true" data-abrir="${esc(c.id)}" style="--c:${esc(s.cor)}">
    <div class="card-name">${esc(c.nome)}</div>
    ${c.areas.length ? `<div class="chips">${c.areas.slice(0, 2).map((a) => `<span class="card-vaga">${esc(a)}</span>`).join('')}${c.areas.length > 2 ? `<span class="card-vaga mais">+${c.areas.length - 2}</span>` : ''}</div>` : ''}
    <div class="card-meta">
      ${c.idade !== null ? `<span><span data-ico="cake"></span>${c.idade} anos</span>` : ''}
      ${c.local ? `<span><span data-ico="pin"></span>${esc(c.local)}</span>` : ''}
    </div>
    <div class="card-foot"><span>Inscrito ${tempoRelativo(c.carimbo)}</span>
      ${nNotas ? `<span title="Anotações" style="display:inline-flex;gap:3px;align-items:center"><span data-ico="note"></span>${nNotas}</span>` : ''}</div>
  </div>`;
}

function tabelaHtml(lista, notas) {
  const { campo, desc } = E.ordem;
  const valor = (c) => campo === 'idade' ? (c.idade ?? -1)
    : campo === 'status' ? statusDe(c.status_id).ordem
    : campo === 'areas' ? c.areas.join(', ')
    : campo === 'notas' ? (notas[c.id] || 0) : c[campo] ?? '';
  const ord = [...lista].sort((a, b) => {
    const x = valor(a), y = valor(b);
    const r = typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'pt-BR');
    return desc ? -r : r;
  });
  const th = (k, t) => `<th data-ord="${k}">${t}${campo === k ? (desc ? ' ↓' : ' ↑') : ''}</th>`;
  if (!ord.length) return '<div class="panel empty">Nenhum candidato com esses filtros.</div>';
  return `<div class="panel table-wrap" style="padding:0"><table class="list">
    <thead><tr>${th('nome', 'Nome')}${th('areas', 'Áreas')}${th('idade', 'Idade')}${th('local', 'Bairro / cidade')}<th>Telefone</th>${th('status', 'Status')}${th('carimbo', 'Inscrição')}${th('notas', 'Notas')}</tr></thead>
    <tbody>${ord.map((c) => {
      const s = statusDe(c.status_id);
      return `<tr data-abrir="${esc(c.id)}">
        <td><b>${esc(c.nome)}</b></td>
        <td style="max-width:260px">${esc(c.areas.join(', ') || '—')}</td><td>${c.idade ?? '—'}</td>
        <td>${esc(c.local || '—')}</td><td style="white-space:nowrap">${esc(c.telefone)}</td>
        <td><span class="pill" style="--c:${esc(s.cor)}"><span class="dot" style="background:${esc(s.cor)}"></span>${esc(s.nome)}</span></td>
        <td style="white-space:nowrap">${fmtData(c.carimbo)}</td><td>${notas[c.id] || ''}</td></tr>`;
    }).join('')}</tbody></table></div>`;
}

function ligarArrastar(area) {
  let arrastando = null;
  $$('.card', area).forEach((card) => {
    card.addEventListener('dragstart', (e) => { arrastando = card.dataset.abrir; card.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
    card.addEventListener('dragend', () => { card.classList.remove('dragging'); arrastando = null; });
  });
  $$('[data-col]', area).forEach((col) => {
    col.addEventListener('dragover', (e) => { if (arrastando) { e.preventDefault(); col.classList.add('drop'); } });
    col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('drop'); });
    col.addEventListener('drop', (e) => {
      e.preventDefault(); col.classList.remove('drop');
      if (arrastando) mudarStatus(arrastando, col.dataset.col);
    });
  });
}

async function mudarStatus(id, statusId) {
  const c = candDe(id);
  if (!c || c.status_id === statusId) return;
  const anterior = c.status_id;
  c.status_id = statusId;
  atualizaTela(id);
  try {
    const r = await api('mudarStatus', { id, status_id: statusId });
    if (r.historico) E.hist.push(r.historico);
    toast(`${c.nome.split(' ')[0]} → ${statusDe(statusId).nome}`);
  } catch (err) {
    c.status_id = anterior;
    toast(err.message, true);
  }
  atualizaTela(id);
}
function atualizaTela(id) {
  if (E.view === 'candidatos') renderResultado();
  if (E.view === 'excluidos') renderExcluidos();
  if (E.aberto === id) renderFicha();
}

// ───────────────────────── Excluídos ─────────────────────────
async function excluirCandidato(id) {
  try {
    if (!statusExcluidos()) {
      await api('salvarStatus', { nome: 'Excluídos', cor: '#64748b' });
      await carregar();
    }
    fecharCandidato();
    await mudarStatus(id, statusExcluidos().id);
  } catch (err) { toast(err.message, true); }
}
async function restaurarCandidato(id) {
  // Volta para o status em que estava antes de ser excluído (ou para o inicial)
  const ultima = histDe(id).filter((h) => h.tipo === 'status' && /para "Exclu[ií]dos"/i.test(h.texto))
    .sort((a, b) => String(b.criado_em).localeCompare(String(a.criado_em)))[0];
  const nomeAnterior = ultima?.texto.match(/de "(.+?)" para/)?.[1];
  const ativos = statusAtivos();
  const alvo = ativos.find((s) => s.nome === nomeAnterior) || ativos.find((s) => s.inicial) || ativos[0];
  await mudarStatus(id, alvo.id);
}

function renderExcluidos() {
  const q = semAcento(E.busca).trim();
  const quando = (c) => histDe(c.id).filter((h) => h.tipo === 'status').map((h) => h.criado_em).sort().pop() || '';
  const lista = E.cands.filter((c) => excluido(c) && (!q || c.busca.includes(q)))
    .sort((a, b) => quando(b).localeCompare(quando(a)));
  $('#page').innerHTML = `
    <div class="page-head"><div><h1>Excluídos</h1><p>Candidatos retirados do quadro. Restaure para voltarem ao processo.</p></div></div>
    ${lista.length ? `<div class="panel table-wrap" style="padding:0"><table class="list">
      <thead><tr><th>Nome</th><th>Áreas</th><th>Idade</th><th>Bairro / cidade</th><th>Inscrição</th><th>Excluído em</th><th></th></tr></thead>
      <tbody>${lista.map((c) => `
        <tr data-abrir="${esc(c.id)}">
          <td><b>${esc(c.nome)}</b></td><td style="max-width:260px">${esc(c.areas.join(', ') || '—')}</td><td>${c.idade ?? '—'}</td>
          <td>${esc(c.local || '—')}</td><td style="white-space:nowrap">${fmtData(c.carimbo)}</td>
          <td style="white-space:nowrap">${quando(c) ? fmtDataHora(quando(c)) : '—'}</td>
          <td><button class="btn btn-out btn-sm" data-restaurar="${esc(c.id)}"><span data-ico="restore"></span>Restaurar</button></td>
        </tr>`).join('')}</tbody></table></div>`
      : `<div class="panel empty"><span data-ico="trash"></span><div>${q ? 'Nenhum excluído encontrado para essa busca.' : 'Nenhum candidato excluído.'}</div></div>`}`;
  $$('[data-abrir]').forEach((tr) => tr.addEventListener('click', () => abrirCandidato(tr.dataset.abrir)));
  $$('[data-restaurar]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); restaurarCandidato(b.dataset.restaurar); }));
  icones($('#page'));
}

// ───────────────────────── Ficha do candidato ─────────────────────────
function abrirCandidato(id) {
  if (E.aberto !== id) E.aba = 'dados';
  E.aberto = id;
  renderFicha();
}
function fecharCandidato() {
  $('.overlay')?.remove();
  E.aberto = null;
  document.body.style.overflow = '';
}

function renderFicha() {
  const c = candDe(E.aberto);
  if (!c) return fecharCandidato();
  const rascunho = $('#nota-txt')?.value || '';
  const histScroll = $('.hist-list')?.scrollTop || 0;
  let ov = $('.overlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.className = 'overlay';
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) fecharCandidato(); });
    document.body.append(ov);
    document.body.style.overflow = 'hidden';
  }
  const zap = c.telDig.length >= 10 ? (c.telDig.startsWith('55') && c.telDig.length > 11 ? c.telDig : '55' + c.telDig) : '';
  const info = (rotulo, valor) => `<div class="info"><dt>${rotulo}</dt><dd>${esc(valor || '—')}</dd></div>`;
  // Perguntas que já aparecem no resumo não se repetem na lista de respostas
  const noResumo = ['carimbo', 'nome', 'idade', 'local', 'telefone', 'estadoCivil', 'curriculo', 'nascimento', 'areas', 'escolaridade']
    .map((k) => E.campos[k]).filter((i) => i != null);
  const outras = E.perguntas.map((p, i) => ({ p, i })).filter(({ i }) => !noResumo.includes(i));
  const historico = [...histDe(c.id), { autor: 'Google Forms', tipo: 'inscricao', texto: 'Candidatura recebida pelo formulário.', criado_em: c.carimbo }]
    .sort((a, b) => String(b.criado_em).localeCompare(String(a.criado_em)));

  ov.innerHTML = `<div class="drawer" role="dialog" aria-label="Ficha do candidato">
    <div class="drawer-head">
      <div class="avatar" style="width:46px;height:46px;font-size:18px">${esc(c.nome.trim()[0]?.toUpperCase() || '?')}</div>
      <div style="flex:1;min-width:0">
        <h2>${esc(c.nome)}</h2>
        <div class="sub">
          ${c.idade !== null ? `<span>${c.idade} anos</span>` : ''}
          ${c.local ? `<span>${esc(c.local)}</span>` : ''}
          ${c.telefone ? `<a href="tel:${esc(c.telDig)}">${esc(c.telefone)}</a>` : ''}
          ${zap ? `<a href="https://wa.me/${esc(zap)}" target="_blank" rel="noopener">WhatsApp ↗</a>` : ''}
          <span>Inscrito em ${fmtDataHora(c.carimbo)}</span>
          <a href="${esc(E.planilhaUrl)}#gid=0&range=A${c.linha}" target="_blank" rel="noopener">Linha ${c.linha} da planilha ↗</a>
        </div>
      </div>
      ${excluido(c) ? '<button class="btn btn-out btn-sm" id="restaurar"><span data-ico="restore"></span>Restaurar</button>'
        : '<button class="btn btn-danger btn-sm" id="excluir"><span data-ico="trash"></span>Excluir</button>'}
      <button class="icon-btn" id="fechar" title="Fechar (Esc)"><span data-ico="x"></span></button>
    </div>
    ${excluido(c) ? '<div class="aviso-excluido">Este candidato está na lista de <b>Excluídos</b> e não aparece no quadro até ser restaurado.</div>' : ''}
    <div class="status-bar">
      <span class="lbl">Status</span>
      ${statusAtivos().map((s) => `<button class="st-btn ${s.id === c.status_id ? 'ativo' : ''}" data-mudar="${esc(s.id)}" style="--c:${esc(s.cor)}">
        <span class="dot" style="background:${esc(s.cor)}"></span>${esc(s.nome)}</button>`).join('')}
    </div>
    <div class="drawer-body">
      <div class="panel left-pane">
        <div class="tabs">
          <button class="tab ${E.aba === 'dados' ? 'ativo' : ''}" data-aba="dados">Respostas</button>
          <button class="tab ${E.aba === 'curriculo' ? 'ativo' : ''}" data-aba="curriculo">Currículo</button>
        </div>
        <div class="tab-content" id="aba-conteudo">${E.aba === 'dados' ? `
          ${c.areas.length ? `<div class="chips" style="margin-bottom:14px">${c.areas.map((a) => `<span class="card-vaga">${esc(a)}</span>`).join('')}</div>` : ''}
          <dl class="info-grid" style="margin:0">
            ${info('Idade', c.idade !== null ? `${c.idade} anos` : '')}
            ${info('Nascimento', c.nascTxt)}
            ${info('Estado civil', c.civilTxt)}
            ${info('Escolaridade', c.escolaridadeTxt)}
            ${info('Bairro / cidade', c.local)}
            ${info('Telefone', c.telefone)}
          </dl>
          ${outras.map(({ p, i }) => `<div class="answer"><h4>${esc(p)}</h4><p>${String(c.respostas[i] || '').trim()
            ? esc(c.respostas[i]) : '<span style="color:var(--dm)">Não respondido</span>'}</p></div>`).join('')}
        ` : '<div class="empty"><div class="spinner"></div><div>Abrindo currículo…</div></div>'}</div>
      </div>
      <div class="panel hist">
        <h3 class="panel-title" style="margin-bottom:10px">Anotações e histórico</h3>
        <textarea class="textarea" id="nota-txt" placeholder="Escreva uma anotação (ligação, entrevista, impressões…)" style="min-height:84px"></textarea>
        <div style="display:flex;align-items:center;gap:8px;margin-top:8px">
          <small style="color:var(--dm)">Ctrl + Enter para salvar</small>
          <button class="btn btn-pri btn-sm" id="nota-salvar" style="margin-left:auto"><span data-ico="plus"></span>Salvar anotação</button>
        </div>
        <div class="hist-list">${historico.map((h) => `
          <div class="hist-item ${esc(h.tipo)}">
            <span class="hist-ico"></span>
            <div class="hist-head"><b>${esc(h.autor)}</b> · ${fmtDataHora(h.criado_em)}${h.tipo === 'nota' ? ' · anotação' : ''}</div>
            <div class="hist-text">${esc(h.texto)}</div>
          </div>`).join('')}</div>
      </div>
    </div>
  </div>`;
  icones(ov);
  $('#nota-txt').value = rascunho;
  $('.hist-list').scrollTop = histScroll;
  if (E.aba === 'curriculo') mostrarCurriculo(c);

  $('#fechar').addEventListener('click', fecharCandidato);
  $('#excluir')?.addEventListener('click', () => excluirCandidato(c.id));
  $('#restaurar')?.addEventListener('click', () => restaurarCandidato(c.id));
  $$('[data-aba]', ov).forEach((b) => b.addEventListener('click', () => { E.aba = b.dataset.aba; renderFicha(); }));
  $$('[data-mudar]', ov).forEach((b) => b.addEventListener('click', () => mudarStatus(c.id, b.dataset.mudar)));
  const salvarNota = async () => {
    const texto = $('#nota-txt').value.trim();
    if (!texto) return $('#nota-txt').focus();
    $('#nota-salvar').disabled = true;
    try {
      const r = await api('nota', { id: c.id, texto });
      E.hist.push(r.historico);
      $('#nota-txt').value = '';
      if (E.view === 'candidatos') renderResultado();
      if (E.aberto === c.id) renderFicha();
      toast('Anotação salva');
    } catch (err) { toast(err.message, true); $('#nota-salvar').disabled = false; }
  };
  $('#nota-salvar').addEventListener('click', salvarNota);
  $('#nota-txt').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) salvarNota(); });
}

async function mostrarCurriculo(c) {
  const alvo = () => (E.aberto === c.id && E.aba === 'curriculo' ? $('#aba-conteudo') : null);
  if (!c.cvLink) { alvo().innerHTML = '<div class="empty"><span data-ico="file"></span><div>Este candidato não anexou currículo.</div></div>'; icones(alvo()); return; }
  let cv = E.cv[c.id];
  if (!cv) {
    try {
      const r = await api('curriculo', { id: c.id });
      cv = { nome: r.nome, url: r.url, tipo: r.tipo || '', grande: r.grande };
      if (r.dados) {
        const bytes = Uint8Array.from(atob(r.dados), (ch) => ch.charCodeAt(0));
        cv.blob = URL.createObjectURL(new Blob([bytes], { type: cv.tipo }));
      }
      E.cv[c.id] = cv;
    } catch (err) {
      const el = alvo();
      if (el) el.innerHTML = `<div class="empty"><div class="msg-erro">${esc(err.message)}</div></div>`;
      return;
    }
  }
  const el = alvo();
  if (!el) return;
  const visivel = cv.blob && (cv.tipo === 'application/pdf' || cv.tipo.startsWith('image/'));
  el.innerHTML = `
    <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center">
      <span style="font-weight:700;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(cv.nome)}</span>
      <a class="btn btn-out btn-sm" href="${esc(cv.url)}" target="_blank" rel="noopener"><span data-ico="external"></span>Abrir no Drive</a>
      ${cv.blob ? `<a class="btn btn-pri btn-sm" href="${cv.blob}" download="${esc(cv.nome)}"><span data-ico="download"></span>Baixar</a>` : ''}
    </div>
    ${!visivel ? `<div class="empty"><span data-ico="file"></span><div>${cv.grande ? 'Arquivo grande demais para exibir aqui.' : 'Este tipo de arquivo (ex.: Word) não pode ser exibido no navegador.'}<br>Use <b>Baixar</b> ou <b>Abrir no Drive</b>.</div></div>`
      : cv.tipo === 'application/pdf' ? `<iframe class="cv-frame" src="${cv.blob}" title="Currículo"></iframe>`
      : `<img class="cv-img" src="${cv.blob}" alt="Currículo de ${esc(c.nome)}">`}`;
  icones(el);
}

// ───────────────────────── Status ─────────────────────────
function renderStatus() {
  const total = (id) => E.cands.filter((c) => c.status_id === id).length;
  const lista = statusAtivos();
  $('#page').innerHTML = `
    <div class="page-head"><div><h1>Status</h1><p>Etapas do processo seletivo. A ordem aqui é a ordem das colunas do quadro.</p></div></div>
    <div class="panel" style="max-width:780px">
      <h3 class="panel-title">Etapas</h3>
      <div class="cfg-list">${lista.map((s, idx) => `
        <div class="cfg-row" data-id="${esc(s.id)}">
          <input type="color" class="input-color" value="${esc(s.cor)}" data-campo="cor" title="Cor">
          <input class="input grow" value="${esc(s.nome)}" data-campo="nome" maxlength="40">
          ${s.inicial ? '<span class="badge" title="Novas respostas do formulário entram com este status">Inicial</span>'
            : '<button class="btn btn-ghost btn-sm" data-inicial title="Novas respostas do formulário entram com este status">Tornar inicial</button>'}
          <span class="meta" style="white-space:nowrap">${total(s.id)} cand.</span>
          <button class="icon-btn" data-mover="-1" ${idx === 0 ? 'disabled' : ''} title="Subir"><span data-ico="up"></span></button>
          <button class="icon-btn" data-mover="1" ${idx === lista.length - 1 ? 'disabled' : ''} title="Descer"><span data-ico="down"></span></button>
          <button class="icon-btn" data-excluir title="Excluir"><span data-ico="trash"></span></button>
        </div>`).join('')}</div>
      <form class="cfg-add" id="novo-status">
        <input type="color" class="input-color" name="cor" value="#7c3aed">
        <input class="input" name="nome" placeholder="Novo status (ex.: Teste prático, 2ª entrevista…)" maxlength="40" required>
        <button class="btn btn-pri"><span data-ico="plus"></span>Adicionar</button>
      </form>
    </div>`;

  const aposSalvar = async (msg) => { await carregar(); render(); toast(msg); };
  $$('.cfg-row').forEach((row) => {
    const id = row.dataset.id;
    const s = E.status.find((x) => x.id === id);
    const salvar = async (extra = {}) => {
      try {
        await api('salvarStatus', { id, nome: $('[data-campo=nome]', row).value, cor: $('[data-campo=cor]', row).value, ...extra });
        await aposSalvar('Status atualizado');
      } catch (err) { toast(err.message, true); render(); }
    };
    $('[data-campo=nome]', row).addEventListener('change', () => salvar());
    $('[data-campo=cor]', row).addEventListener('change', () => salvar());
    $('[data-inicial]', row)?.addEventListener('click', () => salvar({ inicial: true }));
    $$('[data-mover]', row).forEach((b) => b.addEventListener('click', async () => {
      const ids = lista.map((x) => x.id);
      const i = ids.indexOf(id), j = i + Number(b.dataset.mover);
      [ids[i], ids[j]] = [ids[j], ids[i]];
      try { await api('ordenarStatus', { ids }); await aposSalvar('Ordem atualizada'); } catch (err) { toast(err.message, true); }
    }));
    $('[data-excluir]', row).addEventListener('click', async () => {
      if (!await dialogo({ titulo: `Excluir status "${s.nome}"?`, texto: 'Só é possível excluir status sem candidatos.', confirmar: 'Excluir', perigo: true })) return;
      try { await api('excluirStatus', { id }); await aposSalvar('Status excluído'); } catch (err) { toast(err.message, true); }
    });
  });
  $('#novo-status').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('salvarStatus', Object.fromEntries(new FormData(e.target))); await aposSalvar('Status criado'); }
    catch (err) { toast(err.message, true); }
  });
}

// ───────────────────────── Usuários ─────────────────────────
async function renderUsuarios() {
  $('#page').innerHTML = `
    <div class="page-head"><div><h1>Usuários</h1><p>Quem pode acessar o sistema.</p></div>
      <div class="acts"><button class="btn btn-pri" id="novo-usuario"><span data-ico="plus"></span>Novo usuário</button></div></div>
    <div class="panel" style="max-width:760px"><div class="cfg-list" id="lista-usuarios"><div class="empty"><div class="spinner"></div></div></div></div>`;
  icones($('#page'));
  $('#novo-usuario').addEventListener('click', async () => {
    const v = await dialogo({ titulo: 'Novo usuário', confirmar: 'Criar usuário', campos: [
      { name: 'nome', label: 'Nome' }, { name: 'login', label: 'Usuário (login)' },
      { name: 'senha', label: 'Senha (mín. 6 caracteres)', type: 'password' },
      { name: 'admin', label: 'Administrador (pode gerenciar usuários)', type: 'checkbox' }] });
    if (!v) return;
    try { await api('criarUsuario', v); toast('Usuário criado'); renderUsuarios(); } catch (err) { toast(err.message, true); }
  });
  try {
    const { usuarios } = await api('usuarios');
    $('#lista-usuarios').innerHTML = usuarios.map((u) => `
      <div class="cfg-row" data-id="${esc(u.id)}">
        <div class="avatar">${esc(u.nome.trim()[0]?.toUpperCase() || '?')}</div>
        <div class="grow"><b>${esc(u.nome)}</b><div class="meta">${esc(u.login)} · desde ${fmtData(u.criado_em)}</div></div>
        <span class="badge ${u.admin ? '' : 'off'}">${u.admin ? 'Administrador' : 'Recrutador'}</span>
        <button class="icon-btn" data-senha title="Redefinir senha"><span data-ico="key"></span></button>
        ${u.id === E.me.id ? '' : '<button class="icon-btn" data-excluir title="Excluir usuário"><span data-ico="trash"></span></button>'}
      </div>`).join('');
    icones($('#lista-usuarios'));
    $$('#lista-usuarios .cfg-row').forEach((row) => {
      const u = usuarios.find((x) => x.id === row.dataset.id);
      $('[data-senha]', row).addEventListener('click', async () => {
        const v = await dialogo({ titulo: `Nova senha para ${u.nome}`, confirmar: 'Salvar', campos: [{ name: 'senha', label: 'Nova senha (mín. 6 caracteres)', type: 'password' }] });
        if (!v) return;
        try {
          await api('senhaUsuario', { id: u.id, ...v });
          toast('Senha redefinida');
          if (u.id === E.me.id) { salvaToken(null); location.href = 'login.html'; }
        } catch (err) { toast(err.message, true); }
      });
      $('[data-excluir]', row)?.addEventListener('click', async () => {
        if (!await dialogo({ titulo: `Excluir ${u.nome}?`, texto: 'A pessoa perderá o acesso. O histórico registrado por ela é mantido.', confirmar: 'Excluir', perigo: true })) return;
        try { await api('excluirUsuario', { id: u.id }); toast('Usuário excluído'); renderUsuarios(); } catch (err) { toast(err.message, true); }
      });
    });
  } catch (err) { $('#lista-usuarios').textContent = err.message; }
}

async function trocarSenha() {
  const v = await dialogo({ titulo: 'Trocar minha senha', confirmar: 'Salvar', campos: [
    { name: 'atual', label: 'Senha atual', type: 'password' }, { name: 'nova', label: 'Nova senha (mín. 6 caracteres)', type: 'password' }] });
  if (!v) return;
  try { const r = await api('trocarSenha', v); salvaToken(r.token); toast('Senha alterada'); } catch (err) { toast(err.message, true); }
}

// ───────────────────────── Diálogo genérico ─────────────────────────
function dialogo({ titulo, texto = '', campos = [], confirmar = 'OK', perigo = false }) {
  return new Promise((resolve) => {
    const w = document.createElement('div');
    w.className = 'dialog-wrap';
    w.innerHTML = `<form class="dialog">
      <h3>${esc(titulo)}</h3>${texto ? `<p>${esc(texto)}</p>` : ''}
      ${campos.length ? `<div class="fields">${campos.map((c) => c.type === 'checkbox'
        ? `<label class="consent"><input type="checkbox" name="${c.name}"><span>${esc(c.label)}</span></label>`
        : `<label class="field"><span>${esc(c.label)}</span><input class="input" name="${c.name}" type="${c.type || 'text'}" required ${c.type === 'password' ? 'autocomplete="new-password"' : ''}></label>`).join('')}</div>` : ''}
      <div class="acts"><button type="button" class="btn btn-ghost" data-cancelar>Cancelar</button>
        <button class="btn ${perigo ? 'btn-danger' : 'btn-pri'}">${esc(confirmar)}</button></div>
    </form>`;
    const fim = (valor) => { w.remove(); resolve(valor); };
    w.addEventListener('mousedown', (e) => { if (e.target === w) fim(null); });
    w.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); fim(null); } });
    $('[data-cancelar]', w).addEventListener('click', () => fim(null));
    $('form', w).addEventListener('submit', (e) => {
      e.preventDefault();
      if (!campos.length) return fim(true);
      const v = {};
      campos.forEach((c) => { const el = e.target.elements[c.name]; v[c.name] = c.type === 'checkbox' ? el.checked : el.value; });
      fim(v);
    });
    document.body.append(w);
    ($('input', w) || $('button:last-child', w)).focus();
  });
}
