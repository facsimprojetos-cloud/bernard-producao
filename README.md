# BERNARD — Apontamento de produção

App web (HTML + JavaScript puro, sem build) publicado no GitHub Pages em **https://bernard.gutgestao.com.br**, com banco no Supabase (projeto **PROJETOS**, schema **`bernard`**). Mesmo padrão dos apps KLINIK, MALI e YAZFIT.

Substitui o AppSheet "Coleta de Dados Bernard" (planilha "Processos e Tempos Bernard").

## Fluxo
1. **Corte**: cabeçalho (número, tipo de risco, produto, tecido, destino/facção) + linhas de cor, tonalidade, tamanho, quantidade e elástico(s), sem limite de linhas. Cada linha vira um pacote com código único (`B000123`).
2. **Etiquetas**: QR com **só o código** do pacote + nome do item, quantidade e elástico. Folha A4 (Pimaco/Avery) ou térmica.
3. **Apontamento (bip)**: funcionária → lê o QR (câmera ou leitor) → escolhe o processo do roteiro → confirma quantidade e **data de produção** → grava.
4. **Fechamento** por `data_producao` (base da premiação).

## Regras da premiação (no banco)
- Minutos do apontamento = `round(qtd × tempo_padrao_seg / 60)`.
- O `tempo_padrao_seg` é copiado do roteiro **no servidor**, no momento do bip (`bernard.registrar_apontamento`). Mudanças no roteiro não alteram apontamentos antigos.
- Processo sem tempo padrão: o app avisa antes de gravar; o apontamento fica com 0 minutos.
- Registros com `origem = 'APPSHEET'` (histórico migrado) não podem ser alterados nem excluídos (trigger `_protege_historico`).

## Perfis
| Perfil | Pode |
|---|---|
| admin | tudo, inclusive usuários |
| producao | apontamento (bip); desfazer o próprio lançamento em até 15 min |
| corte | criar/alterar cortes e imprimir etiquetas |
| supervisor | excluir/corrigir apontamentos do app |
| fechamento | ver o fechamento por dia |
| cronoanalise | lançar medições |
| cadastros | cores, elásticos, funcionárias, produtos, roteiro… |

## Login
- **E-mail e senha** (e Google, quando o provedor for ativado no Supabase e `LOGIN_GOOGLE = true` em `js/config.js`): donos e equipe. O e-mail precisa estar em `bernard.usuarios` (o vínculo com a conta é feito no primeiro login).
- **Usuário e senha**: celulares da produção. O admin cria em **Usuários**; o login `maria` vira `maria@bernard.app` no Auth (`bernard.criar_usuario` / `bernard.redefinir_senha`, só admin).

## Estrutura
```
index.html              página única
css/app.css             estilos (inclui etiquetas para impressão)
js/config.js            URL e chave pública do Supabase
js/estado.js            cliente Supabase e usuário logado (instância única)
js/app.js               login, menu e rotas
js/util.js              utilidades, modal, cadastros em cache, câmera/QR, impressão
js/etiquetas.js         layouts e impressão das etiquetas
js/telas/*.js           uma tela por arquivo
supabase/migrations/    migrations do schema bernard aplicadas pelo app
```

As regras de negócio ficam no banco (funções `bernard.*`, `security definer` com `exigir_perfil`); o front chama essas funções e lê as views `v_*`.

## Publicação
Branch `main` publicada pelo GitHub Pages a partir da raiz. Domínio: registro **CNAME** `bernard` → `facsimprojetos-cloud.github.io` no DNS de `gutgestao.com.br` (arquivo `CNAME` na raiz).

## Telas
- [x] Login (e-mail ou usuário + senha; Google pronto, desligado)
- [x] Apontamento (bip)
- [x] Corte + etiquetas
- [x] Usuários
- [ ] Fechamento por dia
- [ ] Cadastros + roteiro
- [ ] Cronoanálise
