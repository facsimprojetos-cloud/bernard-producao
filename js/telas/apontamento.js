import { db, ctx, tem } from '../estado.js';
import { h, num, chip, ler, toast, msgErro, confirmar, hojeISO, data, cadastros, ativos, porId, minutosApont, lerQrCamera, bipSom } from '../util.js';

// Ordem da tela (igual ao AppSheet): Nº do corte (bip/câmera) → modelo, tecido, tamanho, cor e quantidade do pacote
// → processo → operador(a) → observação → gravar. A data de produção vem com hoje e pode ser mudada.
const st = { data: hojeISO(), consulta: null, proc: null, func: '', qtd: null, obs: '', ocupado: false };
let cad = null, raiz = null, pararCam = null;
const fmtSeg = (s) => s == null ? null : `${num(s, Number(s) % 1 ? 2 : 0)} s/peça`;

export async function render(el) {
  raiz = el;
  cad = await cadastros(db);
  el.innerHTML = `
    <div class="cab"><div><h1>Apontamento</h1><p>Bipe o corte, escolha o processo e quem fez.</p></div></div>
    <div class="card bip">
      <form id="f-cod" class="linha-cod" autocomplete="off">
        <label class="campo">Nº do corte<input id="cod" class="scan" placeholder="Bipe o QR ou digite o código" autocapitalize="characters" spellcheck="false" enterkeyhint="go"></label>
        <button class="btn" type="button" id="cam" title="Ler com a câmera">📷 Câmera</button>
        <button class="btn pri" type="submit">OK</button>
      </form>
      <div id="camera"></div>
      <div id="item"></div>
      <details class="peq" style="margin-top:12px" id="det-data"><summary class="muted">Data de produção: <b id="txt-data"></b></summary>
        <label class="campo" id="lb-data" style="max-width:220px;margin-top:6px">Data de produção<input type="date" id="data" value="${h(st.data)}" max="${hojeISO()}"></label>
      </details>
      <div id="aviso-data"></div>
    </div>
    <div id="dia"></div>`;
  const inpData = el.querySelector('#data'), inpCod = el.querySelector('#cod');
  inpData.onchange = () => { st.data = inpData.value || hojeISO(); marcarData(); carregarDia(); };
  el.querySelector('#f-cod').onsubmit = (e) => { e.preventDefault(); consultar(inpCod.value); };
  el.querySelector('#cam').onclick = async () => {
    pararCam?.();
    pararCam = await lerQrCamera(el.querySelector('#camera'), (txt) => { inpCod.value = txt; consultar(txt); });
  };
  marcarData();
  renderItem();
  carregarDia();
  setTimeout(() => inpCod.focus(), 50);
}

function marcarData() {
  const outra = st.data !== hojeISO();
  raiz.querySelector('#txt-data').textContent = outra ? data(st.data) : `hoje (${data(st.data)})`;
  raiz.querySelector('#lb-data').classList.toggle('data-outra', outra);
  if (outra) raiz.querySelector('#det-data').open = true;
  raiz.querySelector('#aviso-data').innerHTML = outra
    ? `<div class="aviso-box">Lançando produção do dia <b>${h(data(st.data))}</b> (não é hoje).</div>` : '';
}

function limparItem() { st.consulta = null; st.proc = null; st.func = ''; st.qtd = null; st.obs = ''; renderItem(); }

async function consultar(texto) {
  texto = String(texto || '').trim();
  const inp = raiz.querySelector('#cod');
  if (!texto) return inp.focus();
  inp.value = '';
  const { data: r, error } = await db.rpc('consultar_item', { p_codigo: texto, p_funcionario: null });
  if (error) {
    bipSom(false); st.consulta = null; st.proc = null;
    raiz.querySelector('#item').innerHTML = `<div class="res-scan erro"><b>${h(texto)}</b><div>${h(msgErro(error))}</div></div>`;
    return inp.focus();
  }
  bipSom(true);
  st.consulta = r; st.proc = null; st.func = ''; st.qtd = null; st.obs = '';
  renderItem();
}

// funcionárias ativas; quem sabe fazer o processo escolhido aparece primeiro
function opcoesFuncionarias() {
  const funcs = ativos(cad.funcionarios, st.func);
  const sabe = new Set(cad.funcProc.filter(fp => fp.processo_id === st.proc).map(fp => fp.funcionario_id));
  const fazem = st.proc ? funcs.filter(f => sabe.has(f.id)) : [];
  const outras = funcs.filter(f => !fazem.includes(f));
  const opt = (f) => `<option value="${f.id}" ${String(f.id) === String(st.func) ? 'selected' : ''}>${h(f.nome)}</option>`;
  return `<option value="">Quem fez?</option>` + (fazem.length
    ? `<optgroup label="Fazem este processo">${fazem.map(opt).join('')}</optgroup><optgroup label="Outras">${outras.map(opt).join('')}</optgroup>`
    : outras.map(opt).join(''));
}

function renderItem() {
  const box = raiz.querySelector('#item');
  const r = st.consulta;
  if (!r) { box.innerHTML = ''; return; }
  const it = r.item, procs = r.processos || [];
  const botao = (p) => {
    const feito = Number(p.apontado) || 0;
    return `<button type="button" class="proc ${p.processo_id === st.proc ? 'sel' : ''}" data-p="${p.processo_id}">
      <b>${h(p.processo)}</b>
      <small>${p.tempo_padrao_seg == null ? '<span class="semtempo">sem tempo padrão</span>' : h(fmtSeg(p.tempo_padrao_seg))}</small>
      ${feito ? `<small class="${feito >= it.qtd ? 'feito' : ''}">já apontado: ${num(feito)} de ${num(it.qtd)}</small>` : ''}
    </button>`;
  };
  box.innerHTML = `
    <div class="item-bip">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
        <div class="nome">Corte ${h(it.numero)}${it.sequencia > 1 ? '/' + h(it.sequencia) : ''}${it.tipo_risco ? ' · ' + h(it.tipo_risco) : ''}</div>${chip(it.codigo, 'info')}
      </div>
      ${it.etiqueta_antiga ? '<div class="aviso-box">Etiqueta antiga do AppSheet. Funcionou, mas reimprima a etiqueta nova deste corte.</div>' : ''}
      <div class="nums">
        <div><small>Modelo</small><b>${h(it.produto)}</b></div>
        <div><small>Tecido</small><b>${h(it.tecido || '—')}</b></div>
        <div><small>Tamanho</small><b>${h(it.tamanho)}</b></div>
        <div><small>Cor</small><b>${h(it.cor || '—')}${it.tonalidade ? ' ' + h(it.tonalidade) : ''}</b></div>
        <div><small>Quantidade</small><b>${num(it.qtd)}</b></div>
      </div>
      ${it.elastico ? `<div class="det">Elástico: ${h(it.elastico)}</div>` : ''}
      ${procs.length ? `
        <div class="peq forte" style="margin-top:14px">Processo</div>
        <div class="procs">${procs.map(botao).join('')}</div>
        <label class="campo" style="margin-top:12px">Operador(a)<select id="func">${opcoesFuncionarias()}</select></label>
        <label class="campo" style="margin-top:8px">Observação (opcional)<input id="obs" maxlength="200" value="${h(st.obs || '')}"></label>
        <div id="avisos"></div>
        <div class="confirma">
          <label class="campo">Quantidade feita<input type="number" id="qtd" min="1" step="1" inputmode="numeric" value="${h(st.qtd ?? it.qtd ?? '')}"></label>
          <button class="btn acento" type="button" id="gravar">Gravar apontamento</button>
        </div>`
      : '<div class="erro-box">Não há roteiro cadastrado para este produto + tecido. Cadastre o roteiro antes de apontar.</div>'}
    </div>`;
  box.querySelectorAll('[data-p]').forEach(b => b.onclick = () => {
    st.proc = Number(b.dataset.p); st.qtd = box.querySelector('#qtd')?.value ?? st.qtd; st.obs = box.querySelector('#obs')?.value ?? st.obs;
    renderItem();
    raiz.querySelector('#func')?.focus();
  });
  const sel = box.querySelector('#func'); if (sel) sel.onchange = () => { st.func = sel.value; mostrarAvisos(); };
  const qtd = box.querySelector('#qtd');
  if (qtd) { qtd.oninput = () => { st.qtd = qtd.value; mostrarAvisos(); }; mostrarAvisos(); }
  const obs = box.querySelector('#obs'); if (obs) obs.oninput = () => { st.obs = obs.value; };
  box.querySelector('#gravar')?.addEventListener('click', gravar);
}

function mostrarAvisos() {
  const box = raiz.querySelector('#avisos'); if (!box) return;
  const it = st.consulta.item, p = (st.consulta.processos || []).find(x => x.processo_id === st.proc);
  const qtd = Number(raiz.querySelector('#qtd')?.value) || 0;
  const av = [];
  if (!p) av.push('<div class="muted peq" style="margin-top:8px">Escolha o processo.</div>');
  else {
    if (p.tempo_padrao_seg == null) av.push('<div class="aviso-box"><b>Este processo não tem tempo padrão</b>, o apontamento ficará com 0 minutos.</div>');
    const feito = Number(p.apontado) || 0;
    if (feito) av.push(`<div class="aviso-box">Este pacote já tem <b>${num(feito)}</b> peça(s) apontada(s) em ${h(p.processo)}. Ao gravar, será pedida confirmação.</div>`);
    else if (qtd > it.qtd) av.push(`<div class="aviso-box">A quantidade (${num(qtd)}) é maior que a do pacote (${num(it.qtd)}).</div>`);
    if (!st.func) av.push('<div class="muted peq" style="margin-top:8px">Escolha quem fez o processo.</div>');
  }
  box.innerHTML = av.join('');
}

async function gravar() {
  if (st.ocupado) return;
  const it = st.consulta?.item, p = (st.consulta?.processos || []).find(x => x.processo_id === st.proc);
  const qtd = Math.trunc(Number(raiz.querySelector('#qtd').value) || 0);
  if (!p) return toast('Escolha o processo.', 'erro');
  if (!st.func) { raiz.querySelector('#func')?.focus(); return toast('Escolha o operador(a) que fez o processo.', 'erro'); }
  if (qtd <= 0) return toast('Informe a quantidade.', 'erro');
  const nomeFunc = cad.funcionarios.find(f => String(f.id) === String(st.func))?.nome || '';
  if (p.tempo_padrao_seg == null && !await confirmar('Processo sem tempo padrão',
    `<b>${h(p.processo)}</b> não tem tempo padrão para ${h(it.produto)} + ${h(it.tecido || '')}. O apontamento ficará com <b>0 minutos</b>. Gravar assim mesmo?`, 'Gravar com 0 minutos', 'perigo')) return;
  const feito = Number(p.apontado) || 0;
  if (!feito && qtd > it.qtd && !await confirmar('Quantidade acima do pacote',
    `O pacote tem ${num(it.qtd)} peça(s). Gravar ${num(qtd)}?`, 'Gravar', 'perigo')) return;
  st.ocupado = true;
  const btn = raiz.querySelector('#gravar'); if (btn) btn.disabled = true;
  const params = {
    p_codigo: it.codigo, p_processo: p.processo_id, p_funcionario: Number(st.func), p_qtd: qtd,
    p_data_producao: st.data, p_obs: raiz.querySelector('#obs')?.value || null, p_confirmar_repetido: false };
  let { data: r, error } = await db.rpc('registrar_apontamento', params);
  // mesmo pacote já apontado neste processo (inclui histórico do AppSheet): só grava se confirmar
  if (!error && r?.repetido) {
    bipSom(false);
    const ok = await confirmar('Pacote já apontado neste processo',
      h(r.aviso).replace(/\n/g, '<br>'), 'Confirmar novo lançamento', 'perigo');
    if (!ok) { st.ocupado = false; if (btn) btn.disabled = false; return; }
    ({ data: r, error } = await db.rpc('registrar_apontamento', { ...params, p_confirmar_repetido: true }));
  }
  st.ocupado = false;
  if (error || !r?.gravado) { if (btn) btn.disabled = false; bipSom(false); return toast(error ? msgErro(error) : 'Apontamento não gravado.', 'erro'); }
  bipSom(true);
  toast(`Gravado: ${p.processo} · ${nomeFunc} · ${num(qtd)} peça(s) · ${num(r.minutos)} min`, 'ok');
  limparItem();
  raiz.querySelector('#cod').focus();
  carregarDia();
}

// ---------- Apontamentos lançados por este login no dia ----------
async function carregarDia() {
  const box = raiz.querySelector('#dia');
  const lista = await ler(db.from('apontamentos')
    .select('id,qtd,tempo_padrao_seg,tempo_total_min_original,data_hora,origem,criado_por,obs,processo_id,funcionario_id,corte_item_id,corte_texto_original')
    .eq('criado_por', ctx.usuario.id).eq('data_producao', st.data).order('data_hora', { ascending: false }).limit(300));
  const ids = [...new Set(lista.map(a => a.corte_item_id).filter(Boolean))];
  const itens = ids.length ? porId(await ler(db.from('v_corte_itens').select('id,codigo,nome_exibicao').in('id', ids))) : {};
  const procs = porId(cad.processos), funcs = porId(cad.funcionarios);
  const pecas = lista.reduce((s, a) => s + (Number(a.qtd) || 0), 0);
  const podeDesfazer = (a) => a.origem === 'APP' && (tem('supervisor') ||
    (a.criado_por === ctx.usuario.id && Date.now() - new Date(a.data_hora).getTime() < 15 * 60000));
  box.innerHTML = `
    <h2 style="margin-top:6px">Lançados neste aparelho · ${h(data(st.data))}</h2>
    <div class="resumo-dia">
      <div><small>Apontamentos</small><b>${num(lista.length)}</b></div>
      <div><small>Peças</small><b>${num(pecas)}</b></div>
    </div>
    <div class="tabela-wrap"><table>
      <thead><tr><th>Hora</th><th>Pacote</th><th>Processo</th><th>Operador(a)</th><th class="n">Peças</th><th class="n">Min</th><th></th></tr></thead>
      <tbody>${lista.map(a => {
        const it = itens[a.corte_item_id];
        return `<tr><td>${new Date(a.data_hora).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })}</td>
          <td>${h(it?.nome_exibicao || a.corte_texto_original || '—')}${a.obs ? `<div class="peq muted">${h(a.obs)}</div>` : ''}</td>
          <td>${h(procs[a.processo_id]?.nome || '—')}${Number(a.tempo_padrao_seg) === 0 && a.origem === 'APP' ? ' ' + chip('sem tempo', 'alerta') : ''}</td>
          <td>${h(funcs[a.funcionario_id]?.nome || '—')}</td>
          <td class="n">${num(a.qtd)}</td><td class="n">${num(minutosApont(a))}</td>
          <td>${podeDesfazer(a) ? `<button class="btn peq perigo" data-desf="${a.id}">Desfazer</button>` : ''}</td></tr>`;
      }).join('') || '<tr><td colspan="7" class="vazio">Nenhum apontamento lançado neste dia.</td></tr>'}</tbody>
    </table></div>`;
  box.querySelectorAll('[data-desf]').forEach(b => b.onclick = async () => {
    if (!await confirmar('Desfazer apontamento', 'Excluir este apontamento?', 'Excluir', 'perigo')) return;
    const { error } = await db.rpc('desfazer_apontamento', { p_id: b.dataset.desf });
    if (error) return toast(msgErro(error), 'erro');
    toast('Apontamento excluído.', 'ok'); carregarDia();
    if (st.consulta) consultarDeNovo();
  });
}

async function consultarDeNovo() {
  const cod = st.consulta?.item?.codigo; if (!cod) return;
  const { data: r } = await db.rpc('consultar_item', { p_codigo: cod, p_funcionario: null });
  if (r) { st.consulta = r; renderItem(); }
}
