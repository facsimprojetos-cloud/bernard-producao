-- BERNARD · Histórico de apontamentos: alterar e excluir (perfil supervisor), sempre com motivo e registro.
-- Vale também para o histórico migrado do AppSheet (só por estas funções; a tabela continua protegida
-- contra alteração direta). O registro guarda como era antes e como ficou.
create table if not exists bernard.apontamento_alteracoes (
  id bigint generated always as identity primary key,
  apontamento_id uuid not null,
  acao text not null check (acao in ('ALTERADO', 'EXCLUIDO')),
  antes jsonb not null,
  depois jsonb,
  motivo text not null,
  alterado_por text default (auth.jwt() ->> 'email'),
  alterado_em timestamptz not null default now()
);
create index if not exists apontamento_alteracoes_ap_idx on bernard.apontamento_alteracoes(apontamento_id);
create index if not exists apontamento_alteracoes_em_idx on bernard.apontamento_alteracoes(alterado_em desc);
alter table bernard.apontamento_alteracoes enable row level security;
drop policy if exists supervisor_le on bernard.apontamento_alteracoes;
create policy supervisor_le on bernard.apontamento_alteracoes for select to authenticated using ((select bernard.tem_perfil('supervisor')));
grant select on bernard.apontamento_alteracoes to authenticated;
grant all on bernard.apontamento_alteracoes to service_role;

-- Alterar: operador, processo, quantidade, data de produção, observação.
-- Mudou processo: o tempo padrão passa a ser o do roteiro do modelo/tecido do pacote.
-- Mudou processo ou quantidade: os minutos são recalculados (quantidade × tempo padrão ÷ 60).
create or replace function bernard.editar_apontamento(p_id uuid, p_funcionario bigint, p_processo bigint, p_qtd int,
  p_data_producao date, p_obs text, p_motivo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a bernard.apontamentos%rowtype; n bernard.apontamentos%rowtype; v_tempo numeric; v_achou boolean;
begin
  perform bernard.exigir_perfil('supervisor');
  if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Informe o motivo da alteração.'; end if;
  select * into a from bernard.apontamentos where id = p_id for update;
  if not found then raise exception 'Apontamento não encontrado.'; end if;
  if coalesce(p_qtd, 0) <= 0 then raise exception 'Informe a quantidade.'; end if;
  if p_data_producao is null or p_data_producao > (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'Data de produção inválida.';
  end if;
  if not exists (select 1 from bernard.funcionarios where id = p_funcionario) then raise exception 'Operador(a) não encontrado(a).'; end if;
  n := a;
  n.funcionario_id := p_funcionario; n.qtd := p_qtd; n.data_producao := p_data_producao; n.obs := nullif(trim(p_obs), '');
  if p_processo is distinct from a.processo_id then
    n.processo_id := p_processo;
    if a.corte_item_id is not null then
      select true, pp.tempo_padrao_seg into v_achou, v_tempo
        from bernard.corte_itens i join bernard.cortes c on c.id = i.corte_id
        join bernard.produto_processos pp on pp.produto_id = c.produto_id and pp.tecido_id is not distinct from c.tecido_id and pp.processo_id = p_processo
       where i.id = a.corte_item_id;
      if v_achou is null then raise exception 'Este processo não faz parte do roteiro do modelo/tecido deste pacote.'; end if;
      n.tempo_padrao_seg := coalesce(v_tempo, 0);
    end if;
  end if;
  if n.processo_id is distinct from a.processo_id or n.qtd is distinct from a.qtd then
    n.tempo_total_min_original := null;
  end if;
  if row(n.funcionario_id, n.processo_id, n.qtd, n.data_producao, n.obs) is not distinct from
     row(a.funcionario_id, a.processo_id, a.qtd, a.data_producao, a.obs) then
    raise exception 'Nada foi alterado.';
  end if;
  update bernard.apontamentos set funcionario_id = n.funcionario_id, processo_id = n.processo_id, qtd = n.qtd,
         data_producao = n.data_producao, obs = n.obs, tempo_padrao_seg = n.tempo_padrao_seg,
         tempo_total_min_original = n.tempo_total_min_original
   where id = p_id;
  insert into bernard.apontamento_alteracoes(apontamento_id, acao, antes, depois, motivo)
  values (p_id, 'ALTERADO', to_jsonb(a) - 'dados_originais', to_jsonb(n) - 'dados_originais', trim(p_motivo));
  return jsonb_build_object('ok', true,
    'minutos', coalesce(n.tempo_total_min_original, round(n.qtd * coalesce(n.tempo_padrao_seg, 0) / 60)));
end $$;
revoke all on function bernard.editar_apontamento(uuid, bigint, bigint, int, date, text, text) from public, anon;
grant execute on function bernard.editar_apontamento(uuid, bigint, bigint, int, date, text, text) to authenticated;

create or replace function bernard.excluir_apontamento(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
declare a bernard.apontamentos%rowtype;
begin
  perform bernard.exigir_perfil('supervisor');
  if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Informe o motivo da exclusão.'; end if;
  select * into a from bernard.apontamentos where id = p_id for update;
  if not found then raise exception 'Apontamento não encontrado.'; end if;
  insert into bernard.apontamento_alteracoes(apontamento_id, acao, antes, motivo)
  values (p_id, 'EXCLUIDO', to_jsonb(a), trim(p_motivo));
  delete from bernard.apontamentos where id = p_id;
end $$;
revoke all on function bernard.excluir_apontamento(uuid, text) from public, anon;
grant execute on function bernard.excluir_apontamento(uuid, text) to authenticated;
