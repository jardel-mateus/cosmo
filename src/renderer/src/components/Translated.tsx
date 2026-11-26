import { useTranslated } from '../lib/translate';
import { tt } from '@shared/i18n';

export function Translated({ text }: { text: string | null | undefined }) {
  const t = useTranslated(text);
  return <span title={t.auto ? tt('Traduzido automaticamente. Original: {0}', { 0: text }) : undefined}>{t.text}</span>;
}
