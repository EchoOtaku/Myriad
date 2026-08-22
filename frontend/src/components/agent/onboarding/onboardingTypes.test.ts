import assert from 'node:assert/strict'
import test from 'node:test'
import {
  completedPersonaResumeStep,
  flattenPersona,
  incompletePersonaFields,
  onboardingSeedsFromProfile,
  parseFlattenedPersona,
  parseList,
  parseUpperBodyVisualIdentity,
  personaFromApi,
  structuredPersonaIsComplete,
} from './onboardingTypes'

test('flatten then parse keeps character fields', () => {
  const persona = {
    summary: '话少，认真。',
    temperament: ['克制', '细心'],
    likes: ['雨声'],
    drives: ['理解彼此'],
    socialStyle: '不抢话',
    speechStyle: '简洁温和',
  }
  const parsed = parseFlattenedPersona(flattenPersona(persona))
  assert.deepEqual(parsed.temperament, persona.temperament)
  assert.equal(parsed.summary, persona.summary)
  assert.equal(parsed.socialStyle, persona.socialStyle)
})

test('upper-body visual identity requires every frozen design field', () => {
  const complete = {
    faceDesign: 'oval face',
    eyeDesign: 'violet jewel eyes',
    hairShape: 'pink bob',
    hairLayerPlan: 'back mass, bangs, left and right side locks',
    upperBodySilhouette: 'compact shoulders and clear collar',
    outfitConstruction: 'inner blouse, sailor collar, cropped outer layer',
    sleeveArmDesign: 'left and right sleeve fragments enter the frame',
    materialPlan: 'matte cloth, polished metal, restrained gem highlights',
    heroAccessory: 'one star clasp at the chest',
    paletteHint: 'pink, lavender, white, and a little gold',
    motif: 'one restrained star-track arc',
  }
  assert.deepEqual(parseUpperBodyVisualIdentity(complete), complete)
  assert.equal(
    parseUpperBodyVisualIdentity({ ...complete, eyeDesign: '' }),
    null,
  )
})

test('parseList keeps commas inside an English item', () => {
  assert.deepEqual(parseList('Blunt mouth, soft heart、Recharges alone'), [
    'Blunt mouth, soft heart',
    'Recharges alone',
  ])
})

test('personaFromApi reads character fields and ignores visuals', () => {
  const parsed = personaFromApi({
    summary: '安静但会认真回应。',
    temperament: ['克制'],
    visualIdentity: { hairShape: '短发' },
  })
  assert.equal(parsed.summary, '安静但会认真回应。')
  assert.deepEqual(parsed.temperament, ['克制'])
  assert.equal(parsed.speechStyle, '')
})

test('structured persona requires every persisted character field', () => {
  const complete = {
    summary: '安静但会认真回应重要的事情。',
    temperament: ['克制'],
    likes: ['雨声'],
    drives: ['理解彼此'],
    socialStyle: '先听，再回应。',
    speechStyle: '简洁但温和。',
  }
  assert.equal(structuredPersonaIsComplete(complete), true)
  assert.equal(
    structuredPersonaIsComplete({ ...complete, likes: [] }),
    false,
  )
})

test('incomplete persona fields name what is missing', () => {
  assert.deepEqual(
    incompletePersonaFields({
      summary: '短',
      temperament: [],
      likes: ['雨声'],
      drives: ['理解彼此'],
      socialStyle: '先听',
      speechStyle: '',
    }),
    ['summary', 'temperament', 'speechStyle'],
  )
  assert.deepEqual(
    onboardingSeedsFromProfile({
      sourceTags: [' 慢热 ', '', '嘴硬心软'],
      personaExtraRequirements: '话少',
    }),
    {
      sourceTags: ['慢热', '嘴硬心软'],
      personaExtraRequirements: '话少',
    },
  )
})

test('completed persona resumes at the first unfinished visual stage', () => {
  assert.equal(completedPersonaResumeStep(null), 4)
  const complete = {
    faceDesign: 'oval face',
    eyeDesign: 'violet jewel eyes',
    hairShape: 'pink bob',
    hairLayerPlan: 'back mass, bangs, left and right side locks',
    upperBodySilhouette: 'compact shoulders and clear collar',
    outfitConstruction: 'inner blouse and cropped outer layer',
    sleeveArmDesign: 'left and right sleeve fragments enter the frame',
    materialPlan: 'matte cloth and restrained gem highlights',
    heroAccessory: 'one star clasp at the chest',
    paletteHint: 'pink, lavender, white, and a little gold',
    motif: 'one restrained star-track arc',
  }
  assert.equal(
    completedPersonaResumeStep({ visualIdentity: complete }),
    5,
  )
})
