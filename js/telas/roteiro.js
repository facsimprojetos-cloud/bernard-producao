import { db } from '../estado.js';
import { tem } from '../estado.js';
import { h, num, ler, chip, toast, confirmar, msgErro, limparCache } from '../util.js';

// Tempo padrão por modelo: roteiro (produto + tecido → processos), com tempo padrão em segundos,
// sequência e pessoas. Quem tem o perfil "cadastros" pode editar.
// Mudar um tempo só vale para os bips NOVOS: cada apontamento guarda o tempo do momento em que foi gravado.
const filtro = { produto: '', tecido: '' };

export async function render(el) {
  const pode = tem('cadastros');
  const rows = await ler(db.from('produto_processos')
    .select('id, sequencia, tempo_padrao_seg, pessoas, produto:produtos(nome), tecido:tecidos(nome), processo:processos(nome)'));
  rows.sort((a, b) => (a.produto?.nome || '').localeCompare(b.produto?.nome || '')
    || (a.tecido?.nome || '').localeCompare(b.tecido?.nome || '')
    || (a.sequencia ?? 999) - (b.sequencia ?? 999));

  const produtos = [...new Set(rows.map(r => r.produto?.nome))].filter(Boolean);
  const tecidos = [...new Set(rows.map(r => r.tecido?.nome))].filter(Boolean).sort();
  const sel = (id, lista, v) => `<select id="${id}"><option value="">Todos</option>${lista.map(x =>
    `<option ${x === v ? 'selected' : ''}>${h(x)}</option>`).join('')}</select>`;

  el.innerHTML = `
    <div class="cab"><div><h1>Tempo padrão por modelo</h1>
      <p>Roteiro de cada modelo e tecido: processos, tempo padrão (segundos por peça), sequência e pessoas.
      ${pode ? 'Alterar um tempo vale só para os apontamentos novos; o histórico não muda.' : ''}</p></div></div>
    <div class="filtros">
      <div class="campo"><label>Modelo</label>${sel('f-prod', produtos, filtro.produto)}</div>
      <div class="campo"><label>Tecido</label>${sel('f-tec', tecidos, filtro.tecido)}</div>
    </div>
    <div id="lista"></div>`;

  el.querySelector('#f-prod').onchange = (e) => { filtro.produto = e.target.value; desenhar(); };
  el.querySelector('#f-tec').onchange = (e) => { filtro.tecido = e.target.value; desenhar(); };

  function desenhar() {
    const grupos = new Map();
    for (const r of rows) {
      if (filtro.produto && r.produto?.nome !== filtro.produto) continue;
      if (filtro.tecido && r.tecido?.nome !== filtro.tecido) continue;
      const k = `${r.produto?.nome} · ${r.tecido?.nome}`;
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(r);
    }
    let html = '';
    for (const [nome, itens] of grupos) {
      const comTempo = itens.filter(i => i.tempo_padrao_seg != null);
      const total = comTempo.reduce((s, i) => s + Number(i.tempo_padrao_seg), 0);
      html += `<div class="roteiro-grupo"><h2>${h(nome)}
          ${comTempo.length < itens.length ? chip(`${itens.length - comTempo.length} sem tempo`, 'erro') : chip('completo', 'ok')}</h2>
        <div class="tabela-wrap"><table>
          <thead><tr><th>Processo</th><th class="dir">Tempo padrão (seg)</th><th class="dir">Sequência</th><th class="dir">Pessoas</th></tr></thead>
          <tbody>${itens.map(i => linha(i, pode)).join('')}</tbody>
          <tfoot><tr><td>Total da peça (processos com tempo)</td><td class="dir">${num(total, 2)} s · ${num(total / 60, 2)} min</td><td></td><td></td></tr></tfoot>
        </table></div></div>`;
    }
    const lista = el.querySelector('#lista');
    lista.innerHTML = html || '<div class="card"><p>Nenhum roteiro para esse filtro.</p></div>';
    if (pode) lista.querySelectorAll('input[data-id]').forEach(inp => inp.onchange = () => salvar(inp));
  }

  async function salvar(inp) {
    const r = rows.find(x => String(x.id) === inp.dataset.id);
    const campo = inp.dataset.campo;
    const txt = inp.value.trim().replace(',', '.');
    const valor = txt === '' ? null : Number(txt);
    if (valor != null && (!isFinite(valor) || valor < 0)) { toast('Valor inválido', 'erro'); inp.value = r[campo] ?? ''; return; }
    if (campo === 'tempo_padrao_seg') {
      const ok = await confirmar('Alterar tempo padrão',
        h(`${r.produto?.nome} · ${r.tecido?.nome} · ${r.processo?.nome}: de ${r[campo] ?? 'vazio'} para ${valor ?? 'vazio'} segundos. `) +
        'Vale para os apontamentos feitos a partir de agora (premiação). Os já gravados não mudam.', 'Alterar');
      if (!ok) { inp.value = r[campo] ?? ''; return; }
    }
    try {
      const res = await ler(db.from('produto_processos').update({ [campo]: valor }).eq('id', r.id).select('id'));
      if (!res.length) throw new Error('Sem permissão para alterar (perfil cadastros).');
      r[campo] = valor;
      limparCache();
      toast('Salvo', 'ok');
      desenhar();
    } catch (e) { if (!e?.code) toast(msgErro(e), 'erro'); inp.value = r[campo] ?? ''; }
  }

  desenhar();
}

function linha(i, pode) {
  const v = (campo, passo) => pode
    ? `<input class="tempo-ed" inputmode="decimal" data-id="${i.id}" data-campo="${campo}" step="${passo}" value="${h(i[campo] ?? '')}" placeholder="vazio">`
    : (i[campo] == null ? '—' : h(campo === 'tempo_padrao_seg' ? num(i[campo], 2) : i[campo]));
  return `<tr><td class="forte">${h(i.processo?.nome || '')}</td>
    <td class="dir ${i.tempo_padrao_seg == null && !pode ? 'vazio' : ''}">${v('tempo_padrao_seg', '0.01')}</td>
    <td class="dir">${v('sequencia', '1')}</td>
    <td class="dir">${v('pessoas', '1')}</td></tr>`;
}
