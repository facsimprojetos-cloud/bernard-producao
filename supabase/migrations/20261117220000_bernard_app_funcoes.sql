-- BERNARD · funções usadas pelo app (login, bip, corte, usuários)
-- Só mexe no schema bernard. Regras de premiação:
--   minutos = round(qtd × tempo_padrao_seg / 60), com o tempo copiado do roteiro no momento do bip;
--   o fechamento agrupa por data_producao; registros APPSHEET nunca são alterados.

-- ---------------------------------------------------------------------------
-- Sessão: devolve o usuário logado (pelo id ou pelo e-mail) e grava o id no 1º login
-- ---------------------------------------------------------------------------
create or replace function bernard.status_sistema()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(auth.jwt()->>'email'); v jsonb;
begin
  if auth.uid() is null then return jsonb_build_object('usuario', null); end if;
  update bernard.usuarios u set id = auth.uid()
   where u.id is null and lower(u.email) = v_email
     and not exists (select 1 from bernard.usuarios x where x.id = auth.uid());
  select jsonb_build_object('usuario_id', u.usuario_id, 'nome', coalesce(nullif(u.nome, ''), u.email),
                            'email', u.email, 'perfis', u.perfis, 'ativo', u.ativo)
    into v
    from bernard.usuarios u
   where u.id = auth.uid() or lower(u.email) = v_email
   order by (u.id = auth.uid()) desc nulls last
   limit 1;
  return jsonb_build_object('usuario', v);
end $$;

-- ---------------------------------------------------------------------------
-- Acha o item pelo conteúdo do QR. Aceita o código novo (B000123) e, na transição,
-- o texto das etiquetas antigas do AppSheet (ex.: "550 MEIO-MARINHO 6-GG"), se for único.
-- ---------------------------------------------------------------------------
create or replace function bernard._item_por_texto(p_texto text)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_txt text := trim(coalesce(p_texto, '')); v_id uuid; v_n int;
begin
  if v_txt = '' then raise exception 'Informe o código da etiqueta.'; end if;
  select id into v_id from bernard.corte_itens where codigo = upper(v_txt);
  if v_id is not null then return v_id; end if;
  select count(*), min(id::text)::uuid into v_n, v_id
    from bernard.corte_itens where lower(idcorte_original) = lower(v_txt);
  if v_n = 1 then return v_id; end if;
  if v_n > 1 then
    raise exception 'Etiqueta antiga "%" corresponde a % itens. Reimprima a etiqueta nova deste corte.', v_txt, v_n;
  end if;
  raise exception 'Etiqueta "%" não encontrada.', v_txt;
end $$;

-- ---------------------------------------------------------------------------
-- Consulta do item para a tela de bip: dados da etiqueta + processos do roteiro
-- (com tempo padrão, se a funcionária sabe fazer e quanto já foi apontado)
-- ---------------------------------------------------------------------------
create or replace function bernard.consultar_item(p_codigo text, p_funcionario bigint default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid; v_prod bigint; v_tec bigint; v_item jsonb; v_proc jsonb;
begin
  if not bernard.eh_usuario() then raise exception 'Acesso negado.' using errcode = '42501'; end if;
  v_id := bernard._item_por_texto(p_codigo);
  select c.produto_id, c.tecido_id into v_prod, v_tec
    from bernard.corte_itens i join bernard.cortes c on c.id = i.corte_id where i.id = v_id;
  select to_jsonb(v) || jsonb_build_object('etiqueta_antiga', upper(trim(p_codigo)) <> v.codigo)
    into v_item from bernard.v_corte_itens v where v.id = v_id;
  select coalesce(jsonb_agg(jsonb_build_object(
           'processo_id', pp.processo_id, 'processo', pr.nome, 'sequencia', pp.sequencia,
           'tempo_padrao_seg', pp.tempo_padrao_seg,
           'sabe', exists (select 1 from bernard.funcionario_processos fp
                            where fp.funcionario_id = p_funcionario and fp.processo_id = pp.processo_id),
           'apontado', (select coalesce(sum(a.qtd), 0) from bernard.apontamentos a
                         where a.corte_item_id = v_id and a.processo_id = pp.processo_id))
           order by pp.sequencia nulls last, pr.nome), '[]'::jsonb)
    into v_proc
    from bernard.produto_processos pp join bernard.processos pr on pr.id = pp.processo_id
   where pp.produto_id = v_prod and pp.tecido_id is not distinct from v_tec and pr.ativo;
  return jsonb_build_object('item', v_item, 'processos', v_proc);
end $$;

-- ---------------------------------------------------------------------------
-- O bip. O tempo padrão é buscado aqui, no servidor, e copiado para o apontamento.
-- ---------------------------------------------------------------------------
create or replace function bernard.registrar_apontamento(
  p_codigo text, p_processo bigint, p_funcionario bigint, p_qtd integer,
  p_data_producao date, p_obs text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_item uuid; v_prod bigint; v_tec bigint; v_tempo numeric; v_achou boolean; v_id uuid;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
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
  insert into bernard.apontamentos(corte_item_id, processo_id, funcionario_id, qtd, tempo_padrao_seg,
                                   data_producao, obs, origem)
  values (v_item, p_processo, p_funcionario, p_qtd, coalesce(v_tempo, 0),
          p_data_producao, nullif(trim(p_obs), ''), 'APP')
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'tempo_padrao_seg', coalesce(v_tempo, 0), 'sem_tempo', v_tempo is null,
                            'minutos', round(p_qtd * coalesce(v_tempo, 0) / 60));
end $$;

-- Desfazer um bip errado: quem lançou, até 15 minutos depois; o supervisor, a qualquer momento.
create or replace function bernard.desfazer_apontamento(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare a record;
begin
  select * into a from bernard.apontamentos where id = p_id;
  if a.id is null then raise exception 'Apontamento não encontrado.'; end if;
  if a.origem <> 'APP' then raise exception 'Apontamentos do histórico (AppSheet) não podem ser excluídos.'; end if;
  if not (bernard.tem_perfil('supervisor')
          or (a.criado_por = auth.uid() and a.data_hora > now() - interval '15 minutes' and bernard.tem_perfil('producao'))) then
    raise exception 'Só é possível desfazer o próprio lançamento em até 15 minutos. Peça ao supervisor.' using errcode = '42501';
  end if;
  delete from bernard.apontamentos where id = p_id;
end $$;

-- O bip só entra pela função acima (o app não grava o tempo direto na tabela)
drop policy if exists producao_insere on bernard.apontamentos;

-- Histórico migrado do AppSheet: ninguém altera nem apaga pelo app/API
create or replace function bernard._protege_historico()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.origem = 'APPSHEET' and current_user in ('authenticated', 'anon') then
    raise exception 'Registro do histórico do AppSheet: não pode ser alterado nem excluído.' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists protege_historico on bernard.apontamentos;
create trigger protege_historico before update or delete on bernard.apontamentos
  for each row execute function bernard._protege_historico();

-- ---------------------------------------------------------------------------
-- Corte: cria ou altera o corte com todas as linhas numa transação só
-- p = {id?, numero, sequencia, tipo_risco_id, data, produto_id, tecido_id, destino, faccao_id, obs,
--      itens: [{id?, cor_id, tonalidade, tamanho_id, qtd, elasticos: [id…]}]}
-- ---------------------------------------------------------------------------
create or replace function bernard.salvar_corte(p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid := nullif(p->>'id', '')::uuid; v_ant record; it jsonb; v_item uuid; v_ids uuid[] := '{}';
  v_destino text := coalesce(nullif(p->>'destino', ''), 'INTERNO'); v_faccao bigint := nullif(p->>'faccao_id', '')::bigint;
  v_tem_apont boolean := false; v_dup text;
begin
  perform bernard.exigir_perfil('corte');
  if coalesce((p->>'numero')::int, 0) <= 0 then raise exception 'Informe o número do corte.'; end if;
  if nullif(p->>'produto_id', '') is null then raise exception 'Escolha o produto.'; end if;
  if nullif(p->>'tecido_id', '') is null then raise exception 'Escolha o tecido.'; end if;
  if nullif(p->>'tipo_risco_id', '') is null then raise exception 'Escolha o tipo de risco.'; end if;
  if v_destino = 'INTERNO' then v_faccao := null; end if;
  if v_destino = 'FACÇÃO' and v_faccao is null then raise exception 'Escolha a facção.'; end if;
  if jsonb_array_length(coalesce(p->'itens', '[]')) = 0 then raise exception 'Adicione ao menos uma linha.'; end if;

  -- (só confere quando o corte é novo ou mudou de número/sequência/risco: o histórico tem repetidos)
  if not exists (select 1 from bernard.cortes c where c.id = v_id and c.numero = (p->>'numero')::int
                   and c.sequencia = coalesce(nullif(p->>'sequencia', '')::int, 1)
                   and c.tipo_risco_id = (p->>'tipo_risco_id')::bigint)
     and exists (select 1 from bernard.cortes c where c.numero = (p->>'numero')::int
               and c.sequencia = coalesce(nullif(p->>'sequencia', '')::int, 1)
               and c.tipo_risco_id = (p->>'tipo_risco_id')::bigint
               and c.id is distinct from v_id) then
    raise exception 'Já existe o corte % (sequência %) com este tipo de risco.', p->>'numero', coalesce(nullif(p->>'sequencia', ''), '1');
  end if;

  select string_agg(distinct k, ', ') into v_dup from (
    select concat_ws('/', x->>'cor_id', coalesce(x->>'tonalidade', ''), x->>'tamanho_id') k
      from jsonb_array_elements(p->'itens') x
     group by 1 having count(*) > 1) d;
  if v_dup is not null then raise exception 'Há linhas repetidas (mesma cor, tonalidade e tamanho). Junte as quantidades numa linha só.'; end if;

  if v_id is null then
    insert into bernard.cortes(numero, sequencia, tipo_risco_id, data, produto_id, tecido_id, destino, faccao_id, obs)
    values ((p->>'numero')::int, coalesce(nullif(p->>'sequencia', '')::int, 1), (p->>'tipo_risco_id')::bigint,
            coalesce(nullif(p->>'data', '')::date, (now() at time zone 'America/Sao_Paulo')::date),
            (p->>'produto_id')::bigint, (p->>'tecido_id')::bigint, v_destino, v_faccao, nullif(trim(p->>'obs'), ''))
    returning id into v_id;
  else
    select * into v_ant from bernard.cortes where id = v_id for update;
    if v_ant.id is null then raise exception 'Corte não encontrado.'; end if;
    v_tem_apont := exists (select 1 from bernard.apontamentos a join bernard.corte_itens i on i.id = a.corte_item_id where i.corte_id = v_id);
    if v_tem_apont and (v_ant.produto_id <> (p->>'produto_id')::bigint or v_ant.tecido_id is distinct from (p->>'tecido_id')::bigint) then
      raise exception 'Este corte já tem apontamentos: não é possível trocar o produto nem o tecido.';
    end if;
    update bernard.cortes set numero = (p->>'numero')::int, sequencia = coalesce(nullif(p->>'sequencia', '')::int, 1),
      tipo_risco_id = (p->>'tipo_risco_id')::bigint, data = coalesce(nullif(p->>'data', '')::date, data),
      produto_id = (p->>'produto_id')::bigint, tecido_id = (p->>'tecido_id')::bigint,
      destino = v_destino, faccao_id = v_faccao, obs = nullif(trim(p->>'obs'), '')
    where id = v_id;
  end if;

  for it in select * from jsonb_array_elements(p->'itens') loop
    if nullif(it->>'cor_id', '') is null or nullif(it->>'tamanho_id', '') is null then
      raise exception 'Toda linha precisa de cor e tamanho.';
    end if;
    if coalesce((it->>'qtd')::int, 0) <= 0 then raise exception 'Toda linha precisa de quantidade maior que zero.'; end if;
    v_item := nullif(it->>'id', '')::uuid;
    if v_item is null then
      insert into bernard.corte_itens(corte_id, cor_id, tonalidade, tamanho_id, qtd)
      values (v_id, (it->>'cor_id')::bigint, nullif(it->>'tonalidade', '')::int, (it->>'tamanho_id')::bigint, (it->>'qtd')::int)
      returning id into v_item;
    else
      update bernard.corte_itens set cor_id = (it->>'cor_id')::bigint, tonalidade = nullif(it->>'tonalidade', '')::int,
        tamanho_id = (it->>'tamanho_id')::bigint, qtd = (it->>'qtd')::int
      where id = v_item and corte_id = v_id;
      if not found then raise exception 'Linha não pertence a este corte.'; end if;
      delete from bernard.corte_item_elasticos where corte_item_id = v_item;
    end if;
    insert into bernard.corte_item_elasticos(corte_item_id, elastico_id)
    select distinct v_item, e::bigint from jsonb_array_elements_text(coalesce(it->'elasticos', '[]')) e;
    v_ids := v_ids || v_item;
  end loop;

  -- linhas removidas na tela
  if exists (select 1 from bernard.corte_itens i where i.corte_id = v_id and i.id <> all(v_ids)
               and exists (select 1 from bernard.apontamentos a where a.corte_item_id = i.id)) then
    raise exception 'Não é possível remover linhas que já têm apontamentos.';
  end if;
  delete from bernard.corte_itens i where i.corte_id = v_id and i.id <> all(v_ids);
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Usuários (perfil admin). Login sem e-mail real vira <usuario>@bernard.app.
-- Mesmo padrão de klinik.criar_usuario / klinik.redefinir_senha.
-- ---------------------------------------------------------------------------
create or replace function bernard._criar_conta_auth(p_email text, p_senha text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_email text := lower(trim(p_email));
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'E-mail inválido: %', p_email; end if;
  select id into v_id from auth.users where lower(email) = v_email;
  if v_id is not null then return v_id; end if;
  v_id := gen_random_uuid();
  insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change, email_change_token_new)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', v_email,
    extensions.crypt(p_senha, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');
  insert into auth.identities(id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id, v_id::text, jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true), 'email', now(), now(), now());
  return v_id;
end $$;

create or replace function bernard._email_login(p_login text)
returns text language sql immutable set search_path = '' as $$
  select case when position('@' in trim(p_login)) > 0 then lower(trim(p_login))
              else lower(trim(p_login)) || '@bernard.app' end;
$$;

create or replace function bernard.criar_usuario(p_login text, p_nome text, p_perfis text[], p_senha text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_email text := bernard._email_login(p_login); v_interno boolean; v_id uuid; v_existia boolean;
begin
  perform bernard.exigir_perfil('admin');
  v_interno := v_email like '%@bernard.app';
  if v_interno and split_part(v_email, '@', 1) !~ '^[a-z0-9][a-z0-9._-]{2,30}$' then
    raise exception 'Usuário inválido: use de 3 a 31 letras minúsculas, números, ponto, hífen ou sublinhado, sem espaço nem acento.';
  end if;
  if coalesce(trim(p_nome), '') = '' then raise exception 'Informe o nome.'; end if;
  if coalesce(array_length(p_perfis, 1), 0) = 0 then raise exception 'Marque ao menos um perfil.'; end if;
  if exists (select 1 from bernard.usuarios where lower(email) = v_email) then raise exception 'Este login já é usuário do sistema.'; end if;
  v_existia := exists (select 1 from auth.users where lower(email) = v_email);
  if v_interno and v_existia then raise exception 'Este usuário já existe.'; end if;
  if v_interno and length(coalesce(p_senha, '')) < 6 then raise exception 'A senha precisa ter pelo menos 6 caracteres.'; end if;
  if v_interno or not v_existia then
    v_id := bernard._criar_conta_auth(v_email, coalesce(nullif(p_senha, ''), '123456'));
  else
    select id into v_id from auth.users where lower(email) = v_email;
  end if;
  insert into bernard.usuarios(id, nome, email, perfis, ativo) values (v_id, trim(p_nome), v_email, p_perfis, true);
  return jsonb_build_object('email', v_email, 'interno', v_interno, 'conta_existente', v_existia);
end $$;

create or replace function bernard.redefinir_senha(p_usuario_id bigint, p_senha text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_email text;
begin
  perform bernard.exigir_perfil('admin');
  select lower(email) into v_email from bernard.usuarios where usuario_id = p_usuario_id;
  if v_email is null then raise exception 'Usuário não encontrado.'; end if;
  if v_email not like '%@bernard.app' then
    raise exception 'Este login usa e-mail real (pode ser usado em outros apps). A pessoa deve usar "Esqueci minha senha" ou entrar com o Google.';
  end if;
  if length(coalesce(p_senha, '')) < 6 then raise exception 'A senha precisa ter pelo menos 6 caracteres.'; end if;
  update auth.users set encrypted_password = extensions.crypt(p_senha, extensions.gen_salt('bf')),
    email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now()
  where lower(email) = v_email;
  if not found then raise exception 'Conta de acesso não encontrada para %.', v_email; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Permissões: só usuários logados chamam; funções internas (_) ficam fechadas
-- ---------------------------------------------------------------------------
revoke all on function bernard.status_sistema(), bernard._item_por_texto(text), bernard.consultar_item(text, bigint),
  bernard.registrar_apontamento(text, bigint, bigint, integer, date, text), bernard.desfazer_apontamento(uuid),
  bernard.salvar_corte(jsonb), bernard._criar_conta_auth(text, text), bernard._email_login(text),
  bernard.criar_usuario(text, text, text[], text), bernard.redefinir_senha(bigint, text), bernard._protege_historico()
  from public, anon, authenticated;
grant execute on function bernard.status_sistema(), bernard.consultar_item(text, bigint),
  bernard.registrar_apontamento(text, bigint, bigint, integer, date, text), bernard.desfazer_apontamento(uuid),
  bernard.salvar_corte(jsonb), bernard.criar_usuario(text, text, text[], text), bernard.redefinir_senha(bigint, text)
  to authenticated;
