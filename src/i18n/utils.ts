import en from './en.json';
import zh from './zh.json';

const messages: Record<string, Record<string, string>> = { en, zh };

export function t(lang: string, key: string): string {
  return messages[lang]?.[key] ?? messages.en[key] ?? key;
}
