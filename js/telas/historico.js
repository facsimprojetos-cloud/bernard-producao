import { db, tem } from '../estado.js';
import { h, num, chip, ler, toast, msgErro, modal, hojeISO, data, dataHora, cadastros, porId, minutosApont, pedirTexto } from '../util.js';

// Histórico de apontamentos (perfil supervisor): ver apontamento por apontamento, de qualquer dia,
// e alterar ou excluir com motivo. Tudo fica registrado em "Alterações e exclusões".
const LIMITE = 1000;
const st = { ini: null, fim: null, func: '', proc: '', corte: '' };
let cad = null;

export async function render(el) {
  cad = await cadastros(db, true);
  if (!st.ini) { // abre no último dia com apontamento
    const ult = await ler(db.from('apontamentos').select('data_producao').order('data_producao', { ascending: false }).limit(1));
    st.ini = st.fim = ult[0]?.data_producao || hojeISO();
  }
  const funcs = [...cad.funcionarios].sort((a, b) => a.nome.localeCompare(b.nome));
  const procs = [...cad.processos].sort((a, b) => a.nome.localeCompare(b.nome));
  const sel = (id, lista, v, vazio) => `<select id="${id}"><option value="">${vazio}</option>${lista.map(x => `<option value="${x.id}" ${String(x.id) === String(v) ? 'selected' : ''}>${h(x.nome)}${x.ativo === false ? ' (inativo)' : ''}</option>`).join('')}</select>`;
  el.innerHTML = `
    ${abasApontamento('historico')}
    <div class="cab"><div><h1>Histórico de apontamentos</h1><p>Todos os apontamentos, inclusive os migrados do AppSheet. Alterar ou excluir pede o motivo e fica registrado.</p></div></div>
    <div class="filtros">
      <div class="campo"><label>De</label><input type="date" id="ini" value="${h(st.ini)}"></div>
      <div class="campo"><label>Até</label><input type="date" id="fim" value="${h(st.fim)}" max="${hojeISO()}"></div>
      <div class="campo"><label>Operador(a)</label>${sel('func', funcs, st.func, 'Todos')}</div>
      <div class="campo"><label>Processo</label>${sel('proc', procs, st.proc, 'Todos')}</div>
      <div class="campo" style="max-width:140px"><label>Corte nº</label><input id="corte" inputmode="numeric" value="${h(st.corte)}" placeholder="ex.: 541"></div>
    </div>
    <div id="lista"><p class="muted">Carregando…</p></div>
    <details class="card" id="alt"><summary class="forte" style="cursor:pointer">Alterações e exclusões</summary><div id="alt-corpo"><p class="muted">Carregando…</p></div></details>`;
  const ler_ = () => { st.ini = el.querySelector('#ini').value; st.fim = el.querySelector('#fim').value; st.func = el.querySelector('#func').value; st.proc = el.querySelector('#proc').value; st.corte = el.querySelector('#corte').value.trim(); carregar(el); };
  ['ini', 'fim', 'func', 'proc'].forEach(id => el.querySelector('#' + id).onchange = ler_);
  el.querySelector('#corte').onchange = ler_;
  el.querySelector('#alt').ontoggle = (e) => { if (e.target.open) alteracoes(el.querySelector('#alt-corpo')); };
  carregar(el);
}

export function abasApontamento(ativa) {
  if (!tem('supervisor')) return '';
  return `<div class="abas"><a class="aba-link ${ativa === 'lancar' ? 'ativo' : ''}" href="#/apontamento">📷 Lançar apontamento</a><a class="aba-link ${ativa === 'historico' ? 'ativo' : ''}" href="#/historico">🗒️ Histórico</a></div>`;
}

async function carregar(el) {
  const box = el.querySelector('#lista');
  if (!st.ini || !st.fim || st.ini > st.fim) { box.innerHTML = '<div class="card">Escolha um período válido.</div>'; return; }
  box.innerHTML = '<p class="muted">Carregando…</p>';
  let q = db.from('apontamentos')
    .select('id,qtd,tempo_padrao_seg,tempo_total_min_original,data_hora,data_producao,origem,obs,processo_id,funcionario_id,corte_item_id,corte_texto_original')
    .gte('data_producao', st.ini).lte('data_producao', st.fim)
    .order('data_producao', { ascending: false }).order('data_hora', { ascending: false }).limit(LIMITE);
  if (st.func) q = q.eq('funcionario_id', st.func);
  if (st.proc) q = q.eq('processo_id', st.proc);
  if (st.corte) {
    if (!/^\d+$/.test(st.corte)) { box.innerHTML = '<div class="card">Corte nº: digite só o número.</div>'; return; }
    const its = await ler(db.from('corte_itens').select('id, cortes!inner(numero)').eq('cortes.numero', Number(st.corte)));
    if (!its.length) { box.innerHTML = `<div class="card">Nenhum corte nº ${h(st.corte)}.</div>`; return; }
    q = q.in('corte_item_id', its.map(i => i.id));
  }
  const lista = await ler(q);
  const ids = [...new Set(lista.map(a => a.corte_item_id).filter(Boolean))];
  const itens = {};
  for (let i = 0; i < ids.length; i += 200) {
    Object.assign(itens, porId(await ler(db.from('v_corte_itens').select('id,codigo,nome_exibicao,produto,tecido').in('id', ids.slice(i, i + 200)))));
  }
  const procs = porId(cad.processos), funcs = porId(cad.funcionarios);
  const pecas = lista.reduce((s, a) => s + (Number(a.qtd) || 0), 0), mins = lista.reduce((s, a) => s + minutosApont(a), 0);
  const sup = tem('supervisor');
  box.innerHTML = `
    <div class="resumo-dia">
      <div><small>Apontamentos</small><b>${num(lista.length)}</b></div>
      <div><small>Peças</small><b>${num(pecas)}</b></div>
      <div><small>Minutos</small><b>${num(mins)}</b></div>
    </div>
    ${lista.length >= LIMITE ? `<div class="aviso-box">Mostrando só os ${LIMITE} mais recentes (os totais acima são só deles). Use os filtros ou um período menor.</div>` : ''}
    <div class="tabela-wrap"><table>
      <thead><tr><th>Dia</th><th>Hora</th><th>Pacote</th><th>Processo</th><th>Operador(a)</th><th class="dir">Peças</th><th class="dir">Min</th><th>Obs.</th><th></th></tr></thead>
      <tbody>${lista.map(a => {
        const it = itens[a.corte_item_id];
        return `<tr><td>${h(data(a.data_producao))}</td>
          <td class="muted">${new Date(a.data_hora).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })}</td>
          <td>${h(it?.nome_exibicao || a.corte_texto_original || '—')} ${a.origem === 'APPSHEET' ? chip('AppSheet') : ''}</td>
          <td>${h(procs[a.processo_id]?.nome || '—')}</td>
          <td class="forte">${h(funcs[a.funcionario_id]?.nome || '—')}</td>
          <td class="dir">${num(a.qtd)}</td><td class="dir">${num(minutosApont(a))}</td>
          <td class="peq">${h(a.obs || '')}</td>
          <td style="white-space:nowrap">${sup ? `<button class="btn peq" data-ed="${a.id}">Alterar</button> <button class="btn peq perigo" data-ex="${a.id}">Excluir</button>` : ''}</td></tr>`;
      }).join('') || '<tr><td colspan="9" class="vazio">Nenhum apontamento com esses filtros.</td></tr>'}</tbody>
    </table></div>`;
  const achar = (id) => lista.find(a => a.id === id);
  box.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => editar(achar(b.dataset.ed), itens, () => carregar(el)));
  box.querySelectorAll('[data-ex]').forEach(b => b.onclick = () => excluir(achar(b.dataset.ex), itens, () => carregar(el)));
}

function descricao(a, itens) {
  const it = itens[a.corte_item_id];
  return `${it?.nome_exibicao || a.corte_texto_original || 'pacote'} · ${cad.processos.find(p => p.id === a.processo_id)?.nome || ''} · ${cad.funcionarios.find(f => f.id === a.funcionario_id)?.nome || ''} · ${num(a.qtd)} peça(s) · ${data(a.data_producao)}`;
}

function editar(a, itens, depois) {
  const funcs = [...cad.funcionarios].sort((x, y) => x.nome.localeCompare(y.nome));
  const procs = [...cad.processos].sort((x, y) => x.nome.localeCompare(y.nome));
  const op = (lista, v) => lista.map(x => `<option value="${x.id}" ${x.id === v ? 'selected' : ''}>${h(x.nome)}${x.ativo === false ? ' (inativo)' : ''}</option>`).join('');
  modal({
    titulo: 'Alterar apontamento',
    corpo: `<p class="muted peq" style="margin-top:0">${h(descricao(a, itens))}</p>
      <div class="grade">
        <label class="campo">Operador(a)<select id="e-func">${op(funcs, a.funcionario_id)}</select></label>
        <label class="campo">Processo<select id="e-proc">${op(procs, a.processo_id)}</select></label>
        <label class="campo">Quantidade<input id="e-qtd" type="number" min="1" step="1" value="${h(a.qtd)}"></label>
        <label class="campo">Dia de produção<input id="e-data" type="date" max="${hojeISO()}" value="${h(a.data_producao)}"></label>
        <label class="campo">Observação<input id="e-obs" maxlength="200" value="${h(a.obs || '')}"></label>
        <div class="muted peq">Se mudar o processo ou a quantidade, os minutos são recalculados pelo tempo padrão.</div>
        <label class="campo">Motivo da alteração (fica registrado)<input id="e-mot" maxlength="200"></label>
      </div>`,
    botoes: [{ texto: 'Cancelar' }, { texto: 'Salvar alteração', classe: 'pri', acao: async (m) => {
      const { data: r, error } = await db.rpc('editar_apontamento', {
        p_id: a.id, p_funcionario: Number(m.querySelector('#e-func').value), p_processo: Number(m.querySelector('#e-proc').value),
        p_qtd: Math.trunc(Number(m.querySelector('#e-qtd').value) || 0), p_data_producao: m.querySelector('#e-data').value,
        p_obs: m.querySelector('#e-obs').value, p_motivo: m.querySelector('#e-mot').value });
      if (error) { toast(msgErro(error), 'erro'); return false; }
      toast(`Apontamento alterado · ${num(r.minutos)} min`, 'ok'); depois();
    } }],
  });
}

async function excluir(a, itens, depois) {
  const motivo = await pedirTexto('Excluir apontamento', `<b>${h(descricao(a, itens))}</b><br>O apontamento sai do fechamento e do painel. Fica registrado em "Alterações e exclusões".`,
    { rotulo: 'Motivo da exclusão', botao: 'Excluir' });
  if (!motivo) return;
  const { error } = await db.rpc('excluir_apontamento', { p_id: a.id, p_motivo: motivo });
  if (error) return toast(msgErro(error), 'erro');
  toast('Apontamento excluído.', 'ok'); depois();
}

async function alteracoes(box) {
  const lista = await ler(db.from('apontamento_alteracoes').select('*').order('alterado_em', { ascending: false }).limit(300));
  const procs = porId(cad.processos), funcs = porId(cad.funcionarios);
  const resumo = (x) => x ? `${funcs[x.funcionario_id]?.nome || '—'} · ${procs[x.processo_id]?.nome || '—'} · ${num(x.qtd)} pç · ${data(x.data_producao)}` : '—';
  box.innerHTML = lista.length ? `<div class="tabela-wrap"><table>
    <thead><tr><th>Quando</th><th>Ação</th><th>Antes</th><th>Depois</th><th>Motivo</th><th>Quem</th></tr></thead>
    <tbody>${lista.map(x => `<tr><td>${h(dataHora(x.alterado_em))}</td><td>${x.acao === 'EXCLUIDO' ? chip('Excluído', 'erro') : chip('Alterado', 'alerta')}</td>
      <td class="peq">${h(resumo(x.antes))}</td><td class="peq">${h(resumo(x.depois))}</td><td>${h(x.motivo)}</td><td class="peq">${h(x.alterado_por || '')}</td></tr>`).join('')}</tbody></table></div>`
    : '<p class="muted">Nenhuma alteração ou exclusão ainda.</p>';
}
