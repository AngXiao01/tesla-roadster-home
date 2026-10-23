import zh from '../i18n/zh-CN.json'

/**
 * Single-language (Simplified Chinese) text lookup. Every visible string is a key in
 * `src/i18n/zh-CN.json`; `{name}` placeholders are replaced from `vars`.
 */
export type Dictionary = Record<string, string>
const DICT: Dictionary = zh

export class I18n {
  readonly locale = 'zh-CN'
  constructor() {
    document.documentElement.lang = this.locale
  }
  /** Missing keys render the key itself so gaps are visible. */
  t(key: string, vars: Record<string, string | number> = {}): string {
    const text = DICT[key] ?? key
    return text.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`))
  }
}

export const DICTIONARY_KEYS = Object.keys(zh)
