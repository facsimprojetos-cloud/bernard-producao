import { db, tem } from '../estado.js';
import { h, num, chip, toast, msgErro, hojeISO, data, modal } from '../util.js';

// Painel (Gestão, só admin): produção (peças embaladas = último processo), minutos, eficiência pela jornada,
// corte do período (finalizado / em produção / parado) e conferência corte × lançamentos por processo.
const st = { periodo: 'mes', ini: null, fim: null, diasParado: 5, filtroCorte: 'parado', aba: null };
const STATUS = {
  finalizado: { nome: 'Finalizado', cor: 'var(--ok)', chip: 'ok' },
  em_producao: { nome: 'Em produção', cor: 'var(--info)', chip: 'info' },
  parado: { nome: 'Parado', cor: 'var(--alerta)', chip: 'alerta' },
};

function iso(d) { return d.toLocaleDateString('en-CA'); }
function intervalo(p) {
  const hoje = new Date(hojeISO() + 'T12:00:00'), d = new Date(hoje);
  const seg = (x) => { const y = new Date(x); y.setDate(y.getDate() - ((y.getDay() + 6) % 7)); return y; };
  switch (p) {
    case 'hoje': return [iso(hoje), iso(hoje)];
    case 'ontem': d.setDate(d.getDate() - 1); return [iso(d), iso(d)];
    case 'semana': return [iso(seg(hoje)), iso(hoje)];
    case 'semana_ant': { const s = seg(hoje); s.setDate(s.getDate() - 7); const f = new Date(s); f.setDate(f.getDate() + 6); return [iso(s), iso(f)]; }
    case 'mes': return [iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1, 12)), iso(hoje)];
    case 'mes_ant': return [iso(new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1, 12)), iso(new Date(hoje.getFullYear(), hoje.getMonth(), 0, 12))];
    case '30': d.setDate(d.getDate() - 29); return [iso(d), iso(hoje)];
    default: return [st.ini, st.fim];
  }
}

const ABAS = [['resumo', 'Resumo'], ['operadores', 'Por operador'], ['processos', 'Por processo'], ['cortes', 'Cortes'], ['fechamento', 'Fechamento por dia'], ['mensal', 'Fechamento mensal']];
let cacheDados = { chave: null, d: null };

export async function render(el) {
  const admin = tem('admin');
  if (!admin && !['fechamento', 'mensal'].includes(st.aba)) st.aba = 'fechamento';
  if (!st.aba) st.aba = 'resumo';
  if (!st.ini) [st.ini, st.fim] = intervalo(st.periodo);
  const opt = (v, n) => `<option value="${v}" ${st.periodo === v ? 'selected' : ''}>${n}</option>`;
  const fech = st.aba === 'fechamento' || st.aba === 'mensal';
  el.innerHTML = `
    <div class="cab"><div><h1>Painel</h1><p>Produção, corte, conferência dos apontamentos e fechamento. Peças produzidas = peças apontadas na Embalagem.</p></div></div>
    ${fech ? '' : `<div class="filtros">
      <div class="campo"><label>Período</label><select id="per">${opt('hoje', 'Hoje')}${opt('ontem', 'Ontem')}${opt('semana', 'Esta semana')}${opt('semana_ant', 'Semana passada')}${opt('mes', 'Este mês')}${opt('mes_ant', 'Mês passado')}${opt('30', 'Últimos 30 dias')}${opt('outro', 'Escolher datas')}</select></div>
      <div class="campo"><label>De</label><input type="date" id="ini" value="${h(st.ini)}"></div>
      <div class="campo"><label>Até</label><input type="date" id="fim" value="${h(st.fim)}"></div>
      <div class="campo" style="max-width:170px"><label title="Pacote sem nenhum apontamento há esse número de dias (ou desde o corte) conta como parado">Parado: sem apontar há (dias)</label><input type="number" id="dp" min="1" max="60" value="${st.diasParado}"></div>
    </div>`}
    <div class="abas" id="abas-painel">${ABAS.filter(([k]) => admin || k === 'fechamento' || k === 'mensal').map(([k, n]) => `<button type="button" data-aba="${k}" class="${k === st.aba ? 'ativo' : ''}">${n}</button>`).join('')}</div>
    <div id="res"><p class="muted">Carregando…</p></div>`;
  el.querySelectorAll('[data-aba]').forEach(b => b.onclick = () => { st.aba = b.dataset.aba; render(el); });
  const box = el.querySelector('#res');
  if (fech) {
    const m = await import(`./fechamento.js?v=${document.querySelector('script[type=module]')?.src.split('v=')[1] || ''}`);
    return m.render(box, { embutido: true, modo: st.aba === 'mensal' ? 'mes' : 'dia' });
  }
  el.querySelector('#per').onchange = (e) => { st.periodo = e.target.value; if (st.periodo !== 'outro') [st.ini, st.fim] = intervalo(st.periodo); render(el); };
  const datas = () => { st.periodo = 'outro'; st.ini = el.querySelector('#ini').value; st.fim = el.querySelector('#fim').value; render(el); };
  el.querySelector('#ini').onchange = datas; el.querySelector('#fim').onchange = datas;
  el.querySelector('#dp').onchange = (e) => { st.diasParado = Math.max(1, Number(e.target.value) || 5); render(el); };
  if (!st.ini || !st.fim || st.ini > st.fim) { box.innerHTML = '<div class="card">Escolha um período válido.</div>'; return; }

  const chave = `${st.ini}|${st.fim}|${st.diasParado}`;
  if (cacheDados.chave !== chave) {
    const { data: d, error } = await db.rpc('painel', { p_ini: st.ini, p_fim: st.fim, p_dias_parado: st.diasParado });
    if (error) { box.innerHTML = `<div class="erro-box">${h(msgErro(error))}</div>`; return; }
    cacheDados = { chave, d };
  }
  const d = cacheDados.d;
  ({ resumo, operadores: abaOperadores, processos: abaProcessos, cortes: abaCortes })[st.aba](box, d);
}

const card = (rot, val, sub = '', cor = '') => `<div class="kpi"${cor ? ` style="border-top:3px solid ${cor}"` : ''}><small>${rot}</small><b>${val}</b>${sub ? `<span>${sub}</span>` : ''}</div>`;
const pct = (a, b) => b ? `${num(100 * a / b, 0)}% do cortado` : '';

function cardsCorte(d) {
  const c = d.corte;
  return `<h2 class="sec">Corte · cortes com data no período</h2>
    <div class="kpis">
      ${card('Peças cortadas', num(c.cortado), `${num(c.cortes)} corte(s)`)}
      ${card('Finalizado', num(c.finalizado), pct(c.finalizado, c.cortado), STATUS.finalizado.cor)}
      ${card('Em produção', num(c.em_producao), pct(c.em_producao, c.cortado), STATUS.em_producao.cor)}
      ${card('Parado', num(c.parado), `${pct(c.parado, c.cortado)} · sem apontamento há ${d.periodo.dias_parado}+ dias`, STATUS.parado.cor)}
    </div>
    ${barraStatus(c)}`;
}

function resumo(box, d) {
  const p = d.producao;
  const semJornada = d.ranking.some(r => r.jornada_incompleta);
  box.innerHTML = `
    <h2 class="sec">Produção · ${h(data(d.periodo.ini))} a ${h(data(d.periodo.fim))}</h2>
    <div class="kpis">
      ${card('Peças produzidas (embaladas)', num(p.embalados), 'embaladas no período, de cortes de qualquer data')}
      ${card('Minutos produzidos', num(p.minutos), `${num(p.minutos / 60, 0)} h · ${num(p.operadoras)} operador(es)`)}
      ${card('Eficiência', p.eficiencia == null ? '—' : `${num(p.eficiencia, 1)}%`, p.eficiencia == null || semJornada ? '<a href="#/cadastros">cadastre a jornada</a> de todos' : 'minutos produzidos ÷ jornada')}
    </div>
    ${cardsCorte(d)}
    <div class="painel-2">
      <div class="card"><h3>Peças produzidas por dia</h3><p class="muted peq">Embalagem</p>${barras(d.por_dia, 'embalados', 'peças')}</div>
      <div class="card"><h3>Minutos produzidos por dia</h3><p class="muted peq">Todos os processos</p>${barras(d.por_dia, 'minutos', 'min')}</div>
    </div>`;
}

function abaOperadores(box, d) {
  box.innerHTML = `<div class="card"><h3>Produção por operador · ${h(data(d.periodo.ini))} a ${h(data(d.periodo.fim))}</h3>${ranking(d.ranking)}</div>`;
}

function abaProcessos(box, d) {
  box.innerHTML = `<div class="painel-2">
      <div class="card"><h3>Produção por processo · ${h(data(d.periodo.ini))} a ${h(data(d.periodo.fim))}</h3><p class="muted peq">Tudo o que foi apontado no período.</p>${porProcesso(d.por_processo)}</div>
      <div class="card"><h3>Conferência corte × apontamentos</h3>
        <p class="muted peq">Só os cortes do período (${num(d.corte.cortado)} peças cortadas): quantas dessas peças já foram apontadas em cada processo, em qualquer data. Processo muito abaixo dos outros indica bip esquecido.</p>
        ${conciliacao(d.conciliacao)}</div>
    </div>`;
}

function abaCortes(box, d) {
  box.innerHTML = `${cardsCorte(d)}<div class="card" id="cortes"></div>`;
  desenharCortes(box.querySelector('#cortes'), d.cortes);
}

function barraStatus(c) {
  if (!c.cortado) return '';
  const seg = ['finalizado', 'em_producao', 'parado'].filter(k => c[k] > 0).map(k =>
    `<div style="flex:${c[k]};background:${STATUS[k].cor}" title="${STATUS[k].nome}: ${num(c[k])} peças (${num(100 * c[k] / c.cortado, 1)}%)"></div>`).join('');
  return `<div class="barra-status" role="img" aria-label="Divisão do cortado">${seg}</div>
    <div class="legenda">${Object.entries(STATUS).map(([k, s]) => `<span><i style="background:${s.cor}"></i>${s.nome} ${num(100 * (c[k] || 0) / c.cortado, 0)}%</span>`).join('')}</div>`;
}

// Barras verticais simples (uma série, sem legenda). Passar o mouse mostra o valor.
function barras(lista, campo, unid) {
  const dados = lista.filter(x => new Date(x.dia + 'T12:00:00').getDay() !== 0 || x[campo] > 0); // esconde domingos vazios
  if (!dados.some(x => x[campo] > 0)) return '<p class="muted">Sem produção no período.</p>';
  const max = Math.max(...dados.map(x => Number(x[campo]) || 0));
  const W = 640, H = 180, base = 150, larg = W / dados.length, bw = Math.max(2, Math.min(28, larg - 3));
  const media = dados.filter(x => x[campo] > 0).reduce((s, x) => s + Number(x[campo]), 0) / dados.filter(x => x[campo] > 0).length;
  const y = (v) => base - (v / max) * (base - 14);
  const rot = Math.ceil(dados.length / 12);
  return `<svg viewBox="0 0 ${W} ${H}" class="grafico" role="img">
    <line x1="0" x2="${W}" y1="${base}" y2="${base}" stroke="var(--linha)"/>
    <line x1="0" x2="${W}" y1="${y(media)}" y2="${y(media)}" stroke="var(--sub)" stroke-dasharray="4 4"/>
    <text x="${W}" y="${y(media) - 4}" text-anchor="end" class="g-txt">média ${num(media)} ${unid}</text>
    ${dados.map((x, i) => {
      const v = Number(x[campo]) || 0, cx = i * larg + larg / 2, top = y(v);
      return `<g><rect class="g-alvo" x="${i * larg}" y="0" width="${larg}" height="${base}" fill="transparent"><title>${data(x.dia)}: ${num(v)} ${unid}</title></rect>
        ${v ? `<path d="M${cx - bw / 2},${base} V${top + 3} q0,-3 3,-3 h${bw - 6} q3,0 3,3 V${base} Z" fill="var(--acento)" pointer-events="none"/>` : ''}
        ${i % rot === 0 ? `<text x="${cx}" y="${H - 14}" text-anchor="middle" class="g-txt">${x.dia.slice(8, 10)}/${x.dia.slice(5, 7)}</text>` : ''}</g>`;
    }).join('')}
  </svg>`;
}

function ranking(lista) {
  if (!lista.length) return '<p class="muted">Sem apontamentos no período.</p>';
  const max = Math.max(...lista.map(r => Number(r.minutos) || 0)) || 1;
  return `<div class="tabela-wrap"><table>
    <thead><tr><th>#</th><th>Operador(a)</th><th class="dir">Peças</th><th>Minutos</th><th class="dir">Dias</th><th class="dir">Min/dia</th><th class="dir">Eficiência</th></tr></thead>
    <tbody>${lista.map((r, i) => `<tr><td class="muted">${i + 1}</td><td class="forte">${h(r.nome)}</td>
      <td class="dir">${num(r.pecas)}</td>
      <td><div class="mini-barra"><span style="width:${100 * r.minutos / max}%"></span><b>${num(r.minutos)}</b></div></td>
      <td class="dir">${num(r.dias)}</td><td class="dir">${num(r.minutos / r.dias)}</td>
      <td class="dir">${r.eficiencia == null ? `<span class="muted" title="Falta a jornada de algum dia trabalhado">—</span>` : `<b>${num(r.eficiencia, 1)}%</b>`}</td></tr>`).join('')}</tbody></table></div>`;
}

function conciliacao(lista) {
  return `<div class="tabela-wrap"><table>
    <thead><tr><th>Processo</th><th class="dir">Apontado</th><th>% do cortado</th></tr></thead>
    <tbody>${lista.map(x => `<tr><td class="forte">${h(x.processo)}</td><td class="dir">${num(x.apontado)}</td>
      <td><div class="mini-barra"><span style="width:${Math.min(100, x.pct || 0)}%"></span><b>${x.pct == null ? '—' : num(x.pct, 1) + '%'}</b></div></td></tr>`).join('')}</tbody></table></div>`;
}

function porProcesso(lista) {
  if (!lista.length) return '<p class="muted">Sem apontamentos no período.</p>';
  return `<div class="tabela-wrap"><table>
    <thead><tr><th>Processo</th><th class="dir">Peças</th><th class="dir">Minutos</th></tr></thead>
    <tbody>${lista.map(x => `<tr><td class="forte">${h(x.processo)}</td><td class="dir">${num(x.pecas)}</td><td class="dir">${Number(x.minutos) ? num(x.minutos) : chip('sem tempo padrão', 'erro')}</td></tr>`).join('')}</tbody></table></div>`;
}

function desenharCortes(box, cortes) {
  const cont = (k) => cortes.filter(c => k === 'todos' || c.status === k).length;
  const lista = cortes.filter(c => st.filtroCorte === 'todos' || c.status === st.filtroCorte);
  const btn = (k, n) => `<button type="button" data-f="${k}" class="${st.filtroCorte === k ? 'ativo' : ''}">${n} (${cont(k)})</button>`;
  box.innerHTML = `<h3>Cortes do período</h3><p class="muted peq">Clique no corte para ver cor × tamanho.</p>
    <div class="abas">${btn('parado', 'Parados')}${btn('em_producao', 'Em produção')}${btn('finalizado', 'Finalizados')}${btn('todos', 'Todos')}</div>
    ${lista.length ? `<div class="tabela-wrap"><table>
      <thead><tr><th>Corte</th><th>Data</th><th>Modelo · tecido</th><th class="dir">Cortado</th><th class="dir">Embalado</th><th>Andamento</th><th>Último apontamento</th><th>Status</th></tr></thead>
      <tbody>${lista.map(c => `<tr class="clicavel" data-corte="${h(c.id)}" title="Ver cor × tamanho"><td class="forte">${h(c.nome)} <span class="muted peq">▸</span></td><td>${h(data(c.data))}</td><td>${h(c.produto)} · ${h(c.tecido || '')}</td>
        <td class="dir">${num(c.cortado)}</td><td class="dir">${num(c.embalado)}</td>
        <td><div class="mini-barra"><span style="width:${c.cortado ? 100 * c.embalado / c.cortado : 0}%"></span><b>${c.cortado ? num(100 * c.embalado / c.cortado, 0) : 0}%</b></div></td>
        <td>${c.ultimo ? h(data(c.ultimo)) : '<span class="muted">nunca</span>'}</td>
        <td>${chip(STATUS[c.status].nome, STATUS[c.status].chip)}${c.status === 'parado' && c.itens_parados < c.itens ? ` <span class="muted peq">${c.itens_parados} de ${c.itens} pacotes</span>` : ''}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="muted">Nenhum corte nesse filtro.</p>'}`;
  box.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { st.filtroCorte = b.dataset.f; desenharCortes(box, cortes); });
  box.querySelectorAll('[data-corte]').forEach(tr => tr.onclick = () => detalheCorte(cortes.find(c => c.id === tr.dataset.corte)));
}

// ---------- Detalhe do corte: cor × tamanho ----------
async function detalheCorte(c) {
  const m = modal({ titulo: `Corte ${c.nome}`, largo: true, corpo: '<p class="muted">Carregando…</p>' });
  const { data: itens, error } = await db.rpc('corte_andamento', { p_corte: c.id, p_dias_parado: st.diasParado });
  const corpo = m.el.querySelector('.modal-corpo');
  if (error) { corpo.innerHTML = `<div class="erro-box">${h(msgErro(error))}</div>`; return; }
  const tams = [...new Map(itens.map(i => [i.tamanho, i.ordem])).entries()].sort((a, b) => a[1] - b[1]).map(x => x[0]);
  const cores = [...new Set(itens.map(i => i.cor))];
  const cel = (cor, tam) => {
    const xs = itens.filter(i => i.cor === cor && i.tamanho === tam);
    if (!xs.length) return '<td class="cel-vazia"></td>';
    const q = xs.reduce((s, i) => s + i.qtd, 0), e = xs.reduce((s, i) => s + Math.min(i.embalado, i.qtd), 0);
    const stt = xs.some(i => i.status === 'parado') ? 'parado' : xs.every(i => i.status === 'finalizado') ? 'finalizado' : 'em_producao';
    return `<td class="cel cel-${stt}" title="${h(cor)} ${h(tam)}: ${num(e)} de ${num(q)} embaladas · ${STATUS[stt].nome}"><b>${num(q - e)}</b><small>${num(e)}/${num(q)}</small></td>`;
  };
  const pend = itens.filter(i => i.status !== 'finalizado');
  corpo.innerHTML = `
    <p class="muted peq" style="margin-top:0">${h(data(c.data))} · ${h(c.produto)} · ${h(c.tecido || '')} · cortado ${num(c.cortado)} · embalado ${num(c.embalado)}.
      Em cada célula: <b>peças que faltam embalar</b> e embaladas/cortadas.</p>
    <div class="legenda">${Object.entries(STATUS).map(([, s]) => `<span><i style="background:${s.cor}"></i>${s.nome}</span>`).join('')}</div>
    <div class="tabela-wrap"><table class="grade-cor">
      <thead><tr><th>Cor</th>${tams.map(t => `<th class="dir">${h(t)}</th>`).join('')}<th class="dir">Falta</th></tr></thead>
      <tbody>${cores.map(cor => {
        const xs = itens.filter(i => i.cor === cor), falta = xs.reduce((s, i) => s + Math.max(0, i.qtd - i.embalado), 0);
        return `<tr><td class="forte">${h(cor)}</td>${tams.map(t => cel(cor, t)).join('')}<td class="dir forte">${num(falta)}</td></tr>`;
      }).join('')}</tbody></table></div>
    ${pend.length ? `<h3 style="margin-top:14px">Pacotes não finalizados (${pend.length})</h3>
      <div class="tabela-wrap"><table>
        <thead><tr><th>Pacote</th><th>Cor · tam.</th><th class="dir">Peças</th><th>Processos que faltam</th><th>Último apontamento</th></tr></thead>
        <tbody>${pend.map(i => `<tr><td>${chip(i.codigo, 'info')}</td><td class="forte">${h(i.cor)} · ${h(i.tamanho)}</td><td class="dir">${num(i.qtd)}</td>
          <td>${i.processos.filter(p => p.apontado < i.qtd).map(p => chip(`${p.processo} ${num(p.apontado)}/${num(i.qtd)}`, p.apontado ? 'alerta' : '')).join(' ') || '<span class="muted">—</span>'}</td>
          <td>${i.ultimo ? h(data(i.ultimo)) : '<span class="muted">nunca</span>'} ${chip(STATUS[i.status].nome, STATUS[i.status].chip)}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
}
