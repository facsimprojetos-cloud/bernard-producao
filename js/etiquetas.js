// Etiquetas dos pacotes: QR com o código (só o código) + nome do item + qtd + elástico.
import { db } from './estado.js';
import { h, num, ler, modal, toast, qrSvg, imprimirHtml, nomeArquivo, cadastros } from './util.js';

// Medidas em mm. "folha" = folha de acompanhamento da caixa (igual à FOLHA DE IMPRESSÃO do AppSheet):
// 6 por A4 (2×3), com QR, dados do pacote e a lista de processos para assinar (nome e data).
// As demais: etiquetas adesivas Pimaco/Avery e térmicas.
export const LAYOUTS = {
  folha: { nome: 'Folha de acompanhamento da caixa (6 por A4, com processos para assinar)', acompanhamento: true },
  a4_21: { nome: 'A4 · 21 por folha (3×7, 63,5×38,1 mm · Pimaco A4360 / Avery L7160)', folha: true, col: 3, lin: 7, w: 63.5, h: 38.1, top: 15.15, left: 7.21, gx: 2.54, gy: 0 },
  a4_14: { nome: 'A4 · 14 por folha (2×7, 99,1×38,1 mm · Pimaco A4362 / Avery L7163)', folha: true, col: 2, lin: 7, w: 99.1, h: 38.1, top: 15.15, left: 4.65, gx: 2.5, gy: 0 },
  a4_24: { nome: 'A4 · 24 por folha (3×8, 70×37 mm, sem margem)', folha: true, col: 3, lin: 8, w: 70, h: 37, top: 0.5, left: 0, gx: 0, gy: 0 },
  t_100x50: { nome: 'Térmica 100×50 mm', folha: false, w: 100, h: 50 },
  t_100x150: { nome: 'Térmica 100×150 mm (grande)', folha: false, w: 100, h: 150, grande: true },
};
const CHAVE = 'bernard.etiquetas.v2';
function prefs() { try { return JSON.parse(localStorage.getItem(CHAVE)) || {}; } catch (_) { return {}; } }
function salvarPrefs(p) { try { localStorage.setItem(CHAVE, JSON.stringify(p)); } catch (_) { /* sem armazenamento */ } }

function etiqueta(it, L) {
  const qr = L.grande ? 70 : Math.min(L.h - 7, L.w * 0.42, 32);
  const cor = `${it.cor}${it.tonalidade ? ' ' + it.tonalidade : ''}`;
  return `<div class="etq-b" style="width:${L.w}mm;height:${L.h}mm">
    <div class="qr"><div style="width:${qr}mm;height:${qr}mm">${qrSvg(it.codigo)}</div><div class="cod">${h(it.codigo)}</div></div>
    <div class="txt">
      <div class="n1">${h(it.numero)}${it.sequencia > 1 ? '/' + h(it.sequencia) : ''} · ${h(it.tipo_risco || '')}</div>
      <div class="n1">${h(cor)} · ${h(it.tamanho)}</div>
      <div class="n2">${h([it.produto, it.tecido].filter(Boolean).join(' · '))}</div>
      ${it.elastico ? `<div class="n3">Elástico: ${h(it.elastico)}</div>` : ''}
      <div class="q">${num(it.qtd)} <small>peças</small></div>
    </div></div>`;
}

// Nome do corte como na folha antiga: "542 INTEIRO-VINHO 2-M"
const corDe = (it) => `${it.cor || ''}${it.tonalidade ? ' ' + it.tonalidade : ''}`;
const nomeCorte = (it) => `${it.numero}${it.sequencia > 1 ? '/' + it.sequencia : ''}${it.tipo_risco ? ' ' + String(it.tipo_risco).toUpperCase() : ''}`;

function folhaAcompanhamento(it, processos) {
  const lin = processos.length + 4;
  return `<div class="fa-card"><table class="fa">
    <colgroup><col style="width:19mm"><col style="width:27mm"><col><col style="width:11mm"><col style="width:21mm"></colgroup>
    <tr><td class="fa-qr" rowspan="${lin}"><div class="fa-qr-img">${qrSvg(it.codigo)}</div><div class="fa-cod">${h(it.codigo)}</div></td>
      <th>CORTE</th><td class="v nome">${h(`${nomeCorte(it)}-${corDe(it)}-${it.tamanho}`)}</td><th>QTD:</th><td class="v">${num(it.qtd)}</td></tr>
    <tr><th>TAM</th><td class="v">${h(it.tamanho)}</td><th>COR:</th><td class="v nome">${h(corDe(it))}</td></tr>
    <tr><th>ELÁSTICO</th><td class="v" colspan="3">${h(it.elastico || '')}</td></tr>
    <tr class="fa-cab"><th>PROCESSO</th><th colspan="2">NOME</th><th>DATA</th></tr>
    ${processos.map(p => `<tr class="fa-p"><td class="pn">${h(String(p).toUpperCase())}</td><td colspan="2"></td><td></td></tr>`).join('')}
  </table></div>`;
}

export function htmlEtiquetas(itens, { layout = 'folha', inicio = 1, copias = 1, guias = false, processos = [] } = {}) {
  const L = LAYOUTS[layout] || LAYOUTS.folha;
  const lista = itens.flatMap(it => Array.from({ length: Math.max(1, copias) }, () => it));
  if (L.acompanhamento) {
    const vagas = [...Array(Math.max(0, Math.min(inicio - 1, 5))).fill(null), ...lista];
    const folhas = [];
    for (let i = 0; i < vagas.length; i += 6) folhas.push(vagas.slice(i, i + 6));
    return `<style>@page{size:A4;margin:0}</style>` + folhas.map(f => `<div class="folha-fa ${guias ? 'guia' : ''}">${
      f.map(it => it ? folhaAcompanhamento(it, processos) : '<div class="fa-card vazio"></div>').join('')}</div>`).join('');
  }
  if (!L.folha) {
    return `<style>@page{size:${L.w}mm ${L.h}mm;margin:0}</style>` + lista.map(it =>
      `<div class="etq-term ${L.grande ? 'grande' : ''}" style="width:${L.w}mm;height:${L.h}mm">${etiqueta(it, L)}</div>`).join('');
  }
  const porFolha = L.col * L.lin;
  const vagas = [...Array(Math.max(0, Math.min(inicio - 1, porFolha - 1))).fill(null), ...lista];
  const folhas = [];
  for (let i = 0; i < vagas.length; i += porFolha) folhas.push(vagas.slice(i, i + porFolha));
  const estilo = `padding:${L.top}mm 0 0 ${L.left}mm;grid-template-columns:repeat(${L.col},${L.w}mm);grid-auto-rows:${L.h}mm;column-gap:${L.gx}mm;row-gap:${L.gy}mm`;
  return `<style>@page{size:A4;margin:0}</style>` + folhas.map(f => `<div class="folha-etq ${guias ? 'guia' : ''}" style="${estilo}">${
    f.map(it => it ? etiqueta(it, L) : `<div class="etq-b" style="width:${L.w}mm;height:${L.h}mm"></div>`).join('')}</div>`).join('');
}

// Busca os itens do corte (ou só os ids informados) já com o nome da etiqueta
export async function itensParaEtiqueta(corteId, ids = null) {
  const cad = await cadastros(db);
  const ordemTam = Object.fromEntries(cad.tamanhos.map(t => [t.nome, t.ordem]));
  let q = db.from('v_corte_itens').select('*').eq('corte_id', corteId);
  if (ids) q = q.in('id', ids);
  const lista = await ler(q);
  return lista.sort((a, b) => String(a.cor).localeCompare(String(b.cor)) || (a.tonalidade || 0) - (b.tonalidade || 0)
    || (ordemTam[a.tamanho] ?? 99) - (ordemTam[b.tamanho] ?? 99));
}

// Processos da folha: roteiro do produto + tecido do corte, na ordem da sequência (Meio primeiro ... Tag)
export async function processosDoCorte(corteId) {
  const [c] = await ler(db.from('cortes').select('produto_id,tecido_id').eq('id', corteId));
  if (!c) return [];
  let q = db.from('produto_processos').select('sequencia, processos(nome)').eq('produto_id', c.produto_id);
  q = c.tecido_id ? q.eq('tecido_id', c.tecido_id) : q.is('tecido_id', null);
  const rot = await ler(q);
  let lista = rot.sort((a, b) => (a.sequencia ?? 999) - (b.sequencia ?? 999) || String(a.processos?.nome).localeCompare(String(b.processos?.nome)))
    .map(r => r.processos?.nome).filter(Boolean);
  if (!lista.length) {
    const cad = await cadastros(db);
    lista = cad.processos.filter(p => p.ativo !== false).map(p => p.nome);
  }
  return lista;
}

export async function abrirEtiquetas(corteId) {
  const [itens, processos] = await Promise.all([itensParaEtiqueta(corteId), processosDoCorte(corteId)]);
  if (!itens.length) return toast('Este corte não tem linhas.', 'erro');
  const p = { layout: 'folha', copias: 1, ...prefs() };
  const c0 = itens[0];
  modal({
    titulo: `Etiquetas · corte ${c0.numero}${c0.sequencia > 1 ? '/' + c0.sequencia : ''} · ${c0.tipo_risco || ''}`,
    largo: true,
    corpo: `<div class="grade g4">
        <label class="campo" style="grid-column:span 2">Modelo<select id="e-lay">${Object.entries(LAYOUTS).map(([k, L]) => `<option value="${k}" ${k === p.layout ? 'selected' : ''}>${h(L.nome)}</option>`).join('')}</select></label>
        <label class="campo" id="lb-ini">Começar na posição<input type="number" id="e-ini" min="1" value="1"></label>
        <label class="campo">Cópias por pacote<input type="number" id="e-cop" min="1" max="10" value="${h(p.copias)}"></label>
      </div>
      <label style="display:block;margin:8px 0"><input type="checkbox" id="e-guia"> Imprimir contorno (para testar o alinhamento numa folha comum)</label>
      <div class="peq muted" style="margin:4px 0">Desmarque as linhas que não quer imprimir. A posição inicial serve para reaproveitar folha já usada (conta da esquerda para a direita, de cima para baixo).</div>
      <div class="tabela-wrap" style="max-height:260px;overflow:auto"><table>
        <thead><tr><th><input type="checkbox" id="e-todos" checked></th><th>Código</th><th>Etiqueta</th><th class="n">Qtd</th><th>Elástico</th></tr></thead>
        <tbody>${itens.map(it => `<tr><td><input type="checkbox" data-it="${it.id}" checked></td><td>${h(it.codigo)}</td><td>${h(it.nome_exibicao)}</td><td class="n">${num(it.qtd)}</td><td>${h(it.elastico || '')}</td></tr>`).join('')}</tbody>
      </table></div>
      <div id="e-info" class="peq forte" style="margin-top:8px"></div>`,
    botoes: [{ texto: 'Fechar' }, {
      texto: 'Imprimir', classe: 'pri', fecha: false, acao: (m) => {
        const o = opcoes(m);
        const sel = itens.filter(it => m.querySelector(`[data-it="${it.id}"]`).checked);
        if (!sel.length) { toast('Marque ao menos uma linha.', 'erro'); return false; }
        if (!window.qrcode) { toast('O gerador de QR ainda está carregando. Tente de novo.', 'erro'); return false; }
        salvarPrefs({ layout: o.layout, copias: o.copias });
        imprimirHtml(htmlEtiquetas(sel, { ...o, processos }), nomeArquivo(['Folhas corte', c0.numero, c0.tipo_risco]));
        return false;
      }
    }],
    aoAbrir: (m) => {
      const atualizar = () => {
        const o = opcoes(m), L = LAYOUTS[o.layout];
        m.querySelector('#lb-ini').style.display = (L.folha || L.acompanhamento) ? '' : 'none';
        const n = itens.filter(it => m.querySelector(`[data-it="${it.id}"]`).checked).length * o.copias;
        const porFolha = L.acompanhamento ? 6 : (L.col || 1) * (L.lin || 1);
        const folhas = (L.folha || L.acompanhamento) ? Math.ceil((n + o.inicio - 1) / porFolha) : n;
        m.querySelector('#e-info').textContent = `${n} ${L.acompanhamento ? 'cartão(ões)' : 'etiqueta(s)'} · ${folhas} ${(L.folha || L.acompanhamento) ? 'folha(s) A4' : 'etiqueta(s) térmica(s)'}`
          + (L.acompanhamento ? ` · processos: ${processos.join(', ')}` : '');
      };
      m.querySelectorAll('input,select').forEach(i => i.addEventListener('change', atualizar));
      m.querySelector('#e-todos').onchange = (e) => { m.querySelectorAll('[data-it]').forEach(c => { c.checked = e.target.checked; }); atualizar(); };
      atualizar();
    }
  });
}

function opcoes(m) {
  return {
    layout: m.querySelector('#e-lay').value,
    inicio: Math.max(1, Math.trunc(Number(m.querySelector('#e-ini').value) || 1)),
    copias: Math.min(10, Math.max(1, Math.trunc(Number(m.querySelector('#e-cop').value) || 1))),
    guias: m.querySelector('#e-guia').checked,
  };
}
