-- BERNARD · Andamento de um corte por pacote (cor × tamanho), para o painel organizar os parados.
create or replace function bernard.corte_andamento(p_corte uuid, p_dias_parado int default 5) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_emb bigint; v_lim date := (now() at time zone 'America/Sao_Paulo')::date - greatest(coalesce(p_dias_parado, 5), 1);
  r jsonb;
begin
  if not bernard.tem_perfil('admin') then raise exception 'Acesso negado.' using errcode = '42501'; end if;
  select id into v_emb from bernard.processos where nome = 'Embalagem';
  with it as (
    select ci.id, ci.codigo, coalesce(ci.qtd, 0) qtd, co.nome || coalesce(' ' || ci.tonalidade, '') cor,
           tm.nome tamanho, tm.ordem, c.data, c.produto_id, c.tecido_id,
           coalesce((select sum(a.qtd) from bernard.apontamentos a where a.corte_item_id = ci.id and a.processo_id = v_emb), 0) embalado,
           (select max(a.data_producao) from bernard.apontamentos a where a.corte_item_id = ci.id) ultimo
      from bernard.corte_itens ci join bernard.cortes c on c.id = ci.corte_id
      left join bernard.cores co on co.id = ci.cor_id join bernard.tamanhos tm on tm.id = ci.tamanho_id
     where ci.corte_id = p_corte)
  select jsonb_agg(jsonb_build_object(
      'codigo', it.codigo, 'cor', coalesce(it.cor, '—'), 'tamanho', it.tamanho, 'ordem', it.ordem, 'qtd', it.qtd,
      'embalado', it.embalado, 'ultimo', it.ultimo,
      'status', case when it.embalado >= it.qtd and it.qtd > 0 then 'finalizado'
                     when coalesce(it.ultimo, it.data) <= v_lim then 'parado' else 'em_producao' end,
      'processos', (select coalesce(jsonb_agg(jsonb_build_object('processo', p.nome, 'apontado', coalesce(x.q, 0)) order by pp.sequencia), '[]')
                      from bernard.produto_processos pp join bernard.processos p on p.id = pp.processo_id
                      left join lateral (select sum(a.qtd) q from bernard.apontamentos a where a.corte_item_id = it.id and a.processo_id = p.id) x on true
                     where pp.produto_id = it.produto_id and pp.tecido_id = it.tecido_id and p.ativo))
    order by it.cor, it.ordem) into r
  from it;
  return coalesce(r, '[]');
end $$;
revoke all on function bernard.corte_andamento(uuid, int) from public, anon;
grant execute on function bernard.corte_andamento(uuid, int) to authenticated;
