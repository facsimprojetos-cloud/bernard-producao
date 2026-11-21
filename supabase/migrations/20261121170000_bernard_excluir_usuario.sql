-- BERNARD · Excluir usuário (só admin).
-- Login e senha (@bernard.app): apaga o acesso e a conta de login.
-- E-mail: só tira o acesso ao Bernard; a conta de e-mail não é apagada (pode ser usada em outros projetos).
-- Os apontamentos já feitos por esse login continuam no histórico.
create or replace function bernard.excluir_usuario(p_usuario_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u bernard.usuarios%rowtype; v_interno boolean;
begin
  perform bernard.exigir_perfil('admin');
  select * into u from bernard.usuarios where usuario_id = p_usuario_id;
  if not found then raise exception 'Usuário não encontrado.'; end if;
  if lower(u.email) = lower(auth.jwt() ->> 'email') then
    raise exception 'Você não pode excluir o seu próprio usuário.';
  end if;
  if 'admin' = any(u.perfis) and u.ativo and not exists (
       select 1 from bernard.usuarios x where x.usuario_id <> u.usuario_id and x.ativo and 'admin' = any(x.perfis)) then
    raise exception 'Não é possível excluir o último administrador ativo.';
  end if;
  v_interno := lower(u.email) like '%@bernard.app';
  delete from bernard.usuarios where usuario_id = u.usuario_id;
  if v_interno and u.id is not null then
    delete from auth.users where id = u.id;
  end if;
  return jsonb_build_object('email', u.email, 'conta_apagada', v_interno);
end $$;
revoke all on function bernard.excluir_usuario(bigint) from public, anon;
grant execute on function bernard.excluir_usuario(bigint) to authenticated;
