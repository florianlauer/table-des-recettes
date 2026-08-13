import { renderToStaticMarkup } from 'react-dom/server.browser'
import { describe, expect, test } from 'vitest'
import { AdminTable, AdminTableDetail } from './-AdminTable'

const COLUMNS = [
  { label: 'Page' },
  { label: 'Images', numeric: true },
  { label: 'État' },
] as const

describe('AdminTable', () => {
  test('reads its heading row off the columns, and marks only the figures', () => {
    const markup = renderToStaticMarkup(
      <AdminTable columns={COLUMNS}>
        <tbody />
      </AdminTable>,
    )

    expect(markup).toContain('<th scope="col">Page</th>')
    expect(markup).toContain('<th scope="col" class="admin-table__n">Images')
    expect(markup).toContain('<th scope="col">État</th>')
  })

  test('spans a detail row over the columns there are, not over a number typed by hand', () => {
    // The regression this frame exists to prevent: a column added to the heading list used to leave
    // every detail row one short, with nothing failing.
    const markup = renderToStaticMarkup(
      <AdminTable columns={[...COLUMNS, { label: 'Action' }]}>
        <tbody>
          <AdminTableDetail>note</AdminTableDetail>
        </tbody>
      </AdminTable>,
    )

    // `colSpan` as React writes it, uppercase and all.
    expect(markup).toContain('colSpan="4"')
  })

  test('keeps the table in a box that scrolls, so the page never does', () => {
    const markup = renderToStaticMarkup(
      <AdminTable columns={COLUMNS}>
        <tbody />
      </AdminTable>,
    )
    expect(markup).toContain('<div class="admin-table__scroll">')
  })
})
