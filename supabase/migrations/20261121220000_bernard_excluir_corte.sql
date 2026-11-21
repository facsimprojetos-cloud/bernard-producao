-- BERNARD · Excluir corte (só admin), com motivo e registro do que foi apagado.
-- Se o corte já tem apontamentos, só exclui se p_com_apontamentos = true; aí os apontamentos também saem
-- (afetam fechamento e premiação) e cada um fica registrado em apontamento_alteracoes como EXCLUIDO.
create table if not exists bernard.corte_exclusoes (
  id bigint generated always as identity primary key,
  corte_id uuid not null,
  corte jsonb not null,
  itens jsonb,
  apontamentos_excluidos int not null default 0,
  motivo text not null,
  excluido_por text default (auth.jwt() ->> 'email'),
  excluido_em timestamptz not null default now()
);
alter table bernard.corte_exclusoes enable row level security;
drop policy if exists admin_le on bernard.corte_exclusoes;
create policy admin_le on bernard.corte_exclusoes for select to authenticated using ((select bernard.tem_perfil('admin')));
grant select on bernard.corte_exclusoes to authenticated;
grant all on bernard.corte_exclusoes to service_role;

-- Resumo para a confirmação na tela
create or replace function bernard.corte_resumo_exclusao(p_corte uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r jsonb;
begin
  perform bernard.exigir_perfil('admin');
  select jsonb_build_object(
    'itens', (select count(*) from bernard.corte_itens where corte_id = p_corte),
    'pecas', (select coalesce(sum(qtd), 0) from bernard.corte_itens where corte_id = p_corte),
    'apontamentos', count(a.id), 'pecas_apontadas', coalesce(sum(a.qtd), 0),
    'minutos', coalesce(sum(coalesce(a.tempo_total_min_original, round(a.qtd * coalesce(a.tempo_padrao_seg, 0) / 60))), 0),
    'dias', string_agg(distinct to_char(a.data_producao, 'DD/MM'), ', '))
    into r
    from bernard.apontamentos a join bernard.corte_itens i on i.id = a.corte_item_id
   where i.corte_id = p_corte;
  return r;
end $$;
revoke all on function bernard.corte_resumo_exclusao(uuid) from public, anon;
grant execute on function bernard.corte_resumo_exclusao(uuid) to authenticated;

create or replace function bernard.excluir_corte(p_corte uuid, p_motivo text, p_com_apontamentos boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c bernard.cortes%rowtype; v_n int; v_itens jsonb;
begin
  perform bernard.exigir_perfil('admin');
  if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Informe o motivo da exclusão.'; end if;
  select * into c from bernard.cortes where id = p_corte for update;
  if not found then raise exception 'Corte não encontrado.'; end if;
  select count(*) into v_n from bernard.apontamentos a join bernard.corte_itens i on i.id = a.corte_item_id where i.corte_id = p_corte;
  if v_n > 0 and not coalesce(p_com_apontamentos, false) then
    raise exception 'Este corte tem % apontamento(s). Confirme a exclusão junto com os apontamentos.', v_n;
  end if;
  select jsonb_agg(to_jsonb(i) || jsonb_build_object('elasticos',
           (select jsonb_agg(e.elastico_id) from bernard.corte_item_elasticos e where e.corte_item_id = i.id)))
    into v_itens from bernard.corte_itens i where i.corte_id = p_corte;
  if v_n > 0 then
    insert into bernard.apontamento_alteracoes(apontamento_id, acao, antes, motivo)
    select a.id, 'EXCLUIDO', to_jsonb(a), 'Corte excluído: ' || trim(p_motivo)
      from bernard.apontamentos a join bernard.corte_itens i on i.id = a.corte_item_id where i.corte_id = p_corte;
    delete from bernard.apontamentos a using bernard.corte_itens i where i.id = a.corte_item_id and i.corte_id = p_corte;
  end if;
  insert into bernard.corte_exclusoes(corte_id, corte, itens, apontamentos_excluidos, motivo)
  values (p_corte, to_jsonb(c), v_itens, v_n, trim(p_motivo));
  delete from bernard.cortes where id = p_corte;   -- linhas, elásticos e envios saem junto (cascade)
  return jsonb_build_object('ok', true, 'apontamentos_excluidos', v_n);
end $$;
revoke all on function bernard.excluir_corte(uuid, text, boolean) from public, anon;
grant execute on function bernard.excluir_corte(uuid, text, boolean) to authenticated;
