import type { TranslationKeys } from './index'
import agentCapsJa from './agentCaps.ja-JP.json'
import agentCapsZh from './agentCaps.zh-CN.json'
import agentCapsTw from './agentCaps.zh-TW.json'
import { assembleLocale } from './assembleLocale'
import brewJa from './brew.ja-JP.json'
import brewZh from './brew.zh-CN.json'
import brewTw from './brew.zh-TW.json'
import configJa from './config.ja-JP.json'
import configZh from './config.zh-CN.json'
import configTw from './config.zh-TW.json'
import errorsJa from './errors.ja-JP.json'
import errorsZh from './errors.zh-CN.json'
import errorsTw from './errors.zh-TW.json'
import ja from './ja-JP.json'
import meropeJa from './merope.ja-JP.json'
import meropeZh from './merope.zh-CN.json'
import meropeTw from './merope.zh-TW.json'
import tappJa from './tapp.ja-JP.json'
import tappZh from './tapp.zh-CN.json'
import tappTw from './tapp.zh-TW.json'
import zh from './zh-CN.json'
import tw from './zh-TW.json'

const _zh: TranslationKeys = assembleLocale(zh, {
  config: configZh,
  tapp: tappZh,
  brew: brewZh,
  merope: meropeZh,
  errors: errorsZh,
  agentCaps: agentCapsZh,
})
const _tw: TranslationKeys = assembleLocale(tw, {
  config: configTw,
  tapp: tappTw,
  brew: brewTw,
  merope: meropeTw,
  errors: errorsTw,
  agentCaps: agentCapsTw,
})
const _ja: TranslationKeys = assembleLocale(ja, {
  config: configJa,
  tapp: tappJa,
  brew: brewJa,
  merope: meropeJa,
  errors: errorsJa,
  agentCaps: agentCapsJa,
})

void _zh
void _tw
void _ja
