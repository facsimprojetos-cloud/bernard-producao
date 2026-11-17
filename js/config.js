// Configuração pública do app (a chave publicável do Supabase é feita para ficar no front-end;
// a proteção dos dados é feita por login + RLS + funções com checagem de perfil no banco).
export const SUPABASE_URL = 'https://swledaccsxcqpffjvtdh.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_CP90sN-553zB3BfUW05NTA_S5ZVPNrP';
export const SCHEMA = 'bernard';
export const EMPRESA = 'BERNARD';
// Logins sem e-mail real (celulares da produção) viram <usuario>@bernard.app
export const DOMINIO_INTERNO = 'bernard.app';

// Login com Google: deixe false enquanto o provedor Google estiver desativado no Supabase
// (Authentication > Providers). Ao ativar lá, mude para true e publique.
export const LOGIN_GOOGLE = false;
