import type { TranslationKeys } from './index'
import { assembleLocale } from './assembleLocale'
import brewJa from './brew.ja-JP.json'
import brewZh from './brew.zh-CN.json'
import configJa from './config.ja-JP.json'
import configZh from './config.zh-CN.json'
import errorsJa from './errors.ja-JP.json'
import errorsZh from './errors.zh-CN.json'
import ja from './ja-JP.json'
import meropeJa from './merope.ja-JP.json'
import meropeZh from './merope.zh-CN.json'
import tappJa from './tapp.ja-JP.json'
import tappZh from './tapp.zh-CN.json'
import zh from './zh-CN.json'

const _zh: TranslationKeys = assembleLocale(zh, {
  config: configZh,
  tapp: tappZh,
  brew: brewZh,
  merope: meropeZh,
  errors: errorsZh,
})
const _ja: TranslationKeys = assembleLocale(ja, {
  config: configJa,
  tapp: tappJa,
  brew: brewJa,
  merope: meropeJa,
  errors: errorsJa,
})

void _zh
void _ja
