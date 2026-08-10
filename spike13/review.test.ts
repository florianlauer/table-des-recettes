import { describe, expect, it } from 'vitest'

import { renderReviewHtml } from './review.js'

const CELL = {
  model: 'openai/gpt-5-image-mini',
  dish: 'recadre1',
  pass: 1,
  promptVersion: 'v1',
  imageSrc: 'fixtures/renders/openai__gpt-5-image-mini/recadre1-1-v1.png',
  status: 'image',
  detail: null,
  costUsd: 0.0123,
  latencyMs: 4200,
}

describe('renderReviewHtml', () => {
  it('shows renders at 200px tall, the size the storefront actually uses', () => {
    expect(renderReviewHtml([CELL])).toContain('--judge-height: 200px')
  })

  it('offers a full-size toggle, because an enlargement stays on the table', () => {
    const html = renderReviewHtml([CELL])
    expect(html).toContain('Pleine taille')
  })

  it('puts the original next to every render, since the criterion is identity of the dish', () => {
    expect(renderReviewHtml([CELL])).toContain('fixtures/dishes/recadre1.jpg')
  })

  it('shows a failed cell as a named outcome instead of a broken image', () => {
    const html = renderReviewHtml([
      {
        ...CELL,
        imageSrc: null,
        status: 'failure',
        detail: "refusal: I can't help with that.",
      },
    ])
    expect(html).toContain('refusal')
    expect(html).not.toContain('<img src="null"')
  })

  it('escapes a detail carrying markup rather than injecting it into the page', () => {
    const html = renderReviewHtml([
      {
        ...CELL,
        imageSrc: null,
        status: 'failure',
        detail: '<script>x</script>',
      },
    ])
    expect(html).not.toContain('<script>x</script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('labels the prompt version, since v1 and v2 renders sit side by side', () => {
    const html = renderReviewHtml([CELL, { ...CELL, promptVersion: 'v2' }])
    expect(html).toContain('prompt v1')
    expect(html).toContain('prompt v2')
  })

  it('reports cost and latency, which is what picks the cheapest model that passes', () => {
    const html = renderReviewHtml([CELL])
    expect(html).toContain('0.01230')
    expect(html).toContain('4200')
  })
})
