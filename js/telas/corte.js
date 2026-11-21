import { db, tem } from '../estado.js';
import { h, num, data, chip, ler, toast, msgErro, confirmar, modal, opcoes, hojeISO, cadastros, ativos, porId, pedirTexto, limparCache } from '../util.js';
import { abrirEtiquetas } from '../etiquetas.js?v=202611211745';

let cad = null;
let busca = '';

// Cor + tonalidade numa lista só ("PRETO 2"), como o pessoal já usa
const chaveCor = (cor_id, ton) => `${cor_id ?? ''}|${ton ?? ''}`;
async function carregarCoresCorte() {
  const lista = await ler(db.from('v_cores_corte').select('*'));
  return lista.sort((a, b) => {
    const na = a.nome.replace(/\s*\d+$/, ''), nb = b.nome.replace(/\s*\d+$/, '');
    return na.localeCompare(nb, 'pt-BR') || (a.tonalidade || 0) - (b.tonalidade || 0);
  });
}
function opcoesCor(lista, chave) {
  const vis = lista.filter(c => c.ativo !== false || c.chave === chave);
  return `<option value="">Selecione…</option>` + vis.map(c => `<option value="${h(c.chave)}" ${c.chave === chave ? 'selected' : ''}>${h(c.nome)}</option>`).join('');
}

export async function render(el) {
  cad = await cadastros(db);
  const rota = location.hash.split('/')[2] || '';
  if (rota === 'novo') return editor(el, null);
  if (/^[0-9a-f-]{36}$/i.test(rota)) return editor(el, rota);
  return lista(el);
}

// ---------- Lista ----------
async function lista(el) {
  let q = db.from('v_cortes').select('*').order('numero', { ascending: false }).order('tipo_risco_id').limit(80);
  const n = parseInt(busca, 10);
  if (busca && n) q = db.from('v_cortes').select('*').eq('numero', n).order('tipo_risco_id');
  const cortes = await ler(q);
  const pode = tem('corte');
  el.innerHTML = `
    <div class="cab"><div><h1>Corte e etiquetas</h1><p>Cada linha (cor + tamanho) vira uma folha de acompanhamento com QR, que segue com a caixa.</p></div>
      ${pode ? '<a class="btn pri" href="#/corte/novo">+ Novo corte</a>' : ''}</div>
    <form class="filtros" id="f-busca"><label class="campo" style="max-width:220px">Nº do corte<input id="busca" inputmode="numeric" value="${h(busca)}" placeholder="Ex.: 550"></label>
      <button class="btn">Buscar</button>${busca ? '<button class="btn" type="button" id="limpa">Ver últimos</button>' : ''}</form>
    <div class="tabela-wrap"><table>
      <thead><tr><th>Corte</th><th>Risco</th><th>Data</th><th>Produto</th><th>Tecido</th><th class="n">Linhas</th><th class="n">Peças</th><th></th></tr></thead>
      <tbody>${cortes.map(c => `<tr>
        <td class="forte">${h(c.numero)}${c.sequencia > 1 ? '/' + h(c.sequencia) : ''}${c.importado ? ' ' + chip('AppSheet') : ''}</td>
        <td>${h(c.tipo_risco || '')}</td><td>${data(c.data)}</td><td>${h(c.produto)}</td><td>${h(c.tecido || '')}</td>
        <td class="n">${num(c.linhas)}</td><td class="n">${num(c.pecas)}</td>
        <td><div class="acoes" style="flex-wrap:nowrap"><a class="btn peq" href="#/corte/${c.id}">${pode ? 'Abrir' : 'Ver'}</a>
          <button class="btn peq pri" data-etq="${c.id}">Etiquetas</button></div></td></tr>`).join('')
        || '<tr><td colspan="8" class="vazio">Nenhum corte encontrado.</td></tr>'}</tbody></table></div>`;
  el.querySelector('#f-busca').onsubmit = (e) => { e.preventDefault(); busca = el.querySelector('#busca').value.trim(); lista(el); };
  el.querySelector('#limpa')?.addEventListener('click', () => { busca = ''; lista(el); });
  el.querySelectorAll('[data-etq]').forEach(b => b.onclick = () => abrirEtiquetas(b.dataset.etq));
}

// ---------- Editor (novo ou existente) ----------
async function editor(el, id) {
  const pode = tem('corte');
  let c;
  if (id) {
    const { data: d, error } = await db.rpc('corte_detalhe', { p_id: id });
    if (error) { el.innerHTML = `<div class="card erro-box">${h(msgErro(error))}</div>`; return; }
    c = d;
  } else {
    if (!pode) { el.innerHTML = '<div class="card">Acesso restrito ao perfil corte.</div>'; return; }
    const ult = await ler(db.from('cortes').select('numero').order('numero', { ascending: false }).limit(1));
    c = { numero: (ult[0]?.numero || 0) + 1, sequencia: 1, data: hojeISO(), destino: 'INTERNO', itens: [],
          tipo_risco_id: cad.tiposRisco[0]?.id, produto_id: cad.produtos.length === 1 ? cad.produtos[0].id : null };
  }
  const st = { c, linhas: (c.itens || []).map(i => ({ ...i, elasticos: (i.elasticos || []).map(Number) })), sujo: false };
  let coresCorte = await carregarCoresCorte();
  let elas = porId(cad.elasticos);
  const tamsAtivos = cad.tamanhos;
  let gradeElas = [];

  const nomeCor = (l) => coresCorte.find(x => x.chave === chaveCor(l.cor_id, l.tonalidade))?.nome || '';
  const nomeElas = (ids) => ids.map(i => elas[i]?.nome).filter(Boolean).join(' + ');
  const chipsElas = (sel) => ativos(cad.elasticos, null).concat(cad.elasticos.filter(e => e.ativo === false && sel.has(e.id)))
    .map(e => `<button type="button" data-e="${e.id}" class="${sel.has(e.id) ? 'on' : ''}">${h(e.nome)}</button>`).join('');

  // + Adicionar cor / elástico (cadastra na hora e já seleciona)
  const novaCor = async () => {
    const nome = await pedirTexto('Adicionar cor', 'Digite a cor como vocês usam, com o número da tonalidade se tiver. Ex.: <b>PRETO 3</b>, <b>MARINHO</b>.',
      { rotulo: 'Cor', minimo: 2, botao: 'Adicionar', classe: 'pri' });
    if (!nome) return null;
    const { data: r, error } = await db.rpc('adicionar_cor', { p_nome: nome });
    if (error) { toast(msgErro(error), 'erro'); return null; }
    limparCache(); cad = await cadastros(db, true); coresCorte = await carregarCoresCorte();
    toast(`Cor ${r.nome} disponível na lista.`, 'ok');
    return r.chave;
  };
  const novoElastico = async () => {
    const nome = await pedirTexto('Adicionar elástico', 'Digite a marca do elástico. Ex.: <b>FERRANTELLI ITALY</b>.',
      { rotulo: 'Elástico', minimo: 2, botao: 'Adicionar', classe: 'pri' });
    if (!nome) return null;
    const { data: r, error } = await db.rpc('adicionar_elastico', { p_nome: nome });
    if (error) { toast(msgErro(error), 'erro'); return null; }
    limparCache(); cad = await cadastros(db, true); elas = porId(cad.elasticos);
    toast(`Elástico ${r.nome} disponível na lista.`, 'ok');
    return Number(r.id);
  };
  const totais = () => ({ linhas: st.linhas.length, pecas: st.linhas.reduce((s, l) => s + (Number(l.qtd) || 0), 0) });

  el.innerHTML = `
    <div class="cab"><div><h1>${id ? `Corte ${h(c.numero)}${c.sequencia > 1 ? '/' + h(c.sequencia) : ''}` : 'Novo corte'}</h1>
      <p>${id ? (c.importado ? 'Corte importado do AppSheet.' : 'Corte lançado no app.') : 'Preencha o cabeçalho e adicione as linhas (sem limite).'}</p></div>
      <div class="acoes"><a class="btn" href="#/corte">← Voltar</a>${id ? `<button class="btn pri" id="etq">Etiquetas</button>` : ''}</div></div>
    <form id="f-cab" class="card grade g4">
      <label class="campo">Número<input type="number" name="numero" min="1" required value="${h(c.numero)}"></label>
      <label class="campo">Sequência<input type="number" name="sequencia" min="1" value="${h(c.sequencia || 1)}"></label>
      <label class="campo">Tipo de risco<select name="tipo_risco_id" required>${opcoes(ativos(cad.tiposRisco, c.tipo_risco_id), c.tipo_risco_id)}</select></label>
      <label class="campo">Data<input type="date" name="data" value="${h(c.data || hojeISO())}"></label>
      <label class="campo">Produto<select name="produto_id" required>${opcoes(ativos(cad.produtos, c.produto_id), c.produto_id)}</select></label>
      <label class="campo">Tecido<select name="tecido_id" required>${opcoes(ativos(cad.tecidos, c.tecido_id), c.tecido_id)}</select></label>
      <label class="campo" style="grid-column:1/-1">Observação<input name="obs" value="${h(c.obs || '')}"></label>
    </form>
    ${pode ? `<div class="card">
      <h2>Adicionar em grade</h2>
      <div class="linha-cor-elas">
        <label class="campo">Cor<select id="g-cor">${opcoesCor(coresCorte, null)}</select></label>
        <button type="button" class="btn" id="g-nova-cor">+ Adicionar cor</button>
        <label class="campo">Elástico<select id="g-elas">${opcoes(ativos(cad.elasticos), null, 'nome', 'id', 'Sem elástico')}</select></label>
        <button type="button" class="btn" id="g-novo-elas">+ Adicionar elástico</button>
      </div>
      <div class="peq forte" style="margin:10px 0 4px">Quantidade por tamanho</div>
      <div class="grade-tam">${tamsAtivos.map(t => `<div><label>${h(t.nome)}</label><input type="number" min="0" inputmode="numeric" data-gt="${t.id}"></div>`).join('')}</div>
      <div class="acoes" style="margin-top:10px"><button class="btn acento" type="button" id="g-add">Adicionar linhas</button></div>
    </div>` : ''}
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><h2 style="margin:0">Linhas</h2>
        ${pode ? '<button class="btn peq" type="button" id="add1">+ Linha avulsa</button>' : ''}</div>
      <div class="tabela-wrap" style="margin-top:8px"><table class="tab-linhas"><thead><tr><th>Cor</th><th>Tamanho</th><th class="n">Qtd</th><th>Elástico(s)</th><th>Código</th><th></th></tr></thead>
      <tbody id="linhas"></tbody></table></div>
    </div>
    ${pode ? `<div class="total-barra"><div><span id="tot"></span></div>
      <div class="acoes"><button class="btn" id="salvar">Salvar</button><button class="btn pri" id="salvar-etq">Salvar e imprimir etiquetas</button></div></div>` : ''}`;

  const fCab = el.querySelector('#f-cab');
  if (!pode) fCab.querySelectorAll('input,select').forEach(i => { i.disabled = true; });
  fCab.addEventListener('input', () => { st.sujo = true; });
  el.querySelector('#etq')?.addEventListener('click', async () => {
    if (st.sujo && !await confirmar('Alterações não salvas', 'Há alterações não salvas. As etiquetas saem com os dados já gravados. Continuar?')) return;
    abrirEtiquetas(id);
  });

  // linhas
  const tb = el.querySelector('#linhas');
  const desenhar = () => {
    tb.innerHTML = st.linhas.map((l, i) => {
      const trava = !pode;
      return `<tr data-i="${i}">
        <td><select data-f="cor" ${trava ? 'disabled' : ''}>${opcoesCor(coresCorte, chaveCor(l.cor_id, l.tonalidade))}</select></td>
        <td><select data-f="tamanho_id" ${trava ? 'disabled' : ''}>${opcoes(tamsAtivos, l.tamanho_id)}</select></td>
        <td class="n"><input class="qtd" type="number" min="1" inputmode="numeric" data-f="qtd" value="${h(l.qtd ?? '')}" ${trava ? 'disabled' : ''}></td>
        <td>${h(nomeElas(l.elasticos)) || '<span class="muted">—</span>'} ${pode ? `<button type="button" class="btn peq" data-elas="${i}">✎</button>` : ''}</td>
        <td>${l.codigo ? h(l.codigo) : '<span class="muted peq">novo</span>'}${l.apontamentos ? `<div class="peq muted">${num(l.apontamentos)} apont.</div>` : ''}</td>
        <td>${pode ? (l.apontamentos ? '<span class="peq muted" title="Linha com apontamentos não pode ser removida">🔒</span>'
          : `<button type="button" class="btn peq perigo" data-rm="${i}" title="Remover">×</button>`) : ''}</td></tr>`;
    }).join('') || '<tr><td colspan="6" class="vazio">Nenhuma linha ainda. Use "Adicionar em grade".</td></tr>';
    const t = totais();
    const tot = el.querySelector('#tot'); if (tot) tot.innerHTML = `<b>${num(t.linhas)}</b> linha(s) · <b>${num(t.pecas)}</b> peça(s)`;
  };
  tb.addEventListener('change', (e) => {
    const tr = e.target.closest('tr[data-i]'), f = e.target.dataset.f; if (!tr || !f) return;
    const l = st.linhas[+tr.dataset.i];
    if (f === 'cor') {
      const [cid, ton] = e.target.value.split('|');
      l.cor_id = cid ? Number(cid) : null; l.tonalidade = ton ? Number(ton) : null;
    } else l[f] = e.target.value === '' ? null : Number(e.target.value);
    st.sujo = true; desenhar();
  });
  tb.addEventListener('click', async (e) => {
    const rm = e.target.closest('[data-rm]'), ed = e.target.closest('[data-elas]');
    if (rm) { st.linhas.splice(+rm.dataset.rm, 1); st.sujo = true; desenhar(); }
    if (ed) escolherElasticos(+ed.dataset.elas);
  });

  const escolherElasticos = (i) => {
    const sel = new Set(st.linhas[i].elasticos);
    const ligar = (m) => m.querySelectorAll('.elas [data-e]').forEach(b => b.onclick = () => {
      const v = Number(b.dataset.e); sel.has(v) ? sel.delete(v) : sel.add(v); b.classList.toggle('on');
    });
    modal({
      titulo: 'Elástico(s) da linha',
      corpo: `<div class="elas">${chipsElas(sel)}</div>
        <button type="button" class="btn peq" id="m-novo-elas" style="margin-top:8px">+ Adicionar elástico</button>
        <label style="display:block;margin-top:12px"><input type="checkbox" id="todas"> Aplicar a todas as linhas desta cor</label>`,
      aoAbrir: (m) => {
        ligar(m);
        m.querySelector('#m-novo-elas').onclick = async () => {
          const novo = await novoElastico(); if (!novo) return;
          sel.add(novo); m.querySelector('.elas').innerHTML = chipsElas(sel); ligar(m);
        };
      },
      botoes: [{ texto: 'Cancelar' }, { texto: 'Aplicar', classe: 'pri', acao: (m) => {
        const lista = [...sel].sort((a, b) => a - b), l = st.linhas[i];
        const alvo = m.querySelector('#todas').checked ? st.linhas.filter(x => x.cor_id === l.cor_id && (x.tonalidade ?? null) === (l.tonalidade ?? null)) : [l];
        alvo.forEach(x => { x.elasticos = [...lista]; });
        st.sujo = true; desenhar();
      } }]
    });
  };

  // grade
  const selGradeElas = el.querySelector('#g-elas');
  if (selGradeElas) selGradeElas.onchange = () => { gradeElas = selGradeElas.value ? [Number(selGradeElas.value)] : []; };
  el.querySelector('#g-nova-cor')?.addEventListener('click', async () => {
    const chave = await novaCor(); if (!chave) return;
    el.querySelector('#g-cor').innerHTML = opcoesCor(coresCorte, chave);
    desenhar();
  });
  el.querySelector('#g-novo-elas')?.addEventListener('click', async () => {
    const novo = await novoElastico(); if (!novo) return;
    gradeElas = [novo];
    selGradeElas.innerHTML = opcoes(ativos(cad.elasticos), novo, 'nome', 'id', 'Sem elástico');
    desenhar();
  });
  el.querySelector('#g-add')?.addEventListener('click', () => {
    const [cid, tonTxt] = (el.querySelector('#g-cor').value || '|').split('|');
    const cor = Number(cid) || null, ton = Number(tonTxt) || null;
    if (!cor) return toast('Escolha a cor.', 'erro');
    const novas = [];
    el.querySelectorAll('[data-gt]').forEach(i => { const q = Math.trunc(Number(i.value) || 0); if (q > 0) novas.push({ tamanho_id: Number(i.dataset.gt), qtd: q }); });
    if (!novas.length) return toast('Informe a quantidade de pelo menos um tamanho.', 'erro');
    let somadas = 0;
    novas.forEach(n => {
      const ja = st.linhas.find(l => l.cor_id === cor && (l.tonalidade ?? null) === ton && l.tamanho_id === n.tamanho_id);
      if (ja) { ja.qtd = (Number(ja.qtd) || 0) + n.qtd; somadas++; }
      else st.linhas.push({ cor_id: cor, tonalidade: ton, tamanho_id: n.tamanho_id, qtd: n.qtd, elasticos: [...gradeElas].sort((a, b) => a - b) });
    });
    el.querySelectorAll('[data-gt]').forEach(i => { i.value = ''; });
    st.sujo = true; desenhar();
    toast(`${novas.length} linha(s) de ${nomeCor({ cor_id: cor, tonalidade: ton })}${somadas ? ` (${somadas} somada(s) a linhas existentes)` : ''}.`, 'ok');
  });
  el.querySelector('#add1')?.addEventListener('click', () => {
    const ult = st.linhas[st.linhas.length - 1];
    st.linhas.push({ cor_id: ult?.cor_id ?? null, tonalidade: ult?.tonalidade ?? null, tamanho_id: null, qtd: null, elasticos: [...(ult?.elasticos || [])] });
    st.sujo = true; desenhar();
  });

  const salvar = async (imprimir) => {
    if (!fCab.reportValidity()) return;
    const f = Object.fromEntries(new FormData(fCab));
    const ruim = st.linhas.findIndex(l => !l.cor_id || !l.tamanho_id || !(Number(l.qtd) > 0));
    if (ruim >= 0) return toast(`Linha ${ruim + 1}: preencha cor, tamanho e quantidade.`, 'erro');
    const p = { ...f, destino: c.destino || 'INTERNO', faccao_id: c.faccao_id || null, id: id || null, itens: st.linhas.map(l => ({ id: l.id || null, cor_id: l.cor_id, tonalidade: l.tonalidade || null, tamanho_id: l.tamanho_id, qtd: Number(l.qtd), elasticos: l.elasticos })) };
    const sem = st.linhas.filter(l => !l.elasticos.length).length;
    if (sem && !await confirmar('Linhas sem elástico', `${sem} linha(s) estão sem elástico. Salvar assim mesmo?`, 'Salvar')) return;
    const bts = el.querySelectorAll('#salvar,#salvar-etq'); bts.forEach(b => { b.disabled = true; });
    const { data: novoId, error } = await db.rpc('salvar_corte', { p });
    bts.forEach(b => { b.disabled = false; });
    if (error) return toast(msgErro(error), 'erro');
    st.sujo = false;
    toast('Corte salvo.', 'ok');
    if (imprimir) abrirEtiquetas(novoId);
    if (!id) location.hash = '#/corte/' + novoId; else editor(el, id);
  };
  el.querySelector('#salvar')?.addEventListener('click', () => salvar(false));
  el.querySelector('#salvar-etq')?.addEventListener('click', () => salvar(true));
  desenhar();
}
