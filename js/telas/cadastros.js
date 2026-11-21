import { db } from '../estado.js';
import { h, chip, ler, toast, msgErro, modal, limparCache, pedirTexto } from '../util.js';

// Cadastros (perfil cadastros/admin): operadores com processos e jornada, produtos, tecidos, cores, elásticos e processos.
// A jornada (minutos por dia da semana) é a base da eficiência no Painel.
const ABAS = [
  ['operadores', 'Operadores'], ['produtos', 'Produtos'], ['tecidos', 'Tecidos'],
  ['cores', 'Cores'], ['elasticos', 'Elásticos'], ['processos', 'Processos'],
];
const DIAS = [[1, 'Seg'], [2, 'Ter'], [3, 'Qua'], [4, 'Qui'], [5, 'Sex'], [6, 'Sáb']];
let aba = 'operadores';
const hm = (m) => m == null ? '' : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;

export async function render(el) {
  el.innerHTML = `
    <div class="cab"><div><h1>Cadastros</h1><p>Listas usadas no corte, no apontamento e no painel. O roteiro (tempo padrão) de cada modelo e tecido fica em <a href="#/roteiro">Tempo padrão por modelo</a>.</p></div></div>
    <div class="abas" id="abas">${ABAS.map(([k, n]) => `<button type="button" data-aba="${k}" class="${k === aba ? 'ativo' : ''}">${n}</button>`).join('')}</div>
    <div id="conteudo" style="margin-top:12px"></div>`;
  el.querySelectorAll('[data-aba]').forEach(b => b.onclick = () => { aba = b.dataset.aba; render(el); });
  const box = el.querySelector('#conteudo');
  const recarregar = () => render(el);
  if (aba === 'operadores') return operadores(box, recarregar);
  if (aba === 'cores') return cores(box, recarregar);
  return listaSimples(box, aba, ABAS.find(a => a[0] === aba)[1], recarregar);
}

// ---------- Operadores ----------
async function operadores(box, recarregar) {
  const [funcs, procs, fp, jor] = await Promise.all([
    ler(db.from('funcionarios').select('*').order('ativo', { ascending: false }).order('nome')),
    ler(db.from('processos').select('*').order('nome')),
    ler(db.from('funcionario_processos').select('*')),
    ler(db.from('funcionario_jornada').select('*')),
  ]);
  const procNome = Object.fromEntries(procs.map(p => [p.id, p.nome]));
  const procsDe = (id) => fp.filter(x => x.funcionario_id === id).map(x => x.processo_id);
  const jornadaDe = (id) => Object.fromEntries(jor.filter(j => j.funcionario_id === id).map(j => [j.dia_semana, j.minutos]));
  const semJornada = funcs.filter(f => f.ativo && !jor.some(j => j.funcionario_id === f.id)).length;
  box.innerHTML = `
    <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap">
      <div class="muted">${funcs.filter(f => f.ativo).length} ativo(s)${semJornada ? ` · <b>${semJornada} sem jornada</b> (a eficiência delas fica em branco no painel)` : ''}</div>
      <button class="btn pri" id="novo">+ Novo operador</button></div>
    <div class="tabela-wrap"><table>
      <thead><tr><th>Nome</th><th>Processos</th>${DIAS.map(([, n]) => `<th class="dir">${n}</th>`).join('')}<th class="dir">Semana</th><th>Status</th><th></th></tr></thead>
      <tbody>${funcs.map(f => {
        const j = jornadaDe(f.id), tot = Object.values(j).reduce((s, m) => s + m, 0);
        return `<tr><td class="forte">${h(f.nome)}</td>
          <td>${procsDe(f.id).map(p => chip(procNome[p] || p)).join(' ') || '<span class="muted">—</span>'}</td>
          ${DIAS.map(([d]) => `<td class="dir">${j[d] ? hm(j[d]) : '<span class="muted">—</span>'}</td>`).join('')}
          <td class="dir forte">${tot ? hm(tot) : '—'}</td>
          <td>${f.ativo ? chip('Ativo', 'ok') : chip('Inativo', 'erro')}</td>
          <td><button class="btn peq" data-ed="${f.id}">Editar</button></td></tr>`;
      }).join('')}</tbody></table></div>`;
  box.querySelector('#novo').onclick = () => formOperador(null, procs, [], {}, recarregar);
  box.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => {
    const f = funcs.find(x => String(x.id) === b.dataset.ed);
    formOperador(f, procs, procsDe(f.id), jornadaDe(f.id), recarregar);
  });
}

function formOperador(f, procs, marcados, jornada, depois) {
  const campoDia = ([d, n]) => {
    const m = jornada[d];
    return `<label class="campo" style="min-width:0">${n}<input type="time" data-dia="${d}" value="${m ? `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` : ''}" step="60"></label>`;
  };
  modal({
    titulo: f ? `Editar ${f.nome}` : 'Novo operador', largo: true,
    corpo: `<div class="grade">
      <label class="campo">Nome<input id="op-nome" value="${h(f?.nome || '')}" maxlength="60"></label>
      ${f ? `<label><input type="checkbox" id="op-ativo" ${f.ativo ? 'checked' : ''}> Ativo (aparece no apontamento)</label>` : ''}
      <div><b>Processos que faz</b> <span class="muted peq">(aparecem primeiro na lista do apontamento)</span>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:4px;margin-top:6px">
          ${procs.filter(p => p.ativo || marcados.includes(p.id)).map(p => `<label><input type="checkbox" data-proc="${p.id}" ${marcados.includes(p.id) ? 'checked' : ''}> ${h(p.nome)}</label>`).join('')}
        </div></div>
      <div><b>Jornada</b> <span class="muted peq">(horas trabalhadas em cada dia, já sem intervalo; vazio = não trabalha)</span>
        <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:6px;margin-top:6px">${DIAS.map(campoDia).join('')}</div>
        <button type="button" class="btn peq" id="copiar" style="margin-top:6px">Copiar segunda para terça a quinta</button>
        <div class="muted peq" id="tot-sem" style="margin-top:4px"></div></div>
    </div>`,
    aoAbrir: (m) => {
      const totalizar = () => {
        let t = 0; m.querySelectorAll('[data-dia]').forEach(i => { t += minutos(i.value) || 0; });
        m.querySelector('#tot-sem').textContent = t ? `Total na semana: ${hm(t)} (${t} min)` : '';
      };
      m.querySelectorAll('[data-dia]').forEach(i => i.oninput = totalizar);
      m.querySelector('#copiar').onclick = () => {
        const seg = m.querySelector('[data-dia="1"]').value;
        [2, 3, 4].forEach(d => { m.querySelector(`[data-dia="${d}"]`).value = seg; });
        totalizar();
      };
      totalizar();
    },
    botoes: [{ texto: 'Cancelar' }, { texto: 'Salvar', classe: 'pri', acao: async (m) => {
      const nome = m.querySelector('#op-nome').value.trim();
      if (nome.length < 2) { toast('Informe o nome.', 'erro'); return false; }
      const ativo = f ? m.querySelector('#op-ativo').checked : true;
      const procsSel = [...m.querySelectorAll('[data-proc]:checked')].map(i => Number(i.dataset.proc));
      const jor = {};
      m.querySelectorAll('[data-dia]').forEach(i => { const v = minutos(i.value); if (v) jor[i.dataset.dia] = v; });
      try {
        let id = f?.id;
        if (f) {
          const { error } = await db.from('funcionarios').update({ nome, ativo }).eq('id', id);
          if (error) throw error;
        } else {
          const { data, error } = await db.from('funcionarios').insert({ nome, ativo: true }).select('id').single();
          if (error) throw error;
          id = data.id;
        }
        const tirar = marcados.filter(p => !procsSel.includes(p)), por = procsSel.filter(p => !marcados.includes(p));
        if (tirar.length) { const { error } = await db.from('funcionario_processos').delete().eq('funcionario_id', id).in('processo_id', tirar); if (error) throw error; }
        if (por.length) { const { error } = await db.from('funcionario_processos').insert(por.map(p => ({ funcionario_id: id, processo_id: p }))); if (error) throw error; }
        const { error } = await db.rpc('salvar_jornada', { p_funcionario: id, p_jornada: jor });
        if (error) throw error;
      } catch (e) { toast(msgErro(e), 'erro'); return false; }
      limparCache(); toast('Operador salvo.', 'ok'); depois();
    } }],
  });
}
const minutos = (hhmm) => { const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; };

// ---------- Cores (com tonalidades) ----------
async function cores(box, recarregar) {
  const [lista, tons] = await Promise.all([
    ler(db.from('cores').select('*').order('nome')),
    ler(db.from('cor_tonalidades').select('*')),
  ]);
  box.innerHTML = `
    <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap">
      <div class="muted">Tonalidades (PRETO 1, PRETO 2…) são criadas pelo "+ Adicionar cor" no corte ou aqui.</div>
      <button class="btn pri" id="novo">+ Adicionar cor</button></div>
    <div class="tabela-wrap"><table>
      <thead><tr><th>Cor</th><th>Tonalidades</th><th>Status</th><th></th></tr></thead>
      <tbody>${lista.map(c => `<tr><td class="forte">${h(c.nome)}</td>
        <td>${tons.filter(t => t.cor_id === c.id).sort((a, b) => a.tonalidade - b.tonalidade).map(t => chip(`${c.nome} ${t.tonalidade}`)).join(' ') || '<span class="muted">—</span>'}</td>
        <td>${c.ativo ? chip('Ativa', 'ok') : chip('Inativa', 'erro')}</td>
        <td style="white-space:nowrap"><button class="btn peq" data-ren="${c.id}">Renomear</button>
          <button class="btn peq" data-at="${c.id}">${c.ativo ? 'Inativar' : 'Ativar'}</button></td></tr>`).join('')}</tbody></table></div>`;
  box.querySelector('#novo').onclick = async () => {
    const nome = await pedirTexto('Adicionar cor', 'Digite a cor. Com número vira tonalidade (ex.: <b>PRETO 3</b>).', { rotulo: 'Cor', minimo: 2, botao: 'Adicionar', classe: 'pri' });
    if (!nome) return;
    const { error } = await db.rpc('adicionar_cor', { p_nome: nome });
    if (error) return toast(msgErro(error), 'erro');
    limparCache(); toast('Cor adicionada.', 'ok'); recarregar();
  };
  ligarAcoes(box, 'cores', lista, recarregar);
}

// ---------- Listas simples (nome + ativo) ----------
async function listaSimples(box, tabela, titulo, recarregar) {
  const lista = await ler(db.from(tabela).select('*').order('nome'));
  box.innerHTML = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:10px"><button class="btn pri" id="novo">+ Adicionar</button></div>
    ${['produtos', 'tecidos', 'processos'].includes(tabela) ? `<div class="aviso-box">Ao adicionar, o roteiro é criado com tempo vazio. Preencha os tempos em <a href="#/roteiro">Tempo padrão por modelo</a> antes de usar no apontamento.</div>` : ''}
    <div class="tabela-wrap"><table>
      <thead><tr><th>${h(titulo)}</th><th>Status</th><th></th></tr></thead>
      <tbody>${lista.map(x => `<tr><td class="forte">${h(x.nome)}</td>
        <td>${x.ativo ? chip('Ativo', 'ok') : chip('Inativo', 'erro')}</td>
        <td style="white-space:nowrap"><button class="btn peq" data-ren="${x.id}">Renomear</button>
          <button class="btn peq" data-at="${x.id}">${x.ativo ? 'Inativar' : 'Ativar'}</button></td></tr>`).join('')}</tbody></table></div>`;
  box.querySelector('#novo').onclick = async () => {
    const nome = await pedirTexto(`Adicionar em ${titulo}`, '', { rotulo: 'Nome', minimo: 2, botao: 'Adicionar', classe: 'pri' });
    if (!nome) return;
    const valor = ['cores', 'elasticos'].includes(tabela) ? nome.toUpperCase() : nome;
    const { error } = await db.from(tabela).insert({ nome: valor });
    if (error) return toast(msgErro(error), 'erro');
    limparCache(); toast('Adicionado.', 'ok'); recarregar();
  };
  ligarAcoes(box, tabela, lista, recarregar);
}

function ligarAcoes(box, tabela, lista, recarregar) {
  box.querySelectorAll('[data-ren]').forEach(b => b.onclick = async () => {
    const x = lista.find(i => String(i.id) === b.dataset.ren);
    const nome = await pedirTexto('Renomear', `Novo nome para <b>${h(x.nome)}</b>. Vale para todo o histórico que usa este item.`, { rotulo: 'Nome', minimo: 2, botao: 'Salvar', classe: 'pri', valor: x.nome });
    if (!nome || nome === x.nome) return;
    const { error } = await db.from(tabela).update({ nome }).eq('id', x.id);
    if (error) return toast(msgErro(error), 'erro');
    limparCache(); toast('Salvo.', 'ok'); recarregar();
  });
  box.querySelectorAll('[data-at]').forEach(b => b.onclick = async () => {
    const x = lista.find(i => String(i.id) === b.dataset.at);
    const { error } = await db.from(tabela).update({ ativo: !x.ativo }).eq('id', x.id);
    if (error) return toast(msgErro(error), 'erro');
    limparCache(); toast(x.ativo ? 'Inativado: some das listas, mas o histórico fica.' : 'Ativado.', 'ok'); recarregar();
  });
}
