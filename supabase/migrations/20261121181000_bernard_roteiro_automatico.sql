-- BERNARD · Produto, tecido ou processo novo já cria as linhas do roteiro (tempo vazio),
-- para aparecerem em "Tempo padrão por modelo" e serem preenchidas lá.
create or replace function bernard._roteiro_automatico() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'processos' then
    insert into bernard.produto_processos(produto_id, tecido_id, processo_id, sequencia)
    select x.produto_id, x.tecido_id, new.id, max(x.sequencia) + 1
      from bernard.produto_processos x group by x.produto_id, x.tecido_id
    on conflict do nothing;
  else
    insert into bernard.produto_processos(produto_id, tecido_id, processo_id, sequencia)
    select p.id, t.id, pr.id, coalesce((select min(y.sequencia) from bernard.produto_processos y where y.processo_id = pr.id), 99)
      from bernard.produtos p cross join bernard.tecidos t cross join bernard.processos pr
     where (case when tg_table_name = 'produtos' then p.id else t.id end) = new.id
       and not exists (select 1 from bernard.produto_processos z where z.produto_id = p.id and z.tecido_id = t.id and z.processo_id = pr.id);
  end if;
  return new;
end $$;
drop trigger if exists roteiro_automatico on bernard.produtos;
create trigger roteiro_automatico after insert on bernard.produtos for each row execute function bernard._roteiro_automatico();
drop trigger if exists roteiro_automatico on bernard.tecidos;
create trigger roteiro_automatico after insert on bernard.tecidos for each row execute function bernard._roteiro_automatico();
drop trigger if exists roteiro_automatico on bernard.processos;
create trigger roteiro_automatico after insert on bernard.processos for each row execute function bernard._roteiro_automatico();
