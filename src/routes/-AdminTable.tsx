import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'

/** A column of the register: its heading, and whether it holds figures. */
export type AdminColumn = { label: string; numeric?: boolean }

/**
 * How many columns the table has, so a row that spans it does not have to be told — the two tables
 * carried a hand-written `colSpan={6}` / `colSpan={7}` seventy lines below their headings, and adding
 * a column would have left every detail row silently one short.
 */
const ColumnCount = createContext(1)

/**
 * The frame both registers share: the scroll box that keeps the page from ever scrolling sideways,
 * the table, and the heading row read off `columns`.
 *
 * Only the frame. The rows stay written out at each call site — one holds scan facts and a gesture
 * button, the other weighted money and a totals line, and they have nothing in common but tag names.
 * A shared row renderer would be a mechanism hiding two shapes.
 */
export function AdminTable({
  columns,
  children,
}: {
  columns: readonly AdminColumn[]
  children: ReactNode
}) {
  return (
    <ColumnCount value={columns.length}>
      <div className="admin-table__scroll">
        <table className="admin-table">
          <thead>
            <tr>
              {columns.map(({ label, numeric }) => (
                <th
                  key={label}
                  scope="col"
                  className={numeric ? 'admin-table__n' : undefined}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          {children}
        </table>
      </div>
    </ColumnCount>
  )
}

/** Everything about a row that no column can hold, spanning the table by reading its column count. */
export function AdminTableDetail({ children }: { children: ReactNode }) {
  const span = useContext(ColumnCount)
  return (
    <tr className="admin-table__detail">
      <td colSpan={span}>{children}</td>
    </tr>
  )
}
