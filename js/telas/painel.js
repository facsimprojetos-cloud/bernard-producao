import { db } from '../estado.js';
import { h, num, chip, toast, msgErro, hojeISO, data } from '../util.js';

// Painel (Gestão, só admin): produção (peças embaladas = último processo), minutos, eficiência pela jornada,
// corte do período (finalizado / em produção / parado) e conferência corte × lançamentos por processo.
const st = { periodo: 'mes', ini: null, fim: null, diasParado: 5, filtroCorte: 'parado' };
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

export async function render(el) {
  if (!st.ini) [st.ini, st.fim] = intervalo(st.periodo);
  const opt = (v, n) => `<option value="${v}" ${st.periodo === v ? 'selected' : ''}>${n}</option>`;
  el.innerHTML = `
    <div class="cab"><div><h1>Painel</h1><p>Produção, corte e conferência dos apontamentos. Peças produzidas = peças apontadas na Embalagem.</p></div></div>
    <div class="filtros">
      <div class="campo"><label>Período</label><select id="per">${opt('hoje', 'Hoje')}${opt('ontem', 'Ontem')}${opt('semana', 'Esta semana')}${opt('semana_ant', 'Semana passada')}${opt('mes', 'Este mês')}${opt('mes_ant', 'Mês passado')}${opt('30', 'Últimos 30 dias')}${opt('outro', 'Escolher datas')}</select></div>
      <div class="campo"><label>De</label><input type="date" id="ini" value="${h(st.ini)}"></div>
      <div class="campo"><label>Até</label><input type="date" id="fim" value="${h(st.fim)}"></div>
      <div class="campo" style="max-width:150px"><label>Parado há (dias)</label><input type="number" id="dp" min="1" max="60" value="${st.diasParado}"></div>
    </div>
    <div id="res"><p class="muted">Carregando…</p></div>`;
  el.querySelector('#per').onchange = (e) => { st.periodo = e.target.value; if (st.periodo !== 'outro') [st.ini, st.fim] = intervalo(st.periodo); render(el); };
  const datas = () => { st.periodo = 'outro'; st.ini = el.querySelector('#ini').value; st.fim = el.querySelector('#fim').value; render(el); };
  el.querySelector('#ini').onchange = datas; el.querySelector('#fim').onchange = datas;
  el.querySelector('#dp').onchange = (e) => { st.diasParado = Math.max(1, Number(e.target.value) || 5); render(el); };
  if (!st.ini || !st.fim || st.ini > st.fim) { el.querySelector('#res').innerHTML = '<div class="card">Escolha um período válido.</div>'; return; }

  const { data: d, error } = await db.rpc('painel', { p_ini: st.ini, p_fim: st.fim, p_dias_parado: st.diasParado });
  if (error) { el.querySelector('#res').innerHTML = `<div class="erro-box">${h(msgErro(error))}</div>`; return; }
  desenhar(el.querySelector('#res'), d);
}

function desenhar(box, d) {
  const p = d.producao, c = d.corte;
  const semJornada = d.ranking.some(r => r.jornada_incompleta);
  const card = (rot, val, sub = '', cor = '') => `<div class="kpi"${cor ? ` style="border-top:3px solid ${cor}"` : ''}><small>${rot}</small><b>${val}</b>${sub ? `<span>${sub}</span>` : ''}</div>`;
  const pct = (a, b) => b ? `${num(100 * a / b, 0)}% do cortado` : '';
  box.innerHTML = `
    <h2 class="sec">Produção · ${h(data(d.periodo.ini))} a ${h(data(d.periodo.fim))}</h2>
    <div class="kpis">
      ${card('Peças produzidas (embaladas)', num(p.embalados), `embaladas no período, de cortes de qualquer data`)}
      ${card('Minutos produzidos', num(p.minutos), `${num(p.minutos / 60, 0)} h · ${num(p.operadoras)} operador(es)`)}
      ${card('Eficiência', p.eficiencia == null ? '—' : `${num(p.eficiencia, 1)}%`, p.eficiencia == null || semJornada ? '<a href="#/cadastros">cadastre a jornada</a> de todos' : 'minutos produzidos ÷ jornada')}
    </div>
    <h2 class="sec">Corte · cortes com data no período</h2>
    <div class="kpis">
      ${card('Peças cortadas', num(c.cortado), `${num(c.cortes)} corte(s)`)}
      ${card('Finalizado', num(c.finalizado), pct(c.finalizado, c.cortado), STATUS.finalizado.cor)}
      ${card('Em produção', num(c.em_producao), pct(c.em_producao, c.cortado), STATUS.em_producao.cor)}
      ${card('Parado', num(c.parado), `${pct(c.parado, c.cortado)} · sem apontamento há ${d.periodo.dias_parado}+ dias`, STATUS.parado.cor)}
    </div>
    ${barraStatus(c)}
    <div class="painel-2">
      <div class="card"><h3>Peças produzidas por dia</h3><p class="muted peq">Embalagem</p>${barras(d.por_dia, 'embalados', 'peças')}</div>
      <div class="card"><h3>Minutos produzidos por dia</h3><p class="muted peq">Todos os processos</p>${barras(d.por_dia, 'minutos', 'min')}</div>
    </div>
    <div class="painel-2">
      <div class="card"><h3>Ranking por operador</h3>${ranking(d.ranking)}</div>
      <div class="card"><h3>Conferência corte × apontamentos</h3>
        <p class="muted peq">Só os cortes do período (${num(c.cortado)} peças cortadas): quantas dessas peças já foram apontadas em cada processo, em qualquer data. Processo muito abaixo dos outros indica bip esquecido.</p>
        ${conciliacao(d.conciliacao)}</div>
    </div>
    <div class="card"><h3>Produção por processo</h3>${porProcesso(d.por_processo)}</div>
    <div class="card" id="cortes"></div>`;
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
  box.innerHTML = `<h3>Cortes do período</h3>
    <div class="abas">${btn('parado', 'Parados')}${btn('em_producao', 'Em produção')}${btn('finalizado', 'Finalizados')}${btn('todos', 'Todos')}</div>
    ${lista.length ? `<div class="tabela-wrap"><table>
      <thead><tr><th>Corte</th><th>Data</th><th>Modelo · tecido</th><th class="dir">Cortado</th><th class="dir">Embalado</th><th>Andamento</th><th>Último apontamento</th><th>Status</th></tr></thead>
      <tbody>${lista.map(c => `<tr><td class="forte">${h(c.nome)}</td><td>${h(data(c.data))}</td><td>${h(c.produto)} · ${h(c.tecido || '')}</td>
        <td class="dir">${num(c.cortado)}</td><td class="dir">${num(c.embalado)}</td>
        <td><div class="mini-barra"><span style="width:${c.cortado ? 100 * c.embalado / c.cortado : 0}%"></span><b>${c.cortado ? num(100 * c.embalado / c.cortado, 0) : 0}%</b></div></td>
        <td>${c.ultimo ? h(data(c.ultimo)) : '<span class="muted">nunca</span>'}</td>
        <td>${chip(STATUS[c.status].nome, STATUS[c.status].chip)}${c.status === 'parado' && c.itens_parados < c.itens ? ` <span class="muted peq">${c.itens_parados} de ${c.itens} pacotes</span>` : ''}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="muted">Nenhum corte nesse filtro.</p>'}`;
  box.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { st.filtroCorte = b.dataset.f; desenharCortes(box, cortes); });
}
