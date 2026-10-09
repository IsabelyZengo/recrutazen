/**
 * RecrutaZen — backend do processo seletivo (Google Apps Script)
 *
 * Cole este arquivo no Apps Script da planilha de respostas do Google Forms
 * (Extensões > Apps Script) e implante como "App da Web". Passo a passo no LEIA-ME.
 *
 * As respostas do formulário são apenas LIDAS. Status, anotações e usuários do
 * sistema ficam em abas ocultas criadas automaticamente (RZ_...).
 */

const ABAS = {
  status: { nome: 'RZ_Status', cab: ['id', 'nome', 'cor', 'ordem', 'inicial'] },
  cand: { nome: 'RZ_Candidatos', cab: ['id', 'status_id', 'atualizado_em', 'ordem'] },
  hist: { nome: 'RZ_Historico', cab: ['id', 'candidato_id', 'autor', 'tipo', 'texto', 'criado_em'] },
  usu: { nome: 'RZ_Usuarios', cab: ['id', 'nome', 'login', 'senha_hash', 'admin', 'criado_em'] },
};
const ABA_MANUAL = 'Cadastro manual (RecrutaZen)';
const COL_ID = 'ID RecrutaZen', COL_AUTOR = 'Cadastrado por';
const SESSAO_DIAS = 7;
const MAX_CV_BYTES = 10 * 1024 * 1024;

// Colunas do formulário, reconhecidas pelo texto da pergunta (a primeira que casar)
const CAMPOS = {
  carimbo: /^carimbo/i,
  nome: /^nome/i,
  idade: /^idade/i,
  local: /bairro|cidade|endere[cç]o/i,
  telefone: /telefone|celular|whats/i,
  estadoCivil: /estado civil/i,
  curriculo: /curr[ií]culo/i,
  nascimento: /nascimento/i,
  areas: /[áa]rea|vaga pretendida/i,
  escolaridade: /escolaridade/i,
};

// ───────────────────────── Entrada ─────────────────────────
const ACOES = {
  precisaSetup: { publica: true, fn: () => ({ precisaSetup: ler(ABAS.usu).length === 0 }) },
  setup: { publica: true, escrita: true, fn: acaoSetup },
  login: { publica: true, fn: acaoLogin },
  dados: { escrita: true, fn: acaoDados },
  curriculo: { fn: acaoCurriculo },
  novidades: { fn: acaoNovidades },
  criarCandidato: { escrita: true, fn: acaoCriarCandidato },
  mudarStatus: { escrita: true, fn: acaoMudarStatus },
  ordenarCards: { escrita: true, fn: acaoOrdenarCards },
  nota: { escrita: true, fn: acaoNota },
  salvarStatus: { escrita: true, fn: acaoSalvarStatus },
  ordenarStatus: { escrita: true, fn: acaoOrdenarStatus },
  excluirStatus: { escrita: true, fn: acaoExcluirStatus },
  trocarSenha: { escrita: true, fn: acaoTrocarSenha },
  usuarios: { admin: true, fn: acaoUsuarios },
  criarUsuario: { admin: true, escrita: true, fn: acaoCriarUsuario },
  senhaUsuario: { admin: true, escrita: true, fn: acaoSenhaUsuario },
  excluirUsuario: { admin: true, escrita: true, fn: acaoExcluirUsuario },
};

function doGet() {
  return json({ ok: true, app: 'RecrutaZen', mensagem: 'Backend no ar. Use o sistema pelo site.' });
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json({ erro: 'Requisição inválida.' }); }
  const acao = ACOES[req.acao];
  if (!acao) return json({ erro: 'Ação desconhecida.' });
  let lock = null;
  try {
    let usuario = null;
    if (!acao.publica) {
      usuario = validaToken(req.token);
      if (!usuario) return json({ erro: 'Sua sessão expirou. Entre novamente.', sessao: false });
      if (acao.admin && !usuario.admin) throw erro('Apenas administradores podem fazer isso.');
    }
    if (acao.escrita) { lock = LockService.getScriptLock(); lock.waitLock(20000); }
    return json(acao.fn(req, usuario) || { ok: true });
  } catch (err) {
    return json({ erro: err.usuario ? err.message : 'Erro no servidor: ' + err.message });
  } finally {
    if (lock) lock.releaseLock();
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function erro(msg) { const e = new Error(msg); e.usuario = true; return e; }
const agora = () => new Date().toISOString();
const novoId = (prefixo) => prefixo + Utilities.getUuid().replace(/-/g, '').slice(0, 12);
const txt = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 500);
const ehSim = (v) => v === true || v === 1 || v === '1' || String(v).toUpperCase() === 'TRUE';

// ───────────────────────── Abas internas ─────────────────────────
function aba(def) {
  const ss = SpreadsheetApp.getActive();
  let s = ss.getSheetByName(def.nome);
  if (!s) {
    s = ss.insertSheet(def.nome);
    s.getRange(1, 1, s.getMaxRows(), def.cab.length).setNumberFormat('@');
    s.getRange(1, 1, 1, def.cab.length).setValues([def.cab]).setFontWeight('bold');
    s.setFrozenRows(1);
    s.hideSheet();
  }
  return s;
}
function ler(def) {
  const s = aba(def);
  const n = s.getLastRow();
  if (n < 2) return [];
  return s.getRange(2, 1, n - 1, def.cab.length).getValues().map((r, i) => {
    const o = { _linha: i + 2 };
    def.cab.forEach((k, j) => { o[k] = r[j] instanceof Date ? r[j].toISOString() : r[j]; });
    return o;
  }).filter((o) => o.id !== '' && o.id != null);
}
function linhaDe(def, o) { return def.cab.map((k) => (o[k] === undefined || o[k] === null ? '' : o[k])); }
function inserir(def, objs) {
  if (!objs.length) return;
  const s = aba(def);
  const ini = s.getLastRow() + 1;
  const falta = ini + objs.length - 1 - s.getMaxRows();
  if (falta > 0) s.insertRowsAfter(s.getMaxRows(), falta);
  s.getRange(ini, 1, objs.length, def.cab.length).setNumberFormat('@').setValues(objs.map((o) => linhaDe(def, o)));
}
function gravar(def, o) { aba(def).getRange(o._linha, 1, 1, def.cab.length).setNumberFormat('@').setValues([linhaDe(def, o)]); }

// ───────────────────────── Senhas e sessões ─────────────────────────
function hex(bytes) { return bytes.map((b) => ((b + 256) % 256).toString(16).padStart(2, '0')).join(''); }
function hashSenha(senha, salt) {
  salt = salt || Utilities.getUuid().replace(/-/g, '');
  let h = salt + '|' + senha;
  for (let i = 0; i < 500; i++) h = hex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + senha, Utilities.Charset.UTF_8));
  return 'h:' + salt + ':' + h;
}
function confereSenha(senha, armazenado) {
  const p = String(armazenado).split(':');
  return p.length === 3 && hashSenha(senha, p[1]) === armazenado;
}
function segredo() {
  const props = PropertiesService.getScriptProperties();
  let s = props.getProperty('RZ_SEGREDO');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); props.setProperty('RZ_SEGREDO', s); }
  return s;
}
function assina(texto) { return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(texto, segredo())); }
function criaToken(u) {
  const corpo = Utilities.base64EncodeWebSafe(JSON.stringify({
    u: u.id, v: String(u.senha_hash).slice(-12), exp: Date.now() + SESSAO_DIAS * 864e5,
  }), Utilities.Charset.UTF_8);
  return corpo + '.' + assina(corpo);
}
function validaToken(token) {
  if (typeof token !== 'string' || token.indexOf('.') < 0) return null;
  const partes = token.split('.');
  if (partes[1] !== assina(partes[0])) return null;
  let d;
  try { d = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(partes[0])).getDataAsString('UTF-8')); } catch (e) { return null; }
  if (!d || d.exp < Date.now()) return null;
  const u = ler(ABAS.usu).find((x) => x.id === d.u);
  if (!u || String(u.senha_hash).slice(-12) !== d.v) return null;
  return publico(u);
}
const publico = (u) => ({ id: u.id, nome: u.nome, login: u.login, admin: ehSim(u.admin) });

function acaoSetup(req) {
  if (ler(ABAS.usu).length) throw erro('O sistema já foi configurado.');
  const u = novoUsuario(req, true);
  return { token: criaToken(u), usuario: publico(u) };
}
function acaoLogin(req) {
  const login = txt(req.login, 40).toLowerCase();
  const cache = CacheService.getScriptCache();
  const chave = 'login:' + login;
  const tentativas = Number(cache.get(chave) || 0);
  if (tentativas >= 10) throw erro('Muitas tentativas. Aguarde 15 minutos.');
  const u = ler(ABAS.usu).find((x) => String(x.login).toLowerCase() === login);
  if (!u || !confereSenha(String(req.senha || ''), u.senha_hash)) {
    cache.put(chave, String(tentativas + 1), 900);
    throw erro('Usuário ou senha incorretos.');
  }
  cache.remove(chave);
  return { token: criaToken(u), usuario: publico(u) };
}
function novoUsuario(req, admin) {
  const nome = txt(req.nome, 80), login = txt(req.login, 40), senha = String(req.senha || '');
  if (!nome || !login) throw erro('Informe nome e usuário.');
  if (senha.length < 6) throw erro('A senha precisa ter pelo menos 6 caracteres.');
  if (ler(ABAS.usu).some((x) => String(x.login).toLowerCase() === login.toLowerCase())) throw erro('Esse usuário já existe.');
  const u = { id: novoId('u'), nome, login, senha_hash: hashSenha(senha), admin: admin ? '1' : '0', criado_em: agora() };
  inserir(ABAS.usu, [u]);
  return u;
}
function acaoTrocarSenha(req, eu) {
  const u = ler(ABAS.usu).find((x) => x.id === eu.id);
  if (!confereSenha(String(req.atual || ''), u.senha_hash)) throw erro('Senha atual incorreta.');
  if (String(req.nova || '').length < 6) throw erro('A nova senha precisa ter pelo menos 6 caracteres.');
  u.senha_hash = hashSenha(String(req.nova));
  gravar(ABAS.usu, u);
  return { token: criaToken(u) };
}
function acaoUsuarios() {
  return { usuarios: ler(ABAS.usu).map((u) => Object.assign(publico(u), { criado_em: u.criado_em })) };
}
function acaoCriarUsuario(req) { novoUsuario(req, ehSim(req.admin)); return { ok: true }; }
function acaoSenhaUsuario(req) {
  const u = ler(ABAS.usu).find((x) => x.id === req.id);
  if (!u) throw erro('Usuário não encontrado.');
  if (String(req.senha || '').length < 6) throw erro('A senha precisa ter pelo menos 6 caracteres.');
  u.senha_hash = hashSenha(String(req.senha));
  gravar(ABAS.usu, u);
  return { ok: true };
}
function acaoExcluirUsuario(req, eu) {
  if (req.id === eu.id) throw erro('Você não pode excluir o próprio usuário.');
  const u = ler(ABAS.usu).find((x) => x.id === req.id);
  if (!u) throw erro('Usuário não encontrado.');
  aba(ABAS.usu).deleteRow(u._linha);
  return { ok: true };
}

// ───────────────────────── Respostas do formulário ─────────────────────────
function abaRespostas() {
  const s = SpreadsheetApp.getActive().getSheets()
    .find((x) => x.getName() !== ABA_MANUAL && /^carimbo/i.test(String(x.getRange(1, 1).getDisplayValue()).trim()));
  if (!s) throw erro('Não encontrei a aba de respostas do formulário (a primeira coluna deve ser "Carimbo de data/hora").');
  return s;
}
function parseData(s) {
  let m = String(s).match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return new Date(+m[1], m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).toISOString();
  m = String(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return new Date(+m[3], m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).toISOString();
  return '';
}
function corDe(linhaCores) {
  const c = linhaCores.slice(0, 3).find((x) => x && !/^#ffffff$/i.test(x));
  return c ? c.toLowerCase() : '';
}
function idsDrive(texto) {
  const ids = [];
  String(texto).replace(/(?:[?&]id=|\/d\/)([\w-]{10,})/g, (_, id) => { ids.push(id); return _; });
  return ids;
}

/** Lê a aba de respostas e devolve perguntas, campos reconhecidos, candidatos (com id estável) e a legenda de cores. */
function respostas() {
  const s = abaRespostas();
  const n = s.getLastRow(), m = s.getLastColumn();
  const rg = s.getRange(1, 1, n, m);
  const vals = rg.getValues(), disp = rg.getDisplayValues(), cores = rg.getBackgrounds();
  const perguntas = disp[0].map(normPergunta);
  const campos = detectaCampos(perguntas);
  const legenda = [], linhas = [], vistos = {};
  for (let i = 1; i < n; i++) {
    const d = disp[i], v = vals[i];
    const ehData = v[0] instanceof Date || /^\d{1,4}[\/-]\d{1,2}[\/-]\d{1,4}/.test(d[0]);
    const nome = campos.nome != null ? String(d[campos.nome]).trim() : '';
    if (!ehData || !nome) {
      const rotulo = String(d[0]).trim();
      if (rotulo && !ehData && d.slice(1).every((x) => !String(x).trim())) legenda.push({ texto: rotulo, cor: corDe(cores[i]) });
      continue;
    }
    const carimbo = v[0] instanceof Date ? v[0].toISOString() : parseData(d[0]);
    const cv = campos.curriculo != null ? d[campos.curriculo] : '';
    let id = idsDrive(cv)[0] || ('r' + hex(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, carimbo + '|' + nome, Utilities.Charset.UTF_8)).slice(0, 16));
    if (vistos[id]) id += '-' + (++vistos[id]); else vistos[id] = 1;
    linhas.push({ id, linha: i + 1, carimbo, respostas: d.map(String), cor: corDe(cores[i]) });
  }
  return { perguntas, campos, linhas: linhas.concat(linhasManuais(perguntas)), legenda };
}
const normPergunta = (p) => String(p).replace(/\s+/g, ' ').trim();
function detectaCampos(perguntas) {
  const campos = {};
  Object.keys(CAMPOS).forEach((k) => {
    const usados = Object.keys(campos).map((x) => campos[x]);
    const i = perguntas.findIndex((p, j) => CAMPOS[k].test(p) && usados.indexOf(j) < 0);
    if (i >= 0) campos[k] = i;
  });
  return campos;
}

/** Candidatos cadastrados à mão no sistema (aba "Cadastro manual"), alinhados às perguntas do formulário pelo texto do cabeçalho. */
function linhasManuais(perguntas) {
  const s = SpreadsheetApp.getActive().getSheetByName(ABA_MANUAL);
  if (!s || s.getLastRow() < 2) return [];
  const rg = s.getRange(1, 1, s.getLastRow(), s.getLastColumn());
  const disp = rg.getDisplayValues(), vals = rg.getValues();
  const cab = disp[0].map(normPergunta);
  const iId = cab.indexOf(COL_ID), iAutor = cab.indexOf(COL_AUTOR);
  const mapa = perguntas.map((p) => cab.indexOf(p));
  const out = [];
  for (let i = 1; i < disp.length; i++) {
    const id = iId >= 0 ? String(disp[i][iId]).trim() : '';
    if (!id) continue;
    const v0 = vals[i][0];
    out.push({
      id, linha: i + 1, cor: '', manual: true, autor: iAutor >= 0 ? disp[i][iAutor] : '',
      carimbo: v0 instanceof Date ? v0.toISOString() : parseData(disp[i][0]),
      respostas: mapa.map((j) => (j >= 0 ? String(disp[i][j]) : '')),
    });
  }
  return out;
}

function acaoCriarCandidato(req, u) {
  const ss = SpreadsheetApp.getActive();
  const principal = abaRespostas();
  const perguntas = principal.getRange(1, 1, 1, principal.getLastColumn()).getDisplayValues()[0].map(normPergunta);
  const campos = detectaCampos(perguntas);
  const dados = req.respostas || {};
  if (campos.nome == null || !txt(dados[perguntas[campos.nome]])) throw erro('Informe o nome do candidato.');

  let s = ss.getSheetByName(ABA_MANUAL);
  if (!s) {
    s = ss.insertSheet(ABA_MANUAL);
    const cab = perguntas.concat([COL_ID, COL_AUTOR]);
    s.getRange(1, 1, 1, cab.length).setValues([cab]).setFontWeight('bold');
    s.setFrozenRows(1);
  }
  // Se o formulário ganhou perguntas novas, acrescenta as colunas que faltam
  let cab = s.getRange(1, 1, 1, s.getLastColumn()).getDisplayValues()[0].map(normPergunta);
  const faltam = perguntas.concat([COL_ID, COL_AUTOR]).filter((p) => cab.indexOf(p) < 0);
  if (faltam.length) {
    s.getRange(1, cab.length + 1, 1, faltam.length).setValues([faltam]).setFontWeight('bold');
    cab = cab.concat(faltam);
  }

  const id = novoId('m');
  const linha = s.getLastRow() + 1;
  if (linha > s.getMaxRows()) s.insertRowsAfter(s.getMaxRows(), 1);
  s.getRange(linha, 2, 1, cab.length - 1).setNumberFormat('@');
  s.getRange(linha, 1, 1, cab.length).setValues([cab.map((h, j) => j === 0 ? new Date()
    : h === COL_ID ? id : h === COL_AUTOR ? u.nome : txt(dados[h], 5000))]);

  inserir(ABAS.cand, [{ id, status_id: statusPendente(listaStatus()).id, atualizado_em: agora() }]);
  return { id };
}

// ───────────────────────── Status ─────────────────────────
function listaStatus() {
  let l = ler(ABAS.status);
  if (!l.length) {
    inserir(ABAS.status, [['Pendente', '#f59e0b', 1, '1'], ['Entrevista', '#3b5bdb', 2, '0'], ['Contratado', '#16a34a', 3, '0'], ['Rejeitado', '#dc2626', 4, '0']]
      .map((s) => ({ id: novoId('s'), nome: s[0], cor: s[1], ordem: s[2], inicial: s[3] })));
    l = ler(ABAS.status);
  }
  l.forEach((s) => { s.ordem = Number(s.ordem) || 0; s.inicial = ehSim(s.inicial); });
  return l.sort((a, b) => a.ordem - b.ordem);
}
/** Status de entrada de todo candidato novo: sempre "Pendente" (ou o inicial, se o Pendente tiver sido renomeado). */
function statusPendente(status) {
  return status.find((s) => String(s.nome).trim().toLowerCase() === 'pendente') || status.find((s) => s.inicial) || status[0];
}
function escurece(cor) {
  const n = parseInt(cor.slice(1), 16);
  let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  if (0.299 * r + 0.587 * g + 0.114 * b < 170) return cor;
  r = Math.round(r * 0.55); g = Math.round(g * 0.55); b = Math.round(b * 0.55);
  return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
}
/** Na primeira importação, linhas pintadas com a cor de um item da legenda da planilha recebem o status correspondente. */
function statusDaLegenda(rotulo, cor, status) {
  const alvo = /descart|reprov|rejeit/i.test(rotulo) ? 'Rejeitado'
    : rotulo.charAt(0).toUpperCase() + rotulo.slice(1).toLowerCase();
  let s = status.find((x) => String(x.nome).toLowerCase() === alvo.toLowerCase());
  if (!s) {
    s = { id: novoId('s'), nome: alvo, cor: /^#[0-9a-f]{6}$/i.test(cor) ? escurece(cor) : '#64748b', ordem: status.length + 1, inicial: '0' };
    inserir(ABAS.status, [s]);
    s.inicial = false;
    status.push(s);
  }
  return s;
}

function acaoDados(req, usuario) {
  const r = respostas();
  const status = listaStatus();
  const inicial = statusPendente(status).id;
  const estados = {};
  ler(ABAS.cand).forEach((e) => { estados[e.id] = e; });
  // As cores da legenda da planilha só valem na primeira importação; depois, todo novo candidato entra como Pendente
  const primeiraImportacao = Object.keys(estados).length === 0;
  const porCor = {};
  r.legenda.forEach((l) => { if (l.cor && !porCor[l.cor]) porCor[l.cor] = l.texto; });

  const novos = [];
  const candidatos = r.linhas.map((l) => {
    let e = estados[l.id];
    if (!e) {
      const st = primeiraImportacao && l.cor && porCor[l.cor] ? statusDaLegenda(porCor[l.cor], l.cor, status).id : inicial;
      e = { id: l.id, status_id: st, atualizado_em: l.carimbo || agora() };
      novos.push(e);
      estados[l.id] = e;
    }
    const valido = status.some((s) => s.id === e.status_id);
    return { id: l.id, linha: l.linha, carimbo: l.carimbo, respostas: l.respostas, status_id: valido ? e.status_id : inicial, atualizado_em: e.atualizado_em,
      manual: !!l.manual, autor: l.autor || '', ordem: e.ordem || '' };
  });
  inserir(ABAS.cand, novos);

  return {
    usuario,
    perguntas: r.perguntas,
    campos: r.campos,
    status,
    candidatos,
    historico: ler(ABAS.hist).map((h) => { delete h._linha; return h; }),
    planilhaUrl: SpreadsheetApp.getActive().getUrl(),
    assinatura: assinatura(),
  };
}

function registra(candidatoId, autor, tipo, texto) {
  const h = { id: novoId('h'), candidato_id: candidatoId, autor, tipo, texto, criado_em: agora() };
  inserir(ABAS.hist, [h]);
  return h;
}

function acaoMudarStatus(req, u) {
  const status = listaStatus();
  const novo = status.find((s) => s.id === req.status_id);
  if (!novo) throw erro('Status inválido.');
  const e = ler(ABAS.cand).find((x) => x.id === req.id);
  if (!e) throw erro('Candidato não encontrado. Clique em Atualizar.');
  if (e.status_id === novo.id) return { ok: true };
  const anterior = status.find((s) => s.id === e.status_id);
  e.status_id = novo.id;
  e.atualizado_em = agora();
  e.ordem = ''; // ao trocar de coluna, o card vai para o topo da nova coluna
  gravar(ABAS.cand, e);
  const h = registra(e.id, u.nome, 'status', 'Status alterado de "' + (anterior ? anterior.nome : '—') + '" para "' + novo.nome + '".');
  return { historico: h, atualizado_em: e.atualizado_em };
}

/** Grava a posição manual dos cards (ids na ordem desejada) numa única escrita. */
function acaoOrdenarCards(req) {
  const ids = Array.isArray(req.ids) ? req.ids.map(String) : [];
  const s = aba(ABAS.cand);
  const n = s.getLastRow();
  if (n < 2 || !ids.length) return { ok: true };
  const col = ABAS.cand.cab.indexOf('ordem') + 1;
  const pos = {};
  ids.forEach((id, i) => { pos[id] = i + 1; });
  const idsPlanilha = s.getRange(2, 1, n - 1, 1).getValues().map((r) => String(r[0]));
  const atual = s.getRange(2, col, n - 1, 1).getValues();
  s.getRange(1, col).setValue('ordem').setFontWeight('bold');
  s.getRange(2, col, n - 1, 1).setNumberFormat('@')
    .setValues(idsPlanilha.map((id, i) => [pos[id] != null ? String(pos[id]) : atual[i][0]]));
  return { ok: true };
}

function acaoNota(req, u) {
  const texto = txt(req.texto, 5000);
  if (!texto) throw erro('Escreva a anotação.');
  if (!ler(ABAS.cand).some((x) => x.id === req.id)) throw erro('Candidato não encontrado. Clique em Atualizar.');
  return { historico: registra(req.id, u.nome, 'nota', texto) };
}

function acaoSalvarStatus(req) {
  const status = listaStatus();
  const nome = txt(req.nome, 40);
  const cor = /^#[0-9a-fA-F]{6}$/.test(req.cor) ? req.cor : '#64748b';
  if (!nome) throw erro('Informe o nome do status.');
  if (status.some((s) => s.id !== req.id && String(s.nome).toLowerCase() === nome.toLowerCase())) throw erro('Já existe um status com esse nome.');
  if (!req.id) {
    inserir(ABAS.status, [{ id: novoId('s'), nome, cor, ordem: status.length + 1, inicial: '0' }]);
    return { ok: true };
  }
  const s = status.find((x) => x.id === req.id);
  if (!s) throw erro('Status não encontrado.');
  status.forEach((x) => {
    const inicial = req.inicial ? x.id === s.id : x.inicial;
    if (x === s || inicial !== x.inicial) {
      if (x === s) { x.nome = nome; x.cor = cor; }
      x.inicial = inicial ? '1' : '0';
      gravar(ABAS.status, x);
    }
  });
  return { ok: true };
}
function acaoOrdenarStatus(req) {
  const ids = Array.isArray(req.ids) ? req.ids : [];
  listaStatus().forEach((s) => {
    const i = ids.indexOf(s.id);
    if (i >= 0 && s.ordem !== i + 1) { s.ordem = i + 1; s.inicial = s.inicial ? '1' : '0'; gravar(ABAS.status, s); }
  });
  return { ok: true };
}
function acaoExcluirStatus(req) {
  const status = listaStatus();
  const s = status.find((x) => x.id === req.id);
  if (!s) throw erro('Status não encontrado.');
  if (s.inicial || s.id === statusPendente(status).id) throw erro('Este é o status de entrada dos novos candidatos e não pode ser excluído.');
  const n = ler(ABAS.cand).filter((x) => x.status_id === s.id).length;
  if (n) throw erro('Há ' + n + ' candidato(s) com este status. Mova-os antes de excluir.');
  aba(ABAS.status).deleteRow(s._linha);
  return { ok: true };
}

// ───────────────────────── Novidades ─────────────────────────
/** Checagem leve para o site saber se chegou resposta nova ou se alguém mudou status/anotações. */
function assinatura() {
  const manual = SpreadsheetApp.getActive().getSheetByName(ABA_MANUAL);
  return [abaRespostas().getLastRow(), manual ? manual.getLastRow() : 0, aba(ABAS.hist).getLastRow()].join('.');
}
function acaoNovidades() { return { assinatura: assinatura() }; }

// ───────────────────────── Currículo ─────────────────────────
function acaoCurriculo(req) {
  const r = respostas();
  const l = r.linhas.find((x) => x.id === req.id);
  if (!l || r.campos.curriculo == null) throw erro('Candidato não encontrado.');
  const fid = idsDrive(l.respostas[r.campos.curriculo])[0];
  if (!fid) throw erro('Este candidato não anexou currículo.');
  const url = 'https://drive.google.com/file/d/' + fid + '/view';
  let arquivo;
  try { arquivo = DriveApp.getFileById(fid); } catch (e) { throw erro('Não foi possível abrir o arquivo no Google Drive (ele pode ter sido excluído).'); }
  const base = { nome: arquivo.getName(), url };
  if (arquivo.getSize() > MAX_CV_BYTES) return Object.assign(base, { grande: true });
  const blob = arquivo.getBlob();
  return Object.assign(base, { tipo: blob.getContentType(), dados: Utilities.base64Encode(blob.getBytes()) });
}
