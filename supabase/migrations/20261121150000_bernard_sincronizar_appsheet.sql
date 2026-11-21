-- BERNARD · Sincronização incremental da planilha (AppSheet) → Supabase.
-- O script do Apps Script grava as linhas em bernard_import.raw; esta função traz para as tabelas
-- só o que ainda não existe (pelo id da linha no AppSheet). Pode rodar quantas vezes quiser.
-- Os tempos ficam exatamente como na planilha (tempo padrão e tempo total), para não mexer na premiação.
create or replace function bernard_import.sincronizar() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_cortes int; v_itens int; v_elas int; v_ap int; v_ap_sem_item int; v_pulados int;
begin
  -- 1) cortes novos (nome do corte que ainda não existe com o mesmo modelo/tecido)
  with novos as (
    select v.n_corte, p.id produto_id, t.id tecido_id, min(bernard_import.dt(v.data_txt)) data
      from bernard_import.v_corte v
      join bernard.produtos p on bernard_import.k(p.nome) = bernard_import.k(v.modelo)
      join bernard.tecidos t on bernard_import.k(t.nome) = bernard_import.k(v.tecido)
     where v.id <> '' and v.tamanho <> ''
       and not exists (select 1 from bernard.corte_itens c where c.id_original = v.id)
       and not exists (select 1 from bernard.cortes c where c.importado and c.nome_original = v.n_corte
                         and c.produto_id = p.id and c.tecido_id = t.id)
     group by 1, 2, 3)
  insert into bernard.cortes(numero, sequencia, tipo_risco_id, data, produto_id, tecido_id, destino, nome_original, importado, criado_por)
  select substring(n_corte from '^\s*(\d+)')::int,
         coalesce(substring(n_corte from '/\s*(\d+)')::int, 1),
         case when n_corte ~* 'meio' then (select id from bernard.tipos_risco where nome = 'Meio')
              when n_corte ~* 'retalh' then (select id from bernard.tipos_risco where nome = 'Retalho')
              when n_corte ~* 'inteiro' then (select id from bernard.tipos_risco where nome = 'Inteiro') end,
         coalesce(data, current_date), produto_id, tecido_id, 'INTERNO', n_corte, true, null
    from novos where n_corte ~ '^\s*\d+';
  get diagnostics v_cortes = row_count;

  -- 2) linhas novas do corte (cor "PRETO 2" = cor PRETO + tonalidade 2)
  with ins as (
    insert into bernard.corte_itens(corte_id, cor_id, tonalidade, tamanho_id, qtd, id_original, idcorte_original)
    select co.id,
           (select c.id from bernard_import.alias_cor a join bernard.cores c on c.nome = a.cor
             where a.original = bernard_import.k(trim(regexp_replace(v.cor, '\s*\d+$', ''))) limit 1),
           nullif(substring(trim(v.cor) from '(\d+)$'), '')::int,
           tm.id, bernard_import.num(v.qtd_txt)::int, v.id, v.idcorte
      from bernard_import.v_corte v
      join bernard.produtos p on bernard_import.k(p.nome) = bernard_import.k(v.modelo)
      join bernard.tecidos t on bernard_import.k(t.nome) = bernard_import.k(v.tecido)
      join bernard.tamanhos tm on bernard_import.k(tm.nome) = bernard_import.k(v.tamanho)
      join lateral (select c.id from bernard.cortes c where c.importado and c.nome_original = v.n_corte
                      and c.produto_id = p.id and c.tecido_id = t.id order by c.criado_em limit 1) co on true
     where v.id <> '' and not exists (select 1 from bernard.corte_itens c where c.id_original = v.id)
    returning id, id_original)
  select count(*) into v_itens from ins;

  insert into bernard.corte_item_elasticos(corte_item_id, elastico_id)
  select ci.id, e.id
    from bernard.corte_itens ci
    join bernard_import.v_corte v on v.id = ci.id_original
    join bernard_import.alias_elastico a on a.original = bernard_import.k(v.elastico)
    join bernard.elasticos e on e.nome = a.elastico
   where v.elastico <> ''
     and not exists (select 1 from bernard.corte_item_elasticos x where x.corte_item_id = ci.id);
  get diagnostics v_elas = row_count;

  select count(*) into v_pulados from bernard_import.v_corte v
   where v.id <> '' and not exists (select 1 from bernard.corte_itens c where c.id_original = v.id);

  -- 3) apontamentos novos (tempo padrão e tempo total como estão na planilha)
  insert into bernard.apontamentos(corte_item_id, processo_id, funcionario_id, qtd, tempo_padrao_seg, data_hora, obs,
       criado_por, origem, id_original, corte_texto_original, tempo_total_min_original, dados_originais, data_producao)
  select (select case when count(*) = 1 then min(ci.id::text)::uuid end
            from bernard.corte_itens ci where lower(ci.idcorte_original) = lower(v.n_corte)),
         pr.id, f.id, bernard_import.num(v.qtd_txt)::int, bernard_import.num(v.tp_txt),
         coalesce(bernard_import.dth(v.datahora_txt), bernard_import.dt(v.data_txt)::timestamp at time zone 'America/Sao_Paulo'),
         nullif(v.obs, ''), null, 'APPSHEET', v.id, v.n_corte, bernard_import.num(v.tt_txt), r.dados,
         bernard_import.dt(v.data_txt)
    from bernard_import.v_apontamento v
    join bernard_import.raw r on r.aba = 'Apontamento' and r.linha = v.linha
    join bernard.processos pr on bernard_import.k(pr.nome) = bernard_import.k(v.processo)
    left join lateral (select id from bernard.funcionarios f where bernard_import.k(f.nome) = bernard_import.k(v.operador) limit 1) f on true
   where v.id <> '' and bernard_import.dt(v.data_txt) is not null
     and not exists (select 1 from bernard.apontamentos a where a.id_original = v.id);
  get diagnostics v_ap = row_count;

  select count(*) into v_ap_sem_item from bernard.apontamentos a
   where a.origem = 'APPSHEET' and a.corte_item_id is null;

  return jsonb_build_object('cortes_novos', v_cortes, 'itens_corte_novos', v_itens, 'elasticos', v_elas,
    'linhas_corte_nao_importadas', v_pulados, 'apontamentos_novos', v_ap,
    'apontamentos_appsheet_sem_item', v_ap_sem_item,
    'ultimo_dia', (select max(data_producao) from bernard.apontamentos));
end $$;
revoke all on function bernard_import.sincronizar() from public, anon, authenticated;
