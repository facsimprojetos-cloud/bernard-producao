-- BERNARD · Histórico de alterações do tempo padrão (roteiro) + salvar edição em lote com motivo.
-- Toda mudança em tempo padrão, sequência ou pessoas fica registrada (quem, quando, de/para, motivo).
create table if not exists bernard.roteiro_historico (
  id bigint generated always as identity primary key,
  produto_processo_id bigint not null references bernard.produto_processos(id),
  produto text, tecido text, processo text,
  campo text not null,
  valor_anterior numeric, valor_novo numeric,
  motivo text,
  alterado_por text default (auth.jwt() ->> 'email'),
  alterado_em timestamptz not null default now()
);
create index if not exists roteiro_historico_pp_idx on bernard.roteiro_historico(produto_processo_id, alterado_em desc);
alter table bernard.roteiro_historico enable row level security;
drop policy if exists leitura_usuarios on bernard.roteiro_historico;
create policy leitura_usuarios on bernard.roteiro_historico for select to authenticated using ((select bernard.eh_usuario()));
grant select on bernard.roteiro_historico to authenticated;
grant all on bernard.roteiro_historico to service_role;

create or replace function bernard._registra_roteiro() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_motivo text := nullif(current_setting('bernard.motivo', true), '');
  v_prod text; v_tec text; v_proc text;
begin
  select p.nome, t.nome, pr.nome into v_prod, v_tec, v_proc
    from bernard.produtos p, bernard.tecidos t, bernard.processos pr
   where p.id = new.produto_id and t.id = new.tecido_id and pr.id = new.processo_id;
  if new.tempo_padrao_seg is distinct from old.tempo_padrao_seg then
    insert into bernard.roteiro_historico(produto_processo_id, produto, tecido, processo, campo, valor_anterior, valor_novo, motivo)
    values (new.id, v_prod, v_tec, v_proc, 'tempo_padrao_seg', old.tempo_padrao_seg, new.tempo_padrao_seg, v_motivo);
  end if;
  if new.sequencia is distinct from old.sequencia then
    insert into bernard.roteiro_historico(produto_processo_id, produto, tecido, processo, campo, valor_anterior, valor_novo, motivo)
    values (new.id, v_prod, v_tec, v_proc, 'sequencia', old.sequencia, new.sequencia, v_motivo);
  end if;
  if new.pessoas is distinct from old.pessoas then
    insert into bernard.roteiro_historico(produto_processo_id, produto, tecido, processo, campo, valor_anterior, valor_novo, motivo)
    values (new.id, v_prod, v_tec, v_proc, 'pessoas', old.pessoas, new.pessoas, v_motivo);
  end if;
  return new;
end $$;
drop trigger if exists registra_roteiro on bernard.produto_processos;
create trigger registra_roteiro after update on bernard.produto_processos
  for each row execute function bernard._registra_roteiro();

-- Salva várias linhas de uma vez (botão "Salvar edição"), tudo ou nada, com o motivo no histórico.
-- p_alteracoes: [{"id": 12, "tempo_padrao_seg": 15.84, "sequencia": 7, "pessoas": 3}, ...]
create or replace function bernard.salvar_roteiro(p_alteracoes jsonb, p_motivo text default null) returns int
language plpgsql security definer set search_path = '' as $$
declare v jsonb; v_n int := 0;
begin
  perform bernard.exigir_perfil('cadastros');
  perform set_config('bernard.motivo', coalesce(trim(p_motivo), ''), true);
  for v in select * from jsonb_array_elements(coalesce(p_alteracoes, '[]'::jsonb)) loop
    if (v ? 'tempo_padrao_seg') and (v->>'tempo_padrao_seg')::numeric < 0 then
      raise exception 'Tempo padrão não pode ser negativo.';
    end if;
    update bernard.produto_processos set
      tempo_padrao_seg = case when v ? 'tempo_padrao_seg' then (v->>'tempo_padrao_seg')::numeric else tempo_padrao_seg end,
      sequencia = case when v ? 'sequencia' then (v->>'sequencia')::int else sequencia end,
      pessoas = case when v ? 'pessoas' then (v->>'pessoas')::int else pessoas end
    where id = (v->>'id')::bigint;
    if found then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end $$;
revoke all on function bernard.salvar_roteiro(jsonb, text) from public, anon;
grant execute on function bernard.salvar_roteiro(jsonb, text) to authenticated;
