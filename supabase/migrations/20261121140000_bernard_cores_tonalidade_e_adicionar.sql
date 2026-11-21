-- BERNARD · Cor escolhida como "PRETO 2" (cor + tonalidade numa lista só), botões de adicionar cor e elástico,
-- e ordem dos processos igual à folha impressa (Meio primeiro; Corte Elástico e Tag no fim).

-- Variações de cor que aparecem na lista (PRETO 1, PRETO 2...). A cor base (sem número) vem de bernard.cores.
create table if not exists bernard.cor_tonalidades (
  cor_id bigint not null references bernard.cores(id),
  tonalidade int not null check (tonalidade > 0),
  primary key (cor_id, tonalidade)
);
alter table bernard.cor_tonalidades enable row level security;
drop policy if exists leitura_usuarios on bernard.cor_tonalidades;
create policy leitura_usuarios on bernard.cor_tonalidades for select to authenticated using ((select bernard.eh_usuario()));
grant select on bernard.cor_tonalidades to authenticated;
grant all on bernard.cor_tonalidades to service_role;

insert into bernard.cor_tonalidades(cor_id, tonalidade)
select distinct cor_id, tonalidade from bernard.corte_itens where cor_id is not null and tonalidade is not null
on conflict do nothing;

-- Toda linha de corte com tonalidade garante a variação na lista
create or replace function bernard._registra_tonalidade() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.cor_id is not null and new.tonalidade is not null then
    insert into bernard.cor_tonalidades(cor_id, tonalidade) values (new.cor_id, new.tonalidade) on conflict do nothing;
  end if;
  return new;
end $$;
drop trigger if exists registra_tonalidade on bernard.corte_itens;
create trigger registra_tonalidade after insert or update of cor_id, tonalidade on bernard.corte_itens
  for each row execute function bernard._registra_tonalidade();

-- Lista para o corte: chave "cor_id|tonalidade" e nome "PRETO 2"
create or replace view bernard.v_cores_corte with (security_invoker = true) as
select c.id::text || '|' as chave, c.id as cor_id, null::int as tonalidade, c.nome, c.ativo
  from bernard.cores c
union all
select t.cor_id::text || '|' || t.tonalidade, t.cor_id, t.tonalidade, c.nome || ' ' || t.tonalidade, c.ativo
  from bernard.cor_tonalidades t join bernard.cores c on c.id = t.cor_id;
grant select on bernard.v_cores_corte to authenticated;

-- Adicionar cor pelo corte: "preto 3" -> cor PRETO (cria se não existir) + tonalidade 3
create or replace function bernard.adicionar_cor(p_nome text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_txt text := upper(regexp_replace(trim(coalesce(p_nome, '')), '\s+', ' ', 'g'));
  v_base text; v_ton int; v_id bigint;
begin
  if not (bernard.tem_perfil('corte') or bernard.tem_perfil('cadastros')) then
    raise exception 'Acesso negado: adicionar cor exige o perfil corte ou cadastros.' using errcode = '42501';
  end if;
  if length(v_txt) < 2 then raise exception 'Informe o nome da cor.'; end if;
  v_base := trim(regexp_replace(v_txt, '\s*\d+$', ''));
  v_ton := nullif(substring(v_txt from '(\d+)$'), '')::int;
  if v_base = '' then raise exception 'Informe o nome da cor (ex.: PRETO 3).'; end if;
  if v_ton = 0 then raise exception 'A tonalidade deve ser 1 ou maior.'; end if;
  select id into v_id from bernard.cores where upper(nome) = v_base;
  if v_id is null then
    insert into bernard.cores(nome) values (v_base) returning id into v_id;
  else
    update bernard.cores set ativo = true where id = v_id and not ativo;
  end if;
  if v_ton is not null then
    insert into bernard.cor_tonalidades(cor_id, tonalidade) values (v_id, v_ton) on conflict do nothing;
  end if;
  return jsonb_build_object('chave', v_id::text || '|' || coalesce(v_ton::text, ''), 'cor_id', v_id, 'tonalidade', v_ton,
                            'nome', v_base || coalesce(' ' || v_ton, ''));
end $$;

-- Adicionar elástico (marca) pelo corte
create or replace function bernard.adicionar_elastico(p_nome text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_txt text := upper(regexp_replace(trim(coalesce(p_nome, '')), '\s+', ' ', 'g')); v_id bigint;
begin
  if not (bernard.tem_perfil('corte') or bernard.tem_perfil('cadastros')) then
    raise exception 'Acesso negado: adicionar elástico exige o perfil corte ou cadastros.' using errcode = '42501';
  end if;
  if length(v_txt) < 2 then raise exception 'Informe o nome do elástico.'; end if;
  select id into v_id from bernard.elasticos where upper(nome) = v_txt;
  if v_id is null then
    insert into bernard.elasticos(nome) values (v_txt) returning id into v_id;
  else
    update bernard.elasticos set ativo = true where id = v_id and not ativo;
  end if;
  return jsonb_build_object('id', v_id, 'nome', v_txt);
end $$;

revoke all on function bernard.adicionar_cor(text), bernard.adicionar_elastico(text), bernard._registra_tonalidade() from public, anon, authenticated;
grant execute on function bernard.adicionar_cor(text), bernard.adicionar_elastico(text) to authenticated;

-- Ordem dos processos = ordem da folha impressa
update bernard.produto_processos pp set sequencia = o.seq
from bernard.processos pr
join (values ('Meio',1),('Pesponto',2),('Fundo',3),('Refilar',4),('Embutir',5),('Travete',6),
             ('Bainha',7),('Arremate',8),('Embalagem',9),('Corte Elástico',10),('Tag',11)) o(nome, seq) on o.nome = pr.nome
where pp.processo_id = pr.id;
