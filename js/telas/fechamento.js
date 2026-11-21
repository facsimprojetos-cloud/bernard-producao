import { db } from '../estado.js';
import { h, num, ler, chip, hojeISO, data } from '../util.js';

// Fechamento por dia (premiação): soma por operador(a) e processo no DIA DE PRODUÇÃO escolhido.
// Fonte: view bernard.v_fechamento_diario (só quem tem o perfil "fechamento" enxerga as linhas).
let diaAtual = null;

const somaDias = (iso, n) => {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

export async function render(el) {
  if (!diaAtual) {
    const ult = await ler(db.from('v_fechamento_diario').select('data').order('data', { ascending: false }).limit(1));
    diaAtual = ult[0]?.data || hojeISO();
  }
  el.innerHTML = `
    <div class="cab"><div><h1>Fechamento por dia</h1>
      <p>Peças e tempo total (minutos) de cada operador(a) no dia de produção escolhido. Base da premiação.</p></div></div>
    <div class="filtros">
      <button class="btn" id="ant" title="Dia anterior">◀</button>
      <div class="campo"><label>Dia de produção</label><input type="date" id="dia" value="${h(diaAtual)}"></div>
      <button class="btn" id="prox" title="Próximo dia">▶</button>
      <div class="campo"><label>Operador(a)</label><input id="busca" placeholder="Filtrar pelo nome"></div>
    </div>
    <div id="res"><p class="muted">Carregando…</p></div>`;

  const inp = el.querySelector('#dia');
  const ir = (iso) => { if (!iso) return; diaAtual = iso; inp.value = iso; carregar(); };
  inp.onchange = () => ir(inp.value);
  el.querySelector('#ant').onclick = () => ir(somaDias(diaAtual, -1));
  el.querySelector('#prox').onclick = () => ir(somaDias(diaAtual, 1));
  el.querySelector('#busca').oninput = () => desenhar();

  let linhas = [];
  async function carregar() {
    el.querySelector('#res').innerHTML = '<p class="muted">Carregando…</p>';
    linhas = await ler(db.from('v_fechamento_diario').select('*').eq('data', diaAtual)
      .order('funcionario').order('processo'));
    desenhar();
  }

  function desenhar() {
    const filtro = el.querySelector('#busca').value.trim().toLowerCase();
    const lista = linhas.filter(l => !filtro || String(l.funcionario || '').toLowerCase().includes(filtro));
    const res = el.querySelector('#res');
    if (!lista.length) {
      res.innerHTML = `<div class="card"><p>Nenhum apontamento em <b>${h(data(diaAtual))}</b>${filtro ? ' para esse nome' : ''}.</p></div>`;
      return;
    }
    // agrupa por operador(a)
    const grupos = new Map();
    for (const l of lista) {
      const k = l.funcionario || '(sem operador)';
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(l);
    }
    let corpo = '', totQ = 0, totM = 0, semTempo = 0;
    for (const [func, itens] of grupos) {
      const q = itens.reduce((s, i) => s + Number(i.qtd_total || 0), 0);
      const m = itens.reduce((s, i) => s + Number(i.minutos || 0), 0);
      totQ += q; totM += m;
      itens.forEach((i, n) => {
        const zero = Number(i.qtd_total) > 0 && !Number(i.minutos);
        if (zero) semTempo++;
        corpo += `<tr>
          <td class="forte">${n === 0 ? h(func) : ''}</td>
          <td>${h(i.processo || '')} ${zero ? chip('sem tempo padrão', 'erro') : ''}</td>
          <td class="dir">${num(i.qtd_total)}</td>
          <td class="dir">${num(i.minutos)}</td></tr>`;
      });
      if (itens.length > 1) corpo += `<tr class="subtotal"><td></td><td><i>Total ${h(func)}</i></td>
        <td class="dir forte">${num(q)}</td><td class="dir forte">${num(m)}</td></tr>`;
    }
    res.innerHTML = `
      ${semTempo ? `<div class="aviso-box">⚠️ ${semTempo} linha(s) com peças e tempo zero: o processo não tem tempo padrão cadastrado para aquele modelo/tecido. Confira na aba <a href="#/roteiro">Tempo padrão</a>.</div>` : ''}
      <div class="tabela-wrap"><table>
        <thead><tr><th>Operador(a)</th><th>Processo</th><th class="dir">Quantidade total</th><th class="dir">Tempo total (min)</th></tr></thead>
        <tbody>${corpo}</tbody>
        <tfoot><tr><td class="forte">Total do dia ${h(data(diaAtual))}</td><td>${grupos.size} operador(es)</td>
          <td class="dir forte">${num(totQ)}</td><td class="dir forte">${num(totM)}</td></tr></tfoot>
      </table></div>`;
  }

  carregar();
}
