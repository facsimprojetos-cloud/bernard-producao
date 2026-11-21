-- BERNARD · Jornada por dia da semana (para a eficiência) e dados do Painel (Gestão).

-- Jornada de cada operadora, em minutos, por dia da semana (1 = segunda … 7 = domingo).
create table if not exists bernard.funcionario_jornada (
  funcionario_id bigint not null references bernard.funcionarios(id) on delete cascade,
  dia_semana smallint not null check (dia_semana between 1 and 7),
  minutos int not null check (minutos between 0 and 1440),
  primary key (funcionario_id, dia_semana)
);
alter table bernard.funcionario_jornada enable row level security;
drop policy if exists leitura_usuarios on bernard.funcionario_jornada;
create policy leitura_usuarios on bernard.funcionario_jornada for select to authenticated using ((select bernard.eh_usuario()));
drop policy if exists cadastros_insere on bernard.funcionario_jornada;
create policy cadastros_insere on bernard.funcionario_jornada for insert to authenticated with check ((select bernard.tem_perfil('cadastros')));
drop policy if exists cadastros_altera on bernard.funcionario_jornada;
create policy cadastros_altera on bernard.funcionario_jornada for update to authenticated
  using ((select bernard.tem_perfil('cadastros'))) with check ((select bernard.tem_perfil('cadastros')));
drop policy if exists cadastros_exclui on bernard.funcionario_jornada;
create policy cadastros_exclui on bernard.funcionario_jornada for delete to authenticated using ((select bernard.tem_perfil('cadastros')));
grant select, insert, update, delete on bernard.funcionario_jornada to authenticated;
grant all on bernard.funcionario_jornada to service_role;

-- Salva a jornada da semana de uma operadora (null ou vazio = não trabalha naquele dia).
-- p_jornada: {"1": 528, "2": 528, "3": 528, "4": 528, "5": 480}
create or replace function bernard.salvar_jornada(p_funcionario bigint, p_jornada jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare d int;
begin
  perform bernard.exigir_perfil('cadastros');
  delete from bernard.funcionario_jornada where funcionario_id = p_funcionario;
  for d in 1..7 loop
    if nullif(p_jornada ->> d::text, '') is not null and (p_jornada ->> d::text)::int > 0 then
      insert into bernard.funcionario_jornada(funcionario_id, dia_semana, minutos)
      values (p_funcionario, d, (p_jornada ->> d::text)::int);
    end if;
  end loop;
end $$;
revoke all on function bernard.salvar_jornada(bigint, jsonb) from public, anon;
grant execute on function bernard.salvar_jornada(bigint, jsonb) to authenticated;

-- Painel: tudo num JSON só. Produção pelo dia de produção; corte pelos cortes com data no período.
-- Peças produzidas = peças apontadas no último processo (Embalagem).
-- Status do item de corte: finalizado (embalado >= cortado); parado (sem apontamento há p_dias_parado dias
-- ou mais, contando da data do corte se nunca teve apontamento); em produção (o resto).
create or replace function bernard.painel(p_ini date, p_fim date, p_dias_parado int default 5) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_emb bigint; v_lim date := (now() at time zone 'America/Sao_Paulo')::date - greatest(coalesce(p_dias_parado, 5), 1);
  r jsonb;
begin
  perform bernard.exigir_perfil('admin');
  select id into v_emb from bernard.processos where nome = 'Embalagem';

  with ap as (
    select a.*, coalesce(a.tempo_total_min_original, round(a.qtd * coalesce(a.tempo_padrao_seg, 0) / 60.0)) as minutos
      from bernard.apontamentos a where a.data_producao between p_ini and p_fim),
  dias as (
    select d::date as dia from generate_series(p_ini, p_fim, interval '1 day') d),
  por_dia as (
    select dd.dia,
           coalesce(sum(ap.qtd) filter (where ap.processo_id = v_emb), 0) as embalados,
           coalesce(sum(ap.minutos), 0) as minutos,
           coalesce(sum(ap.qtd), 0) as pecas_apontadas
      from dias dd left join ap on ap.data_producao = dd.dia group by dd.dia),
  op_dia as (
    select funcionario_id, data_producao, sum(qtd) qtd, sum(minutos) minutos from ap where funcionario_id is not null group by 1, 2),
  ranking as (
    select f.id, f.nome, sum(o.qtd) as pecas, sum(o.minutos) as minutos, count(*) as dias,
           sum(j.minutos) as disponivel, count(j.minutos) as dias_com_jornada
      from op_dia o join bernard.funcionarios f on f.id = o.funcionario_id
      left join bernard.funcionario_jornada j on j.funcionario_id = o.funcionario_id
            and j.dia_semana = extract(isodow from o.data_producao)
     group by f.id, f.nome),
  por_proc as (
    select p.nome, sum(ap.qtd) pecas, sum(ap.minutos) minutos from ap join bernard.processos p on p.id = ap.processo_id group by p.nome),
  -- corte
  itens as (
    select ci.id, ci.corte_id, coalesce(ci.qtd, 0) qtd, c.data,
           coalesce((select sum(a.qtd) from bernard.apontamentos a where a.corte_item_id = ci.id and a.processo_id = v_emb), 0) embalado,
           (select max(a.data_producao) from bernard.apontamentos a where a.corte_item_id = ci.id) ultimo
      from bernard.corte_itens ci join bernard.cortes c on c.id = ci.corte_id
     where c.data between p_ini and p_fim),
  itens_st as (
    select *, case when embalado >= qtd and qtd > 0 then 'finalizado'
                   when coalesce(ultimo, data) <= v_lim then 'parado'
                   else 'em_producao' end as status
      from itens),
  cortes_res as (
    select c.id, coalesce(c.nome_original, c.numero::text || coalesce('/' || nullif(c.sequencia, 1)::text, '') || coalesce(' ' || tr.nome, '')) as nome,
           c.data, p.nome produto, t.nome tecido,
           sum(i.qtd) cortado, sum(least(i.embalado, i.qtd)) embalado, max(i.ultimo) ultimo,
           count(*) filter (where i.status = 'parado') itens_parados,
           count(*) filter (where i.status = 'finalizado') itens_fin, count(*) itens
      from itens_st i join bernard.cortes c on c.id = i.corte_id
      join bernard.produtos p on p.id = c.produto_id left join bernard.tecidos t on t.id = c.tecido_id
      left join bernard.tipos_risco tr on tr.id = c.tipo_risco_id
     group by c.id, c.nome_original, c.numero, c.sequencia, tr.nome, c.data, p.nome, t.nome),
  -- conciliação: para os cortes do período, peças apontadas em cada processo x peças cortadas
  concil as (
    select p.nome processo, pp_seq.seq,
           (select sum(qtd) from itens) cortado,
           coalesce(sum(a.qtd), 0) apontado
      from bernard.processos p
      left join lateral (select min(sequencia) seq from bernard.produto_processos x where x.processo_id = p.id) pp_seq on true
      left join bernard.apontamentos a on a.processo_id = p.id and a.corte_item_id in (select id from itens)
     where p.ativo
     group by p.nome, pp_seq.seq)
  select jsonb_build_object(
    'periodo', jsonb_build_object('ini', p_ini, 'fim', p_fim, 'dias_parado', greatest(coalesce(p_dias_parado, 5), 1)),
    'producao', jsonb_build_object(
       'embalados', (select coalesce(sum(embalados), 0) from por_dia),
       'minutos', (select coalesce(sum(minutos), 0) from por_dia),
       'pecas_apontadas', (select coalesce(sum(pecas_apontadas), 0) from por_dia),
       'dias_com_producao', (select count(*) from por_dia where pecas_apontadas > 0),
       'operadoras', (select count(*) from ranking),
       'eficiencia', (select case when sum(disponivel) > 0 then round(100.0 * sum(minutos) filter (where dias_com_jornada = dias) / nullif(sum(disponivel) filter (where dias_com_jornada = dias), 0), 1) end from ranking)),
    'por_dia', (select coalesce(jsonb_agg(jsonb_build_object('dia', dia, 'embalados', embalados, 'minutos', minutos, 'apontadas', pecas_apontadas) order by dia), '[]') from por_dia),
    'ranking', (select coalesce(jsonb_agg(jsonb_build_object('nome', nome, 'pecas', pecas, 'minutos', minutos, 'dias', dias,
                   'disponivel', case when dias_com_jornada = dias then disponivel end,
                   'eficiencia', case when dias_com_jornada = dias and disponivel > 0 then round(100.0 * minutos / disponivel, 1) end,
                   'jornada_incompleta', dias_com_jornada < dias) order by minutos desc), '[]') from ranking),
    'por_processo', (select coalesce(jsonb_agg(jsonb_build_object('processo', nome, 'pecas', pecas, 'minutos', minutos) order by pecas desc), '[]') from por_proc),
    'corte', jsonb_build_object(
       'cortes', (select count(distinct corte_id) from itens),
       'cortado', (select coalesce(sum(qtd), 0) from itens),
       'finalizado', (select coalesce(sum(qtd), 0) from itens_st where status = 'finalizado'),
       'em_producao', (select coalesce(sum(qtd), 0) from itens_st where status = 'em_producao'),
       'parado', (select coalesce(sum(qtd), 0) from itens_st where status = 'parado'),
       'embalado', (select coalesce(sum(least(embalado, qtd)), 0) from itens)),
    'conciliacao', (select coalesce(jsonb_agg(jsonb_build_object('processo', processo, 'cortado', cortado, 'apontado', apontado,
                   'pct', case when cortado > 0 then round(100.0 * apontado / cortado, 1) end) order by seq nulls last, processo), '[]') from concil),
    'cortes', (select coalesce(jsonb_agg(jsonb_build_object('nome', nome, 'data', data, 'produto', produto, 'tecido', tecido,
                   'cortado', cortado, 'embalado', embalado, 'ultimo', ultimo, 'itens', itens, 'itens_fin', itens_fin, 'itens_parados', itens_parados,
                   'status', case when itens_fin = itens then 'finalizado' when itens_parados > 0 then 'parado' else 'em_producao' end)
                   order by (itens_parados > 0) desc, data), '[]') from cortes_res)
  ) into r;
  return r;
end $$;
revoke all on function bernard.painel(date, date, int) from public, anon;
grant execute on function bernard.painel(date, date, int) to authenticated;
