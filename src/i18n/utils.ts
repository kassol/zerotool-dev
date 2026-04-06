import en from './en.json';
import zh from './zh.json';
import ja from './ja.json';

const messages: Record<string, Record<string, string>> = { en, zh, ja };

export function t(lang: string, key: string): string {
  return messages[lang]?.[key] ?? messages.en[key] ?? key;
}
