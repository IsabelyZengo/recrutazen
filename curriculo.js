// Leitura de currículos no navegador: extrai o texto (PDF, Word ou imagem) e tenta reconhecer os dados do candidato.
// As bibliotecas só são baixadas quando alguém envia um currículo.

const LIBS_CV = {
  pdf: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  pdfWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  mammoth: 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js',
  tesseract: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
};
const scriptsCarregados = {};
function carregaScript(url) {
  scriptsCarregados[url] ||= new Promise((ok, falha) => {
    const s = document.createElement('script');
    s.src = url;
    s.onload = ok;
    s.onerror = () => falha(new Error('Não foi possível carregar o leitor de currículos. Verifique a internet.'));
    document.head.append(s);
  });
  return scriptsCarregados[url];
}

async function ocr(imagem, progresso) {
  await carregaScript(LIBS_CV.tesseract);
  progresso?.('Lendo a imagem (reconhecimento de texto)… pode levar alguns segundos');
  const { data } = await window.Tesseract.recognize(imagem, 'por');
  return data.text || '';
}

/** Devolve o texto do currículo. `progresso(msg)` recebe mensagens de andamento. */
async function extrairTextoCurriculo(arquivo, progresso) {
  const ext = arquivo.name.split('.').pop().toLowerCase();
  if (ext === 'pdf') {
    await carregaScript(LIBS_CV.pdf);
    const pdfjs = window.pdfjsLib;
    pdfjs.GlobalWorkerOptions.workerSrc = LIBS_CV.pdfWorker;
    progresso?.('Lendo o PDF…');
    const doc = await pdfjs.getDocument({ data: await arquivo.arrayBuffer() }).promise;
    let texto = '';
    for (let p = 1; p <= Math.min(doc.numPages, 6); p++) {
      const pag = await doc.getPage(p);
      const conteudo = await pag.getTextContent();
      // Reagrupa os pedaços de texto em linhas pela posição vertical
      let ultimoY = null;
      for (const item of conteudo.items) {
        const y = Math.round(item.transform[5]);
        if (ultimoY !== null && Math.abs(y - ultimoY) > 2) texto += '\n';
        else if (ultimoY !== null && !texto.endsWith(' ')) texto += ' ';
        texto += item.str;
        ultimoY = y;
      }
      texto += '\n';
    }
    if (texto.replace(/\s/g, '').length > 80) return texto;
    // PDF escaneado (sem texto): renderiza as primeiras páginas e usa OCR
    let lido = '';
    for (let p = 1; p <= Math.min(doc.numPages, 2); p++) {
      const pag = await doc.getPage(p);
      const vp = pag.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      canvas.width = vp.width; canvas.height = vp.height;
      await pag.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      lido += (await ocr(canvas, progresso)) + '\n';
    }
    return lido;
  }
  if (ext === 'docx') {
    await carregaScript(LIBS_CV.mammoth);
    progresso?.('Lendo o documento Word…');
    const r = await window.mammoth.extractRawText({ arrayBuffer: await arquivo.arrayBuffer() });
    return r.value || '';
  }
  if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) return ocr(arquivo, progresso);
  return ''; // .doc antigo e outros: só anexa, sem leitura
}

// ───────────── Interpretação do texto ─────────────
const TITULOS_CV = [
  ['objetivo', /^(objetivos?|objetivo profissional|cargo pretendido|pretens[ãa]o)\b/i],
  ['experiencia', /^(experi[êe]ncias?( profissionais?)?|hist[óo]rico profissional|atua[çc][ãa]o profissional|[úu]ltimos empregos)\b/i],
  ['formacao', /^(forma[çc][ãa]o( acad[êe]mica| escolar)?|escolaridade|educa[çc][ãa]o)\b/i],
  ['cursos', /^(cursos?( complementares| extracurriculares| e qualifica[çc][õo]es| profissionalizantes)?|qualifica[çc][õo]es|certifica[çc][õo]es|capacita[çc][õo]es)\b/i],
  ['habilidades', /^(habilidades|compet[êe]ncias|conhecimentos|resumo de qualifica[çc][õo]es|perfil( profissional)?|resumo)\b/i],
  ['outros', /^(idiomas|informa[çc][õo]es (adicionais|complementares)|refer[êe]ncias|dados pessoais|atividades|disponibilidade)\b/i],
];
const AREAS_CV = [
  ['Costura', /costur|overloque|galoneira|reta industrial|facç/i],
  ['Auxiliar de produção', /auxiliar de produ|produ[çc][ãa]o|linha de produ/i],
  ['Operador de máquina', /operador(a)? de m[áa]quina/i],
  ['Vendas', /vend(as|edor)|atendimento ao cliente|comercial/i],
  ['Auxiliar de limpeza', /limpeza|servi[çc]os gerais|zelador/i],
  ['Estoque', /estoqu|almoxarif/i],
  ['Expedição', /expedi[çc]/i],
  ['Administrativo', /administrativ|recep[çc]|escrit[óo]rio|financeir/i],
  ['Corte', /\bcorte\b|cortador/i],
];

function secoesCurriculo(linhas) {
  const secoes = {};
  let atual = 'topo';
  for (const l of linhas) {
    const limpa = l.replace(/[:•\-–—_*]+$/, '').trim();
    const titulo = limpa.length <= 45 && TITULOS_CV.find(([, re]) => re.test(limpa));
    if (titulo) { atual = titulo[0]; continue; }
    (secoes[atual] ||= []).push(l);
  }
  return secoes;
}

const capitalizaNome = (s) => s.toLowerCase().replace(/(^|\s)(\p{L})/gu, (m, a, b) => a + b.toUpperCase())
  .replace(/\s(D[aeo]s?|E)\s/g, (m) => m.toLowerCase());

/** Tenta reconhecer os dados do candidato no texto do currículo. Só devolve o que encontrar. */
function interpretarCurriculo(texto) {
  const t = String(texto).replace(/\r/g, '').replace(/[ \t ]+/g, ' ');
  const linhas = t.split('\n').map((l) => l.trim()).filter(Boolean);
  const secoes = secoesCurriculo(linhas);
  const r = {};

  // Nome: primeira linha "com cara de nome" (2 a 6 palavras, só letras)
  const nome = linhas.slice(0, 12).find((l) => /^[\p{L}' .]{5,60}$/u.test(l)
    && l.split(/\s+/).length >= 2 && l.split(/\s+/).length <= 6 && !/curr[íi]culo|vitae|resumo|dados|pessoais/i.test(l));
  if (nome) r.nome = capitalizaNome(nome.replace(/^nome\s*:?\s*/i, ''));
  const nomeRot = t.match(/nome( completo)?\s*:\s*([\p{L}' ]{5,60})/iu);
  if (nomeRot) r.nome = capitalizaNome(nomeRot[2].trim());

  const tel = t.match(/\(?\b(\d{2})\)?[\s.-]*(9?\s?\d{4})[\s.-]?(\d{4})\b/);
  if (tel) r.telefone = `(${tel[1]}) ${tel[2].replace(/\s/g, '')}-${tel[3]}`;

  const email = t.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
  if (email) r.email = email[0];

  const nasc = t.match(/(?:nascimento|nasc\.?|nascid[oa] em|d\.?\s?n\.?)\s*:?\s*(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4})/i);
  if (nasc) r.nascimento = nasc[1].replace(/[.-]/g, '/');

  const idade = t.match(/\b(\d{2})\s*anos\b/i);
  if (idade && +idade[1] >= 14 && +idade[1] <= 80) r.idade = idade[1];
  else if (r.nascimento) {
    const [d, m, a0] = r.nascimento.split('/').map(Number);
    const a = a0 < 100 ? a0 + (a0 > 30 ? 1900 : 2000) : a0;
    const hoje = new Date();
    let i = hoje.getFullYear() - a;
    if (hoje.getMonth() + 1 < m || (hoje.getMonth() + 1 === m && hoje.getDate() < d)) i--;
    if (i >= 14 && i <= 80) r.idade = String(i);
  }

  const civil = t.match(/\b(solteir[oa]|casad[oa]|divorciad[oa]|separad[oa]|vi[úu]v[oa]|uni[ãa]o est[áa]vel|amasiad[oa])\b/i);
  if (civil) r.estadoCivil = civil[1].charAt(0).toUpperCase() + civil[1].slice(1).toLowerCase();

  // Bairro / cidade: rótulos "Bairro:", "Cidade:", "Endereço:" ou uma linha de endereço com UF
  const bairro = t.match(/bairro\s*:?\s*([^\n,;]{3,40})/i)?.[1]?.trim();
  const cidade = t.match(/cidade\s*:?\s*([^\n,;]{3,40})/i)?.[1]?.trim();
  const end = linhas.find((l) => /\b(rua|r\.|av\.?|avenida|travessa|alameda|rodovia)\s/i.test(l) || /[-–/]\s?(PR|SC|SP|RS|MG|RJ)\b/.test(l));
  if (bairro || cidade) r.local = [bairro, cidade].filter(Boolean).join(', ');
  else if (end) r.local = end.replace(/^(endere[çc]o|end\.?)\s*:?\s*/i, '').slice(0, 120);

  const esc = t.match(/(ensino\s+(fundamental|m[ée]dio|superior|t[ée]cnico)(\s+(completo|incompleto|cursando|em andamento))?|superior\s+(completo|incompleto|cursando)|t[ée]cnico\s+em\s+[^\n,;]{3,40}|gradua[çc][ãa]o\s+em\s+[^\n,;]{3,40}|p[óo]s[- ]gradua[çc][ãa]o[^\n,;]{0,40})/i);
  if (esc) r.escolaridade = esc[0].charAt(0).toUpperCase() + esc[0].slice(1);
  else if (secoes.formacao?.length) r.escolaridade = secoes.formacao.slice(0, 2).join(' — ').slice(0, 150);

  const bloco = (k, max) => secoes[k]?.length ? secoes[k].join('\n').slice(0, max) : '';
  if (bloco('cursos', 1500)) r.cursos = bloco('cursos', 1500);
  if (bloco('experiencia', 3000)) r.experiencia = bloco('experiencia', 3000);
  if (bloco('habilidades', 1500)) r.habilidades = bloco('habilidades', 1500);

  // Áreas: pelo objetivo (ou, sem objetivo, pelo texto todo)
  const base = bloco('objetivo', 400) || t;
  const areas = AREAS_CV.filter(([, re]) => re.test(base)).map(([n]) => n);
  if (areas.length) r.areas = areas.slice(0, 4).join(', ');
  return r;
}
