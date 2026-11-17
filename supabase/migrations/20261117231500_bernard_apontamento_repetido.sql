-- Bip: avisa quando a mesma etiqueta já tem apontamento no mesmo processo
-- (inclui o histórico do AppSheet). Só grava de novo com p_confirmar_repetido = true.
drop function if exists bernard.registrar_apontamento(text, bigint, bigint, integer, date, text);

create or replace function bernard.registrar_apontamento(
  p_codigo text, p_processo bigint, p_funcionario bigint, p_qtd integer, p_data_producao date,
  p_obs text default null, p_confirmar_repetido boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare v_item uuid; v_prod bigint; v_tec bigint; v_tempo numeric; v_achou boolean; v_id uuid;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_ant jsonb; v_aviso text;
begin
  perform bernard.exigir_perfil('producao');
  v_item := bernard._item_por_texto(p_codigo);
  if coalesce(p_qtd, 0) <= 0 then raise exception 'Informe a quantidade.'; end if;
  if p_data_producao is null then raise exception 'Informe a data de produção.'; end if;
  if p_data_producao > v_hoje then raise exception 'A data de produção não pode ser no futuro.'; end if;
  if p_data_producao < v_hoje - 60 then raise exception 'Data de produção muito antiga (mais de 60 dias).'; end if;
  if not exists (select 1 from bernard.funcionarios where id = p_funcionario and ativo) then
    raise exception 'Funcionária não encontrada ou inativa.';
  end if;
  select c.produto_id, c.tecido_id into v_prod, v_tec
    from bernard.corte_itens i join bernard.cortes c on c.id = i.corte_id where i.id = v_item;
  select true, pp.tempo_padrao_seg into v_achou, v_tempo
    from bernard.produto_processos pp
   where pp.produto_id = v_prod and pp.tecido_id is not distinct from v_tec and pp.processo_id = p_processo;
  if v_achou is null then
    raise exception 'Este processo não faz parte do roteiro deste produto + tecido.';
  end if;

  -- dois celulares bipando a mesma etiqueta no mesmo processo ao mesmo tempo: um espera o outro
  perform pg_advisory_xact_lock(hashtextextended(v_item::text || ':' || p_processo::text, 0));

  select jsonb_agg(jsonb_build_object(
           'funcionaria', coalesce(f.nome, '(sem funcionária)'), 'data_producao', a.data_producao,
           'qtd', a.qtd, 'origem', a.origem)
         order by a.data_producao, a.data_hora),
         string_agg(format('Já apontado por %s em %s (%s peças).', coalesce(f.nome, '(sem funcionária)'),
                           to_char(a.data_producao, 'DD/MM/YYYY'), coalesce(a.qtd, 0)),
                    E'\n' order by a.data_producao, a.data_hora)
    into v_ant, v_aviso
    from bernard.apontamentos a
    left join bernard.funcionarios f on f.id = a.funcionario_id
   where a.corte_item_id = v_item and a.processo_id = p_processo;

  if v_ant is not null and not coalesce(p_confirmar_repetido, false) then
    return jsonb_build_object('gravado', false, 'repetido', true,
      'aviso', v_aviso || E'\nConfirma novo lançamento?', 'anteriores', v_ant);
  end if;

  insert into bernard.apontamentos(corte_item_id, processo_id, funcionario_id, qtd, tempo_padrao_seg,
                                   data_producao, obs, origem)
  values (v_item, p_processo, p_funcionario, p_qtd, coalesce(v_tempo, 0),
          p_data_producao, nullif(trim(p_obs), ''), 'APP')
  returning id into v_id;
  return jsonb_build_object('gravado', true, 'id', v_id, 'tempo_padrao_seg', coalesce(v_tempo, 0),
                            'sem_tempo', v_tempo is null, 'minutos', round(p_qtd * coalesce(v_tempo, 0) / 60));
end $function$;

revoke all on function bernard.registrar_apontamento(text, bigint, bigint, integer, date, text, boolean) from public, anon;
grant execute on function bernard.registrar_apontamento(text, bigint, bigint, integer, date, text, boolean) to authenticated;
