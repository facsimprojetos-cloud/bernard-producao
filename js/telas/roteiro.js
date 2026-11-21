import { db, tem } from '../estado.js';
import { h, num, ler, chip, toast, msgErro, pedirTexto, limparCache, dataHora } from '../util.js';

// Tempo padrão por modelo: roteiro (produto + tecido → processos), com tempo padrão em segundos,
// sequência e pessoas. A tela é só leitura; quem tem o perfil "cadastros" clica em "Editar" no modelo,
// altera os campos e clica em "Salvar edição" (pede o motivo). Tudo fica no histórico.
// Mudar um tempo só vale para os bips NOVOS: cada apontamento guarda o tempo do momento em que foi gravado.
const filtro = { produto: '', tecido: '' };
const CAMPOS = { tempo_padrao_seg: 'Tempo padrão (seg)', sequencia: 'Sequência', pessoas: 'Pessoas' };
const fmt = (campo, v) => v == null ? 'vazio' : (campo === 'tempo_padrao_seg' ? num(v, 2) : String(v));

export async function render(el) {
  const pode = tem('cadastros');
  let editando = null; // nome do grupo em edição
  const rows = await ler(db.from('produto_processos')
    .select('id, sequencia, tempo_padrao_seg, pessoas, produto:produtos(nome), tecido:tecidos(nome), processo:processos(nome)'));
  const ordenar = () => rows.sort((a, b) => (a.produto?.nome || '').localeCompare(b.produto?.nome || '')
    || (a.tecido?.nome || '').localeCompare(b.tecido?.nome || '')
    || (a.sequencia ?? 999) - (b.sequencia ?? 999));
  ordenar();

  const produtos = [...new Set(rows.map(r => r.produto?.nome))].filter(Boolean);
  const tecidos = [...new Set(rows.map(r => r.tecido?.nome))].filter(Boolean).sort();
  const sel = (id, lista, v) => `<select id="${id}"><option value="">Todos</option>${lista.map(x =>
    `<option ${x === v ? 'selected' : ''}>${h(x)}</option>`).join('')}</select>`;

  el.innerHTML = `
    <div class="cab"><div><h1>Tempo padrão por modelo</h1>
      <p>Roteiro de cada modelo e tecido: processos, tempo padrão (segundos por peça), sequência e pessoas.
      ${pode ? 'Para alterar, clique em <b>Editar</b> no modelo. A alteração vale só para os apontamentos novos e fica registrada no histórico.' : ''}</p></div></div>
    <div class="filtros">
      <div class="campo"><label>Modelo</label>${sel('f-prod', produtos, filtro.produto)}</div>
      <div class="campo"><label>Tecido</label>${sel('f-tec', tecidos, filtro.tecido)}</div>
    </div>
    <div id="lista"></div>
    <details class="card" id="hist"><summary class="forte">Histórico de alterações</summary><div id="hist-corpo"><p class="muted">Carregando…</p></div></details>`;

  el.querySelector('#f-prod').onchange = (e) => { filtro.produto = e.target.value; desenhar(); };
  el.querySelector('#f-tec').onchange = (e) => { filtro.tecido = e.target.value; desenhar(); };
  el.querySelector('#hist').ontoggle = (e) => { if (e.target.open) carregarHistorico(); };

  const nomeGrupo = (r) => `${r.produto?.nome} · ${r.tecido?.nome}`;

  function desenhar() {
    const grupos = new Map();
    for (const r of rows) {
      if (filtro.produto && r.produto?.nome !== filtro.produto) continue;
      if (filtro.tecido && r.tecido?.nome !== filtro.tecido) continue;
      const k = nomeGrupo(r);
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(r);
    }
    let html = '';
    for (const [nome, itens] of grupos) {
      const ed = editando === nome;
      const comTempo = itens.filter(i => i.tempo_padrao_seg != null);
      const total = comTempo.reduce((s, i) => s + Number(i.tempo_padrao_seg), 0);
      const botoes = !pode ? '' : ed
        ? `<button class="btn peq" data-cancelar>Cancelar</button> <button class="btn peq acento" data-salvar>Salvar edição</button>`
        : `<button class="btn peq" data-editar="${h(nome)}" ${editando ? 'disabled' : ''}>✏️ Editar</button>`;
      html += `<div class="roteiro-grupo ${ed ? 'editando' : ''}">
        <div class="roteiro-cab"><h2>${h(nome)}
          ${comTempo.length < itens.length ? chip(`${itens.length - comTempo.length} sem tempo`, 'erro') : chip('completo', 'ok')}</h2>
          <div>${botoes}</div></div>
        <div class="tabela-wrap"><table>
          <thead><tr><th>Processo</th><th class="dir">Tempo padrão (seg)</th><th class="dir">Sequência</th><th class="dir">Pessoas</th></tr></thead>
          <tbody>${itens.map(i => linha(i, ed)).join('')}</tbody>
          <tfoot><tr><td>Total da peça (processos com tempo)</td><td class="dir">${num(total, 2)} s · ${num(total / 60, 2)} min</td><td></td><td></td></tr></tfoot>
        </table></div></div>`;
    }
    const lista = el.querySelector('#lista');
    lista.innerHTML = html || '<div class="card"><p>Nenhum roteiro para esse filtro.</p></div>';
    lista.querySelectorAll('[data-editar]').forEach(b => b.onclick = () => { editando = b.dataset.editar; desenhar(); });
    lista.querySelector('[data-cancelar]')?.addEventListener('click', () => { editando = null; desenhar(); });
    lista.querySelector('[data-salvar]')?.addEventListener('click', salvar);
    lista.querySelector('.editando input')?.focus();
  }

  async function salvar() {
    const box = el.querySelector('.roteiro-grupo.editando');
    const mudancas = [], resumo = [];
    for (const inp of box.querySelectorAll('input[data-id]')) {
      const r = rows.find(x => String(x.id) === inp.dataset.id), campo = inp.dataset.campo;
      const txt = inp.value.trim().replace(',', '.');
      const valor = txt === '' ? null : Number(txt);
      if (valor != null && (!isFinite(valor) || valor < 0 || (campo !== 'tempo_padrao_seg' && !Number.isInteger(valor)))) {
        inp.focus(); return toast(`${r.processo?.nome}: ${CAMPOS[campo]} inválido.`, 'erro');
      }
      if (valor === (r[campo] == null ? null : Number(r[campo]))) continue;
      let m = mudancas.find(x => x.id === r.id);
      if (!m) mudancas.push(m = { id: r.id });
      m[campo] = valor;
      resumo.push(`<li><b>${h(r.processo?.nome)}</b> · ${h(CAMPOS[campo])}: ${h(fmt(campo, r[campo]))} → <b>${h(fmt(campo, valor))}</b></li>`);
    }
    if (!mudancas.length) { editando = null; desenhar(); return toast('Nada foi alterado.'); }
    const motivo = await pedirTexto('Salvar edição do tempo padrão',
      `<b>${h(editando)}</b><ul style="margin:8px 0 8px 18px">${resumo.join('')}</ul>
       Vale para os apontamentos feitos a partir de agora. Os já gravados não mudam.`,
      { rotulo: 'Motivo da alteração (fica no histórico)', botao: 'Salvar edição', classe: 'acento' });
    if (motivo == null) return;
    const { error } = await db.rpc('salvar_roteiro', { p_alteracoes: mudancas, p_motivo: motivo });
    if (error) return toast(msgErro(error), 'erro');
    for (const m of mudancas) Object.assign(rows.find(x => x.id === m.id), m);
    ordenar(); limparCache();
    editando = null;
    toast(`Salvo: ${resumo.length} alteração(ões).`, 'ok');
    desenhar();
    if (el.querySelector('#hist').open) carregarHistorico();
  }

  async function carregarHistorico() {
    const corpo = el.querySelector('#hist-corpo');
    const hist = await ler(db.from('roteiro_historico').select('*').order('alterado_em', { ascending: false }).limit(200));
    corpo.innerHTML = hist.length ? `<div class="tabela-wrap"><table>
      <thead><tr><th>Quando</th><th>Modelo · tecido</th><th>Processo</th><th>Campo</th><th class="dir">De</th><th class="dir">Para</th><th>Motivo</th><th>Quem</th></tr></thead>
      <tbody>${hist.map(x => `<tr><td>${h(dataHora(x.alterado_em))}</td><td>${h(x.produto)} · ${h(x.tecido)}</td><td>${h(x.processo)}</td>
        <td>${h(CAMPOS[x.campo] || x.campo)}</td><td class="dir">${h(fmt(x.campo, x.valor_anterior))}</td><td class="dir forte">${h(fmt(x.campo, x.valor_novo))}</td>
        <td>${h(x.motivo || '')}</td><td>${h(x.alterado_por || '')}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="muted">Nenhuma alteração registrada ainda.</p>';
  }

  desenhar();
}

function linha(i, ed) {
  const v = (campo) => ed
    ? `<input class="tempo-ed" inputmode="decimal" data-id="${i.id}" data-campo="${campo}" value="${h(i[campo] ?? '')}" placeholder="vazio">`
    : (i[campo] == null ? '<span class="vazio">vazio</span>' : h(fmt(campo, i[campo])));
  return `<tr><td class="forte">${h(i.processo?.nome || '')}</td>
    <td class="dir">${v('tempo_padrao_seg')}</td><td class="dir">${v('sequencia')}</td><td class="dir">${v('pessoas')}</td></tr>`;
}
