import { db } from '../estado.js';
import { h, num, chip, ler, hojeISO, data, dataHora, cadastros, msgErro, imprimirHtml } from '../util.js';
import { EMPRESA } from '../config.js';

// Fechamento (premiação): por dia ou por mês. Quantidade, tempo (minutos) e eficiência por operador(a).
// Eficiência = minutos ÷ jornada cadastrada (Cadastros → Operadores) dos dias trabalhados.
// Fonte: função bernard.fechamento (perfil "fechamento").
const st = { dia: null, mes: null, operador: '', porProcesso: true };

const somaDias = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };
const fimDoMes = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0, 12).toLocaleDateString('en-CA'); };
const nomeMes = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1, 12).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }); };
const efic = (o) => o?.eficiencia == null ? '<span class="muted" title="Cadastre a jornada em Cadastros → Operadores">—</span>' : `<b>${num(o.eficiencia, 1)}%</b>`;
const eficTxt = (o) => o?.eficiencia == null ? '—' : `${num(o.eficiencia, 1)}%`;

export async function render(el, { embutido = false, modo = 'dia' } = {}) {
  const mensal = modo === 'mes';
  const cad = await cadastros(db);
  const nomes = [...new Set(cad.funcionarios.filter(f => f.ativo !== false).map(f => f.nome))].sort((a, b) => a.localeCompare(b));
  if (!st.dia) {
    const ult = await ler(db.from('apontamentos').select('data_producao').order('data_producao', { ascending: false }).limit(1));
    st.dia = ult[0]?.data_producao || hojeISO();
  }
  if (!st.mes) st.mes = st.dia.slice(0, 7);
  const titulo = mensal ? 'Fechamento mensal' : 'Fechamento por dia';
  el.innerHTML = `
    ${embutido ? '' : `<div class="cab"><div><h1>${titulo}</h1></div></div>`}
    <p class="muted" style="margin-top:0">${mensal ? 'Quantidade, tempo e eficiência de cada operador(a) no mês.' : 'Quantidade, tempo e eficiência de cada operador(a) no dia de produção escolhido.'} Base da premiação.</p>
    <div class="filtros">
      ${mensal
        ? `<div class="campo" style="max-width:220px"><label>Mês</label><input type="month" id="mes" value="${h(st.mes)}"></div>
           <label style="align-self:center;white-space:nowrap"><input type="checkbox" id="pp" ${st.porProcesso ? 'checked' : ''}> Separar por processo</label>`
        : `<button class="btn" id="ant" title="Dia anterior">◀</button>
           <div class="campo"><label>Dia de produção</label><input type="date" id="dia" value="${h(st.dia)}"></div>
           <button class="btn" id="prox" title="Próximo dia">▶</button>`}
      <div class="campo"><label>Operador(a)</label><select id="busca"><option value="">Todos</option>${nomes.map(n =>
        `<option ${n === st.operador ? 'selected' : ''}>${h(n)}</option>`).join('')}</select></div>
      <button class="btn pri" id="imprimir" style="align-self:flex-end">🖨️ Emitir relatório</button>
    </div>
    <div id="res"><p class="muted">Carregando…</p></div>`;

  if (mensal) {
    el.querySelector('#mes').onchange = (e) => { if (e.target.value) { st.mes = e.target.value; carregar(); } };
    el.querySelector('#pp').onchange = (e) => { st.porProcesso = e.target.checked; desenhar(); };
  } else {
    const inp = el.querySelector('#dia');
    const ir = (iso) => { if (!iso) return; st.dia = iso; inp.value = iso; carregar(); };
    inp.onchange = () => ir(inp.value);
    el.querySelector('#ant').onclick = () => ir(somaDias(st.dia, -1));
    el.querySelector('#prox').onclick = () => ir(somaDias(st.dia, 1));
  }
  el.querySelector('#busca').onchange = (e) => { st.operador = e.target.value; desenhar(); };
  el.querySelector('#imprimir').onclick = () => imprimir();

  let dados = null;
  async function carregar() {
    el.querySelector('#res').innerHTML = '<p class="muted">Carregando…</p>';
    const ini = mensal ? st.mes + '-01' : st.dia, fim = mensal ? fimDoMes(st.mes) : st.dia;
    const { data: d, error } = await db.rpc('fechamento', { p_ini: ini, p_fim: fim });
    if (error) { el.querySelector('#res').innerHTML = `<div class="erro-box">${h(msgErro(error))}</div>`; return; }
    dados = d; desenhar();
  }

  // Grupos por operador(a) já filtrados; servem para a tela e para o relatório.
  function grupos() {
    const ops = Object.fromEntries(dados.operadores.map(o => [o.funcionario, o]));
    const lista = dados.linhas.filter(l => !st.operador || l.funcionario === st.operador);
    const g = new Map();
    for (const l of lista) { if (!g.has(l.funcionario)) g.set(l.funcionario, []); g.get(l.funcionario).push(l); }
    return [...g].map(([func, itens]) => ({ func, itens, op: ops[func] }));
  }
  const porProc = () => !mensal || st.porProcesso;

  function tabela(gs, paraImprimir = false) {
    const pp = porProc();
    let corpo = '', totQ = 0, totM = 0, totDisp = 0, totMEf = 0, semTempo = 0;
    const extras = (o) => mensal ? `<td class="dir">${num(o.dias)}</td><td class="dir">${o.disponivel == null ? '—' : num(o.disponivel)}</td>` : '';
    const eff = (o) => `<td class="dir">${paraImprimir ? eficTxt(o) : efic(o)}</td>`;
    for (const { func, itens, op } of gs) {
      totQ += Number(op.qtd); totM += Number(op.minutos);
      if (op.disponivel != null) { totDisp += Number(op.disponivel); totMEf += Number(op.minutos); }
      if (!pp) {
        corpo += `<tr><td class="forte">${h(func)}</td><td class="dir">${num(op.qtd)}</td><td class="dir">${num(op.minutos)}</td>${extras(op)}${eff(op)}</tr>`;
        continue;
      }
      const um = itens.length === 1;
      itens.forEach((i, n) => {
        if (i.sem_tempo) semTempo++;
        corpo += `<tr><td class="forte">${n === 0 ? h(func) : ''}</td>
          <td>${h(i.processo)}${i.sem_tempo && !paraImprimir ? ' ' + chip('sem tempo padrão', 'erro') : ''}</td>
          <td class="dir">${num(i.qtd)}</td><td class="dir">${num(i.minutos)}</td>
          ${um ? extras(op) + eff(op) : (mensal ? '<td></td><td></td>' : '') + '<td></td>'}</tr>`;
      });
      if (!um) corpo += `<tr class="subtotal"><td></td><td><i>Total ${h(func)}</i></td><td class="dir forte">${num(op.qtd)}</td><td class="dir forte">${num(op.minutos)}</td>${extras(op)}${eff(op)}</tr>`;
    }
    const efTot = totDisp > 0 ? { eficiencia: Math.round(1000 * totMEf / totDisp) / 10 } : null;
    const cab = `<tr><th>Operador(a)</th>${pp ? '<th>Processo</th>' : ''}<th class="dir">Quantidade</th><th class="dir">Tempo (min)</th>${mensal ? '<th class="dir">Dias</th><th class="dir">Jornada (min)</th>' : ''}<th class="dir">Eficiência</th></tr>`;
    const rod = `<tr><td class="forte">Total</td>${pp ? `<td>${gs.length} operador(es)</td>` : ''}<td class="dir forte">${num(totQ)}</td><td class="dir forte">${num(totM)}</td>${mensal ? '<td></td><td></td>' : ''}<td class="dir">${paraImprimir ? eficTxt(efTot) : efic(efTot)}</td></tr>`;
    return { html: `<table><thead>${cab}</thead><tbody>${corpo}</tbody><tfoot>${rod}</tfoot></table>`, semTempo };
  }

  function desenhar() {
    const res = el.querySelector('#res');
    const gs = grupos();
    const periodo = mensal ? nomeMes(st.mes) : data(st.dia);
    if (!gs.length) { res.innerHTML = `<div class="card"><p>Nenhum apontamento em <b>${h(periodo)}</b>${st.operador ? ' para ' + h(st.operador) : ''}.</p></div>`; return; }
    const t = tabela(gs);
    const semJornada = gs.some(g => g.op.eficiencia == null);
    res.innerHTML = `
      ${t.semTempo ? `<div class="aviso-box">⚠️ ${t.semTempo} linha(s) com peças e tempo zero: processo sem tempo padrão para aquele modelo/tecido. Confira em <a href="#/roteiro">Tempo padrão por modelo</a>.</div>` : ''}
      ${semJornada ? `<div class="muted peq" style="margin-bottom:6px">Eficiência em branco = falta a jornada da operadora em <a href="#/cadastros">Cadastros → Operadores</a>.</div>` : ''}
      <div class="tabela-wrap">${t.html}</div>`;
  }

  function imprimir() {
    if (!dados) return;
    const gs = grupos();
    const periodo = mensal ? nomeMes(st.mes) : data(st.dia);
    const t = tabela(gs, true);
    imprimirHtml(`<div class="relatorio">
      <div class="rel-cab"><div><b>${h(EMPRESA)}</b><h1>${titulo}</h1>
        <div>${mensal ? 'Mês' : 'Dia de produção'}: <b>${h(periodo)}</b>${st.operador ? ` · Operador(a): <b>${h(st.operador)}</b>` : ''}${mensal && !st.porProcesso ? ' · Total por operador(a)' : ''}</div></div>
        <div class="rel-data">Emitido em ${h(dataHora(new Date().toISOString()))}</div></div>
      ${gs.length ? t.html : '<p>Nenhum apontamento no período.</p>'}
      <p class="rel-nota">Tempo = minutos padrão produzidos (quantidade × tempo padrão ÷ 60). Eficiência = tempo ÷ jornada cadastrada dos dias trabalhados.</p>
    </div>`, `${titulo} ${periodo}${st.operador ? ' ' + st.operador : ''}`);
  }

  carregar();
}
