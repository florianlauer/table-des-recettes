/**
 * What the arbitration screen makes available on one row: which actions, in reading order, under
 * which words, with the sentence each destructive one has to ask first.
 *
 * The transition matrix is mirrored from the server — the server refuses on its own, this only
 * decides what to show, so a control is never offered for an action that would come back as an
 * error. The labels and confirmations sit here rather than in the route because the route has no
 * component test (R7): a pure function is the only way any of this gets checked, and « does the
 * action that destroys a paid render ask first » is exactly the kind of thing worth checking.
 */

export type BeautifyStatus = 'idle' | 'generating' | 'review' | 'failed'

// How long a generation may stay `generating` before the abandon button is offered. Ten times the
// 9,1 s measured by T13: long enough that a slow answer is not mistaken for a dead action. Declared
// here and not in the Convex module, so the screen can read it without dragging a server module —
// prompt included — into the browser bundle.
export const BEAUTIFY_LEASE_MS = 90_000

/** Every action the row can carry. The catalogue, not what is available right now. */
export const ILLUSTRATION_ACTIONS = [
  'upload',
  'accept',
  'reject',
  'generate',
  'unpublish',
  'deleteCandidate',
  'abandon',
  'detach',
  'markNoPhoto',
  'unmarkNoPhoto',
] as const

export type IllustrationAction = (typeof ILLUSTRATION_ACTIONS)[number]

export type IllustrationState = {
  title: string
  beautifyStatus: BeautifyStatus
  beautifiedAccepted: boolean
  hasOriginal: boolean
  hasCandidate: boolean
  noPhotoAvailable: boolean
  beautifyStartedAt: number | null
  /**
   * Whether this candidate is still owed a verdict. Read off the server rather than inferred from
   * `beautifyStatus === 'review'`: the guard behind « Accepter » also refuses a generation whose
   * attempt is already settled, and the screen used to offer both buttons anyway.
   */
  awaitingArbitration: boolean
}

/** Every action but the upload, which is the one that runs on a file rather than on a click. */
export type ButtonAction = Exclude<IllustrationAction, 'upload'>

/**
 * One available action, as the row will render it. Split on the control, so the row cannot ask a
 * file input for a confirmation dialog it does not have, nor look up a mutation for the one action
 * whose work is an upload.
 */
export type AvailableAction = { label: string; pendingLabel: string } & (
  | { control: 'file'; name: 'upload'; confirm?: never; settle?: never }
  | {
      control: 'button'
      name: ButtonAction
      /** Asked before running. Every action that destroys a paid render has one. */
      confirm?: string
      /** The generation is the only action whose wait deserves a progress bar. */
      settle?: boolean
    }
)

export function availableActions(
  state: IllustrationState,
  { now, leaseMs }: { now: number; leaseMs: number },
): AvailableAction[] {
  const {
    title: rawTitle,
    beautifyStatus,
    beautifiedAccepted,
    hasOriginal,
    hasCandidate,
    noPhotoAvailable,
    beautifyStartedAt,
    awaitingArbitration,
  } = state
  // Named in every confirmation, so the dialog says which row it is about even when the scan gave
  // the recipe no title yet.
  const title = rawTitle || 'sans titre'
  const running = beautifyStatus === 'generating'
  // A candidate kept by a de-publication: idle, still there, and nobody owes it a verdict.
  const kept = beautifyStatus === 'idle' && hasCandidate && !beautifiedAccepted

  const available: Array<AvailableAction | false> = [
    // Replacing or detaching while a beautification is published would leave the storefront showing
    // a render of an image that no longer exists.
    !beautifiedAccepted && {
      name: 'upload',
      control: 'file',
      label: hasOriginal ? 'Remplacer la photo' : 'Ajouter une photo',
      pendingLabel: 'Envoi…',
    },
    awaitingArbitration && {
      name: 'accept',
      control: 'button',
      label: 'Accepter l’embellissement',
      pendingLabel: 'Acceptation…',
    },
    awaitingArbitration && {
      name: 'reject',
      control: 'button',
      label: 'Rejeter le candidat',
      pendingLabel: 'Rejet…',
      // The rejection deletes the blob: the render is paid for and gone, and getting another costs
      // a second call. Same reason `detach` asks.
      confirm: `Rejeter le candidat de « ${title} » ? L’image générée est supprimée, et en obtenir une autre demandera une nouvelle génération.`,
    },
    hasOriginal &&
      !beautifiedAccepted &&
      (beautifyStatus === 'idle' || beautifyStatus === 'failed') && {
        name: 'generate',
        control: 'button',
        label: hasCandidate ? 'Régénérer' : 'Embellir',
        pendingLabel: 'Embellissement…',
        settle: true,
      },
    beautifiedAccepted && {
      name: 'unpublish',
      control: 'button',
      label: 'Dépublier l’embellissement',
      pendingLabel: 'Dépublication…',
    },
    kept && {
      name: 'deleteCandidate',
      control: 'button',
      label: 'Supprimer le candidat conservé',
      pendingLabel: 'Suppression…',
      confirm: `Supprimer le candidat conservé de « ${title} » ? L’image est effacée définitivement.`,
    },
    // Only once the lease has run out: before that a slow answer is not a dead action, and
    // abandoning it would strand a call that is still going to be billed.
    running &&
      now - (beautifyStartedAt ?? 0) >= leaseMs && {
        name: 'abandon',
        control: 'button',
        label: 'Abandonner cette génération',
        pendingLabel: 'Abandon…',
      },
    hasOriginal &&
      !beautifiedAccepted && {
        name: 'detach',
        control: 'button',
        label: 'Retirer la photo',
        pendingLabel: 'Retrait…',
        confirm: `Retirer la photo de « ${title} » ?`,
      },
    // No confirmation on either of the two below: both are reversible with the opposite button and
    // neither destroys a blob. The only thing they change is which section lists the recipe.
    //
    // And only offered where the statement can be true: saying « pas de photo dans la source » next
    // to a photo is not a claim about the source, it is a contradiction.
    !hasOriginal &&
      !noPhotoAvailable && {
        name: 'markNoPhoto',
        control: 'button',
        label: 'Pas de photo dans la source',
        pendingLabel: 'Marquage…',
      },
    noPhotoAvailable && {
      name: 'unmarkNoPhoto',
      control: 'button',
      label: 'La source a une photo',
      pendingLabel: 'Retrait de la marque…',
    },
  ]
  return available.filter(
    (action): action is AvailableAction => action !== false,
  )
}
