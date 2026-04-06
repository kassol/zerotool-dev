import en from './en.json';
import zh from './zh.json';
import ja from './ja.json';
import ko from './ko.json';

const messages: Record<string, Record<string, string>> = { en, zh, ja, ko };

export function t(lang: string, key: string): string {
  return messages[lang]?.[key] ?? messages.en[key] ?? key;
}
