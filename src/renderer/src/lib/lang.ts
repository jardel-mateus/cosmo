import { pickLang, setLang } from '@shared/i18n';

let pref: string | undefined;
try { pref = (JSON.parse(localStorage.getItem('cartucho.set') || '{}') as { lang?: string }).lang; } catch { }
setLang(pickLang(pref === 'pt' || pref === 'en' ? pref : 'auto', navigator.language));
