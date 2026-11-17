-- BERNARD · lista de cortes com totais e detalhe para edição (tela Corte + etiquetas)

create or replace view bernard.v_cortes with (security_invoker = true) as
select c.id, c.numero, c.sequencia, c.data, c.destino, c.obs, c.importado, c.criado_em,
       c.tipo_risco_id, tr.nome as tipo_risco, c.produto_id, p.nome as produto, c.tecido_id, t.nome as tecido,
       c.faccao_id, f.nome as faccao,
       coalesce(x.linhas, 0) as linhas, coalesce(x.pecas, 0) as pecas
  from bernard.cortes c
  join bernard.produtos p on p.id = c.produto_id
  left join bernard.tecidos t on t.id = c.tecido_id
  left join bernard.tipos_risco tr on tr.id = c.tipo_risco_id
  left join bernard.faccoes f on f.id = c.faccao_id
  left join lateral (select count(*) as linhas, sum(i.qtd) as pecas from bernard.corte_itens i where i.corte_id = c.id) x on true;

grant select on bernard.v_cortes to authenticated;

create or replace function bernard.corte_detalhe(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if not bernard.eh_usuario() then raise exception 'Acesso negado.' using errcode = '42501'; end if;
  select to_jsonb(c) || jsonb_build_object('itens', coalesce((
           select jsonb_agg(jsonb_build_object(
                    'id', i.id, 'codigo', i.codigo, 'cor_id', i.cor_id, 'tonalidade', i.tonalidade,
                    'tamanho_id', i.tamanho_id, 'qtd', i.qtd,
                    'elasticos', coalesce((select jsonb_agg(e.elastico_id order by e.elastico_id)
                                             from bernard.corte_item_elasticos e where e.corte_item_id = i.id), '[]'::jsonb),
                    'apontamentos', (select count(*) from bernard.apontamentos a where a.corte_item_id = i.id))
                  order by co.nome, i.tonalidade nulls first, ta.ordem, ta.nome)
             from bernard.corte_itens i
             left join bernard.cores co on co.id = i.cor_id
             left join bernard.tamanhos ta on ta.id = i.tamanho_id
            where i.corte_id = c.id), '[]'::jsonb))
    into v
    from bernard.cortes c where c.id = p_id;
  if v is null then raise exception 'Corte não encontrado.'; end if;
  return v;
end $$;

revoke all on function bernard.corte_detalhe(uuid) from public, anon;
grant execute on function bernard.corte_detalhe(uuid) to authenticated;
