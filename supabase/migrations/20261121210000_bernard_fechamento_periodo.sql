-- BERNARD · Fechamento (dia ou mês): quantidade, tempo e eficiência por operador(a), com ou sem processo.
-- Eficiência = minutos produzidos ÷ jornada cadastrada dos dias em que a pessoa teve apontamento.
-- Minutos: mesma regra do fechamento (tempo total original do AppSheet ou qtd × tempo padrão ÷ 60 por apontamento).
create or replace function bernard.fechamento(p_ini date, p_fim date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r jsonb;
begin
  perform bernard.exigir_perfil('fechamento');
  with ap as (
    select a.funcionario_id, a.processo_id, a.data_producao, a.qtd,
           coalesce(a.tempo_total_min_original, round(a.qtd * coalesce(a.tempo_padrao_seg, 0) / 60.0)) minutos,
           a.qtd > 0 and coalesce(a.tempo_padrao_seg, 0) = 0 and coalesce(a.tempo_total_min_original, 0) = 0 as sem_tempo
      from bernard.apontamentos a
     where a.data_producao between p_ini and p_fim and a.funcionario_id is not null),
  linhas as (
    select f.nome funcionario, p.nome processo, sum(ap.qtd) qtd, sum(ap.minutos) minutos, bool_or(ap.sem_tempo) sem_tempo
      from ap join bernard.funcionarios f on f.id = ap.funcionario_id join bernard.processos p on p.id = ap.processo_id
     group by f.nome, p.nome),
  dia_op as (
    select funcionario_id, data_producao, sum(qtd) qtd, sum(minutos) minutos from ap group by 1, 2),
  ops as (
    select f.nome funcionario, sum(d.qtd) qtd, sum(d.minutos) minutos, count(*) dias,
           sum(j.minutos) disponivel, count(j.minutos) dias_com_jornada
      from dia_op d join bernard.funcionarios f on f.id = d.funcionario_id
      left join bernard.funcionario_jornada j on j.funcionario_id = d.funcionario_id and j.dia_semana = extract(isodow from d.data_producao)
     group by f.nome)
  select jsonb_build_object(
    'ini', p_ini, 'fim', p_fim,
    'linhas', (select coalesce(jsonb_agg(jsonb_build_object('funcionario', funcionario, 'processo', processo, 'qtd', qtd, 'minutos', minutos, 'sem_tempo', sem_tempo)
                 order by funcionario, processo), '[]') from linhas),
    'operadores', (select coalesce(jsonb_agg(jsonb_build_object('funcionario', funcionario, 'qtd', qtd, 'minutos', minutos, 'dias', dias,
                 'disponivel', case when dias_com_jornada = dias then disponivel end,
                 'eficiencia', case when dias_com_jornada = dias and disponivel > 0 then round(100.0 * minutos / disponivel, 1) end)
                 order by funcionario), '[]') from ops)) into r;
  return r;
end $$;
revoke all on function bernard.fechamento(date, date) from public, anon;
grant execute on function bernard.fechamento(date, date) to authenticated;
