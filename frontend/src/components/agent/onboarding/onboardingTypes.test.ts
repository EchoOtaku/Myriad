import assert from 'node:assert/strict'
import test from 'node:test'
import {
  flattenPersona,
  parseFlattenedPersona,
  personaFromApi,
} from './onboardingTypes'

test('flatten then parse keeps character fields', () => {
  const persona = {
    summary: '话少，认真。',
    temperament: ['克制', '细心'],
    likes: ['雨声'],
    drives: ['理解彼此'],
    socialStyle: '不抢话',
    speechStyle: '简洁温和',
    draftSource: 'lite',
  }
  const parsed = parseFlattenedPersona(flattenPersona(persona))
  assert.deepEqual(parsed.temperament, persona.temperament)
  assert.equal(parsed.summary, persona.summary)
  assert.equal(parsed.socialStyle, persona.socialStyle)
})

test('personaFromApi reads nested persona without visual keys', () => {
  const parsed = personaFromApi({
    persona: {
      summary: '安静但会认真回应。',
      temperament: ['克制'],
      visualIdentity: { hairShape: '短发' },
    },
  })
  assert.equal(parsed.summary, '安静但会认真回应。')
  assert.deepEqual(parsed.temperament, ['克制'])
})
